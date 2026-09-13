import { InternalError } from "../errors.js";

/**
 * 16384 registers, so the standard error is 0.81%.
 *
 * The number is a billing decision. At the 50,000 free-tier boundary 0.81% is 400 users and
 * nothing is charged either way; at 1M MAU it is $20 a month on $2,375 of revenue, unbiased in
 * both directions. Halving it to p=13 doubles that, and doubling it to p=15 doubles a row that
 * `Retention.Years6` keeps for six years.
 */
const PRECISION = 14;
const REGISTERS = 1 << PRECISION;
const PRECISION_BITS = BigInt(PRECISION);

/** A register holds the leading zeros of 50 bits plus one, so 51 is the largest rank there is. */
const MAX_RANK = 64 - PRECISION + 1;

/**
 * Where the sparse form stops being the smaller one.
 *
 * A sparse entry is four bytes and a dense register is one, so 4096 entries is exactly the
 * 16 KiB the dense form costs. Almost every project is under it for almost every day, which is
 * what keeps a table six years of daily rows fit in.
 */
const SPARSE_LIMIT = REGISTERS / 4;

const FORMAT_VERSION = 1;
const MODE_SPARSE = 0;
const MODE_DENSE = 1;
const HEADER_BYTES = 4;
const SPARSE_ENTRY_BYTES = 4;

/** Flajolet's constant for m ≥ 128, with the small-m correction that stops mattering here. */
const ALPHA = 0.7213 / (1 + 1.079 / REGISTERS);

/** Below this the raw estimator is biased and linear counting is not (Flajolet 2007, §4). */
const LINEAR_COUNTING_BELOW = 2.5 * REGISTERS;

const MASK64 = 0xffffffffffffffffn;
const MURMUR_M = 0xc6a4a7935bd1e995n;
const MURMUR_R = 47n;

/** UTF-8 by hand, because `core` carries no Node types and no dependencies (PROJECT.md 8.3). */
function utf8Bytes(value: string): Uint8Array {
  const out: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) {
      out.push(point);
    } else if (point < 0x800) {
      out.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point < 0x10000) {
      out.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      out.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * MurmurHash64A, the hash Redis's own HyperLogLog uses.
 *
 * A sketch is only as uniform as its hash: a function that clusters does not merely lose
 * precision, it undercounts in one direction, which for us is an invoice that is wrong the same
 * way every month. This one is not cryptographic and does not need to be — nothing here is
 * secret, and what the sketch stores cannot be reversed to a user in any case.
 */
function hash64(value: string): bigint {
  const bytes = utf8Bytes(value);
  let h = (BigInt(bytes.length) * MURMUR_M) & MASK64;
  const blockEnd = bytes.length - (bytes.length % 8);
  for (let i = 0; i < blockEnd; i += 8) {
    let k = 0n;
    for (let j = 7; j >= 0; j -= 1) k = (k << 8n) | BigInt(bytes[i + j] ?? 0);
    k = (k * MURMUR_M) & MASK64;
    k ^= k >> MURMUR_R;
    k = (k * MURMUR_M) & MASK64;
    h = ((h ^ k) * MURMUR_M) & MASK64;
  }
  if (blockEnd < bytes.length) {
    let tail = 0n;
    for (let i = bytes.length - 1; i >= blockEnd; i -= 1)
      tail = (tail << 8n) | BigInt(bytes[i] ?? 0);
    h = ((h ^ tail) * MURMUR_M) & MASK64;
  }
  h ^= h >> MURMUR_R;
  h = (h * MURMUR_M) & MASK64;
  h ^= h >> MURMUR_R;
  return h;
}

/** n̂ = m·ln(m/zeros). Exact enough to be uninteresting while any register is still empty. */
function linearCounting(zeros: number): number {
  return REGISTERS * Math.log(REGISTERS / zeros);
}

function corrupt(reason: string): never {
  throw new InternalError({ detail: { entity: "hyperloglog", reason } });
}

/**
 * A HyperLogLog sketch, which is how monthly active users are counted without keeping who.
 *
 * Two properties at once, and both are why it is here rather than a distinct-user table. Billing
 * needs one number per project per month and a list of user ids is thousands of rows a day to
 * produce it. Privacy needs the same: the sketch cannot be reversed, cannot be asked whether a
 * given person was active, and so is not a record of anybody's behaviour to be handed over or
 * erased (PROJECT.md 4.13).
 *
 * It is mutable and accumulates, because that is what the two things holding one do: a meter adds
 * to today's, and a month's figure is the union of thirty of them. Union is a per-register maximum,
 * which is what makes every part of this idempotent — the same user added twice, the same day
 * merged twice, and a flush replayed after a crash all leave the same sketch.
 */
export class HyperLogLog {
  /** Dense once the sparse form stops paying for itself; exactly one of the two is in use. */
  private dense: Uint8Array | null;
  private readonly sparse: Map<number, number>;

  private constructor(dense: Uint8Array | null, sparse: Map<number, number>) {
    this.dense = dense;
    this.sparse = sparse;
  }

  static empty(): HyperLogLog {
    return new HyperLogLog(null, new Map());
  }

  /** From the bytes a `bytea` column holds. Anything else is a bug on our side, not the caller's. */
  static decode(bytes: Uint8Array): HyperLogLog {
    if (bytes.length < HEADER_BYTES) corrupt("shorter than the header");
    if (bytes[0] !== FORMAT_VERSION) corrupt(`unknown format version ${String(bytes[0])}`);
    if (bytes[1] !== PRECISION)
      corrupt(`precision ${String(bytes[1])} cannot be read at ${PRECISION}`);
    const body = bytes.subarray(HEADER_BYTES);
    if (bytes[2] === MODE_DENSE) {
      if (body.length !== REGISTERS) corrupt(`dense body is ${String(body.length)} bytes`);
      return new HyperLogLog(Uint8Array.from(body), new Map());
    }
    if (bytes[2] !== MODE_SPARSE) corrupt(`unknown mode ${String(bytes[2])}`);
    if (body.length % SPARSE_ENTRY_BYTES !== 0) corrupt("sparse body is not whole entries");
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const sparse = new Map<number, number>();
    for (let offset = 0; offset < body.length; offset += SPARSE_ENTRY_BYTES) {
      const entry = view.getUint32(offset, true);
      sparse.set(entry >>> 6, entry & 0x3f);
    }
    return new HyperLogLog(null, sparse);
  }

  /** The union of what was given, which is how a month is read out of its days. */
  static union(sketches: Iterable<HyperLogLog>): HyperLogLog {
    const merged = HyperLogLog.empty();
    for (const sketch of sketches) merged.mergeFrom(sketch);
    return merged;
  }

  /** Answers whether the sketch changed, which is the only cheap "probably new" signal there is. */
  add(value: string): boolean {
    const hashed = hash64(value);
    return this.observe(Number(hashed >> BigInt(64 - PRECISION)), HyperLogLog.rankOf(hashed));
  }

  /** Union in place. Answers whether anything moved, so a caller can skip a write that says nothing. */
  mergeFrom(other: HyperLogLog): boolean {
    let changed = false;
    if (other.dense === null) {
      for (const [index, rank] of other.sparse) changed = this.observe(index, rank) || changed;
      return changed;
    }
    for (let index = 0; index < REGISTERS; index += 1) {
      const rank = other.dense[index] ?? 0;
      if (rank !== 0) changed = this.observe(index, rank) || changed;
    }
    return changed;
  }

  get isEmpty(): boolean {
    return this.dense === null && this.sparse.size === 0;
  }

  /** The estimate, rounded. A count of people is a whole number even when the estimator is not. */
  get count(): number {
    if (this.dense === null) {
      if (this.sparse.size === 0) return 0;
      return Math.round(linearCounting(REGISTERS - this.sparse.size));
    }
    let harmonic = 0;
    let zeros = 0;
    for (let index = 0; index < REGISTERS; index += 1) {
      const rank = this.dense[index] ?? 0;
      harmonic += 2 ** -rank;
      if (rank === 0) zeros += 1;
    }
    const estimate = (ALPHA * REGISTERS * REGISTERS) / harmonic;
    if (estimate <= LINEAR_COUNTING_BELOW && zeros > 0) return Math.round(linearCounting(zeros));
    return Math.round(estimate);
  }

  /** The stored form. Sparse entries are sorted, so equal sketches encode to equal bytes. */
  encode(): Uint8Array {
    const dense = this.dense;
    const body = dense === null ? this.sparse.size * SPARSE_ENTRY_BYTES : REGISTERS;
    const out = new Uint8Array(HEADER_BYTES + body);
    out[0] = FORMAT_VERSION;
    out[1] = PRECISION;
    out[2] = dense === null ? MODE_SPARSE : MODE_DENSE;
    if (dense !== null) {
      out.set(dense, HEADER_BYTES);
      return out;
    }
    const view = new DataView(out.buffer);
    const indexes = [...this.sparse.keys()].sort((a, b) => a - b);
    indexes.forEach((index, position) => {
      const rank = this.sparse.get(index) ?? 0;
      view.setUint32(HEADER_BYTES + position * SPARSE_ENTRY_BYTES, (index << 6) | rank, true);
    });
    return out;
  }

  /** 1 plus the leading zeros of what the register index did not consume, capped at 51. */
  private static rankOf(hashed: bigint): number {
    const remaining = (hashed << PRECISION_BITS) & MASK64;
    if (remaining === 0n) return MAX_RANK;
    return 65 - remaining.toString(2).length;
  }

  /** A register only ever goes up. That is the whole reason a union is a maximum. */
  private observe(index: number, rank: number): boolean {
    const dense = this.dense;
    if (dense !== null) {
      if ((dense[index] ?? 0) >= rank) return false;
      dense[index] = rank;
      return true;
    }
    if ((this.sparse.get(index) ?? 0) >= rank) return false;
    this.sparse.set(index, rank);
    if (this.sparse.size > SPARSE_LIMIT) this.densify();
    return true;
  }

  private densify(): void {
    const dense = new Uint8Array(REGISTERS);
    for (const [index, rank] of this.sparse) dense[index] = rank;
    this.dense = dense;
    this.sparse.clear();
  }
}
