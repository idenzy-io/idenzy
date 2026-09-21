import { describe, expect, it } from "vitest";
import { AppConfig } from "../src/app-config.js";
import {
  assertSecretsAreReferences,
  resolveSecretRefs,
  SecretSource,
} from "../src/secret-source.js";

/**
 * That secrets live in a store and the environment holds only pointers (PROJECT.md 6.2).
 *
 * `.env.example` has claimed this since it was written — "in staging and production these come
 * from Secret Manager" — and nothing implemented it, so every credential was a literal that worked
 * perfectly well where it sat. The check below is what makes the claim a control: without it the
 * store is optional, and an optional store is one hurried deploy away from being unused.
 */
class FakeStore extends SecretSource {
  readonly fetched: string[] = [];
  constructor(private readonly secrets: Record<string, string>) {
    super();
  }
  override fetch(name: string): Promise<string> {
    this.fetched.push(name);
    const value = this.secrets[name];
    if (value === undefined) return Promise.reject(new Error(`no such secret: ${name}`));
    return Promise.resolve(value);
  }
}

describe("resolving secret references", () => {
  it("replaces a reference with the value behind it", async () => {
    const store = new FakeStore({ "stripe-key": "sk_live_real" });
    const resolved = await resolveSecretRefs(
      { STRIPE_SECRET_KEY: "secret://stripe-key", LOG_LEVEL: "info" },
      store,
    );
    expect(resolved["STRIPE_SECRET_KEY"]).toBe("sk_live_real");
    // Untouched: only values carrying the scheme are pointers.
    expect(resolved["LOG_LEVEL"]).toBe("info");
  });

  it("fetches a secret once however many settings point at it", async () => {
    const store = new FakeStore({ shared: "value" });
    await resolveSecretRefs({ A: "secret://shared", B: "secret://shared" }, store);
    expect(store.fetched).toEqual(["shared"]);
  });

  /**
   * A configuration error that logged the credential it failed to load would have done more damage
   * than the outage it was reporting.
   */
  it("names the setting and the secret when a fetch fails, and nothing else", async () => {
    const store = new FakeStore({});
    const caught = await resolveSecretRefs({ STRIPE_SECRET_KEY: "secret://missing" }, store).then(
      () => null,
      (error: unknown) => error as { detail?: Record<string, unknown> },
    );
    expect(caught?.detail?.["setting"]).toBe("STRIPE_SECRET_KEY");
    expect(caught?.detail?.["secret"]).toBe("missing");
  });
});

describe("refusing a credential in the environment", () => {
  const PROD = "production";

  it("refuses a literal where a reference belongs", () => {
    expect(() =>
      assertSecretsAreReferences(PROD, { STRIPE_SECRET_KEY: "sk_live_actually_here" }),
    ).toThrowError();
  });

  /**
   * The one people forget. It has neither "key" nor "secret" in its name and carries a password in
   * its userinfo, which is why the sensitive list is declared rather than inferred from the name.
   */
  it("refuses a database url, which is a credential that does not look like one", () => {
    expect(() =>
      assertSecretsAreReferences(PROD, {
        DATABASE_URL: "postgresql://idenzy:hunter2@db.example.test/idenzy",
      }),
    ).toThrowError();
  });

  it("accepts references", () => {
    expect(() =>
      assertSecretsAreReferences(PROD, {
        DATABASE_URL: "secret://database-url",
        STRIPE_SECRET_KEY: "secret://stripe-key",
      }),
    ).not.toThrow();
  });

  it("names every offending setting at once, so a fix is one pass", () => {
    const caught = (() => {
      try {
        assertSecretsAreReferences(PROD, {
          STRIPE_SECRET_KEY: "sk_live_x",
          AWS_SECRET_ACCESS_KEY: "aws_x",
        });
        return null;
      } catch (error: unknown) {
        return error as { detail?: Record<string, unknown> };
      }
    })();
    expect(caught?.detail?.["settings"]).toEqual(["AWS_SECRET_ACCESS_KEY", "STRIPE_SECRET_KEY"]);
  });

  /**
   * And never the value itself. The whole error exists because a credential was somewhere it
   * should not be; putting it in the report would be the same mistake one layer along.
   */
  it("never puts the credential in the error", () => {
    const caught = (() => {
      try {
        assertSecretsAreReferences(PROD, { STRIPE_SECRET_KEY: "sk_live_do_not_leak" });
        return null;
      } catch (error: unknown) {
        return error;
      }
    })();
    expect(JSON.stringify(caught ?? {})).not.toContain("do_not_leak");
  });

  it("exempts development, because a laptop has no secret store", () => {
    expect(() =>
      assertSecretsAreReferences("development", { STRIPE_SECRET_KEY: "sk_test_local" }),
    ).not.toThrow();
  });

  it("ignores a setting that is not configured at all", () => {
    expect(() => assertSecretsAreReferences(PROD, { STRIPE_SECRET_KEY: "" })).not.toThrow();
  });
});

describe("loading configuration through a store", () => {
  const base = {
    IDENZY_ENV: "production",
    NODE_ENV: "production",
    PORT: "3000",
    CELL_CODE: "us1",
    KMS_KEY_RING: "ring",
    ISSUER_BASE_URL: "https://auth.idenzy.io",
    DASHBOARD_PROJECT_ID: "prj_00000000000040008000000000000002",
    VALKEY_URL: "secret://valkey-url",
    DATABASE_URL: "secret://database-url",
  };

  it("resolves before validating, so the schema still checks a real value", async () => {
    const store = new FakeStore({
      "database-url": "postgresql://u:p@localhost:5432/idenzy",
      "valkey-url": "redis://localhost:6379",
    });
    const config = await AppConfig.load(store, base);
    expect(config.get("DATABASE_URL")).toContain("postgresql://");
  });

  /**
   * Checked before the fetch, deliberately. A deployment holding a literal credential is refused
   * without a network call, so the finding is the literal rather than whether the store was up.
   */
  it("refuses a literal without ever asking the store", async () => {
    const store = new FakeStore({});
    await expect(
      AppConfig.load(store, { ...base, DATABASE_URL: "postgresql://u:p@localhost/idenzy" }),
    ).rejects.toThrowError();
    expect(store.fetched).toEqual([]);
  });
});
