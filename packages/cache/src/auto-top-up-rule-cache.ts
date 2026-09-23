/** The commands the cache needs. A real `Valkey` satisfies it structurally. */
export interface RuleCacheCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", milliseconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
}

/** Whether an organisation's rule is worth opening a transaction for. */
export interface CachedRule {
  /** Enabled and not suspended: the only state in which the rule could fire. */
  readonly armed: boolean;
}

/** Ten minutes. A rule edit drops the entry at once; this bounds a drop that was lost. */
export const RULE_CACHE_TTL_MS = 10 * 60 * 1000;

const PREFIX = "billing:auto-top-up:rule:";

/**
 * Each organisation's automatic top-up rule, cached so the worker can pass over the ones that
 * are switched off without reading Postgres (ADR-0017).
 *
 * Almost every organisation has no rule, and the worker is asked about each one every time its
 * balance moves. This turns that into one `GET`.
 *
 * **It may only ever make the worker do less, never more.** A cached "armed" sends the worker
 * to Postgres, where it takes the settings row lock and decides from what it reads there; a
 * cached "not armed" that is stale — an edit whose drop was lost — delays a top-up by at most
 * the TTL, and the worker's periodic pass reads Postgres directly and does not ask this at all.
 * So no charge anywhere rests on a value read from here.
 *
 * Reads answer null on anything unexpected, which the caller treats as a miss.
 */
export class AutoTopUpRuleCache {
  constructor(
    private readonly commands: RuleCacheCommands,
    private readonly ttlMs: number = RULE_CACHE_TTL_MS,
  ) {}

  async get(orgId: string): Promise<CachedRule | null> {
    const raw = await this.commands.get(PREFIX + orgId);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return null;
      const armed = (parsed as Record<string, unknown>)["armed"];
      return typeof armed === "boolean" ? { armed } : null;
    } catch {
      return null;
    }
  }

  async put(orgId: string, rule: CachedRule): Promise<void> {
    await this.commands.set(PREFIX + orgId, JSON.stringify(rule), "PX", this.ttlMs);
  }

  async drop(orgId: string): Promise<void> {
    await this.commands.del(PREFIX + orgId);
  }
}
