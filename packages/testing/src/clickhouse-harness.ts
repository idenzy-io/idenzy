import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InternalError } from "@idenzy/core/errors";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

const here = dirname(fileURLToPath(import.meta.url));
const infra = join(here, "..", "..", "..", "infra", "docker");

/**
 * A real ClickHouse for integration tests (PROJECT.md 7.4).
 *
 * Provisioned from the same files `docker compose` uses — the server config that declares the
 * custom-settings prefix, and the init script that creates the two identities — rather than from a
 * second copy of them here. That is the point: ADR-0013's isolation rests on a config directive, a
 * user's privileges and a row policy, so a harness that set those up its own way would be testing
 * a server nobody deploys.
 *
 * Users and row policies are server-level objects, so they come from the init script exactly as
 * roles do on the Postgres side. The database and the tables come from `migrateAnalytics`, which
 * is what the tests are there to exercise.
 */
export class ClickHouseHarness {
  private container: StartedTestContainer | null = null;

  async start(): Promise<void> {
    this.container = await new GenericContainer("clickhouse/clickhouse-server:25.3-alpine")
      .withEnvironment({
        CLICKHOUSE_DB: "idenzy",
        // The entrypoint answers `CLICKHOUSE_USER` by writing into `users.d`, which would land on
        // top of the file below. The identities come from the init script instead.
        CLICKHOUSE_SKIP_USER_SETUP: "1",
      })
      .withCopyFilesToContainer([
        {
          source: join(infra, "clickhouse", "config.d", "idenzy.xml"),
          target: "/etc/clickhouse-server/config.d/idenzy.xml",
        },
        {
          source: join(infra, "clickhouse", "users.d", "idenzy.xml"),
          target: "/etc/clickhouse-server/users.d/idenzy.xml",
        },
        {
          source: join(infra, "clickhouse-init", "01-roles.sql"),
          target: "/docker-entrypoint-initdb.d/01-roles.sql",
        },
      ])
      .withExposedPorts(8123)
      .withUlimits({ nofile: { soft: 262144, hard: 262144 } })
      .withWaitStrategy(Wait.forHttp("/ping", 8123).forStatusCode(200))
      .withStartupTimeout(120_000)
      .start();
  }

  /** Where the HTTP interface is, with the port Testcontainers actually mapped. */
  get url(): string {
    if (this.container === null) {
      throw new InternalError({ detail: { reason: "harness not started" } });
    }
    return `http://${this.container.getHost()}:${String(this.container.getMappedPort(8123))}`;
  }

  async stop(): Promise<void> {
    await this.container?.stop();
  }
}
