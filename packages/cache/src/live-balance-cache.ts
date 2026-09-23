/** The commands this needs. A real `Valkey` satisfies it structurally. */
export interface LiveBalanceCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", milliseconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

/** How the organisation pays, which decides what its live figure means (ADR-0019). */
export type LiveMode = "prepaid" | "invoiced";

/** What the ledger said the last time anybody read it, per organisation. */
export interface LedgerSnapshot {
  readonly mode: LiveMode;
  /** Spendable credit less debt, in cents. Negative inside the tolerance. */
  readonly balanceCents: number;
  /** The watermark of each period still being billed, `YYYY-MM-DD` to cents. */
  readonly billedCents: Readonly<Record<string, number>>;
  /** When it was read, in milliseconds since the epoch. */
  readonly readAt: number;
}

/**
 * The balance as of the last five-second tick. For an invoiced organisation `pendingCents` is its
 * usage so far this month, which is what its next invoice will bill.
 */
export interface LiveBalance {
  readonly mode: LiveMode;
  /** The ledger balance less usage not yet written to the ledger. */
  readonly balanceCents: number;
  /** Usage priced but not yet on the ledger. */
  readonly pendingCents: number;
  /** When it was computed, in milliseconds since the epoch. */
  readonly asOf: number;
}

/** Ten minutes: two ledger passes. A figure older than that is not shown as live. */
const TTL_MS = 10 * 60 * 1000;

/**
 * The two figures the live balance is made of, cached per organisation (ADR-0017).
 *
 * **Derived, never accumulated.** Both can be rebuilt at any time — the snapshot from Postgres, the
 * live figure from the snapshot and the sketches — so a lost or expired key costs a recomputation
 * and never money. Nothing charges from here: the ledger prices Postgres, and the automatic top-up
 * decides under a Postgres row lock.
 *
 * Reads answer null on anything they cannot parse, which every caller treats as a miss.
 */
export class LiveBalanceCache {
  constructor(private readonly commands: LiveBalanceCommands) {}

  async ledger(orgId: string): Promise<LedgerSnapshot | null> {
    const parsed = await this.read(`billing:ledger:${orgId}`);
    if (parsed === null) return null;
    const { balanceCents, billedCents, readAt } = parsed;
    const mode = modeOf(parsed["mode"]);
    if (typeof balanceCents !== "number" || typeof readAt !== "number") return null;
    if (typeof billedCents !== "object" || billedCents === null) return null;
    const billed: Record<string, number> = {};
    for (const [period, cents] of Object.entries(billedCents)) {
      if (typeof cents !== "number") return null;
      billed[period] = cents;
    }
    return { mode, balanceCents, billedCents: billed, readAt };
  }

  async putLedger(orgId: string, snapshot: LedgerSnapshot): Promise<void> {
    await this.commands.set(`billing:ledger:${orgId}`, JSON.stringify(snapshot), "PX", TTL_MS);
  }

  /** Forgets the snapshot, so the next tick reads the ledger again. Sent after a ledger write. */
  async dropLedger(orgId: string): Promise<void> {
    await this.commands.del(`billing:ledger:${orgId}`);
  }

  async live(orgId: string): Promise<LiveBalance | null> {
    const parsed = await this.read(`billing:live:${orgId}`);
    if (parsed === null) return null;
    const { balanceCents, pendingCents, asOf } = parsed;
    if (typeof balanceCents !== "number" || typeof pendingCents !== "number") return null;
    if (typeof asOf !== "number") return null;
    return { mode: modeOf(parsed["mode"]), balanceCents, pendingCents, asOf };
  }

  async putLive(orgId: string, live: LiveBalance): Promise<void> {
    await this.commands.set(`billing:live:${orgId}`, JSON.stringify(live), "PX", TTL_MS);
  }

  private async read(key: string): Promise<Record<string, unknown> | null> {
    const raw = await this.commands.get(key);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // Safe: an object checked on the same line; each field is checked by the caller.
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

/** Prepaid unless the entry says otherwise: an entry written before modes existed was prepaid. */
function modeOf(value: unknown): LiveMode {
  return value === "invoiced" ? "invoiced" : "prepaid";
}
