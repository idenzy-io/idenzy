/**
 * The security centre's vocabulary: what a signal is, what each kind of one actually
 * proves, and the rules a project sets about them (PROJECT.md 3.2, 4.9).
 *
 * The whole file turns on one distinction. A signal is evidence and not a verdict. A
 * password that appears in a public corpus is a password somebody else also chose; two
 * sign-ins far apart in space and close together in time are a laptop and a phone on a
 * VPN as often as they are a theft. So nothing here carries a compromise score, nothing
 * here decides an account is stolen, and the response a project picks is applied by the
 * sign-in rather than by the screen that lists the evidence.
 *
 * Two of the six kinds break that rule, and they are the reason it is written down. A
 * refresh token presented twice is not evidence: the family it belonged to is revoked
 * before the row exists (ADR-0007), so the row records what already happened rather than
 * asking anybody to judge it. A send pattern that reads as toll fraud is the same shape,
 * because the SMS guard refused the send before it cost anything. Four of the six are
 * rules a project sets; two are facts it is told about.
 *
 * Severity is derived and never stored, and it is three values rather than a scale for
 * the reason `isNotable` in `audit.ts` is a flag: a scale invites an argument about
 * whether something is a four or a five, and the only question here is how soon somebody
 * should look. Derived, a severity cannot drift from the numbers it was read off.
 *
 * `describeEvidence` is the one sentence a signal is written as. The row draws the same
 * facts with the figures set in the mono face, the export writes this, and a screen
 * reader hears it, so the three cannot come to disagree about what a row said.
 */

import { csvCell, type TimeWindow, within } from "./filters";
import { countryName } from "./sessions";

/*
 * What we watch for.
 */

export type SignalKind =
  | "breached_password"
  | "impossible_travel"
  | "new_country"
  | "credential_stuffing"
  | "token_reuse"
  | "sms_pumping";

export const SIGNAL_KINDS: readonly SignalKind[] = [
  "breached_password",
  "impossible_travel",
  "new_country",
  "credential_stuffing",
  "token_reuse",
  "sms_pumping",
];

export const KIND_LABELS: Record<SignalKind, string> = {
  breached_password: "Breached password",
  impossible_travel: "Impossible travel",
  new_country: "New country",
  credential_stuffing: "Guessing at accounts",
  token_reuse: "Refresh token reused",
  sms_pumping: "SMS pumping",
};

/** Written out in full so @nuxt/icon bundles them. */
export const KIND_ICONS: Record<SignalKind, string> = {
  breached_password: "material-symbols:key-outline",
  impossible_travel: "material-symbols:flight-takeoff",
  new_country: "material-symbols:public",
  credential_stuffing: "material-symbols:person-search",
  token_reuse: "material-symbols:token-outline",
  sms_pumping: "material-symbols:sms-outline",
};

/**
 * What a kind proves, and what it does not. The second half is the part that matters: an
 * operator who reads "impossible travel" as "this account is stolen" suspends a salesman
 * with a phone and a laptop, and an operator who has done that twice stops reading the
 * screen.
 */
export const KIND_NOTES: Record<SignalKind, string> = {
  breached_password:
    "The password offered here appears in a public corpus. It proves the string is known to attackers, not that this account was taken: somebody else chose the same password first.",
  impossible_travel:
    "Two sign-ins whose separation would need an impossible speed. A phone on a mobile network and a laptop behind a corporate VPN produce this every day, which is why a hop through a VPN or a Tor exit is never counted.",
  new_country:
    "The first sign-in this account has made from this country. Almost always a holiday. It is here so that a run of them across many accounts is visible, which is not.",
  credential_stuffing:
    "One address refused across many accounts inside an hour. It is the shape of a list being tried, and the accounts named in it are the ones somebody guessed at rather than the ones at risk.",
  token_reuse:
    "A refresh token presented twice. This is the one signal that is a fact rather than evidence: the whole session family was revoked at the moment it was detected, and everybody on it was signed out.",
  sms_pumping:
    "A send pattern the fraud guard refused: sequential destinations, one carrier prefix, or far more sends than codes entered. Nothing was spent, and the numbers are the ones that were asked for.",
};

/*
 * How soon somebody should look.
 */

export type Severity = "act" | "review" | "record";

export const SEVERITIES: readonly Severity[] = ["act", "review", "record"];

export const SEVERITY_LABELS: Record<Severity, string> = {
  act: "Act now",
  review: "Review",
  record: "Recorded",
};

export const SEVERITY_NOTES: Record<Severity, string> = {
  act: "Something has already happened, or a guess is being made at scale. Worth an hour of somebody's day.",
  review:
    "Evidence that is often innocent and occasionally is not. Worth a look before the week is out.",
  record: "Kept because a run of them says something a single one does not. Nobody has to read it.",
};

/** Sorting the severity column: the order an operator wants the rows grouped in. */
export const SEVERITY_RANK: Record<Severity, number> = { act: 0, review: 1, record: 2 };

/*
 * What a signal is.
 */

/** Where a breached password was offered. The three are not equally interesting. */
export type BreachPoint = "sign_up" | "reset" | "sign_in";

export const BREACH_POINT_LABELS: Record<BreachPoint, string> = {
  sign_up: "at sign-up",
  reset: "at reset",
  sign_in: "at sign-in",
};

/**
 * What was actually observed, per kind.
 *
 * A discriminated union rather than a bag of optional fields, for the reason
 * `MfaFactor.check` takes one: a travel hop is not a corpus count, and a row that could
 * hold either would be a row every reader has to guess about.
 */
export type SignalEvidence =
  | {
      kind: "breached_password";
      /** Times the string appears in the corpus. HIBP publishes this with the suffix. */
      corpusCount: number;
      at: BreachPoint;
    }
  | {
      kind: "impossible_travel";
      /** ISO alpha-2, as every country in the panel is named. */
      from: string;
      to: string;
      kilometres: number;
      minutes: number;
      /** What the hop would have needed. Rounded, because it is an order of magnitude. */
      impliedKmh: number;
    }
  | { kind: "new_country"; country: string; countriesBefore: number }
  | {
      kind: "credential_stuffing";
      ip: string;
      accountsTried: number;
      refusals: number;
      minutes: number;
    }
  | {
      kind: "token_reuse";
      /** Sessions the family held, every one of them revoked when this was detected. */
      sessionsRevoked: number;
    }
  | {
      kind: "sms_pumping";
      /** The destination block, never a whole number: a signal is not a contact list. */
      prefix: string;
      sends: number;
      verified: number;
      /** What the refused sends would have cost, in the project's currency. */
      spendAvoided: number;
      currency: string;
    };

export type SignalState = "open" | "acknowledged" | "dismissed";

/* `SIGNAL_` on the front because `recovery.ts`, `claims.ts` and `import.ts` each have a
   `STATE_LABELS` of their own, and Nuxt auto-imports every module under `app/utils`: two
   exports of one name are one export and a warning, and the loser is silently the wrong
   map. Same reason `sms-providers.ts` has `PROVIDER_STATE_LABELS`. */
export const SIGNAL_STATE_LABELS: Record<SignalState, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  dismissed: "Dismissed",
};

/**
 * Why a signal was dismissed.
 *
 * Dismissing without a reason writes an audit entry saying somebody made a row go away,
 * which teaches the next reader nothing and teaches this one to click. The four cover
 * what a dismissal actually is, and "not a concern" is the honest name for the rest.
 */
export type DismissReason = "known_traveller" | "known_network" | "our_own_test" | "not_a_concern";

export const DISMISS_REASONS: readonly DismissReason[] = [
  "known_traveller",
  "known_network",
  "our_own_test",
  "not_a_concern",
];

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  known_traveller: "A person who travels",
  known_network: "A VPN, proxy or office we know",
  our_own_test: "Our own testing",
  not_a_concern: "Looked at, nothing in it",
};

export interface SecuritySignal {
  id: string;
  /**
   * The account the evidence is about, or null. Not every signal names one: a list being
   * tried against forty addresses is about the address doing the trying.
   */
  userId: string | null;
  /** When the detector saw it. A signal outlives the session it came from. */
  seenAt: string;
  state: SignalState;
  /** Set with the state, so a review a month later knows who called it. */
  decidedAt: string | null;
  decidedBy: string | null;
  reason: DismissReason | null;
  evidence: SignalEvidence;
}

export function kindOf(signal: SecuritySignal): SignalKind {
  return signal.evidence.kind;
}

/**
 * How soon to look, worked out from the evidence alone.
 *
 * Reuse and pumping are always urgent because something has already happened. Stuffing
 * turns urgent once the address has reached enough accounts to be a list rather than
 * somebody's forgotten password. A breach found at sign-in outranks one found at sign-up,
 * because that account exists, is being used, and its password is known.
 */
export function severityOf(evidence: SignalEvidence): Severity {
  switch (evidence.kind) {
    case "token_reuse":
    case "sms_pumping":
      return "act";
    case "credential_stuffing":
      return evidence.accountsTried >= STUFFING_LIST_ACCOUNTS ? "act" : "review";
    case "breached_password":
      return evidence.at === "sign_in" ? "act" : "review";
    case "impossible_travel":
      return "review";
    case "new_country":
      return "record";
  }
}

/** Above this many accounts from one address, a burst is a list and not a bad week. */
export const STUFFING_LIST_ACCOUNTS = 25;

/*
 * Writing one down.
 */

const COUNT = new Intl.NumberFormat("en");

/** A country by name, falling back to the code a lookup could not place. */
function place(code: string): string {
  return countryName(code) ?? code;
}

function plural(count: number, one: string, many: string): string {
  return `${COUNT.format(count)} ${count === 1 ? one : many}`;
}

/**
 * The signal as one sentence. The row, the tooltip, the export and a screen reader all
 * read this, so none of them can come to describe a row differently from the others.
 */
export function describeEvidence(evidence: SignalEvidence): string {
  switch (evidence.kind) {
    case "breached_password":
      return `Seen ${plural(evidence.corpusCount, "time", "times")} in the corpus, offered ${BREACH_POINT_LABELS[evidence.at]}`;
    case "impossible_travel":
      return `${place(evidence.from)} to ${place(evidence.to)}, ${COUNT.format(evidence.kilometres)} km in ${plural(evidence.minutes, "minute", "minutes")}, about ${COUNT.format(evidence.impliedKmh)} km/h`;
    case "new_country":
      return evidence.countriesBefore === 0
        ? `First country this account has signed in from: ${place(evidence.country)}`
        : `${place(evidence.country)}, after ${plural(evidence.countriesBefore, "other country", "other countries")}`;
    case "credential_stuffing":
      return `${evidence.ip} refused ${plural(evidence.refusals, "time", "times")} across ${plural(evidence.accountsTried, "account", "accounts")} in ${plural(evidence.minutes, "minute", "minutes")}`;
    case "token_reuse":
      return `${plural(evidence.sessionsRevoked, "session", "sessions")} in the family, all revoked`;
    case "sms_pumping":
      return `${evidence.prefix} took ${plural(evidence.sends, "send", "sends")} for ${plural(evidence.verified, "code entered", "codes entered")}`;
  }
}

/*
 * Narrowing the list.
 */

export type SignalFilter = "open" | "acknowledged" | "dismissed" | "all";

export const SIGNAL_FILTERS: readonly SignalFilter[] = ["open", "acknowledged", "dismissed", "all"];

export function matchesSignalFilter(signal: SecuritySignal, filter: SignalFilter): boolean {
  return filter === "all" || signal.state === filter;
}

export interface SignalCounts {
  all: number;
  open: number;
  acknowledged: number;
  dismissed: number;
  /** Open and urgent, which is the only number the header states. */
  urgent: number;
}

export function countSignals(signals: readonly SecuritySignal[]): SignalCounts {
  const counts: SignalCounts = {
    all: signals.length,
    open: 0,
    acknowledged: 0,
    dismissed: 0,
    urgent: 0,
  };
  for (const signal of signals) {
    counts[signal.state] += 1;
    if (signal.state === "open" && severityOf(signal.evidence) === "act") counts.urgent += 1;
  }
  return counts;
}

/** Whether a signal falls inside the window the screen is set to. */
export function inWindow(signal: SecuritySignal, window: TimeWindow, now: Date): boolean {
  return within(signal.seenAt, window, now);
}

/**
 * How the window's signals are spread across the kinds, for the panel beside the list.
 *
 * Every kind is returned whether or not it fired, because a kind with nothing against it
 * is the answer somebody came for and a list that dropped it would read as a detector
 * that is not running.
 */
export interface KindTally {
  kind: SignalKind;
  label: string;
  count: number;
  /** Of the signals counted, rounded, for the bar. */
  share: number;
}

export function tallyKinds(signals: readonly SecuritySignal[]): KindTally[] {
  const counts = new Map<SignalKind, number>();
  for (const signal of signals) {
    const kind = kindOf(signal);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const total = signals.length;
  return SIGNAL_KINDS.map((kind) => {
    const count = counts.get(kind) ?? 0;
    return {
      kind,
      label: KIND_LABELS[kind],
      count,
      share: total === 0 ? 0 : Math.round((count / total) * 100),
    };
  });
}

/*
 * What the project decides.
 */

/** The four kinds a project has a rule about. The other two are facts, not settings. */
export type DetectorId = Extract<
  SignalKind,
  "breached_password" | "impossible_travel" | "new_country" | "credential_stuffing"
>;

export const DETECTOR_IDS: readonly DetectorId[] = [
  "breached_password",
  "impossible_travel",
  "new_country",
  "credential_stuffing",
];

/**
 * What a sign-in does when a rule fires on it.
 *
 * `step_up` is the strongest one offered and it is deliberately not "block". Refusing a
 * sign-in on a signal is a lockout by another name, and PROJECT.md 4.5 refuses lockout by
 * default because it is a denial-of-service against the victim: an attacker who can make
 * the signal fire can lock anybody out. A challenge costs the real owner one code and
 * costs an attacker the account.
 *
 * None of the three renders anything. A step-up is the sign-in answering with a challenge
 * for the customer's own screen to complete (ADR-0010), and a notice is an email we send
 * on their behalf. We ship no UI (ADR-0002), so a rule that read as "show a warning page"
 * would have a customer ship nothing at all.
 */
export type SignalResponse = "record" | "notify" | "step_up";

export const SIGNAL_RESPONSES: readonly SignalResponse[] = ["record", "notify", "step_up"];

export const RESPONSE_LABELS: Record<SignalResponse, string> = {
  record: "Record it",
  notify: "Email the account",
  step_up: "Ask for a second factor",
};

export const RESPONSE_NOTES: Record<SignalResponse, string> = {
  record: "The row appears here and in the audit log. The sign-in is unaffected.",
  notify: 'A "new sign-in from..." notice to the address on the account, sent by us.',
  step_up:
    "The sign-in answers with a challenge instead of a session, and your own screen completes it. An account with nothing enrolled is let through, because a challenge nobody can answer is a sign-in that cannot be finished.",
};

export interface DetectorRule {
  enabled: boolean;
  response: SignalResponse;
}

export interface SecuritySettings {
  rules: Record<DetectorId, DetectorRule>;
  /**
   * Above this, a hop is called impossible. Commercial cruise is about 900 km/h and the
   * default sits above it, so a real flight plus an hour in an airport does not fire.
   */
  travelSpeedKmh: number;
  /** Refusals from one address, across accounts, in an hour before it reads as a list. */
  stuffingRefusals: number;
  /** How long a signal is kept after it is seen. Independent of the session it came from. */
  retentionDays: number;
}

export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  rules: {
    breached_password: { enabled: true, response: "notify" },
    impossible_travel: { enabled: true, response: "step_up" },
    new_country: { enabled: true, response: "record" },
    credential_stuffing: { enabled: true, response: "record" },
  },
  travelSpeedKmh: 1000,
  stuffingRefusals: 40,
  retentionDays: 90,
};

export const TRAVEL_SPEED_MIN = 400;
export const TRAVEL_SPEED_MAX = 5000;
export const STUFFING_REFUSALS_MIN = 5;
export const STUFFING_REFUSALS_MAX = 500;
export const SIGNAL_RETENTION_MIN = 7;
export const SIGNAL_RETENTION_MAX = 365;

export const SECURITY_ISSUE = {
  travelRange: `Between ${TRAVEL_SPEED_MIN} and ${TRAVEL_SPEED_MAX} km/h.`,
  travelInteger: "A whole number of km/h.",
  stuffingRange: `Between ${STUFFING_REFUSALS_MIN} and ${STUFFING_REFUSALS_MAX} refusals.`,
  stuffingInteger: "A whole number of refusals.",
  retentionRange: `Between ${SIGNAL_RETENTION_MIN} and ${SIGNAL_RETENTION_MAX} days.`,
  retentionInteger: "A whole number of days.",
} as const;

/**
 * How the breach check works, from PROJECT.md 4.5.
 *
 * The last field is the one the screen exists to state. Passwords are Argon2id with a
 * pepper in KMS, so there is nothing to sweep: we can tell a customer which password was
 * offered and refused, never which of their existing accounts is holding a breached one.
 * "Scan my users" is impossible by construction rather than unbuilt, and a customer who
 * does not know that reads an empty list as a clean estate.
 */
export const BREACH_CHECK = {
  corpus: "Have I Been Pwned",
  api: "range API",
  algorithm: "SHA-1",
  /** Hex characters of the digest that leave us. The rest is compared here. */
  prefixLength: 5,
  /** Where it runs without any rule being set. Sign-in is the one that is a choice. */
  always: "sign-up and reset",
  sweepable: false,
} as const;

/*
 * The attack dashboard.
 */

/** Why a sign-in was refused, in the order the chart stacks them. */
export type RefusalReason =
  | "wrong_password"
  | "unknown_account"
  | "rate_limited"
  | "breached_password"
  | "factor_failed";

export const REFUSAL_REASONS: readonly RefusalReason[] = [
  "wrong_password",
  "unknown_account",
  "rate_limited",
  "breached_password",
  "factor_failed",
];

export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  wrong_password: "Wrong password",
  unknown_account: "No such account",
  rate_limited: "Rate limited",
  breached_password: "Breached password",
  factor_failed: "Second factor failed",
};

/**
 * The two reasons a caller cannot tell apart, and neither can this chart's reader without
 * being told. A wrong password and a missing account give one answer and cost one dummy
 * Argon2 hash (PROJECT.md 4.5), so the split here is ours from the inside and is never
 * visible from the outside. A chart that implied otherwise would read as a leak.
 */
export const INDISTINGUISHABLE: readonly RefusalReason[] = ["wrong_password", "unknown_account"];

/*
 * Taking a copy.
 */

/**
 * What is on screen, as CSV. The evidence goes in as the sentence the row showed rather
 * than as its fields, because a file with a column per kind would be five columns empty
 * on every line.
 */
export function signalsCsv(signals: readonly SecuritySignal[]): string {
  const header = [
    "id",
    "kind",
    "severity",
    "state",
    "user_id",
    "seen_at",
    "decided_at",
    "decided_by",
    "dismiss_reason",
    "evidence",
  ];
  const rows = signals.map((signal) =>
    [
      signal.id,
      kindOf(signal),
      severityOf(signal.evidence),
      signal.state,
      signal.userId,
      signal.seenAt,
      signal.decidedAt,
      signal.decidedBy,
      signal.reason,
      describeEvidence(signal.evidence),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

/** A file name that says what it holds and when, so two exports do not collide. */
export function signalsExportName(projectId: string, now: Date): string {
  return `security-signals-${projectId}-${now.toISOString().slice(0, 10)}.csv`;
}

/*
 * What was watching, for a screen with nothing to show.
 */

export type CoverageState = "watching" | "off" | "always";

export const COVERAGE_LABELS: Record<CoverageState, string> = {
  watching: "Watching",
  off: "Off",
  always: "Always on",
};

export interface DetectorCoverage {
  kind: SignalKind;
  label: string;
  icon: string;
  state: CoverageState;
}

/**
 * Every detector and whether it was looking, which is the only thing that makes "nothing
 * recorded" worth reading: a rule somebody switched off produces the same empty screen as
 * a quiet month, and one of those two is not good news.
 *
 * Two of the six are facts rather than settings. A refresh token presented twice and an
 * SMS send the fraud guard refused are recorded whatever a project would prefer, so they
 * are listed as always on instead of being left out of the count.
 */
export function detectorCoverage(rules: Record<DetectorId, DetectorRule>): DetectorCoverage[] {
  return SIGNAL_KINDS.map((kind) => {
    const configurable = (DETECTOR_IDS as readonly SignalKind[]).includes(kind);
    const rule = configurable ? rules[kind as DetectorId] : undefined;
    return {
      kind,
      label: KIND_LABELS[kind],
      icon: KIND_ICONS[kind],
      state: rule === undefined ? "always" : rule.enabled ? "watching" : "off",
    };
  });
}

/** How many of them would record something today. */
export function watchingCount(coverage: readonly DetectorCoverage[]): number {
  return coverage.filter((entry) => entry.state !== "off").length;
}

/*
 * Observed, configured, and enforced.
 *
 * The note's first finding is that this screen offered responses the deployment cannot
 * carry out. A rule that says "ask for a second factor" over a gate that never consults a
 * detector is a protection a customer believes they have, and the only place they will
 * find out otherwise is an incident. So the three states are named separately: what the
 * detector observes, what a project has chosen, and what actually happens today.
 */

export type EnforcementState = "enforced" | "unavailable";

export interface ResponseEnforcement {
  state: EnforcementState;
  /** What happens today, in the reader's words. */
  note: string;
  /** Where the missing half is built or configured, when there is such a place. */
  fix: { label: string; to: string } | null;
}

export const RESPONSE_ENFORCEMENT: Record<SignalResponse, ResponseEnforcement> = {
  record: {
    state: "enforced",
    note: "The row is written here and in the audit log. Nothing else happens, and the sign-in is unaffected.",
    fix: null,
  },
  notify: {
    state: "unavailable",
    note: "Nothing sends a notice from a detector yet: there is no sign-in notification template and no path from a rule to the mail pipeline. A rule set to this records the signal and sends nothing.",
    fix: { label: "Email templates", to: "/email/templates" },
  },
  step_up: {
    state: "unavailable",
    note: "The MFA gate answers a sign-in with a challenge where an account owes one, but nothing raises a challenge from a detector: a rule cannot reach that decision today. A rule set to this records the signal and the sign-in completes as it would have.",
    fix: { label: "Additional verification", to: "/mfa/step-up" },
  },
};

/** Whether a project may choose that response and have it mean something. */
export function responseAvailable(response: SignalResponse): boolean {
  return RESPONSE_ENFORCEMENT[response].state === "enforced";
}

/**
 * What actually happens when the rule fires, whatever it is set to.
 *
 * A configured response the deployment cannot carry out degrades to recording, because
 * that is what the code does; the screen says so beside the setting rather than leaving
 * the setting to be read as the behaviour.
 */
export function enforcedResponse(configured: SignalResponse): SignalResponse {
  return responseAvailable(configured) ? configured : "record";
}

export interface DetectorStatus {
  kind: SignalKind;
  label: string;
  icon: string;
  /** Whether the detector is looking at all. Two of the six always are. */
  observed: boolean;
  /** Null for the two that are facts rather than settings. */
  configured: SignalResponse | null;
  enforced: SignalResponse;
  /** Whether what is configured and what happens are the same thing. */
  matches: boolean;
}

/** Every detector, with the three states the note asks to be kept apart. */
export function detectorStatuses(rules: Record<DetectorId, DetectorRule>): DetectorStatus[] {
  return SIGNAL_KINDS.map((kind) => {
    const configurable = (DETECTOR_IDS as readonly SignalKind[]).includes(kind);
    const rule = configurable ? rules[kind as DetectorId] : undefined;
    const configured = rule?.response ?? null;
    const enforced = configured === null ? "record" : enforcedResponse(configured);
    return {
      kind,
      label: KIND_LABELS[kind],
      icon: KIND_ICONS[kind],
      observed: rule === undefined ? true : rule.enabled,
      configured,
      enforced,
      matches: configured === null || configured === enforced,
    };
  });
}

/** How many rules are set to something the deployment cannot carry out. */
export function unenforcedCount(statuses: readonly DetectorStatus[]): number {
  return statuses.filter((status) => status.observed && !status.matches).length;
}

/*
 * What a sign-in actually answers with.
 *
 * Mirrored from `authOutcomeSchema` in `@idenzy/protocol/schemas/mfa` rather than imported,
 * for the reason `keys.ts` writes out the key kinds: the panel takes no dependency on that
 * package until the management API client does. The values matter because a developer
 * copies this: the union discriminates on `status` between `authenticated` and
 * `mfa_required` (ADR-0010), and there is no `challenge` and no `reason` field. The screen
 * said otherwise, and a client branching on the wrong literal fails on the one path this
 * screen exists to describe (notes/security.md P1).
 */
export const AUTH_OUTCOME_STATUSES = ["authenticated", "mfa_required"] as const;

export const MFA_REQUIRED_SAMPLE: readonly { name: string; value: string }[] = [
  { name: "status", value: '"mfa_required"' },
  { name: "challengeId", value: '"mfc_8f2c41a83e7b"' },
  { name: "purpose", value: '"sign_in"' },
  { name: "factors", value: '["totp", "passkey"]' },
  { name: "expiresAt", value: '"2026-09-11T14:05:00.000Z"' },
];

/*
 * The defences nobody configures, and which of them this deployment actually has.
 *
 * "Always" over infrastructure that is designed and not provisioned is the same claim the
 * vendor states on the SMS screen were making: unfalsifiable from the panel, and only
 * discovered during the incident it was supposed to cover (notes/security.md P1).
 */
export interface DeploymentDefence {
  id: string;
  label: string;
  state: EnforcementState;
  detail: string;
}

export const DEPLOYMENT_DEFENCES: readonly DeploymentDefence[] = [
  {
    id: "waf",
    label: "Edge rate limits and WAF",
    state: "unavailable",
    detail:
      "Cloud Armor at the edge with the OWASP rule set, per-address and per-project limits and adaptive protection for a layer-seven flood. It is the design and it is not provisioned on this deployment, so nothing is refused before a request reaches the application yet.",
  },
  {
    id: "app_limits",
    label: "Application rate limits",
    state: "enforced",
    detail:
      "Per identifier, per address, per project and per endpoint, in Valkey, with exponential backoff. Sign-in fails open when the store is unreachable, so an outage is not a lockout; the SMS path fails closed for the opposite reason, because there the cost of allowing what we could not count is an invoice.",
  },
  {
    id: "one_answer",
    label: "One answer for a guess",
    state: "enforced",
    detail:
      "A wrong password and an address with no account give one answer and cost the same Argon2 work, on a dummy hash where there is no user. It is why the refusal chart splits them and the API never will.",
  },
  {
    id: "reuse",
    label: "Refresh token reuse revokes the family",
    state: "enforced",
    detail:
      "A refresh token presented twice ends every session descended from it (ADR-0007). The row here is a record of something already finished rather than a question, which is why it is never marked act now.",
  },
];
