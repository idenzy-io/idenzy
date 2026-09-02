import { pgRole } from "drizzle-orm/pg-core";

/**
 * The runtime role. Created NOBYPASSRLS by a custom migration, and the only role the
 * application ever connects as (PROJECT.md 9.4, ADR-0003).
 *
 * Marked `.existing()` because role creation, grants and FORCE ROW LEVEL SECURITY are
 * hand-authored: drizzle-kit does not generate them.
 */
export const appRole = pgRole("idenzy_app").existing();

/** Schema owner. Runs migrations, never serves requests. */
export const ownerRole = pgRole("idenzy_owner").existing();
