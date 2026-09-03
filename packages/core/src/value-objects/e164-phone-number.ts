import { ValidationFailedError } from "../errors.js";
import { ValueObject } from "./value-object.js";

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * An E.164 phone number.
 *
 * Strict by design: SMS is the one place a malformed value costs real money, and a
 * permissive parser here becomes a pumping vector (PROJECT.md 4.8).
 */
export class E164PhoneNumber extends ValueObject<string> {
  static parse(input: string): E164PhoneNumber {
    const compact = input.replace(/[\s\-().]/g, "");
    if (!E164.test(compact)) {
      throw new ValidationFailedError({
        message: "Phone numbers must be in E.164 format, for example +14155550123.",
        fields: [{ path: "phone", code: "invalid_phone" }],
      });
    }
    return new E164PhoneNumber(compact);
  }

  /** Leading digits only. The caller maps these to a country for routing and allowlists. */
  get callingCodeDigits(): string {
    return this.value.slice(1, 4);
  }
}
