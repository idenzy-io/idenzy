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
 * profile field changed. What changed is on the payload, and a customer who cares which reads it
 * there rather than subscribing to three near-identical events.
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

/**
 * Catalogue entries nothing emits yet, listed so the gap is visible in code rather than discovered
 * by a customer who subscribed and heard nothing.
 *
 * Each one is waiting on the thing that would enqueue it: deletion needs the erasure path and
 * suspension a users screen that can ban somebody — neither state is written anywhere today, however
 * long `banned_until` and `deleted_at` have been in the schema — the three delivery events need the
 * SES and SMS event paths (todo.md 1.4), and staff access needs the break-glass flow itself. A
 * subscription to one of these saves and stays silent, which is why the panel's event list is not the
 * same statement as this map.
 *
 * `webhook-events.test.ts` asserts this list and the map above cover the catalogue exactly, because a
 * list of known gaps that is itself out of date is worse than no list: `security.staff_access_granted`
 * was missing from it until that test was written.
 */
export const WEBHOOK_EVENTS_WITHOUT_EMITTER: readonly WebhookEventType[] = [
  WebhookEventType.UserDeleted,
  WebhookEventType.UserSuspended,
  WebhookEventType.EmailBounced,
  WebhookEventType.EmailComplained,
  WebhookEventType.SmsBlocked,
  WebhookEventType.StaffAccessGranted,
];
