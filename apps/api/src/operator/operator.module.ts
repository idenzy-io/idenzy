import { AppConfig } from "@idenzy/config/app-config";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { AccessTokenVerifier } from "@idenzy/node";
import { OperatorOrgReader } from "@idenzy/persistence/repository/operator-org-reader";
import { StaffReader } from "@idenzy/persistence/repository/staff-reader";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE } from "../persistence/persistence.module.js";
import { OperatorController } from "./operator.controller.js";
import { OPERATOR_PROJECT, OPERATOR_VERIFIER, StaffGuard } from "./staff.guard.js";

/**
 * Idenzy's operator surface, `/v1/operator/*` (ADR-0018).
 *
 * Its own verifier, bound to the operator project, rather than the dashboard's: the two audiences
 * must never accept each other's tokens. With `OPERATOR_PROJECT_ID` unset both tokens resolve to
 * null and the guard refuses every operator route, which is a correct deployment and a closed one.
 * Global so a later module's operator routes are guarded by the same instance.
 */
@Global()
@Module({
  controllers: [OperatorController],
  providers: [
    {
      provide: OPERATOR_VERIFIER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): AccessTokenVerifier | null => {
        const projectId = config.get("OPERATOR_PROJECT_ID");
        return projectId === undefined
          ? null
          : new AccessTokenVerifier({ issuerUrl: config.get("ISSUER_BASE_URL"), projectId });
      },
    },
    {
      provide: OPERATOR_PROJECT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): string | null => {
        const projectId = config.get("OPERATOR_PROJECT_ID");
        return projectId === undefined ? null : PublicId.parse(IdPrefix.Project, projectId).uuid;
      },
    },
    {
      provide: StaffReader,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new StaffReader(db),
    },
    {
      provide: OperatorOrgReader,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new OperatorOrgReader(db),
    },
    StaffGuard,
    { provide: APP_GUARD, useExisting: StaffGuard },
  ],
  exports: [StaffReader, OperatorOrgReader],
})
export class OperatorModule {}
