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

/*
 * The one derivation for every copyable value on this screen.
 *
 * The note's third finding is that the same endpoint is written four different ways across
 * four screens. There is one host and it comes from the project's own domains, so anything
 * a customer can copy is built from `apiBaseUrl` and nothing writes a host of its own. An
 * illustrative value says so where it appears rather than looking like a configured one.
 */

/** The base URL a client is configured with, which is the host and nothing else. */
export function apiBaseUrl(host: string): string {
  return `https://${host}`;
}

/** The hostname a customer would use if they had one, for a sentence about the choice. */
export const EXAMPLE_AUTH_HOST = "auth.example.com";

/*
 * What the transport can do, said as a state rather than as a refusal.
 *
 * "Cookie mode: Refused" and "Same-site with: Nothing" read as an incident report about a
 * project that is working exactly as intended (notes/domains.md P2). Header mode on the
 * shared host is a legitimate integration, so the shared-host answer names what a domain
 * would buy and offers the setup, and a real failure is reserved for a domain that was
 * added and did not verify.
 */

export type TransportState = "ready" | "available" | "setup" | "pending" | "failed";

export interface TransportCapability {
  state: TransportState;
  label: string;
  detail: string;
  /** The words on the control that settles it, or null where there is nothing to settle. */
  action: string | null;
}

/** Header mode, which needs nothing and has never needed anything. */
export function headerModeState(): TransportCapability {
  return {
    state: "available",
    label: "Available",
    detail:
      "The refresh token is handed to your client and held wherever your application puts it. This works on the shared host and always has, so a project can stop here.",
    action: null,
  };
}

/** Cookie mode, which is the whole of what a domain of your own buys. */
export function cookieModeState(domains: readonly AuthDomain[]): TransportCapability {
  const live = liveDomain(domains);
  if (live !== null) {
    return {
      state: "ready",
      label: "Ready",
      detail: `A page under ${siteOf(live.domain)} is same-site with ${live.domain}, so the refresh token can live in a __Host- cookie the browser will not hand to script.`,
      action: null,
    };
  }
  const pending = domains.find((domain) => domain.status === "verifying");
  if (pending !== undefined) {
    return {
      state: "pending",
      label: "Waiting on DNS",
      detail: `${pending.domain} is added and its records have still to be seen. Until a check finds them the host answers nothing, so cookie mode is not available yet.`,
      action: "Finish setup",
    };
  }
  const failed = domains.find((domain) => domain.status === "failed");
  if (failed !== undefined) {
    return {
      state: "failed",
      label: "Not verified",
      detail: `${failed.domain} was added and did not verify. Its records are the place to look, and nothing changes for your clients until it does.`,
      action: "Finish setup",
    };
  }
  return {
    state: "setup",
    label: "Requires a custom domain",
    detail:
      "SameSite is a site rule, so a cookie our shared host sets for your pages is one the browser discards. A host on your own site is what makes the cookie same-site, and it is the only thing that does.",
    action: "Add a domain",
  };
}

/*
 * Setting one up, which is five steps and only three of them are ours to see.
 */

export type AuthSetupStage = "host" | "dns" | "certificate" | "sdk" | "test";

export const AUTH_SETUP_STEPS: readonly { id: AuthSetupStage; label: string }[] = [
  { id: "host", label: "Host" },
  { id: "dns", label: "DNS" },
  { id: "certificate", label: "Certificate" },
  { id: "sdk", label: "Update SDK" },
  { id: "test", label: "Test" },
];

function recordOf(domain: AuthDomain, kind: AuthRecordKind): AuthDnsRecord | undefined {
  return domain.records.find((record) => record.kind === kind);
}

/** Whether the CNAME has been seen, which is what makes the host resolve at all. */
export function dnsFound(domain: AuthDomain): boolean {
  return recordOf(domain, "cname")?.status === "found";
}

/** Whether the authorisation record has been seen, which is what issues the certificate. */
export function certificateIssued(domain: AuthDomain): boolean {
  return recordOf(domain, "cert")?.status === "found";
}

/**
 * Which step a domain is on.
 *
 * It stops at `sdk` for a verified domain and never advances itself past it, because the
 * two steps after verification are not ours to observe: whether a deployed client points
 * at this host, and whether an application origin can actually reach it, are facts about
 * somebody else's build (notes/domains.md P1). A screen that marked them done on a
 * verified row would be reporting a migration that had not happened.
 */
export function authSetupStage(domain: AuthDomain, tested: boolean): AuthSetupStage {
  if (!dnsFound(domain)) return "dns";
  if (!certificateIssued(domain) || domain.status !== "verified") return "certificate";
  return tested ? "test" : "sdk";
}

/** A verified host still has two steps left, and this is the one saying which. */
export function authNextStep(domain: AuthDomain, tested: boolean): string {
  switch (authSetupStage(domain, tested)) {
    case "dns":
      return "Publish the CNAME at your DNS provider. Until a check sees it the host resolves nowhere.";
    case "certificate":
      return "The authorisation record is what issues the certificate. A host without one answers a TLS error rather than a request.";
    case "sdk":
      return "Verified. Point your client's API base at this host and deploy: nothing about a deployed application changes on its own.";
    default:
      return "Verified, and a check has been run against it. What a check cannot see is your own build, so a pass here is not a deployed client.";
  }
}

/*
 * What `Verify setup` found, and — as importantly — what it could not look at.
 */

export interface SetupProbeLine {
  label: string;
  ok: boolean;
  detail: string;
}

export interface SetupProbe {
  ok: boolean;
  /** The host it was run against, so an edit to the domain list invalidates it. */
  host: string;
  /** The application origin it presented, or empty where none was named. */
  origin: string;
  at: string;
  lines: SetupProbeLine[];
}

function resolveLine(host: string, ok: boolean): SetupProbeLine {
  return {
    label: "The name resolves",
    ok,
    detail: ok
      ? `${host} points at our load balancer.`
      : `${host} does not resolve, so nothing reached us to answer.`,
  };
}

function certificateLine(ok: boolean): SetupProbeLine {
  return {
    label: "The certificate is served",
    ok,
    detail: ok
      ? "A request over TLS is answered rather than refused at the handshake."
      : "The authorisation record has not been seen, so no certificate has been issued for this host.",
  };
}

function answersLine(host: string, ok: boolean): SetupProbeLine {
  return {
    label: "The project answers on it",
    ok,
    detail: ok
      ? `A request to ${apiBaseUrl(host)} resolved to this project by Host alone.`
      : "The host is not verified, so a request to it is refused as an unknown project rather than as a domain that is nearly ready.",
  };
}

/**
 * The one line the check cannot finish.
 *
 * It can say a browser on that origin would be answered with the headers it needs. It
 * cannot say a deployed client is calling this host, because that is a fact about somebody
 * else's build: verification and client migration are two steps and only one of them is
 * ours (notes/domains.md P1).
 */
function originLine(origin: string, allowed: boolean): SetupProbeLine {
  if (origin === "") {
    return {
      label: "An application origin to test",
      ok: false,
      detail:
        "Name the origin your application is served from and the check will say whether a browser on it is allowed to call this host.",
    };
  }
  return {
    label: `${origin} may call it`,
    ok: allowed,
    detail: allowed
      ? "That origin is on the CORS allowlist, so a browser on it is answered with the headers it needs. Whether your deployed client points at this host is not something this check can see."
      : "That origin is not on the CORS allowlist, so a browser on it gets an ordinary answer with no Access-Control-Allow-Origin, and the refusal is the browser's.",
  };
}

/** Reads a domain as a probe would find it, so the check is tested rather than trusted. */
export function setupProbe(
  domain: AuthDomain | null,
  origin: string,
  originAllowed: boolean,
): SetupProbe {
  const host = domain?.domain ?? "";
  const named = origin.trim();
  const resolves = domain !== null && dnsFound(domain);
  const certificate = domain !== null && certificateIssued(domain);
  const answers = domain?.status === "verified";
  const lines = [
    resolveLine(host, resolves),
    certificateLine(certificate),
    answersLine(host, answers),
    originLine(named, originAllowed),
  ];
  return {
    ok: lines.every((line) => line.ok),
    host,
    origin: named,
    at: new Date().toISOString(),
    lines,
  };
}
