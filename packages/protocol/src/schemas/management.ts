import { z } from "zod";
import {
  ApiKeyKind,
  MemberRole,
  ProjectDomainStatus,
  ProjectDomainType,
} from "../enums/tenancy.js";
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

/** A region a project can be pinned to. Only cells we actually run are ever listed. */
export const regionSchema = z.object({
  code: z.string(),
  jurisdiction: z.string(),
  /** The API host projects in this cell are reached on. What an SDK is pointed at. */
  endpoint: z.string(),
});
export type Region = z.infer<typeof regionSchema>;

export const regionListSchema = z.object({ regions: z.array(regionSchema) });
export type RegionList = z.infer<typeof regionListSchema>;

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
 * The name and the region are required because both are written into rows that cannot be
 * changed afterwards — a cell is pinned at creation and moving a project is an audited
 * migration, not a setting (PROJECT.md 4.13.5). The rest is a survey: skipping it is a
 * normal answer and stores no row at all.
 */
export const startOnboardingSchema = z.object({
  projectName: projectNameSchema,
  /** `region_cells.code`. Checked against the active list, never trusted from the body. */
  region: z.string().min(1).max(40),
  organisationName: z.string().trim().min(1).max(120).optional(),
  useCase: z.string().trim().min(1).max(500).optional(),
  heardFrom: z.string().trim().min(1).max(200).optional(),
});
export type StartOnboarding = z.infer<typeof startOnboardingSchema>;

export const createProjectSchema = z.object({
  name: projectNameSchema,
  region: z.string().min(1).max(40),
});
export type CreateProject = z.infer<typeof createProjectSchema>;

export const projectSummarySchema = z.object({
  id: z.string(),
  /** The organisation that owns it. The panel keys every screen on the pair. */
  orgId: z.string(),
  name: z.string(),
  region: z.string(),
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
 * Balance is absent too, and that is a decision rather than an omission. Nothing can fund
 * an account yet, so every figure would be a real zero where the billing screens currently
 * show a fixture — a regression dressed as progress. It joins this shape when a top-up can
 * actually happen.
 */
export const meSchema = z.object({
  organisations: z.array(orgSummarySchema),
  /** Every project across every organisation the caller belongs to. */
  projects: z.array(projectSummarySchema),
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
 * The loopback hosts a browser treats as a secure context.
 *
 * Listed in order to refuse them. Loopback is allowed by the deployment while it runs outside
 * production, in application code and gated on the environment, so it cannot be switched on
 * by data — which means a row for it grants nothing in production and is not needed anywhere
 * else.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

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

/** Whether an origin names a loopback host, which this list refuses and code allows. */
export function isLoopbackOrigin(value: string): boolean {
  const parts = parseBrowserOrigin(value);
  return parts !== null && LOOPBACK_HOSTS.has(parts.host);
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
