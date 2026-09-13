import "reflect-metadata";
import type { AppConfig } from "@idenzy/config/app-config";
import { type IdenzyError, isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { SystemClock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import { emailProviderFor } from "../dist/delivery/email-transport.js";
import { SilentLogger, testConfig } from "./fixtures.js";

const suppression = { assertSendable: () => Promise.resolve() };
const meter = { assertWithinQuota: () => Promise.resolve(), record: () => Promise.resolve() };

const SES = {
  AWS_REGION: "us-central1",
  AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
  AWS_SECRET_ACCESS_KEY: "secret",
  SES_CONFIGURATION_SET: "idenzy-default",
};

/** The real config class, so the test is against what a deployment actually parses. */
function configWith(overrides: Readonly<Record<string, string | undefined>>): AppConfig {
  const base = testConfig();
  return {
    get: (key: string) =>
      key in overrides
        ? overrides[key]
        : (base as unknown as { get: (k: string) => unknown }).get(key),
    isProduction: false,
  } as unknown as AppConfig;
}

const build = (overrides: Readonly<Record<string, string | undefined>>) =>
  emailProviderFor(
    suppression,
    meter,
    new SilentLogger(),
    configWith(overrides),
    new SystemClock(),
  );

describe("choosing an email transport", () => {
  it("uses SES when all four variables are set", () => {
    expect(build(SES).id).toBe("ses");
  });

  it("uses the development logger when none of them is set", () => {
    expect(build({}).id).toBe("logging");
  });

  /**
   * The case this function exists for. Three of four does not fail on its own — it falls
   * through to a logger that then refuses to construct outside development, and the
   * operator gets a crash about logging rather than about the variable they missed.
   */
  it.each(Object.keys(SES))("refuses when %s alone is missing, and names it", (missing) => {
    const partial = { ...SES, [missing]: undefined };

    const error = (() => {
      try {
        build(partial);
        return null;
      } catch (caught: unknown) {
        return caught;
      }
    })();

    expect(isIdenzyError(error)).toBe(true);
    expect(JSON.stringify((error as IdenzyError).detail)).toContain(missing);
  });
});
