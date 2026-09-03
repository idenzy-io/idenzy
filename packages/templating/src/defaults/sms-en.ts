import { TemplateType } from "@idenzy/protocol/enums/delivery";
import type { SmsTemplate } from "../template.js";

/**
 * The SMS copy every project starts with (PROJECT.md 11.4).
 *
 * Written to fit one GSM-7 segment with a project name of ordinary length, because the
 * second segment costs as much as the first and an OTP is the highest-volume message we
 * send. That is why there is no greeting, no sign-off and no link: every character is
 * paid for on every send, in every country, forever.
 *
 * ASCII only, and deliberately so. A curly apostrophe is outside GSM-7, and one of them
 * drops the whole message into UCS-2, where the limit is 70 characters rather than 160.
 * A test asserts the encoding, since the failure is silent and shows up as a bill.
 */
const templates: readonly SmsTemplate[] = [
  {
    type: TemplateType.SmsOtp,
    locale: "en",
    body: "{{ otp }} is your {{ project.name }} code. It expires in {{ expires_in }}. Do not share it.",
  },
];

/** Keyed by type, since every built-in is English until the wider locale set lands. */
export const englishSmsTemplates: ReadonlyMap<TemplateType, SmsTemplate> = new Map(
  templates.map((template) => [template.type, template]),
);
