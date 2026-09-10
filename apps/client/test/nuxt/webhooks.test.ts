import { describe, expect, it } from "vitest";
import {
  ALL_EVENTS,
  deliveryPercent,
  ENDPOINT_ISSUE_LABELS,
  EVENT_GROUPS,
  eventInfo,
  eventsIn,
  healthOf,
  healthTone,
  isStale,
  isSuccessStatus,
  MAX_ATTEMPTS,
  nextRetrySeconds,
  normaliseEndpointUrl,
  RETRY_SCHEDULE,
  retryWindowSeconds,
  samplePayload,
  signedPayload,
  subscriptionLabel,
  TIMESTAMP_TOLERANCE_SECONDS,
  validateEndpointUrl,
  WEBHOOK_EVENTS,
  type WebhookDelivery,
} from "../../app/utils/webhooks";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function delivery(part: Partial<WebhookDelivery> & Pick<WebhookDelivery, "id">): WebhookDelivery {
  return {
    endpointId: "whk_1",
    event: "user.created",
    outcome: "delivered",
    status: 200,
    error: null,
    attempt: 1,
    durationMs: 120,
    at: NOW.toISOString(),
    ...part,
  };
}

describe("the event catalogue", () => {
  it("names each event once and says what it means", () => {
    expect(new Set(WEBHOOK_EVENTS.map((event) => event.id)).size).toBe(WEBHOOK_EVENTS.length);
    for (const event of WEBHOOK_EVENTS) expect(event.note.length).toBeGreaterThan(0);
  });

  it("puts every event in a group the picker offers", () => {
    for (const event of WEBHOOK_EVENTS) expect(EVENT_GROUPS).toContain(event.group);
    const grouped = EVENT_GROUPS.flatMap((group) => eventsIn(group));
    expect(grouped).toHaveLength(WEBHOOK_EVENTS.length);
  });

  it("knows what it knows and nothing it does not", () => {
    expect(eventInfo("user.created")?.group).toBe("accounts");
    expect(eventInfo("nothing.at.all")).toBeNull();
  });

  it("tells an endpoint that took everything from one that took them all", () => {
    expect(subscriptionLabel(ALL_EVENTS, true)).toContain("including new ones");
    expect(subscriptionLabel(ALL_EVENTS, false)).toBe(`${ALL_EVENTS.length} events`);
    expect(subscriptionLabel(["user.created"], false)).toBe("1 event");
    expect(subscriptionLabel([], false)).toBe("No events");
  });
});

describe("naming an endpoint", () => {
  it("takes an https URL with a path and a query", () => {
    expect(validateEndpointUrl("https://api.acme.com/hooks/idenzy?v=1", [])).toBeNull();
  });

  it("refuses anything that is not a URL", () => {
    for (const value of ["", "api.acme.com/hooks", "not a url"]) {
      expect(validateEndpointUrl(value, [])).toBe("url_invalid");
    }
  });

  it("refuses http, where a signed payload is readable on the wire", () => {
    expect(validateEndpointUrl("http://api.acme.com/hooks", [])).toBe("url_insecure");
  });

  it("refuses an address nothing of ours could reach, before https is even checked", () => {
    expect(validateEndpointUrl("http://localhost:3000/hooks", [])).toBe("url_unreachable");
    expect(validateEndpointUrl("https://127.0.0.1/hooks", [])).toBe("url_unreachable");
  });

  it("refuses one the project already sends to, however it was typed", () => {
    expect(validateEndpointUrl("https://api.acme.com/hooks/", ["https://api.acme.com/hooks"])).toBe(
      "url_duplicate",
    );
  });

  it("stores the path and the query and drops the fragment", () => {
    expect(normaliseEndpointUrl("https://api.acme.com/hooks?v=1#x")).toBe(
      "https://api.acme.com/hooks?v=1",
    );
    expect(normaliseEndpointUrl("https://api.acme.com/hooks/")).toBe("https://api.acme.com/hooks");
  });

  it("has a sentence for every issue it can report", () => {
    for (const issue of [
      "url_invalid",
      "url_insecure",
      "url_unreachable",
      "url_duplicate",
      "events_empty",
    ] as const) {
      expect(ENDPOINT_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("signing", () => {
  it("covers the timestamp and the body together, so neither can be moved alone", () => {
    expect(signedPayload(1757443331, '{"a":1}')).toBe('1757443331.{"a":1}');
  });

  it("refuses a delivery whose clock is too far out, in either direction", () => {
    const at = Math.floor(NOW.getTime() / 1000);
    expect(isStale(at, NOW)).toBe(false);
    expect(isStale(at - TIMESTAMP_TOLERANCE_SECONDS + 10, NOW)).toBe(false);
    expect(isStale(at - TIMESTAMP_TOLERANCE_SECONDS - 10, NOW)).toBe(true);
    expect(isStale(at + TIMESTAMP_TOLERANCE_SECONDS + 10, NOW)).toBe(true);
  });

  it("carries the instant the thing happened, not the instant we called", () => {
    const body = JSON.parse(samplePayload("user.created", "dlv_1", NOW.toISOString()));
    expect(body.id).toBe("dlv_1");
    expect(body.type).toBe("user.created");
    expect(body.occurred_at).toBe(NOW.toISOString());
  });
});

describe("what counts as taken", () => {
  it("takes a 2xx and nothing else, a redirect included", () => {
    expect(isSuccessStatus(200)).toBe(true);
    expect(isSuccessStatus(204)).toBe(true);
    expect(isSuccessStatus(302)).toBe(false);
    expect(isSuccessStatus(404)).toBe(false);
    expect(isSuccessStatus(500)).toBe(false);
  });

  it("treats no answer at all as a failure", () => {
    expect(isSuccessStatus(null)).toBe(false);
  });
});

describe("retrying", () => {
  it("grows the gap and spans about a day", () => {
    for (let index = 1; index < RETRY_SCHEDULE.length; index += 1) {
      expect(RETRY_SCHEDULE[index] ?? 0).toBeGreaterThan(RETRY_SCHEDULE[index - 1] ?? 0);
    }
    expect(retryWindowSeconds()).toBeGreaterThan(24 * 3600);
  });

  it("counts the first call as an attempt and not as a retry", () => {
    expect(MAX_ATTEMPTS).toBe(RETRY_SCHEDULE.length + 1);
  });

  it("has no next try once the schedule is spent", () => {
    expect(nextRetrySeconds(1)).toBe(RETRY_SCHEDULE[0]);
    expect(nextRetrySeconds(MAX_ATTEMPTS)).toBeNull();
  });
});

describe("how an endpoint is doing", () => {
  const deliveries = [
    delivery({ id: "1" }),
    delivery({ id: "2" }),
    delivery({ id: "3", outcome: "failed", status: 500 }),
    delivery({ id: "4", endpointId: "whk_other" }),
    delivery({ id: "5", outcome: "pending", status: null, error: "Timed out" }),
  ];

  it("counts only its own endpoint's attempts", () => {
    const health = healthOf(deliveries, "whk_1");
    expect(health.delivered).toBe(2);
    expect(health.failed).toBe(1);
  });

  it("leaves a retry out of the rate, because it has not finished either way", () => {
    expect(healthOf(deliveries, "whk_1").rate).toBeCloseTo(2 / 3, 10);
  });

  it("reads full health off an endpoint nothing has been sent to yet", () => {
    const health = healthOf([], "whk_1");
    expect(health.rate).toBe(1);
    expect(health.last).toBeNull();
    expect(healthTone(health)).toBe("success");
  });

  it("finds the most recent attempt whatever order they arrived in", () => {
    const older = delivery({ id: "old", at: "2026-09-01T00:00:00.000Z" });
    const newer = delivery({ id: "new", at: "2026-09-08T00:00:00.000Z" });
    expect(healthOf([newer, older], "whk_1").last?.id).toBe("new");
    expect(healthOf([older, newer], "whk_1").last?.id).toBe("new");
  });

  it("moves from good to worth looking at to broken", () => {
    const at = (rate: number) => {
      const delivered = Math.round(rate * 100);
      return healthTone(
        healthOf(
          [
            ...Array.from({ length: delivered }, (_unused, index) => delivery({ id: `d${index}` })),
            ...Array.from({ length: 100 - delivered }, (_unused, index) =>
              delivery({ id: `f${index}`, outcome: "failed", status: 500 }),
            ),
          ],
          "whk_1",
        ),
      );
    };
    expect(at(0.99)).toBe("success");
    expect(at(0.8)).toBe("warning");
    expect(at(0.2)).toBe("error");
  });

  it("writes a rate as a whole percentage", () => {
    expect(deliveryPercent(1)).toBe("100%");
    expect(deliveryPercent(0.986)).toBe("99%");
    expect(deliveryPercent(0)).toBe("0%");
  });
});
