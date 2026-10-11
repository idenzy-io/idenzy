import { applyMigrations } from "./apply-migrations.js";

/**
 * `pnpm db:migrate` on a developer's machine, with the URL from `.env`.
 *
 * One of only two files exempt from the noProcessEnv rule: it runs before the application, and
 * therefore before @idenzy/config exists to read for it. The exemption is declared in biome.json,
 * not suppressed inline. A deployment runs `apps/api`'s `dist/migrate.js` instead, which reads the
 * URL through the same configuration, secret references and all, as the API itself.
 */
async function main(): Promise<void> {
  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    process.stderr.write("DATABASE_MIGRATION_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }
  await applyMigrations(url);
  process.stdout.write("migrations applied\n");
}

await main();
