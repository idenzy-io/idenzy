import { randomBytes } from "node:crypto";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { provisionPlatform } from "@idenzy/persistence/platform";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A new deployment's own projects, against a real Postgres, as the runtime role.
 *
 * Run twice on purpose: a bootstrap an operator re-runs after a half-finished first attempt must
 * find what is there and add nothing, and above all must not mint a second key.
 */

const harness = new PostgresHarness();
const encryptor = new FieldEncryptor(randomBytes(32));
const options = {
  dashboardOrigin: "https://app.idenzy.test",
  dashboardAuthDomain: "auth.idenzy.test",
  operatorOrigin: "https://console.idenzy.test",
  operatorGoogle: { clientId: "google-client", clientSecret: "google-secret" },
  encryptor,
};

beforeAll(async () => {
  await harness.start();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("provisioning the platform", () => {
  it("makes the organisation, both projects, their origins and a key each", async () => {
    const made = await provisionPlatform(harness.db, options);
    expect(made.publishableKeys.dashboard).toMatch(/^pk_/);
    expect(made.publishableKeys.operator).toMatch(/^pk_/);

    const origins = await harness.owner.query(
      `SELECT project_id, origin FROM project_origins ORDER BY origin`,
    );
    expect(origins.rows).toEqual([
      { project_id: made.dashboardProjectId, origin: "https://app.idenzy.test" },
      { project_id: made.operatorProjectId, origin: "https://console.idenzy.test" },
    ]);
    const domains = await harness.owner.query(
      `SELECT project_id, domain, type, status FROM project_domains`,
    );
    expect(domains.rows).toEqual([
      {
        project_id: made.dashboardProjectId,
        domain: "auth.idenzy.test",
        type: "auth",
        status: "verified",
      },
    ]);

    // The Google secret is stored the way the management API stores one: encrypted to the project.
    const google = await harness.owner.query(
      `SELECT client_id, client_secret_encrypted FROM oauth_providers WHERE project_id = $1`,
      [made.operatorProjectId],
    );
    expect(google.rows[0]?.client_id).toBe("google-client");
    expect(encryptor.decrypt(google.rows[0]?.client_secret_encrypted, made.operatorProjectId)).toBe(
      "google-secret",
    );
  });

  it("finds everything on a second run, and mints no second key", async () => {
    const before = await harness.owner.query(`SELECT count(*) AS n FROM api_keys`);
    const again = await provisionPlatform(harness.db, options);
    expect(again.done.filter((line) => !line.startsWith("operator console"))).toEqual([]);
    expect(again.publishableKeys).toEqual({});
    const after = await harness.owner.query(`SELECT count(*) AS n FROM api_keys`);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    const orgs = await harness.owner.query(`SELECT count(*) AS n FROM orgs`);
    expect(Number(orgs.rows[0]?.n)).toBe(1);
  });
});
