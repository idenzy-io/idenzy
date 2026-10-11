import { describe, expect, it } from "vitest";
import { InternalError } from "../src/errors.js";
import { HyperLogLog } from "../src/metering/hyper-log-log.js";

/** Shaped like what the meter actually adds, so the hash is tested on the input it will see. */
function userId(n: number): string {
  return `usr_${n.toString(16).padStart(32, "0")}`;
}

function sketchOf(from: number, to: number): HyperLogLog {
  const sketch = HyperLogLog.empty();
  for (let n = from; n < to; n += 1) sketch.add(userId(n));
  return sketch;
}

/**
 * A paying project's month, built once. Two hundred thousand adds take a third of a second on a
 * laptop and many seconds on a shared CI runner that is also building and testing every other
 * package, so the tests that need it share one rather than each building its own.
 */
let month: HyperLogLog | undefined;
function denseMonth(): HyperLogLog {
  month ??= sketchOf(0, 200_000);
  return month;
}

/** For the tests that build dense sketches: generous, because a CI runner's speed is not ours. */
const HEAVY = { timeout: 30_000 };

/** The published standard error is 0.81%; the assertions allow three of those. */
function expectWithinErrorOf(sketch: HyperLogLog, truth: number): void {
  expect(Math.abs(sketch.count - truth) / truth).toBeLessThan(0.025);
}

describe("HyperLogLog", () => {
  it("counts nothing as nothing", () => {
    expect(HyperLogLog.empty().count).toBe(0);
    expect(HyperLogLog.empty().isEmpty).toBe(true);
  });

  it("is exact while the sketch is small, which is most projects on most days", () => {
    expect(sketchOf(0, 1).count).toBe(1);
    expect(sketchOf(0, 100).count).toBe(100);
  });

  it("says whether a value was new, which is the signal a meter skips a write on", () => {
    const sketch = HyperLogLog.empty();
    expect(sketch.add(userId(1))).toBe(true);
    expect(sketch.add(userId(1))).toBe(false);
  });

  it("estimates a small population from the sparse form", () => {
    expectWithinErrorOf(sketchOf(0, 2_000), 2_000);
  });

  it("estimates a paying project's month from the dense form", HEAVY, () => {
    expectWithinErrorOf(denseMonth(), 200_000);
  });

  it("keeps the sparse form under 16 KiB and the dense form at exactly it", HEAVY, () => {
    expect(sketchOf(0, 200).encode()).toHaveLength(4 + 200 * 4);
    expect(denseMonth().encode()).toHaveLength(4 + 16_384);
  });

  it("round-trips through the bytes a column holds, sparse and dense alike", HEAVY, () => {
    for (const sketch of [sketchOf(0, 500), denseMonth()]) {
      expect(HyperLogLog.decode(sketch.encode()).count).toBe(sketch.count);
    }
  });

  it("encodes equal sketches to equal bytes whatever order they were filled in", () => {
    const forwards = HyperLogLog.empty();
    const backwards = HyperLogLog.empty();
    for (let n = 0; n < 300; n += 1) forwards.add(userId(n));
    for (let n = 299; n >= 0; n -= 1) backwards.add(userId(n));
    expect([...forwards.encode()]).toEqual([...backwards.encode()]);
  });

  it("unions two days into the month they belong to", HEAVY, () => {
    expectWithinErrorOf(
      HyperLogLog.union([sketchOf(0, 60_000), sketchOf(40_000, 100_000)]),
      100_000,
    );
  });

  it("unions a sparse day into a dense month and back the other way", HEAVY, () => {
    const dense = sketchOf(0, 60_000);
    dense.mergeFrom(sketchOf(60_000, 60_100));
    expectWithinErrorOf(dense, 60_100);

    const sparse = sketchOf(60_000, 60_100);
    sparse.mergeFrom(sketchOf(0, 60_000));
    expectWithinErrorOf(sparse, 60_100);
  });

  it("is idempotent, because a replayed flush must not inflate a bill", () => {
    const sketch = sketchOf(0, 5_000);
    const before = sketch.count;
    expect(sketch.mergeFrom(sketchOf(0, 5_000))).toBe(false);
    expect(sketch.count).toBe(before);
  });

  it("refuses bytes it did not write rather than reporting a wrong number", () => {
    const valid = sketchOf(0, 10).encode();
    expect(() => HyperLogLog.decode(valid.subarray(0, 2))).toThrow(InternalError);
    expect(() => HyperLogLog.decode(Uint8Array.of(2, 14, 0, 0))).toThrow(InternalError);
    expect(() => HyperLogLog.decode(Uint8Array.of(1, 12, 0, 0))).toThrow(InternalError);
    expect(() => HyperLogLog.decode(Uint8Array.of(1, 14, 1, 0, 7))).toThrow(InternalError);
    expect(() => HyperLogLog.decode(Uint8Array.of(1, 14, 0, 0, 7))).toThrow(InternalError);
  });
});
