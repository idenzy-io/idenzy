import { Logger } from "@idenzy/core/logging/logger";
import { EmailProviderConformanceSuite } from "@idenzy/testing/email-provider-conformance";
import { describe, expect, it } from "vitest";
import { LoggingEmailProvider } from "../src/logging-email-provider.js";

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

describe("the development transport", () => {
  it("satisfies the email provider family contract", async () => {
    const failures = await new EmailProviderConformanceSuite().run({
      name: "LoggingEmailProvider",
      subject: (suppression, meter) =>
        new LoggingEmailProvider(suppression, meter, new SilentLogger(), "development"),
    });
    expect(failures).toEqual([]);
  });

  /**
   * It writes recipient addresses and one-time codes into the log message, which is the
   * one place the field allowlist cannot protect. That is only acceptable because it
   * cannot exist anywhere a real user does.
   */
  it("refuses to be constructed outside development", () => {
    for (const environment of ["staging", "production", ""]) {
      expect(
        () =>
          new LoggingEmailProvider(
            { assertSendable: () => Promise.resolve() },
            { assertWithinQuota: () => Promise.resolve(), record: () => Promise.resolve() },
            new SilentLogger(),
            environment,
          ),
        environment,
      ).toThrowError(/internal/i);
    }
  });

  it("prints the text body so a developer can read the code out of it", async () => {
    const logger = new SilentLogger();
    const provider = new LoggingEmailProvider(
      { assertSendable: () => Promise.resolve() },
      { assertWithinQuota: () => Promise.resolve(), record: () => Promise.resolve() },
      logger,
      "development",
    );
    await provider.send("prj", {
      to: "dev@local.test",
      from: "no-reply@local.test",
      subject: "123456 is your code",
      html: "<p>123456</p>",
      text: "Your code is 123456.",
    });
    expect(logger.lines.join("\n")).toContain("Your code is 123456.");
    expect(logger.lines.join("\n")).toContain("dev@local.test");
  });
});
