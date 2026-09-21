import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

/**
 * Deleting a project actually deletes it (GDPR Art. 28(3)(g), PROJECT.md 4.13.6).
 *
 * This is the test the defect needed. For a long time three docstrings claimed a project's users,
 * sessions, keys and audit rows went with it by foreign key, and no foreign key to `projects`
 * existed anywhere: the delete removed one row and orphaned the rest, unreachable and therefore
 * impossible to dispose of. Nothing asserted otherwise, which is how it survived.
 *
 * The sweep at the end is **dynamic on purpose.** Naming the tables here would leave a table
 * added next year uncovered by exactly the same silence, so it enumerates every `project_id`
 * column in the schema and demands zero rows for the purged project across all of them.
 */
const harness = new PostgresHarness();

const DOOMED = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SURVIVOR = "5000000d-0000-4000-8000-000000000001";
const OTHER_ORG_PROJECT = "60000000-0000-4000-8000-000000000002";

let orgId = "";
let otherOrgId = "";

async function seedProject(projectId: string, owner: string): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name)
     VALUES ($1, $2, 'p', 'k')`,
    [projectId, owner],
  );
}

/**
 * A row in a spread of tables, chosen for coverage of shape rather than of count: one that
 * cascades from `users` rather than from `projects` directly, one ephemeral challenge, one
 * credential, one configuration row, and an audit entry — the only one the cascade cannot reach.
 */
async function seedRows(projectId: string): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO users (project_id, email) VALUES ($1, 'someone@example.test') RETURNING id`,
    [projectId],
  );
  const userId = rows[0]?.id;
  await harness.owner.query(
    `INSERT INTO sessions (project_id, user_id, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, now() + interval '1 hour', now() + interval '1 day')`,
    [projectId, userId],
  );
  await harness.owner.query(
    `INSERT INTO api_keys (project_id, kind, prefix, hash)
     VALUES ($1, 'publishable', 'pk_us1_abc', $2)`,
    // The hash is globally unique, as a credential digest should be.
    [projectId, `hashed-${projectId}`],
  );
  await harness.owner.query(
    `INSERT INTO otp_challenges
       (project_id, channel, target_hash, target_encrypted, code_hash, flow_id, expires_at)
     VALUES ($1, 'email', 'target', 'sealed', 'code', 'flow_1', now() + interval '10 minutes')`,
    [projectId],
  );
  await harness.owner.query(
    `INSERT INTO audit_events (project_id, actor_type, action, prev_hash, entry_hash)
     VALUES ($1, 'user', 'user.created', repeat('0', 64), $2)`,
    [projectId, `entry-${projectId}`],
  );
}

/** Every table in the schema carrying a `project_id`, asked about one project. */
async function rowsLeftFor(projectId: string): Promise<{ table: string; n: number }[]> {
  const { rows } = await harness.owner.query<{ relname: string }>(
    `SELECT c.relname
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'project_id' AND a.attnum > 0
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND c.relname NOT LIKE 'audit_events\\_%'
       -- The record that the purge happened. It is supposed to survive; that is its job.
       AND c.relname <> 'project_purges'
     ORDER BY c.relname`,
  );

  const left: { table: string; n: number }[] = [];
  for (const { relname } of rows) {
    const counted = await harness.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.${relname} WHERE project_id = $1`,
      [projectId],
    );
    const n = Number(counted.rows[0]?.n ?? 0);
    if (n > 0) left.push({ table: relname, n });
  }
  return left;
}

beforeAll(async () => {
  await harness.start();
  const orgs = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  orgId = orgs.rows[0]?.id ?? "";
  const others = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name)
     VALUES (gen_random_uuid(), 'Somebody Else') RETURNING id`,
  );
  otherOrgId = others.rows[0]?.id ?? "";

  await seedProject(DOOMED, orgId);
  await seedProject(SURVIVOR, orgId);
  await seedProject(OTHER_ORG_PROJECT, otherOrgId);
  await seedRows(DOOMED);
  await seedRows(SURVIVOR);
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("purging a project", () => {
  it("refuses a project belonging to another organisation, without saying it exists", async () => {
    const { rows } = await harness.db.execute<{ removed: number | null }>(
      // Deliberately the wrong pairing: a real project, a real organisation, not each other's.
      // SECURITY DEFINER runs outside RLS, so this is the check that has to hold.
      `SELECT purge_project('${orgId}'::uuid, '${OTHER_ORG_PROJECT}'::uuid, 'test') AS removed`,
    );
    expect(rows[0]?.removed).toBeNull();

    const survived = await harness.owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM projects WHERE id = $1`,
      [OTHER_ORG_PROJECT],
    );
    expect(Number(survived.rows[0]?.n)).toBe(1);
  });

  it("answers the same way for a project that never existed", async () => {
    const { rows } = await harness.db.execute<{ removed: number | null }>(
      `SELECT purge_project('${orgId}'::uuid, '00000000-0000-4000-8000-0000000000ff'::uuid, 'test') AS removed`,
    );
    expect(rows[0]?.removed).toBeNull();
  });

  it("leaves no row behind in any table carrying a project id", async () => {
    expect(await rowsLeftFor(DOOMED)).not.toEqual([]);

    const { rows } = await harness.db.execute<{ removed: number | null }>(
      `SELECT purge_project('${orgId}'::uuid, '${DOOMED}'::uuid, 'staff_1') AS removed`,
    );
    // One audit entry was seeded, and the cascade cannot reach it. That it is counted here is
    // what says the append-only table was handled rather than skipped.
    expect(Number(rows[0]?.removed)).toBe(1);

    expect(await rowsLeftFor(DOOMED)).toEqual([]);
  });

  it("keeps the evidence that it happened, which is all that may remain", async () => {
    const { rows } = await harness.owner.query<{
      org_id: string;
      audit_rows_deleted: number;
      purged_by: string;
    }>(`SELECT org_id, audit_rows_deleted, purged_by FROM project_purges WHERE project_id = $1`, [
      DOOMED,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.org_id).toBe(orgId);
    expect(Number(rows[0]?.audit_rows_deleted)).toBe(1);
    expect(rows[0]?.purged_by).toBe("staff_1");
  });

  it("touches no other project in the same organisation", async () => {
    const left = await rowsLeftFor(SURVIVOR);
    expect(left.map((entry) => entry.table)).toContain("users");
    expect(left.map((entry) => entry.table)).toContain("audit_events");
  });
});
