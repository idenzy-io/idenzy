import { RateLimitStrategy } from "@idenzy/cache/rate-limit-strategy";
import {
  AttestationRequiredError,
  CountryNotAllowedError,
  RateLimitedError,
} from "@idenzy/core/errors";
import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import type { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { AttestationVerifier } from "@idenzy/domain/ports/attestation";
import type { FraudGuard, PhoneGeography, SendContext } from "@idenzy/domain/ports/sms-provider";
import { SmsPolicyRepository } from "@idenzy/persistence/repository/sms-policy-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Inject, Injectable } from "@nestjs/common";
import { ATTESTATION_VERIFIER, PHONE_GEOGRAPHY } from "./delivery-tokens.js";

const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;

/** How long a refused caller is told to wait. One window, not a computed remainder. */
const RETRY_AFTER_SECONDS = 900;

/**
 * How many recent destinations may share a thousand-block before it reads as a sweep.
 *
 * A constant rather than a policy column because it describes an attack shape and not a
 * customer preference: a real user base does not arrive in consecutive runs, whatever
 * the product is. Ten in an hour is loose enough that a large customer's genuine traffic
 * in one carrier block does not trip it.
 */
const BLOCK_BURST_LIMIT = 10;

/**
 * How many sends a project makes in a day before the verify ratio means anything.
 *
 * Below this the ratio is noise: two sends and no verify is a person who changed their
 * mind, not a scheme.
 */
const RATIO_FLOOR = 20;

/**
 * Everything that has to be true before an SMS costs us anything (PROJECT.md 4.8).
 *
 * The order is the design. Placing the number is first because it is free and decides
 * two refusals on its own. Attestation comes before any counter, so a caller who has not
 * proved they are human cannot burn a real user's velocity budget by naming their number.
 * The counters come last because they are the only checks that write, and a check that
 * writes must not run for a request already refused.
 *
 * Every counter here is strict. A window we could not read is a window we do not send
 * through: the fail-open that is right for a sign-in attempt would turn a cache outage
 * into an unmetered send window, and that is the whole opportunity a pumping scheme is
 * looking for.
 */
@Injectable()
export class SmsFraudGuard implements FraudGuard {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly limiter: RateLimitStrategy,
    private readonly logger: Logger,
    @Inject(PHONE_GEOGRAPHY) private readonly geography: PhoneGeography,
    @Inject(ATTESTATION_VERIFIER) private readonly attestation: AttestationVerifier,
  ) {}

  async assertAllowed(context: SendContext, to: E164PhoneNumber): Promise<void> {
    const placement = this.geography.place(to);
    const tenant = new TenantContext(context.projectId, context.requestId, "system");

    const { policy, counters } = await this.uow.run(tenant, async (tx) => ({
      policy: await new SmsPolicyRepository(tx, tenant).current(),
      counters: await new UsageRepository(tx, tenant).smsCountersFor(this.clock.now()),
    }));

    // No policy row is the same answer as an empty allowlist. A project nobody has
    // configured does not start sending on the strength of a request asking it to.
    if (policy === null || policy.allowedCountries.length === 0) {
      throw new CountryNotAllowedError({ detail: { country: placement.country } });
    }

    if (placement.premiumRate) {
      this.report(context, "premium_rate");
      throw new CountryNotAllowedError({
        message: "That number is on a premium-rate range.",
        detail: { country: placement.country },
      });
    }

    // A number we could not place is refused. An allowlist that admits what it could not
    // identify is not an allowlist, and unplaceable ranges are disproportionately the
    // expensive ones.
    if (placement.country === null || !policy.allowedCountries.includes(placement.country)) {
      throw new CountryNotAllowedError({ detail: { country: placement.country } });
    }

    if (policy.attestationRequired) {
      await this.assertAttested(context);
    }

    await this.assertWithinVelocity(
      context,
      to,
      policy.perNumberDailyLimit,
      policy.perIpHourlyLimit,
    );
    await this.assertNotSweeping(context, to);
    this.assertVerifyRatio(context, counters, policy.maxSendsPerVerify);
  }

  private async assertAttested(context: SendContext): Promise<void> {
    if (context.attestation === null) {
      throw new AttestationRequiredError();
    }
    const genuine = await this.attestation.verify(
      context.projectId,
      context.attestation,
      context.ip,
    );
    if (!genuine) {
      this.report(context, "attestation_failed");
      throw new AttestationRequiredError();
    }
  }

  /**
   * Per-number and per-IP ceilings.
   *
   * Both, because they catch different halves of the same abuse: one number hit
   * repeatedly is a scheme milking one destination, and one address spraying many
   * numbers is the sweep. Neither ceiling alone sees the other.
   */
  private async assertWithinVelocity(
    context: SendContext,
    to: E164PhoneNumber,
    perNumberDaily: number,
    perIpHourly: number,
  ): Promise<void> {
    await this.consume(context, "sms:number", `${context.projectId}:${to.value}`, {
      limit: perNumberDaily,
      windowSeconds: DAY_SECONDS,
    });

    if (context.ip === null) return;
    await this.consume(context, "sms:ip", `${context.projectId}:${context.ip}`, {
      limit: perIpHourly,
      windowSeconds: HOUR_SECONDS,
    });
  }

  /**
   * Sequential-number detection, on the thousand-block the destination sits in.
   *
   * A pumping run walks a range, so its numbers share every digit but the last few. The
   * block is the cheapest shape that catches that: one counter per prefix, and a genuine
   * user base spread across a country never concentrates in one.
   */
  private async assertNotSweeping(context: SendContext, to: E164PhoneNumber): Promise<void> {
    const block = to.value.slice(0, -3);
    await this.consume(context, "sms:block", `${context.projectId}:${block}`, {
      limit: BLOCK_BURST_LIMIT,
      windowSeconds: HOUR_SECONDS,
    });
  }

  /**
   * Codes sent against codes entered.
   *
   * The signal that catches a scheme which has done everything else right, because the
   * one thing it cannot fake is somebody typing the code in. It throttles the project
   * rather than the caller, which is blunt and deliberate: by the time this trips, the
   * traffic is not a user having a bad day.
   */
  private assertVerifyRatio(
    context: SendContext,
    counters: { sent: number; verified: number },
    maxSendsPerVerify: number,
  ): void {
    if (counters.sent < RATIO_FLOOR) return;
    if (counters.sent <= counters.verified * maxSendsPerVerify) return;
    this.report(context, "verify_ratio");
    throw new RateLimitedError(RETRY_AFTER_SECONDS, {
      detail: { sent: counters.sent, verified: counters.verified },
    });
  }

  /**
   * One strict window, with an unreadable store treated as a refusal.
   *
   * The caller is told to come back later rather than that our cache is down, which is
   * both the honest instruction and the one that leaks nothing.
   */
  private async consume(
    context: SendContext,
    scope: string,
    identifier: string,
    rule: { limit: number; windowSeconds: number },
  ): Promise<void> {
    let allowed: boolean;
    try {
      allowed = (await this.limiter.checkStrictly(scope, identifier, rule)).allowed;
    } catch {
      this.report(context, "counter_unavailable");
      throw new RateLimitedError(RETRY_AFTER_SECONDS);
    }
    if (!allowed) {
      this.report(context, scope);
      throw new RateLimitedError(rule.windowSeconds);
    }
  }

  /**
   * The alert half of 4.8. Fields only: the number is the thing worth knowing and the
   * thing this line may never carry, which is what the allowlist is for.
   */
  private report(context: SendContext, outcome: string): void {
    this.logger.warn("sms send refused", {
      component: "sms-fraud",
      channel: "sms",
      outcome,
      projectId: context.projectId,
      requestId: context.requestId,
    });
  }
}
