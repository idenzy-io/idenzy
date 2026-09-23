import { HyperLogLog } from "@idenzy/core/metering/hyper-log-log";

/** The commands this needs. A real `Valkey` satisfies it structurally. */
export interface LiveUsageCommands {
  hset(key: string, field: string, value: Buffer): Promise<unknown>;
  pexpire(key: string, milliseconds: number): Promise<unknown>;
  hgetallBuffer(key: string): Promise<Record<string, Buffer>>;
}

/**
 * Forty days: past the end of any month a key can describe, plus the drawdown's grace for
 * finishing the previous one. A key outlives its month and then goes, without a sweep.
 */
const TTL_MS = 40 * 24 * 60 * 60 * 1000;

/**
 * Each API instance's view of a project's month, as a sketch, for the live balance (ADR-0017).
 *
 * One hash per project and month, one field per API instance holding everything that instance has
 * seen this month. A reader unions every field with what Postgres already holds, and because a
 * union is a per-register maximum the result is exactly the figure the ledger will price once the
 * instances flush — which is what makes the live balance and the ledger agree to the cent.
 *
 * **A hint, never a record.** An instance that restarts starts a fresh field, a key that expires
 * loses nothing Postgres does not have, and a Valkey restart leaves the balance on the ledger's
 * figure until the next publish. Nothing here is billed from; the ledger prices Postgres alone.
 */
export class LiveUsageSketches {
  constructor(private readonly commands: LiveUsageCommands) {}

  /** Replaces this instance's view of a project's month. */
  async publish(
    projectId: string,
    period: string,
    instanceId: string,
    sketch: HyperLogLog,
  ): Promise<void> {
    const key = keyOf(projectId, period);
    await this.commands.hset(key, instanceId, Buffer.from(sketch.encode()));
    await this.commands.pexpire(key, TTL_MS);
  }

  /**
   * Every instance's view of a project's month. A field that will not decode is skipped rather
   * than failing the read: it can only ever have been a subset of what the others and Postgres
   * hold, so leaving it out undercounts for a moment and never overcounts.
   */
  async read(projectId: string, period: string): Promise<readonly HyperLogLog[]> {
    const fields = await this.commands.hgetallBuffer(keyOf(projectId, period));
    const sketches: HyperLogLog[] = [];
    for (const bytes of Object.values(fields)) {
      try {
        sketches.push(HyperLogLog.decode(new Uint8Array(bytes)));
      } catch {
        // Skipped, as above.
      }
    }
    return sketches;
  }
}

function keyOf(projectId: string, period: string): string {
  return `usage:live:${projectId}:${period}`;
}
