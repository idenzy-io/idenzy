import { AuditEventReader } from "@idenzy/persistence/repository/audit-event-reader";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuditActorType, AuditCategory } from "@idenzy/protocol/enums/compliance";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { AuditService } from "../dist/audit/audit-service.js";

/**
 * What the Audit screen reads, against a real Postgres.
 *
 * Seeded through `append_audit_event` rather than by inserting rows, because that function
 * is the only way anything writes this table and it is where the partition is ensured. A
 * test that reached past it would be reading a table shaped differently from the one the
 * relay fills.
 *
 * The case that matters most is the last one. Everything above it could pass while the
 * repository read across tenants, because a single-project fixture cannot tell the
 * difference — and this is the table where that would matter most.
 */

const harness = new PostgresHarness();
const ORG = "88888888-8888-8888-8888-888888888888";
const PROJECT = "99999999-9999-4999-8999-999999999999";
const OTHER_PROJECT = "aaaaaaaa-9999-4999-8999-999999999999";
const ALICE = "dddddddd-0000-4000-8000-000000000001";

let uow: UnitOfWork;
let service: AuditService;
let events: AuditEventReader;

const publicOf = (uuid: string): string => `prj_${uuid.replaceAll("-", "")}`;
const userPublicId = (uuid: string): string => `usr_${uuid.replaceAll("-", "")}`;
const context = { orgId: ORG } as OrgContext;

/** Resolves whichever project it is asked for, so a cross-tenant read is even possible. */
class PassthroughScope {
  async of(_context: OrgContext, publicId: string): Promise<TenantContext> {
    const hex = publicId.slice("prj_".length);
    const dashed = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
    return await Promise.resolve(new TenantContext(dashed, "req_test", "customer_staff"));
  }
}

let chainTip = "0".repeat(64);

async function append(
  projectId: string,
  fields: {
    action: string;
    actorType?: string;
    actorId?: string | null;
    target?: string | null;
    at?: Date;
  },
): Promise<void> {
  const entryHash = `${chainTip.slice(0, 32)}${Math.random().toString(16).slice(2, 10)}`.padEnd(
    64,
    "0",
  );
  await events.append({
    projectId,
    actorType: fields.actorType ?? AuditActorType.EndUser,
    actorId: fields.actorId === undefined ? ALICE : fields.actorId,
    action: fields.action,
    target: fields.target ?? null,
    ip: "203.0.113.7",
    ua: "vitest",
    metadata: {},
    prevHash: chainTip,
    entryHash,
    outboxSeq: null,
    createdAt: fields.at ?? new Date(),
  });
  chainTip = entryHash;
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  events = new AuditEventReader(harness.db);
  service = new AuditService(uow, new PassthroughScope() as never);

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  await harness.owner.query(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES ($1, 'Acme', (SELECT id FROM region_cells LIMIT 1))`,
    [ORG],
  );
  for (const project of [PROJECT, OTHER_PROJECT]) {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [project]);
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
       VALUES ($1, $2, 'p', (SELECT id FROM region_cells LIMIT 1), 'k')`,
      [project, ORG],
    );
  }
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO users (id, project_id, email, display_name, email_verified)
     VALUES ($1, $2, 'alice@example.test', 'Alice Doe', true)`,
    [ALICE, PROJECT],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("the trail a screen reads", () => {
  it("returns entries newest first, with the name behind the id", async () => {
    await append(PROJECT, { action: "user.signed_in" });
    await append(PROJECT, { action: "user.password_changed" });

    const page = await service.list(context, publicOf(PROJECT), { limit: 50 });

    expect(page.events).toHaveLength(2);
    expect(page.events[0]?.action).toBe("user.password_changed");
    expect(page.events[0]?.seq).toBeGreaterThan(page.events[1]?.seq ?? 0);
    // The id goes out in the public form every other answer uses, and the name is the
    // thing the trail does not store.
    expect(page.events[0]?.actorId).toBe(userPublicId(ALICE));
    expect(page.events[0]?.actorName).toBe("Alice Doe");
    expect(page.events[0]?.category).toBe(AuditCategory.Accounts);
  });

  /**
   * The category is derived from the prefix and is not a column, so an action nobody has
   * classified still has to come back readable rather than be dropped or throw.
   */
  it("files an unknown action under settings rather than losing it", async () => {
    await append(PROJECT, { action: "something.nobody.mapped" });
    const page = await service.list(context, publicOf(PROJECT), { limit: 50 });
    const found = page.events.find((event) => event.action === "something.nobody.mapped");
    expect(found?.category).toBe(AuditCategory.Settings);
  });

  it("narrows by category, by actor kind and by actor", async () => {
    await append(PROJECT, {
      action: "key.created",
      actorType: AuditActorType.Member,
      actorId: "m1",
    });

    const keys = await service.list(context, publicOf(PROJECT), {
      limit: 50,
      categories: [AuditCategory.Keys],
    });
    expect(keys.events.every((event) => event.action.startsWith("key."))).toBe(true);
    expect(keys.events).not.toHaveLength(0);

    const team = await service.list(context, publicOf(PROJECT), {
      limit: 50,
      actorTypes: [AuditActorType.Member],
    });
    expect(team.events.every((event) => event.actorType === AuditActorType.Member)).toBe(true);

    const mine = await service.list(context, publicOf(PROJECT), {
      limit: 50,
      actorId: userPublicId(ALICE),
    });
    expect(mine.events).not.toHaveLength(0);
    expect(mine.events.every((event) => event.actorId === userPublicId(ALICE))).toBe(true);
  });

  /**
   * Keyset on `seq`, which this table can do because `seq` is per-project, unique and
   * monotonic. The assertion that matters is that the two pages do not overlap: an offset
   * would repeat or skip a row for every entry written behind the reader, which on a busy
   * project is every page.
   */
  it("pages without repeating or skipping an entry", async () => {
    const all = await service.list(context, publicOf(PROJECT), { limit: 100 });
    expect(all.events.length).toBeGreaterThan(2);

    const first = await service.list(context, publicOf(PROJECT), { limit: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await service.list(context, publicOf(PROJECT), {
      limit: 100,
      cursor: first.nextCursor ?? undefined,
    });

    const seen = [...first.events, ...second.events].map((event) => event.seq);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(all.events.map((event) => event.seq));
  });

  /**
   * The one that matters. Everything above could pass while the repository read across
   * tenants, and an audit trail is the worst table for that to be true of.
   */
  it("never returns another project's entries", async () => {
    await append(OTHER_PROJECT, { action: "user.signed_in", actorId: null });

    const mine = await service.list(context, publicOf(PROJECT), { limit: 100 });
    const theirs = await service.list(context, publicOf(OTHER_PROJECT), { limit: 100 });

    expect(theirs.events).toHaveLength(1);
    expect(mine.events.map((event) => event.id)).not.toContain(theirs.events[0]?.id);
  });

  /**
   * The trail outlives its subject on purpose — `actor_id` is retained pseudonymously
   * through an erasure — so a name that cannot be resolved is null and never the id
   * dressed up as one.
   */
  it("leaves the name null when the account behind it is gone", async () => {
    const ghost = "eeeeeeee-0000-4000-8000-00000000000f";
    await append(PROJECT, { action: "user.deleted", actorId: ghost });

    const page = await service.list(context, publicOf(PROJECT), { limit: 100 });
    const entry = page.events.find((event) => event.action === "user.deleted");
    expect(entry?.actorId).toBe(userPublicId(ghost));
    expect(entry?.actorName).toBeNull();
  });
});
