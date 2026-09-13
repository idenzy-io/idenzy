/**
 * A project's users as the panel sees them, and the pure logic the users screen runs
 * over the list: which state a row is in, which rows a search or a filter keeps, and
 * how the list is written out as a file.
 *
 * The shape follows the `users` table in `@idenzy/persistence` (PROJECT.md 9), minus
 * what a dashboard must never receive: the password hash, its algorithm version and
 * `metadata_private`, which is readable only with a secret key. What is added is what
 * the management API joins in for the screen: the sign-in methods on the account, read
 * off `identities`, `mfa_factors` and `webauthn_credentials`, and a count of sessions
 * still open. Timestamps are ISO strings, as the API sends them, and are compared as
 * strings where they need ordering, which ISO 8601 permits.
 */

import { AUTH_PROVIDERS } from "./auth-providers";
import { csvCell, type TimeWindow, type Tristate, tristate, within } from "./filters";

export type UserStatus = "active" | "suspended" | "deleted";

/**
 * A way into an account, as the API names it.
 *
 * The credential kinds are closed; the provider half is not, because a linked identity is
 * named by its provider and there are eighteen of those with more to come. A union of
 * every one would have to be edited every time a provider is added, and the screen would
 * crash on the first account that used the nineteenth — which is exactly what happened
 * with `magic_link`, so this is a string and `methodIcon` is total.
 */
export type SignInMethod =
  | "password"
  | "passkey"
  | "email_otp"
  | "sms_otp"
  | "magic_link"
  | "anonymous"
  | (string & {});

export interface ProjectUser {
  /** The public id, `usr_` and an opaque body, as every API surface names a user. */
  id: string;
  projectId: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  methods: readonly SignInMethod[];
  /** An authenticator is enrolled, so every password sign-in is challenged (4.7). */
  mfaEnabled: boolean;
  /** Sessions whose refresh token has neither expired nor been revoked. */
  activeSessions: number;
  /** Set while the account is suspended. In the past means the suspension has lapsed. */
  bannedUntil: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** The tombstone marker. A row with one has had its personal columns cleared. */
  deletedAt: string | null;
  metadataPublic: Readonly<Record<string, unknown>>;
}

/**
 * Deleted wins over suspended, because a tombstone never comes back and a suspension
 * lapses on its own: `bannedUntil` in the past is an account that may sign in again,
 * which is what the domain's `User.isBanned` says too.
 */
export function statusOf(user: ProjectUser, now: Date): UserStatus {
  if (user.deletedAt !== null) return "deleted";
  if (user.bannedUntil !== null && new Date(user.bannedUntil).getTime() > now.getTime())
    return "suspended";
  return "active";
}

/** Where suspension never lapses: far enough out that no clock reaches it. */
export const INDEFINITE = "9999-12-31T00:00:00.000Z";

export function isIndefinite(iso: string | null): boolean {
  return iso === INDEFINITE;
}

export const STATUS_LABELS: Record<UserStatus, string> = {
  active: "Active",
  suspended: "Suspended",
  deleted: "Deleted",
};

/** For sorting a status column: the states in the order a reader wants them grouped. */
export const STATUS_RANK: Record<UserStatus, number> = { active: 0, suspended: 1, deleted: 2 };

export const METHOD_LABELS: Record<string, string> = {
  password: "Password",
  passkey: "Passkey",
  email_otp: "Email code",
  sms_otp: "SMS code",
  google: "Google",
  apple: "Apple",
  microsoft: "Microsoft",
  github: "GitHub",
  magic_link: "Magic link",
  anonymous: "Anonymous",
};

/**
 * The name for a method, for any method.
 *
 * Falls back to the provider catalogue, then to the id itself, so a provider added to the
 * API tomorrow reads as its own name here instead of leaving a blank — or, as it did
 * before this was total, taking the render down.
 */
export function methodLabel(method: SignInMethod): string {
  const known = METHOD_LABELS[method];
  if (known !== undefined) return known;
  return AUTH_PROVIDERS.find((entry) => entry.id === method)?.label ?? method;
}

/**
 * A glyph per method, written out so @nuxt/icon bundles it. The providers reuse the
 * marks the sign-in screens use, monochrome flag included, so the two never disagree
 * about what Google looks like.
 */
export const METHOD_ICONS: Record<string, { icon: string; monochrome: boolean }> = {
  password: { icon: "material-symbols:password", monochrome: false },
  passkey: { icon: "material-symbols:passkey", monochrome: false },
  email_otp: { icon: "material-symbols:mail-outline", monochrome: false },
  sms_otp: { icon: "material-symbols:sms-outline", monochrome: false },
  magic_link: { icon: "material-symbols:link", monochrome: false },
  anonymous: { icon: "material-symbols:person-outline", monochrome: false },
};

/**
 * The mark for a method, for any method.
 *
 * Indexing `METHOD_ICONS` directly is what took the Users page down: an account signed in
 * with a magic link produced `undefined`, and reading `.monochrome` off it threw inside a
 * render, which Vue reports as an unhandled render error rather than as a missing icon. A
 * lookup that cannot fail is the fix; a longer record would only move the crash to the
 * next method somebody adds.
 */
export function methodIcon(method: SignInMethod): { icon: string; monochrome: boolean } {
  return METHOD_ICONS[method] ?? providerIcon(method);
}

function providerIcon(id: string): { icon: string; monochrome: boolean } {
  const provider = AUTH_PROVIDERS.find((entry) => entry.id === id);
  return provider
    ? { icon: provider.icon, monochrome: provider.monochrome }
    : { icon: "material-symbols:login", monochrome: false };
}

/** Every method, in the order the filter and the legend list them. */
export const SIGN_IN_METHODS: readonly SignInMethod[] = [
  "password",
  "passkey",
  "email_otp",
  "sms_otp",
  "google",
  "apple",
  "microsoft",
  "github",
];

/**
 * The fields a person is named and pictured by. Narrower than `ProjectUser` so a screen
 * holding only part of an account, as the sessions list does, names them the same way
 * this one does rather than writing its own rule.
 */
export interface Named {
  displayName: string | null;
  email: string | null;
  phone?: string | null;
}

/**
 * What a row is called where one line has to stand for the person. The name when the
 * account has one, then whichever identifier it signs in with; an account with none of
 * the three is anonymous, which the domain's `User.isAnonymous` says the same way.
 */
export function nameOf(user: Named): string {
  return user.displayName ?? user.email ?? user.phone ?? "Anonymous";
}

/** Up to two initials for an avatar with no picture. An address gives its first letter. */
export function initialsOf(user: Named): string {
  if (user.displayName) {
    const parts = user.displayName.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase();
  }
  const handle = user.email ?? user.phone;
  return handle ? (handle[0]?.toUpperCase() ?? "?") : "?";
}

export interface UserFilters {
  status: "all" | UserStatus;
  query: string;
  emailVerified: Tristate;
  mfa: Tristate;
  /** Keep a user who has any one of these. Empty keeps everyone. */
  methods: readonly SignInMethod[];
  created: TimeWindow;
  /** `never` keeps the accounts that have not signed in at all. */
  lastSignIn: TimeWindow | "never";
}

export const EMPTY_FILTERS: UserFilters = {
  status: "all",
  query: "",
  emailVerified: "any",
  mfa: "any",
  methods: [],
  created: "any",
  lastSignIn: "any",
};

/**
 * How many of the filters behind the Filter button are set. The status tabs and the
 * search box are their own controls and show their own state, so they are not counted.
 */
export function activeFilterCount(filters: UserFilters): number {
  let count = 0;
  if (filters.emailVerified !== "any") count += 1;
  if (filters.mfa !== "any") count += 1;
  if (filters.methods.length > 0) count += 1;
  if (filters.created !== "any") count += 1;
  if (filters.lastSignIn !== "any") count += 1;
  return count;
}

/**
 * Whether a search term names this user. Case-insensitive, over the name, the email,
 * the phone and the id, so a support agent can paste whichever they were given. A
 * phone is matched with its punctuation stripped, because it arrives written every way.
 */
export function matchesQuery(user: ProjectUser, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (term === "") return true;
  const digits = term.replace(/[\s()+-]/g, "");
  return (
    (user.displayName?.toLowerCase().includes(term) ?? false) ||
    (user.email?.toLowerCase().includes(term) ?? false) ||
    (digits !== "" && (user.phone?.replace(/[\s()+-]/g, "").includes(digits) ?? false)) ||
    user.id.toLowerCase().includes(term)
  );
}

type Keep = (user: ProjectUser, filters: UserFilters, now: Date) => boolean;

/** One rule per filter; a user stays while every rule keeps them. */
const RULES: readonly Keep[] = [
  (user, filters, now) => filters.status === "all" || statusOf(user, now) === filters.status,
  (user, filters) => matchesQuery(user, filters.query),
  (user, filters) => tristate(user.emailVerified, filters.emailVerified),
  (user, filters) => tristate(user.mfaEnabled, filters.mfa),
  (user, filters) =>
    filters.methods.length === 0 || filters.methods.some((m) => user.methods.includes(m)),
  (user, filters, now) => within(user.createdAt, filters.created, now),
  (user, filters, now) =>
    filters.lastSignIn === "never"
      ? user.lastSignInAt === null
      : within(user.lastSignInAt, filters.lastSignIn, now),
];

export function filterUsers(
  users: readonly ProjectUser[],
  filters: UserFilters,
  now: Date,
): ProjectUser[] {
  return users.filter((user) => RULES.every((keep) => keep(user, filters, now)));
}

/** How many users sit under each status tab, plus the total the "All" tab shows. */
export function countByStatus(
  users: readonly ProjectUser[],
  now: Date,
): Record<"all" | UserStatus, number> {
  const counts = { all: users.length, active: 0, suspended: 0, deleted: 0 };
  for (const user of users) counts[statusOf(user, now)] += 1;
  return counts;
}

/**
 * The list as a file. Every column the table can show, whether or not it is showing,
 * because an export is taken to be worked on elsewhere and a hidden column is a screen
 * preference and not a statement about the data. Metadata is left out: it is a JSON
 * object per row and belongs in a JSON export, which the management API's own endpoint
 * is for.
 */
export function usersToCsv(users: readonly ProjectUser[], now: Date): string {
  const header = [
    "id",
    "display_name",
    "email",
    "email_verified",
    "phone",
    "phone_verified",
    "status",
    "banned_until",
    "methods",
    "mfa_enabled",
    "active_sessions",
    "last_sign_in_at",
    "created_at",
    "updated_at",
    "deleted_at",
  ];
  const rows = users.map((user) =>
    [
      user.id,
      user.displayName,
      user.email,
      user.emailVerified,
      user.phone,
      user.phoneVerified,
      statusOf(user, now),
      user.bannedUntil,
      user.methods.join(" "),
      user.mfaEnabled,
      user.activeSessions,
      user.lastSignInAt,
      user.createdAt,
      user.updatedAt,
      user.deletedAt,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

/*
 * The totals above the list.
 */

/**
 * What the strip over the table says: the figures a support agent reads before they
 * search for anybody, each one the count of a filter this screen can already apply.
 *
 * A tombstone is not an account, so `living` leaves them out and `deleted` counts them
 * separately: a project whose total silently included erased rows would report more
 * customers than it has. Everything else is measured over the living.
 */
export interface UsersSummary {
  living: number;
  deleted: number;
  suspended: number;
  /** Created inside the last thirty days. */
  joined: number;
  /** Signed in inside the last seven. */
  recent: number;
  /** Never signed in at all, which is the account an operator is asked about. */
  dormant: number;
  mfa: number;
  /** `mfa` over `living`, 0 to 100, rounded. Zero accounts is zero and not a division. */
  mfaShare: number;
}

export function summariseUsers(users: readonly ProjectUser[], now: Date): UsersSummary {
  const summary: UsersSummary = {
    living: 0,
    deleted: 0,
    suspended: 0,
    joined: 0,
    recent: 0,
    dormant: 0,
    mfa: 0,
    mfaShare: 0,
  };
  for (const user of users) {
    if (user.deletedAt !== null) {
      summary.deleted += 1;
      continue;
    }
    summary.living += 1;
    if (statusOf(user, now) === "suspended") summary.suspended += 1;
    if (within(user.createdAt, "30d", now)) summary.joined += 1;
    if (user.lastSignInAt === null) summary.dormant += 1;
    else if (within(user.lastSignInAt, "7d", now)) summary.recent += 1;
    if (user.mfaEnabled) summary.mfa += 1;
  }
  summary.mfaShare = summary.living === 0 ? 0 : Math.round((summary.mfa / summary.living) * 100);
  return summary;
}

/*
 * The filters as a URL.
 *
 * Everything the reader can narrow by goes in the query string except the search term,
 * which stays in memory for the visit. A status and a facet are a view of the project and
 * are worth pasting to a colleague; a search term is whichever person is being looked
 * into, and an address in a URL is personal data in a browser history, a proxy log and a
 * chat message. That is the whole rule, and it is why the two are stored differently.
 */

const WINDOW_VALUES: readonly TimeWindow[] = ["24h", "7d", "30d", "90d"];
const TRISTATE_VALUES: readonly Tristate[] = ["yes", "no"];

/** What a query string can carry. `undefined` for a key the URL did not have. */
export type QueryValue = string | (string | null)[] | null | undefined;

function first(value: QueryValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function asWindow(value: QueryValue): TimeWindow | null {
  const text = first(value);
  return WINDOW_VALUES.find((window) => window === text) ?? null;
}

function asTristate(value: QueryValue): Tristate | null {
  const text = first(value);
  return TRISTATE_VALUES.find((state) => state === text) ?? null;
}

/** The shareable half of the filters, with every unset key left out. */
export function filtersToQuery(filters: UserFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.status !== "all") query.status = filters.status;
  if (filters.emailVerified !== "any") query.verified = filters.emailVerified;
  if (filters.mfa !== "any") query.mfa = filters.mfa;
  if (filters.methods.length > 0) query.method = filters.methods.join(",");
  if (filters.created !== "any") query.created = filters.created;
  if (filters.lastSignIn !== "any") query.signin = filters.lastSignIn;
  return query;
}

/**
 * The filters a URL asks for, with anything it does not name left at its default and
 * anything it names wrongly ignored. A hand-typed or stale link narrows the list by
 * whatever part of it still makes sense rather than failing.
 */
export function filtersFromQuery(query: Record<string, QueryValue>, search = ""): UserFilters {
  const status = first(query.status);
  const methods = (first(query.method) ?? "")
    .split(",")
    .filter((entry): entry is SignInMethod =>
      (SIGN_IN_METHODS as readonly string[]).includes(entry),
    );
  const signin = first(query.signin);
  return {
    status: status === "active" || status === "suspended" || status === "deleted" ? status : "all",
    query: search,
    emailVerified: asTristate(query.verified) ?? "any",
    mfa: asTristate(query.mfa) ?? "any",
    methods,
    created: asWindow(query.created) ?? "any",
    lastSignIn: signin === "never" ? "never" : (asWindow(query.signin) ?? "any"),
  };
}

/** Whether two filter sets would produce the same URL, so a sync writes only on a change. */
export function sameQuery(a: UserFilters, b: UserFilters): boolean {
  const left = filtersToQuery(a);
  const right = filtersToQuery(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}
