import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { WebhookDeliveryRepository } from "@idenzy/persistence/repository/webhook-delivery-repository";
import type { WebhookDueReader } from "@idenzy/persistence/repository/webhook-due-reader";
import { WebhookRepository } from "@idenzy/persistence/repository/webhook-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { WebhookDispatcher } from "./webhook-dispatcher.js";

export interface WebhookSweeperOptions {
  readonly intervalMs?: number;
  /** Projects looked at per pass, longest-waiting first. */
  readonly projectsPerPass?: number;
  /** Deliveries claimed per project per pass. */
  readonly deliveriesPerProject?: number;
  /**
   * How often the rotation windows are swept.
   *
   * Rarely, because nothing turns on the exact minute: the dispatcher already stops signing with an
   * expired secret by comparing the deadline, so this write only clears a column that is no longer
   * read. Hourly means a closed rotation stops being visible on the screen within the hour.
   */
  readonly secretSweepIntervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_PROJECTS = 50;
const DEFAULT_DELIVERIES = 50;
const DEFAULT_SECRET_SWEEP_MS = 60 * 60 * 1000;

/**
 * The durable half of the pipeline: whatever is due, whoever was supposed to have sent it
 * (ADR-0012).
 *
 * Three failures it exists for, and only the first is exotic. A retry whose Cloud Task was never
 * created — the queue was unreachable when the dispatcher tried to arm it. A dispatcher that died
 * between claiming a delivery and recording its attempt, which leaves the row `delivering` with a
 * lease on it. And the ordinary case in every environment that has no queue at all, where this is
 * not a backstop but the only timer there is.
 *
 * It claims before it sends, like the relay does, so the two racing on one delivery end with one
 * attempt rather than two calls to somebody's endpoint.
 */
export class WebhookSweeper {
  private timer: NodeJS.Timeout | null = null;
  private secretsSweptAt = 0;

  constructor(
    private readonly due: WebhookDueReader,
    private readonly uow: UnitOfWork,
    private readonly dispatcher: WebhookDispatcher,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: WebhookSweeperOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Answers how many deliveries it attempted. */
  async sweep(): Promise<number> {
    const now = this.clock.now();
    const projects = await this.due.projectsWithDueDeliveries(
      now,
      this.options.projectsPerPass ?? DEFAULT_PROJECTS,
    );

    let attempted = 0;
    for (const projectId of projects) {
      attempted += await this.sweepProject(projectId, now);
    }
    await this.sweepExpiredSecrets(projects, now);
    return attempted;
  }

  private async sweepProject(projectId: string, now: Date): Promise<number> {
    const tenant = new TenantContext(projectId, "webhook-sweeper", "system");
    try {
      const claimed = await this.uow.run(tenant, (tx) =>
        new WebhookDeliveryRepository(tx, tenant).claimDue(
          now,
          this.options.deliveriesPerProject ?? DEFAULT_DELIVERIES,
        ),
      );
      // Serially per project on purpose: several deliveries due at once for one project usually
      // means one endpoint, and opening them all at once would be this worker doing to a customer
      // what the retry schedule exists to avoid.
      for (const delivery of claimed) {
        await this.dispatcher.dispatch(projectId, delivery, "retry");
      }
      return claimed.length;
    } catch (error: unknown) {
      // One project's failure is not the pass's. The rows keep their times, so the next sweep
      // finds them again.
      this.logger.error("webhook sweep failed for a project", {
        component: "webhook-sweeper",
        outcome: "failed",
        projectId,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }

  /**
   * Clears previous secrets whose window has closed, for the projects this pass touched.
   *
   * Riding on the sweep rather than having a timer of its own, because the set of projects worth
   * looking at is the same set: a project with deliveries is a project whose endpoints are in use.
   * A project that rotated a secret and then went quiet keeps a stale column and signs with one
   * secret anyway — the dispatcher compares the deadline — so the cost of being late here is a
   * screen showing a rotation as open for longer than it was.
   */
  private async sweepExpiredSecrets(projects: readonly string[], now: Date): Promise<void> {
    const every = this.options.secretSweepIntervalMs ?? DEFAULT_SECRET_SWEEP_MS;
    if (now.getTime() - this.secretsSweptAt < every) return;
    this.secretsSweptAt = now.getTime();

    for (const projectId of projects) {
      const tenant = new TenantContext(projectId, "webhook-sweeper", "system");
      try {
        const cleared = await this.uow.run(tenant, (tx) =>
          new WebhookRepository(tx, tenant).clearExpiredPreviousSecrets(now),
        );
        if (cleared > 0) {
          this.logger.info("webhook rotation windows closed", {
            component: "webhook-sweeper",
            outcome: "cleared",
            projectId,
            count: cleared,
          });
        }
      } catch (error: unknown) {
        this.logger.warn("webhook secret sweep failed for a project", {
          component: "webhook-sweeper",
          outcome: "failed",
          projectId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }
}
