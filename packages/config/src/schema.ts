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

  /**
   * The port this process listens on.
   *
   * Cloud Run sets it, and locally every service reads the same `.env`, so a single
   * shared value would have them all fight for one port. `main.ts` in each app resolves
   * its own variable first and falls back to this, which keeps the deployed contract
   * (`PORT`, set by the platform) and makes `pnpm dev` work side by side.
   */
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  AUTH_API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  MANAGEMENT_API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  VALKEY_URL: z.string().min(1),

  /**
   * The project our own dashboard signs in through, in its public `prj_` form.
   *
   * We run the panel on our own product (PROJECT.md 9.5), so a dashboard access token is
   * an ordinary Idenzy token and `aud` names this project. `management-api` verifies
   * against it and refuses anything minted for a customer's project, which is the same
   * check a customer's own server makes.
   *
   * Optional here and required at boot by the one service that needs it: making it
   * mandatory for every process would stop `auth-api` and `workers` starting without a
   * value neither of them reads.
   */
  DASHBOARD_PROJECT_ID: z.string().min(1).optional(),

  /**
   * The origin our own dashboard is served from, and the only one `management-api` answers
   * a browser at.
   *
   * One value rather than a list: this API is addressed by our panel and by nothing else,
   * so an allowlist would be a list of one with room for a mistake. Loopback is permitted
   * outside production by the CORS policy itself rather than through this, so a deployment
   * cannot be talked into trusting `http://localhost` by setting a variable.
   */
  DASHBOARD_ORIGIN: z.url().default("https://app.idenzy.dev"),

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

  /**
   * How long a one-time code and a magic link stay usable (PROJECT.md 4.7). Ten minutes
   * is short enough that a code in a mailbox someone else can read is usually already
   * dead, and long enough to survive a slow mail hop.
   */
  OTP_TTL_SECONDS: durationSeconds.max(3600).default(600),
  MAGIC_LINK_TTL_SECONDS: durationSeconds.max(3600).default(600),

  /**
   * The exchange code lives only between our redirect and the SDK's POST, which is one
   * page load. It is generous at two minutes and should never need raising.
   */
  AUTH_CODE_TTL_SECONDS: durationSeconds.max(600).default(120),

  /**
   * How long a user has between leaving for a provider and coming back. Long enough for
   * a consent screen, a password manager and a second factor; short enough that an
   * abandoned flow is not a live `state` value sitting in a table for an hour.
   */
  OAUTH_FLOW_TTL_SECONDS: durationSeconds.max(1800).default(600),

  /**
   * How long a WebAuthn challenge stays signable, and the browser timeout we hand out
   * with it (PROJECT.md 4.7). Longer than an OTP because the user may have to find a
   * phone or a security key, and it is a nonce rather than a secret in a mailbox.
   */
  WEBAUTHN_CHALLENGE_TTL_SECONDS: durationSeconds.max(900).default(300),

  /**
   * How long a proved first factor waits for a second (PROJECT.md 4.5).
   *
   * Five minutes, because the user is already at the keyboard and the phone is already
   * in their hand. It is longer than a single TOTP step on purpose: a code typed just as
   * the step rolls over has to be able to be retyped.
   */
  MFA_CHALLENGE_TTL_SECONDS: durationSeconds.max(900).default(300),

  /**
   * How recently a factor must have been proved for a sensitive action to go ahead.
   *
   * This is the window the `fva` claim is compared against. Fifteen minutes is long
   * enough that changing an address and then changing a password does not ask twice, and
   * short enough that a session left open on a shared machine has stopped counting.
   */
  STEP_UP_MAX_AGE_SECONDS: durationSeconds.max(3600).default(900),

  PASSWORD_RESET_TTL_SECONDS: durationSeconds.max(3600).default(900),

  /**
   * Longer than the others because two people have to act: the address is not moved
   * until the old and the new address have both confirmed (PROJECT.md 4.5).
   */
  EMAIL_CHANGE_TTL_SECONDS: durationSeconds.default(60 * 60 * 24),
  EMAIL_VERIFICATION_TTL_SECONDS: durationSeconds.default(60 * 60 * 24),

  /**
   * The envelope sender for transactional mail. Custom per-project domains are phase 2;
   * until then everything leaves on the shared domain, whose reputation is the reason
   * the suppression list is enforced in the provider base rather than per caller.
   */
  EMAIL_FROM_ADDRESS: z.email().default("no-reply@auth.idenzy.dev"),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type RawConfig = z.infer<typeof configSchema>;
