import { PublicId } from "@idenzy/core/value-objects/public-id";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import {
  WEBHOOK_DATA_FIELDS,
  WebhookEventType,
  webhookDataSample,
} from "@idenzy/protocol/schemas/webhooks";
import { describe, expect, it } from "vitest";
import { projectWebhookData } from "../src/webhooks/webhook-data.js";
import { WEBHOOK_EVENT_BY_TOPIC } from "../src/webhooks/webhook-events.js";

/**
 * What a customer's endpoint is told, which is a decision and not a side effect.
 *
 * The payload the flows write is an internal message — the revocation reconciler parses raw uuids out
 * of the same rows — so the question this file settles is what crosses from one to the other. The
 * cases that matter are the ones where the two differ: an id published in the form the rest of the
 * product prints, and an internal field that is not published at all.
 */

const USER = "8f14e45f-ceea-167a-5a36-dedd4bea2543";
const SESSION = "1f0b1e6c-8a7d-4e2f-9b3c-5d8a7e6f4b21";

describe("projecting an event's data", () => {
  it("publishes an id in the form every other answer uses", () => {
    const data = projectWebhookData(WebhookEventType.UserCreated, {
      userId: USER,
      email: "ada@example.com",
      phone: null,
      emailVerified: false,
      phoneVerified: false,
      at: "2026-09-13T10:00:00.000Z",
    });

    expect(data["user"]).toBe(PublicId.encode(IdPrefix.User, USER).value);
    expect(data["email"]).toBe("ada@example.com");
    // The internal key is gone with the raw uuid: one name for one thing.
    expect(data["userId"]).toBeUndefined();
    // And no timestamp, because the envelope carries the instant the event happened.
    expect(data["at"]).toBeUndefined();
  });

  it("does not publish what a customer cannot use or should not have", () => {
    const data = projectWebhookData(WebhookEventType.RefreshTokenReused, {
      userId: USER,
      sessionId: SESSION,
      familyId: "3f2a0b1c-0000-4000-8000-000000000001",
      revokedTokens: 2,
      ip: "203.0.113.11",
      userAgent: "vitest",
      at: "2026-09-13T10:00:00.000Z",
      millisecondsSinceRotation: 412,
      likelyCause: "possible_theft",
    });

    expect(data).toEqual({
      user: PublicId.encode(IdPrefix.User, USER).value,
      session: PublicId.encode(IdPrefix.Session, SESSION).value,
      revokedTokens: 2,
      ip: "203.0.113.11",
      userAgent: "vitest",
    });
    // The family id has no public form and nothing a customer can do with it; `likelyCause` is our own
    // guess, and a guess published in a security event is one somebody builds a response on.
    expect(data["familyId"]).toBeUndefined();
    expect(data["likelyCause"]).toBeUndefined();
  });

  it("publishes a list of ids as a list", () => {
    const data = projectWebhookData(WebhookEventType.SessionRevoked, {
      userId: USER,
      sessionIds: [SESSION, "2f0b1e6c-8a7d-4e2f-9b3c-5d8a7e6f4b22"],
      scope: "all",
      at: "2026-09-13T10:00:00.000Z",
    });

    expect(data["sessions"]).toEqual([
      PublicId.encode(IdPrefix.Session, SESSION).value,
      PublicId.encode(IdPrefix.Session, "2f0b1e6c-8a7d-4e2f-9b3c-5d8a7e6f4b22").value,
    ]);
    expect(data["scope"]).toBe("all");
  });

  it("says which of three things a user.updated was", () => {
    // Three internal topics become one event, so without this a receiver cannot tell a verified
    // address from a changed password.
    for (const [topic, changed] of [
      ["user.email_verified", "email_verified"],
      ["user.email_changed", "email"],
      ["user.password_changed", "password"],
    ] as const) {
      expect(WEBHOOK_EVENT_BY_TOPIC[topic]).toBe(WebhookEventType.UserUpdated);
      const data = projectWebhookData(WebhookEventType.UserUpdated, { userId: USER, changed });
      expect(data["changed"]).toBe(changed);
    }
  });

  it("leaves out a field the emitter did not write, rather than sending a null", () => {
    const data = projectWebhookData(WebhookEventType.UserCreated, { userId: USER });
    expect(Object.keys(data)).toEqual(["user"]);
  });

  it("drops an id it cannot encode instead of failing the delivery", () => {
    // These rows outlive the code that wrote them. A payload whose shape we no longer recognise
    // should cost the field, not the event.
    const data = projectWebhookData(WebhookEventType.UserCreated, {
      userId: "not-a-uuid",
      email: "ada@example.com",
    });
    expect(data["user"]).toBeNull();
    expect(data["email"]).toBe("ada@example.com");
  });

  it("sends nothing at all for an event whose shape is not declared", () => {
    // An event nothing emits cannot arrive; if one ever does, the receiver gets an empty body rather
    // than our internal message.
    expect(projectWebhookData(WebhookEventType.UserDeleted, { userId: USER })).toEqual({});
  });
});

describe("the sample the panel documents", () => {
  it("is built from the same declaration the wire uses", () => {
    const sample = webhookDataSample(WebhookEventType.SessionCreated);
    const fields = WEBHOOK_DATA_FIELDS[WebhookEventType.SessionCreated] ?? [];
    expect(Object.keys(sample)).toEqual(fields.map((field) => field.as ?? field.from));
  });

  it("documents an id sample that is actually an id of that kind", () => {
    for (const fields of Object.values(WEBHOOK_DATA_FIELDS)) {
      for (const field of fields ?? []) {
        if (field.id === undefined) continue;
        const values = field.many === true ? (field.sample as string[]) : [field.sample as string];
        for (const value of values) {
          // Parsing is what proves it: a sample with the wrong prefix or the wrong length is one a
          // customer would write a validator against.
          expect(() => PublicId.parse(field.id ?? "", value)).not.toThrow();
        }
      }
    }
  });
});
