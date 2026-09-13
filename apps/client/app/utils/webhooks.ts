/**
 * Endpoints a project wants told about things, and what happened when we told them
 * (`webhooks`, `webhook_deliveries`, PROJECT.md 3.3, 9.4, notes/webhooks.md).
 *
 * Delivery runs now, which changes what this screen is for: it was a form that saved endpoints
 * nothing called, and it is a diagnostics screen. The relay fans events out to subscribed
 * endpoints, the dispatcher signs and sends them, failures come back on the published schedule,
 * and twenty failed attempts in a row switch an endpoint off with a reason (ADR-0012).
 *
 * Everything on it works now, test event and replay included. `WEBHOOK_DELIVERY` keeps a flag each
 * rather than being deleted: a control that is off has to be able to say why, and the next thing on
 * this screen to arrive before its backend — a delivery search, an endpoint-level pause schedule —
 * will want the same sentence in the same place.
 *
 * The contract itself is read from `@idenzy/protocol` rather than restated here. The header names,
 * the tolerance, the schedule and the attempt ceiling are the same constants the signer and the
 * SDK's verifier use, so this screen cannot document a version of our own product that is not the
 * one running.
 */

import {
  isWebhookTimestampStale,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_FAILURES_BEFORE_DISABLED,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE,
  WEBHOOK_ROTATION_OVERLAP_HOURS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  webhookRetryDelaySeconds,
  webhookSignatureHeader,
  webhookSignedPayload,
} from "@idenzy/protocol/schemas/webhooks";
/*
 * Whether anything is sent.
 */

export interface DeliveryCapability {
  /** Whether events reach endpoints at all. */
  running: boolean;
  /** Whether a delivery of the test event can be asked for. */
  testEvent: boolean;
  /** Whether an existing delivery can be sent again. */
  replay: boolean;
  /** What is unavailable and why, in the reader's words, for the strip that says so. */
  reason: string;
}

/**
 * What the pipeline can do, one flag per thing the screen offers.
 *
 * Delivery runs: the relay fans events out and the dispatcher signs and sends them (ADR-0012). A
 * test event and a replay are separate flags rather than part of `running`, because they need routes
 * that do not exist yet — and a control that pretends is worse than one that says why it is off.
 */
export const WEBHOOK_DELIVERY: DeliveryCapability = {
  running: true,
  testEvent: true,
  replay: true,
  reason: "",
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
  /**
   * The membership that paused it, or null where the breaker did.
   *
   * A member id and not a name, which is what the API answers: resolving one to a person belongs to
   * the members screen, and a name copied onto this row would be a second place somebody's name has
   * to be kept true. The row says "you" where it is the reader's own membership and "a team member"
   * otherwise, which is all this screen needs to say.
   */
  byMemberId: string | null;
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
export function endpointState(
  endpoint: WebhookEndpoint,
  viewerMemberId: string | null = null,
): {
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
    return {
      label: "Off",
      tone: "error",
      detail: `After ${FAILURES_BEFORE_DISABLED} failed attempts`,
    };
  }
  /* "By you" where it was the reader, and "a team member" otherwise. The API answers a membership
     id rather than a name, so the alternative would be putting somebody's id on a row or keeping a
     second copy of their name — and which of the two it was is what a reader actually wants. */
  const by = endpoint.disabled?.byMemberId ?? null;
  const detail = by === null ? "" : by === viewerMemberId ? "By you" : "By a team member";
  return { label: "Paused", tone: "neutral", detail };
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
 *
 * Read from `@idenzy/protocol`, which is where the signer and the SDK's verifier read it too. The
 * panel used to keep its own copy of the header names, the tolerance and the schedule; a screen
 * documenting a contract from a second copy of it is a screen that can be wrong about our own
 * product, which is the shape of the first finding on this page.
 */

export const SIGNATURE_HEADER = WEBHOOK_SIGNATURE_HEADER;
export const TIMESTAMP_HEADER = WEBHOOK_TIMESTAMP_HEADER;
export const DELIVERY_HEADER = WEBHOOK_DELIVERY_HEADER;
export const TIMESTAMP_TOLERANCE_SECONDS = WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
export const ROTATION_OVERLAP_HOURS = WEBHOOK_ROTATION_OVERLAP_HOURS;

export const signedPayload = webhookSignedPayload;
export const signatureHeader = webhookSignatureHeader;

/** Whether a delivery is too old to accept, which a receiver checks before the digest. */
export function isStale(timestamp: number, now: Date): boolean {
  return isWebhookTimestampStale(timestamp, now.getTime() / 1000);
}

/**
 * The verifier a customer copies, which is now a call rather than a re-implementation.
 *
 * This is the note's first finding answered properly (notes/webhooks.md P1). The old sample was
 * thirty lines of hand-written HMAC, and the finding was that it disagreed with the header it
 * documented; a corrected copy would have been a second implementation to keep in step with the
 * signer. `verifyWebhook` ships in `@idenzy/node`, is tested against the signer that produces these
 * deliveries, and refuses the cases a hand-rolled check gets wrong — a stale timestamp, a malformed
 * header, a body re-serialised from parsed JSON, and a length mismatch that makes `timingSafeEqual`
 * throw rather than answer.
 */
export const VERIFY_IMPORT = `import { verifyWebhook } from "@idenzy/node/webhooks";`;

export const VERIFY_BODY = `async function handleIdenzyWebhook(request, response) {
  // The body exactly as it arrived. Express: express.raw({ type: "application/json" }).
  // Re-serialising parsed JSON signs a different string and every delivery fails.
  const rawBody = await readRawBody(request);

  let delivery;
  try {
    delivery = verifyWebhook({
      rawBody,
      headers: request.headers,
      // Both while a rotation is open, so neither secret's deliveries fail.
      secrets: [process.env.IDENZY_WEBHOOK_SECRET],
    });
  } catch {
    // Not ours, or too old to accept. Answer 400 and do nothing.
    return response.status(400).end();
  }

  // At least once: the same delivery can arrive twice, so act on first sight of the id.
  if (await alreadyHandled(delivery.deliveryId)) return response.status(200).end();

  switch (delivery.envelope.type) {
    case "user.created":
      await onUserCreated(delivery.envelope.data);
      break;
    case "session.created":
      await onSignIn(delivery.envelope.data);
      break;
  }

  // Anything but a 2xx is retried on the schedule above, so answer before slow work.
  response.status(200).end();
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
export const RETRY_SCHEDULE = WEBHOOK_RETRY_SCHEDULE;

/** Including the first call, which is not a retry. */
export const MAX_ATTEMPTS = WEBHOOK_MAX_ATTEMPTS;

export function retryWindowSeconds(): number {
  return RETRY_SCHEDULE.reduce((total, delay) => total + delay, 0);
}

/** How long after attempt `n` the next one is, or null once there are none left. */
export const nextRetrySeconds = webhookRetryDelaySeconds;

/**
 * Failed attempts in a row before an endpoint is switched off.
 *
 * Attempts and not deliveries, which is what the dispatcher counts and a deliberate correction to
 * what this said before: a delivery only dies after every attempt on the schedule above, so twenty
 * dead deliveries would be weeks of calling an endpoint that has never answered. Any success clears
 * the run, so an endpoint that answers some of the time is never switched off.
 */
export const FAILURES_BEFORE_DISABLED = WEBHOOK_FAILURES_BEFORE_DISABLED;

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
  id: "deliveries" | "delivered" | "failed" | "attempts";
  label: string;
  /** Tells one tile's stand-in wave from the next one's. */
  seed: number;
  info: string;
  value: number;
  /** One count a day, oldest first. Empty where nothing was counted. */
  series: number[];
}

/** A day of one endpoint's counters, as the management API answers it. */
export interface DayStats {
  endpointId: string;
  day: string;
  delivered: number;
  failed: number;
  attempts: number;
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
 * A week across every endpoint, from the counters rather than from the deliveries on screen.
 *
 * This used to count the delivery list, which was honest only while that list was every delivery
 * there had ever been. It is now the latest fifty per endpoint, so counting it would have reported
 * a busy week as fifty deliveries — a figure that gets less true the more traffic a customer has.
 * The counters are a row per endpoint per day and exist for exactly this (ADR-0012).
 *
 * `Waiting to retry` is gone from the strip and `Attempts` has its place. A count of deliveries
 * between attempts is a live number rather than a day's total, and it is already on the table below
 * as the pending tab; attempts against deliveries is the ratio that says whether an endpoint is
 * answering first time.
 */
export function deliveryFigures(days: readonly DayStats[], now: Date): DeliveryFigure[] {
  const dayMs = 86_400_000;
  const first = Math.floor(now.getTime() / dayMs) * dayMs - (FIGURE_DAYS - 1) * dayMs;
  const daily = (count: (stats: DayStats) => number) => {
    const counts = Array.from({ length: FIGURE_DAYS }, () => 0);
    for (const stats of days) {
      const index = Math.floor((Date.parse(`${stats.day}T00:00:00.000Z`) - first) / dayMs);
      if (index >= 0 && index < FIGURE_DAYS) {
        counts[index] = (counts[index] ?? 0) + count(stats);
      }
    }
    return counts;
  };
  return [
    figureOf(
      "deliveries",
      "Deliveries",
      13,
      "Every delivery that finished, counted once however many times it was tried.",
      daily((stats) => stats.delivered + stats.failed),
    ),
    figureOf(
      "delivered",
      "Delivered",
      19,
      "Deliveries an endpoint answered with a 2xx, on the first try or a later one.",
      daily((stats) => stats.delivered),
    ),
    figureOf(
      "failed",
      "Failed",
      23,
      `Deliveries that used all ${WEBHOOK_MAX_ATTEMPTS} attempts without a 2xx.`,
      daily((stats) => stats.failed),
    ),
    figureOf(
      "attempts",
      "Attempts",
      29,
      "Calls made. More than deliveries means retries: a delivery answered on its third try is one delivery and three attempts.",
      daily((stats) => stats.attempts),
    ),
  ];
}

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
