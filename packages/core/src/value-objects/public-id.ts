import { ValidationFailedError } from "../errors.js";
import { ValueObject } from "./value-object.js";

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNDASHED = /^[0-9a-f]{32}$/;

/**
 * The public form of a database uuid: a prefix, an underscore, then the 32 hex digits.
 *
 * It is an encoding, not a lookup, so it round-trips without a query. The prefix is part
 * of the identity rather than decoration: a session id handed to something expecting a
 * user id fails to parse here instead of being used to address a different table.
 */
export class PublicId extends ValueObject<string> {
  private constructor(
    readonly prefix: string,
    private readonly hex: string,
  ) {
    super(`${prefix}_${hex}`);
  }

  /** From a uuid as Postgres returns it. */
  static encode(prefix: string, uuid: string): PublicId {
    const normalized = uuid.toLowerCase();
    if (!DASHED.test(normalized)) {
      throw new ValidationFailedError({
        message: "That identifier is not valid.",
        detail: { prefix, reason: "not a uuid" },
      });
    }
    return new PublicId(prefix, normalized.replaceAll("-", ""));
  }

  /** From the wire. Rejects a well-formed id carrying the wrong prefix. */
  static parse(prefix: string, input: string): PublicId {
    const [given, ...rest] = input.split("_");
    const hex = rest.join("_").toLowerCase();
    if (given !== prefix || !UNDASHED.test(hex)) {
      throw new ValidationFailedError({
        message: "That identifier is not valid.",
        detail: { expectedPrefix: prefix, reason: "malformed identifier" },
      });
    }
    return new PublicId(prefix, hex);
  }

  /** The dashed form, which is what every query and foreign key uses. */
  get uuid(): string {
    return [
      this.hex.slice(0, 8),
      this.hex.slice(8, 12),
      this.hex.slice(12, 16),
      this.hex.slice(16, 20),
      this.hex.slice(20),
    ].join("-");
  }
}
