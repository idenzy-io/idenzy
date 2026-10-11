import { z } from "zod";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_CATEGORIES,
  type AuditActorType,
  type AuditCategory,
  RetentionAction,
  RetentionSubject,
} from "../enums/compliance.js";
import {
  ApiKeyKind,
  MemberRole,
  ProjectDomainStatus,
  ProjectDomainType,
} from "../enums/tenancy.js";
import { isLoopbackHost } from "../http/loopback.js";
import { orgBalanceSchema } from "./billing.js";
import {
  emailSchema,
  isoDateTimeSchema,
  phoneSchema,
  projectIdSchema,
  userIdSchema,
} from "./common.js";
import { isWebhookEventType, WebhookDeliveryOutcome, webhookUrlSchema } from "./webhooks.js";

/**
 * What the dashboard asks the management API for, and what it gets back.
 *
 * A separate surface from `schemas/auth.ts` on purpose: these are read by our own panel
 * and by a customer's scripts against the management API, and they describe the control
 * plane rather than an authentication. Nothing here is part of the Session Protocol.
 */

/** An organisation the signed-in person belongs to, as the switcher lists it. */
export const orgSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The caller's own membership. Never anybody else's; that is the members endpoint. */
  memberId: z.string(),
  role: z.enum(MemberRole),
  joinedAt: z.iso.datetime(),
});
export type OrgSummary = z.infer<typeof orgSummarySchema>;

export const orgListSchema = z.object({
  organisations: z.array(orgSummarySchema),
});
export type OrgList = z.infer<typeof orgListSchema>;

/**
 * A project's name, as the panel and the management API accept it.
 *
 * A label for the dashboard and nothing an end user ever reads, because we render no page
 * they could read it on (PROJECT.md 1.1). Trimmed, because a name that differs from
 * another only by a space is two rows nobody can tell apart in a switcher.
 */
export const projectNameSchema = z.string().trim().min(1).max(80);

/**
 * Getting started: the two answers that decide something, and the two that do not.
 *
 * The name is the only required answer. The rest is a survey: skipping it is a normal
 * answer and stores no row at all.
 */
export const startOnboardingSchema = z.object({
  projectName: projectNameSchema,
  organisationName: z.string().trim().min(1).max(120).optional(),
  useCase: z.string().trim().min(1).max(500).optional(),
  heardFrom: z.string().trim().min(1).max(200).optional(),
});
export type StartOnboarding = z.infer<typeof startOnboardingSchema>;

export const createProjectSchema = z.object({
  name: projectNameSchema,
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  /** The organisation that owns it. The panel keys every screen on the pair. */
  orgId: z.string(),
  name: z.string(),
  plan: z.string(),
  complianceTier: z.string(),
  createdAt: z.iso.datetime(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectListSchema = z.object({ projects: z.array(projectSummarySchema) });
export type ProjectList = z.infer<typeof projectListSchema>;

/** What getting started answers with: the organisation made, and the project in it. */
export const onboardingResultSchema = z.object({
  organisation: orgSummarySchema,
  project: projectSummarySchema,
});
export type OnboardingResult = z.infer<typeof onboardingResultSchema>;

/**
 * Everything the panel's shell needs about the signed-in person, in one call.
 *
 * One request rather than one per screen, because the drawer, the switcher and the
 * breadcrumb all want the same three facts before anything can render, and three round
 * trips to draw a sidebar is three chances to show a half-built page.
 *
 * The identity is deliberately absent. It is already in the access token the caller
 * presented, and `@idenzy/js` hands it to the panel as `useUser()`; repeating it here
 * would be a second copy of a fact, which is a second thing to keep true.
 *
 * The balance joined this shape once money could actually move (ADR-0017): one per
 * organisation whose billing the caller may see — owners and admins, the same people the wallet
 * answers — and live to the last five-second tick, because this is what a visit loads.
 */
export const meSchema = z.object({
  organisations: z.array(orgSummarySchema),
  /** Every project across every organisation the caller belongs to. */
  projects: z.array(projectSummarySchema),
  /** Each organisation's balance, where the caller's role may see it. */
  balances: z.array(orgBalanceSchema),
});
export type Me = z.infer<typeof meSchema>;

/*
 * API keys.
 */

/**
 * A key as the panel lists it. Never the key itself.
 *
 * `prefix` is the first characters, kind included — enough to pick a row out of a log line
 * or an `.env` file and far too few to be worth guessing the rest of. The value exists in
 * exactly one response, the one that created it, and nowhere after.
 */
export const apiKeySummarySchema = z.object({
  id: z.string(),
  kind: z.enum(ApiKeyKind),
  prefix: z.string(),
  /** Nothing reads these yet. Present because the column is, and empty until it is used. */
  scopes: z.array(z.string()),
  createdAt: z.iso.datetime(),
  /** An observation of when it was last presented, never proof of who holds it. */
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type ApiKeySummary = z.infer<typeof apiKeySummarySchema>;

export const apiKeyListSchema = z.object({ keys: z.array(apiKeySummarySchema) });
export type ApiKeyList = z.infer<typeof apiKeyListSchema>;

export const createApiKeySchema = z.object({ kind: z.enum(ApiKeyKind) });
export type CreateApiKey = z.infer<typeof createApiKeySchema>;

/**
 * What creating a key answers with, and the only time the key is ever in a response.
 *
 * `secret` is named for what it is rather than `key`, so a log line or a screenshot that
 * contains this object reads as something that should not have been kept.
 */
export const createdApiKeySchema = z.object({
  key: apiKeySummarySchema,
  /** Shown once. Only its digest is stored, so nothing can produce it again. */
  secret: z.string(),
});
export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

/*
 * Custom domains.
 */

/** One record the customer has to create in their own DNS. */
export const domainRecordSchema = z.object({
  /** `cname` routes traffic; `cert` is what authorises the certificate. */
  kind: z.enum(["cname", "cert"]),
  /** Fully qualified, as a DNS console wants it. */
  name: z.string(),
  value: z.string(),
  status: z.enum(["pending", "found", "missing"]),
});
export type DomainRecord = z.infer<typeof domainRecordSchema>;

export const projectDomainSchema = z.object({
  id: z.string(),
  domain: z.string(),
  type: z.enum(ProjectDomainType),
  status: z.enum(ProjectDomainStatus),
  records: z.array(domainRecordSchema),
  /** When DNS was last resolved, so a reader knows how stale a "not found" is. */
  checkedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProjectDomain = z.infer<typeof projectDomainSchema>;

export const projectDomainListSchema = z.object({ domains: z.array(projectDomainSchema) });
export type ProjectDomainList = z.infer<typeof projectDomainListSchema>;

/**
 * A hostname, as a customer types it.
 *
 * Lowercased and trimmed rather than rejected for case, because DNS is case-insensitive
 * and refusing `Auth.Example.com` would be refusing a correct answer. The shape is checked
 * here and the ownership is checked by DNS, which is the only thing that can check it.
 */
export const addProjectDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(253)
    .regex(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, {
      message: "That is not a hostname.",
    }),
});
export type AddProjectDomain = z.infer<typeof addProjectDomainSchema>;

/*
 * Browser origins: the CORS allowlist (ADR-0006).
 */

/**
 * An origin as a browser sends it, and nothing that merely looks like one.
 *
 * A scheme, a host and an optional port, with nothing after them. The check at the edge is a
 * string comparison against the `Origin` header, so an entry carrying a path, a query or
 * credentials could never match anything a browser sends, and a wildcard even less: refused
 * here rather than quietly reduced to its origin, because an allowlist holding something
 * other than what somebody typed is one nobody can audit by reading.
 *
 * https only. The response this list unlocks is credentialed, and one returned to a page
 * served over http is readable by anyone on the network between them.
 */
export const browserOriginSchema = z
  .string()
  .trim()
  .min(8)
  .max(255)
  .refine((value) => !value.includes("*"), {
    message: "An Origin header is one exact string, so a wildcard would match nothing at all.",
  })
  .refine((value) => parseBrowserOrigin(value) !== null, {
    message: "A scheme, a host and an optional port, and nothing after them.",
  })
  // Loopback before the scheme, so the dashboard's own check can report the two in this
  // order: `http://localhost:3000` is a development URL rather than an insecure choice, and
  // "you do not need to add this" is the sentence worth reading.
  .refine((value) => !isLoopbackOrigin(value), {
    message: "Loopback is allowed by the deployment outside production, not by this list.",
  })
  .refine((value) => parseBrowserOrigin(value)?.scheme !== "http", {
    message: "Only https: a credentialed response read over http is readable by the network.",
  })
  .transform(canonicalBrowserOrigin);

export interface BrowserOriginParts {
  readonly scheme: string;
  readonly host: string;
  /** As typed, so a default port can be recognised and dropped rather than stored. */
  readonly port: string | null;
}

/**
 * A scheme, a host, an optional port, and nothing else at all.
 *
 * A pattern rather than `URL`, which is what an origin check would normally reach for, because
 * this package declares neither DOM nor node globals: it is parsed by browsers, workers,
 * React Native and servers, and a schema that needed one runtime's globals would be a schema
 * one of them could not load. The shape is also small enough to say exactly — a `URL` has to
 * be interrogated afterwards about the path, the query, the fragment and the userinfo it
 * helpfully accepted, which is four chances to forget one.
 *
 * The host is a run of DNS labels or a bracketed IPv6 literal. An underscore is deliberately
 * not allowed: it is legal in a DNS name and never in a hostname a browser will put in an
 * `Origin` header.
 */
const ORIGIN_PATTERN =
  /^(https?):\/\/([a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*|\[[\da-f:]+\])(?::(\d{1,5}))?$/i;

/**
 * Exported because the dashboard asks the same question and must not answer it differently.
 *
 * The panel refuses an origin while somebody is typing it and explains which rule it broke,
 * which is a better message than a 400 — but only while the two agree about what an origin
 * is. One parser, two readers: the sentences stay the panel's and the syntax stays here.
 */
export function parseBrowserOrigin(value: string): BrowserOriginParts | null {
  // One trailing slash is tolerated because every browser address bar shows one, and it is
  // the single character somebody is most likely to copy along with the origin.
  const match = ORIGIN_PATTERN.exec(value.trim().replace(/\/$/, ""));
  if (match === null) return null;
  const [, scheme = "", host = "", port] = match;
  if (port !== undefined && Number(port) > 65_535) return null;
  return { scheme: scheme.toLowerCase(), host: host.toLowerCase(), port: port ?? null };
}

/**
 * Whether an origin names a loopback host, which this list refuses and code allows.
 *
 * Refused because loopback is allowed by the deployment while it runs outside production, in
 * application code and gated on the environment, so it cannot be switched on by data: a row
 * for it grants nothing in production and is not needed anywhere else.
 */
export function isLoopbackOrigin(value: string): boolean {
  const parts = parseBrowserOrigin(value);
  return parts !== null && isLoopbackHost(parts.host);
}

/**
 * What the browser will actually send: lowercase, and with no port where the port is the
 * scheme's own default.
 *
 * `https://app.example.com:443` is a correct spelling that no browser ever sends, so it is
 * canonicalised rather than refused with a message nobody could act on. Two spellings of one
 * origin stored as two rows would each read as a decision somebody took.
 *
 * Exported for the same reason as the parser: the panel shows the value it is about to store
 * before it stores it, and showing a different one would make that preview a lie.
 */
export function canonicalBrowserOrigin(value: string): string {
  const parts = parseBrowserOrigin(value);
  if (parts === null) return value.trim().toLowerCase();
  const implied = parts.scheme === "https" ? "443" : "80";
  return parts.port === null || parts.port === implied
    ? `${parts.scheme}://${parts.host}`
    : `${parts.scheme}://${parts.host}:${parts.port}`;
}

/**
 * One origin on a project's allowlist.
 *
 * Who added it is deliberately absent: `project_origins` has no column for it, and the fact
 * belongs to the audit trail rather than to a second copy on the row. What the panel calls a
 * suggestion's source is a panel-side reading of the project's other lists, never something
 * stored here — deriving this list from another is the thing ADR-0006 exists to refuse.
 */
export const projectOriginSchema = z.object({
  id: z.string(),
  origin: z.string(),
  createdAt: z.iso.datetime(),
});
export type ProjectOrigin = z.infer<typeof projectOriginSchema>;

export const projectOriginListSchema = z.object({ origins: z.array(projectOriginSchema) });
export type ProjectOriginList = z.infer<typeof projectOriginListSchema>;

export const addProjectOriginSchema = z.object({ origin: browserOriginSchema });
export type AddProjectOrigin = z.infer<typeof addProjectOriginSchema>;

/*
 * Webhooks: the endpoints a project registers, and what its deliveries did (ADR-0012).
 */

/**
 * An event a subscription may name.
 *
 * Checked against the catalogue rather than taken as free text, because a subscription to an event
 * that does not exist is one that can never fire: it saves, it reads as configured, and nothing
 * ever arrives. The test event is deliberately not subscribable — it is sent by asking for a test.
 */
const subscribedEventSchema = z.string().refine(isWebhookEventType, {
  message: "That is not an event this API sends.",
});

/** Why an endpoint is off, as the dashboard reads it. */
export const webhookDisabledSchema = z.object({
  /** `paused` is somebody's decision; `failing` is the breaker's. */
  kind: z.enum(["paused", "failing"]),
  at: z.iso.datetime(),
  /**
   * The membership that paused it, or null where the breaker did.
   *
   * A member id and not a name: resolving one to a person is the members endpoint's job, and a
   * name copied onto this row would be a second place somebody's name has to be kept true.
   */
  byMemberId: z.string().nullable(),
});
export type WebhookDisabled = z.infer<typeof webhookDisabledSchema>;

/**
 * An endpoint, as the dashboard lists it. Never its secret.
 *
 * The secret appears in exactly two responses — the one that created the endpoint and the one that
 * rotated it — and nowhere afterwards. It is stored encrypted rather than hashed, because signing
 * needs the value back, so "shown once" is a promise about what this API will answer and not a
 * property of the storage (ADR-0012). There is no route that returns it.
 */
export const webhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** Null exactly while `enabled` is true. */
  disabled: webhookDisabledSchema.nullable(),
  events: z.array(z.string()),
  /** Everything, including events that do not exist yet. `events` is ignored while it is set. */
  allEvents: z.boolean(),
  createdAt: z.iso.datetime(),
  /** When the secret was last replaced. Null means it is the one the endpoint was made with. */
  rolledAt: z.iso.datetime().nullable(),
  /** Until when the previous secret also signs. Null outside a rotation window. */
  previousSecretUntil: z.iso.datetime().nullable(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>;

export const webhookEndpointListSchema = z.object({
  endpoints: z.array(webhookEndpointSchema),
});
export type WebhookEndpointList = z.infer<typeof webhookEndpointListSchema>;

/**
 * What a new endpoint is created from.
 *
 * `enabled` defaults to false, which is the screen's rule rather than a shape decision: a test
 * event should come before real ones, so an endpoint starts off unless somebody says otherwise.
 *
 * A draft naming no events and not asking for all of them is refused. It would save, read as
 * configured, and never fire — the one failure this whole screen exists to make visible.
 */
export const createWebhookSchema = z
  .object({
    url: webhookUrlSchema,
    description: z.string().trim().max(200).default(""),
    events: z.array(subscribedEventSchema).max(64).default([]),
    allEvents: z.boolean().default(false),
    enabled: z.boolean().default(false),
  })
  .refine((body) => body.allEvents || body.events.length > 0, {
    message: "Choose at least one event, or subscribe to all of them.",
  });
export type CreateWebhook = z.infer<typeof createWebhookSchema>;

/**
 * What an edit may change, and what it may not.
 *
 * The secret is absent: rotating one is its own route, because it is the only edit that hands back
 * a credential and the only one with a deadline attached. `enabled` is absent for the same kind of
 * reason — pausing and resuming say why an endpoint is off, and a boolean here could not.
 */
export const updateWebhookSchema = z
  .object({
    url: webhookUrlSchema.optional(),
    description: z.string().trim().max(200).optional(),
    events: z.array(subscribedEventSchema).max(64).optional(),
    allEvents: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change." })
  .refine(
    (body) => body.allEvents !== false || body.events === undefined || body.events.length > 0,
    {
      message: "Choose at least one event, or subscribe to all of them.",
    },
  );
export type UpdateWebhook = z.infer<typeof updateWebhookSchema>;

/** The one response that carries a signing secret, and the reason the field is named for it. */
export const createdWebhookSchema = z.object({
  endpoint: webhookEndpointSchema,
  /** Shown once. There is no route that answers with it again. */
  secret: z.string(),
});
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

/** A rotation: the new secret, and when the old one stops signing beside it. */
export const rotatedWebhookSecretSchema = z.object({
  endpoint: webhookEndpointSchema,
  secret: z.string(),
  previousSecretUntil: z.iso.datetime(),
});
export type RotatedWebhookSecret = z.infer<typeof rotatedWebhookSecretSchema>;

/** One attempt on a delivery, which is the evidence a developer debugs from. */
export const webhookAttemptSchema = z.object({
  /** One is the first call, not the first retry. */
  n: z.number().int().positive(),
  at: z.iso.datetime(),
  /** What the endpoint answered, or null where nothing did. */
  status: z.number().int().nullable(),
  /** Why there is no status: a timeout, a refused connection, a name that did not resolve. */
  error: z.string().nullable(),
  durationMs: z.number().int().nonnegative(),
  /** An excerpt of the receiver's own response. Capped before it is stored, never whole. */
  response: z.string(),
});
export type WebhookAttempt = z.infer<typeof webhookAttemptSchema>;

/**
 * A delivery and its attempts.
 *
 * `payload` is nullable and that is the design rather than an omission: the body is kept only
 * while the delivery is open and cleared the moment it is terminal, so a finished delivery can be
 * inspected for what happened without keeping a copy of somebody's personal data to do it. It is
 * also why a retry is refused after that point — see ADR-0012.
 */
export const webhookDeliverySchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  event: z.string(),
  outcome: z.enum(WebhookDeliveryOutcome),
  attempts: z.array(webhookAttemptSchema),
  /** When the next attempt is due, for a delivery still owed. */
  nextRetryAt: z.iso.datetime().nullable(),
  /** The body as signed, while it is still held. */
  payload: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
  /** Sent by asking for a test rather than by something that happened. */
  test: z.boolean(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const webhookDeliveryListSchema = z.object({
  deliveries: z.array(webhookDeliverySchema),
});
export type WebhookDeliveryList = z.infer<typeof webhookDeliveryListSchema>;

/**
 * How many deliveries a read asks for.
 *
 * Coerced because a query string is text, capped because the window behind it is not: a page that
 * asked for everything would scan a customer's whole delivery history to render fifty rows. The
 * default is what the screen shows.
 */
export const webhookDeliveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type WebhookDeliveryQuery = z.infer<typeof webhookDeliveryQuerySchema>;

/**
 * A day of an endpoint's counters, which is what the figures on the screen are made of.
 *
 * Counters rather than arithmetic over the delivery window, because "97% delivered over seven days"
 * computed from deliveries means scanning every delivery a project made (ADR-0012). They also
 * outlive the window: a delivery is gone after three days and the fact that four thousand of them
 * landed on Tuesday is a row of a few dozen bytes.
 */
export const webhookDayStatsSchema = z.object({
  endpointId: z.string(),
  /** The UTC day, `YYYY-MM-DD`. A counter has no locale. */
  day: z.string(),
  delivered: z.number().int().nonnegative(),
  /** Deliveries that used every attempt without a 2xx. Not the same as failed attempts. */
  failed: z.number().int().nonnegative(),
  /** Attempts made, which is more than deliveries: a retry is an attempt and not a delivery. */
  attempts: z.number().int().nonnegative(),
  lastDeliveredAt: z.iso.datetime().nullable(),
  lastFailedAt: z.iso.datetime().nullable(),
});
export type WebhookDayStats = z.infer<typeof webhookDayStatsSchema>;

export const webhookStatsSchema = z.object({ days: z.array(webhookDayStatsSchema) });
export type WebhookStats = z.infer<typeof webhookStatsSchema>;

/**
 * How far back the counters are read.
 *
 * A date rather than a period, so the caller says what it wants rather than learning our idea of a
 * week. Capped at a year: past that the answer belongs to the analytics store, and an unbounded
 * `since` is a full scan of a table that grows for the life of a project.
 */
export const webhookStatsQuerySchema = z.object({
  since: z.iso.date().optional(),
});
export type WebhookStatsQuery = z.infer<typeof webhookStatsQuerySchema>;

/**
 * What a test event or a replay answers with: the delivery, queued.
 *
 * 202 rather than 200, and the delivery rather than a bare acknowledgement. Sending is the
 * pipeline's job and happens after the response, so the honest answer is "here is the delivery that
 * will be attempted" — which is also the row the screen puts at the top of its table.
 */
export const queuedWebhookDeliverySchema = z.object({ delivery: webhookDeliverySchema });
export type QueuedWebhookDelivery = z.infer<typeof queuedWebhookDeliverySchema>;

/**
 * One day of a project's metered usage.
 *
 * `activeUsers` is the day's own figure and `activeUsersToDate` is the window's running total,
 * and both are here because neither can be derived from the other on the client. Active users
 * are a sketch server-side: two days of 100 may be 100 people or 200, so a chart cannot sum the
 * daily figures into a month and cannot take the largest either. The level that reconciles with
 * a bill is the running one, so it is computed where the sketches are and sent.
 *
 * The counters beside it are ordinary sums and do add up. `smsCost` is what the providers
 * charged us, in the currency the invoice is raised in, as a decimal string — a cent is too
 * coarse for a message that costs $0.0079 and a float is the wrong type for money.
 */
export const usageDaySchema = z.object({
  /** The UTC day, `YYYY-MM-DD`. A meter has no locale. */
  day: z.string(),
  activeUsers: z.number().int().nonnegative(),
  /**
   * The running total within this day's *billing period*, never within the requested window.
   *
   * A customer looking at the last seven days wants to know what they owe, not what seven days
   * would have cost in isolation, so the level on the 7th includes the 1st through the 6th. It
   * resets at each month boundary, because that is where the free tier and the invoice reset.
   */
  activeUsersToDate: z.number().int().nonnegative(),
  emailsSent: z.number().int().nonnegative(),
  smsSent: z.number().int().nonnegative(),
  /** Codes actually entered. Far below `smsSent` is the pumping signal (PROJECT.md 4.8). */
  smsVerified: z.number().int().nonnegative(),
  smsCost: z.string(),
});
export type UsageDay = z.infer<typeof usageDaySchema>;

/**
 * A project's daily series over a window (PROJECT.md 5.1).
 *
 * Deliberately carries no window-level active-user total, because for an arbitrary span of dates
 * there is not an honest one to give. A period's figure is the union of that period's sketches,
 * and once a month is closed those are gone — so a window crossing a closed month could only be
 * answered by adding numbers that double-count everybody who came back. `usagePeriodSchema` is the
 * authority for what a period cost; this is what a chart draws.
 *
 * A day with no activity has no row, so `days` is sparse and a reader must not assume one entry
 * per date. Writing an empty row per project per day would be a write for every project that did
 * nothing, every day, for the life of the account.
 */
export const projectUsageSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(usageDaySchema),
});
export type ProjectUsage = z.infer<typeof projectUsageSchema>;

/**
 * The window to report on, defaulting to the calendar month in progress.
 *
 * Inclusive at both ends, because a caller asking for a month means the 30th and not up to it.
 * Bounded at 366 days for the same reason the webhook counters are bounded: a longer answer is
 * the analytics store's, and an unbounded window is a scan of a table that grows for the life of
 * a project. Validated as a pair rather than field by field, so a reversed window is refused
 * here instead of answering with nothing and looking like a project that never had any users.
 */
export const usageQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: "The window ends before it starts.",
    path: ["to"],
  });
export type UsageQuery = z.infer<typeof usageQuerySchema>;

/**
 * One billing period's figures: the open month, or a closed one as its invoice was raised.
 *
 * `closed` is the difference between a record and a reading. A closed period was totalled once,
 * when its month was over and every meter had flushed, and the sketches behind it were dropped in
 * the same transaction — so it cannot change and nothing can recompute it. An open one is read
 * live from the daily rows and will keep moving until it is shut. A month that has ended but is
 * still inside the closer's grace reads as open, which is honest: nothing has been committed yet.
 *
 * `end` is the last day of the month and is inclusive, matching the window the days are read over.
 */
export const usagePeriodSchema = z.object({
  /** `YYYY-MM`. What a period selector shows and what an invoice is titled. */
  id: z.string(),
  start: z.string(),
  end: z.string(),
  closed: z.boolean(),
  activeUsers: z.number().int().nonnegative(),
  emailsSent: z.number().int().nonnegative(),
  smsSent: z.number().int().nonnegative(),
  smsVerified: z.number().int().nonnegative(),
  smsCost: z.string(),
  /** When the period was shut, or null while it is still being metered. */
  closedAt: z.iso.datetime().nullable(),
});
export type UsagePeriod = z.infer<typeof usagePeriodSchema>;

/** Newest first: the month in progress, then the months behind it. */
export const usagePeriodListSchema = z.object({ periods: z.array(usagePeriodSchema) });
export type UsagePeriodList = z.infer<typeof usagePeriodListSchema>;

/**
 * How many periods to return, counting back from the month in progress.
 *
 * Capped at two years, which is well past what a screen shows and short of the six a closed
 * period is retained for: anything older is a question for an invoice rather than a dashboard.
 */
export const usagePeriodQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).optional(),
});
export type UsagePeriodQuery = z.infer<typeof usagePeriodQuerySchema>;

/**
 * One hour of a project's metered usage.
 *
 * `activeUsersToDate` is the only active-user figure here, and the absence of a per-hour one is
 * deliberate rather than an omission. An hour stores a *level* — month-to-date actives as they
 * stood when the hour was rolled up — because the alternative is a 16 KiB sketch every hour, which
 * is seventy megabytes per project over the six months these rows are kept. Two levels subtract to
 * give how many were new in the second hour, which is what a chart draws; a distinct count of an
 * hour on its own is not recoverable and never will be.
 *
 * The counters are the hour's own share and do add up to the day. `smsCost` can be negative: a
 * provider that came in under its quote settles the difference against the hour the correction
 * lands in.
 */
export const usageHourSchema = z.object({
  /** The start of the UTC hour. */
  hour: z.iso.datetime(),
  activeUsersToDate: z.number().int().nonnegative(),
  emailsSent: z.number().int().nonnegative(),
  smsSent: z.number().int().nonnegative(),
  smsVerified: z.number().int().nonnegative(),
  smsCost: z.string(),
});
export type UsageHour = z.infer<typeof usageHourSchema>;

/**
 * A project's hourly series.
 *
 * Sparse like the daily one, and sparser: an hour with no row is one the roller never observed —
 * either nothing was metered, or the worker was not running when it ended. The second case is a
 * gap on purpose. An hour's level cannot be reconstructed after the fact, so drawing a line
 * through it would be inventing the shape of the traffic rather than reporting it.
 */
export const projectUsageHoursSchema = z.object({
  from: z.string(),
  to: z.string(),
  hours: z.array(usageHourSchema),
});
export type ProjectUsageHours = z.infer<typeof projectUsageHoursSchema>;

// ── Project users ────────────────────────────────────────────────────────────────────
//
// The end users of a customer's project, as the panel's Users screen shows them. Distinct
// from `publicUserSchema`, which is what an end user's own SDK receives: this carries the
// operational facts a support person needs and an end user must never see their own
// version of — how many live sessions there are, whether an authenticator is enrolled,
// whether the account is suspended.

/**
 * How somebody can get in. Derived from what is stored, never from a column of its own.
 *
 * A string rather than an enum, and deliberately. The credential kinds are closed —
 * `password`, `passkey`, `email_otp`, `sms_otp`, `magic_link`, `anonymous` — but the rest
 * are provider ids, and there are eighteen of those with more arriving. An enum would have
 * to be edited for each, and every consumer that exhaustively matched on it would break on
 * the one nobody updated. The panel's `methodIcon` is total for the same reason.
 */
export const signInMethodSchema = z.string().min(1).max(40);
export type SignInMethod = z.infer<typeof signInMethodSchema>;

export const projectUserSchema = z.object({
  id: userIdSchema,
  projectId: projectIdSchema,
  email: emailSchema.nullable(),
  emailVerified: z.boolean(),
  phone: phoneSchema.nullable(),
  phoneVerified: z.boolean(),
  displayName: z.string().max(200).nullable(),
  avatarUrl: z.url().nullable(),
  /** Sorted and de-duplicated, so two accounts with the same ways in compare equal. */
  methods: z.array(signInMethodSchema),
  mfaEnabled: z.boolean(),
  /** Sessions neither revoked nor past their absolute expiry, counted at read time. */
  activeSessions: z.number().int().min(0),
  /** A suspension. In the past means it has lapsed, which is why the instant is returned. */
  bannedUntil: isoDateTimeSchema.nullable(),
  lastSignInAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  /** The erasure tombstone. A row with one has had its personal columns cleared. */
  deletedAt: isoDateTimeSchema.nullable(),
  metadataPublic: z.record(z.string(), z.unknown()),
});
export type ProjectUser = z.infer<typeof projectUserSchema>;

/**
 * A page of users.
 *
 * `nextCursor` rather than an offset, because the list is ordered by creation and a busy
 * project inserts while somebody is paging: an offset would skip a row for every account
 * created behind the reader. Null means this was the last page.
 */
export const projectUserListSchema = z.object({
  users: z.array(projectUserSchema),
  nextCursor: z.string().nullable(),
});
export type ProjectUserList = z.infer<typeof projectUserListSchema>;

export const projectUserQuerySchema = z.object({
  /** Matches an address, a phone number or a display name. Trimmed, case-insensitive. */
  search: z.string().trim().max(320).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export type ProjectUserQuery = z.infer<typeof projectUserQuerySchema>;

/**
 * Suspends an account until an instant.
 *
 * An instant and not a boolean, because every suspension this product can express has an
 * end: "indefinite" is a date far enough out that a person reading the screen understands
 * it is not coming back on its own. A flag would have needed a second column to say when,
 * and the two would drift.
 */
export const suspendUserSchema = z.object({
  until: isoDateTimeSchema,
});
export type SuspendUser = z.infer<typeof suspendUserSchema>;

/**
 * One of an end user's sessions, for the panel's session list.
 *
 * The device name is the client's to give and is never derived here: parsing a user agent
 * rots, and a wrong guess on a security screen is worse than a blank.
 */
export const userSessionSchema = z.object({
  id: z.string(),
  deviceName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  amr: z.array(z.string()),
  createdAt: isoDateTimeSchema,
  lastActiveAt: isoDateTimeSchema,
  absoluteExpiresAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
  revokeReason: z.string().nullable(),
});
export type UserSession = z.infer<typeof userSessionSchema>;

export const userSessionListSchema = z.object({ sessions: z.array(userSessionSchema) });
export type UserSessionList = z.infer<typeof userSessionListSchema>;

/** How many sessions a revoke ended. Zero is a normal answer, not a failure. */
export const revokedSessionsSchema = z.object({ revoked: z.number().int().min(0) });
export type RevokedSessions = z.infer<typeof revokedSessionsSchema>;

// ── Project sessions ─────────────────────────────────────────────────────────────────
//
// The project-wide session list behind the panel's Sessions & devices screen. Wider than
// `userSessionSchema`, which answers "this account's sessions" from inside a user's page:
// this one carries the account each session belongs to, because the screen is read by
// somebody looking for a device rather than for a person.

export const projectSessionSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  userId: userIdSchema,
  deviceId: z.string().nullable(),
  deviceName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  amr: z.array(z.string()),
  factorVerifiedAt: isoDateTimeSchema.nullable(),
  /**
   * Whether the refresh token is bound to a device key.
   *
   * Always false, and honestly so: device-bound refresh tokens are PROJECT.md 4.4 and
   * phase 3, and no column records one. Sent rather than omitted because the screen has a
   * column for it and "no" is the true answer for every session that exists today.
   */
  deviceBound: z.boolean(),
  lastActiveAt: isoDateTimeSchema,
  idleExpiresAt: isoDateTimeSchema,
  absoluteExpiresAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
  revokeReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ProjectSession = z.infer<typeof projectSessionSchema>;

export const projectSessionListSchema = z.object({
  sessions: z.array(projectSessionSchema),
  nextCursor: z.string().nullable(),
});
export type ProjectSessionList = z.infer<typeof projectSessionListSchema>;

export const projectSessionQuerySchema = z.object({
  /** Narrows to one account. The screen uses it when arriving from a user's page. */
  userId: userIdSchema.optional(),
  /** Revoked sessions are excluded by default: the screen is about what is live. */
  includeRevoked: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});
export type ProjectSessionQuery = z.infer<typeof projectSessionQuerySchema>;

/**
 * Ends specific sessions.
 *
 * A list rather than one id, because the screen's selection bar ends a set and the
 * alternative is a request per row — which on a slow link half-succeeds and leaves the
 * operator with no single answer about what happened.
 */
export const revokeSessionsSchema = z.object({
  sessionIds: z.array(z.string()).min(1).max(200),
});
export type RevokeSessionsRequest = z.infer<typeof revokeSessionsSchema>;

// ── The audit trail ──────────────────────────────────────────────────────────────────
//
// What one project's chain says, read by the people the trail is about (PROJECT.md
// 4.13.3). Read-only on the wire as well as in the database: the runtime role holds no
// UPDATE or DELETE on `audit_events`, and there is no request here that would want one.

/**
 * One entry, as the screen reads it.
 *
 * `actorName` and `targetName` are not columns. The trail stores ids because a name is a
 * thing that changes and an entry must keep saying what it said at the time; the screen
 * needs something to print, so the service resolves the ids it can and the row keeps both.
 * A name that cannot be resolved comes back null rather than as the id again — an account
 * that has since been erased is exactly the case this happens in, and pretending the id is
 * a name would put a uuid where a reader expects a person.
 *
 * `prevHash` and `entryHash` are here because the screen shows the chain, not because a
 * reader compares digests by eye: two adjacent rows linking is what makes a gap visible.
 */
export const projectAuditEventSchema = z.object({
  id: z.string(),
  /** The total order the chain is built in. Never `createdAt`: that ties at ms precision. */
  seq: z.number().int(),
  createdAt: isoDateTimeSchema,
  actorType: z.enum(AUDIT_ACTOR_TYPES as [AuditActorType, ...AuditActorType[]]),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  category: z.enum(AUDIT_CATEGORIES as [AuditCategory, ...AuditCategory[]]),
  target: z.string().nullable(),
  targetName: z.string().nullable(),
  ip: z.string().nullable(),
  ua: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  prevHash: z.string(),
  entryHash: z.string(),
});
export type ProjectAuditEvent = z.infer<typeof projectAuditEventSchema>;

export const projectAuditListSchema = z.object({
  events: z.array(projectAuditEventSchema),
  nextCursor: z.string().nullable(),
});
export type ProjectAuditList = z.infer<typeof projectAuditListSchema>;

/**
 * What the screen's filters narrow by.
 *
 * Every one of them is applied by the API and none by the screen, which is forced by
 * paging rather than chosen: a page of fifty cannot be filtered client-side and still have
 * a pager that means anything. That is also why the actor and category vocabularies live
 * in `@idenzy/protocol` — the menu offers exactly what the API accepts.
 *
 * A project's own end users generate most of the entries and are not what somebody opens
 * this screen to read, so the default is the team. It is a default and not a rule: an
 * investigation into one account is the case where they are the whole point, which is what
 * `actorId` is for.
 */
export const projectAuditQuerySchema = z.object({
  actorTypes: z
    .union([
      z.array(z.enum(AUDIT_ACTOR_TYPES as [AuditActorType, ...AuditActorType[]])),
      z
        .string()
        .transform((value) => value.split(",").filter((part) => part.length > 0))
        .pipe(z.array(z.enum(AUDIT_ACTOR_TYPES as [AuditActorType, ...AuditActorType[]]))),
    ])
    .optional(),
  categories: z
    .union([
      z.array(z.enum(AUDIT_CATEGORIES as [AuditCategory, ...AuditCategory[]])),
      z
        .string()
        .transform((value) => value.split(",").filter((part) => part.length > 0))
        .pipe(z.array(z.enum(AUDIT_CATEGORIES as [AuditCategory, ...AuditCategory[]]))),
    ])
    .optional(),
  /** Narrows to one actor. The screen uses it when arriving from a user's page. */
  actorId: z.string().max(320).optional(),
  /** Matches the action, the target or the actor's id. Trimmed, case-insensitive. */
  search: z.string().trim().max(320).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ProjectAuditQuery = z.infer<typeof projectAuditQuerySchema>;

// ── Project settings ─────────────────────────────────────────────────────────────────
//
// Per-project authentication configuration, stored in `projects.settings` and read by the
// auth API on the paths it governs.
//
// One document rather than a column per knob, and one endpoint rather than one per screen.
// The screens are many and the shape moves while the product is young, so a jsonb document
// with a schema in front of it costs a migration per change less than a column does — and
// the schema is what keeps it from becoming an untyped bag, which is what the column was
// before anything read it. When a setting earns an index or a constraint it graduates to a
// column of its own; none has yet.
//
// Every section is optional and every field within it has a default, so a project created
// before a setting existed reads as the default rather than as a hole. That is what lets a
// new knob ship without a backfill.

/**
 * How long a password-reset link stays usable, in minutes.
 *
 * A closed set rather than a range, and the set the screen offers. PROJECT.md 4.5 fixes
 * this at fifteen minutes; a free integer would let a customer set a day and turn a mailbox
 * that leaks once into a standing key, so the longest on offer is an hour.
 */
export const resetLifetimeSchema = z.union([
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);

/**
 * The password policy, as the Passwords screen edits it and the flows enforce it.
 *
 * `minLength` floors at 8 and caps at 64 rather than at the protocol's 256: NIST 800-63B
 * asks for a minimum of 8 and forbids composition rules, and a customer who sets 64 has
 * built a system nobody can sign up to. The ceiling is on what may be *demanded*, not on
 * what may be used — `passwordSchema` still accepts 256.
 *
 * `lockout` defaults off and stays off unless asked for, because lockout is a denial of
 * service aimed at the victim (PROJECT.md 4.5). It is offered because some compliance
 * regimes require it, not because it is a good idea.
 */
export const passwordPolicySchema = z.object({
  enabled: z.boolean().default(true),
  allowSignUp: z.boolean().default(true),
  minLength: z.number().int().min(8).max(64).default(8),
  breachCheck: z.boolean().default(true),
  lockout: z.boolean().default(false),
  lockoutAttempts: z.number().int().min(3).max(100).default(10),
  resetLifetime: resetLifetimeSchema.default(15),
  signOutOnReset: z.boolean().default(true),
  notifyOnChange: z.boolean().default(true),
});
export type PasswordPolicy = z.infer<typeof passwordPolicySchema>;

/**
 * One passwordless channel: whether it may be used, and whether it may create accounts.
 *
 * The two are separate for the reason the password policy keeps them separate — closing
 * registration must not lock out the people already inside — and they matter more here,
 * because a code channel signs in and signs up through the same call. The code proves the
 * same thing either way, so the flow cannot tell them apart until it looks for the account.
 */
export const codeChannelSchema = z.object({
  enabled: z.boolean().default(true),
  allowSignUp: z.boolean().default(true),
});
export type CodeChannel = z.infer<typeof codeChannelSchema>;

export const magicLinkSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  allowSignUp: z.boolean().default(true),
  /**
   * Where a clicked link may land, matched exactly.
   *
   * Empty means no link can be started at all, which is the safe default rather than an
   * oversight: a link with nowhere registered to land is an open redirect waiting for
   * somebody to supply the destination (PROJECT.md 4.6).
   */
  redirectUris: z.array(z.url()).max(20).default([]),
});
export type MagicLinkSettings = z.infer<typeof magicLinkSettingsSchema>;

/**
 * The passwordless channels.
 *
 * Email on, SMS and links off. SMS costs money before it reaches anybody and sends nothing
 * without a policy in any case; links are the second choice to codes (4.7) and need a route
 * of the customer's own before one can be sent.
 */
export const otpSettingsSchema = z.object({
  email: codeChannelSchema.default(codeChannelSchema.parse({})),
  sms: codeChannelSchema.default({ enabled: false, allowSignUp: true }),
  magicLink: magicLinkSettingsSchema.default(magicLinkSettingsSchema.parse({})),
});
export type OtpSettings = z.infer<typeof otpSettingsSchema>;

/**
 * Passkeys.
 *
 * Only the switch lives here. The relying party is a row in `webauthn_relying_parties` with
 * a unique index behind it, because one project may have exactly one — a second would split
 * a customer's passkeys into two sets that cannot substitute for each other — and a unique
 * index is a guarantee a jsonb document cannot make.
 */
export const passkeySettingsSchema = z.object({
  enabled: z.boolean().default(true),
});
export type PasskeySettings = z.infer<typeof passkeySettingsSchema>;

export const authenticatorSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * What the authenticator app files the account under. Null falls back to the project name.
   *
   * Short because every app truncates a long one, and a colon is allowed because the server
   * percent-encodes the label — which is what stops one from splitting the otpauth URI into
   * a different account.
   */
  issuer: z.string().min(1).max(64).nullable().default(null),
});
export type AuthenticatorSettings = z.infer<typeof authenticatorSettingsSchema>;

export const mfaSettingsSchema = z.object({
  authenticator: authenticatorSettingsSchema.default(authenticatorSettingsSchema.parse({})),
});
export type MfaSettings = z.infer<typeof mfaSettingsSchema>;

export const recoverySettingsSchema = z.object({
  /** Below this many unspent codes the account is shown as low. A display rule, not a gate. */
  lowThreshold: z.number().int().min(1).max(10).default(3),
});
export type RecoverySettings = z.infer<typeof recoverySettingsSchema>;

/**
 * Session and token lifetimes (PROJECT.md 4.2).
 *
 * The access token's bounds are a decision rather than a range somebody liked: below a
 * minute the refresh traffic stops paying for itself, and above an hour the revocation
 * latency stops being defensible. This is the setting §4.2 promised was "configurable from
 * 60 s to 60 min" and which was a deployment-wide environment variable until now.
 *
 * Both session expiries are enforced and whichever falls first ends the session, so the
 * idle window is capped at the absolute one — a project whose idle timeout outlives its
 * absolute lifetime has one setting that can never take effect.
 */
export const lifetimeSettingsSchema = z
  .object({
    accessTokenSeconds: z.number().int().min(60).max(3600).default(300),
    idleSeconds: z
      .number()
      .int()
      .min(300)
      .max(60 * 60 * 24 * 90)
      .default(60 * 60 * 24 * 14),
    absoluteSeconds: z
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 365)
      .default(60 * 60 * 24 * 90),
  })
  .refine((l) => l.idleSeconds <= l.absoluteSeconds, {
    message: "the idle window cannot outlive the absolute lifetime",
    path: ["idleSeconds"],
  });
export type LifetimeSettings = z.infer<typeof lifetimeSettingsSchema>;

/**
 * Account linking, which is one rule and the most consequential one here (PROJECT.md 4.6).
 *
 * `autoLink` decides whether a social sign-in whose provider asserts a verified address may
 * take over an existing account with that address. On is safe only because the flow demands
 * `email_verified` from the provider first — eight of the eighteen do not assert it and
 * report unverified rather than assume, so those never auto-link whatever this says.
 *
 * Off means a matching address is refused with `linking_requires_verification` and the user
 * proves the address by email code instead. That is the stricter setting and it is not the
 * default, because the common case is a customer whose users genuinely are the same person
 * and who would otherwise be asked to prove an address their provider already proved.
 */
export const linkingSettingsSchema = z.object({
  autoLink: z.boolean().default(true),
});
export type LinkingSettings = z.infer<typeof linkingSettingsSchema>;

export const projectSettingsSchema = z.object({
  password: passwordPolicySchema.default(passwordPolicySchema.parse({})),
  otp: otpSettingsSchema.default(otpSettingsSchema.parse({})),
  passkeys: passkeySettingsSchema.default(passkeySettingsSchema.parse({})),
  mfa: mfaSettingsSchema.default(mfaSettingsSchema.parse({})),
  recovery: recoverySettingsSchema.default(recoverySettingsSchema.parse({})),
  lifetimes: lifetimeSettingsSchema.default(lifetimeSettingsSchema.parse({})),
  linking: linkingSettingsSchema.default(linkingSettingsSchema.parse({})),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

/**
 * A patch, section by section.
 *
 * Sections are replaced whole rather than deep-merged, and the screens send whole sections
 * because each one is a form. A deep merge would make "unset this field" impossible to
 * express, which is the usual way a settings API acquires a `null` that means three things.
 */
export const patchProjectSettingsSchema = z
  .object({
    password: passwordPolicySchema.optional(),
    otp: otpSettingsSchema.optional(),
    passkeys: passkeySettingsSchema.optional(),
    mfa: mfaSettingsSchema.optional(),
    recovery: recoverySettingsSchema.optional(),
    lifetimes: lifetimeSettingsSchema.optional(),
    linking: linkingSettingsSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "a patch must name at least one section",
  });
export type PatchProjectSettings = z.infer<typeof patchProjectSettingsSchema>;

/** The defaults, resolved once, for callers that need them without a database. */
export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = projectSettingsSchema.parse({});

// ── OAuth providers ──────────────────────────────────────────────────────────────────

export const providerModeSchema = z.enum(["instant", "custom"]);
export type ProviderMode = z.infer<typeof providerModeSchema>;

/**
 * A provider's configuration as the panel sees it.
 *
 * The secret is never here. `secretSet` says whether one is stored and that is the whole
 * of what a reader gets — a "show it again" field would rebuild, in a response body, the
 * retrievable-secret design the schema went out of its way to avoid by encrypting it under
 * the project's own data key.
 */
export const oauthProviderConfigSchema = z.object({
  provider: z.string().min(1).max(40),
  enabled: z.boolean(),
  mode: providerModeSchema,
  clientId: z.string().nullable(),
  secretSet: z.boolean(),
  scopes: z.array(z.string().max(120)).max(40),
  settings: z.record(z.string(), z.string()),
  storeTokens: z.boolean(),
});
export type OauthProviderConfig = z.infer<typeof oauthProviderConfigSchema>;

export const oauthProviderListSchema = z.object({
  providers: z.array(oauthProviderConfigSchema),
});
export type OauthProviderList = z.infer<typeof oauthProviderListSchema>;

/**
 * What a save may set.
 *
 * `clientSecret` absent leaves the stored one alone; a string replaces it; null clears it.
 * The three are distinguishable on purpose, because the panel never reads a secret back —
 * so a save that treated absent as "clear" would blank the credential every time somebody
 * toggled the enabled switch.
 */
export const saveOauthProviderSchema = z.object({
  enabled: z.boolean(),
  mode: providerModeSchema,
  clientId: z.string().max(400).nullable(),
  clientSecret: z.string().min(1).max(500).nullable().optional(),
  scopes: z.array(z.string().max(120)).max(40).default([]),
  settings: z.record(z.string(), z.string()).default({}),
  storeTokens: z.boolean().default(false),
});
export type SaveOauthProvider = z.infer<typeof saveOauthProviderSchema>;

/** Where a completed OAuth or magic-link flow may return the browser (PROJECT.md 4.6). */
export const redirectUriListSchema = z.object({ uris: z.array(z.url()) });
export type RedirectUriList = z.infer<typeof redirectUriListSchema>;

export const addRedirectUriSchema = z.object({ uri: z.url().max(2000) });
export type AddRedirectUri = z.infer<typeof addRedirectUriSchema>;

// ── Organisation members and invitations ─────────────────────────────────────────────

/**
 * A member of the organisation, as the Members screen shows them.
 *
 * The name and address are not on `org_members`: a member is a `user_id` there, and the
 * person behind it is a row in the dashboard project's own `users` table. Joining the two
 * is the management API's job rather than the screen's, so this carries what a reader needs
 * and the panel never has to know that the team lives in two planes.
 */
export const orgMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum([MemberRole.Owner, MemberRole.Admin, MemberRole.Developer, MemberRole.Viewer]),
  /** Whether they hold a second factor for the dashboard itself. */
  mfaEnrolled: z.boolean(),
  joinedAt: isoDateTimeSchema,
  /** Null for somebody who has never signed in since being added. */
  lastActiveAt: isoDateTimeSchema.nullable(),
});
export type OrgMember = z.infer<typeof orgMemberSchema>;

export const orgMemberListSchema = z.object({ members: z.array(orgMemberSchema) });
export type OrgMemberList = z.infer<typeof orgMemberListSchema>;

export const orgInvitationSchema = z.object({
  id: z.string(),
  email: emailSchema,
  role: z.enum([MemberRole.Admin, MemberRole.Developer, MemberRole.Viewer]),
  /** Who sent it, by name where we have one. Ownership never arrives by invitation. */
  invitedBy: z.string(),
  invitedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
});
export type OrgInvitation = z.infer<typeof orgInvitationSchema>;

export const orgInvitationListSchema = z.object({ invitations: z.array(orgInvitationSchema) });
export type OrgInvitationList = z.infer<typeof orgInvitationListSchema>;

/**
 * Owner is absent on purpose.
 *
 * Ownership moves by transfer and never by assignment: a role change that could grant it
 * would leave the organisation with two owners or none, which a partial unique index
 * already refuses at the database. Leaving it out of the enum means the API refuses it
 * before the database has to.
 */
export const assignableRoleSchema = z.enum([
  MemberRole.Admin,
  MemberRole.Developer,
  MemberRole.Viewer,
]);
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: assignableRoleSchema,
});
export type InviteMember = z.infer<typeof inviteMemberSchema>;

export const setMemberRoleSchema = z.object({ role: assignableRoleSchema });
export type SetMemberRole = z.infer<typeof setMemberRoleSchema>;

/** Ownership moves to an existing member, never to an address that has not joined. */
export const transferOwnershipSchema = z.object({ memberId: z.string() });
export type TransferOwnership = z.infer<typeof transferOwnershipSchema>;

export const orgSecuritySchema = z.object({ requireMfa: z.boolean() });
export type OrgSecurity = z.infer<typeof orgSecuritySchema>;

// ── Project detail and renames ───────────────────────────────────────────────────────

/**
 * What the General settings screen states about a project.
 *
 * `createdAt` is read-only because it is a fact rather than a setting; `name` is the one
 * field the screen may change.
 */
export const projectDetailSchema = z.object({
  id: projectIdSchema,
  orgId: z.string(),
  name: z.string(),
  tier: z.string(),
  plan: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ProjectDetail = z.infer<typeof projectDetailSchema>;

/** A name, for a project or an organisation. The one field either of them may change. */
export const renameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export type Rename = z.infer<typeof renameSchema>;

// ── Retention ────────────────────────────────────────────────────────────────────────

/**
 * How long one subject is kept, and what happens when it is not.
 *
 * `action` is on the wire and not settable: it is a property of the data rather than a
 * choice, and a screen that offered it would be offering to purge the accounts an audit
 * trail points at. `source` says whether the age is this project's or the one it is swept
 * at until somebody picks — a project with no row is swept exactly like one with the
 * default saved, and a screen that could not tell them apart would have no way to say so.
 */
export const retentionPolicySchema = z.object({
  subject: z.enum(RetentionSubject),
  maxAge: z.string(),
  action: z.enum(RetentionAction),
  source: z.enum(["project", "default", "tier"]),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const retentionPolicyListSchema = z.object({ policies: z.array(retentionPolicySchema) });
export type RetentionPolicyList = z.infer<typeof retentionPolicyListSchema>;

/**
 * One age, for one subject.
 *
 * Both fields are checked against `RETENTION_CHOICES` in the service rather than by a
 * refinement here, because the refusal has to name which of the two was wrong: an unknown
 * subject and an age outside a subject's menu are different mistakes with different fixes,
 * and a single `invalid_union` tells a caller neither.
 */
export const setRetentionPolicySchema = z.object({
  subject: z.enum(RetentionSubject),
  maxAge: z.string().min(2).max(16),
});
export type SetRetentionPolicy = z.infer<typeof setRetentionPolicySchema>;
