import { AnalyticsUnavailableError } from "@idenzy/core/errors";

/** The custom setting every row policy compares against (ADR-0013). */
export const TENANT_SETTING = "SQL_idenzy_project_id";

/**
 * The uuid the runtime user defaults the tenant setting to.
 *
 * It matches no project's rows, which is the answer Postgres gives when `app.project_id` was
 * never set. A policy that threw instead would turn a forgotten scope into something that reads
 * like an outage.
 */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";

export interface ClickHouseSettings {
  readonly url: string;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  /** How long a query may take. Analytics is not on anybody's request path; it may still not hang. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** A parameterised statement. Values are bound by ClickHouse, never interpolated by us. */
export interface AnalyticsQuery {
  readonly sql: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/**
 * The connection to the analytics store, and the only thing in the codebase that holds one.
 *
 * Every method here attaches a tenant, and there is deliberately no method that does not. That is
 * the first line of ADR-0013 — the same shape `BaseRepository` has on the Postgres side — and it
 * is the half that makes a forgotten predicate a thing somebody would have to write a second
 * client to achieve, rather than a thing they can do by omission.
 *
 * The tenant travels as a query parameter rather than as connection state, which is what makes a
 * pooled socket safe: there is nothing on the connection for the next query to inherit. The row
 * policy on the server is the second line, and it is what holds when this one is wrong.
 *
 * Values are bound with ClickHouse's own `{name:Type}` parameters. Interpolating a tenant id into
 * SQL text would put the most security-critical value in the system into a string, which is the
 * same argument ADR-0003 makes for `set_config` over `SET LOCAL`.
 */
export class ClickHouseClient {
  constructor(private readonly settings: ClickHouseSettings) {}

  /** Rows as objects, scoped to one project. */
  async query<T>(projectId: string, query: AnalyticsQuery): Promise<readonly T[]> {
    const body = await this.send(projectId, `${query.sql}\nFORMAT JSONEachRow`, query.params);
    return body
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  /**
   * Appends a batch of rows. **A batch, and never one row.**
   *
   * This is the single most important thing to get right about writing to ClickHouse, and the
   * signature is shaped to make the mistake awkward rather than to document it: every INSERT
   * creates a part, parts are merged in the background, and a row-at-a-time writer produces parts
   * faster than merges can consume them until the server refuses with `TOO_MANY_PARTS`. It is not
   * a slow path that degrades — it is a working system that stops accepting writes under load.
   *
   * **The rows carry their own `project_id` and this does not stamp it**, which is only safe
   * because of who calls it. A batch drained from the ingest queue holds rows for many projects at
   * once, so the identity that writes it cannot be tenant-scoped; it is the pipeline's, it holds
   * INSERT and no SELECT, and the tenant was stamped at enqueue where a request knew it. A row
   * policy would not have helped here either way — it filters reads and does not constrain writes
   * (ADR-0013).
   *
   * Nothing calls this from a request path. `AnalyticsIngestQueue` is what stands between the two.
   */
  async insertBatch(
    table: string,
    rows: readonly Readonly<Record<string, unknown>>[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const payload = rows.map((row) => JSON.stringify(row)).join("\n");
    await this.send(
      null,
      `INSERT INTO ${this.settings.database}.${table} FORMAT JSONEachRow\n${payload}`,
    );
  }

  /**
   * A statement with no tenant, for the owner identity only.
   *
   * DDL and retention, which are the two things that genuinely act across every project. Named so
   * that its use is visible in a diff, and kept off the runtime credential: the user this client
   * is normally built with holds SELECT and INSERT and would be refused anyway.
   */
  async execute(statement: string): Promise<void> {
    await this.send(null, statement, {}, false);
  }

  /** Whether the store answers. Used to decide whether analytics is available at all. */
  async healthy(): Promise<boolean> {
    try {
      await this.send(null, "SELECT 1", {}, false);
      return true;
    } catch {
      return false;
    }
  }

  private async send(
    projectId: string | null,
    statement: string,
    params: Readonly<Record<string, string | number>> = {},
    // DDL names its own database and runs before that database exists, so pinning one here would
    // fail the statement that creates it. Every scoped read and write pins it.
    useDatabase = true,
  ): Promise<string> {
    const url = new URL(this.settings.url);
    if (useDatabase) url.searchParams.set("database", this.settings.database);
    // Always set, even for an unscoped statement, so a request can never inherit a tenant from
    // anywhere: absent and nil are the same answer and both of them are "no rows".
    url.searchParams.set(TENANT_SETTING, projectId ?? NO_TENANT);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(`param_${name}`, String(value));
    }

    const response = await this.fetchOrFail(url, statement);
    const body = await response.text();
    if (!response.ok) {
      // The body carries ClickHouse's own error, which names a column and sometimes a value. It
      // goes to `detail` and never to a response: this is reached from a management endpoint a
      // customer can call.
      throw new AnalyticsUnavailableError({
        detail: { status: response.status, reason: body.slice(0, 500) },
      });
    }
    return body;
  }

  private async fetchOrFail(url: URL, statement: string): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        body: statement,
        headers: {
          "X-ClickHouse-User": this.settings.user,
          "X-ClickHouse-Key": this.settings.password,
        },
        signal: AbortSignal.timeout(this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new AnalyticsUnavailableError({
        detail: { reason: cause instanceof Error ? cause.name : "unknown" },
      });
    }
  }
}
