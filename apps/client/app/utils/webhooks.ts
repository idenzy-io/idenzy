/**
 * Endpoints a project wants told about things, and what happened when we told them
 * (`webhooks`, `webhook_deliveries`, PROJECT.md 3.3, 9.4, notes/webhooks.md).
 *
 * Nothing delivers yet. No worker consumes the webhook topic, and `webhooks.secret_hash` is a
 * digest, which can check a secret and cannot sign with one, so where the signing key lives
 * is itself undecided (notes/webhooks.md P1). `WEBHOOK_DELIVERY` says so, and every figure and
 * action that would need a delivery reads it: an endpoint is saved and never called, health
 * is not measured, and a test event or a retry is unavailable rather than pretending to run.
 *
 * What the screen does state are the properties a receiver is written against: at least once,
 * no order, 2xx only, signed over the timestamp and the raw body. Those are the design, and the
 * verifier sample below is executed by the tests against it, malformed signatures included.
 */

/*
 * Whether anything is sent.
 */

export interface DeliveryCapability {
  running: boolean;
  /** Why not, in the reader's words, for the strip that says so. */
  reason: string;
}

/** Read by every figure and action that would need a delivery to have happened. */
export const WEBHOOK_DELIVERY: DeliveryCapability = {
  running: false,
  reason:
    "No worker delivers webhooks yet, and how the signing secret is kept so it can sign is not settled. Endpoints are saved and nothing is sent to them.",
};

/*
 * What can be subscribed to.
 */

export type EventGroup = "accounts" | "sessions" | "delivery" | "security";

export const EVENT_GROUPS: readonly EventGroup[] = ["accounts", "sessions", "delivery", "security"];

export const EVENT_GROUP_LABELS: Record<EventGroup, string> = {
  accounts: "Accounts",
  sessions: "Sessions",
  delivery: "Email and SMS",
  security: "Security",
};

/** One line under a group's name, so a reader can pick a group before reading its events. */
export const EVENT_GROUP_NOTES: Record<EventGroup, string> = {
  accounts: "An account made, changed, suspended or deleted.",
  sessions: "A sign-in completing, or a session somebody ended.",
  delivery: "Mail and messages refused, before or after sending.",
  security: "Signals worth paging on, and second factors added or removed.",
};

export interface WebhookEvent {
  id: string;
  group: EventGroup;
  /** What it means, in the reader's terms rather than the column's. */
  note: string;
}

export const WEBHOOK_EVENTS: readonly WebhookEvent[] = [
  {
    id: "user.created",
    group: "accounts",
    note: "An account exists. Sent before the address is verified, because that is a second event.",
  },
  {
    id: "user.updated",
    group: "accounts",
    note: "A profile field, an address or a phone number changed. The payload carries what it was and what it is now.",
  },
  {
    id: "user.deleted",
    group: "accounts",
    note: "The account is gone. Sent after the row is deleted, so anything you keep about them is now yours alone to erase.",
  },
  {
    id: "user.suspended",
    group: "accounts",
    note: "Somebody suspended the account. Every session it held is already revoked by the time this arrives.",
  },
  {
    id: "session.created",
    group: "sessions",
    note: "A sign-in completed. The payload names the method and the device the client gave.",
  },
  {
    id: "session.revoked",
    group: "sessions",
    note: "A session ended by somebody acting rather than by a clock. The reason is on the payload.",
  },
  {
    id: "email.bounced",
    group: "delivery",
    note: "The receiving server refused an address for good. It is on the block list from that moment.",
  },
  {
    id: "email.complained",
    group: "delivery",
    note: "The recipient pressed the spam button and their provider told us.",
  },
  {
    id: "sms.blocked",
    group: "delivery",
    note: "A message was refused before it cost anything: an unallowed country, a velocity ceiling, or the day's spend cap.",
  },
  {
    id: "security.refresh_token_reused",
    group: "security",
    note: "A refresh token was presented twice. Every session in that family is already revoked, and this is the signal worth paging on.",
  },
  {
    id: "security.staff_access_granted",
    group: "security",
    note: "One of ours was granted time-boxed access to your project, so you can see us look at your tenant.",
  },
  {
    id: "mfa.enrolled",
    group: "security",
    note: "A user added a second factor. The kind is on the payload; nothing about the factor itself is.",
  },
  {
    id: "mfa.removed",
    group: "security",
    note: "A user removed one. Worth watching: it is the step an account takeover takes before it changes anything else.",
  },
];

/** Sent by Send test event and never subscribed to, so a receiver can recognise a test. */
export const TEST_EVENT = "webhook.test";

const EVENT_BY_ID = new Map(WEBHOOK_EVENTS.map((event) => [event.id, event]));

export function eventInfo(id: string): WebhookEvent | null {
  return EVENT_BY_ID.get(id) ?? null;
}

export function eventsIn(group: EventGroup): WebhookEvent[] {
  return WEBHOOK_EVENTS.filter((event) => event.group === group);
}

/** Every event there is, for the endpoint that wants all of them and any added later. */
export const ALL_EVENTS: readonly string[] = WEBHOOK_EVENTS.map((event) => event.id);

export interface GroupSelection {
  chosen: number;
  total: number;
  state: "none" | "some" | "all";
}

/** How much of a group is chosen, for its header while it is folded. */
export function groupSelection(group: EventGroup, chosen: readonly string[]): GroupSelection {
  const ids = eventsIn(group).map((event) => event.id);
  const count = ids.filter((id) => chosen.includes(id)).length;
  return {
    chosen: count,
    total: ids.length,
    state: count === 0 ? "none" : count === ids.length ? "all" : "some",
  };
}

/** The whole group taken, or the whole group left when all of it already was. */
export function toggleGroup(group: EventGroup, chosen: readonly string[]): string[] {
  const ids = eventsIn(group).map((event) => event.id);
  if (groupSelection(group, chosen).state === "all") {
    return chosen.filter((id) => !ids.includes(id));
  }
  return [...chosen, ...ids.filter((id) => !chosen.includes(id))];
}

export function toggleEvent(id: string, chosen: readonly string[]): string[] {
  return chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id];
}

/**
 * How an endpoint's selection is written: the count, or that it takes everything. An endpoint
 * that asked for every event receives the next one we add; one that ticked all thirteen does
 * not, and the difference is invisible until the day it matters.
 */
export function subscriptionLabel(events: readonly string[], all: boolean): string {
  if (all) return "Every event, including new ones";
  if (events.length === 0) return "No events";
  return `${events.length} ${events.length === 1 ? "event" : "events"}`;
}

/*
 * An endpoint.
 */

/** Why an endpoint is off. A person pausing it and a run of failures are different stories. */
export interface EndpointDisabled {
  kind: "paused" | "failing";
  at: string;
  /** Who paused it. Null for the automatic switch-off. */
  by: string | null;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** What it is for, in the customer's words. Theirs to write and ours to show. */
  description: string;
  enabled: boolean;
  /** Null while it is on. */
  disabled: EndpointDisabled | null;
  /** Chosen events. Ignored while `allEvents` is set. */
  events: string[];
  /** Everything, including events that do not exist yet. */
  allEvents: boolean;
  createdAt: string;
  /** When the signing secret was last replaced. Null means it is the original. */
  rolledAt: string | null;
  /** Until when the previous secret also signs, during a rotation. Null otherwise. */
  previousSecretUntil: string | null;
}

export type StateTone = "success" | "warning" | "error" | "neutral";

/** The enabled-state column: what the endpoint is set to, and why when it is off. */
export function endpointState(endpoint: WebhookEndpoint): {
  label: string;
  tone: StateTone;
  detail: string;
} {
  if (endpoint.enabled) {
    return WEBHOOK_DELIVERY.running
      ? { label: "On", tone: "success", detail: "" }
      : { label: "On", tone: "neutral", detail: "Saved, nothing sent" };
  }
  if (endpoint.disabled?.kind === "failing") {
    return { label: "Off", tone: "error", detail: `After ${FAILURES_BEFORE_DISABLED} failures` };
  }
  const by = endpoint.disabled?.by;
  return { label: "Paused", tone: "neutral", detail: by ? `By ${by}` : "" };
}

/*
 * Naming one.
 */

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)$/i;

export type EndpointIssue =
  | "url_invalid"
  | "url_insecure"
  | "url_unreachable"
  | "url_duplicate"
  | "events_empty";

export const ENDPOINT_ISSUE_LABELS: Record<EndpointIssue, string> = {
  url_invalid: "A full URL, with a scheme and a host: https://example.com/hooks/idenzy.",
  url_insecure:
    "Only https. A payload signed and then sent in the clear is one anybody on the network can read and act on.",
  url_unreachable:
    "We call this from our own network, so an address on your machine is one nothing of ours can reach. Use a tunnel that gives you a public hostname.",
  url_duplicate: "This project already sends to that URL.",
  events_empty: "An endpoint with no events would be called for nothing at all.",
};

/** The URL as it is stored: the query and the path kept, the fragment dropped. */
export function normaliseEndpointUrl(value: string): string {
  const text = value.trim();
  try {
    const url = new URL(text);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return text;
  }
}

export function validateEndpointUrl(
  value: string,
  existing: readonly string[],
): EndpointIssue | null {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "url_invalid";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "url_invalid";
  if (LOOPBACK.test(url.hostname)) return "url_unreachable";
  if (url.protocol !== "https:") return "url_insecure";
  const stored = normaliseEndpointUrl(text);
  if (existing.map(normaliseEndpointUrl).includes(stored)) return "url_duplicate";
  return null;
}

/*
 * How a delivery is signed.
 */

export const SIGNATURE_HEADER = "X-Idenzy-Signature";
export const TIMESTAMP_HEADER = "X-Idenzy-Timestamp";
export const DELIVERY_HEADER = "X-Idenzy-Delivery";

/**
 * How far out of step a timestamp may be before a receiver refuses the delivery. Enough for a
 * clock nobody synchronised, short enough that a captured request is not a credential a week
 * later: refusing on it is what makes the signature replay-safe rather than merely authentic.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

/** How long both secrets sign each delivery after a rotation. */
export const ROTATION_OVERLAP_HOURS = 24;

/**
 * Exactly what a signature covers: the timestamp, a dot, then the raw body. The timestamp is
 * inside the signed string, or a captured signature could be kept and its timestamp moved.
 */
export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** The header as sent: one `sha256=<hex>` per secret in force, the newest first. */
export function signatureHeader(hexDigests: readonly string[]): string {
  return hexDigests.map((hex) => `sha256=${hex}`).join(", ");
}

/** Whether a delivery is too old to accept, which a receiver checks before the digest. */
export function isStale(timestamp: number, now: Date): boolean {
  return Math.abs(now.getTime() / 1000 - timestamp) > TIMESTAMP_TOLERANCE_SECONDS;
}

export const VERIFY_IMPORT = `import { createHmac, timingSafeEqual } from "node:crypto";`;

/**
 * The verifier customers copy (notes/webhooks.md P1), as plain JavaScript so the tests can
 * run this exact text. It parses the `sha256=` scheme rather than comparing the header whole,
 * takes every signature a rotation sends, and checks the length before `timingSafeEqual`,
 * which throws on buffers of different sizes.
 */
export const VERIFY_BODY = `function verifyIdenzyWebhook(rawBody, headers, secret, now = Date.now()) {
  // Node's req.headers and a fetch Headers object both work.
  const read = (name) =>
    (typeof headers.get === "function" ? headers.get(name) : headers[name]) ?? "";

  // Refuse a stale delivery first, so a captured one cannot be replayed later.
  const timestamp = Number(read("${TIMESTAMP_HEADER.toLowerCase()}"));
  if (!Number.isInteger(timestamp) || Math.abs(now / 1000 - timestamp) > ${TIMESTAMP_TOLERANCE_SECONDS}) {
    return false;
  }

  // The raw body as it arrived: parsing and re-serialising the JSON signs a different string.
  const expected = createHmac("sha256", secret).update(timestamp + "." + rawBody).digest();

  // One signature per secret in force, so a rotation does not break verification.
  return String(read("${SIGNATURE_HEADER.toLowerCase()}"))
    .split(",")
    .some((part) => {
      const [scheme, hex] = part.trim().split("=");
      // 64 hex characters is 32 bytes, the length timingSafeEqual needs to compare.
      if (scheme !== "sha256" || !/^[0-9a-f]{64}$/.test(hex ?? "")) return false;
      return timingSafeEqual(Buffer.from(hex, "hex"), expected);
    });
}`;

export const VERIFY_SNIPPET = `${VERIFY_IMPORT}\n\nexport ${VERIFY_BODY}`;

/*
 * What happened when we called.
 */

export type DeliveryOutcome = "failed" | "pending" | "delivered";

/** In the note's order: what needs looking at first. */
export const OUTCOMES: readonly DeliveryOutcome[] = ["failed", "pending", "delivered"];

export const OUTCOME_LABELS: Record<DeliveryOutcome, string> = {
  failed: "Failed",
  pending: "Pending",
  delivered: "Delivered",
};

export const OUTCOME_TONES: Record<DeliveryOutcome, StateTone> = {
  failed: "error",
  pending: "warning",
  delivered: "success",
};

export interface DeliveryAttempt {
  /** One is the first call. */
  n: number;
  at: string;
  /** What the endpoint answered, or null where nothing did. */
  status: number | null;
  /** Why there is no status: "Timed out after 10s", "Connection refused". */
  error: string | null;
  durationMs: number;
  /** What the endpoint answered, as text. Shown as an excerpt, never whole. */
  response: string;
}

export interface WebhookDelivery {
  /** Stable across every attempt and every retry, and sent as `X-Idenzy-Delivery`. */
  id: string;
  endpointId: string;
  event: string;
  outcome: DeliveryOutcome;
  /** Oldest first. */
  attempts: DeliveryAttempt[];
  /** When the next attempt is, for a pending delivery. */
  nextRetryAt: string | null;
  /** The body as sent. Personal data is masked before it is shown. */
  payload: string;
  createdAt: string;
  /** Sent by Send test event rather than by something that happened. */
  test: boolean;
}

export function latestAttempt(delivery: WebhookDelivery): DeliveryAttempt | null {
  return delivery.attempts.at(-1) ?? null;
}

/**
 * Anything but a 2xx is a failure, timeouts included. A receiver that answers 302 or 404 has
 * not taken the delivery, and treating a redirect as success is how six months of events go
 * to a URL that moved.
 */
export function isSuccessStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/** A retry and a test are different acts, and each says so where it is offered (P2). */
export const RETRY_SEMANTICS =
  "Sends this delivery again with the same delivery ID, so a receiver that already took it recognises it and does nothing. It is not a new event and does not restart the schedule.";

export const TEST_SEMANTICS = `A new delivery of ${TEST_EVENT} with its own ID, sent once and never retried. It proves the URL answers and the signature verifies; it retries nothing.`;

/*
 * The period the attempts are read over.
 */

export type DeliveryPeriod = "24h" | "7d" | "30d";

/** Thirty days at most: a payload carries user data and is kept no longer than that. */
export const PERIOD_HOURS: Record<DeliveryPeriod, number> = { "24h": 24, "7d": 168, "30d": 720 };

/** One endpoint's deliveries made inside the period, newest first. */
export function deliveriesIn(
  deliveries: readonly WebhookDelivery[],
  endpointId: string,
  period: DeliveryPeriod,
  now: Date,
): WebhookDelivery[] {
  const since = now.getTime() - PERIOD_HOURS[period] * 3_600_000;
  return deliveries
    .filter((entry) => entry.endpointId === endpointId && Date.parse(entry.createdAt) >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function outcomeCounts(
  deliveries: readonly WebhookDelivery[],
): Record<DeliveryOutcome, number> {
  const counts: Record<DeliveryOutcome, number> = { failed: 0, pending: 0, delivered: 0 };
  for (const delivery of deliveries) counts[delivery.outcome] += 1;
  return counts;
}

/*
 * Retrying.
 */

/**
 * The backoff, in seconds, for each attempt after the first. Cloud Tasks will run it; this is
 * it written down so the screen can state it. A little over a day, so an endpoint down for an
 * afternoon loses nothing.
 */
export const RETRY_SCHEDULE: readonly number[] = [10, 60, 300, 1800, 7200, 21600, 86400];

/** Including the first call, which is not a retry. */
export const MAX_ATTEMPTS = RETRY_SCHEDULE.length + 1;

export function retryWindowSeconds(): number {
  return RETRY_SCHEDULE.reduce((total, delay) => total + delay, 0);
}

/** How long after attempt `n` the next one is, or null once there are none left. */
export function nextRetrySeconds(attempt: number): number | null {
  return RETRY_SCHEDULE[attempt - 1] ?? null;
}

/** Failed deliveries in a row before an endpoint is switched off. */
export const FAILURES_BEFORE_DISABLED = 20;

/*
 * How an endpoint is doing.
 */

export interface EndpointHealth {
  delivered: number;
  failed: number;
  /** Delivered over everything finished. Null where nothing has finished. */
  rate: number | null;
  last: { delivery: WebhookDelivery; attempt: DeliveryAttempt } | null;
}

/** A pending delivery is left out of the rate: it has not finished either way. */
export function healthOf(
  deliveries: readonly WebhookDelivery[],
  endpointId: string,
): EndpointHealth {
  const mine = deliveries.filter((entry) => entry.endpointId === endpointId);
  const delivered = mine.filter((entry) => entry.outcome === "delivered").length;
  const failed = mine.filter((entry) => entry.outcome === "failed").length;
  let last: EndpointHealth["last"] = null;
  for (const delivery of mine) {
    const attempt = latestAttempt(delivery);
    if (attempt && (last === null || attempt.at > last.attempt.at)) last = { delivery, attempt };
  }
  const finished = delivered + failed;
  return { delivered, failed, rate: finished === 0 ? null : delivered / finished, last };
}

/*
 * Observed delivery, the figures strip.
 */

/** How far back the figures strip counts. */
export const FIGURE_DAYS = 7;

export interface DeliveryFigure {
  id: "deliveries" | "delivered" | "failed" | "pending";
  label: string;
  /** Tells one tile's stand-in wave from the next one's. */
  seed: number;
  info: string;
  value: number;
  /** One count a day, oldest first. Empty where nothing was counted. */
  series: number[];
}

function figureOf(
  id: DeliveryFigure["id"],
  label: string,
  seed: number,
  info: string,
  series: number[],
): DeliveryFigure {
  const value = series.reduce((total, count) => total + count, 0);
  return { id, label, seed, info, value, series: value === 0 ? [] : series };
}

/**
 * A week of deliveries across every endpoint, by outcome, each counted once however many
 * times it was tried. With nothing delivered every figure is nought with no series, which a
 * `UsageTile` draws as No data rather than as a clean record.
 */
export function deliveryFigures(
  deliveries: readonly WebhookDelivery[],
  now: Date,
): DeliveryFigure[] {
  const day = 86_400_000;
  const first = Math.floor(now.getTime() / day) * day - (FIGURE_DAYS - 1) * day;
  const daily = (keep: (delivery: WebhookDelivery) => boolean) => {
    const counts = Array.from({ length: FIGURE_DAYS }, () => 0);
    for (const delivery of deliveries) {
      const index = Math.floor((Date.parse(delivery.createdAt) - first) / day);
      if (index >= 0 && index < FIGURE_DAYS && keep(delivery)) {
        counts[index] = (counts[index] ?? 0) + 1;
      }
    }
    return counts;
  };
  return [
    figureOf(
      "deliveries",
      "Deliveries",
      13,
      "Every delivery to this project's endpoints, counted once however many times it was tried.",
      daily(() => true),
    ),
    figureOf(
      "delivered",
      "Delivered",
      19,
      "Deliveries an endpoint answered with a 2xx, on the first try or a later one.",
      daily((delivery) => delivery.outcome === "delivered"),
    ),
    figureOf(
      "failed",
      "Failed",
      23,
      `Deliveries that used all ${MAX_ATTEMPTS} attempts without a 2xx.`,
      daily((delivery) => delivery.outcome === "failed"),
    ),
    figureOf(
      "pending",
      "Waiting to retry",
      29,
      "Deliveries between attempts, with the next try scheduled.",
      daily((delivery) => delivery.outcome === "pending"),
    ),
  ];
}

/** Under this and the row says so. Not a threshold anything enforces. */
export const HEALTHY_RATE = 0.95;

/** The health column's words and tone. Unknown is never drawn as healthy. */
export function healthWords(health: EndpointHealth): { label: string; tone: StateTone } {
  if (!WEBHOOK_DELIVERY.running) return { label: "Not measured", tone: "neutral" };
  if (health.rate === null) return { label: "No attempts yet", tone: "neutral" };
  const tone = health.rate >= HEALTHY_RATE ? "success" : health.rate >= 0.5 ? "warning" : "error";
  return { label: `${deliveryPercent(health.rate)} delivered`, tone };
}

/** A rate as a whole percentage: nobody acts on 98.6 rather than 99. */
export function deliveryPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/*
 * The evidence in an attempt's detail.
 */

/** How much of an answer is shown: enough to read an error page's title, never a whole body. */
export const RESPONSE_EXCERPT_CHARS = 512;

export function responseExcerpt(text: string): { text: string; truncated: boolean } {
  const truncated = text.length > RESPONSE_EXCERPT_CHARS;
  return { text: truncated ? text.slice(0, RESPONSE_EXCERPT_CHARS) : text, truncated };
}

const MASKED_KEYS = new Set(["email", "phone", "ip", "address"]);

function mask(key: string, value: string): string {
  if (key === "email" || value.includes("@")) {
    const [local = "", domain = ""] = value.split("@");
    return `${local.slice(0, 1)}•••@${domain}`;
  }
  if (key === "phone") return `•••• ${value.slice(-2)}`;
  return "••••";
}

function redact(node: unknown, key = ""): unknown {
  if (Array.isArray(node)) return node.map((entry) => redact(entry, key));
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([name, value]) => [
        name,
        redact(value, name),
      ]),
    );
  }
  return typeof node === "string" && MASKED_KEYS.has(key) ? mask(key, node) : node;
}

/**
 * The payload as the detail shows it: an address keeps its first character and its domain, a
 * phone its last two digits, an IP nothing. Enough to recognise a record, not to read one off
 * a screen somebody is sharing. Anything that is not JSON is shown as it came.
 */
export function redactPayload(json: string): string {
  try {
    return JSON.stringify(redact(JSON.parse(json)), null, 2);
  } catch {
    return json;
  }
}

/** The request as it left, headers first, with the signature cut short. */
export function requestHeaders(
  delivery: WebhookDelivery,
  attempt: DeliveryAttempt,
): { name: string; value: string }[] {
  return [
    { name: "Content-Type", value: "application/json" },
    { name: DELIVERY_HEADER, value: delivery.id },
    { name: TIMESTAMP_HEADER, value: String(Math.floor(Date.parse(attempt.at) / 1000)) },
    { name: SIGNATURE_HEADER, value: "sha256=…" },
    { name: "User-Agent", value: "Idenzy-Webhooks/1" },
  ];
}

/*
 * A sample of what arrives.
 */

/** A body of the shape a receiver gets, for the endpoint dialog and the reference. */
export function samplePayload(event: string, deliveryId: string, at: string): string {
  return JSON.stringify(
    {
      id: deliveryId,
      type: event,
      /* The instant the thing happened, not the instant we called: order is not guaranteed,
         so a receiver that needs one reads it off the payload. */
      occurred_at: at,
      data: { object: event.split(".")[0] ?? "object", id: "usr_2f9c41e0b7d84a63" },
    },
    null,
    2,
  );
}
