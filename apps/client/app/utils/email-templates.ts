/**
 * The transactional mail a project sends, and the rules a template is held to
 * (PROJECT.md 11.3, `packages/templating`).
 *
 * Everything here mirrors `@idenzy/templating` rather than importing it: that package
 * carries `@idenzy/core`'s error classes and reaches for persistence through its store,
 * and a panel bundle must not pull the server stack in to render a preview. What is
 * mirrored is the part a screen has to agree with exactly, and a test asserts the two
 * halves cannot drift: the placeholder grammar, the variables each type has in scope, and
 * the built-in copy itself, verbatim, so the preview is the message rather than a
 * description of one.
 *
 * The one thing to understand before changing anything here is that binding fails closed.
 * A body referencing a variable that is not in scope does not render empty, it throws, and
 * the mail is not sent. So a template typo is found by a user who cannot sign in rather
 * than by us, which is why this screen checks the same list the renderer resolves against
 * and refuses the save the server would refuse.
 */

import { humanizeSeconds, SAMPLE_CODE } from "./otp";

/**
 * The email half of `TemplateType`. `sms_otp` is in the same enum on the server and is
 * not here: it has one field, no subject and a segment budget, and the SMS screen owns it.
 */
export type EmailTemplateType =
  | "email_otp"
  | "magic_link"
  | "email_verification"
  | "password_reset"
  | "email_change_old"
  | "email_change_new"
  | "invite"
  | "new_device_signin"
  | "mfa_enrolled"
  | "password_changed";

/**
 * A variable a body may substitute. `project.name`, `user.email` and `expires_in` are
 * filled in by the mailer for every send; the rest are the flow's and differ by type.
 */
export type TemplateVariable =
  | "project.name"
  | "user.email"
  | "expires_in"
  | "otp"
  | "link"
  | "new_email";

/** Supplied on every send, whatever the type, because the mailer adds them itself. */
export const ALWAYS_IN_SCOPE: readonly TemplateVariable[] = [
  "project.name",
  "user.email",
  "expires_in",
];

export interface TemplateCatalogueEntry {
  type: EmailTemplateType;
  label: string;
  /** What causes it to be sent, in one phrase for a table cell. */
  trigger: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /**
   * False for a type the protocol names and nothing sends yet. A project may still write
   * copy for one; it will sit unused until the flow behind it exists.
   */
  live: boolean;
  /** What the flow passes beyond the three every send carries. */
  variables: readonly TemplateVariable[];
  /**
   * The variable the message exists to carry. A body without it is a mail that arrives
   * saying nothing, which is worth refusing rather than sending.
   */
  payload: TemplateVariable | null;
  note: string;
}

export const TEMPLATE_CATALOGUE: readonly TemplateCatalogueEntry[] = [
  {
    type: "email_otp",
    label: "Sign-in code",
    trigger: "A one-time code was asked for",
    icon: "material-symbols:dialpad",
    live: true,
    variables: ["otp"],
    payload: "otp",
    note: "The highest-volume mail we send, and the one flow we document first because it needs no redirect and no deep link. The code is a value, so it is escaped like any other and cannot carry markup.",
  },
  {
    type: "magic_link",
    label: "Magic link",
    trigger: "A sign-in link was asked for",
    icon: "material-symbols:link",
    live: true,
    variables: ["link"],
    payload: "link",
    note: "The link is signed and pinned to a registered redirect target before it reaches the template, so a body cannot turn it into an open redirect. It is single use and dies with the challenge behind it.",
  },
  {
    type: "email_verification",
    label: "Verify address",
    trigger: "An address needs confirming",
    icon: "material-symbols:mark-email-read-outline",
    live: true,
    variables: ["link"],
    payload: "link",
    note: "Often opened on a different device from the one that asked, which is why the link behind it lives a day rather than ten minutes.",
  },
  {
    type: "password_reset",
    label: "Password reset",
    trigger: "A reset was asked for",
    icon: "material-symbols:lock-reset",
    live: true,
    variables: ["link"],
    payload: "link",
    note: "Single use, and issuing one invalidates every other reset token on the account. The current password stays valid until the reset finishes, which the built-in copy says so nobody is locked out mid-way.",
  },
  {
    type: "email_change_old",
    label: "Address change, old address",
    trigger: "An account asked to move address",
    icon: "material-symbols:outgoing-mail",
    live: true,
    variables: ["link", "new_email"],
    payload: "link",
    note: "The one template that is a warning rather than an invitation. It goes to the address being moved away from, which is the address an attacker who has taken the account no longer wants read, so the copy tells the reader not to confirm and to change their password instead.",
  },
  {
    type: "email_change_new",
    label: "Address change, new address",
    trigger: "An account asked to move address",
    icon: "material-symbols:alternate-email",
    live: true,
    variables: ["link"],
    payload: "link",
    note: "The other half. The address does not move until both this one and the old one are confirmed, so a body that reads as though confirming here finishes the job is wrong.",
  },
  {
    type: "invite",
    label: "Invitation",
    trigger: "Nothing sends this yet",
    icon: "material-symbols:person-add-outline",
    live: false,
    variables: ["link"],
    payload: "link",
    note: "Named in the protocol and part of the organisations work, which is phase 4. Copy written now is stored and never sent until the flow behind it exists.",
  },
  {
    type: "new_device_signin",
    label: "New device signed in",
    trigger: "Nothing sends this yet",
    icon: "material-symbols:devices",
    live: false,
    variables: [],
    payload: null,
    note: "The signals are recorded on the session today and nothing acts on them. When they do, this is the notification, and it carries no link because there is nothing for the reader to confirm.",
  },
  {
    type: "mfa_enrolled",
    label: "Second factor added",
    trigger: "Nothing sends this yet",
    icon: "material-symbols:shield-lock-outline",
    live: false,
    variables: [],
    payload: null,
    note: "A notice rather than an action: somebody added a factor, and the reader should know even though they cannot undo it from a mail.",
  },
  {
    type: "password_changed",
    label: "Password changed",
    trigger: "Nothing sends this yet",
    icon: "material-symbols:password",
    live: false,
    variables: [],
    payload: null,
    note: "The same shape. A password change already ends every session the account holds; this is the part that tells the owner it happened.",
  },
];

export function catalogueEntry(type: EmailTemplateType): TemplateCatalogueEntry | undefined {
  return TEMPLATE_CATALOGUE.find((entry) => entry.type === type);
}

/** Everything a body of this type may reference. Anything else fails the send. */
export function variablesInScope(type: EmailTemplateType): readonly TemplateVariable[] {
  return [...ALWAYS_IN_SCOPE, ...(catalogueEntry(type)?.variables ?? [])];
}

/**
 * What each variable holds, in one line for a completion list and one for the panel
 * beside it.
 *
 * Written once here rather than beside each control, because the same sentence is read in
 * three places: the editor's completion popup, the scope list on the workspace, and the
 * insert menu. Three copies of it drift, and the one a customer reads while typing is the
 * one that matters most.
 */
export const VARIABLE_HELP: Readonly<
  Record<TemplateVariable, { summary: string; detail: string }>
> = {
  "project.name": {
    summary: "Your project's name",
    detail: "Read from the project record rather than typed into the copy, so a rename follows.",
  },
  "user.email": {
    summary: "The address this mail is going to",
    detail: "Not always the account's own: on an address change one mail goes to each of the two.",
  },
  expires_in: {
    summary: "How long the reader has, written out",
    detail: 'Rounded and in words, "10 minutes", never a count of seconds a reader cannot act on.',
  },
  otp: {
    summary: "The one-time code",
    detail: "A value like any other, so it is escaped and cannot carry markup.",
  },
  link: {
    summary: "The signed, single-use URL",
    detail:
      "Pinned to a registered redirect target before it reaches the template, so a body cannot make an open redirect of it.",
  },
  new_email: {
    summary: "The address the account is moving to",
    detail: "Only on the two address-change messages, and never the address it is moving from.",
  },
};

/*
 * The template language, mirrored from `@idenzy/templating/binding`.
 */

/**
 * `{{ name }}` and `{{ name.path }}`, and nothing else.
 *
 * No conditionals, no loops, no helpers, no expressions. A template is customer-authored
 * content rendered on our servers with our data in scope, so anything that can evaluate
 * is a sandbox escape waiting to be found. Substitution is the whole feature, and the
 * absence of everything else is the security property.
 */
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)\s*\}\}/g;

/** Anything in double braces, so the ones the grammar refuses can be pointed at. */
const BRACED = /\{\{([\s\S]*?)\}\}/g;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Every placeholder a body references, in the order it references them. */
export function referencedVariables(source: string): string[] {
  return [...source.matchAll(PLACEHOLDER)].map(([, path]) => path ?? "");
}

/**
 * Braced runs the grammar does not accept: `{{#if}}`, `{{ user.Email }}`, `{{ 1 + 1 }}`.
 *
 * Worth naming separately from an unknown variable, because the failure is the opposite
 * one. An unknown variable throws and the mail is not sent; one of these is not a
 * placeholder at all, so it is sent to the reader exactly as typed.
 */
export function unmatchedPlaceholders(source: string): string[] {
  const found: string[] = [];
  for (const [whole] of source.matchAll(BRACED)) {
    PLACEHOLDER.lastIndex = 0;
    const matched = PLACEHOLDER.exec(whole);
    if (matched === null || matched[0] !== whole) found.push(whole);
  }
  PLACEHOLDER.lastIndex = 0;
  return found;
}

/*
 * What a screen refuses before the server has to.
 */

export type TemplateIssue =
  | "empty"
  | "unknown_variable"
  | "unmatched_placeholder"
  | "missing_payload"
  | "subject_markup";

export const TEMPLATE_ISSUE_LABELS: Record<TemplateIssue, string> = {
  empty: "This field cannot be empty.",
  unknown_variable:
    "References a variable this message does not carry. The send fails rather than leaving a gap, so the mail would never arrive.",
  unmatched_placeholder:
    "Looks like a placeholder and is not one. The template language is substitution only, so this is sent to the reader exactly as typed.",
  missing_payload:
    "Does not carry the value the message exists for, so the reader would get a mail they cannot act on.",
  subject_markup:
    "A subject is substituted as text, never as markup, so any tags here are sent as visible characters.",
};

export interface TemplateFieldIssues {
  subject: TemplateIssue[];
  html: TemplateIssue[];
  text: TemplateIssue[];
}

export interface TemplateBodies {
  subject: string;
  html: string;
  text: string;
}

/**
 * Every issue in a draft, by field.
 *
 * The payload check runs over the whole template rather than per field, because a code in
 * the HTML and not in the text part is still a mail that reached somebody, and flagging
 * both fields for one omission reads as two problems.
 */
export function validateTemplate(
  bodies: TemplateBodies,
  type: EmailTemplateType,
): TemplateFieldIssues {
  const scope = new Set<string>(variablesInScope(type));
  const issues: TemplateFieldIssues = { subject: [], html: [], text: [] };

  for (const field of ["subject", "html", "text"] as const) {
    const source = bodies[field];
    if (source.trim() === "") issues[field].push("empty");
    if (referencedVariables(source).some((name) => !scope.has(name))) {
      issues[field].push("unknown_variable");
    }
    if (unmatchedPlaceholders(source).length > 0) issues[field].push("unmatched_placeholder");
  }

  if (/<[a-z/][^>]*>/i.test(bodies.subject)) issues.subject.push("subject_markup");

  const payload = catalogueEntry(type)?.payload ?? null;
  if (payload !== null) {
    const carried = new Set([
      ...referencedVariables(bodies.html),
      ...referencedVariables(bodies.text),
    ]);
    if (!carried.has(payload)) issues.html.push("missing_payload");
  }

  return issues;
}

export function hasIssues(issues: TemplateFieldIssues): boolean {
  return issues.subject.length > 0 || issues.html.length > 0 || issues.text.length > 0;
}

/*
 * The same rules again, as positions rather than as a verdict.
 *
 * The list above answers "may this be saved". An editor has to answer "which characters
 * are the problem", so it needs the offsets, and both answers have to come from one
 * reading of the grammar or the field turns red while nothing under the cursor is marked.
 */

/** One braced run in a body, whether or not the grammar accepts it. */
export interface PlaceholderMatch {
  from: number;
  to: number;
  /** The variable named, or null where the braced run is not a placeholder at all. */
  name: string | null;
  text: string;
}

/**
 * Every braced run in a body, in order, with the ones the grammar refuses marked.
 *
 * `BRACED` rather than `PLACEHOLDER`, deliberately: a screen that highlighted only what
 * the grammar accepts would leave `{{#if x}}` looking like ordinary text, which is
 * exactly what it becomes when the mail goes out and exactly what the author did not
 * mean. Both kinds are found here and the caller decides how each is drawn.
 */
export function scanPlaceholders(source: string): PlaceholderMatch[] {
  const found: PlaceholderMatch[] = [];
  BRACED.lastIndex = 0;
  for (const match of source.matchAll(BRACED)) {
    const text = match[0];
    const from = match.index ?? 0;
    PLACEHOLDER.lastIndex = 0;
    const parsed = PLACEHOLDER.exec(text);
    found.push({
      from,
      to: from + text.length,
      name: parsed !== null && parsed[0] === text ? (parsed[1] ?? null) : null,
      text,
    });
  }
  PLACEHOLDER.lastIndex = 0;
  BRACED.lastIndex = 0;
  return found;
}

/*
 * Saved, sending, and the difference between them.
 */

/**
 * What a message is doing for a reader right now.
 *
 * Four states rather than two, because saved and delivering are different things and the
 * gap between them is a real window: a body is compiled off the request path, and until
 * that has happened the renderer reads the row as absent and our built-in is what goes
 * out. A screen that said only "Custom" through that window would be telling an operator
 * their new copy is being sent when it is not.
 */
export type TemplateStatus = "active" | "compiling" | "built_in" | "unavailable";

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  active: "Custom",
  compiling: "Compiling",
  built_in: "Built-in",
  unavailable: "Unavailable",
};

export function statusOf(input: {
  /** False for a type the protocol names and no flow sends yet. */
  live: boolean;
  /** Whose copy a send would resolve to for the language being previewed. */
  source: TemplateSource;
  /** Rows saved for this message and not yet compiled, across every language. */
  compiling: number;
}): TemplateStatus {
  if (!input.live) return "unavailable";
  if (input.compiling > 0) return "compiling";
  return input.source === "yours" ? "active" : "built_in";
}

/**
 * What one language of one message is doing, which is the state the workspace draws
 * against each row of its language list.
 *
 * `draft` outranks everything, because unsaved work is the thing a reader most needs to
 * see marked, and it is the state this screen exists to stop losing.
 */
export type LocaleStatus = "draft" | "compiling" | "active" | "none";

export const LOCALE_STATUS_LABELS: Record<LocaleStatus, string> = {
  draft: "Unsaved",
  compiling: "Compiling",
  active: "Sending",
  none: "Built-in",
};

export function localeStatusOf(input: {
  dirty: boolean;
  stored: boolean;
  compiled: boolean;
}): LocaleStatus {
  if (input.dirty) return "draft";
  if (!input.stored) return "none";
  return input.compiled ? "active" : "compiling";
}

/** Whether two drafts of the same message differ, which is what makes a language dirty. */
export function bodiesEqual(a: TemplateBodies, b: TemplateBodies): boolean {
  return a.subject === b.subject && a.html === b.html && a.text === b.text;
}

/*
 * Locales.
 */

export const DEFAULT_LOCALE = "en";

const LOCALE = /^([a-z]{2,3})(?:[-_]([a-z]{2}|\d{3}))?$/i;

/** Null rather than a throw: a malformed tag becomes the default instead of an error. */
export function normalizeLocale(locale: string): string | null {
  const match = LOCALE.exec(locale.trim());
  if (match === null) return null;
  const language = (match[1] ?? "").toLowerCase();
  const region = match[2];
  return region === undefined ? language : `${language}-${region.toUpperCase()}`;
}

/**
 * The lookup order for a locale: `tr-TR`, then `tr`, then `en`. A chain rather than an
 * exact match, so a project that has translated `tr` gets it for every Turkish region
 * without maintaining `tr-CY` beside it.
 */
export function localeChain(locale: string, fallback: string = DEFAULT_LOCALE): string[] {
  const chain: string[] = [];
  const normalized = normalizeLocale(locale);
  if (normalized !== null) {
    chain.push(normalized);
    const language = normalized.split("-")[0];
    if (language !== undefined && language !== normalized) chain.push(language);
  }
  if (!chain.includes(fallback)) chain.push(fallback);
  return chain;
}

export type TemplateSource = "yours" | "built_in";

export interface Resolution {
  source: TemplateSource;
  /** The locale that actually supplied the copy, which is rarely the one asked for. */
  locale: string;
}

/**
 * Which copy a send would use, and this is the rule most worth stating on the screen.
 *
 * The project's whole fallback chain is tried before any built-in of ours. A project that
 * has translated `en` and not `tr` sends their English to a Turkish reader rather than our
 * Turkish, because their copy carries their product's name and voice and ours carries
 * neither. Our built-ins are English only today, so the last step is always `en`.
 */
export function resolve(locale: string, stored: readonly string[]): Resolution {
  const held = new Set(stored);
  for (const candidate of localeChain(locale)) {
    if (held.has(candidate)) return { source: "yours", locale: candidate };
  }
  return { source: "built_in", locale: DEFAULT_LOCALE };
}

/*
 * Rendering a preview.
 */

export interface PreviewVariables {
  projectName: string;
  expiresInSeconds: number;
}

/**
 * The values a preview substitutes. The sign-in code is the one the one-time-code screen
 * shows, read from there rather than invented again, so two screens previewing the same
 * mail cannot show two different codes.
 */
export function sampleValues({
  projectName,
  expiresInSeconds,
}: PreviewVariables): Record<string, string> {
  return {
    "project.name": projectName,
    "user.email": "alex@example.com",
    expires_in: humanizeSeconds(expiresInSeconds),
    otp: SAMPLE_CODE,
    link: "https://auth.example.com/v1/auth/verify?token=8f3c1e",
    new_email: "alex@newmail.example",
  };
}

/**
 * Substitutes the sample values, escaping in HTML mode exactly as the renderer does.
 *
 * A placeholder with nothing to substitute is left standing rather than blanked, which is
 * the honest preview of a body the server would refuse: the reader sees the braces and
 * the issue list says why the send would fail.
 */
export function renderPreview(
  source: string,
  values: Record<string, string>,
  mode: "html" | "text",
): string {
  return source.replace(PLACEHOLDER, (whole, path: string) => {
    const value = values[path];
    if (value === undefined) return whole;
    return mode === "html" ? escapeHtml(value) : value;
  });
}

/**
 * A plain-text body derived from an HTML one, mirroring the renderer's own fallback.
 *
 * Anchor text keeps its href beside it, because a link the reader cannot see is the one
 * thing a text part must not lose. Offered as a starting point and never applied on save:
 * the text part is what a screen reader and a spam filter read, and a mechanical strip
 * reads like one.
 */
export function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => TEXT_ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

const TEXT_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/*
 * The copy every project starts with, verbatim from `@idenzy/templating/defaults/en`.
 *
 * Mirrored rather than described, so the screen shows the message somebody actually
 * receives. The markup is deliberately dull: one card, inline styles, no images, no web
 * fonts, no external anything, which is what renders the same in Outlook, Gmail and a
 * text client and what does not leak a read receipt to us.
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

function layout(heading: string, body: string): string {
  return [
    `<div style="${STYLES.body}">`,
    `<div style="${STYLES.card}">`,
    `<h1 style="${STYLES.heading}">${heading}</h1>`,
    body,
    `<p style="${STYLES.footer}">${IGNORE_LINE}</p>`,
    "</div>",
    "</div>",
  ].join("");
}

const paragraph = (text: string) => `<p style="${STYLES.text}">${text}</p>`;
const button = (label: string) =>
  `<p style="${STYLES.text}"><a href="{{ link }}" style="${STYLES.button}">${label}</a></p>`;

export const BUILT_IN: Readonly<Partial<Record<EmailTemplateType, TemplateBodies>>> = {
  email_otp: {
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
  magic_link: {
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
  email_verification: {
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
  password_reset: {
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
  email_change_old: {
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
    ),
    /* No ignore line, and that is deliberate: this one is a warning, and telling the
       reader they may ignore it is the opposite of what it is for. */
    text: [
      "Your {{ project.name }} account is set to move from {{ user.email }} to {{ new_email }}.",
      "It will not change until you confirm here and the new address is confirmed too:",
      "{{ link }}",
      "",
      "If this was not you, do not confirm. Change your password instead.",
      "The request expires in {{ expires_in }}.",
    ].join("\n"),
  },
  email_change_new: {
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
};

/** An empty draft for a type we ship no copy for, so the editor opens on something. */
export function startingPoint(type: EmailTemplateType): TemplateBodies {
  const shipped = BUILT_IN[type];
  if (shipped !== undefined) return { ...shipped };
  return {
    subject: "",
    html: layout("", paragraph("")),
    text: "",
  };
}
