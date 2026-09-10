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
  origin_invalid: "An origin is a scheme, a host and an optional port: https://app.example.com.",
  origin_insecure: "WebAuthn needs https, except on localhost.",
  origin_outside_rp: "The host must be the RP ID or a subdomain of it.",
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
  rp_name_missing: "The name the authenticator shows. Usually the product's.",
  origins_empty: "At least one origin, or every ceremony is refused.",
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
  monochrome: boolean;
}

export const AUTHENTICATORS: Record<string, Authenticator> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": {
    name: "iCloud Keychain",
    icon: "logos:apple",
    monochrome: true,
  },
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": {
    name: "iCloud Keychain",
    icon: "logos:apple",
    monochrome: true,
  },
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": {
    name: "Google Password Manager",
    icon: "logos:google-icon",
    monochrome: false,
  },
  "adce0002-35bc-c60a-648b-0b25f1f05503": {
    name: "Chrome on Mac",
    icon: "logos:chrome",
    monochrome: false,
  },
  "08987058-cadc-4b81-b6e1-30de50dcbe96": {
    name: "Windows Hello",
    icon: "logos:microsoft-icon",
    monochrome: false,
  },
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": {
    name: "Windows Hello",
    icon: "logos:microsoft-icon",
    monochrome: false,
  },
  "bada5566-a7aa-401f-bd96-45619a55120d": {
    name: "1Password",
    icon: "simple-icons:1password",
    monochrome: true,
  },
  "d548826e-79b4-db40-a3d8-11116f7e8349": {
    name: "Bitwarden",
    icon: "simple-icons:bitwarden",
    monochrome: true,
  },
  "531126d6-e717-415c-9320-3d9aa6981239": {
    name: "Dashlane",
    icon: "simple-icons:dashlane",
    monochrome: true,
  },
  "ee882879-721c-4913-9775-3dfcce97072a": {
    name: "YubiKey 5 Series",
    icon: "simple-icons:yubico",
    monochrome: true,
  },
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": {
    name: "YubiKey 5 NFC",
    icon: "simple-icons:yubico",
    monochrome: true,
  },
  "53414d53-554e-4700-0000-000000000000": {
    name: "Samsung Pass",
    icon: "simple-icons:samsung",
    monochrome: true,
  },
};

export const UNKNOWN_AUTHENTICATOR: Authenticator = {
  name: "Another authenticator",
  icon: "material-symbols:passkey",
  monochrome: false,
};

export function authenticatorOf(aaguid: string | null): Authenticator {
  if (aaguid === null) return UNKNOWN_AUTHENTICATOR;
  return AUTHENTICATORS[aaguid.toLowerCase()] ?? UNKNOWN_AUTHENTICATOR;
}
