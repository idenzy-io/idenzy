import { AppConfig } from "@idenzy/config/app-config";
import { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";
import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE } from "../persistence/persistence.module.js";
import { LocalCell } from "./local-cell.js";
import { ProjectResolver } from "./project-resolver.js";
import { SecretKeyGuard } from "./secret-key.guard.js";
import { TenantResolutionGuard } from "./tenant-resolution.guard.js";

/**
 * Project resolution (PROJECT.md 9.3 step 3).
 *
 * The guard is registered globally rather than per controller, so "no tenant, no
 * request" is the default and an endpoint that genuinely has none opts out with
 * @NoTenant. That makes adding an unauthenticated route a visible line in a diff instead
 * of a missing decorator nobody notices.
 */
@Global()
@Module({
  providers: [
    {
      provide: ProjectResolver,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new ProjectResolver(db),
    },
    /*
     * Constructed without a query, so the composition root still compiles without a database
     * (`wiring.test.ts`). The id it needs for the Host path is resolved on first use, and
     * `main.ts` warms it at boot so a bad CELL_CODE is a startup failure rather than a refusal.
     */
    {
      provide: LocalCell,
      inject: [AppConfig, DATABASE],
      useFactory: (config: AppConfig, db: NodePgDatabase) =>
        new LocalCell(config.get("CELL_CODE"), new RegionCellReader(db)),
    },
    { provide: APP_GUARD, useClass: TenantResolutionGuard },
    // After it, and the order matters: this reads the credential kind that one recorded.
    { provide: APP_GUARD, useClass: SecretKeyGuard },
  ],
  exports: [ProjectResolver, LocalCell],
})
export class TenancyModule {}
