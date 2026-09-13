import { PublicId } from "@idenzy/core/value-objects/public-id";
import {
  WEBHOOK_DATA_FIELDS,
  type WebhookDataField,
  type WebhookEventType,
} from "@idenzy/protocol/schemas/webhooks";

/**
 * Turns an internal outbox payload into the `data` a customer's endpoint receives.
 *
 * The projection happens here, at fan-out, and not at send time — the delivery row holds what was
 * projected, so every attempt signs the same bytes and a retry a day later is identical to the first
 * try (ADR-0012). It is also why this is pure: what a customer sees must not depend on when we
 * managed to send it.
 *
 * The declaration lives in `@idenzy/protocol` so the panel documents the same shape it sends, and the
 * encoding lives here because `PublicId` is in `@idenzy/core`, which protocol may not import. Two
 * halves of one statement, in the two places that can hold them.
 *
 * An event with no declared fields projects to an empty object rather than passing the payload
 * through. That is the safe direction: an event nothing emits cannot arrive, and if one ever does
 * before its fields are declared, the receiver gets a body with nothing in it instead of our internal
 * message.
 */
export function projectWebhookData(
  type: WebhookEventType,
  payload: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of WEBHOOK_DATA_FIELDS[type] ?? []) {
    const raw = payload[field.from];
    // Absent rather than null: a field the emitter did not write is one this event does not have, and
    // a null would claim it has it and that it is empty.
    if (raw === undefined) continue;
    data[field.as ?? field.from] = published(field, raw);
  }
  return data;
}

/** An id in the form the rest of the product prints it, and everything else as it was. */
function published(field: WebhookDataField, raw: unknown): unknown {
  const prefix = field.id;
  if (prefix === undefined) return raw;
  if (field.many === true) {
    return Array.isArray(raw) ? raw.flatMap((one) => encoded(prefix, one)) : [];
  }
  const [only] = encoded(prefix, raw);
  return only ?? null;
}

/**
 * One uuid encoded, or nothing.
 *
 * A value that is not a uuid is dropped rather than sent raw or thrown over: these rows outlive the
 * code that wrote them, so a payload from an older version with a shape we no longer recognise should
 * cost that field and not the delivery.
 */
function encoded(prefix: string, raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    return [PublicId.encode(prefix, raw).value];
  } catch {
    return [];
  }
}
