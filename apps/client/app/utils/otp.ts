/**
 * What a project decides about one-time codes and magic links, and what it cannot.
 *
 * The decidable part is per channel and small: whether the channel exists on the
 * project, whether a code may create an account, and for magic links the routes a click
 * may land on. Everything about the code itself is fixed by the server on purpose
 * (apps/auth-api/src/otp) and listed here so the screen states it rather than hiding it:
 * six digits, five attempts, a lifetime set for the deployment, one live code per
 * address, a memory-hard hash at rest.
 *
 * The SMS fraud controls are not here. They are a policy of their own (`sms_policies`,
 * see `utils/sms-policy.ts`) with a screen of their own under SMS, and this screen reads
 * that policy only to say whether the channel can send at all.
 */

/** The code as the server issues it, for the rows that say so. */
export const CODE = {
  digits: 6,
  /** Reaching it kills the challenge, however much lifetime is left. */
  attempts: 5,
  /** The deployment's `OTP_TTL_SECONDS`, whose default this is. Capped at an hour. */
  lifetimeSeconds: 600,
  /** `MAGIC_LINK_TTL_SECONDS`, the same default and the same cap. */
  linkLifetimeSeconds: 600,
  /** `AUTH_CODE_TTL_SECONDS`: the exchange code a redirect carries lives one page load. */
  exchangeLifetimeSeconds: 120,
  hash: "Argon2id",
} as const;

export interface CodeChannel {
  /** The channel exists on the project. Off, start and verify answer as if it did not. */
  enabled: boolean;
  /** A code sent to an address or number with no account creates one when it verifies. */
  allowSignUp: boolean;
}

export interface MagicLinkSettings {
  enabled: boolean;
  /** Where a clicked link may land, matched exactly. Empty, no link can be started. */
  redirectUris: string[];
}

export interface OtpSettings {
  email: CodeChannel;
  sms: CodeChannel;
  magicLink: MagicLinkSettings;
}

/**
 * Email on, the rest off. SMS costs money before it reaches anybody and sends nothing
 * without a policy in any case; links are the second choice (PROJECT.md 4.7) and need a
 * route of the customer's before one can be sent.
 */
export const DEFAULT_OTP_SETTINGS: OtpSettings = {
  email: { enabled: true, allowSignUp: true },
  sms: { enabled: false, allowSignUp: true },
  magicLink: { enabled: false, redirectUris: [] },
};

/*
 * Redirect URIs, for magic links.
 *
 * The server compares the whole string in SQL and normalises nothing, because the
 * string it checked and the string it redirects to must be the same string (that is how
 * a check gets bypassed by a trailing slash). So the rules here refuse what could never
 * work and change nothing else; what is written is what the customer's code has to send.
 */
export type RedirectUriIssue =
  | "redirect_invalid"
  | "redirect_insecure"
  | "redirect_fragment"
  | "redirect_code_param";

export const REDIRECT_ISSUE_LABELS: Record<RedirectUriIssue, string> = {
  redirect_invalid:
    "An absolute URL: https://app.example.com/auth/link, or an app scheme such as myapp://auth.",
  redirect_insecure:
    "http is allowed on localhost only. Anywhere else the code would travel in clear.",
  redirect_fragment:
    "No fragment. The code goes in the query, and a fragment never reaches a server.",
  redirect_code_param: "The redirect adds code itself, so the URL must not carry one already.",
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The URL parsed, or null if the text is not an absolute one with an authority. A
 * scheme alone (`javascript:`, `mailto:`) parses as a URL and is not a place a browser
 * can be sent, so the `//` is required.
 */
export function parseRedirectUri(value: string): URL | null {
  const text = value.trim();
  if (text === "" || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  return url.href.startsWith(`${url.protocol}//`) ? url : null;
}

export function validateRedirectUri(value: string): RedirectUriIssue | null {
  const url = parseRedirectUri(value);
  if (url === null || url.username !== "" || url.password !== "") return "redirect_invalid";
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) return "redirect_insecure";
  if (value.includes("#")) return "redirect_fragment";
  if (url.searchParams.has("code")) return "redirect_code_param";
  return null;
}

/*
 * What users receive.
 *
 * The built-in copy, verbatim from `@idenzy/templating`, so the preview on the screen is
 * the message and not a description of it. A project's own template replaces it under
 * Email templates, and the preview follows the built-in until the panel reads those.
 */
export const TEMPLATES = {
  emailOtpSubject: "{{ otp }} is your {{ project.name }} sign-in code",
  smsOtpBody:
    "{{ otp }} is your {{ project.name }} code. It expires in {{ expires_in }}. Do not share it.",
  magicLinkSubject: "Sign in to {{ project.name }}",
} as const;

/** A code that looks like one, for previews. The screen mints nothing. */
export const SAMPLE_CODE = "482913";

export function renderPreview(
  template: string,
  projectName: string,
  lifetimeSeconds: number = CODE.lifetimeSeconds,
): string {
  return template
    .replaceAll("{{ otp }}", SAMPLE_CODE)
    .replaceAll("{{ project.name }}", projectName)
    .replaceAll("{{ expires_in }}", humanizeSeconds(lifetimeSeconds));
}

/**
 * "10 minutes", as the mailer and the texter say it: rounded, because the copy says
 * roughly how long a code lasts and "9 minutes 58 seconds" is nothing anyone acts on.
 */
export function humanizeSeconds(seconds: number): string {
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/*
 * What an SMS costs, mirrored from `@idenzy/templating`'s `measure` so the preview
 * prices the body the way the send will. Segments are the billing unit and characters
 * are not: the 161st plain character costs a second segment, and one character outside
 * GSM-7 drops the whole message to UCS-2 and 70.
 */
const GSM7_BASIC = new Set(
  [
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?",
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
  ]
    .join("")
    .split(""),
);

/** Characters GSM-7 reaches only through an escape, so they cost two septets. */
const GSM7_EXTENDED = new Set(["\f", "^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export const SMS_LIMITS = {
  gsm7: { single: 160, concatenated: 153 },
  ucs2: { single: 70, concatenated: 67 },
} as const;

export type SmsEncoding = "gsm-7" | "ucs-2";

export interface SmsLength {
  encoding: SmsEncoding;
  /** Billable units: septets for GSM-7, UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
}

export function measureSms(body: string): SmsLength {
  let units = 0;
  for (const character of body) {
    if (GSM7_BASIC.has(character)) {
      units += 1;
    } else if (GSM7_EXTENDED.has(character)) {
      units += 2;
    } else {
      // Surrogate pairs count as two, which is what a carrier counts.
      const units16 = body.length;
      return { encoding: "ucs-2", units: units16, segments: segmentsFor(units16, SMS_LIMITS.ucs2) };
    }
  }
  return { encoding: "gsm-7", units, segments: segmentsFor(units, SMS_LIMITS.gsm7) };
}

/** A concatenated message spends part of every segment on the header that reassembles it. */
function segmentsFor(units: number, limit: { single: number; concatenated: number }): number {
  if (units === 0) return 0;
  if (units <= limit.single) return 1;
  return Math.ceil(units / limit.concatenated);
}

/** "$6.42", fixed to English like every figure in the panel. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
