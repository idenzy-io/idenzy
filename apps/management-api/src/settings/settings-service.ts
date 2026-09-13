import { ResourceNotFoundError } from "@idenzy/core/errors";
import { ProjectRepository } from "@idenzy/persistence/repository/project-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import {
  type PatchProjectSettings,
  type ProjectSettings,
  projectSettingsSchema,
} from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/**
 * A project's authentication configuration (PROJECT.md 3.2).
 *
 * The stored document is parsed through the schema on the way out rather than trusted, and
 * that is doing real work rather than being defensive: `projects.settings` is jsonb written
 * by whatever version of this code was deployed when it was saved, so a field that has
 * since changed shape, or one that never existed, has to resolve to today's default instead
 * of reaching a flow as whatever it happens to be. Parsing on read is what makes adding a
 * setting a deploy rather than a backfill.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  async read(context: OrgContext, projectId: string): Promise<ProjectSettings> {
    const tenant = await this.scope.of(context, projectId);
    const row = await this.uow.run(tenant, (tx) => new ProjectRepository(tx, tenant).current());
    if (row === null) throw new ResourceNotFoundError({ detail: { projectId } });
    return parse(row.settings);
  }

  /**
   * Applies a patch and answers with the whole document.
   *
   * The whole document, because a screen that redrew from what it sent would be showing
   * what it asked for rather than what was stored — and the two differ whenever a value is
   * clamped, defaulted, or written by somebody else between the read and the save.
   */
  async patch(
    context: OrgContext,
    projectId: string,
    patch: PatchProjectSettings,
  ): Promise<ProjectSettings> {
    const tenant = await this.scope.of(context, projectId);
    const row = await this.uow.run(tenant, (tx) =>
      new ProjectRepository(tx, tenant).mergeSettings(patch),
    );
    if (row === null) throw new ResourceNotFoundError({ detail: { projectId } });
    return parse(row.settings);
  }
}

/**
 * Today's shape of whatever was stored.
 *
 * A stored document that no longer parses resolves to defaults rather than throwing: the
 * alternative is a settings screen that cannot be opened to fix the value that broke it,
 * and a sign-in path that fails closed on a configuration read. Defaults are the safe
 * answer for every field here, which is what makes that trade available.
 */
function parse(stored: Readonly<Record<string, unknown>>): ProjectSettings {
  const parsed = projectSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : projectSettingsSchema.parse({});
}
