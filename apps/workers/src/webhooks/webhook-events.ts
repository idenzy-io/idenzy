import { WebhookEventType } from "@idenzy/protocol/schemas/webhooks";

/**
 * Which outbox topic becomes which webhook event.
 *
 * Two vocabularies, deliberately. A topic is an internal name a flow chose and may rename; an event
 * type is a public promise a customer's code branches on. Mapping them here means a flow can be
 * refactored without breaking somebody's receiver, and a new event type is a line in this file rather
 * than a rename somewhere in the auth API.
 *
 * The three `user.*` topics all become `user.updated`, because that is what happened from outside: a
 * profile field changed. Which of the three it was travels as `changed` on the payload, so a customer
 * who cares reads it there rather than subscribing to three near-identical events.
 *
 * The other half of this map is `WEBHOOK_EVENTS_WITHOUT_EMITTER`, which is in `@idenzy/protocol`
 * rather than here: it was here first, where only this worker could read it, and the panel went on
 * offering every event as though all of them sent something. `webhook-events.test.ts` asserts the two
 * cover the catalogue exactly.
 */
export const WEBHOOK_EVENT_BY_TOPIC: Readonly<Record<string, WebhookEventType>> = {
  "user.created": WebhookEventType.UserCreated,
  "session.created": WebhookEventType.SessionCreated,
  "session.revoked": WebhookEventType.SessionRevoked,
  "security.mfa_enrolled": WebhookEventType.MfaEnrolled,
  "security.mfa_removed": WebhookEventType.MfaRemoved,
  "security.refresh_token_reused": WebhookEventType.RefreshTokenReused,
  "user.email_verified": WebhookEventType.UserUpdated,
  "user.email_changed": WebhookEventType.UserUpdated,
  "user.password_changed": WebhookEventType.UserUpdated,
};

/** Every topic the relay reads, which is what its per-topic watermarks are keyed on. */
export const WEBHOOK_TOPICS: readonly string[] = Object.keys(WEBHOOK_EVENT_BY_TOPIC);
