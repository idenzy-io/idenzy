import { z } from "zod";

const durationSeconds = z.coerce.number().int().positive();

/**
 * Everything the services read from the environment.
 *
 * Parsed once at boot and never re-read. A bad environment must fail the process
 * immediately rather than surface as a confusing 500 an hour later.
 */
export const configSchema = z.object({
  IDENZY_ENV: z.enum(["development", "staging", "production"]),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  VALKEY_URL: z.string().min(1),

  /** Region cell this process serves. Cross-cell requests are refused (4.13.5). */
  CELL_CODE: z.string().min(1),
  KMS_KEY_RING: z.string().min(1),

  /**
   * The `iss` claim and the base of the discovery document. Required rather than
   * defaulted: a wrong issuer is accepted by every verifier that was told to expect it
   * and rejected by every verifier that was not, which is a confusing outage at best.
   */
  ISSUER_BASE_URL: z.url(),

  /**
   * Default access-token lifetime. Bounded at both ends on purpose: below 60 s the
   * refresh traffic stops paying for itself, above an hour revocation latency stops
   * being defensible (PROJECT.md 4.2).
   */
  ACCESS_TOKEN_TTL_SECONDS: durationSeconds.min(60).max(3600).default(300),
  REFRESH_TOKEN_TTL_SECONDS: durationSeconds.default(60 * 60 * 24 * 30),

  /**
   * The two ways a session ends on its own (PROJECT.md 4.2). Idle slides on every
   * refresh; absolute never moves, which is what bounds the damage from a session an
   * attacker keeps warm.
   */
  SESSION_IDLE_TTL_SECONDS: durationSeconds.default(60 * 60 * 24 * 30),
  SESSION_ABSOLUTE_TTL_SECONDS: durationSeconds.default(60 * 60 * 24 * 90),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type RawConfig = z.infer<typeof configSchema>;
