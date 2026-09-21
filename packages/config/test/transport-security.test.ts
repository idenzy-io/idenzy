import { describe, expect, it } from "vitest";
import { assertTransportSecurity } from "../src/transport-security.js";

/**
 * That a deployment cannot reach its data stores in clear text (PROJECT.md 4.11).
 *
 * Stage one is one high-end VPS running everything, so these connections are loopback and every
 * case below exempts them. The check is written now because `node-postgres` defaults to no TLS and
 * the day a store moves to its own host is the day that default matters — at which point a missing
 * query parameter is the whole difference between a private query and a public one.
 *
 * The failure it prevents has no symptom. A `DATABASE_URL` missing one query parameter connects
 * fine, queries fine, and puts every password hash and session token on the public internet in the
 * clear. Nothing logs it, nothing fails, nothing is slower.
 */
const PROD = "production";
const remote = (dsn: string) => [{ name: "DATABASE_URL", value: dsn }];

describe("reaching a store across a network", () => {
  it("refuses a Postgres DSN with no TLS at all", () => {
    expect(() =>
      assertTransportSecurity(PROD, remote("postgresql://u:p@db.example.test:5432/idenzy")),
    ).toThrowError();
  });

  /**
   * The trap, and the reason this is not a substring search for "ssl". `require` encrypts and does
   * not verify the certificate, so it defeats a passive listener and does nothing against anybody
   * who can answer in the server's place — which is the attack that matters when the target is an
   * IP address on the open internet.
   */
  it("refuses sslmode=require, which encrypts without checking who answered", () => {
    const caught = (() => {
      try {
        assertTransportSecurity(
          PROD,
          remote("postgresql://u:p@db.example.test:5432/idenzy?sslmode=require"),
        );
        return null;
      } catch (error: unknown) {
        return error as { detail?: Record<string, unknown> };
      }
    })();
    expect(caught).not.toBeNull();
    // The remedy lives in `detail`, which never leaves the process: the public message on an
    // InternalError is deliberately generic, so asserting on it would be asserting the wrong half.
    expect(String(caught?.detail?.["remedy"])).toContain("verify-full");
  });

  it("accepts verify-full and verify-ca", () => {
    for (const mode of ["verify-full", "verify-ca"]) {
      expect(() =>
        assertTransportSecurity(
          PROD,
          remote(`postgresql://u:p@db.example.test:5432/idenzy?sslmode=${mode}`),
        ),
      ).not.toThrow();
    }
  });

  it("refuses redis:// and http:// for the other two stores", () => {
    expect(() =>
      assertTransportSecurity(PROD, [{ name: "VALKEY_URL", value: "redis://cache.example.test" }]),
    ).toThrowError();
    expect(() =>
      assertTransportSecurity(PROD, [
        { name: "CLICKHOUSE_URL", value: "http://analytics.example.test:8123" },
      ]),
    ).toThrowError();
  });

  it("accepts rediss:// and https://", () => {
    expect(() =>
      assertTransportSecurity(PROD, [
        { name: "VALKEY_URL", value: "rediss://cache.example.test" },
        { name: "CLICKHOUSE_URL", value: "https://analytics.example.test:8443" },
      ]),
    ).not.toThrow();
  });

  it("names the setting and the host, because a boot failure has to be actionable", () => {
    const error = (() => {
      try {
        assertTransportSecurity(PROD, remote("postgresql://u:p@db.example.test:5432/idenzy"));
        return null;
      } catch (caught: unknown) {
        return caught as { detail?: Record<string, unknown> };
      }
    })();
    expect(error?.detail?.["setting"]).toBe("DATABASE_URL");
    expect(error?.detail?.["host"]).toBe("db.example.test");
  });
});

describe("what is exempt, and why", () => {
  it("exempts development entirely", () => {
    expect(() =>
      assertTransportSecurity("development", remote("postgresql://u:p@db.example.test/idenzy")),
    ).not.toThrow();
  });

  it("exempts loopback, because there is no network to listen on", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(() =>
        assertTransportSecurity(PROD, remote(`postgresql://u:p@${host}:5432/idenzy`)),
      ).not.toThrow();
    }
  });

  it("exempts a compose service name and a unix socket", () => {
    expect(() =>
      assertTransportSecurity(PROD, remote("postgresql://u:p@postgres:5432/idenzy")),
    ).not.toThrow();
    // Cloud SQL through the connector, where the proxy owns the TLS.
    expect(() =>
      assertTransportSecurity(
        PROD,
        remote("postgresql://u:p@/idenzy?host=/cloudsql/proj:region:inst"),
      ),
    ).not.toThrow();
  });

  it("ignores a store that is not configured at all", () => {
    expect(() =>
      assertTransportSecurity(PROD, [{ name: "CLICKHOUSE_URL", value: undefined }]),
    ).not.toThrow();
  });
});
