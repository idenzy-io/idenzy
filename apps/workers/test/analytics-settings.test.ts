import { AppConfig } from "@idenzy/config/app-config";
import { describe, expect, it } from "vitest";
import { analyticsSettingsFrom } from "../src/analytics-settings.js";

/**
 * The analytics identities' passwords: one each where it matters, one for all where it does not.
 *
 * Four identities behind one password are one identity. The reader cannot write, the writer cannot
 * read, the eraser can only delete — and all of that holds only until the one password leaks.
 */

const STORE = {
  ISSUER_BASE_URL: "https://auth.example.test",
  // Compose service names: no wire leaves the host, so transport security has nothing to check.
  DATABASE_URL: "postgres://idenzy_api:p@postgres:5432/idenzy",
  VALKEY_URL: "redis://valkey:6379",
  CLICKHOUSE_URL: "http://clickhouse:8123",
  CLICKHOUSE_DATABASE: "idenzy",
  CLICKHOUSE_USER: "idenzy_app",
  CLICKHOUSE_PASSWORD: "reader",
  CLICKHOUSE_INGEST_USER: "idenzy_ingest",
  CLICKHOUSE_OWNER_USER: "idenzy_owner",
  CLICKHOUSE_ERASER_USER: "idenzy_eraser",
};

const configFor = (env: Record<string, string>) => AppConfig.fromEnvironment(env);

describe("the analytics identities' passwords", () => {
  it("fall back to the shared one in development", () => {
    const settings = analyticsSettingsFrom(configFor({ ...STORE, IDENZY_ENV: "development" }));
    expect(settings?.passwords).toEqual({ ingest: "reader", owner: "reader", eraser: "reader" });
  });

  it("must each be set, and not be the reader's, anywhere else", () => {
    expect(() => analyticsSettingsFrom(configFor({ ...STORE, IDENZY_ENV: "staging" }))).toThrow();
    expect(() =>
      analyticsSettingsFrom(
        configFor({
          ...STORE,
          IDENZY_ENV: "staging",
          CLICKHOUSE_INGEST_PASSWORD: "writer",
          CLICKHOUSE_OWNER_PASSWORD: "owner",
          CLICKHOUSE_ERASER_PASSWORD: "reader",
        }),
      ),
    ).toThrow();
  });

  it("are used as given when each identity has its own", () => {
    const settings = analyticsSettingsFrom(
      configFor({
        ...STORE,
        IDENZY_ENV: "staging",
        CLICKHOUSE_INGEST_PASSWORD: "writer",
        CLICKHOUSE_OWNER_PASSWORD: "owner",
        CLICKHOUSE_ERASER_PASSWORD: "eraser",
      }),
    );
    expect(settings?.passwords).toEqual({ ingest: "writer", owner: "owner", eraser: "eraser" });
  });
});
