import { AppConfig } from "@idenzy/config/app-config";
import { Logger } from "@idenzy/core/logging/logger";

/**
 * A config parsed from a fixed environment rather than a hand-built object, so a test
 * exercises the same validation a boot does and a new required variable breaks here
 * before it breaks a deploy.
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
    ...overrides,
  });
}

export class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}
