/**
 * Every clock in the project: how long each credential lives, which three a project
 * moves, and what moving them costs.
 *
 * The numbers are `packages/config/src/schema.ts` as a fresh deployment ships them and
 * the bounds are that file's own, because a screen that invented either would offer an
 * operator a lifetime the server refuses at boot. The consequences below are arithmetic
 * over those numbers rather than prose about them: an access-token lifetime decides how
 * often a client refreshes, how long a revoked session keeps working and how long a
 * suspended account does, and all three are worth showing beside the control that sets
 * it rather than in a paragraph underneath.
 *
 * The step-up window is deliberately not here. It is one number the step-up screen owns
 * (`~/utils/step-up`), so this screen reads it from the same store and the two cannot
 * disagree about what it is.
 *
 * Seconds throughout, because that is the unit every one of these is stored and sent in.
 * `DURATIONS` in `./time` is milliseconds and is for clock arithmetic, not for this.
 */
import { humanizeSeconds } from "./otp";

/** The units, in seconds, so nothing below multiplies out a magic number. */
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * What a project decides.
 */

export interface LifetimeSettings {
  /** `ACCESS_TOKEN_TTL_SECONDS`. The one number with a cost on both sides. */
  accessTokenSeconds: number;
  /** `SESSION_IDLE_TTL_SECONDS`. Slides forward on every rotation. */
  idleSeconds: number;
  /** `SESSION_ABSOLUTE_TTL_SECONDS`. Set at sign-in and never moved again. */
  absoluteSeconds: number;
}

/** A fresh deployment, and what the placeholder sessions were generated against. */
export const DEFAULT_LIFETIME_SETTINGS: LifetimeSettings = {
  accessTokenSeconds: 5 * MINUTE,
  idleSeconds: 14 * DAY,
  absoluteSeconds: 90 * DAY,
};

/**
 * The access token's bounds, and they are a decision rather than a range somebody liked.
 * Below a minute the refresh traffic stops paying for itself; above an hour the
 * revocation latency stops being defensible (PROJECT.md 4.2).
 */
export const ACCESS_TOKEN_FLOOR_SECONDS = MINUTE;
export const ACCESS_TOKEN_CEILING_SECONDS = HOUR;

/** Reissued with its own lifetime on every rotation. Fixed for the deployment today. */
export const REFRESH_TOKEN_SECONDS = 30 * DAY;

/*
 * The choices each control offers. Five and four, because a segmented control is read at
 * a glance and a dozen options is a select in disguise.
 */
export const ACCESS_TOKEN_CHOICES: readonly number[] = [
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
];

export const IDLE_CHOICES: readonly number[] = [DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY];

export const ABSOLUTE_CHOICES: readonly number[] = [30 * DAY, 90 * DAY, 180 * DAY, 365 * DAY];

/**
 * An idle window past the maximum lifetime never fires, so it is not offered rather than
 * accepted and quietly ignored. Same reasoning as refusing cookie mode where it cannot
 * work: a setting that is stored and has no effect looks exactly like one that does.
 */
export function isIdleOffered(idleSeconds: number, absoluteSeconds: number): boolean {
  return idleSeconds <= absoluteSeconds;
}

/** The mirror of the rule above, for the control that sets the other end. */
export function isAbsoluteOffered(absoluteSeconds: number, idleSeconds: number): boolean {
  return absoluteSeconds >= idleSeconds;
}

/*
 * What the access-token lifetime costs, in the three directions it costs anything.
 */

/**
 * Hours of active use a month, the figure PROJECT.md 5 prices the platform on. A refresh
 * happens when a token expires while somebody is still using the application, so this is
 * what turns a lifetime into a request count.
 */
export const ACTIVE_SECONDS_PER_MONTH = 12 * HOUR;

/** Refreshes one active user costs a month at this lifetime. 5 minutes is roughly 150. */
export function refreshesPerActiveUser(accessTokenSeconds: number): number {
  return Math.round(ACTIVE_SECONDS_PER_MONTH / accessTokenSeconds);
}

/** `REVOCATION_SKEW_SECONDS` in the auth API: what a snapshot holds past one lifetime. */
export const REVOCATION_SKEW_SECONDS = MINUTE;

/** `@idenzy/node`'s default poll, and so the window a verifier that holds a set is in. */
export const REVOCATION_POLL_SECONDS = 5;

/**
 * How long the published set has to keep an entry: one access-token lifetime plus the
 * skew. A token minted immediately before a revocation expires one lifetime later, so
 * nothing older can still be presented, and that bound is the only reason the set is
 * small enough to publish whole (ADR-0009).
 */
export function snapshotRetentionSeconds(accessTokenSeconds: number): number {
  return accessTokenSeconds + REVOCATION_SKEW_SECONDS;
}

/**
 * The worst case between revoking a session and the customer's own verifier refusing it.
 * Without a revocation set that is the whole token lifetime, because verification is
 * offline on purpose; with one it is the poll, and the lifetime stops deciding it.
 */
export function revocationWindowSeconds(accessTokenSeconds: number, polling: boolean): number {
  return polling ? REVOCATION_POLL_SECONDS : accessTokenSeconds;
}

/*
 * What ends a session.
 */

export type SessionClock = "idle" | "absolute" | "refresh";

export const SESSION_CLOCK_LABELS: Record<SessionClock, string> = {
  idle: "the idle timeout",
  absolute: "the maximum lifetime",
  refresh: "the refresh token's own expiry",
};

export interface SessionEnd {
  clock: SessionClock;
  seconds: number;
}

/**
 * What ends a session nobody comes back to: whichever of the three clocks falls first.
 *
 * The refresh token is one of the three because it is reissued with its own lifetime on
 * every rotation, so a token lifetime shorter than the idle window is what actually ends
 * the session and a screen naming the idle timeout would promise days the session never
 * gets. A tie is named in the order idle, absolute, refresh, which is the order a sweeper
 * writes the reason down in.
 */
export function untouchedEnd(settings: LifetimeSettings): SessionEnd {
  const candidates: readonly SessionEnd[] = [
    { clock: "idle", seconds: settings.idleSeconds },
    { clock: "absolute", seconds: settings.absoluteSeconds },
    { clock: "refresh", seconds: REFRESH_TOKEN_SECONDS },
  ];
  return candidates.reduce((first, next) => (next.seconds < first.seconds ? next : first));
}

/**
 * What ends a session somebody keeps using. Always the maximum lifetime: the idle window
 * slides on every rotation and the refresh token is reissued with it, so the one clock
 * that cannot be pushed forward is the one set at sign-in.
 */
export function heldOpenEnd(settings: LifetimeSettings): SessionEnd {
  return { clock: "absolute", seconds: settings.absoluteSeconds };
}

/*
 * The clocks a project does not decide.
 */

export type ClockGroup = "challenge" | "handoff" | "mail";

export interface FixedClock {
  id: string;
  label: string;
  seconds: number;
  /** The most the config schema accepts, where it caps one. Null where it does not. */
  capSeconds: number | null;
  group: ClockGroup;
  /** Why it is the length it is, which is the only question a fixed row raises. */
  note: string;
}

export const CLOCK_GROUP_LABELS: Record<ClockGroup, string> = {
  challenge: "Waiting on a person",
  handoff: "Between two of our own steps",
  mail: "A link in a mailbox",
};

export const FIXED_CLOCKS: readonly FixedClock[] = [
  {
    id: "otp",
    label: "One-time code",
    seconds: 10 * MINUTE,
    capSeconds: HOUR,
    group: "challenge",
    note: "Short enough that a code sitting in a mailbox somebody else can read is usually already dead, long enough to survive a slow mail hop. Five attempts, and the code is an Argon2id hash at rest rather than a digest, because a million six-digit candidates fall to an offline sweep the moment that table leaks.",
  },
  {
    id: "magic-link",
    label: "Magic link",
    seconds: 10 * MINUTE,
    capSeconds: HOUR,
    group: "challenge",
    note: "The same window as the code it is an alternative to, and single use. A 256-bit random token, so SHA-256 is enough: there is nothing here for a sweep to guess at.",
  },
  {
    id: "webauthn",
    label: "Passkey challenge",
    seconds: 5 * MINUTE,
    capSeconds: 15 * MINUTE,
    group: "challenge",
    note: "Longer than a one-time code because the user may have to find a phone or a security key, and it is a nonce rather than a secret in a mailbox. Claimed before anything is verified, so a challenge an attacker keeps signing against is already spent.",
  },
  {
    id: "mfa-challenge",
    label: "Second-factor challenge",
    seconds: 5 * MINUTE,
    capSeconds: 15 * MINUTE,
    group: "challenge",
    note: "How long a proved first factor waits for a second. Longer than one authenticator step on purpose, so a code typed just as the step rolls over can be retyped rather than refused.",
  },
  {
    id: "auth-code",
    label: "Exchange code",
    seconds: 2 * MINUTE,
    capSeconds: 10 * MINUTE,
    group: "handoff",
    note: "Lives between our redirect and the SDK's POST, which is one page load. Generous at two minutes and should never need raising. A failed check leaves it spent, because the whole point of the check is that the code does not survive it.",
  },
  {
    id: "oauth-flow",
    label: "OAuth round trip",
    seconds: 10 * MINUTE,
    capSeconds: 30 * MINUTE,
    group: "handoff",
    note: "How long a user has between leaving for a provider and coming back. Long enough for a consent screen, a password manager and a second factor; short enough that an abandoned flow is not a live state value sitting in a table for an hour.",
  },
  {
    id: "password-reset",
    label: "Password reset",
    seconds: 15 * MINUTE,
    capSeconds: HOUR,
    group: "mail",
    note: "Single use, hashed at rest, and issuing one invalidates every other reset token for the account. Shorter than the two below because a reset link is the one piece of mail that is a way in on its own.",
  },
  {
    id: "email-verification",
    label: "Address verification",
    seconds: DAY,
    capSeconds: null,
    group: "mail",
    note: "A day, because this one is often opened on a different device from the one that asked for it, and a link that died over lunch is a support ticket rather than a security win.",
  },
  {
    id: "email-change",
    label: "Address change",
    seconds: DAY,
    capSeconds: null,
    group: "mail",
    note: "Longer than the others because two people have to act: the address is not moved until the old address and the new one have both confirmed, and the old one is often read less often.",
  },
];

/*
 * The span the screen covers, which is what the fixed clocks are checked against: a
 * lifetime outside it is one nothing on this screen has a group for.
 */

export const SHORTEST_CLOCK_SECONDS = MINUTE;
export const LONGEST_CLOCK_SECONDS = 365 * DAY;

/**
 * The ends of a set of choices, which is what the list writes beside a clock this screen
 * moves. Read off the choices a control actually offers rather than stated beside them,
 * so the list cannot promise a lifetime the control refuses.
 */
export function choiceRange(choices: readonly number[]): {
  minSeconds: number;
  maxSeconds: number;
} {
  const ordered = [...choices].sort((first, next) => first - next);
  return {
    minSeconds: ordered[0] ?? SHORTEST_CLOCK_SECONDS,
    maxSeconds: ordered[ordered.length - 1] ?? LONGEST_CLOCK_SECONDS,
  };
}

/*
 * Writing a duration.
 */

const UNITS: readonly { seconds: number; suffix: string; word: string }[] = [
  { seconds: DAY, suffix: "d", word: "day" },
  { seconds: HOUR, suffix: "h", word: "hour" },
  { seconds: MINUTE, suffix: "min", word: "minute" },
  { seconds: 1, suffix: "s", word: "second" },
];

/** The largest unit a duration divides into whole, which is the unit a person names it in. */
function largestWholeUnit(seconds: number) {
  return (
    UNITS.find((candidate) => seconds >= candidate.seconds && seconds % candidate.seconds === 0) ??
    UNITS[UNITS.length - 1]
  );
}

export interface DurationChoice {
  value: string;
  label: string;
}

/**
 * A set of choices written in one unit, because a row of segments is read against itself
 * and "1 h" beside "30 min" makes the reader do arithmetic to see which is longer. The
 * unit is the largest that writes every member of the set as a whole number.
 *
 * The other voice for a duration is `humanizeSeconds`, which writes one as a sentence
 * does. This one is for a control and a figure; that one is for prose.
 */
export function durationChoices(choices: readonly number[]): DurationChoice[] {
  const unit =
    UNITS.find((candidate) => choices.every((seconds) => seconds % candidate.seconds === 0)) ??
    UNITS[UNITS.length - 1];
  const size = unit?.seconds ?? 1;
  const suffix = unit?.suffix ?? "s";
  return choices.map((seconds) => ({
    value: String(seconds),
    label: `${seconds / size} ${suffix}`,
  }));
}

/** One duration in the compact voice, for a figure beside a name: "5 min", "14 d". */
export function shortDuration(seconds: number): string {
  const unit = largestWholeUnit(seconds);
  const size = unit?.seconds ?? 1;
  return `${Math.round(seconds / size)} ${unit?.suffix ?? "s"}`;
}

/**
 * A range written in one unit, because its two ends are read against each other: "1 min
 * to 60 min" rather than "1 min to 1 h", which asks the reader to do the arithmetic.
 */
export function rangeWords(minSeconds: number, maxSeconds: number): string {
  const [from, to] = durationChoices([minSeconds, maxSeconds]);
  return `${from?.label ?? ""} to ${to?.label ?? ""}`;
}

/**
 * `humanizeSeconds` split at its space, for a figure whose unit is set beside it at the
 * size of the label rather than in the mono face. One voice, two pieces: a mono space is
 * as wide as a digit, so "14 d" set as one run reads with a hole in it.
 */
export function durationParts(seconds: number): { digits: string; unit: string } {
  const [digits = "", ...rest] = humanizeSeconds(seconds).split(" ");
  return { digits, unit: rest.join(" ") };
}

/**
 * `shortDuration` split at its space, for a column of figures. Right-aligning "1 min"
 * against "30 d" as one run lines the units up and leaves the digits ragged, which is
 * backwards: the digits are what a reader scans down.
 */
export function shortDurationParts(seconds: number): { digits: string; unit: string } {
  const [digits = "", unit = ""] = shortDuration(seconds).split(" ");
  return { digits, unit };
}
