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
  WORKERS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  /**
   * How many proxies of ours sit in front of this process, counted from the right of
   * `X-Forwarded-For`.
   *
   * It exists because a rate limit keyed on a forgeable address is decorative. Fastify
   * runs with `trustProxy: true`, which makes `request.ip` the *leftmost* entry in that
   * header — the one the caller wrote — so anyone could take a fresh bucket per request
   * by inventing an address. `ClientIpResolver` counts from the right instead, where
   * only a proxy that actually handled the request can have appended anything.
   *
   * Zero means trust nothing and use the socket address, which is correct for local
   * development and for any deployment reachable without a proxy. GCP's global load
   * balancer appends `<client>, <lb>`, so a service behind it wants 1, and each further
   * hop that appends its own address adds one. Too high reads an address the client
   * supplied, which is the bug this prevents; too low reads a proxy's address and buckets
   * every user together, which is merely useless. Neither is silent, so it is not
   * defaulted to a deployment shape we have not built yet.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),

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
  DASHBOARD_ORIGIN: z.url().default("https://app.idenzy.io"),

  /** Region cell this process serves. Cross-cell requests are refused (4.13.5). */
  CELL_CODE: z.string().min(1),
  KMS_KEY_RING: z.string().min(1),

  /**
   * The retry queue for webhook deliveries, and the endpoint it calls back (ADR-0012).
   *
   * All five are optional together and required together. A deployment with none of them retries on
   * the sweeper's interval, which is what every developer machine does and is correct — Cloud Tasks
   * is a timer, not the delivery guarantee. A deployment with *some* of them is a mistake worth
   * failing on: four out of five would silently fall back to the sweeper, and the symptom would be
   * retry latency nobody is looking at rather than an error anybody sees. `CloudTasksScheduler`
   * enforces the pairing at boot.
   *
   * `GCP_PROJECT_ID` is our own Cloud project and has nothing to do with a customer's `projectId`,
   * which is why it is not called `PROJECT_ID`. The shard count has to match the number of queues
   * Terraform made: too high and a share of retries are armed against a queue that does not exist,
   * which costs them the sweeper's interval rather than losing them.
   */
  GCP_PROJECT_ID: z.string().min(1).optional(),
  WEBHOOK_TASKS_LOCATION: z.string().min(1).optional(),
  WEBHOOK_TASKS_QUEUE_PREFIX: z.string().min(1).optional(),
  WEBHOOK_TASKS_QUEUE_SHARDS: z.coerce.number().int().min(1).max(64).default(8),
  WEBHOOK_TASKS_SERVICE_ACCOUNT: z.email().optional(),

  /**
   * The absolute URL a task calls, and the audience the token it carries must name.
   *
   * The audience defaults to the URL, which is what Cloud Tasks itself does when a task omits one.
   * It is separate because the two can differ legitimately — a load balancer in front of the service
   * means the URL a task calls is not the identity the service was given — and because a token
   * verified against the wrong audience is a token accepted from whoever else was issued one.
   */
  WEBHOOK_DISPATCH_URL: z.url().optional(),
  WEBHOOK_DISPATCH_AUDIENCE: z.string().min(1).optional(),

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

  // The two ways a session ends on its own are the project's, in `lifetimes` on the
  // settings document, and were `SESSION_IDLE_TTL_SECONDS` and
  // `SESSION_ABSOLUTE_TTL_SECONDS` here. Both are gone rather than left as fallbacks: two
  // answers to one question is how the idle window came to be stamped from the setting at
  // sign-in and from the environment at every rotation after it, with different defaults.
  // `ACCESS_TOKEN_TTL_SECONDS` above is the third of that group and is still read, but
  // for the deployment-wide jobs rather than for a token a project's setting governs: the
  // issuer's own default, and the retention bound on the revocation set, which is one
  // access-token lifetime plus skew (ADR-0009). `REFRESH_TOKEN_TTL_SECONDS` stays because
  // it is genuinely ours: §4.2 offers no control over it and the Lifetimes screen states
  // it as fixed.

  /**
   * How long an active user may sit in a meter's memory before the sketch is written down
   * (PROJECT.md 5.1).
   *
   * It buys write rate with exposure, and both ends are bounded by what the failure looks like.
   * Longer means fewer writes to the busiest row in the system and more users lost when an
   * instance is killed; shorter means the opposite, and never anything worse than a bill that
   * is slightly under. Capped at an hour because past that the loss stops being a rounding
   * error, and at least ten seconds because below it the flush is the write per sign-in this
   * exists to avoid.
   */
  USAGE_FLUSH_INTERVAL_SECONDS: durationSeconds.min(10).max(3600).default(60),

  /**
   * The analytics store (ADR-0013), and the four variables that travel together.
   *
   * All of them or none, like the webhook retry queue and for the same reason: a deployment with
   * three of the four would not fail, it would run with analytics quietly switched off, and the
   * symptom is an empty chart nobody is watching. None at all is a valid deployment — nothing on
   * the authentication path reads this store, so an absent one costs a chart and never a sign-in.
   *
   * The user here is the *reading* identity. Whatever writes takes `CLICKHOUSE_INGEST_USER`,
   * because a row policy filters reads and does not constrain writes, so the two are different
   * credentials on purpose and a service that held both would be one grant from being able to
   * plant a row under somebody else's project.
   */
  CLICKHOUSE_URL: z.string().min(1).optional(),
  CLICKHOUSE_DATABASE: z.string().min(1).optional(),
  CLICKHOUSE_USER: z.string().min(1).optional(),
  CLICKHOUSE_PASSWORD: z.string().min(1).optional(),
  /** The write identity, for `apps/workers` alone. Holds INSERT and no SELECT. */
  CLICKHOUSE_INGEST_USER: z.string().min(1).optional(),
  /** The DDL identity, for the migration this runs at boot. */
  CLICKHOUSE_OWNER_USER: z.string().min(1).optional(),

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
  EMAIL_FROM_ADDRESS: z.email().default("no-reply@mail.idenzy.io"),

  /**
   * Amazon SES, and the four variables that travel together (PROJECT.md 11.1).
   *
   * All of them or none, like the webhook retry queue and the analytics store, and for the
   * same reason: a deployment with three of the four would not fail, it would fall back to
   * a transport that refuses to exist outside development, and the symptom is every sign-in
   * code going nowhere. `DeliveryModule` enforces the pairing at boot.
   *
   * The configuration set is not optional among them. Bounces and complaints reach the
   * suppression list only because a configuration set publishes them, so a message sent
   * outside one is a message whose hard bounce we never hear about — and the cost of that
   * lands on the shared sending domain's reputation, which every project shares (4.7).
   *
   * The access key is the part that does not match 4.11's "zero static credentials", and it
   * is named here rather than glossed: the standing intention is federation, where Cloud
   * Run's own OIDC token is exchanged through `AssumeRoleWithWebIdentity` for credentials
   * that expire. `AwsCredentialsProvider` is already a function returning a promise so that
   * arriving is a different provider and not a change to every caller.
   */
  AWS_REGION: z.string().min(1).optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  SES_CONFIGURATION_SET: z.string().min(1).optional(),

  /**
   * Stripe (PROJECT.md 5.1). All five or none, checked where the provider is built.
   *
   * A partial set is the failure worth naming: four of five would start, and the symptom
   * would be a customer's card charged by a checkout whose webhook we cannot verify —
   * money taken and no credit granted, which is the one failure on this path nobody can
   * shrug off. The five travel together for the reason the Cloud Tasks five do.
   *
   * `STRIPE_API_VERSION` is ours to pin and is sent on every request. Stripe rolls the
   * shape of its objects per version, so a deployment that let the account default decide
   * would change behaviour the day somebody upgrades the account in a dashboard nobody
   * here is watching.
   */
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_CHECKOUT_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CHECKOUT_CANCEL_URL: z.string().url().optional(),
  STRIPE_API_VERSION: z.string().min(1).default("2026-08-26.dahlia"),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
});

export type RawConfig = z.infer<typeof configSchema>;
