import { AppConfig } from "@idenzy/config/app-config";
import { applyMigrations } from "@idenzy/persistence/apply-migrations";
import { SecretManagerSource } from "@idenzy/providers-gcp/secret-manager-source";

/**
 * The migration job of a deployment: `node dist/migrate.js`, before a new revision takes traffic.
 *
 * It reads its connection the way the API reads everything, so `DATABASE_MIGRATION_URL` is a
 * Secret Manager reference outside development and the schema owner's password is never in an
 * environment file. It falls back to `DATABASE_URL` only in development, where one login holds both
 * roles.
 */
async function main(): Promise<void> {
  const config = await AppConfig.bootstrap((projectId) => new SecretManagerSource(projectId));
  const url =
    config.get("DATABASE_MIGRATION_URL") ??
    (config.get("IDENZY_ENV") === "development" ? config.get("DATABASE_URL") : undefined);
  if (url === undefined) {
    process.stderr.write("DATABASE_MIGRATION_URL is required outside development.\n");
    process.exit(1);
  }
  await applyMigrations(url);
  process.stdout.write("migrations applied\n");
}

await main();
