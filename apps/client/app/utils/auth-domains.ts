/**
 * A custom auth domain: the host a customer's own pages send their API calls to
 * (PROJECT.md 4.3, `apps/auth-api/src/session/session-transport.guard.ts`).
 *
 * The sentence this whole screen exists to say is that an auth domain is an API host and
 * never a page. `auth.customer.com` is a CNAME at our load balancer that a customer's
 * React or Nuxt page sends `fetch` calls to. Nobody navigates to it, it serves no HTML,
 * and the sign-in screen stays wherever the customer put it. "You need an auth domain"
 * reads as "we host your sign-in screen", which is the one thing this product does not do
 * (ADR-0002), so the wording here is deliberate everywhere it appears.
 *
 * It shares `project_domains` with sending domains and is deliberately its own model
 * anyway: the records are a CNAME and a certificate authorisation rather than DKIM and
 * SPF, verification means a load balancer answering rather than a mail identity, and what
 * breaks when it is wrong is a browser dropping a cookie rather than a message bouncing.
 * The one thing they do share is stated on both screens, because the index is on the
 * domain alone: a hostname belongs to one project, whatever it is for.
 */

import { isRpId } from "./passkeys";

/**
 * Where a project lives without one, and the reason a project can ignore this screen
 * entirely: header mode works on the shared host and always has.
 */
export const SHARED_API_HOST = "api.idenzy.io";

/** What the CNAME points at. Our global load balancer, the same one for every customer. */
export const LOAD_BALANCER_TARGET = "edge.idenzy.io";

/** The label the certificate authorisation record hangs off. */
export const CERT_AUTH_PREFIX = "_acme-challenge";

/*
 * The records.
 */

export type AuthRecordKind = "cname" | "cert";

export type RecordStatus = "pending" | "found" | "missing";

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  pending: "Looking",
  found: "Found",
  missing: "Not found",
};

export interface AuthDnsRecord {
  kind: AuthRecordKind;
  /** The name to create, fully qualified, as a DNS console wants it. */
  name: string;
  /** What it points at. Minted by us when the domain is added, never computed here. */
  value: string;
  status: RecordStatus;
}

export interface AuthRecordKindInfo {
  kind: AuthRecordKind;
  label: string;
  type: "CNAME";
  /** What it is for, in the terms of what stops working without it. */
  purpose: string;
  /** Why removing it later is worse than never adding it. */
  afterwards: string;
}

export const AUTH_RECORD_INFO: Record<AuthRecordKind, AuthRecordKindInfo> = {
  cname: {
    kind: "cname",
    label: "The host itself",
    type: "CNAME",
    purpose:
      "Points the hostname at our load balancer, which is what makes it answer at all. Until it resolves there is nothing at the address for a browser to call.",
    afterwards:
      "Removing it takes the host off the air immediately. Every client configured to call it stops working, and header mode on the shared host is the only way back.",
  },
  cert: {
    kind: "cert",
    label: "Certificate authorisation",
    type: "CNAME",
    purpose:
      "Lets Certificate Manager prove the domain is yours and issue the TLS certificate. The hostname can resolve before the certificate exists, and until it does every https call to it fails outright rather than degrading.",
    afterwards:
      "Leave it in place. The certificate is renewed from this record, so removing it once the domain is working breaks renewal months later, at a moment nothing here caused and nothing obvious explains.",
  },
};

export const AUTH_RECORD_KINDS: readonly AuthRecordKindInfo[] = [
  AUTH_RECORD_INFO.cname,
  AUTH_RECORD_INFO.cert,
];

/*
 * The domain.
 */

/**
 * Where the domain is.
 *
 * `verifying` covers a domain whose records are not published and one whose records are
 * published and not yet seen, because from outside those are the same state and the record
 * list is what says which. The vocabulary matches the sending-domains screen on purpose:
 * they are rows of one table and a reader should not have to learn two words for one state.
 */
export type AuthDomainStatus = "verified" | "verifying" | "failed";

export const AUTH_DOMAIN_STATUS_LABELS: Record<AuthDomainStatus, string> = {
  verified: "Live",
  verifying: "Waiting on DNS",
  failed: "Not verified",
};

export const AUTH_DOMAIN_STATUS_TONES: Record<AuthDomainStatus, "success" | "warning" | "error"> = {
  verified: "success",
  verifying: "warning",
  failed: "error",
};

export interface AuthDomain {
  id: string;
  domain: string;
  status: AuthDomainStatus;
  records: AuthDnsRecord[];
  createdAt: string;
  /** When the last DNS check ran, so a reader knows how stale "not found" is. */
  checkedAt: string | null;
}

/** The records for a hostname, as they would arrive on the row when it is added. */
export function recordsFor(domain: string, token: string): AuthDnsRecord[] {
  return [
    {
      kind: "cname",
      name: domain,
      value: LOAD_BALANCER_TARGET,
      status: "pending",
    },
    {
      kind: "cert",
      name: `${CERT_AUTH_PREFIX}.${domain}`,
      value: `${token}.authorize.certificatemanager.goog`,
      status: "pending",
    },
  ];
}

/** Whether the project has a domain that would actually resolve a request. */
export function liveDomain(domains: readonly AuthDomain[]): AuthDomain | null {
  return domains.find((domain) => domain.status === "verified") ?? null;
}

/**
 * The host a project's clients should be pointed at right now.
 *
 * The shared host until a domain is live, because a client configured against a hostname
 * that does not resolve yet is a client that fails for every user rather than one that
 * misses a feature.
 */
export function effectiveHost(domains: readonly AuthDomain[]): string {
  return liveDomain(domains)?.domain ?? SHARED_API_HOST;
}

/*
 * Naming a domain.
 */

export type DomainIssue =
  | "empty"
  | "not_a_hostname"
  | "apex"
  | "ours"
  | "already_added"
  | "has_scheme";

export const DOMAIN_ISSUE_LABELS: Record<DomainIssue, string> = {
  empty: "Type the hostname your app will call.",
  has_scheme: "A hostname, with no https:// and no path: auth.example.com.",
  not_a_hostname: "That is not a hostname. It looks like auth.example.com.",
  apex: "A CNAME cannot sit at the apex of a zone, so this has to be a subdomain: auth.example.com rather than example.com.",
  ours: "That is one of ours. An auth domain is a name in a zone you control.",
  already_added: "This project has already added that hostname.",
};

const OURS = /(?:^|\.)idenzy\.(?:io|dev)$/;

/**
 * Multi-label public suffixes common enough to be worth catching, and deliberately not the
 * public suffix list.
 *
 * Without it `example.co.uk` reads as a subdomain of `co.uk` on a plain label count, so an
 * apex would pass this check and `siteOf` would then report the site as `co.uk`, which is
 * nonsense shown back to somebody in the add dialog. With it, both are right for the
 * suffixes most customers are actually in.
 *
 * It is a shortlist and says so. A suffix outside it means an apex slips past here and is
 * refused by DNS instead, which is a worse message and not a worse outcome; carrying the
 * real list would be several thousand entries in a panel bundle to sharpen a check the
 * customer's own registrar already makes.
 */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "net.uk",
  "ltd.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "com.ar",
  "com.co",
  "com.pe",
  "com.ve",
  "com.tr",
  "gov.tr",
  "edu.tr",
  "org.tr",
  "net.tr",
  "co.za",
  "org.za",
  "com.sg",
  "com.hk",
  "com.tw",
  "com.cn",
  "com.my",
  "com.ph",
  "com.vn",
  "co.in",
  "co.kr",
  "co.id",
  "co.th",
  "co.il",
  "com.pl",
  "com.ua",
  "com.eg",
  "com.sa",
  "com.ng",
]);

/**
 * Whether a hostname is the apex of its zone, which is the one place a CNAME may not go.
 *
 * Two labels is always an apex. Three is an apex only where the last two are a suffix
 * somebody registers under rather than a domain anybody owns.
 */
function isApex(labels: readonly string[]): boolean {
  if (labels.length < 3) return true;
  return labels.length === 3 && MULTI_LABEL_SUFFIXES.has(labels.slice(1).join("."));
}

/**
 * Checks a hostname before it is added.
 *
 * The apex rule is the one worth knowing: a zone's apex cannot hold a CNAME, so an auth
 * domain has to be a subdomain whatever the customer would prefer. Refusing it here is the
 * difference between reading one sentence and waiting for a verification that can never
 * pass.
 */
export function validateDomain(value: string, existing: readonly string[]): DomainIssue | null {
  const text = value.trim().toLowerCase();
  if (text === "") return "empty";
  if (text.includes("/") || text.includes(":")) return "has_scheme";
  if (!isRpId(text)) return "not_a_hostname";
  if (isApex(text.split("."))) return "apex";
  if (OURS.test(text)) return "ours";
  if (existing.some((held) => held.toLowerCase() === text)) return "already_added";
  return null;
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The site a hostname belongs to, which is the whole of why cookie mode works.
 *
 * `SameSite` is a site rule and not an origin one, so `app.customer.com` reaching
 * `auth.customer.com` is same-site and the cookie flows. Read by dropping the first label,
 * which is exact for the shape this screen requires: an auth domain is a subdomain, so
 * what is left is the site it sits in.
 */
export function siteOf(domain: string): string {
  const labels = normalizeDomain(domain).split(".");
  return labels.length <= 2 ? labels.join(".") : labels.slice(1).join(".");
}

/*
 * What a live auth domain changes. Each of these is refused, degraded or unavailable
 * without one, and the screen states which of the three it is.
 */

export interface AuthDomainCapability {
  id: string;
  title: string;
  /** What happens with a domain in place. */
  with: string;
  /** What happens without one, which is never simply "it is off". */
  without: string;
  /** The code a caller sees where the answer is a refusal. */
  errorCode: string | null;
}

export const AUTH_DOMAIN_CAPABILITIES: readonly AuthDomainCapability[] = [
  {
    id: "cookies",
    title: "Cookie mode",
    with: "The refresh token leaves the response body entirely and lives in a __Host- cookie the browser will not hand to script. That is strictly less exposure than header mode, which is why a client is trusted to ask for it.",
    without:
      "Refused rather than granted and quietly dropped, and the SDK steps down to header mode once. SameSite is a site rule, so a cookie set by our shared host for your app is one the browser discards, and a discarded cookie looks exactly like a sign-in that does nothing.",
    errorCode: "session_transport_unavailable",
  },
  {
    id: "navigation",
    title: "Routes a browser navigates to",
    with: "An OAuth start, an OAuth callback and a magic-link callback can be reached by a top-level navigation, because the request resolves by Host alone.",
    without:
      "A top-level navigation carries neither our key header nor an Authorization header, so on the shared host it names no project. Anything a browser has to start on the shared host goes through the JSON twin instead, which the SDK calls and then navigates itself.",
    errorCode: "unknown_project",
  },
  {
    id: "preflight",
    title: "A strict preflight",
    with: "A CORS preflight can be answered strictly, because Host names the project before any header is read.",
    without:
      "A preflight cannot see the key header, so an unregistered origin gets an ordinary answer with no Access-Control-Allow-Origin rather than a 403. The refusal is the browser's, and a hard status would tell a prober the difference between checked and never configured.",
    errorCode: null,
  },
];
