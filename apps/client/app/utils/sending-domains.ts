/**
 * Where a project's mail comes from: the shared domain every project starts on, the
 * domains a customer verifies for themselves, and the DNS that has to exist before one
 * of theirs can send (PROJECT.md 11.1, 11.2).
 *
 * Two facts shape the whole screen. A project is never without a sending domain, because
 * `mail.idenzy.io` is there from the first day and cannot be taken away, so this is a
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
 *
 * Two states, kept apart on purpose (notes/email-domains.md). Whether a domain is
 * verified and whether it is the one sending are different questions with different
 * answers, and a row that collapsed them would let a reader think verifying a domain had
 * moved their From line. `verificationState` and `sendingState` are the two, and nothing
 * on the screen may state one of them alone.
 */

import type { BadgeTone } from "~/components/StatusBadge.vue";

/*
 * The domain we own.
 */

/** The shared sending domain, ours, with SPF, DKIM and DMARC `p=reject` already on it. */
export const SHARED_DOMAIN = "mail.idenzy.io";

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
 * The two states a row has to keep apart.
 */

export interface DomainState {
  /** The word on the badge. */
  label: string;
  tone: BadgeTone;
  /** The line under it, naming what the word was read off. */
  detail: string;
}

/** Where the DNS stands. Never says anything about what the project sends from. */
export function verificationState(domain: SendingDomain): DomainState {
  if (domain.shared) {
    return {
      label: "Ours",
      tone: "neutral",
      detail: `SPF, DKIM and DMARC on ${SHARED_DOMAIN} are published by us and already correct.`,
    };
  }
  const { found, required } = recordProgress(domain);
  if (domain.status === "failed") {
    return {
      label: "Failed",
      tone: "error",
      detail: "The provider gave up on this identity. Remove it and add it again to start over.",
    };
  }
  if (isReadyToSend(domain)) {
    return {
      label: "Verified",
      tone: "success",
      detail: `All ${required} required records found at your DNS provider.`,
    };
  }
  return {
    label: "Verifying",
    tone: "warning",
    detail: `${found} of ${required} required records found. The rest are not there yet.`,
  };
}

/**
 * Whether this domain carries the From line, and whether it could.
 *
 * "Ready" is the state the note exists for: a verified domain that is not the sender is
 * a finished setup waiting on one deliberate act, and it must not read as either sending
 * or broken.
 */
export function sendingState(domain: SendingDomain): DomainState {
  if (domain.inUse) {
    return {
      label: "Sending from this",
      tone: "success",
      detail: `Every auth mail on this project leaves as ${fromAddress(domain.domain)}.`,
    };
  }
  if (isReadyToSend(domain)) {
    return {
      label: "Ready",
      tone: "neutral",
      detail: "Verified and not the sender. Moving the From line to it is a separate step.",
    };
  }
  return {
    label: "Cannot send yet",
    tone: "neutral",
    detail: "A domain sends only once every required record resolves.",
  };
}

/*
 * The four steps, which are the shape of the setup rather than a decoration.
 */

export type SetupStage = "add" | "publish" | "verify" | "select";

export const SETUP_STEPS: readonly { id: SetupStage; label: string }[] = [
  { id: "add", label: "Add" },
  { id: "publish", label: "Publish DNS" },
  { id: "verify", label: "Verify" },
  { id: "select", label: "Select sender" },
];

/**
 * Which step a domain is on.
 *
 * "Publish" covers everything until every required record is found, because what the
 * panel knows is what it saw and not what somebody pasted. "Verify" is the window where
 * the records are in and the check has not caught up, which is a real state a customer
 * sits in and the reason `Check records` exists at all.
 */
export function setupStage(domain: SendingDomain): SetupStage {
  if (domain.inUse) return "select";
  if (isReadyToSend(domain)) return domain.status === "verified" ? "select" : "verify";
  return "publish";
}

/** A domain that is verified and sending: nothing left on this screen to do with it. */
export function isSetupComplete(domain: SendingDomain): boolean {
  return domain.inUse && isReadyToSend(domain);
}

/*
 * One record, as a DNS console asks for it.
 */

/** What we ask for in the TTL column. Any value works; consoles default to something. */
export const RECORD_TTL = "300";

/** How often the check runs on its own, so `Check records` is a nudge and not the only way. */
export const CHECK_EVERY_MINUTES = 5;

/**
 * The name to paste where a console appends the zone for you.
 *
 * Most of them do, and a fully qualified name pasted into one of those becomes
 * `token._domainkey.acme.com.acme.com`: the record exists, the check never finds it, and
 * nothing in either console says why. The apex answers `@`, which is what every console
 * calls it.
 */
export function relativeHost(host: string, domain: string): string {
  if (host === domain) return "@";
  return host.endsWith(`.${domain}`) ? host.slice(0, -(domain.length + 1)) : host;
}

/**
 * Which of the two names a console is asking for. Both are correct and they are correct
 * in different consoles, so the record table offers the pair as one choice above it
 * rather than printing the same caveat on every row.
 */
export type NameForm = "full" | "relative";

/** The name to paste, in the form the reader's own console wants. */
export function recordName(record: DnsRecord, domain: string, form: NameForm): string {
  return form === "relative" ? relativeHost(record.host, domain) : record.host;
}

export interface RecordFinding {
  state: RecordStatus;
  label: string;
  /** What was found, and for a miss, the thing to look at first. */
  detail: string;
}

/** What the last check said about one record, in the reader's words. */
export function recordFinding(record: DnsRecord): RecordFinding {
  switch (record.status) {
    case "found":
      return {
        state: "found",
        label: RECORD_STATUS_LABELS.found,
        detail: "Seen at your DNS provider, and it matches the value above.",
      };
    case "missing":
      return {
        state: "missing",
        label: RECORD_STATUS_LABELS.missing,
        detail:
          "Not there when we last looked. Check the name for a stray space, and for your console adding the domain to it a second time.",
      };
    default:
      return {
        state: "pending",
        label: RECORD_STATUS_LABELS.pending,
        detail: `Not looked for yet. The check runs on its own about every ${CHECK_EVERY_MINUTES} minutes.`,
      };
  }
}

/** The required records still outstanding, which is what the setup foot counts down. */
export function missingRecords(domain: SendingDomain): DnsRecord[] {
  return requiredRecords(domain).filter((record) => record.status !== "found");
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

/*
 * What the panel can honestly say about delivery.
 *
 * Sent is ours: the send is our own call and the meter behind it is what a customer is
 * billed on. Delivered, bounced and complained are provider events, and they are recorded
 * now — the SNS receiver writes them per project per day, and a bounce rate over the recent
 * window is what stops a project sending (see `~/utils/suppressions`). What is still missing
 * is the read: no endpoint serves those counts to this screen, so the three answer null
 * rather than nought. Nought is a measurement, and a measured zero here would tell somebody
 * their mail is healthy when this page has not looked (notes/email-domains.md P1, P2).
 */

export interface DeliveryCounts {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
}

export interface DeliveryFigure {
  id: string;
  label: string;
  /** Null where nothing measures it yet, which is a different fact from zero. */
  value: number | null;
  /** One line under the figure, as every tile in the panel carries. */
  description: string;
}

/** The period every figure on this screen is read over, stated rather than implied. */
export const DELIVERY_PERIOD = "Last 30 days";

export function deliveryFigures(
  counts: DeliveryCounts,
  recorded: boolean,
): readonly DeliveryFigure[] {
  /* Each unmeasured tile says what it would have counted, so three dashes read as three
     different unknowns rather than one sentence printed three times. */
  const unknown = (would: string) => `Not measured yet. It would count ${would}.`;
  return [
    {
      id: "sent",
      label: "Sent",
      value: counts.sent,
      description: "Messages handed to the provider. Counted by the meter you are billed on.",
    },
    {
      id: "delivered",
      label: "Delivered",
      value: recorded ? counts.delivered : null,
      description: recorded
        ? "Accepted by the receiving server. A delivery is not a read, and we count no opens."
        : unknown("what a receiving server accepted, which is still not a read"),
    },
    {
      id: "bounced",
      label: "Bounced",
      value: recorded ? counts.bounced : null,
      description: recorded
        ? "Rejected outright by the receiving server."
        : unknown("what a receiving server rejected outright"),
    },
    {
      id: "complained",
      /* "Complaints" and not "Marked as spam": the tile capitalises its label, and
         `Marked As Spam` is a sentence with a capital in the middle of it. */
      label: "Complaints",
      value: recorded ? counts.complained : null,
      description: recorded
        ? "The recipient pressed the spam button and their provider told us."
        : unknown("the readers who pressed the spam button"),
    },
  ];
}

/** Where a threshold comes from, so a limit on screen is never read as ours to move. */
export interface ReputationLimit {
  id: string;
  label: string;
  limit: number;
  source: string;
}

export const REPUTATION_LIMITS: readonly ReputationLimit[] = [
  {
    id: "bounced",
    label: "Hard bounces",
    limit: BOUNCE_LIMIT,
    source:
      "The provider reviews a sending account by hand above this, and the account under review is ours as well as yours.",
  },
  {
    id: "complained",
    label: "Marked as spam",
    limit: COMPLAINT_LIMIT,
    source:
      "Weighted far more heavily than a bounce by every mailbox provider, and the one signal that gets a domain blocked outright.",
  },
];
