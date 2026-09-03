import type { RevocationSet } from "@idenzy/cache/revocation-set";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { RevocationEvent } from "@idenzy/persistence/repository/revocation-event-reader";
import { IdPrefix } from "@idenzy/protocol/schemas/common";

/**
 * What one outbox event means to the set, before anything is written.
 *
 * Separated from the writing so the translation can be tested without a cache, and so the
 * two shapes stay visible: a sign-out-everywhere is one watermark and everything else is a
 * list of sessions.
 */
export type RevocationEffect =
  | { readonly kind: "sessions"; readonly sessionIds: readonly string[]; readonly at: Date }
  | { readonly kind: "user"; readonly userId: string; readonly at: Date };

/**
 * The one thing this reads, declared rather than taken as the concrete reader.
 *
 * `RevocationEventReader` holds a database handle, so depending on the class would mean a
 * test needed one. What this actually needs is a window of events from somewhere.
 */
export interface RevocationEventSource {
  since(since: Date): Promise<readonly RevocationEvent[]>;
}

export interface RevocationReconcilerOptions {
  /**
   * How far back to look, which is the set's own retention window.
   *
   * Anything older cannot still be published, so replaying it would write an entry that is
   * pruned in the same call.
   */
  readonly retentionSeconds: number;
  /**
   * How often to sweep. Slow on purpose: this is a backstop behind a synchronous write, not
   * the path a revocation normally takes, and every pass re-reads the whole window.
   */
  readonly intervalMs?: number;
}

/**
 * Replays revocations from the outbox into the cache (ADR-0009).
 *
 * The synchronous write in the auth API is the fast path and this is the durable one. It
 * exists for two failures that are not hypothetical.
 *
 * Valkey is a cache. A restart empties every project's set, and because the published
 * snapshot is served from that set, every customer polling it would be told that nothing is
 * revoked. Nothing in the request path would notice, because nothing in the request path
 * reads the set. This is what puts the window back.
 *
 * And a write that failed while Valkey was unreachable is a revocation that never arrived.
 * The publisher swallows that deliberately, because the revocation has already happened and
 * failing the caller would report an error for work that succeeded. This is what makes
 * swallowing it safe.
 *
 * Replaying is free because the set is keyed by the instant of the revocation rather than
 * the instant of the write, so re-applying an event lands on the entry it already wrote.
 */
export class RevocationReconciler {
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly events: RevocationEventSource,
    private readonly set: RevocationSet,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: RevocationReconcilerOptions,
  ) {
    this.intervalMs = options.intervalMs ?? 30_000;
  }

  /**
   * Sweeps once, then keeps sweeping.
   *
   * The first sweep is awaited so a process that has just started, which is the case where
   * the cache is most likely to be empty, has repopulated the window before it reports ready.
   */
  async start(): Promise<void> {
    await this.sweep();
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass over the window. Never throws: this runs on a timer, and an unhandled rejection
   * from a backstop would take the worker down and leave the thing it was backing unbacked.
   */
  async sweep(): Promise<void> {
    try {
      const since = new Date(this.clock.nowMs() - this.options.retentionSeconds * 1000);
      const events = await this.events.since(since);
      for (const event of events) {
        await this.apply(event);
      }
    } catch {
      this.logger.warn("could not replay revocations", {
        component: "revocation-reconciler",
        outcome: "sweep_failed",
      });
    }
  }

  private async apply(event: RevocationEvent): Promise<void> {
    const effect = effectOf(event);
    if (effect === null) return;
    if (effect.kind === "user") {
      await this.set.revokeUser(
        event.projectId,
        PublicId.encode(IdPrefix.User, effect.userId).value,
        effect.at,
      );
      return;
    }
    await this.set.revokeSessions(
      event.projectId,
      effect.sessionIds.map((id) => PublicId.encode(IdPrefix.Session, id).value),
      effect.at,
    );
  }
}

/**
 * The effect one event has, or null where it says nothing the set can act on.
 *
 * The payload is read defensively rather than trusted. These rows outlive the code that
 * wrote them, so a shape that changes leaves old rows behind, and a reconciler that threw on
 * one would stop replaying every event after it.
 */
export function effectOf(event: RevocationEvent): RevocationEffect | null {
  const at = instant(event.payload["at"]) ?? event.createdAt;

  if (event.topic === "security.refresh_token_reused") {
    const sessionId = event.payload["sessionId"];
    return typeof sessionId === "string" ? { kind: "sessions", sessionIds: [sessionId], at } : null;
  }
  if (event.topic !== "session.revoked") return null;

  // A sign-out-everywhere becomes one watermark rather than the list it ended, matching what
  // the auth API publishes for the same event. The two must agree, because a replay that
  // wrote a different shape would leave both in the set.
  const userId = event.payload["userId"];
  if (event.payload["scope"] === "all") {
    return typeof userId === "string" ? { kind: "user", userId, at } : null;
  }

  const sessionIds = event.payload["sessionIds"];
  if (!Array.isArray(sessionIds)) return null;
  const ids = sessionIds.filter((id): id is string => typeof id === "string");
  return ids.length === 0 ? null : { kind: "sessions", sessionIds: ids, at };
}

/** An ISO string if it is one, and null for anything else, including a shape we no longer write. */
function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
