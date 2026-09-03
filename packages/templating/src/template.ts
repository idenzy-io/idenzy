import type { TemplateType } from "@idenzy/protocol/enums/delivery";

/**
 * A transactional template as authored (PROJECT.md 11.3).
 *
 * Both bodies are stored rather than one generated from the other at send time: the
 * plain-text part of a transactional mail is what spam filters and screen readers see,
 * and a mechanical strip of the HTML reads badly enough to be worth writing by hand.
 */
export interface EmailTemplate {
  readonly type: TemplateType;
  readonly locale: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * An SMS template as authored (PROJECT.md 11.4).
 *
 * One field, because an SMS has one. No subject, no alternative part, and no place to
 * put a link that a carrier will not rewrite: the copy is the message.
 */
export interface SmsTemplate {
  readonly type: TemplateType;
  readonly locale: string;
  readonly body: string;
}

/** A leaf a template may substitute. Anything else is a structural error, not a value. */
export type TemplateValue = string | number;

export interface TemplateVariables {
  readonly [key: string]: TemplateValue | TemplateVariables;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Which locale actually supplied the copy, after the fallback chain resolved. */
  readonly locale: string;
}
