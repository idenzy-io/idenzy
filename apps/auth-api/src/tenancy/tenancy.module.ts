import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { DATABASE } from "../persistence/persistence.module.js";
import { ProjectResolver } from "./project-resolver.js";
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
    { provide: APP_GUARD, useClass: TenantResolutionGuard },
  ],
  exports: [ProjectResolver],
})
export class TenancyModule {}
