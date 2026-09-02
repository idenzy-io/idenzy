import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";

/** A clock you move by hand, so expiry and TTL tests never sleep. */
export class FakeClock extends Clock {
  constructor(private instant: Date = new Date("2026-01-01T00:00:00Z")) {
    super();
  }

  override now(): Date {
    return this.instant;
  }

  advanceSeconds(seconds: number): void {
    this.instant = new Date(this.instant.getTime() + seconds * 1000);
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}

export interface CapturedLog {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/**
 * Captures log calls for assertion.
 *
 * Deliberately does NOT apply the field allowlist: tests assert on what code tried to
 * log, so a test can prove that a secret was never passed to the logger in the first
 * place, rather than only that the allowlist caught it.
 */
export class RecordingLogger extends Logger {
  readonly records: CapturedLog[] = [];

  override debug(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.records.push({ level: "debug", message, fields });
  }
  override info(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.records.push({ level: "info", message, fields });
  }
  override warn(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.records.push({ level: "warn", message, fields });
  }
  override error(message: string, fields: Readonly<Record<string, unknown>> = {}): void {
    this.records.push({ level: "error", message, fields });
  }
  override child(): Logger {
    return this;
  }

  /** True if any log call anywhere mentioned this value. Used to prove a secret never leaked. */
  mentions(value: string): boolean {
    return this.records.some(
      (r) => r.message.includes(value) || JSON.stringify(r.fields).includes(value),
    );
  }
}
