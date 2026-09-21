import { InternalError, SpendCapReachedError, WalletEmptyError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import type { Money, SpendCap } from "@idenzy/domain/ports/sms-provider";
import { SmsPolicyRepository } from "@idenzy/persistence/repository/sms-policy-repository";
import { UsageRepository } from "@idenzy/persistence/repository/usage-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { WalletSolvency } from "./wallet-solvency.js";

const MICROS_PER_UNIT = 1_000_000;

/**
 * The daily SMS spend cap, held in Postgres (PROJECT.md 4.8).
 *
 * A hard stop rather than an alert, and durable rather than cached, because this is the
 * one limit whose failure mode is an invoice. A Valkey outage must not be able to lift
 * it, so it is measured against `usage_daily.sms_cost`, which is the same row billing
 * reads.
 *
 * A project with no policy row spends nothing. That is the same answer as an empty
 * allowlist and it is deliberate: "nobody configured this" is not a reason to start
 * spending on a project's behalf.
 */
@Injectable()
export class DatabaseSpendCap implements SpendCap {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly solvency: WalletSolvency,
  ) {}

  async reserve(projectId: string, cost: Money): Promise<void> {
    // Before the daily cap and before anything is reserved. The two limits answer different
    // questions and both have to hold: the cap is the project's own ceiling on a day, and
    // this is whether the organisation behind it has anything left to spend at all
    // (ADR-0014). Checked first because it is the cheaper refusal and the more final one —
    // a project at its daily cap can send tomorrow, an organisation past its tolerance
    // cannot until somebody tops up.
    if (!(await this.solvency.canSpend(projectId))) {
      throw new WalletEmptyError({ detail: { projectId, channel: "sms" } });
    }
    const tenant = tenantFor(projectId);
    const allowed = await this.uow.transaction(async (tx) => {
      const policy = await new SmsPolicyRepository(tx, tenant).current();
      if (policy === null) return false;
      if (policy.currency !== cost.currency) {
        // Converting here would put an exchange rate on the request path and make the
        // cap mean something different every day. The provider is configured in the
        // project's own currency or it is misconfigured.
        throw new InternalError({
          detail: {
            reason: "a provider quoted in a currency the project's cap is not set in",
            quoted: cost.currency,
            cap: policy.currency,
          },
        });
      }
      return new UsageRepository(tx, tenant).reserveSmsSpend(
        this.clock.now(),
        toDecimal(cost.amountMicros),
        policy.dailySpendCap,
      );
    });

    if (!allowed) {
      throw new SpendCapReachedError({ detail: { projectId, channel: "sms" } });
    }
  }

  /**
   * Books the difference between what was quoted and what was charged.
   *
   * Its own transaction, and never inside the caller's: the reservation has to stand
   * even where the send that follows it fails, and a settlement rolled back with the
   * request would put the ledger below what was actually spent.
   */
  async settle(projectId: string, reserved: Money, actual: Money): Promise<void> {
    if (reserved.currency !== actual.currency) {
      throw new InternalError({
        detail: {
          reason: "a provider settled in a currency it did not quote in",
          quoted: reserved.currency,
          settled: actual.currency,
        },
      });
    }
    const delta = actual.amountMicros - reserved.amountMicros;
    if (delta === 0) return;
    const tenant = tenantFor(projectId);
    await this.uow.transaction((tx) =>
      new UsageRepository(tx, tenant).settleSmsSpend(this.clock.now(), toDecimal(delta)),
    );
  }
}

function tenantFor(projectId: string): TenantContext {
  return new TenantContext(projectId, "delivery", "system");
}

/**
 * Micros as the six-decimal string the column stores.
 *
 * Formatted rather than divided into a float, so a cost never arrives as 0.006999999999
 * and the cap comparison is exact arithmetic on both sides.
 */
function toDecimal(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(micros));
  const units = Math.trunc(absolute / MICROS_PER_UNIT);
  const fraction = absolute % MICROS_PER_UNIT;
  return `${sign}${units}.${fraction.toString().padStart(6, "0")}`;
}
