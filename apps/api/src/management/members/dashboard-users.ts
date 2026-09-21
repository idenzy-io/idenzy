import { AppConfig } from "@idenzy/config/app-config";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { ProjectUserRepository } from "@idenzy/persistence/repository/project-user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";

export interface DashboardPerson {
  readonly name: string;
  readonly email: string;
  readonly mfaEnrolled: boolean;
}

/**
 * The people behind an organisation's members.
 *
 * `org_members` holds a `user_id` and nothing else about the person, because the two live
 * in different planes: the team is org-scoped and the account is a row in our *own*
 * project's `users` table — we run the dashboard on our own product (PROJECT.md 9.5), so a
 * member of a customer's organisation is an end user of the Idenzy project.
 *
 * That is why this reads under `DASHBOARD_PROJECT_ID` rather than under the caller's
 * project. The scope is fixed at this one project and comes from configuration, never from
 * a request: a reader that took the project from the caller would be a way to read any
 * tenant's users through the members screen.
 *
 * Names are best-effort. A member whose account carries no display name shows as their
 * address, and one whose row cannot be read shows as unknown rather than being dropped —
 * somebody who cannot be named still has access, and a list that hid them would be the one
 * place that fact does not appear.
 */
@Injectable()
export class DashboardUsers {
  private readonly projectId: string;

  constructor(
    private readonly uow: UnitOfWork,
    config: AppConfig,
  ) {
    // Required at boot by DashboardTenancyModule, so this cannot be reached without one.
    const configured = config.get("DASHBOARD_PROJECT_ID") ?? "";
    this.projectId = PublicId.parse(IdPrefix.Project, configured).uuid;
  }

  /** One read for the whole list, keyed by the user id `org_members` holds. */
  async byId(userIds: readonly string[], requestId: string): Promise<Map<string, DashboardPerson>> {
    const found = new Map<string, DashboardPerson>();
    if (userIds.length === 0) return found;

    const tenant = new TenantContext(this.projectId, requestId, "system");
    const page = await this.uow.transaction((tx) =>
      // The operator read model, because it already derives `mfaEnabled` from a confirmed
      // factor — which is exactly what "holds a second factor for the dashboard" means.
      new ProjectUserRepository(tx, tenant).list({ limit: 100 }),
    );

    const wanted = new Set(userIds);
    for (const user of page.users) {
      if (!wanted.has(user.id)) continue;
      found.set(user.id, {
        name: user.displayName ?? user.email ?? "Unknown",
        email: user.email ?? "",
        mfaEnrolled: user.mfaEnabled,
      });
    }
    return found;
  }
}
