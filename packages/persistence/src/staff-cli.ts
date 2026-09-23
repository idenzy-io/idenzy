import pg from "pg";
import { StaffAdministration } from "./repository/staff-administration.js";

/**
 * `pnpm staff`: who may use the operator console (ADR-0018).
 *
 *   pnpm staff add <email> <support|billing|admin> [note…]
 *   pnpm staff role <email> <support|billing|admin>
 *   pnpm staff deactivate <email>
 *   pnpm staff list
 *
 * Connects as the owner (`DATABASE_MIGRATION_URL`, else `DATABASE_URL`), because the application
 * role cannot write `staff` at all. Exempt from noProcessEnv in biome.json for the reason
 * `migrate.ts` is: a standalone job that runs outside the application.
 */
const USAGE = `usage:
  pnpm staff add <email> <support|billing|admin> [note…]
  pnpm staff role <email> <support|billing|admin>
  pnpm staff deactivate <email>
  pnpm staff list
`;

async function main(): Promise<void> {
  const [command, email, role, ...rest] = process.argv.slice(2);
  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    process.stderr.write("DATABASE_MIGRATION_URL or DATABASE_URL must be set.\n");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const staff = new StaffAdministration(client);
  try {
    switch (command) {
      case "add":
        if (email === undefined || role === undefined) break;
        await staff.add(email, role, rest.join(" "));
        process.stdout.write(`${email.toLowerCase()} is ${role}\n`);
        return;
      case "role":
        if (email === undefined || role === undefined) break;
        process.stdout.write((await staff.setRole(email, role)) ? "updated\n" : "no such staff\n");
        return;
      case "deactivate":
        if (email === undefined) break;
        process.stdout.write((await staff.deactivate(email)) ? "deactivated\n" : "not active\n");
        return;
      case "list":
        for (const row of await staff.list()) {
          const state = row.active ? "active" : "inactive";
          process.stdout.write(`${row.email}\t${row.role}\t${state}\t${row.note}\n`);
        }
        return;
      default:
        break;
    }
    process.stderr.write(USAGE);
    process.exitCode = 1;
  } catch (cause: unknown) {
    process.stderr.write(`${cause instanceof Error ? cause.message : "failed"}\n`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
