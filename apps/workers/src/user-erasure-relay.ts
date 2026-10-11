import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type { OutboxEvent } from "@idenzy/persistence/repository/audit-event-reader";
import type { ErasedUser } from "@idenzy/persistence/repository/erased-user-copies";

/** The event the erasure writes, and which this relay follows. */
export const ERASURE_TOPIC = "user.deleted";

/** Reads the outbox from a position. `AuditEventReader` is the one that exists. */
export interface ErasureEvents {
  outboxSince(topic: string, sinceSeq: number): Promise<readonly OutboxEvent[]>;
}

export interface ErasureOffsets {
  read(consumer: string): Promise<number | null>;
  advance(consumer: string, position: number): Promise<void>;
}

/**
 * One place an erased user's data was copied to, and how to remove it from there.
 *
 * Each target keeps its own position, so a store that is down holds back its own erasures and
 * nobody else's: the analytics store being unreachable for an hour must not leave webhook payloads
 * holding an address for that hour too.
 */
export interface ErasureTarget {
  /** Its position in `relay_offsets`. */
  readonly consumer: string;
  /**
   * The instant before which everything about a user has landed where this target can reach it.
   *
   * An erasure is acted on only once it is older than this, because a copy still on its way —
   * an event queued for ingestion, a delivery being fanned out — would otherwise arrive after
   * the erasure and outlive it.
   */
  settledBefore(): Promise<Date>;
  erase(users: readonly ErasedUser[]): Promise<void>;
}

export interface UserErasureRelayOptions {
  readonly intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Finishes an erasure in the places the API's transaction cannot reach (PROJECT.md 4.13.6).
 *
 * `erase_user` removes what the account is, at once. What it leaves are copies other parts of the
 * system made on their way through: outbox events and webhook deliveries that carry an address,
 * and analytics rows keyed on the user. This follows `user.deleted` and removes those, in
 * batches, a little after the fact on purpose — see `ErasureTarget.settledBefore`.
 *
 * Idempotent end to end. Stripping a payload twice leaves it stripped and deleting rows twice
 * deletes nothing the second time, so the position advances only after a batch succeeds and a
 * crash in between repeats work rather than skipping it. With no stored position it starts from
 * the beginning of the outbox, because erasures are rare and repeating them is free.
 */
export class UserErasureRelay {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly events: ErasureEvents,
    private readonly offsets: ErasureOffsets,
    private readonly targets: readonly ErasureTarget[],
    private readonly logger: Logger,
    private readonly options: UserErasureRelayOptions = {},
  ) {}

  async start(): Promise<void> {
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass over every target. Answers how many erasures were carried out, across targets. */
  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let done = 0;
      for (const target of this.targets) done += await this.pass(target);
      return done;
    } finally {
      this.running = false;
    }
  }

  private async pass(target: ErasureTarget): Promise<number> {
    try {
      const since = (await this.offsets.read(target.consumer)) ?? 0;
      const pending = await this.events.outboxSince(ERASURE_TOPIC, since);
      if (pending.length === 0) return 0;

      const horizon = (await target.settledBefore()).getTime();
      // A prefix in sequence order, never a filter: the position can only move past what is done.
      const ready: OutboxEvent[] = [];
      for (const event of pending) {
        if (event.createdAt.getTime() > horizon) break;
        ready.push(event);
      }
      const last = ready.at(-1);
      if (last === undefined) return 0;

      await target.erase(ready.flatMap(erasedUserOf));
      await this.offsets.advance(target.consumer, last.seq);
      this.logger.info("erasure carried out", {
        component: "user-erasure",
        consumer: target.consumer,
        outcome: "erased",
        count: ready.length,
      });
      return ready.length;
    } catch (error: unknown) {
      // Not advanced, so the next pass tries the same batch again.
      this.logger.error("erasure deferred", {
        component: "user-erasure",
        consumer: target.consumer,
        outcome: "deferred",
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}

/** The user an event names, or nothing for one that names nobody the way we wrote it. */
function erasedUserOf(event: OutboxEvent): ErasedUser[] {
  const userId = event.payload["userId"];
  return typeof userId === "string" && userId.length > 0
    ? [{ projectId: event.projectId, userId }]
    : [];
}

/**
 * The messaging target: outbox events and webhook deliveries.
 *
 * Settled a minute after the erasure. The webhook relay turns an event into deliveries within
 * seconds, and a transaction that wrote an event about this user just before the erasure has
 * committed by then; stripping earlier could miss a delivery fanned out from an event read a
 * moment before it was stripped.
 */
export function messagingTarget(
  strip: (users: readonly ErasedUser[]) => Promise<unknown>,
  clock: Clock,
  settleMs = 60_000,
): ErasureTarget {
  return {
    consumer: "user-erasure:messages",
    settledBefore: () => Promise.resolve(new Date(clock.nowMs() - settleMs)),
    erase: async (users) => {
      await strip(users);
    },
  };
}

/**
 * The analytics target: ClickHouse rows keyed on the user.
 *
 * Settled once the ingest queue holds nothing queued before the erasure, with a margin for an
 * event about a request still in flight when it committed. While ingestion is behind — or down —
 * erasures wait for it rather than deleting ahead of rows that will then arrive.
 */
export function analyticsTarget(
  oldestQueuedAt: () => Promise<Date | null>,
  erase: (users: readonly ErasedUser[]) => Promise<void>,
  clock: Clock,
  settleMs = 60_000,
): ErasureTarget {
  return {
    consumer: "user-erasure:analytics",
    settledBefore: async () => {
      const oldest = await oldestQueuedAt();
      const reached = oldest === null ? clock.nowMs() : Math.min(oldest.getTime(), clock.nowMs());
      return new Date(reached - settleMs);
    },
    erase,
  };
}
