/**
 * What a project decides about passkeys, which is one thing: the relying party. The
 * rest of WebAuthn is fixed by the server on purpose (apps/auth-api/src/passkey), and the
 * facts are listed here so the screen states them rather than hiding them.
 *
 * The relying party matters more than any switch. The RP ID decides which credentials an
 * assertion may address, so it is configured and never read off the request's Host; a
 * second RP ID would split a customer's passkeys into two sets that cannot substitute for
 * each other, which is why there is exactly one per project. The origins are the pages
 * allowed to run a ceremony, matched exactly: WebAuthn permits an origin only on the RP
 * ID's own registrable domain, and a wildcard would be a hole in that rule.
 */

import { plural, type SetupBlocker, type SetupCheck } from "./setup-check";

export interface RelyingParty {
  /** The registrable domain the passkeys belong to: `example.com`. */
  rpId: string;
  /** Shown by the authenticator when it asks. The customer's product name, not ours. */
  rpName: string;
  /** Scheme, host and port, exact. */
  origins: string[];
}

export interface PasskeySettings {
  enabled: boolean;
  /** Null until the project has one, and nothing passkey works until it does. */
  relyingParty: RelyingParty | null;
}

export const DEFAULT_PASSKEY_SETTINGS: PasskeySettings = { enabled: true, relyingParty: null };

/*
 * The ceremony as the server runs it, for the rows that say so.
 */
export const CEREMONY = {
  /** COSE identifiers, in the order advertised and accepted. */
  algorithms: [
    { cose: -8, name: "Ed25519" },
    { cose: -7, name: "ES256" },
    { cose: -257, name: "RS256" },
  ],
  /** The deployment's `WEBAUTHN_CHALLENGE_TTL_SECONDS`, whose default this is. */
  challengeTtlSeconds: 300,
} as const;

/** One line of the sample: a key as the browser is given it, and its value as JSON. */
export interface CeremonyOption {
  name: string;
  value: string;
}

/**
 * What the SDK hands `navigator.credentials.create`, assembled from the project's relying
 * party and the fixed rules above. It lives here so the sample and the rows describing it
 * cannot drift apart: every value in it is read from the same constants the rows are.
 */
export function creationOptions(party: RelyingParty): CeremonyOption[] {
  return [
    {
      name: "rp",
      value: `{ "id": ${JSON.stringify(party.rpId)}, "name": ${JSON.stringify(party.rpName)} }`,
    },
    {
      name: "authenticatorSelection",
      value: '{ "residentKey": "required", "userVerification": "required" }',
    },
    { name: "attestation", value: '"none"' },
    {
      name: "pubKeyCredParams",
      value: `[${CEREMONY.algorithms.map((algorithm) => `{ "alg": ${algorithm.cose} }`).join(", ")}]`,
    },
  ];
}

/*
 * Relying party rules.
 */

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$|^localhost$/;

/** A registrable domain, lower case, with no scheme, port or path. */
export function isRpId(value: string): boolean {
  return HOSTNAME.test(value.trim().toLowerCase());
}

export type OriginIssue = "origin_invalid" | "origin_insecure" | "origin_outside_rp";

export const ORIGIN_ISSUE_LABELS: Record<OriginIssue, string> = {
  origin_invalid: "A URL is a scheme, a host and an optional port: https://app.example.com.",
  origin_insecure: "WebAuthn needs https, except on localhost.",
  origin_outside_rp: "The host must be the passkey domain or a subdomain of it.",
};

/** The origin normalised, or null if the text is not one. */
export function parseOrigin(value: string): URL | null {
  const text = value.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const bare = `${url.protocol}//${url.host}`;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" || text.replace(/\/$/, "").toLowerCase() !== bare.toLowerCase()) {
    return null;
  }
  return url;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateOrigin(value: string, rpId: string): OriginIssue | null {
  const url = parseOrigin(value);
  if (url === null) return "origin_invalid";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return "origin_insecure";
  }
  const host = url.hostname.toLowerCase();
  const id = rpId.trim().toLowerCase();
  if (host !== id && !host.endsWith(`.${id}`)) return "origin_outside_rp";
  return null;
}

/** The origin as it is stored: lower case, no trailing slash. */
export function normaliseOrigin(value: string): string {
  const url = parseOrigin(value);
  return url === null ? value.trim() : `${url.protocol}//${url.host}`.toLowerCase();
}

export type RelyingPartyIssue = "rp_id_invalid" | "rp_name_missing" | "origins_empty" | OriginIssue;

export const RP_ISSUE_LABELS: Record<RelyingPartyIssue, string> = {
  rp_id_invalid: "A domain such as example.com, with no scheme, port or path.",
  rp_name_missing: "The name the authenticator shows. Usually your product's.",
  origins_empty: "At least one application URL, or every ceremony is refused.",
  ...ORIGIN_ISSUE_LABELS,
};

export function validateRelyingParty(party: RelyingParty): RelyingPartyIssue[] {
  const issues: RelyingPartyIssue[] = [];
  if (!isRpId(party.rpId)) issues.push("rp_id_invalid");
  if (party.rpName.trim() === "") issues.push("rp_name_missing");
  if (party.origins.length === 0) issues.push("origins_empty");
  for (const origin of party.origins) {
    const issue = validateOrigin(origin, party.rpId);
    if (issue !== null && !issues.includes(issue)) issues.push(issue);
  }
  return issues;
}

/*
 * Authenticators, by the AAGUID a registration carries. The registry is the community
 * list at github.com/passkeydeveloper/passkey-authenticator-aaguids; a few of the
 * entries an operator will actually meet, so the breakdown can name them. Anything
 * else is "another authenticator", never a guess.
 */
export interface Authenticator {
  name: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /**
   * A text colour class for a logo drawn in one colour, which takes ours unless it is
   * given one. Empty for a mark that carries its own colours. The tints are theme
   * tokens rather than brand hexes: see `--idenzy-mark-*` in theme.css.
   */
  tint: string;
}

export const AUTHENTICATORS: Record<string, Authenticator> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": {
    name: "iCloud Keychain",
    /* `simple-icons:apple` and not `logos:apple`: the logos one paints a fixed black,
       which no colour class can reach, so it can only be inverted. This one is drawn in
       `currentColor` and takes the token like every other single-colour mark here. */
    icon: "simple-icons:apple",
    tint: "text-mark-apple",
  },
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": {
    name: "iCloud Keychain",
    icon: "simple-icons:apple",
    tint: "text-mark-apple",
  },
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": {
    name: "Google Password Manager",
    icon: "logos:google-icon",
    tint: "",
  },
  "adce0002-35bc-c60a-648b-0b25f1f05503": {
    name: "Chrome on Mac",
    icon: "logos:chrome",
    tint: "",
  },
  "08987058-cadc-4b81-b6e1-30de50dcbe96": {
    name: "Windows Hello",
    icon: "logos:microsoft-icon",
    tint: "",
  },
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": {
    name: "Windows Hello",
    icon: "logos:microsoft-icon",
    tint: "",
  },
  "bada5566-a7aa-401f-bd96-45619a55120d": {
    name: "1Password",
    icon: "simple-icons:1password",
    tint: "text-mark-onepassword",
  },
  "d548826e-79b4-db40-a3d8-11116f7e8349": {
    name: "Bitwarden",
    icon: "simple-icons:bitwarden",
    tint: "text-mark-bitwarden",
  },
  "531126d6-e717-415c-9320-3d9aa6981239": {
    name: "Dashlane",
    icon: "simple-icons:dashlane",
    tint: "text-mark-dashlane",
  },
  "ee882879-721c-4913-9775-3dfcce97072a": {
    name: "YubiKey 5 Series",
    icon: "simple-icons:yubico",
    tint: "text-mark-yubico",
  },
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": {
    name: "YubiKey 5 NFC",
    icon: "simple-icons:yubico",
    tint: "text-mark-yubico",
  },
  "53414d53-554e-4700-0000-000000000000": {
    name: "Samsung Pass",
    icon: "simple-icons:samsung",
    tint: "text-mark-samsung",
  },
};

export const UNKNOWN_AUTHENTICATOR: Authenticator = {
  name: "Another authenticator",
  icon: "material-symbols:passkey",
  tint: "text-ink/55",
};

export function authenticatorOf(aaguid: string | null): Authenticator {
  if (aaguid === null) return UNKNOWN_AUTHENTICATOR;
  return AUTHENTICATORS[aaguid.toLowerCase()] ?? UNKNOWN_AUTHENTICATOR;
}

/*
 * Whether the project is set up, and what it is waiting on.
 *
 * Four things have to be true before a browser can complete a ceremony, and only two of
 * them are on the passkey screen. The other two are why this exists rather than a badge:
 * an origin that is not on the project's CORS allowlist is refused by the browser with
 * nothing in our logs to explain it (ADR-0006), and a project nobody has integrated yet
 * looks identical to one whose integration is broken.
 */

export interface PasskeySetupInput {
  enabled: boolean;
  party: RelyingParty | null;
  /** The project's CORS allowlist (`project_origins`), which is not this list. */
  allowedOrigins: readonly string[];
  /** Ceremonies seen over the window, so a live integration can be reported as one. */
  ceremonies: number;
}

/** Whether the domain is one WebAuthn will accept. Nothing else can pass while it is not. */
function domainCheck(party: RelyingParty | null): SetupCheck {
  return {
    id: "domain",
    label: "Passkey domain",
    state: party !== null && isRpId(party.rpId) ? "pass" : "fail",
    finding:
      party === null
        ? "No domain set, so every registration and every assertion is refused."
        : `Passkeys on this project are bound to ${party.rpId} and answer nowhere else.`,
  };
}

/** Whether every allowed URL is one a ceremony could actually run from. */
function urlCheck(party: RelyingParty | null): SetupCheck {
  const origins = party?.origins ?? [];
  const refused =
    party === null ? [] : origins.filter((origin) => validateOrigin(origin, party.rpId) !== null);

  if (origins.length === 0) {
    return {
      id: "urls",
      label: "Application URLs",
      state: "fail",
      finding: "No URL is allowed to run a ceremony, which refuses all of them.",
    };
  }
  return {
    id: "urls",
    label: "Application URLs",
    state: refused.length > 0 ? "fail" : "pass",
    finding:
      refused.length > 0
        ? `${plural(refused.length, "URL is", "URLs are")} not on the passkey domain, and a ceremony from there is refused.`
        : `${plural(origins.length, "URL", "URLs")} on the passkey domain, over https, matched exactly.`,
  };
}

/**
 * Whether those URLs may also read our answers. WebAuthn confines a ceremony to the
 * relying party's domain and CORS does not, so the two lists are separate and a URL
 * missing from the second fails in the browser with nothing in our logs (ADR-0006).
 */
function corsCheck(party: RelyingParty | null, allowedOrigins: readonly string[]): SetupCheck {
  const origins = party?.origins ?? [];
  const allowed = new Set(allowedOrigins.map(normaliseOrigin));
  const uncovered = origins.filter((origin) => !allowed.has(normaliseOrigin(origin)));

  if (origins.length === 0) {
    return {
      id: "cors",
      label: "Browsers may call the API",
      state: "warn",
      finding: "Nothing to check until a URL is allowed.",
    };
  }
  return {
    id: "cors",
    label: "Browsers may call the API",
    state: uncovered.length > 0 ? "warn" : "pass",
    finding:
      uncovered.length > 0
        ? `${plural(uncovered.length, "URL is", "URLs are")} missing from the CORS allowlist, so the browser discards our answer and the request looks fine in our logs.`
        : "Every URL here is on the CORS allowlist, so the ceremony's own calls are answered.",
    ...(uncovered.length > 0 ? { fix: { label: "Allowed origins", to: "/domains/origins" } } : {}),
  };
}

/** Whether anything has actually run, which is the difference between quiet and broken. */
function integrationCheck(ceremonies: number): SetupCheck {
  return {
    id: "integration",
    label: "Ceremonies reaching us",
    state: ceremonies > 0 ? "pass" : "warn",
    finding:
      ceremonies > 0
        ? `${plural(ceremonies, "ceremony", "ceremonies")} in the last 30 days, so the SDK is wired up and reaching this project.`
        : "Nothing has reached us in 30 days. Expected on a project nobody has integrated yet, and the first thing to look at on one that is.",
  };
}

/** The four checks, in the order they have to pass. */
export function evaluatePasskeySetup(input: PasskeySetupInput): SetupCheck[] {
  return [
    domainCheck(input.party),
    urlCheck(input.party),
    corsCheck(input.party, input.allowedOrigins),
    integrationCheck(input.ceremonies),
  ];
}

/** What is stopping a passkey sign-in today. Empty is the whole of "ready". */
export function passkeyBlockers(input: PasskeySetupInput): SetupBlocker[] {
  const blockers: SetupBlocker[] = [];
  if (input.party === null) {
    blockers.push({
      id: "party",
      title: "No passkey domain yet",
      detail:
        "A passkey is bound to a domain, and until this project names one every registration and every assertion is refused. The SDK reports that as a configuration error rather than a failed sign-in.",
      action: "Complete setup",
    });
  }
  if (!input.enabled) {
    blockers.push({
      id: "disabled",
      title: "Passkey sign-in is switched off",
      detail:
        "The ceremony endpoints answer as if the method did not exist, whatever is configured here. Credentials already enrolled are kept for when it is back.",
      action: "Turn it on",
    });
  }
  return blockers;
}

/**
 * Where an authenticator's passkeys live, in a line: synced to the maker's cloud, bound
 * to the device that made them, or some of each.
 *
 * The wording matters more than the arithmetic. A synced passkey survives a lost phone
 * and a device-bound one does not, so a project whose passkeys are mostly device-bound
 * is a project whose recovery codes are load-bearing.
 */
export function backupLine(count: number, backedUp: number): string {
  if (count === 0) return "Nothing enrolled.";
  if (backedUp === count) return count === 1 ? "Synced to a cloud." : "All synced to a cloud.";
  if (backedUp === 0) {
    return count === 1 ? "Bound to its device." : "All bound to their device.";
  }
  return `${backedUp} synced, ${count - backedUp} on the device.`;
}
