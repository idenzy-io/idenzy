import { describe, expect, it } from "vitest";
import {
  ALL_EVENTS,
  type DayStats,
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
  subscriptionLabel,
  TIMESTAMP_TOLERANCE_SECONDS,
  toggleEvent,
  toggleGroup,
  VERIFY_BODY,
  VERIFY_IMPORT,
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

const STAMP = Math.floor(NOW.getTime() / 1000);

/**
 * The sample a customer copies, which is now a call rather than a re-implementation.
 *
 * The old block executed the sample's own text against the signer's rules, because the sample *was*
 * an implementation — thirty lines of HMAC that the note found disagreeing with the header it
 * documented. It is now `verifyWebhook` from `@idenzy/node`, so the behaviour is tested where it
 * lives (`packages/sdk/server/node/test/webhooks.test.ts`) and against the real signer over a socket
 * in `apps/workers`. What is left to check here is that the sample teaches the four things a
 * receiver gets wrong on its own.
 */
describe("the verifier customers copy", () => {
  it("calls the SDK rather than re-implementing the digest", () => {
    expect(VERIFY_IMPORT).toBe('import { verifyWebhook } from "@idenzy/node/webhooks";');
    expect(VERIFY_SNIPPET.startsWith(VERIFY_IMPORT)).toBe(true);
    expect(VERIFY_BODY).toContain("verifyWebhook({");
    expect(VERIFY_BODY).not.toContain("createHmac");
  });

  it("insists on the raw body, because a re-serialised one signs a different string", () => {
    expect(VERIFY_BODY).toContain("rawBody");
    expect(VERIFY_BODY).toContain("Re-serialising parsed JSON");
  });

  it("passes both secrets, so a rotation does not break verification", () => {
    expect(VERIFY_BODY).toContain("secrets: [");
    expect(VERIFY_BODY.toLowerCase()).toContain("rotation");
  });

  it("answers 400 on a refusal and dedupes on the delivery id", () => {
    expect(VERIFY_BODY).toContain("status(400)");
    expect(VERIFY_BODY).toContain("delivery.deliveryId");
    expect(VERIFY_BODY.toLowerCase()).toContain("at least once");
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

describe("what the pipeline can and cannot do", () => {
  /* Delivery runs. What does not is asking for a test event and sending a delivery again, and each
     is its own flag so a control is off for its own reason rather than for delivery's. */
  it("says delivery runs and names the two controls that are not built", () => {
    expect(WEBHOOK_DELIVERY.running).toBe(true);
    expect(WEBHOOK_DELIVERY.testEvent).toBe(false);
    expect(WEBHOOK_DELIVERY.replay).toBe(false);
    expect(WEBHOOK_DELIVERY.reason.length).toBeGreaterThan(0);
  });

  it("calls an enabled endpoint on, with nothing to excuse", () => {
    expect(endpointState(endpoint())).toEqual({ label: "On", tone: "success", detail: "" });
  });

  it("has no health to report until something has been tried", () => {
    expect(healthWords(healthOf([], "whk_1")).label).toBe("No attempts yet");
  });

  /* The API answers a membership id, not a name, so the row says which of the two it was and keeps
     nobody's name in a second place. */
  it("says whether the reader paused it or somebody else did", () => {
    const mine = endpoint({
      enabled: false,
      disabled: { kind: "paused", at: NOW.toISOString(), byMemberId: "mem_1" },
    });
    expect(endpointState(mine, "mem_1")).toMatchObject({ label: "Paused", detail: "By you" });
    expect(endpointState(mine, "mem_2")).toMatchObject({ detail: "By a team member" });
    expect(endpointState(mine)).toMatchObject({ detail: "By a team member" });
  });

  it("says the breaker switched it off, and counts attempts rather than deliveries", () => {
    const failing = endpoint({
      enabled: false,
      disabled: { kind: "failing", at: NOW.toISOString(), byMemberId: null },
    });
    const state = endpointState(failing);
    expect(state).toMatchObject({ label: "Off", tone: "error" });
    expect(state.detail).toContain("failed attempts");
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

/**
 * The strip reads the counters rather than the deliveries on screen.
 *
 * It used to count the delivery list, which was honest only while that list was every delivery there
 * had ever been. It is now the latest fifty per endpoint, so counting it would report a busy week as
 * fifty — a figure that gets less true the more traffic a customer has (ADR-0012).
 */
describe("the figures strip", () => {
  function day(part: Partial<DayStats> & Pick<DayStats, "day">): DayStats {
    return { endpointId: "whk_1", delivered: 0, failed: 0, attempts: 0, ...part };
  }

  it("draws nothing rather than nought where nothing was counted", () => {
    for (const figure of deliveryFigures([], NOW)) {
      expect(figure.value).toBe(0);
      expect(figure.series).toEqual([]);
    }
  });

  it("adds up a week, and leaves anything older out of it", () => {
    const figures = deliveryFigures(
      [
        day({ day: "2026-09-09", delivered: 3, attempts: 4 }),
        day({ day: "2026-09-08", failed: 1, attempts: 8 }),
        day({ day: "2026-08-01", delivered: 99, attempts: 99 }),
      ],
      NOW,
    );
    const value = (id: string) => figures.find((figure) => figure.id === id)?.value;
    expect(value("deliveries")).toBe(4);
    expect(value("delivered")).toBe(3);
    expect(value("failed")).toBe(1);
    // Attempts exceed deliveries exactly when something was retried.
    expect(value("attempts")).toBe(12);
    expect(figures[0]?.series).toHaveLength(7);
  });

  it("adds several endpoints' counters into one day", () => {
    const figures = deliveryFigures(
      [
        day({ day: "2026-09-09", endpointId: "whk_1", delivered: 2, attempts: 2 }),
        day({ day: "2026-09-09", endpointId: "whk_2", delivered: 5, attempts: 6 }),
      ],
      NOW,
    );
    expect(figures.find((figure) => figure.id === "delivered")?.value).toBe(7);
  });
});
