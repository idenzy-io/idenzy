/**
 * Where a project's mail comes from: the shared domain every project starts on, the
 * domains a customer verifies for themselves, and the DNS that has to exist before one
 * of theirs can send (PROJECT.md 11.1, 11.2).
 *
 * Two facts shape the whole screen. A project is never without a sending domain, because
 * `mail.idenzy.dev` is there from the first day and cannot be taken away, so this is a
 * change of address and not a setup that has to be finished before anything works. And a
 * domain of your own is not the cheaper option: it is five dollars a month plus a lower
 * rate per thousand, so under fifty thousand mails a month it costs more, and the reason
 * to want one is that the From line carries your name rather than ours.
 *
 * The panel never builds a record's value. DKIM tokens are minted by the provider when
 * the identity is created and arrive on the row (`project_domains.dns_records`), so what
 * is here is what each record is for, which of them are required, and what a set of them
 * adds up to. A screen that computed a token would show a plausible one that does not
 * exist, and the customer would paste it into their DNS and wait for a check that can
 * never pass.
 */

/*
 * The domain we own.
 */

/** The shared sending domain, ours, with SPF, DKIM and DMARC `p=reject` already on it. */
export const SHARED_DOMAIN = "mail.idenzy.dev";

/** The local part every auth mail is sent from. One address, not a per-template choice. */
export const SENDER_LOCAL_PART = "no-reply";

/** The address a project's mail carries, which is the thing this screen actually sets. */
export function fromAddress(domain: string): string {
  return `${SENDER_LOCAL_PART}@${domain}`;
}

/** The From header as a mailbox reads it: the project's name over the address. */
export function senderLine(projectName: string, domain: string): string {
  return `${projectName} <${fromAddress(domain)}>`;
}

/*
 * A domain and its records.
 */

export type RecordKind = "dkim" | "mail_from_mx" | "spf" | "dmarc";

/** What the last DNS check found. Pending is a record nobody has looked for yet. */
export type RecordStatus = "pending" | "found" | "missing";

/**
 * Where the identity is. `verifying` covers both a domain whose records are not all
 * published and one whose records are published and not yet seen, because from the
 * outside those are the same state and the record list says which is which.
 */
export type DomainStatus = "verified" | "verifying" | "failed";

export interface DnsRecord {
  id: string;
  kind: RecordKind;
  /** Fully qualified, because a DNS console asks for the name and not the suffix. */
  host: string;
  type: "CNAME" | "MX" | "TXT";
  value: string;
  /** MX only, and part of the record: an MX with no preference is not one. */
  priority?: number;
  status: RecordStatus;
}

export interface SendingDomain {
  id: string;
  domain: string;
  /** Ours. Always verified, never removable, and what a project falls back to. */
  shared: boolean;
  status: DomainStatus;
  /** The one the From line carries. Exactly one row in a project holds it. */
  inUse: boolean;
  /** The subdomain bounces return to, and the only place our SPF include belongs. */
  mailFrom: string;
  records: readonly DnsRecord[];
  addedAt: string;
  /** When the records were last looked up. Null on the shared domain, which we own. */
  checkedAt: string | null;
}

export interface RecordKindInfo {
  id: RecordKind;
  label: string;
  /** Required before the domain can send. DMARC is the one that is not. */
  required: boolean;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  note: string;
}

export const RECORD_KIND_INFO: Record<RecordKind, RecordKindInfo> = {
  dkim: {
    id: "dkim",
    label: "DKIM",
    required: true,
    icon: "material-symbols:key-outline",
    note: "Signs every message with a 2048-bit key we hold, so a receiver can prove the mail is ours and that nothing changed on the way. Three records rather than one because the key rotates, and a rotation must not need you to touch DNS again.",
  },
  mail_from_mx: {
    id: "mail_from_mx",
    label: "Bounce route",
    required: true,
    icon: "material-symbols:u-turn-left",
    note: "The subdomain a rejection comes back to. Leave it out and the return path stays on the provider's own domain: mail still sends, DMARC then rests on DKIM alone, and nothing anywhere tells you that is what happened.",
  },
  spf: {
    id: "spf",
    label: "SPF",
    required: true,
    icon: "material-symbols:verified-user-outline",
    note: "Authorises us to send for the bounce subdomain. It sits there rather than on the domain itself, so it cannot collide with the SPF record your own mail already publishes, and neither of you has to count the other's includes against the ten-lookup limit.",
  },
  dmarc: {
    id: "dmarc",
    label: "DMARC",
    required: false,
    icon: "material-symbols:policy",
    note: "Not required to send, and the one record we do not check for. It tells receivers what to do with mail that fails both checks. Our own domains publish p=reject and we would say the same to you, but the policy is yours and the reports come to you.",
  },
};

/**
 * The four kinds, in the order a DNS console is easiest to work down: the three that
 * prove the mail is ours, then the one that says what to do when it is not.
 */
export const RECORD_KINDS: readonly RecordKindInfo[] = [
  RECORD_KIND_INFO.dkim,
  RECORD_KIND_INFO.mail_from_mx,
  RECORD_KIND_INFO.spf,
  RECORD_KIND_INFO.dmarc,
];

export function recordKindInfo(kind: RecordKind): RecordKindInfo {
  return RECORD_KIND_INFO[kind];
}

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  pending: "Not seen yet",
  found: "Found",
  missing: "Not found",
};

export const DOMAIN_STATUS_LABELS: Record<DomainStatus, string> = {
  verified: "Verified",
  verifying: "Verifying",
  failed: "Failed",
};

/*
 * What a set of records adds up to.
 */

/** The records that have to resolve before the domain can carry mail. */
export function requiredRecords(domain: SendingDomain): DnsRecord[] {
  return domain.records.filter((record) => recordKindInfo(record.kind).required);
}

export interface RecordProgress {
  found: number;
  required: number;
}

export function recordProgress(domain: SendingDomain): RecordProgress {
  const required = requiredRecords(domain);
  return {
    found: required.filter((record) => record.status === "found").length,
    required: required.length,
  };
}

/**
 * Whether the domain could send now.
 *
 * Read off the records rather than off `status`, because the two answer different
 * questions: a provider can call an identity verified while the bounce route is still
 * missing, and mail sent then goes out with a return path on a domain the customer does
 * not own. The shared domain is ours and carries no records to check.
 */
export function isReadyToSend(domain: SendingDomain): boolean {
  if (domain.shared) return true;
  const { found, required } = recordProgress(domain);
  return required > 0 && found === required;
}

/*
 * Naming a domain.
 */

/**
 * A hostname with at least two labels. Unlike the passkey relying party's, `localhost`
 * is not allowed here: a sending domain has to be one a receiving mail server can look
 * up, and nothing resolves localhost but the machine that typed it.
 */
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Mailbox providers, refused before anything is created. You cannot publish DNS on a
 * domain you do not own, so the identity could never verify, and mail claiming to come
 * from one of these is the thing DMARC was written to stop.
 */
const PUBLIC_MAILBOX_DOMAINS: readonly string[] = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "yandex.com",
  "mail.com",
  "zoho.com",
];

export type DomainIssue = "domain_invalid" | "domain_taken" | "domain_ours" | "domain_mailbox";

export const DOMAIN_ISSUE_LABELS: Record<DomainIssue, string> = {
  domain_invalid: "A domain with no scheme, port or path, and at least one dot: acme.com.",
  domain_taken: "This project already has that domain.",
  domain_ours: "That domain is ours, and every project can already send from it.",
  domain_mailbox:
    "A mailbox provider's own domain cannot be verified, because publishing DNS on it is not yours to do.",
};

export function normaliseDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

/** The issue with a domain somebody typed, or null if there is none. */
export function validateDomain(value: string, existing: readonly string[]): DomainIssue | null {
  const domain = normaliseDomain(value);
  if (!HOSTNAME.test(domain)) return "domain_invalid";
  if (domain === SHARED_DOMAIN) return "domain_ours";
  if (PUBLIC_MAILBOX_DOMAINS.includes(domain)) return "domain_mailbox";
  if (existing.map(normaliseDomain).includes(domain)) return "domain_taken";
  return null;
}

/** The subdomain bounces come back to, which is where SPF and the MX belong. */
export function mailFromFor(domain: string): string {
  return `bounce.${domain}`;
}

/*
 * Which domain sends.
 */

/**
 * Moves the From line to one domain, pure so the rule is tested rather than trusted.
 *
 * A domain whose required records are not all found is refused and the list comes back
 * as it was. Sending from a half-published domain is worse than sending from ours: the
 * mail leaves, receivers cannot check it, and the reputation that suffers is the
 * customer's own name.
 */
export function useForSending(domains: readonly SendingDomain[], id: string): SendingDomain[] {
  const target = domains.find((domain) => domain.id === id);
  if (!target || !isReadyToSend(target)) return [...domains];
  return domains.map((domain) => ({ ...domain, inUse: domain.id === id }));
}

/**
 * Takes a domain off the project. The shared domain cannot go, and mail does not stop:
 * if the one removed was the one sending, the From line falls back to ours in the same
 * change, because a project with no sending domain is a project whose auth mail dies.
 */
export function afterRemoval(domains: readonly SendingDomain[], id: string): SendingDomain[] {
  const target = domains.find((domain) => domain.id === id);
  if (!target || target.shared) return [...domains];
  const left = domains.filter((domain) => domain.id !== id);
  if (!target.inUse) return left;
  return left.map((domain) => ({ ...domain, inUse: domain.shared }));
}

/** The domain the From line carries now. Never null: the shared row is always there. */
export function sendingFrom(domains: readonly SendingDomain[]): SendingDomain | null {
  return domains.find((domain) => domain.inUse) ?? null;
}

/*
 * What it costs (PROJECT.md 5).
 */

export const SHARED_RATE_PER_THOUSAND = 0.5;
export const CUSTOM_RATE_PER_THOUSAND = 0.4;
export const CUSTOM_DOMAIN_MONTHLY = 5;

/** A month of mail on one domain or the other, in dollars. */
export function monthlyCost(sends: number, custom: boolean): number {
  const rate = custom ? CUSTOM_RATE_PER_THOUSAND : SHARED_RATE_PER_THOUSAND;
  return (custom ? CUSTOM_DOMAIN_MONTHLY : 0) + (sends / 1000) * rate;
}

/**
 * Where the two lines cross. Derived rather than written down, because it is arithmetic
 * over the prices above and a figure typed out here would outlive a price change.
 * Rounded, because a difference of two decimal rates lands a fraction off the whole
 * number and this one is read rather than computed against.
 */
export const BREAK_EVEN_SENDS = Math.round(
  CUSTOM_DOMAIN_MONTHLY / ((SHARED_RATE_PER_THOUSAND - CUSTOM_RATE_PER_THOUSAND) / 1000),
);

/*
 * Reputation.
 */

/** The provider's own review thresholds. Above these an account is looked at by hand. */
export const BOUNCE_LIMIT = 0.05;
export const COMPLAINT_LIMIT = 0.001;

export type ReputationTone = "good" | "watch" | "over";

/**
 * How a rate reads against its limit. "Watch" starts at half, because the number that
 * matters is the trend: a complaint rate at 0.05% is one bad week from a suspension, and
 * a screen that called it fine until it was over would give no warning at all.
 */
export function reputationTone(rate: number, limit: number): ReputationTone {
  if (rate >= limit) return "over";
  return rate >= limit / 2 ? "watch" : "good";
}

/** A rate as a percentage with the digits the small numbers here actually need. */
export function ratePercent(rate: number): string {
  const percent = rate * 100;
  const digits = percent > 0 && percent < 0.1 ? 3 : percent < 10 ? 2 : 1;
  return `${percent.toFixed(digits)}%`;
}
