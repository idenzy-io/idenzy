/**
 * Claim templates: what a project's access tokens carry beyond the claims we assemble
 * (PROJECT.md 4.2), and every rule the server applies to one, mirrored here so the
 * screen can refuse what the save would refuse before anybody presses the button.
 *
 * The rules come from `@idenzy/protocol/schemas/claims` and `ClaimTemplateService`, and
 * they are the same rules on purpose: a dashboard that checked a different list would
 * produce a template somebody can save and never use. The reserved names, the allowlist
 * of user fields, the count and the byte budget are all transcribed rather than invented.
 *
 * What this file adds is a renderer. A template is abstract until it meets a user, so the
 * screen renders it against a sample the way the issuer would, absent-not-null included,
 * and shows the token that would come out. That preview is the whole point of the page:
 * a claim a customer's authorisation code branches on is one where a surprise costs a
 * sign-in, and the place to be surprised is here.
 */

/*
 * The server's constants, transcribed.
 */

/** Names assembled by the issuer. Overwriting `sub` would mint a token for somebody else. */
export const RESERVED_CLAIMS = [
  "iss",
  "sub",
  "aud",
  "exp",
  "iat",
  "nbf",
  "jti",
  "sid",
  "amr",
  "acr",
  "fva",
] as const;

/** How many bytes the custom claims may add. Tokens travel in a header proxies cap. */
export const MAX_CLAIM_BYTES = 1024;

/** Enough for a role, a tenant, a plan and a handful of flags. Past that is a lookup. */
export const MAX_CLAIMS = 16;

export const NAME_MAX_LENGTH = 64;
export const PATH_MAX_LENGTH = 128;

/** Letters, digits and `_ : . / -`: what JWT registries and OIDC's namespaced names allow. */
export const NAME_PATTERN = /^[A-Za-z0-9_:./-]+$/;

export type ClaimSource = "user" | "metadata_public" | "metadata_private";

export interface ClaimMapping {
  /** What the token calls it. */
  name: string;
  source: ClaimSource;
  /** A field name for the user source, a top-level key for either metadata source. */
  path: string;
  /** A token without it is not worth issuing: the sign-in is refused instead. */
  required: boolean;
}

export interface ClaimTemplate {
  claims: ClaimMapping[];
  /** Says out loud that mapping `metadata_private` publishes it. */
  acknowledgePrivateMetadata: boolean;
}

export interface SavedClaimTemplate extends ClaimTemplate {
  /** Null for a project that has never saved one. */
  updatedAt: string | null;
}

export const EMPTY_TEMPLATE: SavedClaimTemplate = {
  claims: [],
  acknowledgePrivateMetadata: false,
  updatedAt: null,
};

/*
 * The sources, in the order a menu offers them: the two that publish something already
 * public first, and the one that publishes something that was not, last and marked.
 */
export interface SourceInfo {
  source: ClaimSource;
  label: string;
  /** In a row, where the label has to share a line with the field. */
  short: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Whether mapping it publishes something a browser could not already see. */
  publishes: boolean;
  note: string;
}

export const SOURCES: readonly SourceInfo[] = [
  {
    source: "user",
    label: "Profile field",
    short: "profile",
    icon: "material-symbols:person-outline",
    publishes: false,
    note: "A field of the public profile, which the SDK's user endpoint already returns. Nine fields, and no others: the list is an allowlist, so a column added to users tomorrow is not claimable until somebody adds it there.",
  },
  {
    source: "metadata_public",
    label: "Public metadata",
    short: "public",
    icon: "material-symbols:data-object",
    publishes: false,
    note: "A top-level key of metadata_public, which a client SDK can already read. Nested values are not reached: flatten what you want carried where you write it, once.",
  },
  {
    source: "metadata_private",
    label: "Private metadata",
    short: "private",
    icon: "material-symbols:lock-outline",
    publishes: true,
    note: "A top-level key of metadata_private, which nothing outside the management API has seen. A token is read by everything the user's device sends it to, so mapping this publishes it, and the save asks you to say so.",
  },
];

export function sourceInfo(source: ClaimSource): SourceInfo {
  return SOURCES.find((info) => info.source === source) ?? (SOURCES[0] as SourceInfo);
}

/*
 * The claimable user fields: exactly the public profile, with what a row needs to
 * describe each one.
 */
export type ClaimableUserField =
  | "id"
  | "email"
  | "emailVerified"
  | "phone"
  | "phoneVerified"
  | "displayName"
  | "avatarUrl"
  | "createdAt"
  | "lastSignInAt";

export type FieldKind = "id" | "email" | "phone" | "boolean" | "text" | "url" | "timestamp";

export interface UserFieldInfo {
  field: ClaimableUserField;
  label: string;
  kind: FieldKind;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Whether a user can have nothing here, which is what makes `required` bite. */
  nullable: boolean;
  note: string;
}

export const USER_FIELDS: readonly UserFieldInfo[] = [
  {
    field: "id",
    label: "User ID",
    kind: "id",
    icon: "material-symbols:fingerprint",
    nullable: false,
    note: "The public id, the same value as sub. Rarely worth a second claim.",
  },
  {
    field: "email",
    label: "Email",
    kind: "email",
    icon: "material-symbols:mail-outline",
    nullable: true,
    note: "Absent for an account that signed up by phone or as a guest.",
  },
  {
    field: "emailVerified",
    label: "Email verified",
    kind: "boolean",
    icon: "material-symbols:verified-outline",
    nullable: false,
    note: "Always present, true or false.",
  },
  {
    field: "phone",
    label: "Phone",
    kind: "phone",
    icon: "material-symbols:call-outline",
    nullable: true,
    note: "E.164. Absent for most accounts.",
  },
  {
    field: "phoneVerified",
    label: "Phone verified",
    kind: "boolean",
    icon: "material-symbols:verified-outline",
    nullable: false,
    note: "Always present, true or false.",
  },
  {
    field: "displayName",
    label: "Display name",
    kind: "text",
    icon: "material-symbols:badge-outline",
    nullable: true,
    note: "Up to 200 characters, and absent until the user sets one.",
  },
  {
    field: "avatarUrl",
    label: "Avatar URL",
    kind: "url",
    icon: "material-symbols:image-outline",
    nullable: true,
    note: "A URL, which is long: the one profile field that can crowd the budget.",
  },
  {
    field: "createdAt",
    label: "Created at",
    kind: "timestamp",
    icon: "material-symbols:event-outline",
    nullable: false,
    note: "ISO 8601, always present.",
  },
  {
    field: "lastSignInAt",
    label: "Last sign-in",
    kind: "timestamp",
    icon: "material-symbols:login",
    nullable: true,
    note: "ISO 8601. Absent on the first sign-in, which is the one that creates the account.",
  },
];

export const CLAIMABLE_USER_FIELDS: readonly ClaimableUserField[] = USER_FIELDS.map(
  (info) => info.field,
);

export function userFieldInfo(path: string): UserFieldInfo | null {
  return USER_FIELDS.find((info) => info.field === path) ?? null;
}

export function isClaimableUserField(path: string): path is ClaimableUserField {
  return userFieldInfo(path) !== null;
}

/*
 * A user as the renderer sees one: the public profile and both metadata columns.
 */
export interface SampleUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  metadataPublic: Readonly<Record<string, unknown>>;
  metadataPrivate: Readonly<Record<string, unknown>>;
}

export interface SampleProfile {
  id: "complete" | "sparse" | "phone";
  label: string;
  /** For a segment or a tile, where the label would not fit. */
  short: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  note: string;
  user: SampleUser;
}

/**
 * Three users to render against, because a template that looks fine for one refuses the
 * others: the sparse profile signed up a minute ago by email and has filled nothing in,
 * and the phone profile has no address at all. Both are ordinary accounts and both are
 * what a required claim locks out, which is why the screen never judges a template
 * against one synthetic complete profile.
 */
export const SAMPLE_PROFILES: readonly SampleProfile[] = [
  {
    id: "complete",
    label: "A complete profile",
    short: "Complete",
    icon: "material-symbols:person-outline",
    note: "Every field filled in, and metadata on both sides.",
    user: {
      id: "usr_01j9k3v8d2x1r7q4",
      email: "ada@example.com",
      emailVerified: true,
      phone: "+14155552671",
      phoneVerified: true,
      displayName: "Ada Lovelace",
      avatarUrl: "https://cdn.example.com/avatars/ada.png",
      createdAt: "2026-03-14T09:12:00.000Z",
      lastSignInAt: "2026-09-09T08:41:00.000Z",
      metadataPublic: { plan: "pro", locale: "en-GB" },
      metadataPrivate: { orgId: "org_7f3a", riskScore: 12 },
    },
  },
  {
    id: "sparse",
    label: "A new account",
    short: "New account",
    icon: "material-symbols:person-add-outline",
    note: "Signed up a minute ago by email. No name, no phone, no metadata yet.",
    user: {
      id: "usr_01j9k4c0m8w2t5n9",
      email: "sam@example.com",
      emailVerified: false,
      phone: null,
      phoneVerified: false,
      displayName: null,
      avatarUrl: null,
      createdAt: "2026-09-09T13:58:00.000Z",
      lastSignInAt: null,
      metadataPublic: {},
      metadataPrivate: {},
    },
  },
  {
    id: "phone",
    label: "A phone sign-up",
    short: "Phone only",
    icon: "material-symbols:call-outline",
    note: "Signed in by SMS and holds no address at all, which is who a required email claim locks out.",
    user: {
      id: "usr_01j9k5r2n7y4h1b6",
      email: null,
      emailVerified: false,
      phone: "+447700900142",
      phoneVerified: true,
      displayName: "Grace Hopper",
      avatarUrl: null,
      createdAt: "2026-06-02T18:20:00.000Z",
      lastSignInAt: "2026-09-08T21:03:00.000Z",
      metadataPublic: { plan: "free" },
      metadataPrivate: { orgId: "org_91c4" },
    },
  },
];

/*
 * Validation, mapping by mapping and then for the whole.
 */
export type ClaimIssue =
  | "name_empty"
  | "name_long"
  | "name_chars"
  | "name_reserved"
  | "name_duplicate"
  | "path_empty"
  | "path_long"
  | "path_unknown_field";

export const CLAIM_ISSUE_LABELS: Record<ClaimIssue, string> = {
  name_empty: "Give the claim a name: it is the key your code reads.",
  name_long: `At most ${NAME_MAX_LENGTH} characters.`,
  name_chars: "Letters, digits and _ : . / - only, with no spaces.",
  name_reserved: "Assembled by the issuer and cannot be mapped.",
  name_duplicate: "Already mapped. Two mappings onto one name would leave one doing nothing.",
  path_empty: "Name the key to read.",
  path_long: `At most ${PATH_MAX_LENGTH} characters.`,
  path_unknown_field: "Not a field of the public profile, so not claimable.",
};

export function isReservedClaim(name: string): boolean {
  return RESERVED_CLAIMS.some((reserved) => reserved === name);
}

/** The issues with one mapping's name, against the names the other mappings hold. */
export function validateName(name: string, others: readonly string[]): ClaimIssue[] {
  const text = name.trim();
  if (text === "") return ["name_empty"];
  const issues: ClaimIssue[] = [];
  if (text.length > NAME_MAX_LENGTH) issues.push("name_long");
  if (!NAME_PATTERN.test(text)) issues.push("name_chars");
  if (isReservedClaim(text)) issues.push("name_reserved");
  if (others.includes(text)) issues.push("name_duplicate");
  return issues;
}

export function validatePath(source: ClaimSource, path: string): ClaimIssue[] {
  const text = path.trim();
  if (text === "") return ["path_empty"];
  const issues: ClaimIssue[] = [];
  if (text.length > PATH_MAX_LENGTH) issues.push("path_long");
  if (source === "user" && !isClaimableUserField(text)) issues.push("path_unknown_field");
  return issues;
}

/** Every issue with the mapping at `index`, the duplicate check reading the rest. */
export function validateMapping(claims: readonly ClaimMapping[], index: number): ClaimIssue[] {
  const mapping = claims[index];
  if (mapping === undefined) return [];
  const others = claims
    .filter((_, position) => position !== index)
    .map((entry) => entry.name.trim());
  return [...validateName(mapping.name, others), ...validatePath(mapping.source, mapping.path)];
}

export type TemplateIssue = "too_many" | "names_too_large" | "private_unacknowledged";

export const TEMPLATE_ISSUE_LABELS: Record<TemplateIssue, string> = {
  too_many: `A template holds at most ${MAX_CLAIMS} claims. Past that is a lookup, not a token.`,
  names_too_large: `The names alone do not fit inside the ${MAX_CLAIM_BYTES}-byte budget.`,
  private_unacknowledged:
    "The template reads private metadata, which publishes it. The save asks you to say so.",
};

export function readsPrivateMetadata(claims: readonly ClaimMapping[]): boolean {
  return claims.some((claim) => claim.source === "metadata_private");
}

/** Bytes as the server counts them: UTF-8 of the JSON. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * What a save can measure: the skeleton the names would render into with empty values.
 * The rest is only knowable against a user, which is what `renderTemplate` is for.
 */
export function namesBytes(claims: readonly ClaimMapping[]): number {
  const skeleton = Object.fromEntries(claims.map((claim) => [claim.name.trim(), ""]));
  return byteLength(JSON.stringify(skeleton));
}

/** The whole's issues. Per-mapping issues are `validateMapping`'s and are not repeated. */
export function validateTemplate(template: ClaimTemplate): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  if (template.claims.length > MAX_CLAIMS) issues.push("too_many");
  if (namesBytes(template.claims) > MAX_CLAIM_BYTES) issues.push("names_too_large");
  if (readsPrivateMetadata(template.claims) && !template.acknowledgePrivateMetadata) {
    issues.push("private_unacknowledged");
  }
  return issues;
}

/** Whether the server would take it: every mapping clean, and the whole clean too. */
export function isTemplateValid(template: ClaimTemplate): boolean {
  if (template.claims.some((_, index) => validateMapping(template.claims, index).length > 0)) {
    return false;
  }
  return validateTemplate(template).length === 0;
}

/*
 * Rendering, the way the issuer does it.
 */

/** One value, from the source the mapping names. Undefined and null are one answer. */
export function resolveClaim(mapping: ClaimMapping, user: SampleUser): unknown {
  const path = mapping.path.trim();
  if (mapping.source === "user") {
    if (!isClaimableUserField(path)) return undefined;
    return user[path];
  }
  const metadata =
    mapping.source === "metadata_private" ? user.metadataPrivate : user.metadataPublic;
  return metadata[path];
}

export interface RenderedClaim {
  name: string;
  value: unknown;
  /** The bytes this one entry adds, so a row can say what it costs. */
  bytes: number;
}

export interface RenderedTemplate {
  /** In template order, only the claims that resolved. */
  present: RenderedClaim[];
  /** Left out, because the user has nothing there and the claim is optional. */
  absent: ClaimMapping[];
  /** The first required claim that resolved to nothing, which is what refuses the sign-in. */
  refusedBy: ClaimMapping | null;
  /** Bytes of the custom claims as the issuer measures them, whether or not they fit. */
  bytes: number;
  overBudget: boolean;
}

/**
 * The custom claims for one user, as `ClaimTemplate.render` produces them, and every
 * reason a claim is not there. A mapping with an invalid name is skipped rather than
 * rendered under a name the server would refuse.
 */
export function renderTemplate(
  claims: readonly ClaimMapping[],
  user: SampleUser,
): RenderedTemplate {
  const present: RenderedClaim[] = [];
  const absent: ClaimMapping[] = [];
  let refusedBy: ClaimMapping | null = null;
  const seen = new Set<string>();

  for (const mapping of claims) {
    const name = mapping.name.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    const value = resolveClaim(mapping, user);
    if (value === undefined || value === null) {
      if (mapping.required && refusedBy === null) refusedBy = mapping;
      if (!mapping.required) absent.push(mapping);
      continue;
    }
    present.push({ name, value, bytes: byteLength(JSON.stringify({ [name]: value })) - 2 });
  }

  const bytes = byteLength(
    JSON.stringify(Object.fromEntries(present.map((c) => [c.name, c.value]))),
  );
  return { present, absent, refusedBy, bytes, overBudget: bytes > MAX_CLAIM_BYTES };
}

/**
 * The claims every token carries, for the preview to draw the custom ones among. Fixed
 * values apart from the user's own id, because they are the issuer's and not the
 * template's, and the point of showing them is that a template cannot touch them.
 */
export function assembledClaims(
  user: SampleUser,
  projectId: string,
  issuedAt: Date,
): Readonly<Record<string, unknown>> {
  const iat = Math.floor(issuedAt.getTime() / 1000);
  return {
    iss: "https://auth.example.com",
    sub: user.id,
    sid: "ses_01j9k5d7p3v6x2m8",
    aud: projectId,
    iat,
    exp: iat + 300,
    amr: ["pwd"],
  };
}

/*
 * Editing helpers.
 */

/**
 * A name for a new mapping: the field or key itself where that is a legal, unreserved
 * name, and a safe stand-in where it is not. A key called `sub` in somebody's metadata
 * must not become a mapping the save then refuses.
 */
export function defaultClaimName(path: string, taken: readonly string[]): string {
  const base = path
    .trim()
    .replace(/[^A-Za-z0-9_:./-]/g, "_")
    .slice(0, NAME_MAX_LENGTH);
  let candidate = base === "" ? "claim" : base;
  if (isReservedClaim(candidate)) candidate = `${candidate}_claim`;
  let suffix = 2;
  let name = candidate;
  while (taken.includes(name)) {
    name = `${candidate}_${suffix}`;
    suffix += 1;
  }
  return name;
}

/**
 * As the server would store it: names and keys trimmed, and the acknowledgement kept
 * only while something still reads private metadata. The server records when it was
 * given and clears it with the last private mapping, so a draft that dropped its private
 * claim and still says "acknowledged" is the same template as one that never did.
 */
export function normaliseTemplate(template: ClaimTemplate): ClaimTemplate {
  const claims = template.claims.map((claim) => ({
    name: claim.name.trim(),
    source: claim.source,
    path: claim.path.trim(),
    required: claim.required,
  }));
  return {
    claims,
    acknowledgePrivateMetadata: readsPrivateMetadata(claims) && template.acknowledgePrivateMetadata,
  };
}

/** Whether two templates would save the same thing. Order matters: it is the token's. */
export function isSameTemplate(a: ClaimTemplate, b: ClaimTemplate): boolean {
  const left = normaliseTemplate(a);
  const right = normaliseTemplate(b);
  if (left.claims.length !== right.claims.length) return false;
  if (left.acknowledgePrivateMetadata !== right.acknowledgePrivateMetadata) return false;
  return left.claims.every((claim, index) => {
    const other = right.claims[index];
    return (
      other !== undefined &&
      claim.name === other.name &&
      claim.source === other.source &&
      claim.path === other.path &&
      claim.required === other.required
    );
  });
}

export function copyTemplate<T extends ClaimTemplate>(template: T): T {
  return { ...template, claims: template.claims.map((claim) => ({ ...claim })) };
}

/*
 * Before and after.
 *
 * A draft only means anything against what is saved, and a screen that says "unsaved
 * changes" without saying which is a screen that reads like the autosaving ones next to
 * it. Everything below answers the same question twice: in words, for the list of what
 * publishing would do, and in the payload, for the token itself.
 */

/** Where a mapping reads from, spelled as the column it comes out of. */
export function claimPathText(mapping: ClaimMapping): string {
  const path = mapping.path.trim();
  return mapping.source === "user" ? `profile.${path}` : `${mapping.source}.${path}`;
}

export type ChangeKind = "added" | "removed" | "changed" | "reordered";

export interface TemplateChange {
  kind: ChangeKind;
  /** The claim's name; empty for a change about the template's shape rather than a claim. */
  name: string;
  detail: string;
}

export const CHANGE_ICONS: Record<ChangeKind, string> = {
  added: "material-symbols:add",
  removed: "material-symbols:remove",
  changed: "material-symbols:swap-horiz",
  reordered: "material-symbols:swap-vert",
};

/** What one claim publishing keeps would do differently, or null where it does nothing. */
function claimChange(was: ClaimMapping, now: ClaimMapping): TemplateChange | null {
  const parts: string[] = [];
  if (was.source !== now.source || was.path !== now.path) {
    parts.push(`reads ${claimPathText(now)} instead of ${claimPathText(was)}`);
  }
  if (was.required !== now.required) {
    parts.push(now.required ? "becomes required" : "becomes optional");
  }
  return parts.length === 0
    ? null
    : { kind: "changed", name: now.name, detail: parts.join(", and ") };
}

/**
 * What publishing would do to the saved template, as sentences. A claim with no name yet
 * is left out: it cannot be published, so it is not yet a change to anything.
 */
export function templateChanges(saved: ClaimTemplate, draft: ClaimTemplate): TemplateChange[] {
  const before = normaliseTemplate(saved).claims.filter((claim) => claim.name !== "");
  const after = normaliseTemplate(draft).claims.filter((claim) => claim.name !== "");
  const wasNamed = new Map(before.map((claim) => [claim.name, claim]));
  const isNamed = new Map(after.map((claim) => [claim.name, claim]));
  const changes: TemplateChange[] = [];

  for (const claim of after) {
    const was = wasNamed.get(claim.name);
    const change =
      was === undefined
        ? ({
            kind: "added",
            name: claim.name,
            detail: `reads ${claimPathText(claim)}${claim.required ? ", and is required" : ""}`,
          } satisfies TemplateChange)
        : claimChange(was, claim);
    if (change !== null) changes.push(change);
  }

  for (const claim of before) {
    if (isNamed.has(claim.name)) continue;
    changes.push({
      kind: "removed",
      name: claim.name,
      detail: `no longer carried, and it read ${claimPathText(claim)}`,
    });
  }

  /* Order is the token's own, so a reshuffle of the claims that stayed is a change too. */
  const keptBefore = before.filter((claim) => isNamed.has(claim.name)).map((claim) => claim.name);
  const keptAfter = after.filter((claim) => wasNamed.has(claim.name)).map((claim) => claim.name);
  if (keptBefore.some((name, at) => name !== keptAfter[at])) {
    changes.push({
      kind: "reordered",
      name: "",
      detail: "The claims that stay are in a new order, which is the order a token writes them in.",
    });
  }

  return changes;
}

export type LineChange = "added" | "removed" | "changed" | "same";

export interface TokenLine {
  key: string;
  /** False for the claims the issuer assembles, which a template cannot touch. */
  custom: boolean;
  change: LineChange;
  text: string;
}

/**
 * The payload's lines for one user, each marked against what the saved template renders
 * for the same user, so the preview is a before and an after rather than only an after.
 * A null `before` is a draft with nothing to compare to and every line comes back
 * unmarked. A removed line is the ghost of a claim the saved template still carries; the
 * strikethrough is what says it is leaving, and it takes a comma like any other line
 * because the block is handed to a JSON grammar whole and a missing separator would be
 * tokenised as the error it would be in a real payload.
 */
function lineChange(old: RenderedClaim | undefined, now: RenderedClaim): LineChange {
  if (old === undefined) return "added";
  return JSON.stringify(old.value) === JSON.stringify(now.value) ? "same" : "changed";
}

export function tokenLines(
  assembled: Readonly<Record<string, unknown>>,
  after: RenderedTemplate,
  before: RenderedTemplate | null,
): TokenLine[] {
  const was = new Map((before?.present ?? []).map((claim) => [claim.name, claim]));
  const lines: TokenLine[] = Object.entries(assembled).map(([name, value]) => ({
    key: `issuer-${name}`,
    custom: false,
    change: "same" as LineChange,
    text: `"${name}": ${JSON.stringify(value)}`,
  }));

  for (const claim of after.present) {
    lines.push({
      key: `claim-${claim.name}`,
      custom: true,
      change: before === null ? "same" : lineChange(was.get(claim.name), claim),
      text: `"${claim.name}": ${JSON.stringify(claim.value)}`,
    });
  }

  if (before !== null) {
    const carried = new Set(after.present.map((claim) => claim.name));
    for (const claim of before.present) {
      if (carried.has(claim.name)) continue;
      lines.push({
        key: `gone-${claim.name}`,
        custom: true,
        change: "removed",
        text: `"${claim.name}": ${JSON.stringify(claim.value)}`,
      });
    }
  }

  return lines.map((line, index) =>
    index === lines.length - 1 ? line : { ...line, text: `${line.text},` },
  );
}

export interface ProfileOutcome {
  profile: SampleProfile;
  /** What the draft makes of this user. */
  rendered: RenderedTemplate;
  /** What the saved template makes of them, or null while the draft matches it. */
  before: RenderedTemplate | null;
}

/**
 * Every sample user's answer to the draft, which is the only fleet-wide statement this
 * screen can honestly make: a template is judged against the accounts that hold nothing
 * as well as the one that holds everything.
 */
export function profileOutcomes(
  draft: readonly ClaimMapping[],
  saved: readonly ClaimMapping[],
  compare: boolean,
): ProfileOutcome[] {
  return SAMPLE_PROFILES.map((profile) => ({
    profile,
    rendered: renderTemplate(draft, profile.user),
    before: compare ? renderTemplate(saved, profile.user) : null,
  }));
}

/** The sample users a required claim would lock out, by name. Empty is the good answer. */
export function refusedProfiles(outcomes: readonly ProfileOutcome[]): ProfileOutcome[] {
  return outcomes.filter((outcome) => outcome.rendered.refusedBy !== null);
}
