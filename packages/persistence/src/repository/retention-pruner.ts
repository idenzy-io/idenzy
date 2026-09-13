import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** What one pass did, per subject. */
export interface PrunedByRetention {
  readonly sessions: number;
  readonly otpChallenges: number;
  readonly oauthFlows: number;
  /** Accounts stripped to a shell, not removed. The row and its id survive. */
  readonly users: number;
}

/** The age each subject falls back to where a project stored none, as ISO 8601 durations. */
export interface RetentionDefaults {
  readonly sessions: string;
  readonly otpChallenges: string;
  readonly oauthFlows: string;
  readonly users: string;
}

/**
 * Applies each project's retention, and the defaults where it stored none (PROJECT.md 4.13.6).
 *
 * Not a `BaseRepository`, and it could not be one. A sweeper serves every project and sets no
 * `app.project_id`, so under FORCE RLS every statement here would match nothing — no error, no
 * rows, and a job that reports success over tables that grow forever. That is the failure mode
 * worth naming, because it is silent: the only symptom is a data map that says 90 days beside a
 * table holding two years.
 *
 * The SECURITY DEFINER functions from 0052 are what make it possible without handing the app
 * role a way to delete across tenants. They also resolve the age per project inside the
 * statement, which is the part that matters for correctness rather than for speed: a project
 * that has never opened the settings screen has no policy row, and a sweeper that only read
 * `retention_policies` would skip exactly the projects nobody has configured.
 *
 * Bounded per subject per pass, so a first run over a table that has been accumulating is a
 * series of small deletes rather than one statement holding locks for minutes.
 */
export class RetentionPruner {
  constructor(private readonly db: NodePgDatabase) {}

  async prune(defaults: RetentionDefaults, maxRowsPerSubject: number): Promise<PrunedByRetention> {
    return {
      sessions: await this.call("retention_sweep_sessions", defaults.sessions, maxRowsPerSubject),
      otpChallenges: await this.call(
        "retention_sweep_otp_challenges",
        defaults.otpChallenges,
        maxRowsPerSubject,
      ),
      oauthFlows: await this.call(
        "retention_sweep_oauth_flows",
        defaults.oauthFlows,
        maxRowsPerSubject,
      ),
      users: await this.call("retention_tombstone_users", defaults.users, maxRowsPerSubject),
    };
  }

  /**
   * Calls one sweep function.
   *
   * The name is interpolated and the arguments are bound, which is safe here for a reason
   * worth stating rather than assuming: the four names are literals in `prune` above and
   * reach this from nowhere else. The ISO 8601 duration is bound and cast, so a value that
   * somehow got past the service's allowlist is a cast failure rather than anything worse.
   */
  private async call(fn: string, age: string, maxRows: number): Promise<number> {
    const rows = await this.db.execute<{ swept: string }>(
      sql`select ${sql.raw(fn)}(${age}::interval, ${maxRows}) as swept`,
    );
    return Number(rows.rows[0]?.swept ?? 0);
  }
}
