/**
 * The social providers this deployment implements, and what a project decides about
 * each one.
 *
 * Eighteen adapters are registered in `apps/auth-api/src/oauth/oauth.module.ts` and the
 * nineteenth name in the enum, generic OIDC, is the enterprise connector and is not
 * built yet. What a project supplies is small: the mode, its own client credentials, the
 * scopes it wants instead of the defaults, and the handful of extras a provider needs to
 * be reachable at all (Apple's team and key ids, a Microsoft directory, a GitLab
 * instance). Everything else about the flow is fixed by the server.
 *
 * The field worth reading this file for is `email`. Whether a provider asserts that the
 * address it hands over is verified is what decides whether a sign-in may join an account
 * that already holds that address (PROJECT.md 4.6), and the eight adapters that report
 * unverified do so because their provider states nothing, not because nobody checked: an
 * assumption is not an assertion. The screen says which is which per provider, because a
 * customer who does not know it will read "sign in with Twitch does not find my user" as
 * a bug.
 *
 * Icon names are written out in full. `@nuxt/icon` bundles what it finds by scanning
 * `app/**\/*.ts`, so a literal here is compiled in and a name assembled at runtime would
 * draw nothing and report nothing.
 */

export type ProviderName =
  | "google"
  | "apple"
  | "microsoft"
  | "github"
  | "facebook"
  | "discord"
  | "x"
  | "twitch"
  | "linkedin"
  | "gitlab"
  | "bitbucket"
  | "slack"
  | "spotify"
  | "notion"
  | "figma"
  | "kakao"
  | "line"
  | "zoom"
  | "oidc";

/**
 * Whether the provider issues an id_token. It is not decoration: an OIDC provider is
 * checked for issuer, audience and nonce, which is the mix-up defence, and a plain
 * OAuth 2 provider has no such token to check.
 */
export type ProviderProtocol = "oidc" | "oauth2";

/**
 * What the provider says about the address it hands over.
 *
 * `asserts` is the only one an existing account can be joined on. `silent` is a provider
 * that confirms addresses in practice and states nothing in the payload; `denies` is
 * Spotify, which states the opposite outright; `none` is X, which releases no address at
 * all below elevated access.
 */
export type EmailAssertion = "asserts" | "silent" | "denies" | "none";

export interface AssertionLook {
  label: string;
  /** A Material Symbols glyph, written out in full. */
  icon: string;
  /** A text colour class, so a row can tint the glyph. */
  tone: string;
}

export const ASSERTION_LOOK: Record<EmailAssertion, AssertionLook> = {
  asserts: {
    label: "Verified address",
    icon: "material-symbols:verified-user-outline",
    tone: "text-success",
  },
  silent: {
    label: "Says nothing",
    icon: "material-symbols:help-outline",
    tone: "text-warning",
  },
  denies: {
    label: "Unproven address",
    icon: "material-symbols:report-outline",
    tone: "text-warning",
  },
  none: { label: "No address", icon: "material-symbols:mail-off-outline", tone: "text-ink/45" },
};

/** One provider-specific extra, stored on the row's `settings` and never secret. */
export interface ProviderField {
  /** The key under `oauth_providers.settings`. */
  key: string;
  label: string;
  placeholder: string;
  /** Under the field while the value stands. */
  hint: string;
  /** In its place when the value is missing or refused. */
  issue: string;
  /** Required to reach the provider at all. An optional field falls back to a default. */
  required: boolean;
}

/** What the provider calls its client secret, which for one of them is not a secret. */
export interface SecretShape {
  label: string;
  placeholder: string;
  hint: string;
  /** Apple's key is a PEM block and needs the room. */
  multiline: boolean;
}

const CLIENT_SECRET: SecretShape = {
  label: "Client secret",
  placeholder: "The secret from the provider console",
  hint: "Stored envelope encrypted under this project's data key and never shown again.",
  multiline: false,
};

export interface ProviderInfo {
  id: ProviderName;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** A mark that is solid black and would vanish on a dark surface. */
  monochrome: boolean;
  /** A colour class for a mark drawn in `currentColor`, which would otherwise be ink. */
  tint?: string;
  protocol: ProviderProtocol;
  /** What the provider console calls the client id, where it does not call it that. */
  clientIdLabel?: string;
  email: EmailAssertion;
  /** What the provider states about the address, in its own terms. */
  emailNote: string;
  /** Requested when the project has chosen no scopes of its own. */
  defaultScopes: readonly string[];
  /** The one thing about this provider that surprises whoever wires it up. */
  note: string;
  fields: readonly ProviderField[];
  secret: SecretShape;
  console: { label: string; href: string };
  guide: string;
  /** False for a provider named in the enum that has no adapter yet. */
  available: boolean;
}

const GUIDES = "https://idenzy.dev/docs/providers";

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "google",
    label: "Google",
    icon: "logos:google-icon",
    monochrome: false,
    protocol: "oidc",
    email: "asserts",
    emailNote:
      "Google asserts that the address is verified, so an existing account on it is joined.",
    defaultScopes: ["openid", "email", "profile"],
    note: "The account chooser is always shown. Without it, somebody signed into several Google accounts is taken through whichever the browser prefers, which is not the one they thought they picked.",
    fields: [],
    secret: CLIENT_SECRET,
    console: {
      label: "Google Cloud credentials",
      href: "https://console.cloud.google.com/apis/credentials",
    },
    guide: `${GUIDES}/google`,
    available: true,
  },
  {
    id: "apple",
    label: "Apple",
    icon: "logos:apple",
    monochrome: true,
    protocol: "oidc",
    clientIdLabel: "Services ID",
    email: "asserts",
    emailNote:
      "Apple asserts the address, relay aliases included. A privaterelay.appleid.com address is real and deliverable, and is a different one at every product the person signs into.",
    defaultScopes: ["openid", "email", "name"],
    note: "There is no client secret. What Apple calls one is an ES256 assertion we sign per request from the .p8 key, so nothing here expires quietly months later. The user's name arrives in the first callback and never again.",
    fields: [
      {
        key: "teamId",
        label: "Team ID",
        placeholder: "ABCDE12345",
        hint: "Ten characters, from the membership details in your developer account.",
        issue: "Apple's ten-character Team ID.",
        required: true,
      },
      {
        key: "keyId",
        label: "Key ID",
        placeholder: "ABCDE12345",
        hint: "The identifier of the Sign in with Apple key the .p8 file belongs to.",
        issue: "The Key ID printed beside the .p8 download.",
        required: true,
      },
    ],
    secret: {
      label: "Signing key (.p8)",
      placeholder: "-----BEGIN PRIVATE KEY-----",
      hint: "The PKCS#8 ES256 key Apple issued, pasted whole. Apple lets you download it once.",
      multiline: true,
    },
    console: {
      label: "Apple developer identifiers",
      href: "https://developer.apple.com/account/resources/identifiers/list/serviceId",
    },
    guide: `${GUIDES}/apple`,
    available: true,
  },
  {
    id: "microsoft",
    label: "Microsoft",
    icon: "logos:microsoft-icon",
    monochrome: false,
    protocol: "oidc",
    clientIdLabel: "Application (client) ID",
    email: "silent",
    emailNote:
      "Nothing in a Microsoft token says whether the address was verified. Work accounts are verified by their directory and personal accounts are not, so nothing is joined on the address.",
    defaultScopes: ["openid", "email", "profile"],
    note: "The issuer is per directory and is read from the token's own directory claim. Pinning a directory here is also what stops personal accounts signing into a workforce application.",
    fields: [
      {
        key: "tenant",
        label: "Directory",
        placeholder: "common",
        hint: "common, organizations, consumers, or a directory (tenant) ID to pin one.",
        issue: "A directory ID, or one of common, organizations and consumers.",
        required: false,
      },
    ],
    secret: CLIENT_SECRET,
    console: { label: "Microsoft Entra app registrations", href: "https://entra.microsoft.com/" },
    guide: `${GUIDES}/microsoft`,
    available: true,
  },
  {
    id: "github",
    label: "GitHub",
    icon: "logos:github-icon",
    monochrome: true,
    protocol: "oauth2",
    email: "asserts",
    emailNote:
      "The primary verified address is read from the addresses endpoint. The public one on the profile carries no verification status at all, and a user with nothing verified signs in with no address rather than an unproven one.",
    defaultScopes: ["read:user", "user:email"],
    note: "Not OIDC, so there is no id_token to check. State, PKCE and the redirect allowlist are inherited all the same.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "GitHub OAuth apps", href: "https://github.com/settings/developers" },
    guide: `${GUIDES}/github`,
    available: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    icon: "logos:facebook",
    monochrome: false,
    protocol: "oauth2",
    clientIdLabel: "App ID",
    email: "silent",
    emailNote:
      "Facebook confirms addresses in practice and states nothing about it in the payload, so nothing is joined on the address.",
    defaultScopes: ["public_profile", "email"],
    note: "A Graph call rather than OIDC: Facebook issues an id_token only for a client set up for Login for Business. The Graph version is pinned, because a dropped version breaks an unpinned call.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Meta apps", href: "https://developers.facebook.com/apps" },
    guide: `${GUIDES}/facebook`,
    available: true,
  },
  {
    id: "discord",
    label: "Discord",
    icon: "logos:discord-icon",
    monochrome: false,
    protocol: "oauth2",
    email: "asserts",
    emailNote:
      "The verified flag on the user object is Discord's own, so accounts are joined on it.",
    defaultScopes: ["identify", "email"],
    note: "The avatar is a hash rather than a URL and is assembled from it. A user who never set one has no avatar, because Discord's default is rendered rather than a file.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Discord applications", href: "https://discord.com/developers/applications" },
    guide: `${GUIDES}/discord`,
    available: true,
  },
  {
    id: "x",
    label: "X",
    icon: "logos:x",
    monochrome: true,
    protocol: "oauth2",
    email: "none",
    emailNote:
      "X releases no address below elevated access, so an account created this way has none. Your own screens collect one afterwards if the product needs it.",
    defaultScopes: ["tweet.read", "users.read"],
    note: "The client authenticates in the header rather than the body, which X requires and RFC 6749 forbids doing both ways at once.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "X developer portal", href: "https://developer.x.com/en/portal/dashboard" },
    guide: `${GUIDES}/x`,
    available: true,
  },
  {
    id: "twitch",
    label: "Twitch",
    icon: "logos:twitch",
    monochrome: false,
    protocol: "oauth2",
    email: "silent",
    emailNote:
      "Twitch requires a confirmed address on an account and says nothing about it in the payload, so nothing is joined on the address.",
    defaultScopes: ["user:read:email"],
    note: "Helix wants the client id in a header beside the bearer token, and answers with a one-element array rather than an object.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Twitch developer console", href: "https://dev.twitch.tv/console/apps" },
    guide: `${GUIDES}/twitch`,
    available: true,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: "logos:linkedin-icon",
    monochrome: false,
    protocol: "oidc",
    email: "asserts",
    emailNote:
      "LinkedIn asserts the address is verified in the id_token, so accounts are joined on it.",
    defaultScopes: ["openid", "profile", "email"],
    note: "Sign In with LinkedIn using OpenID Connect, which replaced the old profile API and its separate call for the address. LinkedIn ignores the PKCE parameters rather than refusing them.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "LinkedIn developer apps", href: "https://www.linkedin.com/developers/apps" },
    guide: `${GUIDES}/linkedin`,
    available: true,
  },
  {
    id: "gitlab",
    label: "GitLab",
    icon: "logos:gitlab-icon",
    monochrome: false,
    protocol: "oidc",
    email: "asserts",
    emailNote:
      "GitLab asserts the address is verified in the id_token, so accounts are joined on it.",
    defaultScopes: ["openid", "profile", "email"],
    note: "An instance is a directory of its own: a subject numbers users inside one and means nothing across two. The instance is therefore also the issuer every assertion is checked against.",
    fields: [
      {
        key: "instance",
        label: "Instance",
        placeholder: "https://gitlab.com",
        hint: "Self-managed GitLab goes here. This host is where a client secret gets posted, so only https is accepted.",
        issue: "An https origin, with no credentials and no query.",
        required: false,
      },
    ],
    secret: CLIENT_SECRET,
    console: {
      label: "GitLab applications",
      href: "https://gitlab.com/-/user_settings/applications",
    },
    guide: `${GUIDES}/gitlab`,
    available: true,
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    icon: "logos:bitbucket",
    monochrome: false,
    protocol: "oauth2",
    email: "asserts",
    emailNote:
      "The primary confirmed address is read from a second call, and Bitbucket says whether it confirmed it. A user with none signs in with no address rather than an unconfirmed one.",
    defaultScopes: ["account", "email"],
    note: "An OAuth consumer lives in workspace settings rather than on a user. The addresses arrive paginated, and a token without the email scope is refused there.",
    fields: [],
    secret: CLIENT_SECRET,
    console: {
      label: "Bitbucket workspace settings",
      href: "https://bitbucket.org/account/workspaces/",
    },
    guide: `${GUIDES}/bitbucket`,
    available: true,
  },
  {
    id: "slack",
    label: "Slack",
    icon: "logos:slack-icon",
    monochrome: false,
    protocol: "oidc",
    email: "asserts",
    emailNote:
      "Slack asserts the address is verified in the id_token, so accounts are joined on it.",
    defaultScopes: ["openid", "profile", "email"],
    note: "A member id is unique inside one workspace and not across two, so the workspace is part of the identity: the same person in two workspaces is two identities, and either can be linked to one user.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Slack apps", href: "https://api.slack.com/apps" },
    guide: `${GUIDES}/slack`,
    available: true,
  },
  {
    id: "spotify",
    label: "Spotify",
    icon: "logos:spotify-icon",
    monochrome: false,
    protocol: "oauth2",
    email: "denies",
    emailNote:
      "Spotify states in its own reference that the address is whatever the user typed and that nothing proved it belongs to them. Nothing is ever joined on a Spotify address.",
    defaultScopes: ["user-read-email", "user-read-private"],
    note: "The client authenticates in the header, which Spotify requires.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Spotify dashboard", href: "https://developer.spotify.com/dashboard" },
    guide: `${GUIDES}/spotify`,
    available: true,
  },
  {
    id: "notion",
    label: "Notion",
    icon: "logos:notion-icon",
    monochrome: true,
    protocol: "oauth2",
    email: "silent",
    emailNote: "Notion states nothing about the address in the grant, so nothing is joined on it.",
    defaultScopes: [],
    note: "Notion takes no scopes: an integration's capabilities are configured on the integration itself. Its token endpoint speaks JSON alone, and the person who authorized is named in the token response, because the endpoint that looks like a profile call describes the bot instead.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Notion integrations", href: "https://www.notion.so/my-integrations" },
    guide: `${GUIDES}/notion`,
    available: true,
  },
  {
    id: "figma",
    label: "Figma",
    icon: "logos:figma",
    monochrome: false,
    protocol: "oauth2",
    email: "silent",
    emailNote:
      "Figma confirms an address before an account can be used and asserts nothing in the payload, so nothing is joined on it.",
    defaultScopes: ["current_user:read"],
    note: "The scope is the narrow one. Asking for file access in order to sign somebody in is a consent screen that reads far worse than the product warrants.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Figma developer apps", href: "https://www.figma.com/developers/apps" },
    guide: `${GUIDES}/figma`,
    available: true,
  },
  {
    id: "kakao",
    label: "Kakao",
    icon: "simple-icons:kakaotalk",
    monochrome: false,
    protocol: "oauth2",
    clientIdLabel: "REST API key",
    email: "asserts",
    emailNote:
      "Kakao states it in two fields and both are read: whether the user verified the address, and whether Kakao still considers it theirs. The second goes false once the address has moved to another Kakao account.",
    defaultScopes: ["profile_nickname", "profile_image", "account_email"],
    note: "The REST flow rather than OIDC, because that is what an existing Kakao application is already set up for. Each profile field sits behind consent the user may decline, so a sign-in with no address at all is normal here.",
    fields: [],
    secret: CLIENT_SECRET,
    console: {
      label: "Kakao developers console",
      href: "https://developers.kakao.com/console/app",
    },
    guide: `${GUIDES}/kakao`,
    available: true,
  },
  {
    id: "line",
    label: "LINE",
    icon: "simple-icons:line",
    monochrome: false,
    tint: "text-[#06c755]",
    protocol: "oidc",
    clientIdLabel: "Channel ID",
    email: "silent",
    emailNote:
      "LINE confirms an address before attaching it and says nothing about it in the token, so nothing is joined on it. The claim is absent entirely until the channel is granted the email permission, which LINE reviews per application.",
    defaultScopes: ["openid", "profile", "email"],
    note: "The browser is sent to access.line.me while the token and key endpoints are on api.line.me. The issuer is the first of those, because an issuer is whoever made the assertion rather than whoever handed it over.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "LINE developers console", href: "https://developers.line.biz/console/" },
    guide: `${GUIDES}/line`,
    available: true,
  },
  {
    id: "zoom",
    label: "Zoom",
    icon: "logos:zoom-icon",
    monochrome: false,
    protocol: "oauth2",
    email: "asserts",
    emailNote:
      "Zoom says whether it confirmed the address, as 1 or 0. It is compared against 1, so anything else at all reads as unconfirmed.",
    defaultScopes: ["user:read:user"],
    note: "The client authenticates in the header, which Zoom requires.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Zoom app marketplace", href: "https://marketplace.zoom.us/develop/create" },
    guide: `${GUIDES}/zoom`,
    available: true,
  },
  {
    id: "oidc",
    label: "Generic OIDC",
    icon: "simple-icons:openid",
    monochrome: false,
    protocol: "oidc",
    email: "silent",
    emailNote: "Whatever the issuer asserts, once this connector exists.",
    defaultScopes: ["openid", "profile", "email"],
    note: "The enterprise connector for any compliant issuer. It ships with SAML, and nothing on this screen turns it on yet.",
    fields: [],
    secret: CLIENT_SECRET,
    console: { label: "Enterprise SSO", href: `${GUIDES}/oidc` },
    guide: `${GUIDES}/oidc`,
    available: false,
  },
];

/** Every provider that has an adapter, in the order the catalogue lists them. */
export const AVAILABLE_PROVIDERS: readonly ProviderInfo[] = PROVIDERS.filter(
  (provider) => provider.available,
);

export function providerInfo(id: ProviderName): ProviderInfo {
  // Every name in the union has an entry above, so the lookup cannot miss.
  return PROVIDERS.find((provider) => provider.id === id) as ProviderInfo;
}

/*
 * What a project configured.
 */

/** How the credentials are supplied. Mirrors `OauthMode` in @idenzy/protocol. */
export type ProviderMode = "instant" | "custom";

export interface ModeLook {
  label: string;
  detail: string;
}

export const MODE_LABELS: Record<ProviderMode, ModeLook> = {
  instant: {
    label: "Instant",
    detail:
      "Our shared OAuth app. Localhost and preview domains only, and our name on the consent screen.",
  },
  custom: {
    label: "Your own app",
    detail:
      "Your client credentials, your name on the consent screen. The only mode that works in front of real users.",
  },
};

/**
 * Where instant mode is allowed to return to (PROJECT.md 4.6). The server refuses
 * anything else, so the screen says so rather than letting somebody ship it.
 */
export const INSTANT_HOSTS = "localhost, 127.0.0.1 and *.idenzy.dev";

export interface ProviderConfig {
  enabled: boolean;
  mode: ProviderMode;
  clientId: string;
  /** Never read back. The panel knows only that one is stored, and when it was written. */
  secretSet: boolean;
  secretUpdatedAt: string | null;
  /** Empty means the provider's own defaults are requested. */
  scopes: readonly string[];
  /** The provider's extras, by the key each field names. */
  settings: Record<string, string>;
  /** Keep the provider's access and refresh tokens, envelope encrypted. Off by default. */
  storeTokens: boolean;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  enabled: false,
  mode: "custom",
  clientId: "",
  secretSet: false,
  secretUpdatedAt: null,
  scopes: [],
  settings: {},
  storeTokens: false,
};

/** The scopes actually requested: the project's, or the provider's own where it chose none. */
export function scopesOf(info: ProviderInfo, config: ProviderConfig): readonly string[] {
  return config.scopes.length > 0 ? config.scopes : info.defaultScopes;
}

/** Scopes as typed: split on whitespace and commas, deduplicated, order kept. */
export function parseScopes(text: string): string[] {
  const seen = new Set<string>();
  for (const scope of text.split(/[\s,]+/)) {
    if (scope !== "") seen.add(scope);
  }
  return [...seen];
}

/*
 * What the screen checks before anything is sent.
 */

/**
 * An https origin and nothing that could smuggle a second target past the check. The
 * same rule the GitLab adapter applies, because this string becomes the host a client
 * secret is posted to.
 */
export function isHttpsOrigin(value: string): boolean {
  const url = URL.parse(value.trim());
  if (url === null) return false;
  return url.protocol === "https:" && url.username === "" && url.search === "";
}

/** The instance as the server stores it: origin and path, no trailing slash. */
export function normaliseInstance(value: string): string {
  const url = URL.parse(value.trim());
  if (url === null) return value.trim();
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

const TENANT = /^(common|organizations|consumers|[a-z0-9-]{3,64}(\.[a-z0-9-]{2,63})*)$/i;

export type ProviderIssueCode =
  | "client_id_missing"
  | "client_secret_missing"
  | "field_missing"
  | "instance_invalid"
  | "tenant_invalid"
  | "signing_key_invalid";

/** One refused value, named by the field it belongs to so the dialog can put it there. */
export interface ProviderIssue {
  /** `clientId`, `clientSecret`, or the key of a provider field. */
  field: string;
  code: ProviderIssueCode;
}

export const PROVIDER_ISSUE_LABELS: Record<ProviderIssueCode, string> = {
  client_id_missing: "The client id from the provider console.",
  client_secret_missing: "The secret, which is stored encrypted and never shown again.",
  field_missing: "Required for this provider.",
  instance_invalid: "An https origin, with no credentials and no query.",
  tenant_invalid: "A directory ID, or one of common, organizations and consumers.",
  signing_key_invalid: "A PKCS#8 key, pasted whole, beginning -----BEGIN PRIVATE KEY-----.",
};

/** What is being written, as the dialog holds it. */
export interface ProviderDraft {
  mode: ProviderMode;
  clientId: string;
  /** Blank when an existing secret is being kept. */
  clientSecret: string;
  /** As typed. Ignored unless `customScopes`. */
  scopes: string;
  customScopes: boolean;
  settings: Record<string, string>;
  storeTokens: boolean;
}

/** The draft a dialog opens with: the saved configuration, or an empty one. */
export function draftFrom(info: ProviderInfo, config: ProviderConfig | null): ProviderDraft {
  const saved = config ?? DEFAULT_PROVIDER_CONFIG;
  return {
    mode: saved.mode,
    clientId: saved.clientId,
    clientSecret: "",
    scopes: saved.scopes.join(" "),
    customScopes: saved.scopes.length > 0,
    settings: Object.fromEntries(
      info.fields.map((field) => [field.key, saved.settings[field.key] ?? ""]),
    ),
    storeTokens: saved.storeTokens,
  };
}

/**
 * Everything refused, in the order the fields are shown.
 *
 * `secretStored` is what makes editing an existing provider possible without retyping a
 * secret nobody can read back: a blank secret is a keep, not a clear.
 */
export function validateProvider(
  info: ProviderInfo,
  draft: ProviderDraft,
  secretStored: boolean,
): ProviderIssue[] {
  // Instant mode carries our credentials, so there is nothing here for a project to get
  // wrong and nothing to check.
  if (draft.mode === "instant") return [];

  const issues: ProviderIssue[] = [];
  if (draft.clientId.trim() === "") {
    issues.push({ field: "clientId", code: "client_id_missing" });
  }

  const secret = secretIssue(info, draft.clientSecret.trim(), secretStored);
  if (secret !== null) issues.push({ field: "clientSecret", code: secret });

  for (const field of info.fields) {
    const code = fieldIssue(field, (draft.settings[field.key] ?? "").trim());
    if (code !== null) issues.push({ field: field.key, code });
  }

  return issues;
}

/** A blank secret is a keep where one is stored, and a missing value where none is. */
function secretIssue(
  info: ProviderInfo,
  secret: string,
  stored: boolean,
): ProviderIssueCode | null {
  if (secret === "") return stored ? null : "client_secret_missing";
  // The one multiline secret is Apple's signing key, and a value that is not a PEM block
  // fails inside `importPKCS8` at the first sign-in rather than here.
  if (info.secret.multiline && !secret.startsWith("-----BEGIN")) return "signing_key_invalid";
  return null;
}

/** The two extras that are checked rather than merely required, and why each is. */
function fieldIssue(field: ProviderField, value: string): ProviderIssueCode | null {
  if (value === "") return field.required ? "field_missing" : null;
  if (field.key === "instance" && !isHttpsOrigin(value)) return "instance_invalid";
  if (field.key === "tenant" && !TENANT.test(value)) return "tenant_invalid";
  return null;
}

/** The message for one issue: the field's own words where it has them. */
export function issueLabel(info: ProviderInfo, issue: ProviderIssue): string {
  if (issue.code === "field_missing" || issue.code === "instance_invalid") {
    const field = info.fields.find((entry) => entry.key === issue.field);
    if (field) return field.issue;
  }
  return PROVIDER_ISSUE_LABELS[issue.code];
}

/** The issue on one field, for the message under it. */
export function issueFor(
  info: ProviderInfo,
  issues: readonly ProviderIssue[],
  field: string,
): string {
  const found = issues.find((issue) => issue.field === field);
  return found === undefined ? "" : issueLabel(info, found);
}

/*
 * The flow, as the server runs it, for the rows that state it.
 */

/**
 * Where the provider sends the browser back to. Ours, not the customer's route, and the
 * one value a provider console needs from this screen.
 */
export function callbackUri(baseUrl: string, id: ProviderName): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/auth/oauth/${id}/callback`;
}

/** The same URL with the provider left as a placeholder, for the row that states the shape. */
export function callbackShape(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/auth/oauth/{provider}/callback`;
}

/** The deployment's defaults, from packages/config's schema. */
export const FLOW = {
  /** `OAUTH_FLOW_TTL_SECONDS`: how long a started authorization may take to come back. */
  flowMinutes: 10,
  /** `AUTH_CODE_TTL_SECONDS`: how long the code we hand the customer's route stays good. */
  exchangeMinutes: 2,
  challengeMethod: "S256",
} as const;

/** What the SDK is told when an address matched but nobody proved it. */
export const LINKING_ERROR = "linking_requires_verification";
