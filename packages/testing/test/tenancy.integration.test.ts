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

  // One organisation per project, so the two planes can be tested against each other.
  // Sharing one organisation would make every org-plane assertion below vacuous.
  for (const [orgId, name] of [
    [ORG_A, "Acme"],
    [ORG_B, "Globex"],
  ]) {
    await harness.owner.query(
      `INSERT INTO orgs (id, name)
       VALUES ($1, $2)`,
      [orgId, name],
    );
  }

  for (const [projectId, orgId, email] of [
    [PROJECT_A, ORG_A, "alice@a.test"],
    [PROJECT_B, ORG_B, "bob@b.test"],
  ]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name)
       VALUES ($1, $2, 'p', 'k')`,
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
 * What the database still enforces, now that it no longer enforces isolation.
 *
 * This file used to be what PROJECT.md 7.4 calls the RLS negative tests: nineteen of them
 * asked the database for another tenant's rows, in every way a mistake or an attack could,
 * and asserted that nothing came back. Row-level security is gone, so those nineteen
 * asserted a property the system no longer has. They were deleted rather than weakened:
 * a test that still passed against a database with no policies would be worse than no
 * test, because it would read like proof.
 *
 * **Isolation is now a property of the repository layer alone**, and it is tested where it
 * lives: `repositories.integration.test.ts` drives `BaseRepository`/`OrgRepository` against
 * a real database holding two tenants. What stays here is what the database still
 * guarantees and no application code can weaken: the grants, the append-only audit trail,
 * the delete cascade, and the constraints that hold one owner per organisation.
 */
describe("the grants the app role holds", () => {
  /**
   * Migration 0001 granted by looping over the tables that existed when it ran, and it
   * runs once. Every later migration that adds a tenant table has to repeat that loop,
   * and this is what notices when one did not: the table is unreadable by the app role,
   * which shows up as a permission error on a route nobody tested yet.
   */
  it("grants the app role its four privileges on every table except the append-only ones", async () => {
    const { rows } = await harness.owner.query<{ relname: string; missing: string }>(
      `SELECT c.relname,
              string_agg(p.priv, ',') FILTER (
                WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
              ) AS missing
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND c.relname NOT IN (
           'audit_events', 'payment_provider_events', 'usage_periods',
           -- The drawdown's three (migration 0055, ADR-0014). Two are financial state that
           -- nothing on the request path may delete, and the third is the ledger beneath
           -- them and is append-only. Each is asserted on its own below.
           'usage_billing_state', 'org_debts', 'usage_charges',
           -- The email feedback loop's three (migration 0057, risks.md 2 and 2b). None gets
           -- DELETE: two age out on a retention tier through a SECURITY DEFINER function,
           -- and a hold is a record of a decision that outlives the block. Asserted below.
           'email_delivery_stats', 'email_sending_holds', 'email_provider_events',
           -- Refunds and disputes of a top-up (migration 0004). Each records money that moved
           -- and how the wallet followed it, so neither gets DELETE. Asserted below.
           'payment_refunds', 'payment_disputes',
           -- The app role holds nothing at all on this one (migration 0062). It is written by
           -- purge_project running as the owner and read by an auditor, and it could not be
           -- tenant-scoped even in principle: the row exists because the tenant does not.
           'project_purges'
         )
         AND c.relname NOT LIKE 'audit_events\\_%'
       GROUP BY c.relname
       HAVING count(*) FILTER (
         WHERE NOT has_table_privilege('idenzy_app', c.oid, p.priv)
       ) > 0`,
    );
    expect(rows).toEqual([]);
  });

  /**
   * The same shape of gap, one plane down, and the one that actually bit.
   *
   * For a long time `project_id` carried no foreign key anywhere while three docstrings claimed
   * deleting a project took its users, sessions, keys and audit rows with it. It did not: the
   * delete removed one row and orphaned everything pointing at it, which is an Art. 28(3)(g)
   * failure — a processor must be able to dispose of a customer's data at the end of service,
   * and rows nothing can reach cannot be disposed of.
   *
   * `projectIdColumn` now requires the reference, so a new tenant table cannot compile without
   * one. This catches the other route in: a table that spells `project_id` by hand.
   */
  it("cascades every project_id to projects, except the three that say why not", async () => {
    const { rows } = await harness.owner.query<{ relname: string }>(
      `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'project_id' AND a.attnum > 0
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND c.relname NOT LIKE 'audit_events\\_%'
         AND c.relname NOT IN (
           -- Partitioned, and idenzy_app holds SELECT and INSERT on it and nothing else. That
           -- revoke is the integrity control of 4.13.3, so a cascade would have no privilege
           -- to fire. Its rows go through purge_project instead.
           'audit_events',
           -- Control plane, and deliberately cross-cell: a project lives in a region cell and
           -- this row does not, so the reference would not survive the cells being independent
           -- stacks (4.13.5). It also carries statutory six-year retention.
           'invoice_lines',
           -- Nullable, because the row arrives from the provider before the project it concerns
           -- is resolved.
           'email_provider_events',
           -- The inverse of a cascade: this row is the record that a project was deleted, so a
           -- reference to it would take the evidence with the thing it evidences.
           'project_purges'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint fk
           WHERE fk.conrelid = c.oid
             AND fk.contype = 'f'
             AND fk.confrelid = 'public.projects'::regclass
             AND a.attnum = ANY (fk.conkey)
             AND fk.confdeltype = 'c'
         )
       ORDER BY c.relname`,
    );
    expect(rows).toEqual([]);

    // An empty list is the pass condition, so prove it is empty for the right reason. If the
    // join above ever stops matching — a renamed column, a cast that throws — this test would
    // go green over a schema with no cascades at all.
    const covered = await harness.owner.query<{ n: string }>(
      `SELECT count(*) AS n
       FROM pg_constraint fk
       WHERE fk.contype = 'f'
         AND fk.confrelid = 'public.projects'::regclass
         AND fk.confdeltype = 'c'`,
    );
    expect(Number(covered.rows[0]?.n)).toBeGreaterThan(30);
  });

  /**
   * The drawdown's tables, for the same reason: an exclusion above is a claim and a claim
   * is asserted. `usage_charges` is what `org_debts.debt_cents` can be rebuilt from when a
   * customer disputes a figure, so a ledger somebody could amend afterwards is not evidence
   * of anything — SELECT and INSERT only. The two state tables need UPDATE, which is the
   * watermark's whole mechanism, and neither gets DELETE (migration 0055, ADR-0014).
   */
  it("shapes the drawdown's privileges: state updatable, ledger append-only", async () => {
    const { rows } = await harness.owner.query<{
      relname: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT c.relname,
              has_table_privilege('idenzy_app', c.oid, 'SELECT') AS sel,
              has_table_privilege('idenzy_app', c.oid, 'INSERT') AS ins,
              has_table_privilege('idenzy_app', c.oid, 'UPDATE') AS upd,
              has_table_privilege('idenzy_app', c.oid, 'DELETE') AS del
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('usage_billing_state', 'org_debts', 'usage_charges')
       ORDER BY c.relname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.sel, row.relname).toBe(true);
      expect(row.ins, row.relname).toBe(true);
      expect(row.del, row.relname).toBe(false);
      expect(row.upd, row.relname).toBe(row.relname !== "usage_charges");
    }
  });

  /**
   * The email feedback loop's tables, on the same principle: an exclusion above is a claim
   * and a claim is asserted. All three need UPDATE — a counter is incremented, a hold is
   * released, an event is marked processed — and none gets DELETE. Removing a counter or an
   * idempotency record is retention and runs through a SECURITY DEFINER function; removing a
   * hold would erase the evidence a stopped customer is owed (migration 0057).
   */
  it("shapes the email feedback loop's privileges: updatable, never deletable", async () => {
    const { rows } = await harness.owner.query<{
      relname: string;
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(
      `SELECT c.relname,
              has_table_privilege('idenzy_app', c.oid, 'SELECT') AS sel,
              has_table_privilege('idenzy_app', c.oid, 'INSERT') AS ins,
              has_table_privilege('idenzy_app', c.oid, 'UPDATE') AS upd,
              has_table_privilege('idenzy_app', c.oid, 'DELETE') AS del
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('email_delivery_stats', 'email_sending_holds', 'email_provider_events')
       ORDER BY c.relname`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.sel, row.relname).toBe(true);
      expect(row.ins, row.relname).toBe(true);
      expect(row.upd, row.relname).toBe(true);
      expect(row.del, row.relname).toBe(false);
    }
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
   * The same claim for the two tables that record what a refund or a dispute did to a wallet.
   * The provider may correct either as a case develops, so they update; nothing may remove one,
   * because the credit it took or gave back cannot be reconciled without it.
   */
  it.each(["payment_refunds", "payment_disputes"])(
    "withholds delete on %s while granting the rest",
    async (table) => {
      const { rows } = await harness.owner.query<{ priv: string; granted: boolean }>(
        `SELECT p.priv, has_table_privilege('idenzy_app', $1::text, p.priv) AS granted
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)`,
        [table],
      );
      expect(rows).toEqual([
        { priv: "SELECT", granted: true },
        { priv: "INSERT", granted: true },
        { priv: "UPDATE", granted: true },
        { priv: "DELETE", granted: false },
      ]);
    },
  );

  /**
   * The same claim for `usage_periods`, which withholds both verbs rather than one (0046).
   *
   * A closed billing period is the figure an invoice is raised from, and it is written exactly
   * once — when its month is over and the sketches behind it are dropped. Nothing on the request
   * path has a reason to amend or remove one, and a record that can be rewritten afterwards is
   * not a record of anything. Since 0030 the defaults would have left both absent anyway; this
   * asserts the shape rather than the inheritance, because the defaults are invisible from the
   * migration that creates a table.
   */
  it("withholds update and delete on usage_periods while granting the rest", async () => {
    const { rows } = await harness.owner.query<{ priv: string; granted: boolean }>(
      `SELECT p.priv, has_table_privilege('idenzy_app', 'usage_periods', p.priv) AS granted
       FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS p(priv)`,
    );
    expect(rows).toEqual([
      { priv: "SELECT", granted: true },
      { priv: "INSERT", granted: true },
      { priv: "UPDATE", granted: false },
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
});

/**
 * The org-plane mirror of the block above (ADR-0011). Same negative shape, because the
 * argument is the same one: a wallet and a card list guarded only by a predicate a
 * developer has to remember are one forgotten `where` from a cross-customer read, and on
 * the money surface that is the read a customer notices first.
 */
describe("the constraints an organisation owns", () => {
  /**
   * Provisioning: the one transaction that creates a tenant rather than working inside one.
   *
   * Still worth a test with no policy left to satisfy, because the property that mattered
   * was never really the WITH CHECK. It is that the organisation id is generated by
   * `UnitOfWork.provision` and never accepted from a caller, so all three rows name an id
   * no HTTP field could have chosen.
   */
  it("creates an organisation, its owner and its first project in one transaction", async () => {
    const orgId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const projectId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    const userId = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

    await harness.db.execute(
      sql`insert into orgs (id, name) values (${orgId}::uuid, 'Provisioned')`,
    );
    await harness.db.execute(
      sql`insert into org_members (org_id, user_id, role)
          values (${orgId}::uuid, ${userId}::uuid, 'owner')`,
    );
    await harness.db.execute(
      sql`insert into projects (id, org_id, name, kms_key_name)
          values (${projectId}::uuid, ${orgId}::uuid, 'First', 'k')`,
    );

    const seen = await harness.db.execute<{ name: string }>(
      sql`select name from projects where org_id = ${orgId}::uuid`,
    );
    expect(seen.rows).toHaveLength(1);
    expect(seen.rows[0]?.name).toBe("First");
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
   * Somebody following an invite link is not in the organisation yet, so there is no
   * organisation to scope the lookup to. `resolve_open_invitation` is the narrow way through,
   * and the point of this test is that it stays narrow: it resolves an open invitation and
   * nothing else. With no policy underneath, narrow is the whole of the guarantee.
   */
  it("resolves an open invitation with no organisation bound, and only an open one", async () => {
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

  /**
   * The gap 0059 exists to close. 0001 created three months and nothing called the function
   * again, so a deploy left running would eventually reject every audit insert — the integrity
   * control going dark rather than falling behind.
   */
  it("keeps partitions ahead of the clock, called as the app role", async () => {
    const created = await harness.db.execute<{ created: string }>(
      sql`select ensure_audit_partitions_ahead(3) as created`,
    );
    expect(Number(created.rows[0]?.created ?? -1)).toBeGreaterThanOrEqual(0);

    const { rows } = await harness.owner.query<{ missing: string }>(
      `SELECT count(*) AS missing
       FROM generate_series(0, 3) AS m(n)
       WHERE to_regclass(
         format('public.audit_events_%s',
                to_char(date_trunc('month', CURRENT_DATE) + make_interval(months => m.n), 'YYYY_MM'))
       ) IS NULL`,
    );
    expect(Number(rows[0]?.missing)).toBe(0);
  });

  /**
   * The wrapper is doing the privilege work, and that is the point of it being SECURITY DEFINER.
   * `idenzy_app` owns nothing and holds only USAGE on the schema, so calling the inner function
   * directly must still fail — otherwise the grant would be a way for any connection to create
   * tables, which is a far larger privilege than keeping partitions ahead.
   */
  it("does not let the app role create a partition except through the maintainer", async () => {
    await expectInsufficientPrivilege(
      harness.db.execute(sql`select ensure_audit_partition('2097-03-01'::date)`),
    );
  });

  it("creates maintainer-made partitions append-only, like every other one", async () => {
    await harness.db.execute(sql`select ensure_audit_partitions_ahead(3)`);
    const name = `audit_events_${new Date().toISOString().slice(0, 7).replace("-", "_")}`;
    const { rows } = await harness.owner.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('idenzy_app', $1, 'UPDATE') AS upd,
              has_table_privilege('idenzy_app', $1, 'DELETE') AS del`,
      [name],
    );
    expect(rows[0]).toEqual({ upd: false, del: false });
  });
});
