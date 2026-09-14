import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";

/**
 * A config parsed from a fixed environment rather than a hand-built object, so a test
 * exercises the same validation a boot does and a new required variable breaks here before
 * it breaks a deploy.
 *
 * `DASHBOARD_PROJECT_ID` is present because `TenancyModule` refuses to start without it:
 * this service verifies dashboard tokens against our own project, and a deployment that
 * did not know which project that is would accept tokens minted for a customer's.
 */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return AppConfig.fromEnvironment({
    IDENZY_ENV: "development",
    NODE_ENV: "test",
    DATABASE_URL: "postgres://idenzy@localhost:5432/idenzy",
    VALKEY_URL: "redis://localhost:6379",
    CELL_CODE: "eu-1",
    KMS_KEY_RING: "test-ring",
    ISSUER_BASE_URL: "https://auth.example.test",
    DASHBOARD_PROJECT_ID: "prj_00000000000040008000000000000002",
    ...overrides,
  });
}

/** Says nothing. A test asserting on behaviour should not be reading log lines. */
export class SilentLogger extends Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  override child(): Logger {
    return this;
  }
}
