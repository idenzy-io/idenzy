import { TemplateType } from "@idenzy/protocol/enums/delivery";
import type { EmailTemplate } from "../template.js";

/**
 * The templates every project starts with (PROJECT.md 11.3).
 *
 * Authored as plain HTML rather than compiled from MJML at send time, on purpose. These
 * bodies are on the request path of every OTP and every reset, and MJML compilation is
 * CPU-bound work that belongs on the worker pool with its output cached by version
 * (PROJECT.md 9.6). Customer-authored MJML goes through that path; ours does not need
 * to, because ours never changes at runtime.
 *
 * The markup is deliberately dull: one table, inline styles, no images, no web fonts, no
 * external anything. That is what renders the same in Outlook, Gmail and a text client,
 * and what does not leak a read receipt to us.
 */

const STYLES = {
  body: "margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;",
  card: "max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;",
  heading: "margin:0 0 16px;font-size:20px;line-height:28px;font-weight:600;",
  text: "margin:0 0 16px;font-size:15px;line-height:24px;color:#3f3f46;",
  code: "margin:0 0 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;letter-spacing:6px;font-weight:600;color:#18181b;",
  button:
    "display:inline-block;padding:12px 24px;background:#18181b;color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:500;",
  footer: "margin:24px 0 0;font-size:13px;line-height:20px;color:#71717a;",
} as const;

const IGNORE_LINE = "If you did not request this, you can ignore this email. Nothing has changed.";

/**
 * One layout for every template, so a customer's brand kit later has one place to land.
 *
 * The footer is a parameter because the default is advice, not decoration, and it is
 * wrong on exactly one template: a mail reporting a password that has already changed
 * must not tell the reader that ignoring it is safe and nothing happened.
 */
function layout(heading: string, body: string, footer: string = IGNORE_LINE): string {
  return [
    `<div style="${STYLES.body}">`,
    `<div style="${STYLES.card}">`,
    `<h1 style="${STYLES.heading}">${heading}</h1>`,
    body,
    `<p style="${STYLES.footer}">${footer}</p>`,
    "</div>",
    "</div>",
  ].join("");
}

function paragraph(text: string): string {
  return `<p style="${STYLES.text}">${text}</p>`;
}

function button(label: string): string {
  return `<p style="${STYLES.text}"><a href="{{ link }}" style="${STYLES.button}">${label}</a></p>`;
}

const templates: readonly EmailTemplate[] = [
  {
    type: TemplateType.EmailOtp,
    locale: "en",
    subject: "{{ otp }} is your {{ project.name }} sign-in code",
    html: layout(
      "Your sign-in code",
      [
        paragraph("Enter this code to sign in to {{ project.name }}."),
        `<p style="${STYLES.code}">{{ otp }}</p>`,
        paragraph("It expires in {{ expires_in }} and can be used once."),
      ].join(""),
    ),
    text: [
      "Your sign-in code for {{ project.name }} is {{ otp }}.",
      "",
      "It expires in {{ expires_in }} and can be used once.",
      IGNORE_LINE,
    ].join("\n"),
  },
  {
    type: TemplateType.MagicLink,
    locale: "en",
    subject: "Sign in to {{ project.name }}",
    html: layout(
      "Sign in to {{ project.name }}",
      [
        paragraph("Use the button below to sign in as {{ user.email }}."),
        button("Sign in"),
        paragraph("The link expires in {{ expires_in }} and works once."),
      ].join(""),
    ),
    text: [
      "Sign in to {{ project.name }} as {{ user.email }}:",
      "{{ link }}",
      "",
      "The link expires in {{ expires_in }} and works once.",
      IGNORE_LINE,
    ].join("\n"),
  },
  {
    type: TemplateType.EmailVerification,
    locale: "en",
    subject: "Verify your email for {{ project.name }}",
    html: layout(
      "Verify your email",
      [
        paragraph("Confirm that {{ user.email }} belongs to you."),
        button("Verify email"),
        paragraph("The link expires in {{ expires_in }}."),
      ].join(""),
    ),
    text: [
      "Confirm that {{ user.email }} belongs to you:",
      "{{ link }}",
      "",
      "The link expires in {{ expires_in }}.",
      IGNORE_LINE,
    ].join("\n"),
  },
  {
    type: TemplateType.PasswordReset,
    locale: "en",
    subject: "Reset your {{ project.name }} password",
    html: layout(
      "Reset your password",
      [
        paragraph("Choose a new password for {{ user.email }}."),
        button("Reset password"),
        paragraph(
          "The link expires in {{ expires_in }} and works once. Your current password stays valid until you finish.",
        ),
      ].join(""),
    ),
    text: [
      "Choose a new password for {{ user.email }}:",
      "{{ link }}",
      "",
      "The link expires in {{ expires_in }} and works once.",
      "Your current password stays valid until you finish.",
      IGNORE_LINE,
    ].join("\n"),
  },
  {
    /**
     * The one template that is a warning rather than an invitation. It goes to the
     * address being moved away from, which is the address an attacker who has taken the
     * account no longer wants read (PROJECT.md 4.5).
     */
    type: TemplateType.EmailChangeOld,
    locale: "en",
    subject: "Confirm the email change on your {{ project.name }} account",
    html: layout(
      "Someone asked to change your email",
      [
        paragraph(
          "Your {{ project.name }} account is set to move from {{ user.email }} to {{ new_email }}. It will not change until you confirm here and the new address is confirmed too.",
        ),
        button("Confirm the change"),
        paragraph(
          "If this was not you, do not confirm. Change your password instead, and the request expires in {{ expires_in }}.",
        ),
      ].join(""),
      // Its own docstring calls this a warning rather than an invitation, and its text
      // body already leaves `IGNORE_LINE` out for that reason — but the HTML went through
      // the default footer, so the mail told the reader not to confirm and then told them
      // ignoring it was safe and nothing had changed, two sentences apart. Only `.text`
      // was ever asserted, which is why it survived.
      "If this was not you, do not confirm, and change your password.",
    ),
    text: [
      "Your {{ project.name }} account is set to move from {{ user.email }} to {{ new_email }}.",
      "It will not change until you confirm here and the new address is confirmed too:",
      "{{ link }}",
      "",
      "If this was not you, do not confirm. Change your password instead.",
      "The request expires in {{ expires_in }}.",
    ].join("\n"),
  },
  {
    type: TemplateType.EmailChangeNew,
    locale: "en",
    subject: "Confirm your new email for {{ project.name }}",
    html: layout(
      "Confirm your new address",
      [
        paragraph("Confirm that {{ user.email }} should become the address on your account."),
        button("Confirm address"),
        paragraph("The link expires in {{ expires_in }}."),
      ].join(""),
    ),
    text: [
      "Confirm that {{ user.email }} should become the address on your {{ project.name }} account:",
      "{{ link }}",
      "",
      "The link expires in {{ expires_in }}.",
      IGNORE_LINE,
    ].join("\n"),
  },
  {
    /**
     * The only built-in that reports rather than invites, and the reason the footer is a
     * parameter: "ignore this, nothing has changed" is the standing advice on every other
     * template and is the opposite of the truth here.
     *
     * It carries no clock and no link, and both absences are decisions. There is nothing
     * to expire, so `expires_in` must not appear — substitution fails closed and the
     * service supplies no such variable. And the only URI we hold for this project is the
     * one registered for `password_reset`, which is where a *token* lands: `withToken`
     * appends one, so sending it bare hands the customer's route a request it was never
     * told to expect. We render no page of our own to offer instead (ADR-0002), so the
     * mail names the product and stops there rather than pointing somewhere we cannot
     * vouch for. A `RedirectKind` the project registers for account security is the shape
     * that would earn a button here.
     */
    type: TemplateType.PasswordChanged,
    locale: "en",
    subject: "Your {{ project.name }} password was changed",
    html: layout(
      "Your password was changed",
      [
        paragraph(
          "The password on the {{ project.name }} account for {{ user.email }} has just been changed.",
        ),
        paragraph("If you made this change, there is nothing to do."),
      ].join(""),
      "If you did not do this, your account may be at risk: reset your password and contact {{ project.name }}.",
    ),
    text: [
      "The password on the {{ project.name }} account for {{ user.email }} has just been changed.",
      "",
      "If you made this change, there is nothing to do.",
      "",
      "If you did not do this, your account may be at risk: reset your password and contact {{ project.name }}.",
    ].join("\n"),
  },
];

/** Keyed by type, since every built-in is English until the wider locale set lands. */
export const englishTemplates: ReadonlyMap<TemplateType, EmailTemplate> = new Map(
  templates.map((template) => [template.type, template]),
);
