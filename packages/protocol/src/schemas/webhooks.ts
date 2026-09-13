import { z } from "zod";
import { IdPrefix } from "./common.js";

/**
 * The webhook wire contract: what we send, how it is signed, and when we send it again
 * (PROJECT.md 3.2, ADR-0012).
 *
 * Here rather than in any one reader because four of them have to agree and two ship to
 * customers: the worker signs with it, the management API validates endpoints with it, the panel
 * documents it on screen, and the server SDK verifies with it. A constant one side spells
 * differently is not a compile error anywhere — it is a customer's verifier rejecting every
 * delivery, which looks exactly like our signature being wrong.
 *
 * Nothing here is a schema for something we receive. A webhook is the one direction where we are
 * the client, so the rules are about what we promise to send and what a receiver may rely on.
 */

/*
 * The events.
 */

export const WebhookEventGroup = {
  Accounts: "accounts",
  Sessions: "sessions",
  Delivery: "delivery",
  Security: "security",
} as const;
export type WebhookEventGroup = (typeof WebhookEventGroup)[keyof typeof WebhookEventGroup];

/**
 * Every event a project may subscribe to.
 *
 * Named `noun.verb` in the past tense, because a webhook is a statement about something that has
 * already happened. An event that could be refused after we sent it would be a different feature
 * (PROJECT.md 4.12 declines synchronous blocking hooks for now).
 */
export const WebhookEventType = {
  UserCreated: "user.created",
  UserUpdated: "user.updated",
  UserDeleted: "user.deleted",
  UserSuspended: "user.suspended",
  SessionCreated: "session.created",
  SessionRevoked: "session.revoked",
  EmailBounced: "email.bounced",
  EmailComplained: "email.complained",
  SmsBlocked: "sms.blocked",
  RefreshTokenReused: "security.refresh_token_reused",
  StaffAccessGranted: "security.staff_access_granted",
  MfaEnrolled: "mfa.enrolled",
  MfaRemoved: "mfa.removed",
} as const;
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

/**
 * Sent by "send a test event" and subscribed to by nobody.
 *
 * Deliberately outside `WebhookEventType`: a receiver has to be able to recognise a test and not
 * act on it, and a test that arrived as a real event type would be indistinguishable from one.
 */
export const WEBHOOK_TEST_EVENT = "webhook.test";

/**
 * What a test event carries.
 *
 * Enough for a receiver to prove the whole path — it parses, the signature verifies, the id is there
 * to dedupe on — and nothing that looks like a user. A test payload shaped like a real event is one
 * somebody's production handler acts on, which is exactly what a test must not do.
 */
export function webhookTestData(projectId: string): Readonly<Record<string, unknown>> {
  return {
    message: "This is a test delivery from Idenzy. Nothing about your project changed.",
    project: projectId,
  };
}

export const WEBHOOK_EVENT_GROUP_OF: Record<WebhookEventType, WebhookEventGroup> = {
  [WebhookEventType.UserCreated]: WebhookEventGroup.Accounts,
  [WebhookEventType.UserUpdated]: WebhookEventGroup.Accounts,
  [WebhookEventType.UserDeleted]: WebhookEventGroup.Accounts,
  [WebhookEventType.UserSuspended]: WebhookEventGroup.Accounts,
  [WebhookEventType.SessionCreated]: WebhookEventGroup.Sessions,
  [WebhookEventType.SessionRevoked]: WebhookEventGroup.Sessions,
  [WebhookEventType.EmailBounced]: WebhookEventGroup.Delivery,
  [WebhookEventType.EmailComplained]: WebhookEventGroup.Delivery,
  [WebhookEventType.SmsBlocked]: WebhookEventGroup.Delivery,
  [WebhookEventType.RefreshTokenReused]: WebhookEventGroup.Security,
  [WebhookEventType.StaffAccessGranted]: WebhookEventGroup.Security,
  [WebhookEventType.MfaEnrolled]: WebhookEventGroup.Security,
  [WebhookEventType.MfaRemoved]: WebhookEventGroup.Security,
};

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = Object.values(WebhookEventType);

/**
 * Events nothing emits yet, which is a fact about the platform and therefore belongs here.
 *
 * It lived in the worker, where only the worker could read it — so the panel went on offering
 * thirteen subscriptions as though all thirteen sent something, and six of them save and stay silent.
 * A customer cannot be expected to discover that by waiting.
 *
 * Each is waiting on the thing that would enqueue it: deletion needs the erasure path and suspension
 * a users screen that can ban somebody, and nothing writes `banned_until` or `deleted_at` today; the
 * three delivery events need the SES and SMS event paths; staff access needs the break-glass flow.
 * `webhook-events.test.ts` in the worker holds this list and the topic map together, because a list of
 * known gaps that is itself out of date is worse than no list.
 */
export const WEBHOOK_EVENTS_WITHOUT_EMITTER: readonly WebhookEventType[] = [
  WebhookEventType.UserDeleted,
  WebhookEventType.UserSuspended,
  WebhookEventType.EmailBounced,
  WebhookEventType.EmailComplained,
  WebhookEventType.SmsBlocked,
  WebhookEventType.StaffAccessGranted,
];

/** Whether subscribing to this event will actually deliver anything today. */
export function isWebhookEventEmitted(type: string): boolean {
  return (
    isWebhookEventType(type) &&
    !(WEBHOOK_EVENTS_WITHOUT_EMITTER as readonly string[]).includes(type)
  );
}

/** Whether a string is an event a subscription may name. The test event is not one. */
export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/*
 * The envelope.
 */

/**
 * What arrives in the body, for every event.
 *
 * The shape is fixed and the `data` inside it is not, so a receiver writes one parser for the
 * envelope and switches on `type`. Four fields earn their place:
 *
 * - `id` is the delivery id, stable across every attempt, and the key a receiver dedupes on. It
 *   is repeated in `X-Idenzy-Delivery` so a receiver can dedupe before parsing a body.
 * - `sequence` is the event's total order within the cell, from the outbox. Delivery is unordered
 *   by construction, so this is how a receiver that cares about order sorts rather than assumes.
 * - `createdAt` is when the event happened, which is not when the delivery was signed: a retry a
 *   day later carries the original instant and a fresh timestamp header.
 * - `project` is here because a customer with several projects pointing at one endpoint cannot
 *   otherwise tell which one is speaking.
 */
export const webhookEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string(),
  sequence: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  project: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>;

/**
 * The envelope for one delivery, assembled rather than stored.
 *
 * A delivery row keeps the event's `data` and nothing else, because everything around it is already
 * on the row: the id, the type, the sequence, the instant it happened and the project. Assembling
 * at send time is what makes a retry byte-identical — same id, same data, same `createdAt` — so the
 * signature covers the same string on the eighth attempt as on the first, and a receiver deduping
 * on the id sees one delivery rather than two events that happen to look alike.
 *
 * Both senders and the dashboard build it here, so what the screen shows as the body is the body.
 */
export function buildWebhookEnvelope(parts: {
  readonly deliveryId: string;
  readonly type: string;
  readonly sequence: number;
  readonly createdAt: Date;
  readonly projectId: string;
  readonly data: Readonly<Record<string, unknown>>;
}): WebhookEnvelope {
  return {
    id: parts.deliveryId,
    type: parts.type,
    sequence: parts.sequence,
    createdAt: parts.createdAt.toISOString(),
    project: parts.projectId,
    data: { ...parts.data },
  };
}

/*
 * What an event says.
 */

/**
 * One field of an event's `data`, as a customer sees it.
 *
 * A declaration rather than a derivation, and an allowlist rather than a filter, for the same reason
 * the log allowlist is one: what leaves for somebody else's server has to be a decision. An outbox
 * payload is an internal message — the revocation reconciler parses raw uuids out of the same rows —
 * so passing one through verbatim publishes whatever the next person adds to it. It already did:
 * reuse detection carries a refresh-token family id no customer can look up and a `likelyCause`
 * string that is our own guess, and both would have been part of the contract.
 *
 * `from` is the key in the payload, `as` the name a customer reads it under, `id` the kind of
 * identifier when the value is one of ours and has to be published in its public form, and `sample`
 * the value the panel documents. One table, so the wire and the documentation cannot disagree.
 */
export interface WebhookDataField {
  readonly from: string;
  readonly as?: string;
  readonly id?: IdPrefix;
  /** A list of ids rather than one. */
  readonly many?: boolean;
  readonly sample: unknown;
}

/**
 * What each event carries, for the events something actually emits.
 *
 * Partial on purpose: an event nothing sends has no shape to declare, and inventing one would
 * document a body no receiver will ever see. `WEBHOOK_EVENTS_WITHOUT_EMITTER` is the other half of
 * that statement, and a test holds the two together.
 *
 * No timestamp in `data`. The envelope's `createdAt` is the instant the event happened, and two
 * fields for one fact is how they come to disagree.
 */
export const WEBHOOK_DATA_FIELDS: Partial<Record<WebhookEventType, readonly WebhookDataField[]>> = {
  [WebhookEventType.UserCreated]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    { from: "email", sample: "ada@example.com" },
    { from: "phone", sample: null },
    { from: "emailVerified", sample: false },
    { from: "phoneVerified", sample: false },
  ],
  [WebhookEventType.UserUpdated]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    // Which of the three things happened, because three internal topics become this one event and a
    // receiver that cannot tell a verified address from a changed password has to guess.
    { from: "changed", sample: "email_verified" },
  ],
  [WebhookEventType.SessionCreated]: [
    {
      from: "sessionId",
      as: "session",
      id: IdPrefix.Session,
      sample: "ses_1f0b1e6c8a7d4e2f9b3c5d8a7e6f4b21",
    },
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    // The same `amr` a customer already reads off our access tokens, so one vocabulary covers both.
    { from: "amr", sample: ["password"] },
    { from: "ip", sample: "203.0.113.11" },
    { from: "userAgent", sample: "Mozilla/5.0" },
  ],
  [WebhookEventType.SessionRevoked]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    {
      from: "sessionIds",
      as: "sessions",
      id: IdPrefix.Session,
      many: true,
      sample: ["ses_1f0b1e6c8a7d4e2f9b3c5d8a7e6f4b21"],
    },
    { from: "scope", sample: "all" },
  ],
  [WebhookEventType.MfaEnrolled]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    { from: "type", as: "factorType", sample: "totp" },
  ],
  [WebhookEventType.MfaRemoved]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    {
      from: "factorId",
      as: "factor",
      id: IdPrefix.Factor,
      sample: "mfa_6b1e0c9f2a4d8e3b7c5a9d4f2e8b1c63",
    },
  ],
  [WebhookEventType.RefreshTokenReused]: [
    {
      from: "userId",
      as: "user",
      id: IdPrefix.User,
      sample: "usr_8f14e45fceea167a5a36dedd4bea2543",
    },
    {
      from: "sessionId",
      as: "session",
      id: IdPrefix.Session,
      sample: "ses_1f0b1e6c8a7d4e2f9b3c5d8a7e6f4b21",
    },
    // How many refresh tokens went with the family, which is the part a customer's incident response
    // acts on. The family's own id is ours and is not published: there is nothing they can do with it.
    { from: "revokedTokens", sample: 2 },
    { from: "ip", sample: "203.0.113.11" },
    { from: "userAgent", sample: "Mozilla/5.0" },
  ],
};

/**
 * The `data` the panel documents for an event, from the same declaration the wire uses.
 *
 * An empty object for an event nothing emits yet, which is the truthful sample: there is no body to
 * show because there is no sender.
 */
export function webhookDataSample(type: WebhookEventType): Record<string, unknown> {
  const fields = WEBHOOK_DATA_FIELDS[type] ?? [];
  const sample: Record<string, unknown> = {};
  for (const field of fields) sample[field.as ?? field.from] = field.sample;
  return sample;
}

/**
 * The most a body may be, which is a cap on us rather than on the customer.
 *
 * An event carrying an unbounded field — a metadata blob, a user's own JSON — would be a delivery
 * we cannot sign in constant memory and a receiver cannot buffer safely. Anything larger is sent
 * with the offending field omitted rather than dropped silently, so the event still arrives.
 */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/*
 * Signing.
 *
 * The header names are not in `IdenzyHeader`: that enum is what a browser may send us and is
 * mirrored by the CORS allowlist, and these three travel the other way, on a request we make to
 * somebody else's server. Putting them there would offer them to browsers for no reason.
 */

export const WEBHOOK_SIGNATURE_HEADER = "X-Idenzy-Signature";
export const WEBHOOK_TIMESTAMP_HEADER = "X-Idenzy-Timestamp";
export const WEBHOOK_DELIVERY_HEADER = "X-Idenzy-Delivery";
export const WEBHOOK_EVENT_HEADER = "X-Idenzy-Event";
export const WEBHOOK_ATTEMPT_HEADER = "X-Idenzy-Attempt";

/** The only scheme we sign with. Named on the wire so a second one can be added beside it. */
export const WEBHOOK_SIGNATURE_SCHEME = "sha256";

/**
 * How far out of step a timestamp may be before a receiver refuses the delivery.
 *
 * Enough for a clock nobody synchronised, short enough that a captured request is not a credential
 * a week later. Refusing on it is what makes the signature replay-safe rather than merely
 * authentic, and it is the receiver's check to make: we cannot enforce it from this end.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** How long both secrets sign every delivery after a rotation (ADR-0012). */
export const WEBHOOK_ROTATION_OVERLAP_HOURS = 24;

/**
 * Exactly what a signature covers: the timestamp, a dot, then the raw body.
 *
 * The timestamp is inside the signed string rather than beside it, or a captured signature could
 * be replayed with its timestamp moved forward and the tolerance check would pass. The body is the
 * bytes as sent, not a re-serialisation of a parsed object: a receiver that verifies against
 * `JSON.stringify(req.body)` is verifying a different string and will fail on whitespace, key
 * order, or a number that round-trips differently.
 */
export function webhookSignedPayload(timestamp: number, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/**
 * The header value: one `<scheme>=<hex>` per secret in force, newest first.
 *
 * The scheme is a parameter rather than the constant it defaults to, because the whole point of
 * naming it on the wire is that a second one can be added beside it. Baked in, the first signer
 * with a different primitive would emit digests labelled `sha256=` and every receiver would
 * verify them as SHA-256.
 */
export function webhookSignatureHeader(
  hexDigests: readonly string[],
  scheme: string = WEBHOOK_SIGNATURE_SCHEME,
): string {
  return hexDigests.map((hex) => `${scheme}=${hex}`).join(", ");
}

const HEX_DIGEST = /^[0-9a-f]{64}$/;

/**
 * The digests in a signature header, or an empty list.
 *
 * Parsed rather than compared whole, which is the note's first finding on the webhooks screen: a
 * verifier that compares the header against a bare digest fails on the documented header, and one
 * that ignores the scheme would accept `md5=` from whatever wrote it. An entry that is not
 * `sha256=` followed by 64 lowercase hex characters is dropped rather than refused, so an
 * unrecognised scheme added later does not break a verifier written today.
 */
export function parseWebhookSignatureHeader(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .flatMap((entry) => {
      const at = entry.indexOf("=");
      if (at === -1) return [];
      const scheme = entry.slice(0, at).trim().toLowerCase();
      const hex = entry
        .slice(at + 1)
        .trim()
        .toLowerCase();
      return scheme === WEBHOOK_SIGNATURE_SCHEME && HEX_DIGEST.test(hex) ? [hex] : [];
    });
}

/** Whether a delivery is too old to accept, which a receiver checks before the digest. */
export function isWebhookTimestampStale(timestamp: number, nowSeconds: number): boolean {
  return (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  );
}

/*
 * Where a delivery is, said two ways.
 */

/**
 * The four states a delivery row holds, which is the pipeline's own vocabulary.
 *
 * `queued` and `delivering` are separate because a dispatcher has to tell a delivery nobody has
 * picked up from one another dispatcher is mid-call on. Nothing outside the pipeline needs that
 * distinction, which is why it is not what the dashboard is answered with.
 */
export const WebhookDeliveryStatus = {
  Queued: "queued",
  Delivering: "delivering",
  Delivered: "delivered",
  Failed: "failed",
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];

/** The three a reader cares about: it worked, it has not yet, or it is not going to. */
export const WebhookDeliveryOutcome = {
  Pending: "pending",
  Delivered: "delivered",
  Failed: "failed",
} as const;
export type WebhookDeliveryOutcome =
  (typeof WebhookDeliveryOutcome)[keyof typeof WebhookDeliveryOutcome];

/**
 * One from the other.
 *
 * A function rather than a map written at each reader, because collapsing `delivering` into
 * `pending` is a decision about what a customer is told and not a formatting detail: a delivery
 * being attempted right now is still one they are waiting on.
 */
export function webhookOutcomeOf(status: WebhookDeliveryStatus): WebhookDeliveryOutcome {
  if (status === WebhookDeliveryStatus.Delivered) return WebhookDeliveryOutcome.Delivered;
  if (status === WebhookDeliveryStatus.Failed) return WebhookDeliveryOutcome.Failed;
  return WebhookDeliveryOutcome.Pending;
}

/*
 * Retrying.
 */

/**
 * How long after attempt `n` the next one goes out, in seconds.
 *
 * Ours and published, not a queue setting: the panel states it, the SDK docs quote it, and a
 * customer plans their own alerting around it, so it changes as a documented change. A little over
 * a day in total, which means an endpoint down for an afternoon loses nothing.
 */
export const WEBHOOK_RETRY_SCHEDULE: readonly number[] = [10, 60, 300, 1800, 7200, 21600, 86400];

/** Including the first call, which is not a retry. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_SCHEDULE.length + 1;

/** How long after attempt `n` the next one is due, or null once there are none left. */
export function webhookRetryDelaySeconds(attempt: number): number | null {
  return WEBHOOK_RETRY_SCHEDULE[attempt - 1] ?? null;
}

/**
 * How long we wait for an answer, and why the two differ (ADR-0012).
 *
 * The first attempt shares a bounded pool with every other project's first attempts, so a slow
 * endpoint there costs everybody a slot: five seconds, and anything slower falls into the retry
 * lane where it has a task of its own and fifteen.
 */
export const WEBHOOK_INLINE_TIMEOUT_MS = 5_000;
export const WEBHOOK_RETRY_TIMEOUT_MS = 15_000;

/** Consecutive failed deliveries before an endpoint is switched off with a reason. */
export const WEBHOOK_FAILURES_BEFORE_DISABLED = 20;

/** The most of a customer's own response we keep as evidence, in bytes. */
export const WEBHOOK_RESPONSE_EXCERPT_BYTES = 2048;

/*
 * Where a delivery may be sent.
 */

/**
 * Hosts a delivery may never be addressed to.
 *
 * This is an SSRF allowlist inverted, and it is sharper here than in most places that do this:
 * the panel shows the customer an excerpt of the response, so an endpoint naming an internal
 * address is a read primitive against our own network rather than merely a wasted request
 * (ADR-0012).
 *
 * Literal addresses and the metadata name are what a schema can catch. A hostname that *resolves*
 * to one of these is not, and that check belongs at delivery time.
 */
const BLOCKED_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
]);

/** Private, loopback, link-local and unique-local ranges, as literals in a URL. */
const BLOCKED_IPV4 =
  /^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isBlockedIpv6(host: string): boolean {
  if (!host.startsWith("[")) return false;
  const inner = host.slice(1, host.indexOf("]") === -1 ? undefined : host.indexOf("]"));
  return (
    inner === "::1" ||
    inner === "::" ||
    inner.startsWith("fe80:") ||
    inner.startsWith("fc") ||
    inner.startsWith("fd") ||
    // An IPv4-mapped address is the same address with a longer spelling.
    inner.startsWith("::ffff:")
  );
}

/**
 * Where a webhook may be sent: an https URL naming a public host, with no credentials in it.
 *
 * https only, because the payload names users and the signature is not encryption. No userinfo,
 * because a secret in a URL is a secret in our logs and in the customer's. No fragment, because a
 * fragment is never sent and its presence means somebody pasted a browser address.
 */
export const webhookUrlSchema = z
  .string()
  .trim()
  .min(12)
  .max(2048)
  .refine((value) => parsedWebhookUrl(value) !== null, {
    message: "An https URL, with no credentials and no fragment.",
  })
  .refine((value) => parsedWebhookUrl(value)?.scheme !== "http", {
    message: "Only https: a delivery names your users and a signature is not encryption.",
  })
  .refine((value) => !isBlockedWebhookHost(parsedWebhookUrl(value)?.host ?? ""), {
    message: "A public host. An internal address is refused rather than called.",
  })
  // The scheme and host are case-insensitive and the path is not, so only the first two are
  // lowered: an endpoint at `/Hooks/Idenzy` is a different route from `/hooks/idenzy`.
  .transform((value) => {
    const parsed = parsedWebhookUrl(value);
    return parsed === null ? value.trim() : `${parsed.scheme}://${parsed.host}${parsed.path}`;
  });

/** Whether a host is one a delivery must never reach. Exported for the delivery-time check. */
export function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === "") return true;
  const bare = host.startsWith("[") ? host : (host.split(":")[0] ?? "");
  if (BLOCKED_HOSTS.has(bare)) return true;
  if (bare.endsWith(".localhost") || bare.endsWith(".internal")) return true;
  if (IPV4.test(bare)) return BLOCKED_IPV4.test(bare);
  return isBlockedIpv6(bare);
}

export interface WebhookUrlParts {
  readonly scheme: string;
  /** Host and port, lowercased, as a `Host` header would carry it. */
  readonly host: string;
  /** Path and query, exactly as typed, or an empty string. */
  readonly path: string;
}

/**
 * The parts of a URL we could deliver to, or null.
 *
 * A pattern rather than `URL`, for the reason the origin schema next door gives: this package
 * declares neither DOM nor node globals, because it is parsed by browsers, workers, React Native
 * and servers alike. The authority excludes `@`, `/`, `?` and `#` by construction, which is how
 * userinfo is refused rather than parsed and then checked.
 */
const WEBHOOK_URL_PATTERN =
  /^(https?):\/\/((?:[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*|\[[\da-f:.]+\])(?::\d{1,5})?)((?:\/[^#]*)?)$/i;

function parsedWebhookUrl(value: string): WebhookUrlParts | null {
  const match = WEBHOOK_URL_PATTERN.exec(value.trim());
  if (match === null) return null;
  const [, scheme = "", host = "", path = ""] = match;
  const port = host.split(/:(?=\d+$)/)[1];
  if (port !== undefined && Number(port) > 65_535) return null;
  return { scheme: scheme.toLowerCase(), host: host.toLowerCase(), path };
}
