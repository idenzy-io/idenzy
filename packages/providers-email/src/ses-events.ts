import { z } from "zod";

/**
 * The message tag every send carries, and the only tenant key its delivery events ever have.
 *
 * SES echoes message tags back on every event it publishes, under `mail.tags`, where each
 * value is an array. Nothing else in a notification identifies the project: the shared
 * sender is one address for every project that has verified no domain of its own, and no
 * table maps a provider message id back to who sent it.
 *
 * The name is in SES's tag charset (`A-Za-z0-9_-`), which a uuid also satisfies. A tag
 * outside it is rejected by `SendEmail` itself, so the whole send fails rather than the
 * feedback quietly detaching.
 */
export const PROJECT_TAG = "idenzy_project";

/**
 * The five event types a configuration set publishes (PROJECT.md 11.2 item 4).
 *
 * `open` and `click` are deliberately absent. We do not ask SES for them — tracking whether
 * somebody opened a password reset is not ours to collect — so an event of that type
 * arriving means the configuration set is publishing more than it was asked to, which is
 * worth failing on rather than ignoring.
 */
export const SesEventType = {
  Send: "Send",
  Delivery: "Delivery",
  Bounce: "Bounce",
  Complaint: "Complaint",
  Reject: "Reject",
} as const;

export type SesEventType = (typeof SesEventType)[keyof typeof SesEventType];

/**
 * A bounce SES considers permanent is the only kind that suppresses.
 *
 * `Transient` is a full mailbox or a greylist and the address is still good; `Undetermined`
 * is SES saying it could not tell, and suppressing on it would block a deliverable address
 * on a guess. Both still count towards the bounce rate, because AWS counts them towards
 * ours.
 */
export const SesBounceType = {
  Permanent: "Permanent",
  Transient: "Transient",
  Undetermined: "Undetermined",
} as const;

export type SesBounceType = (typeof SesBounceType)[keyof typeof SesBounceType];

/**
 * What we read out of an SES event, and nothing more.
 *
 * Every field is either an identifier we need or an enumerated verdict. The recipient
 * address is kept only long enough to be hashed into a suppression row; the diagnostic
 * code, which usually repeats the address in prose, is never read at all.
 */
const sesEventSchema = z.object({
  eventType: z.enum([
    SesEventType.Send,
    SesEventType.Delivery,
    SesEventType.Bounce,
    SesEventType.Complaint,
    SesEventType.Reject,
  ]),
  mail: z.object({
    messageId: z.string().min(1),
    tags: z.record(z.string(), z.array(z.string())).optional(),
  }),
  bounce: z
    .object({
      bounceType: z.string().min(1),
      bounceSubType: z.string().min(1).optional(),
      bouncedRecipients: z.array(z.object({ emailAddress: z.string().min(1) })).default([]),
    })
    .optional(),
  complaint: z
    .object({
      complaintFeedbackType: z.string().min(1).optional(),
      complainedRecipients: z.array(z.object({ emailAddress: z.string().min(1) })).default([]),
    })
    .optional(),
});

export interface SesEvent {
  readonly type: SesEventType;
  readonly messageId: string;
  /** Null where the message was sent before sends carried a tag, or by something that is not us. */
  readonly projectId: string | null;
  readonly bounceType: string | null;
  readonly bounceSubType: string | null;
  /** The addresses this event is about. Empty for `Send` and `Delivery`, which suppress nothing. */
  readonly recipients: readonly string[];
}

/**
 * Turns the JSON string SNS carries in `Message` into the handful of fields we act on.
 *
 * A separate step from signature verification on purpose: the signature says the bytes came
 * from our topic, and this says they mean something. Getting the first without the second is
 * how a shape change upstream becomes an exception in a handler rather than a refusal at the
 * edge (PROJECT.md 7.1).
 */
export class SesEventParser {
  /** Throws `ZodError` on anything that is not one of the five events we asked for. */
  parse(message: string): SesEvent {
    const raw: unknown = JSON.parse(message);
    const event = sesEventSchema.parse(raw);
    const tagged = event.mail.tags?.[PROJECT_TAG]?.[0] ?? null;

    return {
      type: event.eventType,
      messageId: event.mail.messageId,
      projectId: tagged,
      bounceType: event.bounce?.bounceType ?? null,
      bounceSubType: event.bounce?.bounceSubType ?? null,
      recipients: [
        ...(event.bounce?.bouncedRecipients ?? []).map((one) => one.emailAddress),
        ...(event.complaint?.complainedRecipients ?? []).map((one) => one.emailAddress),
      ],
    };
  }
}

/**
 * Whether this event means the address must never be written to again.
 *
 * A complaint always does — somebody pressed "this is spam", and sending again is how a
 * shared domain's reputation goes. A bounce does only when SES calls it permanent.
 */
export function suppresses(event: SesEvent): boolean {
  if (event.type === SesEventType.Complaint) return true;
  return event.type === SesEventType.Bounce && event.bounceType === SesBounceType.Permanent;
}
