import { AppConfig } from "@idenzy/config/app-config";
import { ValidationFailedError } from "@idenzy/core/errors";
import { AccessTokenVerifier } from "@idenzy/node";
import { OrgMembershipReader } from "@idenzy/persistence/repository/org-membership-reader";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE } from "../../persistence/persistence.module.js";
import { MembershipGuard } from "./membership.guard.js";
import { ProjectScope } from "./project-scope.js";

/**
 * Who is asking, and on behalf of which organisation (ADR-0011).
 *
 * The verifier is built once and held, because the JWKS source behind it caches and one
 * per request would fetch the key set per request.
 *
 * `DASHBOARD_PROJECT_ID` is read here and the process refuses to start without it. It is
 * optional in the shared config schema because `auth-api` and `workers` do not read it,
 * and a value this service cannot work without belongs in a loud failure at boot rather
 * than in a 500 on the first request.
 */
@Global()
@Module({
  providers: [
    {
      provide: OrgMembershipReader,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new OrgMembershipReader(db),
    },
    MembershipGuard,
    ProjectScope,
    { provide: APP_GUARD, useExisting: MembershipGuard },
    {
      provide: AccessTokenVerifier,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => {
        const projectId = config.get("DASHBOARD_PROJECT_ID");
        if (projectId === undefined) {
          throw new ValidationFailedError({
            message: "The environment is not valid.",
            fields: [{ path: "DASHBOARD_PROJECT_ID", code: "required" }],
          });
        }
        return new AccessTokenVerifier({
          issuerUrl: config.get("ISSUER_BASE_URL"),
          projectId,
        });
      },
    },
  ],
  exports: [OrgMembershipReader, AccessTokenVerifier, ProjectScope],
})
export class DashboardTenancyModule {}
