import { ValidationFailedError } from "../errors/errors.js";
import { ValueObject } from "./value-object.js";

const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const MAX_LENGTH = 320;

/** A syntactically valid email, lowercased and NFKC-normalized on construction. */
export class EmailAddress extends ValueObject<string> {
  static parse(input: string): EmailAddress {
    const normalized = input.normalize("NFKC").trim().toLowerCase();
    if (normalized.length === 0 || normalized.length > MAX_LENGTH || !SHAPE.test(normalized)) {
      throw new ValidationFailedError({
        message: "That is not a valid email address.",
        fields: [{ path: "email", code: "invalid_email" }],
      });
    }
    return new EmailAddress(normalized);
  }

  get domain(): string {
    // Safe: parse() guarantees exactly one "@" with text on both sides.
    return this.value.slice(this.value.lastIndexOf("@") + 1);
  }
}
