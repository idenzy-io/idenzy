import type { Logger } from "@idenzy/core/logging/logger";
import type {
  PrunedByRetention,
  RetentionDefaults,
  RetentionPruner,
} from "@idenzy/persistence/repository/retention-pruner";
import { RETENTION_DEFAULTS, RetentionSubject } from "@idenzy/protocol/enums/compliance";

export interface RetentionSweeperOptions {
  readonly intervalMs?: number;
  /** Rows touched per subject per pass. */
  readonly rowsPerPass?: number;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_ROWS = 10_000;

/**
 * Enforces each project's retention, which is what makes the settings screen a control
 * (PROJECT.md 4.13.6).
 *
 * Until this existed the screen offered five ages, `retention_policies` had a policy and an
 * index, and nothing ever deleted a row on account of either — so the real retention of every
 * table was "forever" while `classified()` published a data map saying ninety days. That gap is
 * worse than a long age, because a data map is what a customer is shown and an auditor reads.
 *
 * The ages are the project's where it stored one and the defaults below where it did not, and
 * both halves are resolved inside the SQL rather than here. That is deliberate: a sweeper that
 * read `retention_policies` and looped would skip exactly the projects nobody has configured,
 * which is most of them.
 *
 * Hourly and bounded per subject, so the first pass over a table that has been accumulating is
 * a series of small deletes rather than one statement holding locks for minutes. A failed pass
 * is not an incident: the rows are still there, still past their age, and the next pass is an
 * hour away.
 */
export class RetentionSweeper {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly pruner: RetentionPruner,
    private readonly logger: Logger,
    private readonly options: RetentionSweeperOptions = {},
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

  /**
   * What a project with no stored policy is swept at.
   *
   * Read from the protocol rather than written here, so the number the panel's menu shows as
   * the default is the number the delete uses. A second copy in this file is how a screen
   * comes to say ninety days about a sweep running at thirty.
   */
  defaults(): RetentionDefaults {
    return {
      sessions: RETENTION_DEFAULTS[RetentionSubject.Sessions],
      otpChallenges: RETENTION_DEFAULTS[RetentionSubject.OtpChallenges],
      oauthFlows: RETENTION_DEFAULTS[RetentionSubject.OauthFlows],
      users: RETENTION_DEFAULTS[RetentionSubject.Users],
    };
  }

  /** One pass. Answers how many rows it touched across the four subjects. */
  async sweep(): Promise<number> {
    try {
      const swept: PrunedByRetention = await this.pruner.prune(
        this.defaults(),
        this.options.rowsPerPass ?? DEFAULT_ROWS,
      );
      const total = swept.sessions + swept.otpChallenges + swept.oauthFlows + swept.users;
      if (total > 0) {
        this.logger.info("retention swept", {
          component: "retention",
          outcome: "swept",
          sessions: swept.sessions,
          otpChallenges: swept.otpChallenges,
          oauthFlows: swept.oauthFlows,
          // Stripped rather than deleted: the row and its id survive, because the audit
          // trail points at them.
          usersTombstoned: swept.users,
        });
      }
      return total;
    } catch (error) {
      this.logger.error("retention sweep failed", {
        component: "retention",
        outcome: "deferred",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}
