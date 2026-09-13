import { WEBHOOK_EVENT_TYPES, WebhookEventType } from "@idenzy/protocol/schemas/webhooks";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_EVENT_BY_TOPIC,
  WEBHOOK_EVENTS_WITHOUT_EMITTER,
  WEBHOOK_TOPICS,
} from "../src/webhooks/webhook-events.js";

/**
 * The catalogue against what actually emits, which is a statement the panel makes to customers.
 *
 * Two lists claim to describe the same thing between them — the topics that map to an event, and the
 * events nothing emits — and nothing kept them honest. `security.staff_access_granted` was in neither
 * when this file was written: an event a customer could subscribe to, that we had not noticed nothing
 * sends.
 */
describe("the event catalogue", () => {
  const emitted = new Set(Object.values(WEBHOOK_EVENT_BY_TOPIC));

  it("accounts for every event a customer can subscribe to", () => {
    const covered = new Set([...emitted, ...WEBHOOK_EVENTS_WITHOUT_EMITTER]);
    expect([...covered].sort()).toEqual([...WEBHOOK_EVENT_TYPES].sort());
  });

  it("does not list an event as unemitted while something emits it", () => {
    const both = WEBHOOK_EVENTS_WITHOUT_EMITTER.filter((event) => emitted.has(event));
    expect(both).toEqual([]);
  });

  it("maps every topic it lists, and lists every topic it maps", () => {
    expect([...WEBHOOK_TOPICS].sort()).toEqual(Object.keys(WEBHOOK_EVENT_BY_TOPIC).sort());
  });

  it("has an emitter for account creation, which is the one every customer wants", () => {
    // `UserRepository.create` writes it, so every path that makes a user emits it and a new path
    // cannot forget to.
    expect(WEBHOOK_EVENT_BY_TOPIC["user.created"]).toBe(WebhookEventType.UserCreated);
    expect(WEBHOOK_EVENTS_WITHOUT_EMITTER).not.toContain(WebhookEventType.UserCreated);
  });
});
