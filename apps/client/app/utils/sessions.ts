/**
 * A project's sessions as the panel sees them, and the pure logic the sessions screen
 * runs over them: which state a session is in, when and why it ends, what a user agent
 * will admit to, and which rows a search or a filter keeps.
 *
 * The shape follows the `sessions` table in `@idenzy/persistence` and the wire's
 * `sessionSummarySchema`, plus the one thing a project-wide list needs that a user's own
 * "your devices" does not: which account each row belongs to. No token material appears
 * here, which is the promise that schema makes too, and the refresh token is present
 * only as the fact that one is bound to a device key (PROJECT.md 4.4).
 *
 * `SignInFactor` and `RevokeReason` mirror `AuthMethod` and `SessionRevokeReason` in
 * `@idenzy/protocol`. They are written out rather than imported for the same reason
 * `SignInMethod` is in `users.ts`: the panel takes no dependency on the package until
 * the management API client does, and then both come from the one place.
 *
 * Everything here that `users.ts` also has a word for carries the noun: `sessionStatus`
 * beside its `statusOf`, `EMPTY_SESSION_FILTERS` beside its `EMPTY_FILTERS`. Nuxt
 * auto-imports every module under `app/utils`, so two exports of one name are one
 * export and a warning, and the loser is silently the wrong function. Same reason
 * `prefixComposables` settles `useLayout` in nuxt.config.ts.
 */

import { anyOf, csvCell, type TimeWindow, type Tristate, tristate, within } from "./filters";
import type { Named } from "./users";

export type SessionStatus = "active" | "expired" | "revoked";

export type SignInFactor =
  | "pwd"
  | "otp_email"
  | "otp_sms"
  | "otp_whatsapp"
  | "link"
  | "webauthn"
  | "totp"
  | "mfa"
  | "recovery"
  | "oauth"
  | "id_token"
  | "anon"
  | "custom";

export type RevokeReason =
  | "signed_out"
  | "signed_out_everywhere"
  | "password_changed"
  | "refresh_token_reuse"
  | "admin_revoked"
  | "user_deleted"
  | "idle_timeout"
  | "absolute_timeout";

/** The part of an account a session row shows. Satisfied by a whole `ProjectUser`. */
export interface SessionUser extends Named {
  id: string;
  avatarUrl: string | null;
  deletedAt: string | null;
}

export interface ProjectSession {
  /** The public id, `ses_` and an opaque body, as every API surface names a session. */
  id: string;
  projectId: string;
  userId: string;
  /** Stable across sign-ins where the client sets one. A browser that does not has null. */
  deviceId: string | null;
  /**
   * The client's own label for the device. Free text a person often puts their own name
   * in, so it is personal data and never a security decision: it names a row and decides
   * nothing about it.
   */
  deviceName: string | null;
  ip: string | null;
  /** What the address resolves to. Null where nothing answered. */
  network: NetworkIntel | null;
  userAgent: string | null;
  /** What was proved at sign-in, as the access token's `amr` claim carries it. */
  amr: readonly SignInFactor[];
  /** When a second factor was last proved. Backs `fva`, so a step-up check reads it. */
  factorVerifiedAt: string | null;
  /** The refresh token is bound to a device key, so possession is proved on rotation. */
  deviceBound: boolean;
  lastActiveAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  revokedAt: string | null;
  revokeReason: RevokeReason | null;
  createdAt: string;
}

/**
 * What an IP intelligence lookup said about the address the session came from.
 *
 * Not columns on `sessions`, and the shape says why: this is a lookup over `ip` the
 * management API does when the list is read, so it reports what the address is now. An
 * address that is a VPN exit today was a residential line last month, and freezing that
 * judgement into a row would make an old session's label quietly wrong. Wanting the
 * verdict as it stood at sign-in is a different thing and a real column, which means a
 * migration and a `classified()` declaration rather than a change here.
 *
 * The three flags are booleans because the whole object is nullable: null is "nothing
 * answered", which is not the same as "nothing found" and must never draw as it. That
 * distinction is the reason this is one nullable object rather than three nullable
 * booleans nobody would keep in step.
 */
export interface NetworkIntel {
  /** ISO 3166-1 alpha-2. Null where the address could not be placed. */
  country: string | null;
  vpn: boolean;
  proxy: boolean;
  tor: boolean;
}

/** A session with the account it belongs to joined on, which is what the screen lists. */
export interface SessionRow extends ProjectSession {
  user: SessionUser;
}

/**
 * Which of the two expiries a live session dies of, and when. Both are enforced and
 * configurable (PROJECT.md 4.2), and whichever falls first is the one that ends it, so
 * a column showing only the absolute lifetime would promise a session days it will not
 * get. ISO 8601 in a fixed offset orders as text, which is how the API sends it.
 */
export function endsAt(session: ProjectSession): { at: string; cause: "idle" | "absolute" } {
  return session.idleExpiresAt <= session.absoluteExpiresAt
    ? { at: session.idleExpiresAt, cause: "idle" }
    : { at: session.absoluteExpiresAt, cause: "absolute" };
}

/**
 * A session is ended by a revocation or by lapsing, and the reason decides which of the
 * two it reads as rather than which column carries a timestamp. A sweeper writing
 * `idle_timeout` into `revoked_at` must not move a row out of the expired tab and into
 * the revoked one: nothing about what ended the session changed, only who wrote it down.
 *
 * Expiry is derived and not trusted for the mirror-image reason: a session whose idle
 * window closed a minute ago is already dead, and no sweeper has been past yet.
 */
export function sessionStatus(session: ProjectSession, now: Date): SessionStatus {
  if (session.revokeReason === "idle_timeout" || session.revokeReason === "absolute_timeout") {
    return "expired";
  }
  if (session.revokedAt !== null) return "revoked";
  return new Date(endsAt(session).at).getTime() <= now.getTime() ? "expired" : "active";
}

/**
 * Why a session ended, whether or not anything has written it down yet. A lapsed session
 * with nothing on the row is named by the expiry it hit, so the badge and the filter
 * agree with `sessionStatus` rather than with whichever sweeper has run.
 */
export function endedBy(session: ProjectSession, now: Date): RevokeReason | null {
  if (session.revokeReason !== null) return session.revokeReason;
  if (session.revokedAt !== null || sessionStatus(session, now) === "active") return null;
  return endsAt(session).cause === "idle" ? "idle_timeout" : "absolute_timeout";
}

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

/** For sorting a status column: the states in the order a reader wants them grouped. */
export const SESSION_STATUS_RANK: Record<SessionStatus, number> = {
  active: 0,
  expired: 1,
  revoked: 2,
};

export const REASON_LABELS: Record<RevokeReason, string> = {
  signed_out: "Signed out",
  signed_out_everywhere: "Signed out everywhere",
  password_changed: "Password changed",
  refresh_token_reuse: "Refresh token reuse",
  admin_revoked: "Revoked from the dashboard",
  user_deleted: "User deleted",
  idle_timeout: "Idle timeout",
  absolute_timeout: "Maximum lifetime",
};

/** Every reason, in the order the filter lists them: what somebody did, then what lapsed. */
export const REVOKE_REASONS: readonly RevokeReason[] = [
  "signed_out",
  "signed_out_everywhere",
  "password_changed",
  "refresh_token_reuse",
  "admin_revoked",
  "user_deleted",
  "idle_timeout",
  "absolute_timeout",
];

/** The one reason that is an attack rather than a decision, and is coloured as one. */
export function isSecurityEvent(reason: RevokeReason | null): boolean {
  return reason === "refresh_token_reuse";
}

export const FACTOR_LABELS: Record<SignInFactor, string> = {
  pwd: "Password",
  otp_email: "Email code",
  otp_sms: "SMS code",
  otp_whatsapp: "WhatsApp code",
  link: "Magic link",
  webauthn: "Passkey",
  totp: "Authenticator",
  mfa: "Two factors proved",
  recovery: "Recovery code",
  oauth: "Social provider",
  id_token: "ID token exchange",
  anon: "Anonymous",
  custom: "Custom token",
};

/** A glyph per factor, written out so @nuxt/icon bundles it. */
export const FACTOR_ICONS: Record<SignInFactor, string> = {
  pwd: "material-symbols:password",
  otp_email: "material-symbols:mail-outline",
  otp_sms: "material-symbols:sms-outline",
  otp_whatsapp: "material-symbols:chat-outline",
  link: "material-symbols:link",
  webauthn: "material-symbols:passkey",
  totp: "material-symbols:timer-outline",
  mfa: "material-symbols:shield-lock-outline",
  recovery: "material-symbols:key-outline",
  oauth: "material-symbols:login",
  id_token: "material-symbols:swap-horiz",
  anon: "material-symbols:visibility-off-outline",
  custom: "material-symbols:code",
};

/** Every factor, in the order the filter lists them. */
export const SIGN_IN_FACTORS: readonly SignInFactor[] = [
  "pwd",
  "webauthn",
  "otp_email",
  "otp_sms",
  "otp_whatsapp",
  "link",
  "oauth",
  "totp",
  "mfa",
  "recovery",
  "id_token",
  "anon",
  "custom",
];

export type DeviceForm = "desktop" | "mobile" | "tablet" | "unknown";

export const FORM_LABELS: Record<DeviceForm, string> = {
  desktop: "Desktop",
  mobile: "Phone",
  tablet: "Tablet",
  unknown: "Unknown",
};

/**
 * Two shapes and a catch-all, written out so @nuxt/icon bundles them. A phone and a
 * screen are the two forms worth drawing apart at a glance; a tablet is neither and
 * shares the mark with a client we could not place, because the row's second line and
 * the tooltip already say which it is and a third silhouette at 14px says nothing.
 */
export const FORM_ICONS: Record<DeviceForm, string> = {
  desktop: "lucide:monitor",
  mobile: "lucide:smartphone",
  tablet: "material-symbols:devices-other-outline-rounded",
  unknown: "material-symbols:devices-other-outline-rounded",
};

/**
 * The colour a device's glyph is tinted, by the platform its user agent reports.
 *
 * A second signal over the same evidence, never a new claim: it says exactly what the
 * line under the name says, so a reader who cannot tell the colours apart loses nothing,
 * and a client we could not place gets no colour at all rather than a wrong one. Which
 * makes the absence of colour meaningful too, and it agrees with `describeAgent`.
 *
 * The values, and why Apple's two share one, are in theme.css.
 */
export const PLATFORM_TONES: Record<string, string> = {
  Windows: "text-platform-windows",
  macOS: "text-platform-apple",
  iOS: "text-platform-apple",
  Android: "text-platform-android",
  ChromeOS: "text-platform-chrome",
  Linux: "text-platform-linux",
};

/** Falls back to the muted ink, which is what an unreadable user agent gets. */
export function platformTone(os: string | null): string {
  return (os === null ? undefined : PLATFORM_TONES[os]) ?? "text-ink/40";
}

/**
 * What the network column says. `unchecked` is its own answer and not a kind of clean:
 * a lookup that did not come back tells you nothing about the address, and drawing it as
 * "Direct" would invent the one reassurance nobody asked for.
 */
export type NetworkSignal = "tor" | "proxy" | "vpn" | "direct" | "unchecked";

export const NETWORK_LABELS: Record<NetworkSignal, string> = {
  tor: "Tor",
  proxy: "Proxy",
  vpn: "VPN",
  direct: "Direct",
  unchecked: "Unchecked",
};

export const NETWORK_ICONS: Record<NetworkSignal, string> = {
  tor: "material-symbols:privacy-tip-outline",
  proxy: "material-symbols:dns-outline",
  vpn: "material-symbols:vpn-lock-outline",
  direct: "material-symbols:public",
  unchecked: "material-symbols:help-outline",
};

/** The flags an operator filters on, strongest first, which is the order they are read. */
export const NETWORK_SIGNALS: readonly NetworkSignal[] = [
  "tor",
  "proxy",
  "vpn",
  "direct",
  "unchecked",
];

/**
 * The one signal a row is labelled with, strongest first.
 *
 * A column that drew every flag would be three pills wide for the rare address that
 * trips all three, and unreadable for the many that trip none. So the cell names the
 * strongest and its tooltip lists the rest, the export keeps a column per flag, and the
 * filter reads the flags themselves: narrowing to VPN still finds an address that is
 * also a Tor exit.
 */
export function networkSignal(network: NetworkIntel | null): NetworkSignal {
  if (network === null) return "unchecked";
  if (network.tor) return "tor";
  if (network.proxy) return "proxy";
  if (network.vpn) return "vpn";
  return "direct";
}

/** Every flag that is set, for the tooltip the cell carries. Empty when none is. */
export function networkFlags(network: NetworkIntel | null): NetworkSignal[] {
  if (network === null) return [];
  const flags: NetworkSignal[] = [];
  if (network.tor) flags.push("tor");
  if (network.proxy) flags.push("proxy");
  if (network.vpn) flags.push("vpn");
  return flags;
}

/**
 * Whether a signal is one an operator should look twice at. Tor alone, deliberately: a
 * VPN is how a great many people reach the internet from an office or a laptop, and a
 * column that flagged all three would train the reader to ignore the colour.
 */
export function isNetworkConcern(signal: NetworkSignal): boolean {
  return signal === "tor";
}

/* One instance rather than one per cell, and English like every other figure in the
   panel: a table of countries read against itself must not reorder with the reader. */
const REGIONS = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The codes that are not a country. ISO 3166 reserves `ZZ` for "unknown" and providers
 * send it meaning exactly that; CLDR will render it as "Unknown Region", which would sit
 * in a column beside the rows that show nothing and read as a different answer. It is the
 * same answer, so it is given the same one. `XA` and `XB` are CLDR's own test locales and
 * `QO` is "outlying Oceania", none of which places anybody.
 */
const NOT_A_COUNTRY: ReadonlySet<string> = new Set(["ZZ", "XA", "XB", "QO"]);

/**
 * Where a lookup places the address, or null where it does not. The one place a country
 * code is read off the intel, so the cell, the filter, the search and the export cannot
 * disagree about which codes count as an answer.
 */
export function countryOf(network: NetworkIntel | null): string | null {
  const code = network?.country?.toUpperCase() ?? null;
  return code === null || NOT_A_COUNTRY.has(code) ? null : code;
}

/**
 * The flag for an ISO alpha-2 code, as the regional-indicator pair "DE" maps to.
 *
 * Emoji rather than bundled artwork: the icon set is compiled into the panel and a name
 * built at runtime is never found by the scan (see nuxt.config.ts), so flags would mean
 * listing two hundred and fifty of them by hand and carrying the weight of all of them
 * for the five a project ever shows.
 *
 * It is decoration and is drawn as such, because the country's name sits beside it. That
 * is what makes the emoji defensible: Windows ships no flag glyphs, so there it falls
 * back to the two letters of the code, and a reader loses the picture and nothing else.
 * A flag standing alone in place of the name would not survive that.
 */
export function countryFlag(code: string | null): string | null {
  if (code === null || !/^[A-Z]{2}$/.test(code)) return null;
  return String.fromCodePoint(...[...code].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/**
 * "Germany" from "DE". A code no region list knows is handed back as it came rather than
 * dropped, so a table never silently loses an address it was given.
 */
export function countryName(code: string | null): string | null {
  if (code === null) return null;
  try {
    return REGIONS.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * What the country cell means, which is not always where the person is. A Tor circuit
 * exits wherever it exits, so the address places the exit node and nothing else, and the
 * cell has to say so rather than let an operator read it as a location.
 */
export function countryIsExitOnly(network: NetworkIntel | null): boolean {
  return network?.tor === true;
}

export const DEVICE_FORMS: readonly DeviceForm[] = ["desktop", "mobile", "tablet", "unknown"];

export interface AgentDescription {
  browser: string | null;
  os: string | null;
  form: DeviceForm;
}

/** Ordered: the first match wins, so Edge is read before the Chrome it also claims. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

/** Android before Linux, which it also claims, and iOS before the Mac an iPad claims. */
const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/\bWindows NT\b/, "Windows"],
  [/\bAndroid\b/, "Android"],
  [/\b(?:iPhone|iPad|iPod|iOS)\b/, "iOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bMac OS X\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/**
 * Every platform the table above can name. Exported so the tones can be checked against
 * it: a platform added there without a colour would draw in the muted ink of one we
 * could not place, which is the wrong answer told quietly.
 */
export const PLATFORM_NAMES: readonly string[] = PLATFORMS.map(([, name]) => name);

function match(userAgent: string, table: readonly (readonly [RegExp, string])[]): string | null {
  return table.find(([token]) => token.test(userAgent))?.[1] ?? null;
}

function formOf(userAgent: string): DeviceForm {
  if (/\biPad\b/.test(userAgent)) return "tablet";
  if (/\bAndroid\b/.test(userAgent)) return /\bMobile\b/.test(userAgent) ? "mobile" : "tablet";
  if (/\b(?:iPhone|iPod|Mobile)\b/.test(userAgent)) return "mobile";
  if (/\b(?:Windows NT|Mac OS X|CrOS|X11|Linux)\b/.test(userAgent)) return "desktop";
  return "unknown";
}

/**
 * What a user agent will admit to, and nothing beyond it. Every field is null, or the
 * form `unknown`, wherever the string does not say plainly: this sits on a security
 * screen, and a confident wrong answer there is worse than a blank. It is the same
 * reason the server refuses to derive a device name from a user agent, and this derives
 * a description that sits beside the name, never the name itself.
 *
 * It is a hint and reads like one. An iPad has claimed to be a Macintosh since iPadOS 13
 * and is read here as a desktop, which is not a bug to be patched with a longer table:
 * the fix is a client that names its own device, which is what `deviceName` is for.
 */
export function describeAgent(userAgent: string | null): AgentDescription {
  if (userAgent === null || userAgent.trim() === "") {
    return { browser: null, os: null, form: "unknown" };
  }
  return {
    browser: match(userAgent, BROWSERS),
    os: match(userAgent, PLATFORMS),
    form: formOf(userAgent),
  };
}

/**
 * A session ended, stamped the way the repository stamps one: the instant and the reason
 * written together, because a `revoked_at` without a reason is a row nothing can explain.
 */
export function endSession(
  session: ProjectSession,
  reason: RevokeReason,
  at: Date,
): ProjectSession {
  return { ...session, revokedAt: at.toISOString(), revokeReason: reason };
}

/** The sessions still live for one account, which is what a user's session count means. */
export function liveCount(sessions: readonly ProjectSession[], userId: string, now: Date): number {
  return sessions.filter((s) => s.userId === userId && sessionStatus(s, now) === "active").length;
}

/**
 * Ends every named session that is still live, and says whose.
 *
 * A session that has already ended is left exactly as it was rather than restamped: the
 * reason on the row is what an investigation reads, and a second revocation would
 * overwrite "refresh token reuse" with "revoked from the dashboard". The touched accounts
 * come back so a caller can bring their session counts into line without walking the list
 * again.
 */
export function revokeSessions(
  sessions: readonly ProjectSession[],
  ids: readonly string[],
  reason: RevokeReason,
  now: Date,
): { sessions: ProjectSession[]; ended: number; users: string[] } {
  const wanted = new Set(ids);
  const users = new Set<string>();
  let count = 0;
  const next = sessions.map((session) => {
    if (!wanted.has(session.id) || sessionStatus(session, now) !== "active") return session;
    count += 1;
    users.add(session.userId);
    return endSession(session, reason, now);
  });
  return { sessions: next, ended: count, users: [...users] };
}

/** What a screen listing accounts knows about them, which is all reconciling needs. */
export interface AccountState {
  id: string;
  activeSessions: number;
  deletedAt: string | null;
}

/**
 * Sessions brought back into line with what the accounts say about themselves.
 *
 * An erased account keeps none at all: erasure clears every column that names a person
 * (PROJECT.md 4.13.6) and a session row is nothing else, so the row goes and the audit
 * trail keeps the pseudonymous record. An account that says it holds no live session has
 * its live ones ended under the reason a bulk sign-out writes.
 *
 * It only ever removes, never revives, and only where the count is already zero, so
 * writing a count back after a revocation cannot come round again as a second one. An
 * account absent from the list is not spoken for and its sessions are left alone.
 */
export function reconcileSessions(
  sessions: readonly ProjectSession[],
  accounts: readonly AccountState[],
  now: Date,
): ProjectSession[] {
  const known = new Map(accounts.map((account) => [account.id, account]));
  const kept: ProjectSession[] = [];
  for (const session of sessions) {
    const account = known.get(session.userId);
    if (account === undefined) {
      kept.push(session);
      continue;
    }
    if (account.deletedAt !== null) continue;
    const stale = account.activeSessions === 0 && sessionStatus(session, now) === "active";
    kept.push(stale ? endSession(session, "signed_out_everywhere", now) : session);
  }
  return kept;
}

/** "Chrome on macOS", with either half dropped where the string did not say. */
export function agentLine(agent: AgentDescription): string {
  if (agent.browser !== null && agent.os !== null) return `${agent.browser} on ${agent.os}`;
  return agent.browser ?? agent.os ?? "Unrecognised client";
}

/**
 * What the device column calls a row: the client's own label, or that there is none.
 * Never derived from the user agent, because a name is read as a fact and a parsed one
 * is a guess. A client that wants its devices named sends `X-Idenzy-Device-Name`.
 */
export function deviceLabel(session: ProjectSession): string {
  const name = session.deviceName?.trim();
  return name === undefined || name === "" ? "Unnamed device" : name;
}

/**
 * How many devices a list of sessions covers. Sessions sharing a `deviceId` are one
 * device; a session without one is counted as its own, because a client that does not
 * identify its install has given us no way to say two of them are the same machine.
 */
/**
 * The countries a list actually came from, by name, so the filter offers the handful a
 * project sees rather than all two hundred and fifty. Sorted by name, because that is
 * the order they are read in, not the order the codes sort in.
 */
export function countriesIn(sessions: readonly SessionRow[]): { code: string; name: string }[] {
  const codes = new Set<string>();
  for (const session of sessions) {
    const code = countryOf(session.network);
    if (code !== null) codes.add(code);
  }
  return [...codes]
    .map((code) => ({ code, name: countryName(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function countDevices(sessions: readonly SessionRow[]): number {
  const identified = new Set<string>();
  let anonymous = 0;
  for (const session of sessions) {
    if (session.deviceId === null) anonymous += 1;
    else identified.add(session.deviceId);
  }
  return identified.size + anonymous;
}

export interface SessionFilters {
  status: "all" | SessionStatus;
  query: string;
  /** Keep a session that proved any one of these. Empty keeps everything. */
  methods: readonly SignInFactor[];
  /** Whether a second factor was proved in this session. */
  factor: Tristate;
  /** Whether the refresh token is bound to a device key. */
  bound: Tristate;
  forms: readonly DeviceForm[];
  /** What ended the session. Empty keeps everything, live sessions included. */
  reasons: readonly RevokeReason[];
  /**
   * Read against the flags rather than the one label the cell shows, so narrowing to VPN
   * finds an address that is a VPN and a Tor exit both.
   */
  networks: readonly NetworkSignal[];
  /** ISO alpha-2. Structural rather than a search term, because "DE" matches half a table. */
  countries: readonly string[];
  lastActive: TimeWindow;
  started: TimeWindow;
}

export const EMPTY_SESSION_FILTERS: SessionFilters = {
  status: "all",
  query: "",
  methods: [],
  factor: "any",
  bound: "any",
  forms: [],
  reasons: [],
  networks: [],
  countries: [],
  lastActive: "any",
  started: "any",
};

/**
 * How many of the filters behind the Filter button are set. The status tabs and the
 * search box are controls of their own and show their own state, so they are not counted.
 */
export function sessionFilterCount(filters: SessionFilters): number {
  let count = 0;
  if (filters.methods.length > 0) count += 1;
  if (filters.factor !== "any") count += 1;
  if (filters.bound !== "any") count += 1;
  if (filters.forms.length > 0) count += 1;
  if (filters.reasons.length > 0) count += 1;
  if (filters.networks.length > 0) count += 1;
  if (filters.countries.length > 0) count += 1;
  if (filters.lastActive !== "any") count += 1;
  if (filters.started !== "any") count += 1;
  return count;
}

/**
 * Whether a search term names this session. Case-insensitive, over everything an
 * operator is likely to have been handed: an address, an id of either kind, a device
 * name, and the user agent, so a string pasted out of a log finds its row.
 */
export function matchesSessionQuery(session: SessionRow, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term === "") return true;
  const fields = [
    session.deviceName,
    session.ip,
    session.userAgent,
    session.deviceId,
    session.id,
    session.userId,
    session.user.displayName,
    session.user.email,
    countryOf(session.network),
    countryName(countryOf(session.network)),
  ];
  return fields.some((field) => field?.toLowerCase().includes(term) === true);
}

/**
 * Whether a session answers any of the wanted network signals. `direct` and `unchecked`
 * are the label itself, because neither is a flag; the other three are read off the
 * flags, so a Tor exit that is also a VPN is found under either.
 */
function matchesNetwork(
  wanted: readonly NetworkSignal[],
  signal: NetworkSignal,
  network: NetworkIntel | null,
): boolean {
  if (wanted.includes(signal)) return true;
  const flags = networkFlags(network);
  return wanted.some((want) => flags.includes(want));
}

type Keep = (session: SessionRow, filters: SessionFilters, now: Date) => boolean;

/** One rule per filter; a session stays while every rule keeps it. */
const RULES: readonly Keep[] = [
  (session, filters, now) =>
    filters.status === "all" || sessionStatus(session, now) === filters.status,
  (session, filters) => matchesSessionQuery(session, filters.query),
  (session, filters) =>
    filters.methods.length === 0 || filters.methods.some((m) => session.amr.includes(m)),
  (session, filters) => tristate(session.factorVerifiedAt !== null, filters.factor),
  (session, filters) => tristate(session.deviceBound, filters.bound),
  (session, filters) => anyOf(filters.forms, describeAgent(session.userAgent).form),
  (session, filters, now) => anyOf(filters.reasons, endedBy(session, now)),
  // Every flag that is set, not the one the cell shows, plus the two answers that are
  // the absence of a flag: nothing found, and nothing asked.
  (session, filters) =>
    filters.networks.length === 0 ||
    matchesNetwork(filters.networks, networkSignal(session.network), session.network),
  (session, filters) => anyOf(filters.countries, countryOf(session.network)),
  (session, filters, now) => within(session.lastActiveAt, filters.lastActive, now),
  (session, filters, now) => within(session.createdAt, filters.started, now),
];

export function filterSessions(
  sessions: readonly SessionRow[],
  filters: SessionFilters,
  now: Date,
): SessionRow[] {
  return sessions.filter((session) => RULES.every((keep) => keep(session, filters, now)));
}

/** How many sessions sit under each status tab, plus the total the "All" tab shows. */
export function countSessionsByStatus(
  sessions: readonly SessionRow[],
  now: Date,
): Record<"all" | SessionStatus, number> {
  const counts = { all: sessions.length, active: 0, expired: 0, revoked: 0 };
  for (const session of sessions) counts[sessionStatus(session, now)] += 1;
  return counts;
}

/**
 * The list as a file. Every column the table can show, whether or not it is showing,
 * because an export is taken away to be worked on and a hidden column is a preference
 * about a screen rather than a statement about the data. The user agent goes in whole:
 * it is the one field an investigation reads character by character, and the parsed
 * description beside it in the table is only ever a hint.
 */
export function sessionsToCsv(sessions: readonly SessionRow[], now: Date): string {
  const header = [
    "session_id",
    "user_id",
    "user_email",
    "device_name",
    "device_id",
    "device_bound",
    "ip",
    // A column per flag rather than the one label the table shows, and an explicit
    // `network_checked` so a reader of the file can tell "nothing found" from "not asked".
    "country",
    "country_name",
    "network_checked",
    "vpn",
    "proxy",
    "tor",
    "user_agent",
    "browser",
    "os",
    "form",
    "amr",
    "factor_verified_at",
    "status",
    "ended_by",
    "created_at",
    "last_active_at",
    "expires_at",
    "idle_expires_at",
    "absolute_expires_at",
    "revoked_at",
  ];
  const rows = sessions.map((session) => {
    const agent = describeAgent(session.userAgent);
    return [
      session.id,
      session.userId,
      session.user.email,
      session.deviceName,
      session.deviceId,
      session.deviceBound,
      session.ip,
      countryOf(session.network),
      countryName(countryOf(session.network)),
      session.network !== null,
      session.network?.vpn ?? null,
      session.network?.proxy ?? null,
      session.network?.tor ?? null,
      session.userAgent,
      agent.browser,
      agent.os,
      agent.form,
      session.amr.join(" "),
      session.factorVerifiedAt,
      sessionStatus(session, now),
      endedBy(session, now),
      session.createdAt,
      session.lastActiveAt,
      endsAt(session).at,
      session.idleExpiresAt,
      session.absoluteExpiresAt,
      session.revokedAt,
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...rows].join("\r\n");
}

/** A file name that says what it holds and when, so two exports do not collide. */
export function sessionsExportName(projectId: string, now: Date): string {
  return `sessions-${projectId}-${now.toISOString().slice(0, 10)}.csv`;
}
