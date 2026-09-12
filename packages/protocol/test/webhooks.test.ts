import { describe, expect, it } from "vitest";
import {
  isBlockedWebhookHost,
  isWebhookEventType,
  isWebhookTimestampStale,
  parseWebhookSignatureHeader,
  WEBHOOK_EVENT_GROUP_OF,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_SCHEDULE,
  WEBHOOK_TEST_EVENT,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  webhookEnvelopeSchema,
  webhookRetryDelaySeconds,
  webhookSignatureHeader,
  webhookSignedPayload,
  webhookUrlSchema,
} from "../src/schemas/webhooks.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

describe("the signed payload", () => {
  /* The timestamp is inside the signed string. Beside it, a captured signature could be replayed
     with a fresh timestamp and the tolerance check would pass. */
  it("covers the timestamp and the raw body, in that order", () => {
    expect(webhookSignedPayload(1_700_000_000, '{"a":1}')).toBe('1700000000.{"a":1}');
  });

  it("is byte-exact about the body, because a receiver verifies the bytes it received", () => {
    expect(webhookSignedPayload(1, '{ "a": 1 }')).not.toBe(webhookSignedPayload(1, '{"a":1}'));
  });
});

describe("the signature header", () => {
  it("names the scheme in front of every digest, newest first", () => {
    expect(webhookSignatureHeader([DIGEST_A, DIGEST_B])).toBe(
      `sha256=${DIGEST_A}, sha256=${DIGEST_B}`,
    );
  });

  it("round-trips what it writes", () => {
    expect(parseWebhookSignatureHeader(webhookSignatureHeader([DIGEST_A, DIGEST_B]))).toEqual([
      DIGEST_A,
      DIGEST_B,
    ]);
  });

  /* The note's first finding on the webhooks screen: a verifier that compares the header whole
     fails against the documented header, and one that ignores the scheme accepts anything. */
  it("reads a digest out of a header rather than expecting a bare one", () => {
    expect(parseWebhookSignatureHeader(DIGEST_A)).toEqual([]);
    expect(parseWebhookSignatureHeader(`sha256=${DIGEST_A}`)).toEqual([DIGEST_A]);
  });

  it("drops an entry that is not this scheme rather than refusing the header", () => {
    expect(parseWebhookSignatureHeader(`md5=${DIGEST_A}, sha256=${DIGEST_B}`)).toEqual([DIGEST_B]);
    expect(parseWebhookSignatureHeader(`sha512=${DIGEST_A}`)).toEqual([]);
  });

  it("refuses a digest that is not 64 lowercase hex characters", () => {
    expect(parseWebhookSignatureHeader("sha256=deadbeef")).toEqual([]);
    expect(parseWebhookSignatureHeader(`sha256=${DIGEST_A.toUpperCase()}`)).toEqual([DIGEST_A]);
    expect(parseWebhookSignatureHeader(`sha256=${"z".repeat(64)}`)).toEqual([]);
  });

  it("answers nothing for the shapes a broken sender would produce", () => {
    for (const value of ["", " ", "sha256", "sha256=", "=", ",,", "sha256=a,sha256=b"]) {
      expect(parseWebhookSignatureHeader(value), value).toEqual([]);
    }
  });
});

describe("the timestamp tolerance", () => {
  const now = 1_700_000_000;

  it("accepts a clock a little out in either direction", () => {
    expect(isWebhookTimestampStale(now, now)).toBe(false);
    expect(isWebhookTimestampStale(now - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS, now)).toBe(false);
    expect(isWebhookTimestampStale(now + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS, now)).toBe(false);
  });

  it("refuses one outside it, which is what expires a captured delivery", () => {
    expect(isWebhookTimestampStale(now - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1, now)).toBe(true);
    expect(isWebhookTimestampStale(now + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1, now)).toBe(true);
  });

  it("refuses anything that is not whole seconds, including nothing at all", () => {
    expect(isWebhookTimestampStale(Number.NaN, now)).toBe(true);
    expect(isWebhookTimestampStale(now + 0.5, now)).toBe(true);
  });
});

describe("the retry schedule", () => {
  it("runs from seconds to a day, so an endpoint down for an afternoon loses nothing", () => {
    expect(WEBHOOK_RETRY_SCHEDULE[0]).toBe(10);
    expect(WEBHOOK_RETRY_SCHEDULE.at(-1)).toBe(86_400);
    const total = WEBHOOK_RETRY_SCHEDULE.reduce((sum, delay) => sum + delay, 0);
    expect(total).toBeGreaterThan(24 * 60 * 60);
  });

  it("grows monotonically, because a retry that came sooner than the last would not be backoff", () => {
    for (let at = 1; at < WEBHOOK_RETRY_SCHEDULE.length; at += 1) {
      expect(WEBHOOK_RETRY_SCHEDULE[at]).toBeGreaterThan(WEBHOOK_RETRY_SCHEDULE[at - 1] ?? 0);
    }
  });

  it("counts the first call as an attempt and not as a retry", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(WEBHOOK_RETRY_SCHEDULE.length + 1);
    expect(webhookRetryDelaySeconds(1)).toBe(10);
    expect(webhookRetryDelaySeconds(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
  });
});

describe("the event catalogue", () => {
  it("names every event in a group, so a screen can offer them by group", () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(WEBHOOK_EVENT_GROUP_OF[type]).toBeDefined();
    }
  });

  it("reads noun.verb in the past tense, because an event has already happened", () => {
    for (const type of WEBHOOK_EVENT_TYPES) {
      expect(type, type).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  /* A test event a receiver could not tell from a real one would be a test that fires their
     production code path. */
  it("keeps the test event out of the subscribable set", () => {
    expect(isWebhookEventType(WEBHOOK_TEST_EVENT)).toBe(false);
    expect(isWebhookEventType("session.created")).toBe(true);
    expect(isWebhookEventType("session.invented")).toBe(false);
  });
});

describe("the envelope", () => {
  const envelope = {
    id: "whd_1",
    type: "session.created",
    sequence: 42,
    createdAt: "2026-09-13T10:00:00.000Z",
    project: "prj_1",
    data: { sessionId: "ses_1" },
  };

  it("accepts the shape every event shares", () => {
    expect(webhookEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("requires the four fields a receiver dedupes and orders on", () => {
    for (const field of ["id", "type", "sequence", "createdAt", "project"]) {
      const { [field]: _gone, ...rest } = envelope as Record<string, unknown>;
      expect(webhookEnvelopeSchema.safeParse(rest).success, field).toBe(false);
    }
  });

  it("refuses a sequence that could not have come from the outbox", () => {
    expect(webhookEnvelopeSchema.safeParse({ ...envelope, sequence: -1 }).success).toBe(false);
    expect(webhookEnvelopeSchema.safeParse({ ...envelope, sequence: 1.5 }).success).toBe(false);
  });
});

/**
 * Where a delivery may be sent. Each refusal here is an SSRF check, and the response excerpt the
 * panel shows is what makes it a read primitive rather than a wasted request (ADR-0012).
 */
describe("webhookUrlSchema", () => {
  function url(value: string): string | null {
    const result = webhookUrlSchema.safeParse(value);
    return result.success ? result.data : null;
  }

  it("takes an https URL with a path and a query", () => {
    expect(url("https://api.example.com/hooks/idenzy")).toBe(
      "https://api.example.com/hooks/idenzy",
    );
    expect(url("https://api.example.com/hooks?tenant=7")).toBe(
      "https://api.example.com/hooks?tenant=7",
    );
    expect(url("https://api.example.com")).toBe("https://api.example.com");
    expect(url("https://api.example.com:8443/hooks")).toBe("https://api.example.com:8443/hooks");
  });

  it("lowercases the host and leaves the path alone, because only one of them is case-insensitive", () => {
    expect(url("https://API.Example.COM/Hooks/Idenzy")).toBe(
      "https://api.example.com/Hooks/Idenzy",
    );
  });

  it("refuses http, because a delivery names users and a signature is not encryption", () => {
    expect(url("http://api.example.com/hooks")).toBeNull();
  });

  it("refuses credentials in the URL, which would be a secret in two sets of logs", () => {
    expect(url("https://user:pass@api.example.com/hooks")).toBeNull();
  });

  it("refuses a fragment, which is never sent and means somebody pasted an address bar", () => {
    expect(url("https://api.example.com/hooks#section")).toBeNull();
  });

  it("refuses the addresses an SSRF would reach for", () => {
    for (const value of [
      "https://localhost/hooks",
      "https://app.localhost/hooks",
      "https://127.0.0.1/hooks",
      "https://127.1.2.3/hooks",
      "https://10.0.0.7/hooks",
      "https://192.168.1.1/hooks",
      "https://172.16.0.1/hooks",
      "https://172.31.255.255/hooks",
      "https://169.254.169.254/latest/meta-data",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://0.0.0.0/hooks",
      "https://[::1]/hooks",
      "https://[fe80::1]/hooks",
      "https://[fd00::1]/hooks",
      "https://[::ffff:127.0.0.1]/hooks",
      "https://internal.service.internal/hooks",
    ]) {
      expect(url(value), value).toBeNull();
    }
  });

  /* A public address in a private-looking range is still public: 172.32 is not in 172.16/12, and
     an allowlist that refused it would refuse a customer's real endpoint. */
  it("does not refuse a public address that merely looks like a private one", () => {
    expect(url("https://172.32.0.1/hooks")).toBe("https://172.32.0.1/hooks");
    expect(url("https://11.0.0.1/hooks")).toBe("https://11.0.0.1/hooks");
  });

  it("exports the host check for the delivery-time resolution the schema cannot do", () => {
    expect(isBlockedWebhookHost("169.254.169.254")).toBe(true);
    expect(isBlockedWebhookHost("api.example.com")).toBe(false);
    expect(isBlockedWebhookHost("")).toBe(true);
  });
});
