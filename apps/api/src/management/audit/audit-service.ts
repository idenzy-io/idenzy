import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  ProjectAuditRepository,
  type ProjectAuditRow,
} from "@idenzy/persistence/repository/project-audit-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  AUDIT_CATEGORY_PREFIXES,
  AUDIT_DEFAULT_CATEGORY,
  type AuditActorType,
  type AuditCategory,
} from "@idenzy/protocol/enums/compliance";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  ProjectAuditEvent,
  ProjectAuditList,
  ProjectAuditQuery,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * One project's audit trail, for the panel's Audit screen (PROJECT.md 4.13.3).
 *
 * There is no write here and there will not be one. `audit_events` grants the runtime role
 * SELECT and INSERT, the insert belongs to the relay in `apps/workers` because the chain
 * has exactly one writer, and UPDATE and DELETE are withheld at the database. A service
 * offering an edit would be proposing something the grant already refuses.
 *
 * Every filter is applied by the query rather than by the screen. That is forced by
 * paging: a page of fifty cannot be narrowed client-side and still have a pager that means
 * anything, which is why the actor and category vocabularies moved to `@idenzy/protocol`.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  async list(
    context: OrgContext,
    projectId: string,
    query: ProjectAuditQuery,
  ): Promise<ProjectAuditList> {
    const tenant = await this.scope.of(context, projectId);
    return await this.uow.transaction(async (tx) => {
      const repository = new ProjectAuditRepository(tx, tenant);
      const page = await repository.list({
        limit: query.limit,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.actorTypes === undefined ? {} : { actorTypes: query.actorTypes }),
        ...(query.categories === undefined ? {} : { categories: query.categories }),
        ...(query.actorId === undefined ? {} : { actorId: actorIdOf(query.actorId) }),
        ...(query.search === undefined ? {} : { search: query.search }),
        ...(query.from === undefined ? {} : { from: new Date(query.from) }),
        ...(query.to === undefined ? {} : { to: new Date(query.to) }),
      });

      // One read for the whole page rather than one per row, the same shape the users list
      // uses for the three columns that are not columns.
      const names = await repository.accountNames(
        page.rows.flatMap((row) => [row.actorId, row.target].filter(isPresent)),
      );
      return {
        events: page.rows.map((row) => present(row, names)),
        nextCursor: page.nextCursor,
      };
    });
  }
}

/**
 * The public id a screen sends back, turned into what the column holds.
 *
 * An actor id is stored as whatever identified the actor, which for an account is a bare
 * uuid. The panel only ever has the `usr_` form, so it is decoded here and anything that
 * is not one is passed through — an API key's id or a staff grant is not a user and must
 * still be selectable.
 */
function actorIdOf(given: string): string {
  if (!given.startsWith(`${IdPrefix.User}_`)) return given;
  try {
    return PublicId.parse(IdPrefix.User, given).uuid;
  } catch {
    return given;
  }
}

function isPresent(value: string | null): value is string {
  return value !== null;
}

function present(row: ProjectAuditRow, names: ReadonlyMap<string, string>): ProjectAuditEvent {
  return {
    id: row.id,
    seq: row.seq,
    createdAt: row.createdAt.toISOString(),
    // Safe: `actor_type` is written only from a `TenantContext`, whose vocabulary is this
    // one. A row carrying anything else predates the column having a vocabulary at all.
    actorType: row.actorType as AuditActorType,
    actorId: row.actorId === null ? null : publicActorId(row.actorType, row.actorId),
    actorName: row.actorId === null ? null : (names.get(row.actorId) ?? null),
    action: row.action,
    category: categoryOf(row.action),
    target: row.target,
    targetName: row.target === null ? null : (names.get(row.target) ?? null),
    ip: row.ip,
    ua: row.ua,
    metadata: row.metadata,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
  };
}

/**
 * An account's id goes out in the public form every other answer uses; nothing else does.
 *
 * A bare uuid in one screen and `usr_…` in every other is the bug the users list already
 * had once. An API key id or a staff grant is not a user, so it is not dressed as one.
 */
function publicActorId(actorType: string, actorId: string): string {
  return actorType === "user" && isUuid(actorId)
    ? PublicId.encode(IdPrefix.User, actorId).toString()
    : actorId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * The category an action falls into, from its prefix.
 *
 * Derived rather than stored, and the same mapping the screen's menu is built from. An
 * action whose prefix names no category is a setting, which is where a new one lands until
 * somebody decides otherwise — nothing is dropped and nothing is an error, because a
 * release that starts emitting an action this one has not heard of must still be readable.
 */
function categoryOf(action: string): AuditCategory {
  const prefix = action.split(".")[0] ?? "";
  for (const [category, prefixes] of Object.entries(AUDIT_CATEGORY_PREFIXES)) {
    if (prefixes.includes(prefix)) return category as AuditCategory;
  }
  return AUDIT_DEFAULT_CATEGORY;
}
