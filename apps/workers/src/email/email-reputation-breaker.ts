import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import {
  type DeliveryWindow,
  EmailDeliveryStatsRepository,
} from "@idenzy/persistence/repository/email-delivery-stats-repository";
import {
  EmailSendingHoldRepository,
  HoldReason,
} from "@idenzy/persistence/repository/email-sending-hold-repository";
import type { ProjectEmailActivityReader } from "@idenzy/persistence/repository/project-email-activity-reader";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";

export interface EmailReputationBreakerOptions {
  readonly intervalMs?: number;
  readonly projectsPerPass?: number;
  readonly windowDays?: number;
  readonly minimumSends?: number;
  readonly bounceLimitPpm?: number;
  readonly complaintLimitPpm?: number;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_PROJECTS = 200;

/**
 * Seven days, which is roughly the window AWS's own reputation figures move over.
 *
 * Shorter and one bad afternoon closes a project that has sent cleanly for a month; longer and
 * a project that has been fixed stays shut for a fortnight, because a held project sends
 * nothing and so cannot dilute its own rate. The recovery cost is why this is not thirty.
 */
const DEFAULT_WINDOW_DAYS = 7;

/**
 * Below this, no rate is actionable.
 *
 * Two bounces out of ten is 20% and means nothing; two hundred out of four thousand means a
 * list nobody cleaned. Without a floor the breaker's first act on a new project would be to
 * close it over its first undeliverable test address. An unverified project cannot exceed 200
 * a day on the shared sender anyway, so this is a week of that allowance at its busiest.
 */
const DEFAULT_MINIMUM_SENDS = 200;

/**
 * AWS's own at-risk thresholds: 5% bounces, 0.1% complaints, in parts per million.
 *
 * We trip where AWS starts *looking*, not where it acts. What it reviews is the account, which
 * every customer sends through, so by the time the account-wide figure is bad the damage is
 * already shared — the point of a per-project breaker is to take the one project out before its
 * numbers become everybody's.
 */
const DEFAULT_BOUNCE_LIMIT_PPM = 50_000;
const DEFAULT_COMPLAINT_LIMIT_PPM = 1_000;

/** Parts per million, so a threshold is an integer comparison rather than a float one. */
export function ppm(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1_000_000);
}

/** What the window says about a project, before anything is done about it. */
export interface ReputationVerdict {
  readonly breached: boolean;
  readonly reason: HoldReason | null;
  readonly bounceRatePpm: number;
  readonly complaintRatePpm: number;
  readonly observedSends: number;
}

/**
 * Stops a project whose bounce or complaint rate would cost us the SES account (risks.md 2).
 *
 * Every customer's mail leaves through one AWS account, and AWS tracks bounce and complaint
 * rates per account as well as per domain. One project mailing a scraped list is therefore not
 * that project's problem: a bad enough account-wide figure is a review or a sending suspension
 * that takes mail down for every customer at once, including the ones who did nothing. The
 * shared sender is already bounded by a burst and a daily cap; this is the bound on everything
 * else, and it applies to a project with its own verified domain for exactly that reason.
 *
 * Evaluated here and enforced on the send path, rather than recomputed per message. That keeps
 * a send to one indexed read, and it makes the refusal a record with the figures that caused it
 * rather than a number that has since moved — which is also what a person needs in order to
 * release one.
 */
export class EmailReputationBreaker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly activity: ProjectEmailActivityReader,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: EmailReputationBreakerOptions = {},
  ) {}

  start(): void {
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Answers how many projects it changed the state of. */
  async runOnce(): Promise<number> {
    const since = this.windowStart(this.clock.now());
    const projects = await this.activity.toJudge(
      since,
      this.options.projectsPerPass ?? DEFAULT_PROJECTS,
    );

    let changed = 0;
    for (const projectId of projects) {
      try {
        if (await this.judge(projectId, since)) changed += 1;
      } catch (error) {
        // One project's failure is not the pass's. The next pass reads the same window and
        // reaches the same verdict, so nothing is lost by deferring this one.
        this.logger.error("email reputation check failed", {
          component: "email-reputation",
          outcome: "deferred",
          projectId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
    }
    return changed;
  }

  /**
   * Opens a hold, releases one, or leaves things as they are.
   *
   * A held project appears here because it is held, not because it has been sending — it has
   * not, which is the point — so the window it is judged on will usually be empty. An empty
   * window is below the volume floor, so it does not breach, so the hold is released. That is
   * the intended path back: the bad days age out and nothing has to improve on them.
   */
  private async judge(projectId: string, since: string): Promise<boolean> {
    const tenant = new TenantContext(projectId, "email-reputation", "system");

    return await this.uow.run(tenant, async (tx) => {
      const window = await new EmailDeliveryStatsRepository(tx, tenant).since(since);
      const verdict = this.verdict(window);
      const holds = new EmailSendingHoldRepository(tx, tenant);
      const open = await holds.current();

      if (verdict.breached && open === null) {
        const opened = await holds.open({
          reason: verdict.reason ?? HoldReason.BounceRate,
          bounceRatePpm: verdict.bounceRatePpm,
          complaintRatePpm: verdict.complaintRatePpm,
          observedSends: verdict.observedSends,
        });
        if (opened) {
          this.logger.warn("email sending held", {
            component: "email-reputation",
            outcome: "held",
            projectId,
            reason: verdict.reason,
            bounceRatePpm: verdict.bounceRatePpm,
            complaintRatePpm: verdict.complaintRatePpm,
            observedSends: verdict.observedSends,
          });
        }
        return opened;
      }

      if (!verdict.breached && open !== null) {
        // Released by the breaker rather than by a person, so `releasedBy` stays null. The
        // window having rolled past the bad days is the whole of the evidence, and it is the
        // only way a hold clears on its own: a held project sends nothing, so its rate does not
        // improve — the bad days simply age out.
        const released = await holds.release(null, "the recent window is back under the threshold");
        if (released) {
          this.logger.info("email sending released", {
            component: "email-reputation",
            outcome: "released",
            projectId,
            bounceRatePpm: verdict.bounceRatePpm,
            complaintRatePpm: verdict.complaintRatePpm,
          });
        }
        return released;
      }

      return false;
    });
  }

  /**
   * The judgement itself, as a pure function of the window, so it can be tested as one.
   *
   * Bounces are checked before complaints only so that a project breaching both is reported by
   * the larger signal; both figures are recorded on the hold whichever one tripped it.
   */
  verdict(window: DeliveryWindow): ReputationVerdict {
    const bounceRatePpm = ppm(window.bounced, window.sent);
    const complaintRatePpm = ppm(window.complained, window.sent);
    const observedSends = window.sent;

    const enough = observedSends >= (this.options.minimumSends ?? DEFAULT_MINIMUM_SENDS);
    const bounceLimit = this.options.bounceLimitPpm ?? DEFAULT_BOUNCE_LIMIT_PPM;
    const complaintLimit = this.options.complaintLimitPpm ?? DEFAULT_COMPLAINT_LIMIT_PPM;

    const reason = !enough
      ? null
      : bounceRatePpm >= bounceLimit
        ? HoldReason.BounceRate
        : complaintRatePpm >= complaintLimit
          ? HoldReason.ComplaintRate
          : null;

    return { breached: reason !== null, reason, bounceRatePpm, complaintRatePpm, observedSends };
  }

  /** The first day of the window, as `YYYY-MM-DD`. */
  private windowStart(now: Date): string {
    const days = this.options.windowDays ?? DEFAULT_WINDOW_DAYS;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return start.toISOString().slice(0, 10);
  }
}
