/**
 * Endpoints a project wants told about things, and what happened when we told them
 * (`webhooks`, `webhook_deliveries`, PROJECT.md 3.3, 9.4).
 *
 * Four properties of the delivery path decide most of what this screen has to say, and
 * all four are properties a customer's own code has to be written against.
 *
 * The secret is stored as a digest. `webhooks.secret_hash` is a hash, so nobody can read
 * a signing secret back, including us: it is shown once when the endpoint is made and
 * once more when it is rolled, and after that the only way to have it is to have kept it.
 *
 * Delivery is at least once. An event goes through the outbox to Pub/Sub, which is
 * at-least-once by construction, so a receiver will see the same delivery twice sooner or
 * later and has to be idempotent on the delivery id. That is not a caveat in a doc, it is
 * the first thing a page about webhooks owes the reader.
 *
 * Order is not guaranteed either, for the same reason, which is why the payload carries
 * the instant the thing happened rather than leaving a receiver to infer it from arrival.
 *
 * An event is written to the outbox in the same transaction as the change it describes,
 * so a rolled-back write never produces a webhook. That is the one guarantee here that is
 * stronger than the transport's, and it is worth saying out loud: a receiver never has to
 * defend against being told about something that did not happen.
 */

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
    note: "The receiving server refused an address for good. It is on the suppression list from that moment and nothing sends to it again.",
  },
  {
    id: "email.complained",
    group: "delivery",
    note: "The recipient pressed the spam button and their provider told us. Weighted far more heavily than a bounce by every mailbox provider.",
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
    note: "One of ours was granted time-boxed access to your project. You are told because you should be able to see us look at your tenant.",
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

const EVENT_BY_ID = new Map(WEBHOOK_EVENTS.map((event) => [event.id, event]));

export function eventInfo(id: string): WebhookEvent | null {
  return EVENT_BY_ID.get(id) ?? null;
}

export function eventsIn(group: EventGroup): WebhookEvent[] {
  return WEBHOOK_EVENTS.filter((event) => event.group === group);
}

/** Every event there is, for the endpoint that wants all of them and any added later. */
export const ALL_EVENTS: readonly string[] = WEBHOOK_EVENTS.map((event) => event.id);

/**
 * How an endpoint's selection is written on the row: the count, or that it takes
 * everything. The difference matters, because an endpoint subscribed to every event today
 * is not the same as one that asked for all of them and will receive the next one we add.
 */
export function subscriptionLabel(events: readonly string[], all: boolean): string {
  if (all) return "Every event, including new ones";
  if (events.length === 0) return "No events";
  return `${events.length} ${events.length === 1 ? "event" : "events"}`;
}

/*
 * An endpoint.
 */

export interface WebhookEndpoint {
  id: string;
  url: string;
  /** What it is for, in the customer's words. Theirs to write and ours to show. */
  description: string;
  enabled: boolean;
  /** Chosen events. Ignored while `allEvents` is set. */
  events: string[];
  /** Everything, including events that do not exist yet. */
  allEvents: boolean;
  createdAt: string;
  /** When the signing secret was last replaced. Null means it is the original. */
  rolledAt: string | null;
  /**
   * A previous secret still accepted while a customer deploys the new one. Null once the
   * overlap has passed, which is the state an endpoint spends its life in.
   */
  previousSecretUntil: string | null;
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
 * How far out of step a timestamp may be before a receiver should refuse the delivery.
 * Five minutes: enough for a clock nobody has synchronised, short enough that a captured
 * request is not a credential a week later. Refusing on it is what makes the signature
 * replay-safe rather than merely authentic.
 */
export const TIMESTAMP_TOLERANCE_SECONDS = 300;

/**
 * Exactly what the signature covers: the timestamp, a dot, then the raw body.
 *
 * The timestamp is inside the signed string rather than beside it, or an attacker could
 * keep a valid signature and move the timestamp forward. The body has to be the bytes as
 * they arrived: a receiver that parses the JSON and re-serialises it is signing a
 * different string and will never match.
 */
export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`;
}

/** Whether a delivery is too old to accept, which a receiver checks before the digest. */
export function isStale(timestamp: number, now: Date): boolean {
  return Math.abs(now.getTime() / 1000 - timestamp) > TIMESTAMP_TOLERANCE_SECONDS;
}

/*
 * What happened when we called.
 */

export type DeliveryOutcome = "delivered" | "failed" | "pending";

export const OUTCOME_LABELS: Record<DeliveryOutcome, string> = {
  delivered: "Delivered",
  failed: "Failed",
  pending: "Retrying",
};

export const OUTCOME_TONES: Record<DeliveryOutcome, "success" | "error" | "warning"> = {
  delivered: "success",
  failed: "error",
  pending: "warning",
};

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  outcome: DeliveryOutcome;
  /** What the endpoint answered, or null where nothing did: a timeout or a refused connection. */
  status: number | null;
  /** Why there was no status, for the row that has none: "Timed out", "Connection refused". */
  error: string | null;
  /** Which try this was. One is the first. */
  attempt: number;
  /** How long the call took, in milliseconds. */
  durationMs: number;
  at: string;
}

/**
 * Anything but a 2xx is a failure, timeouts included.
 *
 * A receiver that answers 302 or 404 has not taken the delivery, whatever it meant by it,
 * and treating a redirect as success is how a customer discovers six months of events
 * went to a URL that moved.
 */
export function isSuccessStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/*
 * Retrying.
 */

/**
 * The backoff, in seconds, for each attempt after the first. Cloud Tasks runs the
 * schedule; this is it written down so the screen can state it rather than describe it.
 *
 * It spans a little over a day on purpose: a receiver that is down for an afternoon
 * should lose nothing, and one that is down for two days is not coming back before
 * somebody looks at it.
 */
export const RETRY_SCHEDULE: readonly number[] = [10, 60, 300, 1800, 7200, 21600, 86400];

/** Including the first call, which is not a retry. */
export const MAX_ATTEMPTS = RETRY_SCHEDULE.length + 1;

/** How long we keep trying, end to end. */
export function retryWindowSeconds(): number {
  return RETRY_SCHEDULE.reduce((total, delay) => total + delay, 0);
}

/** When the next try is, or null once there are none left. */
export function nextRetrySeconds(attempt: number): number | null {
  return RETRY_SCHEDULE[attempt - 1] ?? null;
}

/**
 * Failed deliveries in a row before an endpoint is switched off.
 *
 * Off rather than left retrying, because an endpoint that has refused everything for a
 * day is a URL nobody is listening on, and the alternative is a queue that grows until
 * somebody notices. Switching it back on is one click, and the events missed in between
 * are gone: a webhook is a notification and never a log.
 */
export const FAILURES_BEFORE_DISABLED = 20;

/*
 * How an endpoint is doing.
 */

export interface EndpointHealth {
  delivered: number;
  failed: number;
  /** Delivered as a share of everything attempted, 0 to 1. One when nothing was tried. */
  rate: number;
  /** The most recent attempt, whatever it did. Null where there has been none. */
  last: WebhookDelivery | null;
}

export function healthOf(
  deliveries: readonly WebhookDelivery[],
  endpointId: string,
): EndpointHealth {
  const mine = deliveries.filter((delivery) => delivery.endpointId === endpointId);
  const delivered = mine.filter((delivery) => delivery.outcome === "delivered").length;
  const failed = mine.filter((delivery) => delivery.outcome === "failed").length;
  const judged = delivered + failed;
  const last = mine.reduce<WebhookDelivery | null>(
    (newest, delivery) =>
      newest === null || new Date(delivery.at) > new Date(newest.at) ? delivery : newest,
    null,
  );
  return { delivered, failed, rate: judged === 0 ? 1 : delivered / judged, last };
}

/** Under this and the endpoint's row says so. Not a threshold anything enforces. */
export const HEALTHY_RATE = 0.95;

export function healthTone(health: EndpointHealth): "success" | "warning" | "error" {
  if (health.delivered + health.failed === 0) return "success";
  if (health.rate >= HEALTHY_RATE) return "success";
  return health.rate >= 0.5 ? "warning" : "error";
}

/**
 * A rate as a percentage, with no decimals: nobody acts on 98.6 rather than 99. The
 * sending-domains screen has its own, which writes three decimals because a complaint
 * rate lives at a twentieth of a percent. A delivery rate never does.
 */
export function deliveryPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/*
 * A sample of what arrives.
 */

/** A body of the shape a receiver actually gets, for the panel to show beside the headers. */
export function samplePayload(event: string, deliveryId: string, at: string): string {
  return JSON.stringify(
    {
      id: deliveryId,
      type: event,
      /* The instant the thing happened, not the instant we called: order is not
         guaranteed, so a receiver that needs one reads it off the payload. */
      occurred_at: at,
      data: { object: event.split(".")[0] ?? "object", id: "usr_2f9c41e0b7d84a63" },
    },
    null,
    2,
  );
}
