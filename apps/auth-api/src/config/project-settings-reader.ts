import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { ProjectRepository } from "@idenzy/persistence/repository/project-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectSettings,
  projectSettingsSchema,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";

/**
 * The project's own authentication configuration, for the flows that have to obey it
 * (PROJECT.md 3.2).
 *
 * One primary-key read per call, and that cost is the reason this is a class rather than a
 * line inside each flow: PROJECT.md 4.2 assumes a project-config cache and todo.md still
 * lists it as open, so when it lands it lands here and nothing else changes. It is
 * deliberately not on the refresh path, which is the hot one — only sign-up, sign-in and
 * reset ask, and each of those already costs several writes.
 *
 * The stored document is parsed rather than trusted, for the reason the management API
 * parses it too: `projects.settings` is jsonb written by whatever version of this code was
 * deployed at the time, so a field that has since changed shape has to resolve to today's
 * default instead of reaching a flow as whatever it happens to be.
 *
 * A document that will not parse, or a project row that is somehow absent, resolves to the
 * defaults instead of throwing. That is the safe direction here and only because it is:
 * every default is the stricter or the more permissive-by-design value the product ships
 * with, so a configuration read that fails leaves sign-in working exactly as an
 * unconfigured project does — rather than taking authentication down over a settings blob.
 */
@Injectable()
export class ProjectSettingsReader {
  constructor(private readonly uow: UnitOfWork) {}

  /** For a flow, which carries the request's own context. */
  async for(context: FlowContext): Promise<ProjectSettings> {
    return await this.forProject(context.projectId, context.requestId);
  }

  /**
   * For a caller that already holds a tenant scope rather than a flow context.
   *
   * The two exist because `FlowContext` carries a request's IP, user agent and locale, none
   * of which a settings read wants — and inventing them to satisfy the type would be a lie
   * about where the call came from.
   */
  async forProject(projectId: string, requestId: string): Promise<ProjectSettings> {
    const tenant = new TenantContext(projectId, requestId, "system");
    const row = await this.uow.run(tenant, (tx) => new ProjectRepository(tx, tenant).current());
    if (row === null) return DEFAULT_PROJECT_SETTINGS;
    const parsed = projectSettingsSchema.safeParse(row.settings);
    return parsed.success ? parsed.data : DEFAULT_PROJECT_SETTINGS;
  }
}
