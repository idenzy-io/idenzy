import { ResourceConflictError } from "@idenzy/core/errors";
import { and, asc, eq } from "drizzle-orm";
import { projectOrigins } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface ProjectOriginRow {
  readonly id: string;
  readonly origin: string;
  readonly createdAt: Date;
}

function toRow(row: typeof projectOrigins.$inferSelect): ProjectOriginRow {
  return { id: row.id, origin: row.origin, createdAt: row.createdAt };
}

/**
 * The browser origins a project trusts with a credentialed response (ADR-0006).
 *
 * This list and nothing else is the CORS allowlist. `redirect_uris` and
 * `webauthn_relying_parties.origins` look like they would do and neither does: a redirect
 * target can be `myapp://callback`, which never appears in an `Origin` header; an SPA on
 * `www.example.com` may call the API while its OAuth return lands on `app.example.com`; and
 * WebAuthn forbids an origin outside the relying party's registrable domain where CORS does
 * not. Deriving one from another would also make a privilege change invisible, because
 * whoever registered a redirect URI would be widening what a browser may read.
 *
 * The unique index is per project rather than across all of them, unlike a hostname: two
 * projects may legitimately allow the same origin — a customer running two projects from one
 * application is the ordinary case — so a conflict here means this project already allows it
 * and can be said plainly.
 *
 * Nothing caches what this writes. `resolve_project_by_host` and `resolve_project_by_key_hash`
 * read `allowed_origins` on every request, so an addition takes effect on the next one; when
 * the project-config cache PROJECT.md 4.2 assumes exists, its invalidation belongs at the
 * caller of this repository rather than here.
 */
export class ProjectOriginRepository extends BaseRepository<typeof projectOrigins> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, projectOrigins);
  }

  /**
   * Ordered by the origin itself, not by when it was added.
   *
   * A list of a dozen is read by somebody looking for one of them, and an order that depends
   * on the order they were added is one that reshuffles under every edit.
   */
  async list(): Promise<ProjectOriginRow[]> {
    const rows = await this.tx
      .select()
      .from(projectOrigins)
      .where(this.tenantScope())
      .orderBy(asc(projectOrigins.origin));
    return rows.map(toRow);
  }

  /** Allows one. A conflict is the per-project unique index, which the caller explains. */
  async add(origin: string): Promise<ProjectOriginRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(projectOrigins)
        .values({ projectId: this.context.projectId, origin })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceConflictError({ detail: { origin } });
    return toRow(row);
  }

  /**
   * Stops allowing one. A hard delete, because the row is the permission.
   *
   * A tombstone would either keep granting or keep the origin claimed against somebody
   * re-adding it, and there is nothing here worth keeping afterwards: who allowed what and
   * when is the audit trail's, and it does not live on this row.
   */
  async remove(id: string): Promise<boolean> {
    const rows = await this.tx
      .delete(projectOrigins)
      .where(and(this.tenantScope(), eq(projectOrigins.id, id)))
      .returning({ id: projectOrigins.id });
    return rows.length === 1;
  }
}
