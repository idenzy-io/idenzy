import { randomBytes } from "node:crypto";
import { LocalKeyEncryption } from "@idenzy/crypto/kms/local-key-encryption";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSigningKeyStore } from "../dist/crypto/database-signing-key-store.js";

/**
 * Projects' signing keys in Postgres (ADR-0021).
 *
 * The parts a fake cannot answer: that the first key is made once even when several requests ask
 * for it at the same moment (the partial unique index settles it, not a lock), and that a project
 * that does not exist never gets as far as a key being generated and wrapped, which is a KMS call
 * a stranger could otherwise make us pay for from a public route.
 */

const harness = new PostgresHarness();
const ORG = "44444444-4444-4444-4444-444444444444";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const NOWHERE = "99999999-9999-4999-8999-999999999999";

/** Counts wraps, which is what a KMS call would be. */
class CountingEnvelope extends LocalKeyEncryption {
  wraps = 0;
  override wrap(plaintext: Uint8Array, context: string): Promise<Uint8Array> {
    this.wraps += 1;
    return super.wrap(plaintext, context);
  }
}

let store: DatabaseSigningKeyStore;
let envelope: CountingEnvelope;

beforeAll(async () => {
  await harness.start();
  envelope = new CountingEnvelope(randomBytes(32));
  store = new DatabaseSigningKeyStore(new UnitOfWork(harness.db), envelope);
  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
    [PROJECT, ORG],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("a project's first signing key", () => {
  it("is made once, however many ask for it at the same moment", async () => {
    const keys = await Promise.all([0, 1, 2, 3, 4].map(() => store.primary(PROJECT)));
    expect(new Set(keys.map((key) => key.kid)).size).toBe(1);

    const rows = await harness.owner.query(
      `SELECT kid, is_primary FROM project_signing_keys WHERE project_id = $1`,
      [PROJECT],
    );
    expect(rows.rows.filter((row) => row.is_primary)).toHaveLength(1);
  });

  it("is stored wrapped, and published as its public half", async () => {
    const [published] = await store.publishable(PROJECT);
    const primary = await store.primary(PROJECT);
    expect(published).toEqual(primary.publicJwk);
    expect(published).not.toHaveProperty("d");
    // The stored private key is ciphertext, not a PKCS#8 structure anybody could load.
    expect(
      Buffer.from(primary.privateKeyWrapped, "base64").subarray(0, 2).toString("hex"),
    ).not.toBe("3081");
  });

  it("is never generated for a project that does not exist", async () => {
    const before = envelope.wraps;
    await expect(store.publishable(NOWHERE)).rejects.toMatchObject({ code: "not_found" });
    expect(envelope.wraps).toBe(before);
  });
});
