import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ALL_EVENTS,
  deliveriesIn,
  deliveryFigures,
  deliveryPercent,
  ENDPOINT_ISSUE_LABELS,
  EVENT_GROUP_NOTES,
  EVENT_GROUPS,
  endpointState,
  eventInfo,
  eventsIn,
  groupSelection,
  healthOf,
  healthWords,
  isStale,
  isSuccessStatus,
  MAX_ATTEMPTS,
  nextRetrySeconds,
  normaliseEndpointUrl,
  outcomeCounts,
  RETRY_SCHEDULE,
  redactPayload,
  responseExcerpt,
  retryWindowSeconds,
  signatureHeader,
  signedPayload,
  subscriptionLabel,
  TIMESTAMP_TOLERANCE_SECONDS,
  toggleEvent,
  toggleGroup,
  VERIFY_BODY,
  VERIFY_SNIPPET,
  validateEndpointUrl,
  WEBHOOK_DELIVERY,
  WEBHOOK_EVENTS,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "../../app/utils/webhooks";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function delivery(part: Partial<WebhookDelivery> & Pick<WebhookDelivery, "id">): WebhookDelivery {
  return {
    endpointId: "whk_1",
    event: "user.created",
    outcome: "delivered",
    attempts: [
      { n: 1, at: NOW.toISOString(), status: 200, error: null, durationMs: 120, response: "" },
    ],
    nextRetryAt: null,
    payload: "{}",
    createdAt: NOW.toISOString(),
    test: false,
    ...part,
  };
}

function endpoint(part: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: "whk_1",
    url: "https://api.acme.com/hooks",
    description: "",
    enabled: true,
    disabled: null,
    events: [],
    allEvents: true,
    createdAt: NOW.toISOString(),
    rolledAt: null,
    previousSecretUntil: null,
    ...part,
  };
}

describe("the event catalogue", () => {
  it("names each event once and says what it means", () => {
    expect(new Set(WEBHOOK_EVENTS.map((event) => event.id)).size).toBe(WEBHOOK_EVENTS.length);
    for (const event of WEBHOOK_EVENTS) expect(event.note.length).toBeGreaterThan(0);
  });

  it("puts every event in a group, and every group has a line of its own", () => {
    const grouped = EVENT_GROUPS.flatMap((group) => eventsIn(group));
    expect(grouped).toHaveLength(WEBHOOK_EVENTS.length);
    for (const group of EVENT_GROUPS) expect(EVENT_GROUP_NOTES[group].length).toBeGreaterThan(0);
    expect(eventInfo("nothing.at.all")).toBeNull();
  });

  it("tells an endpoint that took everything from one that ticked them all", () => {
    expect(subscriptionLabel(ALL_EVENTS, true)).toContain("including new ones");
    expect(subscriptionLabel(ALL_EVENTS, false)).toBe(`${ALL_EVENTS.length} events`);
    expect(subscriptionLabel(["user.created"], false)).toBe("1 event");
  });
});

describe("choosing events by group", () => {
  const sessions = eventsIn("sessions").map((event) => event.id);

  it("counts a group's chosen events and reads a partial group as some", () => {
    expect(groupSelection("sessions", []).state).toBe("none");
    expect(groupSelection("sessions", [sessions[0] ?? ""]).state).toBe("some");
    expect(groupSelection("sessions", sessions)).toEqual({
      chosen: sessions.length,
      total: sessions.length,
      state: "all",
    });
  });

  it("takes a whole group, then leaves it, without touching another group", () => {
    const taken = toggleGroup("sessions", ["user.created"]);
    expect(taken).toEqual(["user.created", ...sessions]);
    expect(toggleGroup("sessions", taken)).toEqual(["user.created"]);
  });

  it("toggles one event at a time", () => {
    expect(toggleEvent("user.created", [])).toEqual(["user.created"]);
    expect(toggleEvent("user.created", ["user.created"])).toEqual([]);
  });
});

describe("naming an endpoint", () => {
  it("takes an https URL with a path and a query", () => {
    expect(validateEndpointUrl("https://api.acme.com/hooks/idenzy?v=1", [])).toBeNull();
  });

  it("refuses what is not a URL, what is plain http and what we cannot reach", () => {
    expect(validateEndpointUrl("api.acme.com/hooks", [])).toBe("url_invalid");
    expect(validateEndpointUrl("http://api.acme.com/hooks", [])).toBe("url_insecure");
    expect(validateEndpointUrl("https://127.0.0.1/hooks", [])).toBe("url_unreachable");
  });

  it("refuses one the project already sends to, however it was typed", () => {
    expect(validateEndpointUrl("https://api.acme.com/hooks/", ["https://api.acme.com/hooks"])).toBe(
      "url_duplicate",
    );
    expect(normaliseEndpointUrl("https://api.acme.com/hooks?v=1#x")).toBe(
      "https://api.acme.com/hooks?v=1",
    );
    expect(ENDPOINT_ISSUE_LABELS.events_empty.length).toBeGreaterThan(0);
  });
});

/*
 * The documented verifier, run as the text customers copy.
 */

type Verify = (
  body: string,
  headers: Record<string, string> | Headers,
  secret: string,
  now?: number,
) => boolean;

/* The published sample is executed as written, to prove it verifies its own request. */
const verify = new Function(
  "createHmac",
  "timingSafeEqual",
  `${VERIFY_BODY}\nreturn verifyIdenzyWebhook;`,
)(createHmac, timingSafeEqual) as Verify;

const SECRET = "whsec_test_4f1c9e0b7a2d";
const OTHER = "whsec_test_previous_0000";
const BODY = '{"id":"dlv_1","type":"user.created"}';
const STAMP = Math.floor(NOW.getTime() / 1000);

function sign(secret: string, body = BODY, stamp = STAMP): string {
  return createHmac("sha256", secret).update(signedPayload(stamp, body)).digest("hex");
}

function request(signature: string, stamp = STAMP) {
  return { "x-idenzy-timestamp": String(stamp), "x-idenzy-signature": signature };
}

describe("the verifier customers copy", () => {
  it("accepts the documented request, signed the way the header says", () => {
    expect(verify(BODY, request(signatureHeader([sign(SECRET)])), SECRET, NOW.getTime())).toBe(
      true,
    );
  });

  it("accepts either signature during a rotation, and reads a fetch Headers object", () => {
    const both = signatureHeader([sign(SECRET), sign(OTHER)]);
    expect(verify(BODY, request(both), OTHER, NOW.getTime())).toBe(true);
    expect(verify(BODY, new Headers(request(both)), SECRET, NOW.getTime())).toBe(true);
  });

  it("refuses malformed signatures without throwing", () => {
    const hex = sign(SECRET);
    for (const header of [
      "",
      hex,
      `sha1=${hex}`,
      `sha256=${hex.slice(2)}`,
      "sha256=zz",
      "sha256=",
    ]) {
      expect(() => verify(BODY, request(header), SECRET, NOW.getTime())).not.toThrow();
      expect(verify(BODY, request(header), SECRET, NOW.getTime())).toBe(false);
    }
  });

  it("refuses a tampered body, a wrong secret and a stale or missing timestamp", () => {
    const header = signatureHeader([sign(SECRET)]);
    expect(verify(`${BODY} `, request(header), SECRET, NOW.getTime())).toBe(false);
    expect(verify(BODY, request(header), OTHER, NOW.getTime())).toBe(false);
    const late = NOW.getTime() + (TIMESTAMP_TOLERANCE_SECONDS + 10) * 1000;
    expect(verify(BODY, request(header), SECRET, late)).toBe(false);
    expect(verify(BODY, { "x-idenzy-signature": header }, SECRET, NOW.getTime())).toBe(false);
  });

  it("is published with its import and as an export", () => {
    expect(
      VERIFY_SNIPPET.startsWith('import { createHmac, timingSafeEqual } from "node:crypto";'),
    ).toBe(true);
    expect(VERIFY_SNIPPET).toContain("export function verifyIdenzyWebhook");
  });

  it("agrees with the staleness rule the screen states", () => {
    expect(isStale(STAMP - TIMESTAMP_TOLERANCE_SECONDS + 10, NOW)).toBe(false);
    expect(isStale(STAMP + TIMESTAMP_TOLERANCE_SECONDS + 10, NOW)).toBe(true);
  });
});

describe("what counts as taken, and when it is tried again", () => {
  it("takes a 2xx and nothing else, no answer included", () => {
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(302)).toBe(false);
    expect(isSuccessStatus(null)).toBe(false);
  });

  it("grows the gap, spans about a day and ends", () => {
    for (let index = 1; index < RETRY_SCHEDULE.length; index += 1) {
      expect(RETRY_SCHEDULE[index] ?? 0).toBeGreaterThan(RETRY_SCHEDULE[index - 1] ?? 0);
    }
    expect(retryWindowSeconds()).toBeGreaterThan(24 * 3600);
    expect(nextRetrySeconds(MAX_ATTEMPTS)).toBeNull();
  });
});

describe("while nothing delivers", () => {
  it("claims no delivery: health is not measured and an enabled endpoint says nothing is sent", () => {
    expect(WEBHOOK_DELIVERY.running).toBe(false);
    expect(healthWords(healthOf([], "whk_1")).label).toBe("Not measured");
    expect(endpointState(endpoint())).toEqual({
      label: "On",
      tone: "neutral",
      detail: "Saved, nothing sent",
    });
  });

  it("says why an endpoint is off and who paused it", () => {
    const paused = endpoint({
      enabled: false,
      disabled: { kind: "paused", at: NOW.toISOString(), by: "Mei Tanaka" },
    });
    expect(endpointState(paused)).toMatchObject({ label: "Paused", detail: "By Mei Tanaka" });
    const failing = endpoint({
      enabled: false,
      disabled: { kind: "failing", at: NOW.toISOString(), by: null },
    });
    expect(endpointState(failing)).toMatchObject({ label: "Off", tone: "error" });
  });
});

describe("an endpoint's deliveries", () => {
  const list = [
    delivery({ id: "1" }),
    delivery({ id: "2", outcome: "failed" }),
    delivery({ id: "3", outcome: "pending" }),
    delivery({ id: "4", endpointId: "whk_other" }),
    delivery({ id: "5", createdAt: "2026-09-01T00:00:00.000Z" }),
  ];

  it("reads one endpoint over the period, newest first", () => {
    expect(deliveriesIn(list, "whk_1", "24h", NOW).map((entry) => entry.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(deliveriesIn(list, "whk_1", "30d", NOW)).toHaveLength(4);
  });

  it("counts each outcome and leaves a pending one out of the rate", () => {
    expect(outcomeCounts(deliveriesIn(list, "whk_1", "24h", NOW))).toEqual({
      failed: 1,
      pending: 1,
      delivered: 1,
    });
    expect(healthOf(list, "whk_1").rate).toBeCloseTo(2 / 3, 10);
    expect(healthOf([], "whk_1").rate).toBeNull();
    expect(deliveryPercent(0.986)).toBe("99%");
  });
});

describe("the evidence in an attempt", () => {
  it("masks what identifies a person and leaves the rest", () => {
    const shown = JSON.parse(
      redactPayload(
        '{"type":"user.created","data":{"email":"ana@acme.com","phone":"+905551234567","ip":"10.0.0.1"}}',
      ),
    );
    expect(shown.type).toBe("user.created");
    expect(shown.data).toEqual({ email: "a•••@acme.com", phone: "•••• 67", ip: "••••" });
    expect(redactPayload("not json")).toBe("not json");
  });

  it("shows an excerpt of an answer, and says when it was cut", () => {
    expect(responseExcerpt("ok")).toEqual({ text: "ok", truncated: false });
    const long = responseExcerpt("x".repeat(2000));
    expect(long.truncated).toBe(true);
    expect(long.text).toHaveLength(512);
  });
});

describe("the figures strip", () => {
  it("draws nothing rather than nought while nothing is delivered", () => {
    for (const figure of deliveryFigures([], NOW)) {
      expect(figure.value).toBe(0);
      expect(figure.series).toEqual([]);
    }
  });

  it("counts a week of deliveries by outcome, each delivery once", () => {
    const figures = deliveryFigures(
      [
        delivery({ id: "1" }),
        delivery({ id: "2", outcome: "failed" }),
        delivery({ id: "3", createdAt: "2026-08-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    const value = (id: string) => figures.find((figure) => figure.id === id)?.value;
    expect(value("deliveries")).toBe(2);
    expect(value("delivered")).toBe(1);
    expect(value("failed")).toBe(1);
    expect(value("pending")).toBe(0);
    expect(figures[0]?.series).toHaveLength(7);
  });
});
