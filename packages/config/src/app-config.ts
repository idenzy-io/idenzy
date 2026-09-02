import { ValidationFailedError } from "@idenzy/core/errors/errors";
import { configSchema, type RawConfig } from "./schema.js";

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
    return new AppConfig(parsed.data);
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
