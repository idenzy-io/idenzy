import { ResourceConflictError, ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  ProjectOriginRepository,
  type ProjectOriginRow,
} from "@idenzy/persistence/repository/project-origin-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type { ProjectOrigin } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * The CORS allowlist: which browser origins may read a credentialed response (ADR-0006).
 *
 * What a row here buys is narrow and worth stating exactly. The auth API answers a request
 * from an unregistered origin normally and simply omits `Access-Control-Allow-Origin`, so the
 * browser discards the response and reports a CORS error while our own logs show a 200. That
 * is the failure this list fixes, and it is invisible from the server end — which is why the
 * panel's screen is a diagnosis screen and why reading this list is allowed a rank lower than
 * writing it.
 *
 * It grants nothing else. An origin on this list cannot sign anybody in, cannot read a
 * session it does not already hold, and gets no ambient credential on the shared host, where
 * cookie mode is refused because `SameSite` makes it impossible.
 *
 * Nothing caches it. The resolution functions read `allowed_origins` per request, so an
 * addition takes effect on the next one and a removal stops a page reading on the one after
 * it. When the project-config cache PROJECT.md 4.2 assumes exists, invalidation goes here,
 * beside the writes, and the removal is the one that must not be allowed to go stale.
 */
@Injectable()
export class OriginsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  async list(context: OrgContext, projectId: string): Promise<ProjectOrigin[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.run(tenant, (tx) => new ProjectOriginRepository(tx, tenant).list());
    return rows.map(present);
  }

  /**
   * Allows one.
   *
   * The origin arrives canonical from the schema, so the conflict below is about the same
   * origin rather than another spelling of it. Saying it plainly is safe here in a way it is
   * not for a hostname: the index is per project, so a conflict is this project's own list
   * and tells a caller nothing about anybody else's.
   */
  async add(context: OrgContext, projectId: string, origin: string): Promise<ProjectOrigin> {
    const tenant = await this.scope.of(context, projectId);
    try {
      const row = await this.uow.run(tenant, (tx) =>
        new ProjectOriginRepository(tx, tenant).add(origin),
      );
      return present(row);
    } catch (cause: unknown) {
      if (cause instanceof ResourceConflictError) {
        throw new ResourceConflictError({
          message: "That origin is already allowed on this project.",
          detail: { origin },
          cause,
        });
      }
      throw cause;
    }
  }

  /**
   * Stops allowing one.
   *
   * Not found and already gone answer the same way, as everywhere else here: the first is not
   * an error worth its own code, and the second must not confirm that an id was ever real.
   */
  async remove(context: OrgContext, projectId: string, originId: string): Promise<void> {
    const tenant = await this.scope.of(context, projectId);
    const id = PublicId.parse(IdPrefix.Origin, originId).uuid;
    const removed = await this.uow.run(tenant, (tx) =>
      new ProjectOriginRepository(tx, tenant).remove(id),
    );
    if (!removed) throw new ResourceNotFoundError({ detail: { originId } });
  }
}

function present(row: ProjectOriginRow): ProjectOrigin {
  return {
    id: PublicId.encode(IdPrefix.Origin, row.id).value,
    origin: row.origin,
    createdAt: row.createdAt.toISOString(),
  };
}
