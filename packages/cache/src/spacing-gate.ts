/** The commands the gate needs. A real `Valkey` satisfies it structurally. */
export interface SpacingGateCommands {
  set(key: string, value: string, px: "PX", ms: number, nx: "NX"): Promise<string | null>;
  pttl(key: string): Promise<number>;
}

/**
 * Lets a thing through at most once per interval, across every process that shares the gate.
 *
 * `SET NX PX` is the whole mechanism: the first caller in an interval creates the key and the
 * rest find it there until it expires. Used to stop a busy organisation's usage signals from
 * repricing its month on every tick, which would read a month of sketches per project each
 * time and learn nothing a minute's wait would not.
 */
export class SpacingGate {
  constructor(
    private readonly commands: SpacingGateCommands,
    private readonly prefix: string,
  ) {}

  /** True if this caller may go now; false with how long until the next may. */
  async pass(key: string, intervalMs: number): Promise<{ passed: boolean; waitMs: number }> {
    const set = await this.commands.set(this.prefix + key, "1", "PX", intervalMs, "NX");
    if (set === "OK") return { passed: true, waitMs: 0 };
    const left = await this.commands.pttl(this.prefix + key);
    return { passed: false, waitMs: left > 0 ? left : intervalMs };
  }
}
