import { Logger } from "@idenzy/core/logging/logger";
import { RetentionPruner } from "@idenzy/persistence/repository/retention-pruner";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RetentionSweeper } from "../src/retention-sweeper.js";

/**
 * The retention sweep, against a real Postgres.
 *
 * Everything worth asserting here is a database property. The functions are SECURITY DEFINER
 * because the app role under FORCE RLS with no `app.project_id` bound matches nothing — the
 * failure that motivated them is silent, so the test that matters is "rows actually went",
 * run as `idenzy_app` exactly as the worker does.
 *
 * Two projects, because the interesting case is not one project being swept. It is a project
 * with a stored policy and a project with none being swept at *different* ages in the same
 * statement, and a project that has never opened the settings screen not being skipped — which
 * is what a sweeper that looped over `retention_policies` would have done to almost everybody.
 */

const harness = new PostgresHarness();

/** Has a stored policy: sessions kept 7 days. */
const CONFIGURED = "11111111-1111-1111-1111-111111111111";
/** Has none, so it is swept at the default of 90. */
const UNCONFIGURED = "22222222-2222-2222-2222-222222222222";

class SilentLogger extends Logger {
  override debug(): void {}
  override info(): void {}
  override warn(): void {}
  override error(): void {}
  override child(): Logger {
    return this;
  }
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

async function seedSession(project: string, id: string, endedDaysAgo: number): Promise<void> {
  await harness.owner.query(
    `INSERT INTO sessions (id, project_id, user_id, idle_expires_at, absolute_expires_at, revoked_at)
     VALUES ($1, $2, $3, now(), $4, $4)`,
    [id, project, await userFor(project), daysAgo(endedDaysAgo)],
  );
}

const users = new Map<string, string>();

async function userFor(project: string): Promise<string> {
  const held = users.get(project);
  if (held !== undefined) return held;
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO users (id, project_id, email) VALUES (gen_random_uuid(), $1, $2) RETURNING id`,
    [project, `owner-${project.slice(0, 8)}@example.com`],
  );
  const id = rows[0]?.id ?? "";
  users.set(project, id);
  return id;
}

beforeAll(async () => {
  await harness.start();

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  for (const project of [CONFIGURED, UNCONFIGURED]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [project, rows[0]?.id],
    );
  }

  // One project chose seven days. The other has no row at all, which is the normal state.
  await harness.owner.query(
    `INSERT INTO retention_policies (id, project_id, subject, max_age, action)
     VALUES (gen_random_uuid(), $1, 'sessions', 'P7D', 'purge')`,
    [CONFIGURED],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

const sweeper = (): RetentionSweeper =>
  new RetentionSweeper(new RetentionPruner(harness.db), new SilentLogger());

async function sessionIds(): Promise<string[]> {
  const { rows } = await harness.owner.query<{ id: string }>(`SELECT id FROM sessions ORDER BY id`);
  return rows.map((row) => row.id);
}

describe("sweeping sessions", () => {
  it("applies each project's own age, and the default where it has none", async () => {
    // Configured (7 days): 30 days old goes, 3 days old stays.
    await seedSession(CONFIGURED, "aaaaaaaa-0000-0000-0000-000000000001", 30);
    await seedSession(CONFIGURED, "aaaaaaaa-0000-0000-0000-000000000002", 3);
    // Unconfigured (default 90): 30 days old stays, 120 days old goes. The second is the
    // assertion that matters — a project nobody has configured is still swept.
    await seedSession(UNCONFIGURED, "bbbbbbbb-0000-0000-0000-000000000001", 30);
    await seedSession(UNCONFIGURED, "bbbbbbbb-0000-0000-0000-000000000002", 120);

    expect(await sweeper().sweep()).toBe(2);
    expect(await sessionIds()).toEqual([
      "aaaaaaaa-0000-0000-0000-000000000002",
      "bbbbbbbb-0000-0000-0000-000000000001",
    ]);
  });

  it("leaves a live session alone however old it is", async () => {
    await harness.owner.query(
      `INSERT INTO sessions (id, project_id, user_id, created_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day', now() + interval '30 days')`,
      ["cccccccc-0000-0000-0000-000000000001", CONFIGURED, await userFor(CONFIGURED), daysAgo(400)],
    );

    await sweeper().sweep();
    expect(await sessionIds()).toContain("cccccccc-0000-0000-0000-000000000001");
  });
});

describe("tombstoning a deleted account", () => {
  it("clears the personal columns and keeps the row, so the audit trail still resolves", async () => {
    const { rows } = await harness.owner.query<{ id: string }>(
      `INSERT INTO users (id, project_id, email, phone, password_hash, display_name, avatar_url,
                          metadata_public, metadata_private, deleted_at)
       VALUES (gen_random_uuid(), $1, 'gone@example.com', '+15550000', 'hash', 'Gone Person',
               'https://example.com/a.png', '{"a":1}'::jsonb, '{"b":2}'::jsonb, $2)
       RETURNING id`,
      [UNCONFIGURED, daysAgo(60)],
    );
    const id = rows[0]?.id ?? "";

    expect(await sweeper().sweep()).toBeGreaterThan(0);

    const after = await harness.owner.query<{
      email: string | null;
      phone: string | null;
      password_hash: string | null;
      display_name: string | null;
      avatar_url: string | null;
      metadata_public: unknown;
      metadata_private: unknown;
      deleted_at: Date | null;
    }>(`SELECT * FROM users WHERE id = $1`, [id]);

    const row = after.rows[0];
    expect(row).toBeDefined();
    expect(row?.email).toBeNull();
    expect(row?.phone).toBeNull();
    expect(row?.password_hash).toBeNull();
    expect(row?.display_name).toBeNull();
    expect(row?.avatar_url).toBeNull();
    expect(row?.metadata_public).toEqual({});
    expect(row?.metadata_private).toEqual({});
    // The marker stays: the row is a tombstone rather than an account that was never deleted.
    expect(row?.deleted_at).not.toBeNull();
  });

  it("does not spend a later pass re-clearing a row it already cleared", async () => {
    expect(await sweeper().sweep()).toBe(0);
  });

  it("leaves an account that is not deleted alone, however old", async () => {
    const email = "alive@example.com";
    await harness.owner.query(
      `INSERT INTO users (id, project_id, email, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3)`,
      [UNCONFIGURED, email, daysAgo(900)],
    );

    await sweeper().sweep();
    const { rows } = await harness.owner.query(`SELECT email FROM users WHERE email = $1`, [email]);
    expect(rows).toHaveLength(1);
  });
});
