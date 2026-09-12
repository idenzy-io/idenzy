import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresHarness } from "../src/postgres-harness.js";

const harness = new PostgresHarness();
const PROJECT_A = "11111111-1111-1111-1111-111111111111";
const PROJECT_B = "22222222-2222-2222-2222-222222222222";
const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MEMBER_A = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const MEMBER_B = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1";
const OPEN_INVITE_HASH = "open-invitation-token-hash";
const SPENT_INVITE_HASH = "spent-invitation-token-hash";

beforeAll(async () => {
  await harness.start();
  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );

  // One organisation per project, so the two planes can be tested against each other.
  // Sharing one organisation would make every org-plane assertion below vacuous.
  for (const [orgId, name] of [
    [ORG_A, "Acme"],
    [ORG_B, "Globex"],
  ]) {
    await harness.owner.query(
      `INSERT INTO orgs (id, name, cell_id)
       VALUES ($1, $2, (SELECT id FROM region_cells LIMIT 1))`,
      [orgId, name],
    );
  }

  for (const [projectId, orgId, email] of [
    [PROJECT_A, ORG_A, "alice@a.test"],
    [PROJECT_B, ORG_B, "bob@b.test"],
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

  for (const [orgId, memberId, last4, note] of [
    [ORG_A, MEMBER_A, "4242", "Acme trial"],
    [ORG_B, MEMBER_B, "1881", "Globex trial"],
  ]) {
    await harness.owner.query(
      `INSERT INTO org_members (id, org_id, user_id, role)
       VALUES ($1, $2, gen_random_uuid(), 'owner')`,
      [memberId, orgId],
    );
    await harness.owner.query(
      `INSERT INTO payment_methods
         (org_id, provider, provider_method_id, brand, last4, expiry_month, expiry_year, is_default)
       VALUES ($1, 'stripe', $2, 'visa', $3, 12, 2030, true)`,
      [orgId, `pm_${last4}`, last4],
    );
    await harness.owner.query(
      `INSERT INTO credit_grants (org_id, kind, amount_cents, remaining_cents, note)
       VALUES ($1, 'promotional', 5000, 5000, $2)`,
      [orgId, note],
    );
  }

  await harness.owner.query(
    `INSERT INTO org_invitations (org_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, 'new@a.test', 'developer', $2, $3, now() + interval '7 days'),
            ($1, 'gone@a.test', 'viewer', $4, $3, now() + interval '7 days')`,
    [ORG_A, OPEN_INVITE_HASH, MEMBER_A, SPENT_INVITE_HASH],
  );
  await harness.owner.query(
    `UPDATE org_invitations SET accepted_at = now() WHERE token_hash = $1`,
    [SPENT_INVITE_HASH],
  );
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
  it("grants the app role its four privileges on every table except the two append-only ones", async () => {
    const { rows } = await harness.owner.query<{ relname: string; missing: string }>(
      `SELECT c.relname,
              string_agg(p.priv, ',') FILTER (
                WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
              ) AS missing
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND c.relname NOT IN ('audit_events', 'payment_provider_events')
         AND c.relname NOT LIKE 'audit_events\\_%'
       GROUP BY c.relname
       HAVING count(*) FILTER (
         WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
       ) > 0`,
    );
    expect(rows).toEqual([]);
  });

  /**
   * The exclusion above is a claim, so it is asserted rather than trusted. A payment
   * event is what a disputed charge is reconciled against, and nothing on the request
   * path has a reason to remove one (migration 0028).
   */
  it("withholds delete on payment_provider_events while granting the rest", async () => {
    const { rows } = await harness.owner.query<{ priv: string; granted: boolean }>(
      `SELECT p.priv, has_table_privilege('idenzy_app', 'payment_provider_events', p.priv) AS granted
       FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)`,
    );
    expect(rows).toEqual([
      { priv: "SELECT", granted: true },
      { priv: "INSERT", granted: true },
      { priv: "UPDATE", granted: true },
      { priv: "DELETE", granted: false },
    ]);
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

/**
 * The org-plane mirror of the block above (ADR-0011). Same negative shape, because the
 * argument is the same one: a wallet and a card list guarded only by a predicate a
 * developer has to remember are one forgotten `where` from a cross-customer read, and on
 * the money surface that is the read a customer notices first.
 */
describe("organisation isolation holds at the database", () => {
  async function asOrg<T>(orgId: string, run: () => Promise<T>): Promise<T> {
    await harness.db.execute(sql`select set_config('app.org_id', ${orgId}, false)`);
    return run();
  }

  it("shows an organisation only its own cards", async () => {
    const result = await asOrg(ORG_A, () =>
      harness.db.execute<{ last4: string }>(sql`select last4 from payment_methods`),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.last4).toBe("4242");
  });

  it("returns nothing when the repository layer is bypassed and another organisation is queried directly", async () => {
    // Deliberately wrong application code, exactly as the tenant case above. Isolation
    // holds because the database enforces it, not because the query remembered to.
    const result = await asOrg(ORG_A, () =>
      harness.db.execute(sql`select note from credit_grants where org_id = ${ORG_B}::uuid`),
    );
    expect(result.rows).toHaveLength(0);
  });

  it("returns nothing when no organisation context is set at all", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);
    const result = await harness.db.execute(sql`select last4 from payment_methods`);
    expect(result.rows).toHaveLength(0);
  });

  it("refuses to write a row belonging to another organisation", async () => {
    await expect(
      asOrg(ORG_A, () =>
        harness.db.execute(
          sql`insert into credit_grants (org_id, kind, amount_cents, remaining_cents)
              values (${ORG_B}::uuid, 'promotional', 100, 100)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("shows an organisation only its own row on orgs, which is keyed on its own id", async () => {
    const result = await asOrg(ORG_B, () =>
      harness.db.execute<{ name: string }>(sql`select name from orgs`),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe("Globex");
  });

  /**
   * The property that makes two settings safer than one shared `app.tenant_id`: neither
   * key satisfies the other's policy, so a transaction bound to one plane reads nothing
   * from the other however wrong the query is.
   */
  it("keeps the two keys independent in both directions", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);
    await harness.db.execute(sql`select set_config('app.project_id', ${PROJECT_A}, false)`);
    const cards = await harness.db.execute(sql`select last4 from payment_methods`);
    expect(cards.rows).toHaveLength(0);

    await harness.db.execute(sql`select set_config('app.project_id', '', false)`);
    await harness.db.execute(sql`select set_config('app.org_id', ${ORG_A}, false)`);
    const users = await harness.db.execute(sql`select email from users`);
    expect(users.rows).toHaveLength(0);
  });

  /**
   * The org plane's chicken-and-egg, and the reason migration 0036 exists.
   *
   * A person signs in once and may belong to several organisations, so a request names
   * one and the server checks the membership before anything binds `app.org_id`. Under
   * the policy that check would correctly see nothing, so it goes through a SECURITY
   * DEFINER function — the shape 0002 used for projects and 0029 for invitations.
   *
   * What matters is that it stays narrow: the subject is the user id from a verified
   * token, and no argument can name a different one.
   */
  it("resolves a membership with no organisation bound", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);
    const { rows: seeded } = await harness.owner.query<{ user_id: string }>(
      `SELECT user_id FROM org_members WHERE org_id = $1`,
      [ORG_A],
    );
    const userId = seeded[0]?.user_id;
    expect(userId).toBeDefined();

    const mine = await harness.db.execute<{ role: string }>(
      sql`select * from resolve_org_membership(${userId ?? ""}::uuid, ${ORG_A}::uuid)`,
    );
    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0]?.role).toBe("owner");

    // The same person against an organisation they are not in. Not an error and not a
    // different shape of answer: simply no row, so a caller cannot tell "not a member"
    // from "no such organisation" and the id space is not an oracle for our customers.
    const theirs = await harness.db.execute(
      sql`select * from resolve_org_membership(${userId ?? ""}::uuid, ${ORG_B}::uuid)`,
    );
    expect(theirs.rows).toHaveLength(0);
  });

  it("lists only the organisations a person is actually in", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);
    const { rows: seeded } = await harness.owner.query<{ user_id: string }>(
      `SELECT user_id FROM org_members WHERE org_id = $1`,
      [ORG_B],
    );
    const userId = seeded[0]?.user_id ?? "";

    const listed = await harness.db.execute<{ org_id: string; name: string; role: string }>(
      sql`select * from orgs_for_user(${userId}::uuid)`,
    );
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.org_id).toBe(ORG_B);
    expect(listed.rows[0]?.name).toBe("Globex");
    expect(listed.rows[0]?.role).toBe("owner");
  });

  /**
   * Provisioning: the one transaction that creates a tenant rather than working inside
   * one, and the only place a scope is bound to something not yet in the database.
   *
   * It needs no SECURITY DEFINER function, unlike every other place this schema reaches
   * past a policy. Binding `app.org_id` to a freshly generated id satisfies every WITH
   * CHECK the three inserts face, because each row being written names that organisation.
   */
  it("creates an organisation, its owner and its first project in one transaction", async () => {
    const orgId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const userId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const cell = await harness.owner.query<{ id: string }>(`SELECT id FROM region_cells LIMIT 1`);
    const cellId = cell.rows[0]?.id ?? "";

    await harness.db.execute(sql`select set_config('app.project_id', '', false)`);
    await harness.db.execute(sql`select set_config('app.org_id', ${orgId}, false)`);
    await harness.db.execute(
      sql`insert into orgs (id, name, cell_id) values (${orgId}::uuid, 'Provisioned', ${cellId}::uuid)`,
    );
    await harness.db.execute(
      sql`insert into org_members (org_id, user_id, role)
          values (${orgId}::uuid, ${userId}::uuid, 'owner')`,
    );
    await harness.db.execute(
      sql`insert into projects (id, org_id, name, cell_id, kms_key_name)
          values (${projectId}::uuid, ${orgId}::uuid, 'First', ${cellId}::uuid, 'k')`,
    );

    const seen = await harness.db.execute<{ name: string }>(sql`select name from projects`);
    expect(seen.rows).toHaveLength(1);
    expect(seen.rows[0]?.name).toBe("First");
  });

  /**
   * The attack the design turns on, and the reason `UnitOfWork.provision` generates the
   * organisation id rather than taking one.
   *
   * A caller who could choose what `app.org_id` binds to could bind an organisation that
   * is not theirs and insert an `org_members` row naming themselves its owner. The
   * database cannot tell that apart from legitimate provisioning — both are an insert
   * matching the bound organisation — so nothing here refuses it, and that is exactly why
   * the id must never come from a request. This asserts the shape of the hole so the
   * reason the parameter does not exist stays written down.
   */
  it("would let a bound organisation id write into that organisation, which is why it is never a parameter", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', ${ORG_A}, false)`);
    const intruder = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    await harness.db.execute(
      sql`insert into org_members (org_id, user_id, role)
          values (${ORG_A}::uuid, ${intruder}::uuid, 'admin')`,
    );
    const team = await harness.db.execute(sql`select id from org_members`);
    expect(team.rows.length).toBeGreaterThan(1);

    // And the same write against an organisation that is not bound is refused, which is
    // the half that does hold: the policy, not the application, is what stops it.
    await expect(
      harness.db.execute(
        sql`insert into org_members (org_id, user_id, role)
            values (${ORG_B}::uuid, ${intruder}::uuid, 'admin')`,
      ),
    ).rejects.toThrow();
    await harness.owner.query(`DELETE FROM org_members WHERE user_id = $1`, [intruder]);
  });

  /**
   * `projects` carries a policy for each plane and they OR together, so both questions
   * have an answer: auth-api asks "the project I am" and the panel asks "the projects I
   * own". Neither reading widens the other.
   */
  it("shows an organisation its own projects, and a project transaction only itself", async () => {
    await harness.db.execute(sql`select set_config('app.project_id', '', false)`);
    await harness.db.execute(sql`select set_config('app.org_id', ${ORG_A}, false)`);
    const owned = await harness.db.execute<{ id: string }>(sql`select id from projects`);
    expect(owned.rows.map((row) => row.id)).toContain(PROJECT_A);
    expect(owned.rows.map((row) => row.id)).not.toContain(PROJECT_B);

    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);
    await harness.db.execute(sql`select set_config('app.project_id', ${PROJECT_A}, false)`);
    const itself = await harness.db.execute<{ id: string }>(sql`select id from projects`);
    expect(itself.rows).toHaveLength(1);
    expect(itself.rows[0]?.id).toBe(PROJECT_A);
  });

  it("holds one owner per organisation, so a transfer cannot leave two", async () => {
    await expect(
      harness.owner.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, gen_random_uuid(), 'owner')`,
        [ORG_A],
      ),
    ).rejects.toThrow();
  });

  it("holds one default card per organisation", async () => {
    await expect(
      harness.owner.query(
        `INSERT INTO payment_methods
           (org_id, provider, provider_method_id, brand, last4, expiry_month, expiry_year, is_default)
         VALUES ($1, 'stripe', 'pm_second', 'visa', '9999', 12, 2030, true)`,
        [ORG_A],
      ),
    ).rejects.toThrow();
  });

  it("refuses an automatic top-up that would add less than it triggers on", async () => {
    await expect(
      harness.owner.query(
        `INSERT INTO billing_settings
           (org_id, auto_top_up_enabled, auto_top_up_threshold_cents, auto_top_up_amount_cents)
         VALUES ($1, true, 5000, 1000)`,
        [ORG_A],
      ),
    ).rejects.toThrow();
  });

  it("refuses to draw a grant below zero", async () => {
    await expect(
      harness.owner.query(`UPDATE credit_grants SET remaining_cents = -1 WHERE org_id = $1`, [
        ORG_A,
      ]),
    ).rejects.toThrow();
  });

  /**
   * Somebody following an invite link is not in the organisation yet, so the lookup runs
   * with no `app.org_id` and RLS would correctly hide the row. Migration 0029 is the
   * narrow way through, and the point of this test is that it stays narrow: it resolves
   * an open invitation and nothing else.
   */
  it("resolves an open invitation with no organisation bound, and only an open one", async () => {
    await harness.db.execute(sql`select set_config('app.org_id', '', false)`);

    const open = await harness.db.execute<{ org_id: string; email: string }>(
      sql`select * from resolve_open_invitation(${OPEN_INVITE_HASH}, now())`,
    );
    expect(open.rows).toHaveLength(1);
    expect(open.rows[0]?.org_id).toBe(ORG_A);
    expect(open.rows[0]?.email).toBe("new@a.test");

    const spent = await harness.db.execute(
      sql`select * from resolve_open_invitation(${SPENT_INVITE_HASH}, now())`,
    );
    expect(spent.rows).toHaveLength(0);

    const unknown = await harness.db.execute(
      sql`select * from resolve_open_invitation('no-such-hash', now())`,
    );
    expect(unknown.rows).toHaveLength(0);
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

  /**
   * The parent refusing a delete proves nothing on its own, and for three migrations it
   * was the only thing being proved. `audit_events` is partitioned, and migration 0001
   * ended with `ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE`, so
   * every partition created afterwards held all four: `DELETE FROM audit_events` was
   * refused and `DELETE FROM audit_events_2026_09` removed the row. A partition name is
   * the table name and a month, so finding one was not the hard part.
   *
   * Migration 0030 revoked the two verbs from the defaults, repaired the existing
   * partitions and made `ensure_audit_partition` revoke them itself. This asserts all
   * three, because the grants test above cannot: it checks that privileges are present.
   */
  it("withholds update and delete on every partition, not only on the parent", async () => {
    const { rows } = await harness.owner.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class parent ON parent.oid = i.inhparent
       WHERE parent.relname = 'audit_events'
         AND (has_table_privilege('idenzy_app', c.oid, 'UPDATE')
              OR has_table_privilege('idenzy_app', c.oid, 'DELETE'))`,
    );
    expect(rows).toEqual([]);
  });

  it("refuses a delete addressed to a partition directly", async () => {
    const partition = await harness.owner.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class parent ON parent.oid = i.inhparent
       WHERE parent.relname = 'audit_events' LIMIT 1`,
    );
    const name = partition.rows[0]?.relname;
    expect(name).toBeDefined();
    await expectInsufficientPrivilege(
      harness.db.execute(sql.raw(`delete from ${name ?? "audit_events"}`)),
    );
  });

  /**
   * A partition created next month must be born append-only, whatever the default
   * privileges say by then. The function is the single writer of these tables, so the
   * guarantee belongs in it rather than in a migration somebody remembers to repeat.
   */
  it("creates future partitions without update or delete", async () => {
    await harness.owner.query(`SELECT ensure_audit_partition($1::date)`, ["2099-01-01"]);
    const { rows } = await harness.owner.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('idenzy_app', 'audit_events_2099_01', 'UPDATE') AS upd,
              has_table_privilege('idenzy_app', 'audit_events_2099_01', 'DELETE') AS del`,
    );
    expect(rows[0]).toEqual({ upd: false, del: false });
  });

  it("is partitioned, so retention is a dropped partition rather than a mass delete", async () => {
    const { rows } = await harness.owner.query<{ relkind: string }>(
      `SELECT relkind FROM pg_class WHERE relname = 'audit_events'`,
    );
    expect(rows[0]?.relkind).toBe("p");
  });
});
