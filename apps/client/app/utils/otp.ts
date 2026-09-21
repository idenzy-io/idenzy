/**
 * What a project decides about one-time codes and magic links, and what it cannot.
 *
 * The decidable part is per channel and small: whether the channel exists on the
 * project, whether a code may create an account, and for magic links the routes a click
 * may land on. Everything about the code itself is fixed by the server on purpose
 * (apps/api/src/otp) and listed here so the screen states it rather than hiding it:
 * six digits, five attempts, a lifetime set for the deployment, one live code per
 * address, a memory-hard hash at rest.
 *
 * The three channels are three integrations rather than three switches, which is what the
 * readiness half of this file exists for. A code by email needs a sending domain; a code
 * by SMS needs a country allowlist, a spend cap, a delivery account and something that can
 * satisfy attestation; a link needs a route of the customer's and the CORS allowlist that
 * route's own origin has to be on. None of those live on this screen, so the checks name
 * the screen each one is settled on.
 *
 * The SMS fraud controls themselves are not here. They are a policy of their own
 * (`sms_policies`, see `utils/sms-policy.ts`) with a screen of their own under SMS, and
 * this file reads that policy only to say whether the channel can send at all.
 */

import { originOf, validateAllowedOrigin } from "./origins";
import { plural, type SetupCheck } from "./setup-check";
import type { SmsPolicy } from "./sms-policy";

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
  /** As on a code channel: a link followed from an unknown address creates the account. */
  allowSignUp: boolean;
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
  magicLink: { enabled: false, allowSignUp: true, redirectUris: [] },
};

/*
 * Return URLs, for magic links. The API calls them redirect URIs and the screen calls
 * them return URLs, because a customer holds four lists of URLs and only one of them is
 * the page a sign-in comes back to.
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
    "The whole URL your app receives the sign-in on, path included: https://app.example.com/auth/callback. A native app may use its own scheme, myapp://auth.",
  redirect_insecure:
    "http is allowed on localhost only. Anywhere else the code would travel in clear.",
  redirect_fragment:
    "No fragment. The code goes in the query, and a fragment never reaches your server.",
  redirect_code_param: "The link adds code itself, so the URL must not carry one already.",
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

/*
 * The channels, as the screen navigates them.
 *
 * WhatsApp is in the list and cannot be turned on. It is already a name in the SDK's
 * channel enum and the first thing an operator looks for after SMS, so a tab that says
 * what it is and what it is not answers the question once; leaving it out only means
 * somebody searches three screens for it.
 */

export type ChannelId = "email" | "sms" | "link" | "whatsapp";

export interface ChannelInfo {
  id: ChannelId;
  /** The tab, and the words the rest of the screen uses for the channel. */
  label: string;
  /** What a user receives, as a sentence names it: "an SMS code". */
  noun: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** One line under the channel's title: what a user actually receives. */
  blurb: string;
  /** False for a channel named here that nobody can switch on. */
  available: boolean;
}

export const CHANNELS: readonly ChannelInfo[] = [
  {
    id: "email",
    label: "Email code",
    noun: "an email code",
    icon: "material-symbols:mail-outline",
    blurb:
      "Six digits by email, typed into a form of yours. The default passwordless method, and the one with no cost per send beyond the mail itself.",
    available: true,
  },
  {
    id: "sms",
    label: "SMS code",
    noun: "an SMS code",
    icon: "material-symbols:sms-outline",
    blurb:
      "The same six digits by text message. The one channel that costs money before it reaches anybody, so everything about sending it is stricter.",
    available: true,
  },
  {
    id: "link",
    label: "Magic link",
    noun: "a magic link",
    icon: "material-symbols:link",
    blurb:
      "A link by email instead of a code. The click lands on a route of yours carrying a single-use code your page exchanges for a session.",
    available: true,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    noun: "a WhatsApp message",
    icon: "material-symbols:chat-outline",
    blurb: "Roughly a tenth of the price of an SMS in most regions, and not a channel yet.",
    available: false,
  },
];

export function channelInfo(id: ChannelId): ChannelInfo {
  return CHANNELS.find((channel) => channel.id === id) ?? (CHANNELS[0] as ChannelInfo);
}

/** The settings a channel holds, for the two that are shaped the same. */
export function channelSettings(id: ChannelId, settings: OtpSettings): CodeChannel {
  if (id === "sms") return settings.sms;
  if (id === "link") {
    return { enabled: settings.magicLink.enabled, allowSignUp: settings.magicLink.allowSignUp };
  }
  return settings.email;
}

/*
 * Whether a channel can actually deliver.
 *
 * Everything here is read from what the panel already holds, so a check answers the
 * moment a setting on another screen changes rather than at the moment somebody asked.
 * A failing check is what the badge calls setup incomplete; a warning is worth reading
 * and blocks nothing.
 */

export interface OtpSetup {
  settings: OtpSettings;
  /** The domain the project's mail leaves from. Null while nothing has loaded. */
  sending: { domain: string; verified: boolean; shared: boolean } | null;
  /** Addresses and numbers this project will not send to, by channel. */
  suppressed: { email: number; sms: number };
  policy: SmsPolicy | null;
  spentToday: number;
  /** The deployment's business rather than the project's, so it is passed in. */
  attestationWired: boolean;
  /** How SMS leaves, as the providers screen settled it. */
  delivery: { ready: boolean; label: string };
  /** The CORS allowlist, which a return URL's own origin has to be on. */
  allowedOrigins: readonly string[];
}

export function channelChecks(id: ChannelId, setup: OtpSetup): SetupCheck[] {
  if (id === "sms") return smsChecks(setup);
  if (id === "link") return [...linkChecks(setup), sendingCheck(setup, "Links")];
  if (id === "email") return emailChecks(setup);
  return [];
}

/** What is blocking, which is the failing checks and nothing else. */
export function channelBlockers(id: ChannelId, setup: OtpSetup): SetupCheck[] {
  return channelChecks(id, setup).filter((check) => check.state === "fail");
}

export interface ChannelState {
  label: string;
  tone: "success" | "warning" | "neutral";
}

/**
 * The word in the channel's badge. Off is a decision rather than a fault, so a channel
 * nobody turned on says so instead of listing what would be wrong if they had.
 */
export function channelState(id: ChannelId, setup: OtpSetup): ChannelState {
  const info = channelInfo(id);
  if (!info.available) return { label: "Not available", tone: "neutral" };
  if (!channelSettings(id, setup.settings).enabled) return { label: "Off", tone: "neutral" };
  if (channelBlockers(id, setup).length > 0) return { label: "Setup incomplete", tone: "warning" };
  return { label: "Ready", tone: "success" };
}

/** Where the codes leave from, which decides whether any of them arrive. */
function sendingCheck(setup: OtpSetup, subject: string): SetupCheck {
  const sending = setup.sending;
  if (sending === null) {
    return {
      id: "sending-domain",
      label: "Sending domain",
      state: "fail",
      finding: "This project sends from nowhere, so nothing is mailed at all.",
      fix: { label: "Sending domains", to: "/email/domains" },
    };
  }
  if (!sending.verified) {
    return {
      id: "sending-domain",
      label: "Sending domain",
      state: "fail",
      finding: `${sending.domain} is not verified yet, so its records have still to be found in DNS. Nothing is sent from a domain we cannot prove is yours.`,
      fix: { label: "Sending domains", to: "/email/domains" },
    };
  }
  return {
    id: "sending-domain",
    label: "Sending domain",
    state: sending.shared ? "warn" : "pass",
    finding: sending.shared
      ? `${subject} leave from ${sending.domain}, which is ours and shared with every project on it. It delivers, and it is not your name in the From line.`
      : `${subject} leave from ${sending.domain}, verified.`,
    fix: { label: "Sending domains", to: "/email/domains" },
  };
}

function emailChecks(setup: OtpSetup): SetupCheck[] {
  const blocked = setup.suppressed.email;
  return [
    sendingCheck(setup, "Codes"),
    {
      id: "template",
      label: "The message",
      state: "pass",
      finding:
        "The built-in email_otp copy, with your project's name in it. A template of your own replaces it, in as many languages as you write.",
      fix: { label: "Email templates", to: "/email/templates" },
    },
    {
      id: "suppressions",
      label: "Blocked addresses",
      state: blocked > 0 ? "warn" : "pass",
      finding:
        blocked > 0
          ? `${plural(blocked, "address is", "addresses are")} suppressed and are sent nothing. The start still answers as though a code went out, because the answer may not say which addresses are known.`
          : "Nothing on this project is suppressed, so every address asked for is mailed.",
      fix: { label: "Suppressions", to: "/email/suppressions" },
    },
  ];
}

/* The screen every SMS prerequisite but one is settled on. */
const SMS_POLICY_FIX = { label: "Policy & spend", to: "/sms/policy" } as const;

function countriesCheck(policy: SmsPolicy | null): SetupCheck {
  if (policy === null) {
    return {
      id: "countries",
      label: "Countries allowed",
      state: "fail",
      finding:
        "This project has no SMS policy, which is the same answer as an empty allowlist: every send is refused with country_not_allowed, and costs nothing.",
      fix: SMS_POLICY_FIX,
    };
  }
  if (policy.allowedCountries.length === 0) {
    return {
      id: "countries",
      label: "Countries allowed",
      state: "fail",
      finding:
        "The allowlist is empty, so every send is refused with country_not_allowed. It starts empty because pumping picks the destination, and the countries a product does not serve are the ones an attacker sends to.",
      fix: SMS_POLICY_FIX,
    };
  }
  return {
    id: "countries",
    label: "Countries allowed",
    state: "pass",
    finding: `${plural(policy.allowedCountries.length, "country is", "countries are")} allowed, placed from carrier metadata rather than the dialling prefix.`,
    fix: SMS_POLICY_FIX,
  };
}

function spendCapCheck(policy: SmsPolicy | null, spentToday: number): SetupCheck {
  if (policy === null) {
    return {
      id: "spend-cap",
      label: "Daily spend cap",
      state: "fail",
      finding: "No policy means no cap, and a channel with no cap is one nobody may spend on.",
      fix: SMS_POLICY_FIX,
    };
  }

  const share = policy.dailySpendCap <= 0 ? 1 : spentToday / policy.dailySpendCap;
  const spent = formatMoney(spentToday, policy.currency);
  const cap = formatMoney(policy.dailySpendCap, policy.currency);

  if (share >= 1) {
    return {
      id: "spend-cap",
      label: "Daily spend cap",
      state: "fail",
      finding: `Today's cap of ${cap} is reached. It is a hard stop rather than an alert, and it clears at the start of the next UTC day.`,
      fix: SMS_POLICY_FIX,
    };
  }
  return {
    id: "spend-cap",
    label: "Daily spend cap",
    state: share >= 0.8 ? "warn" : "pass",
    finding: `${spent} of ${cap} spent today. The check and the increment are one statement, so two sends that each fit under the cap cannot both pass.`,
    fix: SMS_POLICY_FIX,
  };
}

function attestationCheck(policy: SmsPolicy | null, wired: boolean): SetupCheck {
  const label = "Human check before a send";
  if (policy === null) {
    return {
      id: "attestation",
      label,
      state: "warn",
      finding: "Nothing is decided about it yet, because the project has no policy.",
      fix: SMS_POLICY_FIX,
    };
  }
  if (!policy.attestationRequired) {
    return {
      id: "attestation",
      label,
      state: "warn",
      finding:
        "Not required, so anybody who can reach your start endpoint can have a message sent to any allowed number at your expense.",
      fix: SMS_POLICY_FIX,
    };
  }
  return {
    id: "attestation",
    label,
    state: wired ? "pass" : "fail",
    finding: wired
      ? "Required, and checked before any counter is touched, so nobody can burn a stranger's daily allowance by naming their number."
      : "Required, and no attestation provider is wired on this deployment, so every send is refused for a token the caller had no way to obtain. That is the intended failure: a verifier that accepted what it cannot check would make the setting read as protection while being none.",
    fix: SMS_POLICY_FIX,
  };
}

function smsChecks(setup: OtpSetup): SetupCheck[] {
  const blocked = setup.suppressed.sms;

  return [
    countriesCheck(setup.policy),
    spendCapCheck(setup.policy, setup.spentToday),
    {
      id: "delivery",
      label: "Delivery account",
      state: setup.delivery.ready ? "pass" : "fail",
      finding: setup.delivery.ready
        ? `${setup.delivery.label}. A failed send is never retried: the spend is already reserved and a gateway timeout is the case where the message usually went out.`
        : `${setup.delivery.label}, so nothing can be handed to a carrier.`,
      fix: { label: "SMS providers", to: "/sms/providers" },
    },
    attestationCheck(setup.policy, setup.attestationWired),
    {
      id: "suppressions",
      label: "Blocked numbers",
      state: blocked > 0 ? "warn" : "pass",
      finding:
        blocked > 0
          ? `${plural(blocked, "number is", "numbers are")} suppressed and are sent nothing, at no cost.`
          : "Nothing on this project is suppressed, so every allowed number asked for is texted.",
      fix: { label: "Suppressions", to: "/email/suppressions" },
    },
  ];
}

function linkChecks(setup: OtpSetup): SetupCheck[] {
  const uris = setup.settings.magicLink.redirectUris;
  const allowed = new Set(setup.allowedOrigins.map((origin) => origin.toLowerCase()));
  /*
   * A native scheme has no origin and never appears in an `Origin` header, and a loopback
   * or plain-http one is refused by the allowlist in any case, so neither is counted
   * against a project that could do nothing about it.
   */
  const missing = [
    ...new Set(
      uris
        .map((uri) => originOf(uri))
        .filter(
          (origin): origin is string =>
            origin !== null && !allowed.has(origin) && validateAllowedOrigin(origin, []) === null,
        ),
    ),
  ];

  return [
    {
      id: "return-urls",
      label: "Return URLs",
      state: uris.length === 0 ? "fail" : "pass",
      finding:
        uris.length === 0
          ? "No return URL is registered, so no link can be started at all. A start naming a URL that is not on the list is refused, and this list is the only thing between our redirect and somebody else's."
          : `${plural(uris.length, "URL is", "URLs are")} registered, matched exactly: the whole URL, no wildcards and no prefixes.`,
    },
    {
      id: "origins",
      label: "Browser access from those pages",
      state: missing.length > 0 ? "fail" : uris.length === 0 ? "warn" : "pass",
      finding:
        missing.length > 0
          ? `${plural(missing.length, "return URL sits", "return URLs sit")} on an origin the API will not answer a browser from: ${missing.join(", ")}. The link lands, the exchange is refused by the browser, and nothing about it reaches our logs.`
          : uris.length === 0
            ? "Nothing to check until a return URL is registered. Adding one does not allow its origin: landing on a page and reading a credentialed response are different privileges."
            : "Every return URL's origin is on the allowlist, so the page that receives the click can make the exchange call.",
      fix: { label: "Allowed origins", to: "/domains/origins" },
    },
    {
      id: "confirmation-route",
      label: "Your confirmation route",
      state: "warn",
      finding:
        "We cannot see whether the page a link lands on does anything with the code it is handed, and a route that ignores it looks exactly like a sign-in that does nothing. Mail scanners follow links, so that page has to ask for the confirming click, and it belongs with your product's other pages rather than with ours.",
    },
  ];
}

/*
 * What a channel does today, in one line, and what a code costs, in four figures.
 */

/** The sign-in and sign-up behaviour written out, with whatever is blocking it. */
export function channelSummary(id: ChannelId, setup: OtpSetup): string {
  const info = channelInfo(id);
  const channel = channelSettings(id, setup.settings);
  const noun = info.noun;

  if (!channel.enabled) {
    return `${info.label} is off. Start and verify answer as though the channel did not exist, and nothing about the accounts already using it changes.`;
  }

  const signUp = channel.allowSignUp
    ? `An address with no account gets one when the code verifies, with the address already verified.`
    : `An address with no account is still sent ${noun} and is refused after entering it, so the first call never says which addresses are known.`;

  const blocking = channelBlockers(id, setup).length;
  const state =
    blocking > 0
      ? ` ${plural(blocking, "check is", "checks are")} blocking delivery, so nothing reaches anybody until they are settled.`
      : "";

  return `Anybody who can read ${id === "sms" ? "messages at a number" : "mail at an address"} you allow can sign in with ${noun}. ${signUp}${state}`;
}

export interface ChannelFact {
  label: string;
  /** Already written, because the caller knows whether this is a count or a duration. */
  value: string;
  unit: string;
  note: string;
  tone?: "ink" | "primary" | "warning";
}

/**
 * Expiry, attempts, what asking again does and what a send costs: the four things a user
 * feels, ahead of everything about how a code is stored.
 */
export function channelFacts(id: ChannelId, body: SmsLength): ChannelFact[] {
  if (id === "link") {
    return [
      {
        label: "A link lasts",
        value: String(Math.round(CODE.linkLifetimeSeconds / 60)),
        unit: "minutes",
        note: "Set for the deployment and capped at an hour, long enough to survive a slow mail hop.",
      },
      {
        label: "Once clicked, the code lasts",
        value: String(Math.round(CODE.exchangeLifetimeSeconds / 60)),
        unit: "minutes",
        note: "One page load, which is all your route needs to exchange it for a session.",
      },
      {
        label: "Asking again leaves",
        value: "1",
        unit: "live link",
        note: "A new link retires every earlier one for that address, so three presses of resend leave one link that works.",
      },
      {
        label: "A send costs",
        value: "1",
        unit: "email",
        note: "No fee of its own. It counts against your sending domain's daily ceiling like any other mail.",
      },
    ];
  }

  const limit = body.encoding === "gsm-7" ? SMS_LIMITS.gsm7.single : SMS_LIMITS.ucs2.single;

  return [
    {
      label: "A code expires in",
      value: String(Math.round(CODE.lifetimeSeconds / 60)),
      unit: "minutes",
      note: "Set for the deployment and capped at an hour. The message itself says how long it lasts.",
    },
    {
      label: "Wrong guesses allowed",
      value: String(CODE.attempts),
      unit: "per code",
      note: "The fifth kills the challenge whatever the clock says. Asking for a new code is always allowed.",
    },
    {
      label: "Asking again leaves",
      value: "1",
      unit: "live code",
      note: "A new code retires every earlier one for that address, so three presses of resend leave one code that works and not three.",
    },
    id === "sms"
      ? {
          label: "A send costs",
          value: String(body.segments),
          unit: body.segments === 1 ? "segment" : "segments",
          note: `${body.units} of ${limit} characters in ${body.encoding === "gsm-7" ? "GSM-7" : "UCS-2"}. The second segment costs as much as the first, and one character outside GSM-7 drops the limit from 160 to 70.`,
          tone: body.segments > 1 ? "warning" : "ink",
        }
      : {
          label: "A send costs",
          value: "1",
          unit: "email",
          note: "No fee of its own. It counts against your sending domain's daily ceiling like any other mail.",
        },
  ];
}

/**
 * The four calls a sign-in on this channel actually makes, in order. The last step
 * follows the sign-up switch, because what happens to an unknown address is the thing
 * that switch decides and the thing a reader most often gets wrong.
 */
export function channelJourney(id: ChannelId, settings: OtpSettings): string[] {
  const channel = channelSettings(id, settings);

  if (id === "link") {
    return [
      "Your form takes an email address and calls startMagicLink with one of the return URLs below.",
      "We email the link. It points at our API rather than at your site, and the destination is stored with the token so it cannot change between sending and clicking.",
      "The click spends the link and sends the browser to your return URL with a single-use code in the query.",
      channel.allowSignUp
        ? "Your route calls exchange and gets a session. An address with no account gets one, verified."
        : "Your route calls exchange and gets a session, or a refusal if the address has no account.",
    ];
  }

  const address = id === "sms" ? "a phone number" : "an email address";
  const start = id === "sms" ? "startSms" : "startEmail";

  return [
    `Your form takes ${address} and calls ${start}. You get a challenge id back, and the same answer whether or not it has an account.`,
    id === "sms"
      ? "We place the number, run the fraud guard's ceilings and reserve the spend, then send. Anything refused here costs nothing."
      : "We send the code, and only once its row is committed: the other order can deliver a code for a challenge that rolled back.",
    "They type the six digits into your form. You call verify with the challenge id and the code.",
    channel.allowSignUp
      ? `You get a session. ${id === "sms" ? "A number" : "An address"} with no account gets one, already verified, which is the one place that word is fully earned.`
      : `You get a session, or a refusal after a perfectly valid code if ${id === "sms" ? "the number" : "the address"} has no account.`,
  ];
}

/**
 * The one thing about a channel worth stating beside its switches, which is the rule an
 * operator would otherwise ask support about. Everything else fixed about a code sits
 * folded at the foot of the screen.
 */
export function channelRule(
  id: ChannelId,
): { label: string; fixed: string; description: string } | null {
  if (id === "email") {
    return {
      label: "Same answer for every address",
      fixed: "Always",
      description:
        "Start answers with a challenge id whether or not the address has an account, and that is not a pretence: an unknown address is sent a real code. There is no branch to leak, which is a better answer than a branch carefully made to look the same.",
    };
  }
  if (id === "sms") {
    return {
      label: "Refused before it costs anything",
      fixed: "Always",
      description:
        "Placing the number is free and settles two refusals on its own, so it runs first. The human check is next and before any counter, because a counter is a write: without that order anybody could exhaust a stranger's daily allowance by naming their number. The ceilings, the sweep detector and the send-to-verify ratio follow.",
    };
  }
  if (id === "link") {
    return {
      label: "The confirmation step",
      fixed: "Your route",
      description:
        "Mail scanners follow links, so the click is not the sign-in. Landing on your route spends the link and hands it a code; the exchange that produces a session is a call your page makes, behind a confirming click that belongs where your product's other pages are.",
    };
  }
  return null;
}
