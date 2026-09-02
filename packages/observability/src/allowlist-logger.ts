import { Logger } from "@idenzy/core/logging/logger";
import type { Logger as PinoLogger } from "pino";

/**
 * Pino behind the Logger port, with field allowlisting (PROJECT.md 4.13.8).
 *
 * Undeclared fields are dropped before they reach the transport. This is an allowlist
 * rather than a redaction blocklist because a blocklist fails silently the day someone
 * adds a column, and "no PHI in logs" is a hard HIPAA requirement rather than a
 * best-effort one.
 *
 * The allowlist comes from the schema classification, so a column marked pii, phi or
 * secret is structurally unloggable.
 */
export class AllowlistLogger extends Logger {
  constructor(
    private readonly pino: PinoLogger,
    private readonly allowed: ReadonlySet<string>,
  ) {
    super();
  }

  override debug(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.pino.debug(this.filter(fields), message);
  }

  override info(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.pino.info(this.filter(fields), message);
  }

  override warn(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.pino.warn(this.filter(fields), message);
  }

  override error(message: string, fields?: Readonly<Record<string, unknown>>): void {
    this.pino.error(this.filter(fields), message);
  }

  override child(bindings: Readonly<Record<string, unknown>>): Logger {
    return new AllowlistLogger(this.pino.child(this.filter(bindings)), this.allowed);
  }

  /**
   * Drops undeclared keys and counts them, so a dropped field is visible as a number
   * rather than vanishing silently. Seeing that count climb is how you find code trying
   * to log something it should not.
   */
  private filter(fields?: Readonly<Record<string, unknown>>): Record<string, unknown> {
    if (fields === undefined) return {};
    const kept: Record<string, unknown> = {};
    let dropped = 0;
    for (const [key, value] of Object.entries(fields)) {
      if (this.allowed.has(key)) {
        kept[key] = value;
      } else {
        dropped += 1;
      }
    }
    if (dropped > 0) kept["droppedFields"] = dropped;
    return kept;
  }
}
