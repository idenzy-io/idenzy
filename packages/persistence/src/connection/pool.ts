import pg from "pg";

export interface PoolOptions {
  readonly connectionString: string;
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly statementTimeoutMillis?: number;
}

/**
 * The application pool. Connects as `idenzy_app`, which is NOBYPASSRLS, so a query that
 * escapes the repository layer still cannot escape the tenant policy (ADR-0003).
 *
 * A statement timeout is set on every connection: an auth request that cannot finish
 * quickly should fail rather than hold a pooled connection open.
 */
export function createPool(options: PoolOptions): pg.Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    allowExitOnIdle: false,
  });

  const statementTimeout = options.statementTimeoutMillis ?? 10_000;
  pool.on("connect", (client) => {
    void client.query(`set statement_timeout = ${statementTimeout}`);
  });

  return pool;
}
