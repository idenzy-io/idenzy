import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";

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
  const orgId = rows[0]?.id;

  for (const [projectId, email] of [
    [PROJECT_A, "alice@a.test"],
    [PROJECT_B, "bob@b.test"],
  ]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [projectId]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [projectId, orgId],
    );
    await harness.owner.query(`INSERT INTO users (project_id, email) VALUES ($1, $2)`, [
      projectId,
      email,
    ]);
  }
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

/**
 * These are the tests PROJECT.md 7.4 calls RLS negative tests. Each one asserts that an
 * attack or a mistake fails, rather than that the happy path works. A test that only
 * exercises correct usage would prove nothing about isolation.
 */
describe("tenant isolation holds at the database", () => {
  async function asTenant<T>(projectId: string, run: () => Promise<T>): Promise<T> {
    await harness.db.execute(sql`select set_config('app.project_id', ${projectId}, false)`);
    return run();
  }

  it("shows a tenant only its own rows", async () => {
    const result = await asTenant(PROJECT_A, () =>
      harness.db.execute<{ email: string }>(sql`select email from users`),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.email).toBe("alice@a.test");
  });

  it("returns nothing when the repository layer is bypassed and another tenant is queried directly", async () => {
    // The whole point: application code is deliberately wrong here, and isolation holds
    // anyway because it is enforced by the database, not by the query.
    const result = await asTenant(PROJECT_A, () =>
      harness.db.execute(sql`select email from users where project_id = ${PROJECT_B}::uuid`),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("returns nothing when no tenant context is set at all", async () => {
    await harness.db.execute(sql`select set_config('app.project_id', '', false)`);
    const result = await harness.db.execute(sql`select email from users`);
    expect(result.rows).toHaveLength(0);
  });

  it("refuses to write a row belonging to another tenant", async () => {
    await expect(
      asTenant(PROJECT_A, () =>
        harness.db.execute(
          sql`insert into users (project_id, email) values (${PROJECT_B}::uuid, 'mallory@b.test')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("runs as a role that cannot bypass RLS", async () => {
    const { rows } = await harness.owner.query<{ rolbypassrls: boolean }>(
      `SELECT rolbypassrls FROM pg_roles WHERE rolname = 'idenzy_app'`,
    );
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  /**
   * Migration 0001 granted by looping over the tables that existed when it ran, and it
   * runs once. Every later migration that adds a tenant table has to repeat that loop,
   * and this is what notices when one did not: the table is unreadable by the app role,
   * which shows up as a permission error on a route nobody tested yet.
   */
  it("grants the app role its four privileges on every table except the audit trail", async () => {
    const { rows } = await harness.owner.query<{ relname: string; missing: string }>(
      `SELECT c.relname,
              string_agg(p.priv, ',') FILTER (
                WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
              ) AS missing
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'audit_events'
       GROUP BY c.relname
       HAVING count(*) FILTER (
         WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
       ) > 0`,
    );
    expect(rows).toEqual([]);
  });

  /**
   * Migration 0012 had to DROP and re-CREATE both resolution functions, because Postgres
   * refuses to let CREATE OR REPLACE change a return type. Privileges do not survive a DROP,
   * so the REVOKE and GRANT had to be repeated — and forgetting them fails in exactly one
   * way: idenzy_app loses the only lookup that turns a Host header into a project, and every
   * request 404s with `unknown_project` while the function itself looks perfectly healthy.
   */
  it("still lets the app role execute the resolution functions after the rebuild", async () => {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT_A]);
    await harness.owner.query(
      `INSERT INTO project_domains (project_id, domain, type, status)
       VALUES ($1, 'auth.acme.test', 'auth', 'verified')
       ON CONFLICT DO NOTHING`,
      [PROJECT_A],
    );
    await harness.owner.query(
      `INSERT INTO project_origins (project_id, origin) VALUES ($1, 'https://app.acme.test')
       ON CONFLICT DO NOTHING`,
      [PROJECT_A],
    );

    const resolved = await harness.db.execute<{
      project_id: string;
      allowed_origins: string[];
      has_auth_domain: boolean;
    }>(sql`select * from resolve_project_by_host('auth.acme.test')`);

    expect(resolved.rows[0]?.project_id).toBe(PROJECT_A);
    expect(resolved.rows[0]?.allowed_origins).toEqual(["https://app.acme.test"]);
    expect(resolved.rows[0]?.has_auth_domain).toBe(true);
  });

  it("resolves origins per project, so one tenant's allowlist is not another's", async () => {
    const other = await harness.db.execute<{ project_id: string }>(
      sql`select * from resolve_project_by_host('nobody.test')`,
    );
    expect(other.rows).toHaveLength(0);
  });

  it("forces RLS on every protected table, so ownership is not an escape hatch", async () => {
    const { rows } = await harness.owner.query<{ count: string }>(
      `SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relrowsecurity AND NOT c.relforcerowsecurity`,
    );
    expect(Number(rows[0]?.count)).toBe(0);
  });
});

describe("the audit trail is append-only", () => {
  it("accepts an insert", async () => {
    await harness.db.execute(sql`select set_config('app.project_id', ${PROJECT_A}, false)`);
    await harness.db.execute(
      sql`insert into audit_events (project_id, actor_type, action, prev_hash, entry_hash)
          values (${PROJECT_A}::uuid, 'user', 'user.created', repeat('0', 64), 'h1')`,
    );
    const result = await harness.db.execute(sql`select id from audit_events`);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  // Asserting SQLSTATE 42501 rather than the message: drizzle wraps the driver error,
  // so the text lives on the cause, and the code is the stable contract anyway.
  async function expectInsufficientPrivilege(work: Promise<unknown>): Promise<void> {
    const error = await work.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    const cause = (error as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("42501");
  }

  it("refuses an update, because the privilege does not exist on the connection", async () => {
    await expectInsufficientPrivilege(
      harness.db.execute(sql`update audit_events set action = 'tampered'`),
    );
  });

  it("refuses a delete", async () => {
    await expectInsufficientPrivilege(harness.db.execute(sql`delete from audit_events`));
  });

  it("is partitioned, so retention is a dropped partition rather than a mass delete", async () => {
    const { rows } = await harness.owner.query<{ relkind: string }>(
      `SELECT relkind FROM pg_class WHERE relname = 'audit_events'`,
    );
    expect(rows[0]?.relkind).toBe("p");
  });
});
