import { AppConfig } from "@idenzy/config/app-config";
import { createPool } from "@idenzy/persistence/connection/pool";
import { RegionCellReader } from "@idenzy/persistence/repository/region-cell-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Global, Module } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

/** Injection token for the raw Drizzle handle. Only UnitOfWork and the resolvers take it. */
export const DATABASE = "DATABASE";

/**
 * The pool and the unit of work (PROJECT.md 9.4).
 *
 * Repositories are deliberately not providers, exactly as in auth-api. They are
 * transaction-scoped, so a service builds the ones it needs inside `runForOrg`, where the
 * organisation is already bound to the connection. A repository that could be injected as
 * a singleton would be one that could exist without a transaction, and therefore without
 * a tenant (ADR-0011).
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): NodePgDatabase =>
        drizzle(
          createPool({
            connectionString: config.get("DATABASE_URL"),
            max: config.get("DATABASE_POOL_MAX"),
            statementTimeoutMillis: config.get("DATABASE_STATEMENT_TIMEOUT_MS"),
          }),
        ),
    },
    {
      provide: UnitOfWork,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new UnitOfWork(db),
    },
    // Keyed on nothing and the same list for everybody, so it is a provider rather than
    // something built per transaction: `region_cells` is the registry of stacks we run.
    {
      provide: RegionCellReader,
      inject: [DATABASE],
      useFactory: (db: NodePgDatabase) => new RegionCellReader(db),
    },
  ],
  exports: [DATABASE, UnitOfWork, RegionCellReader],
})
export class PersistenceModule {}
