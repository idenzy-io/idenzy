import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/app-config.js";

const REQUIRED = {
  IDENZY_ENV: "development",
  DATABASE_URL: "postgres://idenzy:idenzy@localhost:5432/idenzy",
  VALKEY_URL: "redis://localhost:6379",
  ISSUER_BASE_URL: "http://localhost:3001",
};

describe("reading the environment", () => {
  it("treats an empty optional variable as not set", () => {
    const config = AppConfig.fromEnvironment({ ...REQUIRED, CLICKHOUSE_URL: "" });
    expect(config.get("CLICKHOUSE_URL")).toBeUndefined();
  });

  it("still refuses a required variable left empty", () => {
    expect(() => AppConfig.fromEnvironment({ ...REQUIRED, DATABASE_URL: "" })).toThrow();
  });
});
