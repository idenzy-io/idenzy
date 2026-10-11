import { InternalError } from "@idenzy/core/errors";

/**
 * The scheme that marks a setting as a pointer rather than a value.
 *
 * `STRIPE_SECRET_KEY=secret://stripe-secret-key` says *where the secret is*, not what it is. The
 * environment then holds references and the secrets live in a secret store, which is the whole
 * point: an `.env` file is copied to laptops, pasted into chat, printed by `docker inspect` and
 * committed by accident, and none of that matters if what it holds is a name.
 */
export const SECRET_SCHEME = "secret://";

/**
 * Where a secret actually lives (PROJECT.md 6.2).
 *
 * Provider-neutral on purpose: the reference in the environment is `secret://stripe-secret-key`
 * and not a Google resource path, so moving stores is a different adapter rather than an edit to
 * every deployment's configuration.
 */
export abstract class SecretSource {
  /** Fetches one secret by the name in its reference. Throws if it is not there. */
  abstract fetch(name: string): Promise<string>;
}

export function isSecretRef(value: string): boolean {
  return value.startsWith(SECRET_SCHEME);
}

function nameOf(value: string): string {
  return value.slice(SECRET_SCHEME.length);
}

/**
 * The settings that must never be a literal outside development.
 *
 * Each of these either is a credential or contains one — `DATABASE_URL` carries a password in its
 * userinfo, which is the one people forget because it does not look like a secret field.
 *
 * Declared as a list rather than inferred from the name, because inference would be wrong in both
 * directions: `STRIPE_PUBLISHABLE_KEY` has "key" in it and is meant to be public, and
 * `DATABASE_URL` has neither "key" nor "secret" in it and is the most sensitive value here.
 */
export const SENSITIVE_SETTINGS = [
  "DATABASE_URL",
  "DATABASE_MIGRATION_URL",
  "VALKEY_URL",
  "CLICKHOUSE_PASSWORD",
  "CLICKHOUSE_INGEST_PASSWORD",
  "CLICKHOUSE_OWNER_PASSWORD",
  "CLICKHOUSE_ERASER_PASSWORD",
  "AWS_SECRET_ACCESS_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "FIELD_KEY_WRAPPED",
] as const;

/**
 * Replaces every `secret://` reference with the value behind it.
 *
 * Runs **before** validation, because the schema checks shapes — `STRIPE_SECRET_KEY` must start
 * with `sk_` — and a reference satisfies none of them. Resolving first means the schema goes on
 * validating real values and needs to know nothing about secret stores.
 *
 * One fetch per distinct name however many settings point at it, and a failure names the setting
 * and the secret but never the value: a configuration error that logs the credential it failed to
 * load has done more damage than the outage it reports.
 */
export async function resolveSecretRefs(
  env: NodeJS.ProcessEnv,
  source: SecretSource,
): Promise<NodeJS.ProcessEnv> {
  const resolved: NodeJS.ProcessEnv = { ...env };
  const fetched = new Map<string, string>();

  for (const [setting, value] of Object.entries(env)) {
    if (value === undefined || !isSecretRef(value)) continue;
    const name = nameOf(value);

    let secret = fetched.get(name);
    if (secret === undefined) {
      try {
        secret = await source.fetch(name);
      } catch (cause: unknown) {
        throw new InternalError({
          detail: { setting, secret: name, reason: "the secret could not be fetched" },
          cause,
        });
      }
      fetched.set(name, secret);
    }
    resolved[setting] = secret;
  }
  return resolved;
}

/**
 * Refuses a deployment that carries a credential in its environment instead of a reference.
 *
 * This is what turns "we keep secrets in a secret store" from an intention into a control. Without
 * it the store is optional: everything works with the literal in `.env`, so the literal survives
 * one hurried deploy and then stays, and nothing ever says so.
 *
 * Development is exempt — a laptop has no secret store and a developer who had to provision one to
 * run the tests would keep a second `.env` anyway, which is worse.
 */
export function assertSecretsAreReferences(
  environment: string,
  env: NodeJS.ProcessEnv,
  settings: readonly string[] = SENSITIVE_SETTINGS,
): void {
  if (environment === "development") return;

  const inline = settings.filter((setting) => {
    const value = env[setting];
    return value !== undefined && value !== "" && !isSecretRef(value);
  });
  if (inline.length === 0) return;

  throw new InternalError({
    detail: {
      // The names only. The values are exactly what must not reach a log line.
      settings: inline,
      environment,
      reason: "a credential is set as a literal rather than a secret:// reference",
      remedy: `set these to ${SECRET_SCHEME}<name> and put the value in the secret store`,
      rule: "secrets live in a secret store, never in the environment (PROJECT.md 6.2)",
    },
  });
}
