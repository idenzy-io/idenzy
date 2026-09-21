import { InternalError, ValidationFailedError } from "@idenzy/core/errors";
import { configSchema, type RawConfig } from "./schema.js";
import {
  assertSecretsAreReferences,
  resolveSecretRefs,
  type SecretSource,
} from "./secret-source.js";
import { assertTransportSecurity } from "./transport-security.js";

/**
 * Injectable configuration.
 *
 * The only place in the codebase permitted to read process.env. Everywhere else the
 * noProcessEnv rule rejects it, and this file is one of three exemptions declared
 * centrally in biome.json rather than suppressed inline, so the list of files that
 * touch the environment is readable in one place.
 */
export class AppConfig {
  private constructor(private readonly values: RawConfig) {}

  /**
   * Configuration for wherever this happens to be running.
   *
   * The one entry point a composition root should call. Development reads the environment as it
   * always did; anywhere else the environment holds `secret://` references and this resolves them
   * through the store the caller supplies.
   *
   * The two bootstrap values are read straight off `env` rather than through the schema, and they
   * have to be: the schema validates shapes — `STRIPE_SECRET_KEY` must begin `sk_` — and a
   * reference satisfies none of them, so there is nothing to parse until the secrets are in. It
   * stays inside this file, which is the only one permitted to read the environment (§7.5).
   *
   * `makeSource` is a factory rather than a `SecretSource`, so `@idenzy/config` depends on no
   * cloud provider and a composition root chooses the adapter.
   */
  static bootstrap(
    makeSource: (projectId: string) => SecretSource,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<AppConfig> {
    const environment = env["IDENZY_ENV"] ?? "development";
    if (environment === "development") return Promise.resolve(AppConfig.fromEnvironment(env));

    const projectId = env["GCP_PROJECT_ID"];
    if (projectId === undefined || projectId === "") {
      throw new InternalError({
        detail: {
          environment,
          reason: "GCP_PROJECT_ID is required to reach the secret store",
          rule: "secrets live in a secret store outside development (PROJECT.md 6.2)",
        },
      });
    }
    return AppConfig.load(makeSource(projectId), env);
  }

  /**
   * Configuration with its secrets fetched from the store, for a deployed environment.
   *
   * The order matters and is the reason this exists rather than a `get()` that resolves lazily.
   * References are replaced **before** the schema runs, because the schema validates shapes —
   * `STRIPE_SECRET_KEY` must begin `sk_` — and `secret://stripe-secret-key` satisfies none of
   * them. Resolving first keeps the schema validating real values and ignorant of secret stores.
   *
   * And the check comes before the fetch, so a deployment holding a literal credential is refused
   * without a network call: the finding is the literal, not whether the store happens to be up.
   */
  static async load(
    source: SecretSource,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<AppConfig> {
    const environment = env["IDENZY_ENV"] ?? "development";
    assertSecretsAreReferences(environment, env);
    return AppConfig.fromEnvironment(await resolveSecretRefs(env, source));
  }

  /**
   * Configuration straight from the environment, with no secret store behind it.
   *
   * Development and tests. A deployed process uses `load`, which refuses a literal credential —
   * this one cannot, because at that point the value is already in `process.env` either way.
   */
  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
      throw new ValidationFailedError({
        message: "The environment is not valid.",
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
        })),
      });
    }
    const config = new AppConfig(parsed.data);
    /*
     * Checked here rather than left to each composition root, so it cannot be the one app that
     * forgot. A store reached over the public internet in clear text is not a degradation to
     * notice later: the connection succeeds, the queries work, and every credential on the wire is
     * readable. There is no symptom to find.
     */
    assertTransportSecurity(parsed.data.IDENZY_ENV, [
      { name: "DATABASE_URL", value: parsed.data.DATABASE_URL },
      { name: "VALKEY_URL", value: parsed.data.VALKEY_URL },
      { name: "CLICKHOUSE_URL", value: parsed.data.CLICKHOUSE_URL },
    ]);
    return config;
  }

  get<K extends keyof RawConfig>(key: K): RawConfig[K] {
    return this.values[key];
  }

  get isProduction(): boolean {
    return this.values.IDENZY_ENV === "production";
  }

  /**
   * Config safe to log or expose on a diagnostics endpoint. Built as an allowlist,
   * because a redaction blocklist over config is how connection strings end up in logs.
   *
   * Excludes env and cell on purpose: those are process identity, bound once to every
   * log line by the logger factory. Repeating them here produced duplicate JSON keys on
   * the boot line.
   */
  toSafeSummary(): Readonly<Record<string, unknown>> {
    return {
      port: this.values.PORT,
      logLevel: this.values.LOG_LEVEL,
      accessTokenTtlSeconds: this.values.ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
