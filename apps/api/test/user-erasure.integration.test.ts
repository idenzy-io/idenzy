import { createHash } from "node:crypto";
import { SystemClock } from "@idenzy/core/time/clock";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { UserErasureService } from "../dist/erasure/user-erasure-service.js";
import { type InMemoryRevocationCommands, testRevocations } from "./fixtures.js";

/**
 * An erasure against a real Postgres, with every table that can hold something of the user
 * filled first.
 *
 * The SQL function is checked against the classification in `user-erasure.test.ts`, which proves
 * it names the right columns. This proves the statements do what they name: that a row is gone
 * or cleared, that nothing of a neighbour's is, and that the four records of the erasure are
 * written beside it.
 */

const harness = new PostgresHarness();
const ORG = "44444444-4444-4444-4444-444444444444";
const PROJECT = "22222222-2222-2222-2222-222222222222";
const OTHER_PROJECT = "33333333-3333-3333-3333-333333333333";

const ALICE = "aaaaaaaa-0000-4000-8000-000000000001";
const CAROL = "cccccccc-0000-4000-8000-000000000003";
const DAVE = "dddddddd-0000-4000-8000-000000000004";
const LIVE = "11111111-0000-4000-8000-00000000000a";
const ENDED = "11111111-0000-4000-8000-00000000000b";
const CAROLS = "11111111-0000-4000-8000-00000000000c";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const tenant = new TenantContext(PROJECT, "req_test", "api_key");

let service: UserErasureService;
let commands: InMemoryRevocationCommands;

async function seedUser(projectId: string, id: string, email: string, phone: string | null) {
  await harness.owner.query(
    `INSERT INTO users (id, project_id, email, email_verified, phone, display_name, avatar_url,
                        password_hash, metadata_public, metadata_private)
     VALUES ($1, $2, $3, true, $4, 'Somebody', 'https://img.example.test/a.png', '$argon2id$x',
             '{"plan":"pro"}', '{"crm":"42"}')`,
    [id, projectId, email, phone],
  );
}

async function seedSession(projectId: string, userId: string, id: string, revoked: boolean) {
  await harness.owner.query(
    `INSERT INTO sessions (id, project_id, user_id, device_id, device_name, ip, user_agent,
                           idle_expires_at, absolute_expires_at, revoked_at, revoke_reason)
     VALUES ($1, $2, $3, 'dev-1', 'Ada''s phone', '203.0.113.11', 'Mozilla/5.0',
             now() + interval '30 days', now() + interval '90 days',
             CASE WHEN $4 THEN now() - interval '1 day' END,
             CASE WHEN $4 THEN 'signed_out' END)`,
    [id, projectId, userId, revoked],
  );
  await harness.owner.query(
    `INSERT INTO refresh_tokens (project_id, session_id, family_id, token_hash, expires_at)
     VALUES ($1, $2, gen_random_uuid(), $3, now() + interval '30 days')`,
    [projectId, id, sha256(`refresh-${id}`)],
  );
}

/** One row in every table that keys on the user, and an OTP challenge filed under the address. */
async function seedWaysIn(projectId: string, userId: string, email: string, tag: string) {
  const q = (sql: string, values: unknown[]) => harness.owner.query(sql, values);
  await q(
    `INSERT INTO identities (project_id, user_id, provider, provider_user_id, email, provider_data,
                             encrypted_tokens)
     VALUES ($1, $2, 'github', $3, $4, '{"login":"ada"}', 'ciphertext')`,
    [projectId, userId, `gh-${tag}`, email],
  );
  await q(
    `INSERT INTO mfa_factors (project_id, user_id, type, secret_encrypted, label, verified_at)
     VALUES ($1, $2, 'totp', 'ciphertext', 'Phone', now())`,
    [projectId, userId],
  );
  await q(`INSERT INTO mfa_recovery_codes (project_id, user_id, code_hash) VALUES ($1, $2, $3)`, [
    projectId,
    userId,
    sha256(`recovery-${tag}`),
  ]);
  await q(
    `INSERT INTO webauthn_credentials (project_id, user_id, credential_id, public_key, name)
     VALUES ($1, $2, $3, 'pk', 'YubiKey')`,
    [projectId, userId, `cred-${tag}`],
  );
  await q(
    `INSERT INTO mfa_challenges (project_id, user_id, purpose, expires_at)
     VALUES ($1, $2, 'sign_in', now() + interval '5 minutes')`,
    [projectId, userId],
  );
  await q(
    `INSERT INTO webauthn_challenges (project_id, ceremony, challenge_hash, user_id, expires_at)
     VALUES ($1, 'registration', $2, $3, now() + interval '5 minutes')`,
    [projectId, sha256(`webauthn-${tag}`), userId],
  );
  await q(
    `INSERT INTO auth_codes (project_id, user_id, code_hash, redirect_uri, expires_at)
     VALUES ($1, $2, $3, 'https://app.example.test/cb', now() + interval '2 minutes')`,
    [projectId, userId, sha256(`code-${tag}`)],
  );
  await q(
    `INSERT INTO verification_tokens (project_id, user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, 'email_verification', $3, now() + interval '1 hour')`,
    [projectId, userId, sha256(`verify-${tag}`)],
  );
  await q(
    `INSERT INTO magic_link_tokens (project_id, token_hash, user_id, target_encrypted,
                                    redirect_uri, expires_at)
     VALUES ($1, $2, $3, 'ciphertext', 'https://app.example.test/link',
             now() + interval '10 minutes')`,
    [projectId, sha256(`link-${tag}`), userId],
  );
  await q(
    `INSERT INTO email_change_requests (project_id, user_id, new_email, old_token_hash,
                                        new_token_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
    [projectId, userId, `new-${email}`, sha256(`old-${tag}`), sha256(`new-${tag}`)],
  );
  await q(
    `INSERT INTO oauth_flows (project_id, provider, code_verifier_encrypted, state, redirect_uri,
                              link_user_id, expires_at)
     VALUES ($1, 'google', 'ciphertext', $2, 'https://app.example.test/cb', $3,
             now() + interval '10 minutes')`,
    [projectId, `state-${tag}`, userId],
  );
  await q(
    `INSERT INTO otp_challenges (project_id, channel, target_hash, target_encrypted, code_hash,
                                 flow_id, expires_at)
     VALUES ($1, 'email', $2, 'ciphertext', $3, $4, now() + interval '10 minutes')`,
    [projectId, sha256(email), sha256(`otp-${tag}`), `flow-${tag}`],
  );
}

/** Rows of `table` that still belong to the user, by whichever column names them. */
async function remaining(table: string, column: string, userId: string): Promise<number> {
  const result = await harness.owner.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`,
    [userId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

const USER_TABLES: readonly (readonly [string, string])[] = [
  ["identities", "user_id"],
  ["mfa_factors", "user_id"],
  ["mfa_recovery_codes", "user_id"],
  ["webauthn_credentials", "user_id"],
  ["mfa_challenges", "user_id"],
  ["webauthn_challenges", "user_id"],
  ["auth_codes", "user_id"],
  ["verification_tokens", "user_id"],
  ["magic_link_tokens", "user_id"],
  ["email_change_requests", "user_id"],
  ["oauth_flows", "link_user_id"],
];

beforeAll(async () => {
  await harness.start();
  const clock = new SystemClock();
  const revocations = testRevocations(clock);
  commands = revocations.commands;
  service = new UserErasureService(new UnitOfWork(harness.db), clock, revocations.publisher);

  await harness.owner.query(`INSERT INTO orgs (id, name) VALUES ($1, 'Acme')`, [ORG]);
  for (const project of [PROJECT, OTHER_PROJECT]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
      [project, ORG],
    );
  }

  await seedUser(PROJECT, ALICE, "alice@example.test", "+447700900001");
  await seedSession(PROJECT, ALICE, LIVE, false);
  await seedSession(PROJECT, ALICE, ENDED, true);
  await seedWaysIn(PROJECT, ALICE, "alice@example.test", "alice");

  await seedUser(PROJECT, CAROL, "carol@example.test", null);
  await seedSession(PROJECT, CAROL, CAROLS, false);
  await seedWaysIn(PROJECT, CAROL, "carol@example.test", "carol");

  await seedUser(OTHER_PROJECT, DAVE, "dave@example.test", null);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("erasing a user", () => {
  it("tombstones the account and removes every way back in", async () => {
    expect(
      await service.erase(tenant, ALICE, { ip: "198.51.100.7", userAgent: "backend/1.0" }),
    ).toBe(true);

    const user = await harness.owner.query(
      `SELECT email, phone, display_name, avatar_url, password_hash, metadata_public,
              metadata_private, deleted_at
       FROM users WHERE id = $1`,
      [ALICE],
    );
    expect(user.rows[0]).toMatchObject({
      email: null,
      phone: null,
      display_name: null,
      avatar_url: null,
      password_hash: null,
      metadata_public: {},
      metadata_private: {},
    });
    expect(user.rows[0]?.deleted_at).not.toBeNull();

    for (const [table, column] of USER_TABLES) {
      expect(await remaining(table, column, ALICE), table).toBe(0);
    }
    const otp = await harness.owner.query(
      `SELECT count(*) AS n FROM otp_challenges WHERE target_hash = $1`,
      [sha256("alice@example.test")],
    );
    expect(Number(otp.rows[0]?.n)).toBe(0);
  });

  it("ends the live sessions, clears every session's device, and drops their refresh tokens", async () => {
    const sessions = await harness.owner.query(
      `SELECT id, device_id, device_name, ip, user_agent, revoked_at, revoke_reason
       FROM sessions WHERE user_id = $1 ORDER BY id`,
      [ALICE],
    );
    expect(sessions.rows).toHaveLength(2);
    for (const row of sessions.rows) {
      expect(row).toMatchObject({ device_id: null, device_name: null, ip: null, user_agent: null });
      expect(row.revoked_at).not.toBeNull();
    }
    // The one already ended keeps the reason it ended for; the live one says why it ended now.
    expect(sessions.rows.map((row) => row.revoke_reason)).toEqual(["user_deleted", "signed_out"]);

    const tokens = await harness.owner.query(
      `SELECT count(*) AS n FROM refresh_tokens WHERE session_id = ANY($1::uuid[])`,
      [[LIVE, ENDED]],
    );
    expect(Number(tokens.rows[0]?.n)).toBe(0);
  });

  it("records the erasure for the relay, the webhook, the trail and the auditor", async () => {
    const outbox = await harness.owner.query<{ topic: string; payload: Record<string, unknown> }>(
      `SELECT topic, payload FROM outbox WHERE project_id = $1 ORDER BY seq`,
      [PROJECT],
    );
    const byTopic = new Map(outbox.rows.map((row) => [row.topic, row.payload]));
    expect(byTopic.get("session.revoked")).toMatchObject({
      userId: ALICE,
      sessionIds: [LIVE],
      scope: "all",
    });
    expect(byTopic.get("user.deleted")).toMatchObject({ userId: ALICE });
    expect(byTopic.get("audit.recorded")).toMatchObject({
      action: "user.deleted",
      actorType: "api_key",
      target: `usr_${ALICE.replaceAll("-", "")}`,
      ip: "198.51.100.7",
    });

    const requests = await harness.owner.query(
      `SELECT kind, status, completed_at, due_at, subject_user_id FROM data_subject_requests
       WHERE project_id = $1`,
      [PROJECT],
    );
    expect(requests.rows).toHaveLength(1);
    expect(requests.rows[0]).toMatchObject({
      kind: "erasure",
      status: "completed",
      subject_user_id: ALICE,
    });
    expect(requests.rows[0]?.completed_at).not.toBeNull();

    // The watermark, so an access token already issued stops verifying offline.
    const published = [...commands.sorted.values()].flatMap((set) => [...set.keys()]);
    expect(published).toContain(`usr_${ALICE.replaceAll("-", "")}`);
  });

  it("leaves a neighbour in the same project exactly as it was", async () => {
    const carol = await harness.owner.query(`SELECT email, deleted_at FROM users WHERE id = $1`, [
      CAROL,
    ]);
    expect(carol.rows[0]).toMatchObject({ email: "carol@example.test", deleted_at: null });
    for (const [table, column] of USER_TABLES) {
      expect(await remaining(table, column, CAROL), table).toBe(1);
    }
    const session = await harness.owner.query(`SELECT revoked_at, ip FROM sessions WHERE id = $1`, [
      CAROLS,
    ]);
    expect(session.rows[0]).toMatchObject({ revoked_at: null, ip: "203.0.113.11" });
    const otp = await harness.owner.query(
      `SELECT count(*) AS n FROM otp_challenges WHERE target_hash = $1`,
      [sha256("carol@example.test")],
    );
    expect(Number(otp.rows[0]?.n)).toBe(1);
  });

  it("answers no for an account already erased, one that never existed, or another project's", async () => {
    expect(await service.erase(tenant, ALICE, { ip: null, userAgent: null })).toBe(false);
    expect(
      await service.erase(tenant, "eeeeeeee-0000-4000-8000-00000000000e", {
        ip: null,
        userAgent: null,
      }),
    ).toBe(false);
    expect(await service.erase(tenant, DAVE, { ip: null, userAgent: null })).toBe(false);

    const dave = await harness.owner.query(`SELECT email, deleted_at FROM users WHERE id = $1`, [
      DAVE,
    ]);
    expect(dave.rows[0]).toMatchObject({ email: "dave@example.test", deleted_at: null });

    // Nothing was written for the three refusals: one erasure, one record.
    const requests = await harness.owner.query(`SELECT count(*) AS n FROM data_subject_requests`);
    expect(Number(requests.rows[0]?.n)).toBe(1);
  });
});
