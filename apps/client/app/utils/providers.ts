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
 *
 * What a return URL may be is imported from `./otp` rather than written again. Both
 * kinds are rows of `redirect_uris` and the rule is the table's rather than either
 * screen's: the whole URL, matched exactly, http on localhost alone, no fragment, and no
 * `code` already in the query because the redirect adds one.
 */

import { originOf, validateAllowedOrigin } from "./origins";
import { REDIRECT_ISSUE_LABELS, validateRedirectUri } from "./otp";
import { plural, type SetupBlocker, type SetupCheck } from "./setup-check";

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

const GUIDES = "https://idenzy.io/docs/providers";

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
export const INSTANT_HOSTS = "localhost, 127.0.0.1 and *.idenzy.io";

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
  /**
   * When a real sign-in was last started from the panel, and nothing about how it ended.
   *
   * The one thing nobody here can check is whether the provider console holds our
   * callback: a wrong redirect URI is refused at their consent screen and never reaches
   * us. Only a real sign-in exercises it, and where that sign-in ends up is the
   * customer's own return page rather than this one, so what is recorded is that it was
   * tried. Everything else about a provider is derived from the row every time it is
   * asked for, so no stamp can outlive the thing it was a verdict on.
   */
  testedAt: string | null;
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
  testedAt: null,
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
 * Configured, and working, which are not the same question.
 *
 * A provider can be switched off, set up with a field missing, running on our shared app,
 * never checked, or actually taking sign-ins. Answering all five with "On" tells an
 * operator the one thing they already knew and hides the four that would explain why
 * nobody can sign in.
 */

export type ProviderReadiness = "incomplete" | "off" | "development" | "untested" | "ready";

export interface ReadinessLook {
  label: string;
  /** One line under the name, saying what that state means for a user right now. */
  detail: string;
  /** The words on the row's own button, which is what settles this state. */
  action: string;
}

export const READINESS: Record<ProviderReadiness, ReadinessLook> = {
  incomplete: {
    label: "Setup incomplete",
    detail: "Something the token endpoint needs is missing, so a sign-in fails at the exchange.",
    action: "Finish setup",
  },
  off: {
    label: "Off",
    detail: "The endpoints answer as though the provider were never configured.",
    action: "Manage",
  },
  development: {
    label: "Development only",
    detail: `Our shared OAuth app: our name on the consent screen, and refused anywhere but ${INSTANT_HOSTS}.`,
    action: "Use your own app",
  },
  untested: {
    label: "Not tested",
    detail:
      "On and complete. Nobody has run a sign-in through it from here, and the redirect URI in the provider console is the one thing this end cannot see.",
    action: "Test it",
  },
  ready: {
    label: "Ready",
    detail: "On, complete, and a real sign-in has been through it.",
    action: "Manage",
  },
};

/**
 * What the credential set is still missing, in the field names the provider console uses.
 * Empty for instant mode, which carries ours and has nothing for a project to get wrong.
 */
export function missingFor(info: ProviderInfo, config: ProviderConfig): string[] {
  if (config.mode === "instant") return [];

  const missing: string[] = [];
  if (config.clientId.trim() === "") missing.push(info.clientIdLabel ?? "Client ID");
  if (!config.secretSet) missing.push(info.secret.label);
  for (const field of info.fields) {
    if (field.required && (config.settings[field.key] ?? "").trim() === "") {
      missing.push(field.label);
    }
  }
  return missing;
}

/**
 * The one state a row leads with.
 *
 * A gap comes before a decision, because turning on a provider that cannot finish an
 * exchange changes nothing a user would notice. Off comes before the shared app, because
 * a provider nobody can reach is not restricted to localhost, it is closed.
 */
export function readinessOf(info: ProviderInfo, config: ProviderConfig): ProviderReadiness {
  if (missingFor(info, config).length > 0) return "incomplete";
  if (!config.enabled) return "off";
  if (config.mode === "instant") return "development";
  return config.testedAt === null ? "untested" : "ready";
}

/*
 * Where a sign-in comes back to.
 *
 * Two different destinations wear the word "redirect" in this flow and confusing them is
 * the most common way a first setup fails. Ours is what the provider console holds and is
 * fixed by the deployment; theirs is what we send the browser to afterwards with a code,
 * and is a row of `redirect_uris` under the `oauth` kind. Neither is a CORS origin.
 */

/** The issue with a return URL somebody typed, in its own words, or "". */
export function returnUriIssue(value: string, held: readonly string[]): string {
  const text = value.trim();
  if (text === "") return "";
  const refused = validateRedirectUri(text);
  if (refused !== null) return REDIRECT_ISSUE_LABELS[refused];
  return held.includes(text) ? "Already registered on this project." : "";
}

/** The return URLs whose origin a browser could not read a credentialed response from. */
export function returnUrisMissingOrigin(
  returnUris: readonly string[],
  allowedOrigins: readonly string[],
): string[] {
  const allowed = new Set(allowedOrigins.map((entry) => entry.toLowerCase()));
  const out: string[] = [];
  for (const uri of returnUris) {
    const origin = originOf(uri);
    // A native scheme has no origin and a loopback one is never on the list; neither is
    // a gap, so neither is counted as one.
    if (origin === null || allowed.has(origin)) continue;
    if (validateAllowedOrigin(origin, []) !== null) continue;
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

/*
 * Whether the method works at all, which is a project-wide question and not a provider's.
 */

export interface ProviderSetupInput {
  providers: readonly { info: ProviderInfo; config: ProviderConfig }[];
  /** Rows of `redirect_uris` under the `oauth` kind. Shared by every provider. */
  returnUris: readonly string[];
  /** The CORS allowlist, which the exchange call needs and the redirect does not. */
  allowedOrigins: readonly string[];
}

/** The providers a sign-in could actually be started with today. */
function live(input: ProviderSetupInput) {
  return input.providers.filter(
    (entry) => entry.config.enabled && missingFor(entry.info, entry.config).length === 0,
  );
}

/**
 * What is stopping social sign-in on this project, each of which is settled from this
 * screen. A provider missing a field is not here: that is one provider's problem and its
 * own row says so.
 */
export function providerBlockers(input: ProviderSetupInput): SetupBlocker[] {
  const blockers: SetupBlocker[] = [];

  if (input.providers.length === 0) {
    blockers.push({
      id: "none",
      title: "No provider set up yet",
      detail:
        "Nobody can sign in with Google, Apple or any of the other sixteen until one is added here. Each takes a client id and a secret from that provider's console.",
      action: "Add a provider",
    });
  } else if (live(input).length === 0) {
    blockers.push({
      id: "nothing-live",
      title: "Nothing a user could sign in with",
      detail:
        "Every provider on this project is switched off or missing part of its credentials, so the start endpoint answers as though none were configured.",
      action: "Manage providers",
    });
  }

  /* A provider that is off and incomplete is one row's problem. One that is on and
     incomplete fails after the user has already consented, which is nobody's fault they
     can see, so it belongs at the top of the screen. */
  const broken = input.providers.filter(
    (entry) => entry.config.enabled && missingFor(entry.info, entry.config).length > 0,
  );
  for (const entry of broken) {
    blockers.push({
      id: `broken-${entry.info.id}`,
      title: `${entry.info.label} is on and incomplete`,
      detail: `${missingFor(entry.info, entry.config).join(" and ")} ${missingFor(entry.info, entry.config).length === 1 ? "is" : "are"} missing, so the exchange fails after the user has already agreed at ${entry.info.label}. They see an error and you see a refused sign-in.`,
      action: "Finish setup",
    });
  }

  if (input.returnUris.length === 0) {
    blockers.push({
      id: "return",
      title: "No return URL registered",
      detail:
        "After the exchange we send the browser to a URL you registered, carrying a single-use code. There is none, so a start naming any URL at all is refused before the user leaves your page.",
      action: "Add a return URL",
    });
  }

  return blockers;
}

/**
 * The four things that have to be true before a social sign-in completes, with what was
 * found against each. Two of them are settled on other screens, which is the reason this
 * exists rather than a badge saying "On".
 */
export function evaluateProviderSetup(input: ProviderSetupInput): SetupCheck[] {
  const running = live(input);
  const instant = running.filter((entry) => entry.config.mode === "instant");
  const orphaned = returnUrisMissingOrigin(input.returnUris, input.allowedOrigins);

  return [
    {
      id: "provider",
      label: "A provider a user can pick",
      state: running.length === 0 ? "fail" : "pass",
      finding:
        running.length === 0
          ? "Nothing on this project is both switched on and completely configured, so the start endpoint has nothing to offer."
          : `${plural(running.length, "provider is", "providers are")} on and complete: ${running.map((entry) => entry.info.label).join(", ")}.`,
    },
    {
      id: "return",
      label: "Somewhere to come back to",
      state: input.returnUris.length === 0 ? "fail" : "pass",
      finding:
        input.returnUris.length === 0
          ? "No return URL is registered, so every start is refused before the browser leaves your page."
          : `${plural(input.returnUris.length, "URL is", "URLs are")} registered. A start naming anything else is refused, and the error never echoes the URL back.`,
    },
    {
      id: "cors",
      label: "The return page may call the API",
      state: orphaned.length === 0 ? "pass" : "warn",
      finding:
        orphaned.length === 0
          ? "Every return URL that has an origin is on the CORS allowlist, so the page can exchange its code."
          : `${orphaned.join(", ")} ${orphaned.length === 1 ? "is" : "are"} not on the CORS allowlist. The redirect lands, and the browser then refuses the exchange call with nothing in our logs to explain it.`,
      fix: { label: "Allowed origins", to: "/domains/origins" },
    },
    {
      id: "instant",
      label: "Your own OAuth app",
      state: instant.length === 0 ? "pass" : "warn",
      finding:
        instant.length === 0
          ? "Every provider that is on carries your own client credentials."
          : `${instant.map((entry) => entry.info.label).join(", ")} ${instant.length === 1 ? "is" : "are"} on our shared app, which shows our name on the consent screen and is refused anywhere but ${INSTANT_HOSTS}.`,
    },
  ];
}

/**
 * The same question asked of one provider, for the last step of its setup.
 *
 * Four rows and not five: whether the provider console holds our callback is deliberately
 * absent, because a check that cannot be run must not be drawn as one that passed. That
 * one is stated beside the list and settled by the sign-in test under it.
 */
export function evaluateProviderChecks(
  info: ProviderInfo,
  config: ProviderConfig,
  project: { returnUris: readonly string[]; allowedOrigins: readonly string[] },
): SetupCheck[] {
  const missing = missingFor(info, config);
  const orphaned = returnUrisMissingOrigin(project.returnUris, project.allowedOrigins);

  return [
    {
      id: "credentials",
      label: "Credentials complete",
      state: missing.length === 0 ? "pass" : "fail",
      finding:
        missing.length === 0
          ? config.mode === "instant"
            ? "Our shared app carries the credentials, so there is nothing here to fill in."
            : `Everything ${info.label}'s token endpoint needs is stored.`
          : `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing, so the exchange fails after the user has already consented.`,
    },
    {
      id: "enabled",
      label: "Switched on",
      state: config.enabled ? "pass" : "warn",
      finding: config.enabled
        ? `A start naming ${info.label} is accepted.`
        : `The endpoints answer as though ${info.label} were never configured. Saving from here turns it on.`,
    },
    {
      id: "return",
      label: "Somewhere to come back to",
      state: project.returnUris.length === 0 ? "fail" : "pass",
      finding:
        project.returnUris.length === 0
          ? "No return URL is registered on this project, so a start is refused before the browser leaves your page."
          : `${plural(project.returnUris.length, "URL is", "URLs are")} registered, shared by every provider here.`,
    },
    {
      id: "cors",
      label: "The return page may call the API",
      state: orphaned.length === 0 ? "pass" : "warn",
      finding:
        orphaned.length === 0
          ? "Every return URL that has an origin is on the CORS allowlist."
          : `${orphaned.join(", ")} ${orphaned.length === 1 ? "is" : "are"} not on the CORS allowlist, so the redirect lands and the exchange call after it is refused by the browser.`,
      fix: { label: "Allowed origins", to: "/domains/origins" },
    },
  ];
}

/*
 * What linking actually does, in the three cases a customer asks about.
 */

export interface LinkingExample {
  id: string;
  /** What arrived, in the reader's terms rather than the payload's. */
  situation: string;
  /** What happens to the person, in one short phrase. */
  outcome: string;
  detail: string;
  /** Written out beside the mark, because a colour is not an outcome. */
  tone: "join" | "verify" | "new";
}

/**
 * The same three questions every customer asks about linking, answered against the rule
 * this project is running under. The first answer moves with the switch; the other two
 * never do, which is the point of showing all three together.
 */
export function linkingExamples(autoLink: boolean): LinkingExample[] {
  return [
    {
      id: "verified",
      situation: "Google hands over ada@acme.com and states it is verified",
      outcome: autoLink ? "Signed into the account that holds it" : "Sent through an email code",
      detail: autoLink
        ? "The provider proved the address, so the sign-in joins the account already holding it and the person keeps their password, their passkeys and their history."
        : "The rule is off, so a proved address is treated like an unproved one: a code goes to ada@acme.com and the accounts are joined once it comes back.",
      tone: autoLink ? "join" : "verify",
    },
    {
      id: "unverified",
      situation: "Twitch hands over ada@acme.com and states nothing about it",
      outcome: "Sent through an email code",
      detail: `Nothing is ever joined on an address a provider did not prove, whatever the rule above says. The sign-in is answered ${LINKING_ERROR} and your screen sends them through a code, which is a detour rather than a refusal.`,
      tone: "verify",
    },
    {
      id: "none",
      situation: "X hands over an account with no address at all",
      outcome: "A new account",
      detail:
        "There is nothing to match on, so a new user is created with the X identity attached. Your own screens collect an address afterwards if the product needs one.",
      tone: "new",
    },
    {
      id: "relay",
      situation: "Apple hands over a privaterelay.appleid.com address",
      outcome: autoLink ? "Signed in, as a different person" : "Sent through an email code",
      detail:
        "A relay address is real, deliverable and verified, and it is a different one at every product somebody signs into. Somebody who used Apple here and their own address elsewhere is two accounts, which is Apple working as designed rather than linking failing.",
      tone: autoLink ? "join" : "verify",
    },
  ];
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
