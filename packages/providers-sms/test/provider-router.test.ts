import { Clock } from "@idenzy/core/time/clock";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type {
  Money,
  SendContext,
  SmsDispatchResult,
  SmsProvider,
} from "@idenzy/domain/ports/sms-provider";
import { describe, expect, it } from "vitest";
import { ProviderRouter } from "../src/provider-router.js";

class FixedClock extends Clock {
  private instant = new Date("2026-09-03T10:00:00.000Z");
  override now(): Date {
    return this.instant;
  }
  advance(seconds: number): void {
    this.instant = new Date(this.instant.getTime() + seconds * 1000);
  }
}

/** A provider that records what it was asked to send, and fails when told to. */
class Stub implements Pick<SmsProvider, "id" | "quoteCost" | "send"> {
  readonly sent: string[] = [];
  failing = false;

  constructor(readonly id: string) {}

  quoteCost(): Promise<Money> {
    return Promise.resolve({ amountMicros: 1_000, currency: "USD" });
  }

  send(_context: SendContext, _to: E164PhoneNumber, body: string): Promise<string> {
    if (this.failing) return Promise.reject(new Error(`${this.id} is down`));
    this.sent.push(body);
    return Promise.resolve(`${this.id}_1`);
  }

  dispatch(): Promise<SmsDispatchResult> {
    return Promise.resolve({ messageId: "unused" });
  }
}

const CONTEXT: SendContext = {
  projectId: "prj",
  requestId: "req",
  ip: null,
  attestation: null,
};
const TO = E164PhoneNumber.parse("+14155550123");

function router(clock: Clock, ...providers: Stub[]) {
  return new ProviderRouter(
    providers as unknown as SmsProvider[],
    [
      { country: "TR", providers: ["regional", "primary"] },
      { country: "*", providers: ["primary", "regional"] },
    ],
    clock,
    { failureThreshold: 2, cooldownSeconds: 60 },
  );
}

describe("routing a message", () => {
  it("prefers the provider a country's rule names first", () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    const regional = new Stub("regional");
    const subject = router(clock, primary, regional);

    expect(subject.select("TR").id).toBe("regional");
    expect(subject.select("US").id).toBe("primary");
  });

  it("falls back to the default rule for a country nobody listed", () => {
    const clock = new FixedClock();
    const subject = router(clock, new Stub("primary"), new Stub("regional"));
    expect(subject.select("JP").id).toBe("primary");
    expect(subject.select(null).id).toBe("primary");
  });

  /**
   * The behaviour the whole class exists for, and the one that is easy to get wrong by
   * making it a retry. A failed send stays failed for this request; the next request is
   * what goes somewhere else.
   */
  it("does not retry a failed send on another provider", async () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    const regional = new Stub("regional");
    primary.failing = true;
    const subject = router(clock, primary, regional);

    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow(/down/);
    expect(regional.sent).toEqual([]);
  });

  it("takes a provider out of rotation after consecutive failures", async () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    const regional = new Stub("regional");
    primary.failing = true;
    const subject = router(clock, primary, regional);

    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    expect(subject.select("US").id).toBe("primary");

    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    expect(subject.select("US").id).toBe("regional");
  });

  it("lets one request through to probe once the cooldown passes", async () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    primary.failing = true;
    const subject = router(clock, primary, new Stub("regional"));

    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    expect(subject.select("US").id).toBe("regional");

    clock.advance(61);
    expect(subject.select("US").id).toBe("primary");
  });

  it("clears the failure count on a success", async () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    const subject = router(clock, primary, new Stub("regional"));

    primary.failing = true;
    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    primary.failing = false;
    await subject.send(CONTEXT, TO, "code", "Idenzy", "US");
    primary.failing = true;
    await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();

    expect(subject.select("US").id).toBe("primary");
  });

  /**
   * Refusing beats routing to something known to be failing: the alternative loses the
   * message and reserves the spend anyway.
   */
  it("refuses when every provider for a country is in cooldown", async () => {
    const clock = new FixedClock();
    const primary = new Stub("primary");
    const regional = new Stub("regional");
    primary.failing = true;
    regional.failing = true;
    const subject = router(clock, primary, regional);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(subject.send(CONTEXT, TO, "code", "Idenzy", "US")).rejects.toThrow();
    }
    expect(() => subject.select("US")).toThrowError(/unavailable/i);
  });
});
