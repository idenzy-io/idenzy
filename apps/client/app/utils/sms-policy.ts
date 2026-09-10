/**
 * The SMS policy as the server holds it (`sms_policies`, PROJECT.md 4.8): where a project
 * may send, what it may spend in a day, and the ceilings the fraud guard reads before a
 * message costs anything. Its own screen is under SMS; the one-time codes screen reads
 * it to say whether the channel can send at all.
 *
 * A project with no row sends nothing, which is the same answer as an empty allowlist
 * and is deliberate: "nobody configured this" is not a reason to start spending.
 */
export interface SmsPolicy {
  /** ISO 3166-1 alpha-2, default deny. Twenty countries share +1, so it is never a prefix. */
  allowedCountries: string[];
  /** A hard stop, not an alert threshold. */
  dailySpendCap: number;
  currency: string;
  /** A CAPTCHA or app attestation before any counter is touched. On by default. */
  attestationRequired: boolean;
  perNumberDailyLimit: number;
  perIpHourlyLimit: number;
  /** Sends per code entered, above a daily floor, before the project is throttled. */
  maxSendsPerVerify: number;
  /** Alphanumeric, registered per country. Null uses the shared number. */
  senderId: string | null;
}

/** The row's own defaults, for a project that gets one. */
export const SMS_POLICY_DEFAULTS = {
  dailySpendCap: 2,
  currency: "USD",
  attestationRequired: true,
  perNumberDailyLimit: 5,
  perIpHourlyLimit: 10,
  maxSendsPerVerify: 6,
} as const;

/** Whether the policy lets anything be sent. No row and an empty list are the same no. */
export function canSendSms(policy: SmsPolicy | null): boolean {
  return policy !== null && policy.allowedCountries.length > 0;
}

/*
 * The bounds a control offers. Wider than any project should need at both ends, because
 * the point of a bound here is to catch a typed zero or a pasted thousand, not to have an
 * opinion about a customer's traffic.
 */
export const SMS_POLICY_BOUNDS = {
  dailySpendCap: { min: 1, max: 10_000 },
  perNumberDailyLimit: { min: 1, max: 50 },
  perIpHourlyLimit: { min: 1, max: 200 },
  maxSendsPerVerify: { min: 2, max: 50 },
} as const;

/**
 * The parts of the guard a project does not decide, with the reason each one is fixed.
 *
 * A constant here is not a setting somebody forgot to expose. Each describes the shape of
 * an attack rather than a preference, and a customer able to raise it could only ever
 * raise it in the direction the attack wants.
 */
export const SMS_GUARD_CONSTANTS = {
  /** Destinations sharing a thousand-block per hour before it reads as a sweep. */
  blockBurstLimit: 10,
  blockWindowSeconds: 3600,
  /** Sends in a day below which the verify ratio is noise rather than a signal. */
  ratioFloor: 20,
  /** What a refused caller is told to wait. One window, not a computed remainder. */
  retryAfterSeconds: 900,
  /** What the development transport quotes, in micros. Real cost is per destination. */
  notionalCostMicros: 7000,
} as const;

/*
 * Whether anything can actually be sent.
 *
 * Three independent things stop a send, and a project can be blocked by more than one at
 * once, so this answers with a list rather than a boolean. The screen exists largely to
 * make the second one visible: attestation is on by default and nothing is wired that can
 * satisfy it, so a project with a perfect allowlist and a healthy cap still sends nothing
 * and the refusal names a token the caller was never able to obtain.
 */
export type SmsBlocker = "no_policy" | "no_countries" | "attestation_unsatisfiable" | "cap_reached";

export interface BlockerInfo {
  id: SmsBlocker;
  title: string;
  detail: string;
  /** The code a caller receives, so a refusal in somebody's logs can be matched to this. */
  errorCode: string;
}

export const SMS_BLOCKERS: Record<SmsBlocker, BlockerInfo> = {
  no_policy: {
    id: "no_policy",
    title: "This project has no SMS policy",
    detail:
      "Nobody has configured where it may send or what it may spend, and that is not a reason to start spending on its behalf. Every send is refused before it reaches a provider.",
    errorCode: "country_not_allowed",
  },
  no_countries: {
    id: "no_countries",
    title: "No country is allowed",
    detail:
      "The allowlist is empty, which is the same answer as having no policy at all. It starts empty on purpose: pumping picks the destination, so the countries a product does not serve are exactly the ones an attacker sends to, and a list that starts open is one nobody ever narrows.",
    errorCode: "country_not_allowed",
  },
  attestation_unsatisfiable: {
    id: "attestation_unsatisfiable",
    title: "Attestation is required and nothing can satisfy it",
    detail:
      "No attestation provider is wired on this deployment, and the verifier that stands in for one answers false to everything. So every send is refused for a token the caller had no way to obtain. This is the intended failure rather than an oversight: a verifier that accepted what it cannot check would make the setting read as protection while being none.",
    errorCode: "attestation_required",
  },
  cap_reached: {
    id: "cap_reached",
    title: "Today's spend cap is reached",
    detail:
      "A hard stop rather than an alert. It clears at the start of the next UTC day, and raising the cap takes effect on the next send.",
    errorCode: "spend_cap_reached",
  },
};

export interface SmsReadiness {
  /** What the deployment can do about attestation, which no project setting changes. */
  blockers: SmsBlocker[];
  sendable: boolean;
}

/**
 * What would stop the next send, in the order the guard would hit them.
 *
 * `attestationWired` is the deployment's business and not the project's, which is why it
 * is passed in rather than read off the policy: a project turning the requirement off is
 * accepting the pumping risk itself, and that is a different decision from ours not having
 * wired a verifier.
 */
export function evaluateReadiness(
  policy: SmsPolicy | null,
  spentToday: number,
  attestationWired: boolean,
): SmsReadiness {
  const blockers: SmsBlocker[] = [];
  if (policy === null) blockers.push("no_policy");
  else {
    if (policy.allowedCountries.length === 0) blockers.push("no_countries");
    if (policy.attestationRequired && !attestationWired) {
      blockers.push("attestation_unsatisfiable");
    }
    if (spentToday >= policy.dailySpendCap) blockers.push("cap_reached");
  }
  return { blockers, sendable: blockers.length === 0 };
}

/*
 * The order the checks run in, which is the design rather than a sequence.
 */

export interface SmsCheck {
  id: string;
  title: string;
  detail: string;
  /** The code a caller receives where this one refuses. */
  errorCode: string;
  /** Whether the check writes. Everything that writes runs after everything that does not. */
  writes: boolean;
  /** False where the project decides nothing about it. */
  configurable: boolean;
}

export const SMS_CHECK_ORDER: readonly SmsCheck[] = [
  {
    id: "place",
    title: "Where the number is",
    detail:
      "The destination is placed from carrier metadata, not from its prefix: twenty countries share +1, so a project allowing the United States must not thereby be allowing every Caribbean range on the same code. A number that cannot be placed is refused, because an allowlist that admits what it could not identify is not one.",
    errorCode: "country_not_allowed",
    writes: false,
    configurable: true,
  },
  {
    id: "premium",
    title: "Whether the range is premium rate",
    detail:
      "Premium-rate and shared-cost ranges are refused whatever the allowlist says. They are paid for the same way, and a range nobody signs in from has nothing to lose by being refused.",
    errorCode: "country_not_allowed",
    writes: false,
    configurable: false,
  },
  {
    id: "attestation",
    title: "Whether the caller proved they are human",
    detail:
      "Before any counter, and that ordering is the whole point of it. A counter is a write, so without this first anybody could exhaust a stranger's daily allowance by naming their number, and the victim would find their own sign-in refused having never been sent a code.",
    errorCode: "attestation_required",
    writes: false,
    configurable: true,
  },
  {
    id: "number",
    title: "How often this number has been messaged today",
    detail:
      "The first check that writes. It catches a scheme milking one destination, which the per-address ceiling below cannot see.",
    errorCode: "rate_limited",
    writes: true,
    configurable: true,
  },
  {
    id: "ip",
    title: "How often this address has asked this hour",
    detail:
      "The other half of the same abuse: one address spraying many numbers is the sweep, which the per-number ceiling cannot see. Skipped where the request carries no address rather than refused, since that is our gap and not the caller's.",
    errorCode: "rate_limited",
    writes: true,
    configurable: true,
  },
  {
    id: "sweep",
    title: "Whether the destinations are consecutive",
    detail:
      "A pumping run walks a range, so its numbers share every digit but the last few. One counter per thousand-block is the cheapest shape that catches that, and a genuine user base spread across a country never concentrates in one.",
    errorCode: "rate_limited",
    writes: true,
    configurable: false,
  },
  {
    id: "ratio",
    title: "Codes sent against codes entered",
    detail:
      "The signal that catches a scheme which has done everything else right, because the one thing it cannot fake is somebody typing the code in. It throttles the project rather than the caller, which is blunt and deliberate: by the time it trips, the traffic is not a user having a bad day.",
    errorCode: "rate_limited",
    writes: false,
    configurable: true,
  },
  {
    id: "spend",
    title: "Whether today's spend leaves room",
    detail:
      "Last, and in Postgres rather than the cache, because this is the one limit whose failure mode is an invoice: a cache outage must not be able to lift it. The check and the increment are one statement, or two sends that each fit under the cap would both pass.",
    errorCode: "spend_cap_reached",
    writes: true,
    configurable: true,
  },
];

/*
 * Countries.
 */

/**
 * ISO 3166-1 alpha-2, as the column stores them. The list is here rather than fetched
 * because a picker that cannot offer a country until a request lands is a picker that
 * blocks the one action this screen exists for.
 */
const ALPHA2 =
  "AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CW CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MQ MR MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VC VE VG VI VN VU WS XK YE YT ZA ZM ZW";

export interface CountryOption {
  code: string;
  name: string;
}

/** Every country a project may allow, by name, which is the order they are read in. */
export function allCountries(nameOf: (code: string) => string): CountryOption[] {
  return ALPHA2.split(" ")
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** A cap and a spend written the way the column stores them: the currency, then six places trimmed. */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** How much of today's cap is gone, 0 to 1, for the meter beside it. */
export function capShare(spentToday: number, cap: number): number {
  if (cap <= 0) return 1;
  return Math.min(1, Math.max(0, spentToday / cap));
}
