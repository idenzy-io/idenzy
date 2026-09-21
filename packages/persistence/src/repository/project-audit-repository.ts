import {
  AUDIT_CATEGORY_PREFIXES,
  type AuditActorType,
  type AuditCategory,
} from "@idenzy/protocol/enums/compliance";
import { and, eq, gte, ilike, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { auditEvents } from "../schema/compliance.js";
import { users } from "../schema/identity.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface ProjectAuditRow {
  readonly id: string;
  readonly seq: number;
  readonly createdAt: Date;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly target: string | null;
  readonly ip: string | null;
  readonly ua: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly prevHash: string;
  readonly entryHash: string;
}

export interface ProjectAuditPage {
  readonly rows: readonly ProjectAuditRow[];
  readonly nextCursor: string | null;
}

export interface AuditListOptions {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly actorTypes?: readonly AuditActorType[] | undefined;
  readonly categories?: readonly AuditCategory[] | undefined;
  readonly actorId?: string | undefined;
  readonly search?: string | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

/**
 * One project's audit trail, as the screen reads it (PROJECT.md 4.13.3).
 *
 * Read-only and it will stay that way, because the runtime role's grant on this table is
 * SELECT and INSERT and the insert belongs to the relay, which is the chain's only writer.
 * There is deliberately no `update` or `delete` here for the same reason migration 0001
 * withheld the privileges: a repository that could offer them would be the one thing a
 * reviewer has to take on trust.
 *
 * Distinct from `AuditEventReader`, which serves the relay across every project through
 * SECURITY DEFINER functions because a relay binds no tenant. This one is ordinary and
 * tenant-scoped: the management API has already resolved which project the request acts
 * on, so the row policy is the second line of defence rather than something to get around.
 */
export class ProjectAuditRepository extends BaseRepository<typeof auditEvents> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, auditEvents);
  }

  /**
   * A page of entries, newest first.
   *
   * Keyset on `seq` alone, which this table can do and the users list cannot: `seq` is
   * per-project, unique and monotonic, so it is a total order with no tie to break. It is
   * also the order the chain is built in, so a page boundary never falls between two
   * entries a reader would expect to see linked. `audit_events_project_seq_idx` is the
   * index behind it.
   *
   * `created_at` is never the sort key here. It ties at millisecond precision, which is
   * the bug migration 0031 exists to record.
   */
  async list(options: AuditListOptions): Promise<ProjectAuditPage> {
    const predicates: SQL[] = [this.tenantScope()];

    if (options.actorTypes !== undefined && options.actorTypes.length > 0) {
      predicates.push(inArray(auditEvents.actorType, [...options.actorTypes]));
    }
    if (options.actorId !== undefined && options.actorId.length > 0) {
      predicates.push(eq(auditEvents.actorId, options.actorId));
    }
    if (options.from !== undefined) predicates.push(gte(auditEvents.createdAt, options.from));
    if (options.to !== undefined) predicates.push(lte(auditEvents.createdAt, options.to));

    const byCategory = categoryPredicate(options.categories);
    if (byCategory !== undefined) predicates.push(byCategory);

    const search = options.search?.trim();
    if (search !== undefined && search.length > 0) {
      const pattern = `%${escapeLike(search)}%`;
      // The three a reader has in hand: what was done, to what, and by whom. The actor's
      // name is not among them because it is not in this table — the service resolves it
      // after the page is chosen, and searching on it would mean joining four tables to a
      // scan this index already answers.
      const match = or(
        ilike(auditEvents.action, pattern),
        ilike(auditEvents.target, pattern),
        ilike(auditEvents.actorId, pattern),
      );
      if (match !== undefined) predicates.push(match);
    }

    const cursor = decodeCursor(options.cursor);
    if (cursor !== null) predicates.push(lt(auditEvents.seq, cursor));

    // One extra row, so "is there another page" is answered without a second count.
    const rows = await this.tx
      .select()
      .from(auditEvents)
      .where(and(...predicates))
      .orderBy(sql`${auditEvents.seq} desc`)
      .limit(options.limit + 1);

    const page = rows.slice(0, options.limit).map(toRow);
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor: rows.length > options.limit && last !== undefined ? encodeCursor(last.seq) : null,
    };
  }

  /**
   * Display names for the account ids an entry names, in one read per page.
   *
   * Only accounts. An entry's actor may also be a team member, an API key or a background
   * job, and none of those is a row in this project — `org_members` is org-scoped control
   * plane and a key's name lives beside it — so the service leaves those names null and
   * the screen prints the actor's kind instead. Resolving them means crossing a tenant
   * boundary for a label, which is not a trade worth making silently.
   *
   * Ids that resolve to nothing are simply absent from the map. That is the erased
   * account, and it is the normal case rather than an error: the trail outlives the
   * subject on purpose, which is what `Erasure.RetainPseudonymous` on `actor_id` means.
   */
  async accountNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(ids)].filter(isUuid);
    if (unique.length === 0) return new Map();
    const rows = await this.tx
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(and(this.scopeOf(users.projectId), inArray(users.id, unique)));
    const names = new Map<string, string>();
    for (const row of rows) {
      const name = row.displayName ?? row.email;
      if (name !== null) names.set(row.id, name);
    }
    return names;
  }

  /** `tenantScope()` names this repository's own table, and `users` is a different one. */
  private scopeOf(column: PgColumn): SQL {
    return eq(column, this.context.projectId);
  }
}

/** Cheap enough to be worth doing before a query rather than letting Postgres refuse one. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toRow(row: typeof auditEvents.$inferSelect): ProjectAuditRow {
  return {
    id: row.id,
    seq: Number(row.seq),
    createdAt: row.createdAt,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    target: row.target,
    ip: row.ip,
    ua: row.ua,
    metadata: asRecord(row.metadata),
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  };
}

/**
 * Categories as a predicate on the action's prefix.
 *
 * The category is not a column and must not become one: it is a way of grouping actions
 * for a menu, and an action added next year should fall into a group without a migration.
 * `like 'member.%'` is what that costs, and the prefix is the leading edge of the string
 * so the index is still usable.
 */
function categoryPredicate(categories: readonly AuditCategory[] | undefined): SQL | undefined {
  if (categories === undefined || categories.length === 0) return undefined;
  const prefixes = categories.flatMap((category) => AUDIT_CATEGORY_PREFIXES[category] ?? []);
  if (prefixes.length === 0) return undefined;
  return or(...prefixes.map((prefix) => ilike(auditEvents.action, `${escapeLike(prefix)}.%`)));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeCursor(seq: number): string {
  return Buffer.from(String(seq), "utf8").toString("base64url");
}

/**
 * A cursor we cannot read is treated as absent rather than as an error, exactly as the
 * users list treats one: it is our own opaque value, so a malformed one means a truncated
 * URL or a stale bookmark and the useful answer is the first page.
 */
function decodeCursor(cursor: string | undefined): number | null {
  if (cursor === undefined || cursor.length === 0) return null;
  try {
    const seq = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isSafeInteger(seq) ? seq : null;
  } catch {
    return null;
  }
}
