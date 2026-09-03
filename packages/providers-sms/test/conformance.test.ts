import { Logger } from "@idenzy/core/logging/logger";
import { E164PhoneNumber } from "@idenzy/core/value-objects/e164-phone-number";
import type { FraudGuard, SpendCap } from "@idenzy/domain/ports/sms-provider";
import { SmsProviderConformanceSuite } from "@idenzy/testing/sms-provider-conformance";
import { describe, expect, it } from "vitest";
import { LoggingSmsProvider } from "../src/logging-sms-provider.js";

class SilentLogger extends Logger {
  readonly lines: string[] = [];
  override debug(): void {}
  override info(message: string): void {
    this.lines.push(message);
  }
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

const allowing: FraudGuard = { assertAllowed: () => Promise.resolve() };
const unlimited: SpendCap = {
  reserve: () => Promise.resolve(),
  settle: () => Promise.resolve(),
};

describe("the development sms transport", () => {
  it("satisfies the sms provider family contract", async () => {
    const failures = await new SmsProviderConformanceSuite().run({
      name: "LoggingSmsProvider",
      subject: (fraudGuard, spendCap) =>
        new LoggingSmsProvider(fraudGuard, spendCap, new SilentLogger(), "development"),
    });
    expect(failures).toEqual([]);
  });

  /**
   * It writes phone numbers and one-time codes into the log message, which is the one
   * place the field allowlist cannot protect. That is only acceptable because it cannot
   * exist anywhere a real user does.
   */
  it("refuses to be constructed outside development", () => {
    for (const environment of ["staging", "production", ""]) {
      expect(
        () => new LoggingSmsProvider(allowing, unlimited, new SilentLogger(), environment),
        environment,
      ).toThrowError(/internal/i);
    }
  });

  it("prints the body so a developer can read the code out of it", async () => {
    const logger = new SilentLogger();
    const provider = new LoggingSmsProvider(allowing, unlimited, logger, "development");

    await provider.send(
      { projectId: "prj", requestId: "req", ip: null, attestation: null },
      E164PhoneNumber.parse("+14155550123"),
      "123456 is your Example code",
      "Example",
    );

    expect(logger.lines.join("\n")).toContain("123456 is your Example code");
    expect(logger.lines.join("\n")).toContain("+14155550123");
  });

  /**
   * A free development transport would leave the reservation arithmetic unexercised
   * everywhere it is developed, and the first real test of it would be against a
   * provider that charges.
   */
  it("quotes a real amount rather than nothing", async () => {
    const provider = new LoggingSmsProvider(allowing, unlimited, new SilentLogger(), "development");
    const cost = await provider.quoteCost(E164PhoneNumber.parse("+14155550123"));
    expect(cost.amountMicros).toBeGreaterThan(0);
    expect(cost.currency).toBe("USD");
  });
});
