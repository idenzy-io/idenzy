import { Logger } from "@idenzy/core/logging/logger";
import { Clock } from "@idenzy/core/time/clock";
import {
  EmailProvider,
  type OutboundEmail,
  type SuppressionList,
  type UsageMeter,
} from "@idenzy/domain/ports/email-provider";
import type { Channel } from "@idenzy/protocol/enums/delivery";

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

/**
 * An email transport that keeps every message instead of sending it.
 *
 * The point of a fake here is not avoiding the network: it is that a flow test can read
 * the one-time code out of the mail the flow actually rendered, rather than reaching
 * into the challenge table for a value the user would never see.
 *
 * It captures in `dispatch`, never by overriding `send`, so a message reaches `sent`
 * only if the suppression and quota checks let it through. A fake that skipped them
 * would let a flow test pass against a send that production would refuse.
 */
export class CapturingEmailProvider extends EmailProvider {
  override readonly id = "capturing";
  readonly sent: OutboundEmail[] = [];

  constructor(suppression: SuppressionList = new AllowAll(), meter: UsageMeter = new CountAll()) {
    super(suppression, meter);
  }

  /** The most recent message to an address, which is what a test almost always wants. */
  lastTo(to: string): OutboundEmail | null {
    return this.sent.findLast((message) => message.to === to) ?? null;
  }

  protected override dispatch(message: OutboundEmail): Promise<string> {
    this.sent.push(message);
    return Promise.resolve(`cap_${this.sent.length}`);
  }
}

/** Sends to anything. Pair with a real suppression list when that is the thing under test. */
export class AllowAll implements SuppressionList {
  assertSendable(): Promise<void> {
    return Promise.resolve();
  }
}

export class CountAll implements UsageMeter {
  readonly records: { projectId: string; channel: Channel }[] = [];
  assertWithinQuota(): Promise<void> {
    return Promise.resolve();
  }
  record(projectId: string, channel: Channel): Promise<void> {
    this.records.push({ projectId, channel });
    return Promise.resolve();
  }
}
