import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InternalError } from "@idenzy/core/errors";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/**
 * A real Postgres for integration tests (PROJECT.md 7.4).
 *
 * Real, not mocked, because the properties worth testing here are database properties:
 * RLS isolation and the append-only privilege shape of audit_events. A mock would
 * assert that our code calls what we think it calls, which is precisely not the
 * question.
 *
 * The container is created exactly as production is: roles first (they are cluster-level
 * objects, and migration 0000 references idenzy_app), then migrations.
 */
export class PostgresHarness {
  private container: StartedPostgreSqlContainer | null = null;
  private ownerClient: pg.Client | null = null;
  private appPool: pg.Pool | null = null;

  async start(): Promise<void> {
    this.container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("idenzy")
      .withUsername("idenzy")
      .withPassword("idenzy")
      .start();

    const url = this.container.getConnectionUri();
    this.ownerClient = new pg.Client({ connectionString: url });
    await this.ownerClient.connect();

    await this.ownerClient.query(`
      CREATE ROLE idenzy_app NOLOGIN NOBYPASSRLS;
      CREATE ROLE idenzy_owner NOLOGIN;
      GRANT idenzy_app TO idenzy;
      GRANT idenzy_owner TO idenzy;
    `);

    const here = dirname(fileURLToPath(import.meta.url));
    const migrationsFolder = join(here, "..", "..", "persistence", "drizzle");
    await migrate(drizzle(this.ownerClient), { migrationsFolder });

    this.appPool = new pg.Pool({ connectionString: url, max: 4 });
    // Every pooled connection becomes idenzy_app, so tests exercise the same privileges
    // production runs under rather than a superuser's.
    this.appPool.on("connect", (client) => {
      void client.query("SET ROLE idenzy_app");
    });
  }

  /** Owner connection, for seeding and for assertions about privileges. */
  get owner(): pg.Client {
    if (this.ownerClient === null)
      throw new InternalError({ detail: { reason: "harness not started" } });
    return this.ownerClient;
  }

  /** Drizzle bound to the app role. This is what a repository would use. */
  get db(): NodePgDatabase {
    if (this.appPool === null)
      throw new InternalError({ detail: { reason: "harness not started" } });
    return drizzle(this.appPool);
  }

  get pool(): pg.Pool {
    if (this.appPool === null)
      throw new InternalError({ detail: { reason: "harness not started" } });
    return this.appPool;
  }

  async stop(): Promise<void> {
    await this.appPool?.end();
    await this.ownerClient?.end();
    await this.container?.stop();
  }
}
