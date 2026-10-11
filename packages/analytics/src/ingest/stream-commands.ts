/** One entry as Valkey returns it: an id and a flat field/value list. */
export type StreamEntry = [id: string, fields: string[]];

/** What `XREADGROUP` and `XAUTOCLAIM` hand back, per stream. */
export type StreamRead = [stream: string, entries: StreamEntry[]];

/**
 * The Valkey commands the ingest queue needs, declared rather than taken from the whole driver.
 *
 * A real `Valkey` satisfies it structurally and a test implements six methods instead of several
 * hundred. It also states the dependency honestly: this is one stream per table, a consumer group
 * on each, and a second stream for what could not be delivered — not an open connection to do
 * anything with.
 *
 * A stream rather than a list, and that is the decision this interface encodes. `LPOP` hands a
 * batch over and forgets it, so a worker that dies between popping and inserting loses everything
 * it was holding with nothing to find it by. A consumer group keeps an entry pending until it is
 * acknowledged, and `XAUTOCLAIM` is how another worker picks up what a dead one was carrying —
 * which is the difference between at-least-once and best-effort.
 */
export interface StreamCommands {
  /** Appends an entry, trimming to roughly `maxLen` so a stalled worker cannot exhaust memory. */
  xadd(
    key: string,
    maxLenStrategy: "MAXLEN",
    approximate: "~",
    maxLen: number,
    id: "*",
    ...fields: string[]
  ): Promise<string | null>;

  xgroup(
    command: "CREATE",
    key: string,
    group: string,
    id: "0",
    mkStream: "MKSTREAM",
  ): Promise<unknown>;

  xreadgroup(
    groupToken: "GROUP",
    group: string,
    consumer: string,
    countToken: "COUNT",
    count: number,
    streamsToken: "STREAMS",
    key: string,
    id: ">",
  ): Promise<StreamRead[] | null>;

  /** Re-delivers entries a consumer took and never acknowledged, oldest first. */
  xautoclaim(
    key: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    start: string,
    countToken: "COUNT",
    count: number,
  ): Promise<[nextStart: string, entries: StreamEntry[], deleted: string[]]>;

  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  xdel(key: string, ...ids: string[]): Promise<number>;
  xlen(key: string): Promise<number>;

  /** The oldest entries first, which is how far behind a stream is. */
  xrange(
    key: string,
    start: "-",
    end: "+",
    countToken: "COUNT",
    count: number,
  ): Promise<StreamEntry[]>;

  /** Delivery counts, which is the retry counter this gets for free. */
  xpending(
    key: string,
    group: string,
    startToken: "IDLE",
    minIdleMs: number,
    start: string,
    end: string,
    count: number,
  ): Promise<[id: string, consumer: string, idleMs: number, deliveries: number][]>;
}
