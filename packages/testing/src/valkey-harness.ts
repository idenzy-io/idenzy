import { InternalError } from "@idenzy/core/errors";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

/**
 * A real Valkey for integration tests (PROJECT.md 7.4).
 *
 * The same image and the same flags `docker compose` runs, persistence included — which is to say
 * excluded. Nothing that uses this is allowed to depend on a restart preserving anything, and a
 * harness that quietly turned on an append-only file would be hiding exactly the property the
 * callers are written against.
 */
export class ValkeyHarness {
  private container: StartedTestContainer | null = null;

  async start(): Promise<void> {
    this.container = await new GenericContainer("valkey/valkey:8-alpine")
      .withCommand(["valkey-server", "--save", "", "--appendonly", "no"])
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .withStartupTimeout(60_000)
      .start();
  }

  get url(): string {
    if (this.container === null) {
      throw new InternalError({ detail: { reason: "harness not started" } });
    }
    return `redis://${this.container.getHost()}:${String(this.container.getMappedPort(6379))}`;
  }

  async stop(): Promise<void> {
    await this.container?.stop();
  }
}
