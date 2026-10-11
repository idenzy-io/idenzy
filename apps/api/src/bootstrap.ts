import { AppConfig } from "@idenzy/config/app-config";
import { fieldEncryptorFor, generateWrappedFieldKey } from "@idenzy/crypto/encryption/field-key";
import { createPool } from "@idenzy/persistence/connection/pool";
import { provisionPlatform } from "@idenzy/persistence/platform";
import { keyEncryptionFor } from "@idenzy/providers-gcp/key-encryption-for";
import { SecretManagerSource } from "@idenzy/providers-gcp/secret-manager-source";
import { drizzle } from "drizzle-orm/node-postgres";

/**
 * What a new deployment needs once, before its API can serve anybody: `node dist/bootstrap.js`.
 *
 *   field-key   A field-encryption key wrapped by KMS, printed for Secret Manager. Run before the
 *               first start: the API and the workers refuse to start without one.
 *   platform    The deployment's own organisation, the dashboard project the panel signs
 *               customers in through and the operator console's project, with their origins,
 *               the dashboard's auth domain and a publishable key each, printed once. Run after
 *               the migrations. Safe to run again: it finds what exists and leaves it alone.
 *
 * Reads its configuration the way the API does, secret references and all, and connects as the
 * runtime role: provisioning goes through the same privileges the management API has.
 */
async function main(): Promise<void> {
  const command = process.argv[2];
  const config = await AppConfig.bootstrap((projectId) => new SecretManagerSource(projectId));
  const env = config.get("IDENZY_ENV");
  const wrapping = keyEncryptionFor(env, config.get("KMS_KEY_NAME"));

  if (command === "field-key") {
    const wrapped = await generateWrappedFieldKey(wrapping);
    say("A field-encryption key, wrapped by KMS. Store it as the FIELD_KEY_WRAPPED secret:");
    say("");
    say(`  ${wrapped}`);
    return;
  }

  if (command === "platform") {
    const pool = createPool({ connectionString: config.get("DATABASE_URL"), max: 1 });
    try {
      const clientId = config.get("OPERATOR_GOOGLE_CLIENT_ID");
      const clientSecret = config.get("OPERATOR_GOOGLE_CLIENT_SECRET");
      const made = await provisionPlatform(drizzle(pool), {
        dashboardOrigin: config.get("DASHBOARD_ORIGIN"),
        dashboardAuthDomain: config.get("DASHBOARD_AUTH_DOMAIN"),
        operatorOrigin: config.get("OPERATOR_ORIGIN"),
        ...(clientId === undefined || clientSecret === undefined
          ? {}
          : { operatorGoogle: { clientId, clientSecret } }),
        encryptor: await fieldEncryptorFor(env, config.get("FIELD_KEY_WRAPPED"), wrapping),
      });
      for (const line of made.done) say(`made ${line}`);
      say("");
      say(`DASHBOARD_PROJECT_ID=prj_${made.dashboardProjectId.replaceAll("-", "")}`);
      say(`OPERATOR_PROJECT_ID=prj_${made.operatorProjectId.replaceAll("-", "")}`);
      const { dashboard, operator } = made.publishableKeys;
      if (dashboard !== undefined) say(`Dashboard publishable key, shown once: ${dashboard}`);
      if (operator !== undefined) say(`Operator publishable key, shown once: ${operator}`);
      if (clientId === undefined) {
        say("");
        say("The operator console has no way in until OPERATOR_GOOGLE_CLIENT_ID and _SECRET are");
        say("set and this is run again.");
      }
    } finally {
      await pool.end();
    }
    return;
  }

  process.stderr.write("usage: node dist/bootstrap.js field-key | platform\n");
  process.exitCode = 2;
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

await main();
