import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import type { StreamCommands, StreamEntry, StreamRead } from "../src/ingest/stream-commands.js";

/** A log line as the tests read it back: the message and the fields that survived the allowlist. */
export interface CapturedLine {
  readonly level: "info" | "warn" | "error";
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export class CapturingLogger extends Logger {
  readonly lines: CapturedLine[] = [];

  override debug(): void {}
  override info(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.lines.push({ level: "info", message, fields });
  }
  override warn(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.lines.push({ level: "warn", message, fields });
  }
  override error(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.lines.push({ level: "error", message, fields });
  }
  override child(): Logger {
    return this;
  }

  of(message: string): CapturedLine | undefined {
    return this.lines.find((line) => line.message === message);
  }

  /** The most recent line with this message, for a pass that logs the same one each time. */
  lastOf(message: string): CapturedLine | undefined {
    return this.lines.findLast((line) => line.message === message);
  }
}

export class FixedClock extends Clock {
  constructor(private instant = new Date("2026-03-04T12:00:00Z")) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
  advance(ms: number): void {
    this.instant = new Date(this.instant.getTime() + ms);
  }
}

interface PendingEntry {
  readonly entry: StreamEntry;
  deliveries: number;
  claimedAt: number;
}

/**
 * Valkey streams in memory, to the depth this queue actually uses them.
 *
 * A fake rather than a container for the unit tests, because what they are asking about is the
 * worker's logic — when an entry is retried, when it is set aside, what a batch is acknowledged
 * as — and each of those is a decision the worker makes rather than a property of the server. The
 * integration suite runs the same paths against a real one, which is where the command shapes are
 * checked.
 */
export class InMemoryStreams implements StreamCommands {
  private readonly entries = new Map<string, StreamEntry[]>();
  private readonly pending = new Map<string, Map<string, PendingEntry>>();
  private readonly groups = new Set<string>();
  private sequence = 0;
  /** Set by a test to make the next `xadd` throw, which is the only failure a producer has. */
  failWrites = false;

  xadd(
    key: string,
    _strategy: "MAXLEN",
    _approximate: "~",
    _maxLen: number,
    _id: "*",
    ...fields: string[]
  ): Promise<string | null> {
    if (this.failWrites) return Promise.reject(new Error("valkey is unreachable"));
    this.sequence += 1;
    const id = `${String(this.sequence)}-0`;
    this.listFor(key).push([id, fields]);
    return Promise.resolve(id);
  }

  xgroup(_command: "CREATE", key: string, group: string): Promise<unknown> {
    const token = `${key}:${group}`;
    if (this.groups.has(token)) return Promise.reject(new Error("BUSYGROUP already exists"));
    this.groups.add(token);
    return Promise.resolve("OK");
  }

  xreadgroup(
    _groupToken: "GROUP",
    group: string,
    _consumer: string,
    _countToken: "COUNT",
    count: number,
    _streamsToken: "STREAMS",
    key: string,
    _id: ">",
  ): Promise<StreamRead[] | null> {
    const claimed = this.pendingFor(key, group);
    const fresh = this.listFor(key)
      .filter(([id]) => !claimed.has(id))
      .slice(0, count);
    for (const entry of fresh) {
      claimed.set(entry[0], { entry, deliveries: 1, claimedAt: this.sequence });
    }
    return Promise.resolve(fresh.length === 0 ? null : [[key, fresh]]);
  }

  xautoclaim(
    key: string,
    group: string,
    _consumer: string,
    minIdleMs: number,
    _start: string,
    _countToken: "COUNT",
    count: number,
  ): Promise<[string, StreamEntry[], string[]]> {
    // Idle time is not simulated: a test that wants a reclaim passes 0, and one that does not
    // passes a positive number and gets nothing, which is the only distinction the worker draws.
    if (minIdleMs > 0) return Promise.resolve(["0-0", [], []]);
    const claimed = [...this.pendingFor(key, group).values()].slice(0, count);
    for (const entry of claimed) entry.deliveries += 1;
    return Promise.resolve(["0-0", claimed.map((entry) => entry.entry), []]);
  }

  xack(key: string, group: string, ...ids: string[]): Promise<number> {
    const claimed = this.pendingFor(key, group);
    let removed = 0;
    for (const id of ids) if (claimed.delete(id)) removed += 1;
    return Promise.resolve(removed);
  }

  xdel(key: string, ...ids: string[]): Promise<number> {
    const list = this.listFor(key);
    const before = list.length;
    this.entries.set(
      key,
      list.filter(([id]) => !ids.includes(id)),
    );
    return Promise.resolve(before - this.listFor(key).length);
  }

  xlen(key: string): Promise<number> {
    return Promise.resolve(this.listFor(key).length);
  }

  xpending(
    key: string,
    group: string,
    _startToken: "IDLE",
    _minIdleMs: number,
    _start: string,
    _end: string,
    count: number,
  ): Promise<[string, string, number, number][]> {
    return Promise.resolve(
      [...this.pendingFor(key, group).entries()]
        .slice(0, count)
        .map(([id, entry]) => [id, "worker", 0, entry.deliveries]),
    );
  }

  /** What a test reads back to see where entries ended up. */
  contents(key: string): readonly StreamEntry[] {
    return this.listFor(key);
  }

  private listFor(key: string): StreamEntry[] {
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const created: StreamEntry[] = [];
    this.entries.set(key, created);
    return created;
  }

  private pendingFor(key: string, group: string): Map<string, PendingEntry> {
    const token = `${key}:${group}`;
    const existing = this.pending.get(token);
    if (existing !== undefined) return existing;
    const created = new Map<string, PendingEntry>();
    this.pending.set(token, created);
    return created;
  }
}
