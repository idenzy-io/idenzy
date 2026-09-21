import { AppConfig } from "@idenzy/config/app-config";
import { createPool } from "@idenzy/persistence/connection/pool";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Global, Module } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

/** Injection token for the raw Drizzle handle. Only UnitOfWork and the resolver take it. */
export const DATABASE = "DATABASE";

/**
 * The pool and the unit of work (PROJECT.md 9.4).
 *
 * Repositories are deliberately not providers. They are transaction-scoped, so a service
 * constructs the ones it needs inside `UnitOfWork.run`, where the tenant is already bound
 * to the connection. A repository that could be injected as a singleton would be a
 * repository that could exist without a transaction.
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
  ],
  exports: [DATABASE, UnitOfWork],
})
export class PersistenceModule {}
