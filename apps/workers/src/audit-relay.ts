import { AUDIT_CHAIN_GENESIS, auditEntryHash } from "@idenzy/compliance/audit/hash-chain";
import type { Logger } from "@idenzy/core/logging/logger";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  AuditEventReader,
  NewAuditEntry,
  OutboxEvent,
} from "@idenzy/persistence/repository/audit-event-reader";
import type { RelayOffsetRepository } from "@idenzy/persistence/repository/relay-offset-repository";

/** The topic `OutboxFlowAudit` writes, and the only one this reads. */
export const AUDIT_TOPIC = "audit.recorded";

/** The consumer name this relay's watermark is stored under. */
export const AUDIT_CONSUMER = "audit-chain";

export interface AuditRelayOptions {
  /**
   * How often to sweep. Seconds rather than minutes: this is the only path an audit entry
   * takes, unlike the revocation reconciler, which is a backstop behind a synchronous
   * write. Anything slower is how long the trail lags reality.
   */
  readonly intervalMs?: number;
  /**
   * How far back to start when there is no watermark yet.
   *
   * A fresh deployment has no offset row, and reading the whole outbox from the beginning
   * would be a first sweep of unbounded size. A day is generous for a restart and short
   * enough to finish.
   */
  readonly coldStartLookbackMs?: number;
}

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_COLD_START_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the audit hash chain from the outbox (PROJECT.md 4.13.3).
 *
 * It exists because a hash chain has exactly one writer. Each entry links to its project's
 * current tip, so two requests that read the same tip would both claim it and the chain
 * would fork; serialising that on the request path would mean every sign-in for a busy
 * project queuing behind the one before it. Moving the write here costs a few seconds of
 * lag and buys a chain that cannot fork.
 *
 * It is idempotent by construction rather than by checking. The watermark is an exclusive
 * lower bound on `created_at`, so a restart re-reads whatever shares the last instant, and
 * an entry that is already in the trail is recognised by its own hash: the same event
 * against the same tip produces the same `entry_hash`, so replaying it is a no-op that the
 * chain does not notice.
 *
 * `audit_events` grants this connection INSERT and SELECT and nothing else, so a bug here
 * can add a wrong entry but cannot remove or alter a right one. That is the property the
 * trail is worth anything for, and it is a database grant rather than a promise.
 */
export class AuditRelay {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly events: AuditEventReader,
    private readonly offsets: RelayOffsetRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly options: AuditRelayOptions = {},
  ) {}

  /**
   * Sweeps once, then on a timer.
   *
   * The first sweep is awaited so a deployment that cannot read the outbox fails while
   * somebody is watching, rather than looking healthy and recording nothing.
   */
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

  /**
   * One pass: read what is new, chain it in order, move the watermark.
   *
   * The watermark advances only to the last event actually written. A pass that failed
   * halfway leaves it where the successful part ended, so the next one resumes rather than
   * either replaying everything or skipping the remainder.
   */
  async sweep(): Promise<number> {
    const since = (await this.offsets.read(AUDIT_CONSUMER)) ?? this.coldStart();
    const pending = await this.events.outboxSince(AUDIT_TOPIC, since);
    if (pending.length === 0) return 0;

    // One tip per project for the whole pass. Read once from the trail and advanced in
    // memory, because within a pass this is the only writer and a re-read per event would
    // be a query per sign-in.
    const tips = new Map<string, string>();
    let written = 0;
    let watermark = since;

    for (const event of pending) {
      try {
        const previous = tips.get(event.projectId) ?? (await this.tipFor(event.projectId));
        const entry = chainedEntry(event, previous);
        await this.events.append(entry);
        tips.set(event.projectId, entry.entryHash);
        watermark = event.createdAt;
        written += 1;
      } catch (error: unknown) {
        // Stop at the first failure rather than skipping past it. An entry the chain never
        // got is a gap, and carrying on would link the next one to a tip that is missing
        // the entry in between, which verifies as tampering rather than as a lost write.
        this.logger.error("audit relay could not append", {
          component: "audit-relay",
          outcome: "failed",
          projectId: event.projectId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        break;
      }
    }

    if (written > 0) await this.offsets.advance(AUDIT_CONSUMER, watermark);
    return written;
  }

  private async tipFor(projectId: string): Promise<string> {
    const tip = await this.events.tip(projectId);
    return tip?.entryHash ?? AUDIT_CHAIN_GENESIS;
  }

  private coldStart(): Date {
    return new Date(
      this.clock.nowMs() - (this.options.coldStartLookbackMs ?? DEFAULT_COLD_START_MS),
    );
  }
}

/**
 * One outbox event as a chained audit entry.
 *
 * `created_at` comes from the event and not from now, so the trail says when the thing
 * happened rather than when the relay noticed. It is also part of what is hashed, which is
 * what stops a replayed event producing a different entry from the one already there.
 */
function chainedEntry(event: OutboxEvent, previousHash: string): NewAuditEntry {
  const payload = event.payload;
  const digestInput = {
    projectId: event.projectId,
    actorType: readString(payload["actorType"]) ?? "user",
    actorId: readString(payload["actorId"]),
    action: readString(payload["action"]) ?? event.topic,
    target: readString(payload["target"]),
    createdAt: readInstant(payload["at"]) ?? event.createdAt,
    metadata: readRecord(payload["meta"]),
  };
  return {
    ...digestInput,
    ip: readString(payload["ip"]),
    ua: readString(payload["userAgent"]),
    prevHash: previousHash,
    entryHash: auditEntryHash(previousHash, digestInput),
  };
}

/**
 * Named `readString` rather than `text`, which is a Drizzle column builder: the GritQL
 * plugin that catches an undeclared column matches on that name, and a helper borrowing it
 * makes the check shout in a file that has no columns in it at all.
 *
 * The `ip` and `ua` columns are deliberately outside the digest.
 *
 * They are the two fields a data-subject erasure may pseudonymise (Art.17(3)(b) keeps the
 * entry, not necessarily the address), and a chain that hashed them would break the moment
 * a lawful erasure ran. What the chain protects is who did what to whom and when.
 */
function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInstant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
