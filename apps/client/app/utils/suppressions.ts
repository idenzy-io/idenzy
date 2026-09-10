/**
 * Addresses a project must never send to again (PROJECT.md 11.1, 11.2).
 *
 * The one fact that decides everything about this screen is that the target is stored as
 * a digest and never as an address. `suppressions.target_hash` is the SHA-256 of the
 * trimmed, lowercased target, written that way so a customer's suppression list is not a
 * harvestable list of every address that ever bounced for them, and so the address stays
 * out of the database's own query logs.
 *
 * The consequence is that this list cannot be read, only asked. Every other vendor's
 * suppressions screen is a searchable table of addresses; ours cannot be one, so the
 * primary control is a lookup: an address is hashed and the digest is what goes looking.
 * The panel does that hashing in the browser, so an address a support agent types to
 * answer "why does this person get no mail" never leaves the machine they typed it on.
 *
 * `hashAddress` has to agree with `hashToken` in `@idenzy/crypto` exactly, or a lookup
 * finds nothing and a release removes nothing. A test pins it to known digests.
 */

/** Every channel the table can hold. Only email consults it today. */
export type SuppressionChannel = "email" | "sms" | "whatsapp";

export const SUPPRESSION_CHANNEL_LABELS: Record<SuppressionChannel, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

/**
 * Why an address is on the list.
 *
 * `reason` is free text on the row and this is the vocabulary the bounce handler will
 * write. A reason outside it renders as itself rather than as an error: the column is
 * open, and a screen that hid an unfamiliar value would hide the one worth looking at.
 */
export type SuppressionReason =
  | "hard_bounce"
  | "complaint"
  | "manual"
  | "list_unsubscribe"
  | "invalid_address";

export interface ReasonInfo {
  id: SuppressionReason;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** Whether ignoring it would damage a sending reputation shared with every project. */
  severe: boolean;
  note: string;
}

export const SUPPRESSION_REASONS: readonly ReasonInfo[] = [
  {
    id: "hard_bounce",
    label: "Hard bounce",
    icon: "material-symbols:cancel-outline",
    severe: true,
    note: "The receiving server said the address does not exist. Sending again is the single fastest way to lose a sending reputation, and the reputation is shared with every project on the domain.",
  },
  {
    id: "complaint",
    label: "Marked as spam",
    icon: "material-symbols:report-outline",
    severe: true,
    note: "The recipient pressed the spam button and their provider told us. Weighted far more heavily than a bounce by every mailbox provider, and the one signal that gets a domain blocked outright.",
  },
  {
    id: "invalid_address",
    label: "Rejected as invalid",
    icon: "material-symbols:error-outline",
    severe: true,
    note: "The provider refused the address before it was ever delivered anywhere. Retrying costs a rejection every time and counts against the same reputation.",
  },
  {
    id: "list_unsubscribe",
    label: "Unsubscribed",
    icon: "material-symbols:unsubscribe-outline",
    severe: false,
    note: "The reader used the one-click unsubscribe header. Rare on transactional mail, and worth reading as a signal that a message is arriving where it is not wanted.",
  },
  {
    id: "manual",
    label: "Added by you",
    icon: "material-symbols:person-edit-outline",
    severe: false,
    note: "Put on the list deliberately rather than by a provider event, usually to stop mail to an address while something is investigated.",
  },
];

export function reasonInfo(reason: string): ReasonInfo | undefined {
  return SUPPRESSION_REASONS.find((entry) => entry.id === reason);
}

/** An unfamiliar reason reads as itself rather than disappearing behind a fallback. */
export function reasonLabel(reason: string): string {
  return reasonInfo(reason)?.label ?? reason;
}

/*
 * Hashing.
 */

/** Lowercased and trimmed, so a suppression written for one casing covers the other. */
export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

/**
 * The digest the table is keyed by: SHA-256 of the normalised target, as lowercase hex.
 *
 * Computed here rather than by asking the server to hash an address for us, so the
 * address itself never travels. `crypto.subtle` needs a secure context, which the panel
 * always has: it is a browser-only build and is served over https everywhere but
 * localhost, which counts as secure.
 */
export async function hashAddress(target: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeTarget(target));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The first and last of a digest, for a column that cannot show all sixty-four. */
export function shortDigest(digest: string): string {
  return digest.length <= 16 ? digest : `${digest.slice(0, 8)}…${digest.slice(-6)}`;
}

/*
 * Checking an address before it is hashed.
 *
 * Deliberately loose. The point is to catch a typo before somebody reads "not suppressed"
 * as an answer about an address they did not actually ask about; it is not a validator for
 * what may be signed up with, which is the server's business and stricter than a regex.
 */
const ADDRESS = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

export type LookupIssue = "empty" | "not_an_address";

export const LOOKUP_ISSUE_LABELS: Record<LookupIssue, string> = {
  empty: "Type the address you want to ask about.",
  not_an_address: "That does not look like an email address, so the answer would be about nothing.",
};

export function validateLookup(value: string): LookupIssue | null {
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  return ADDRESS.test(trimmed) ? null : "not_an_address";
}

/*
 * What the panel knows about the list itself.
 */

export interface SuppressionRow {
  /** The row's own id, as the management API names it. */
  id: string;
  channel: SuppressionChannel;
  /** SHA-256 hex. The address is not stored anywhere and cannot be recovered from this. */
  targetHash: string;
  reason: string;
  createdAt: string;
}

/** One line per reason, biggest first, for the breakdown beside the list. */
export interface ReasonTally {
  reason: string;
  label: string;
  count: number;
  severe: boolean;
}

export function tallyReasons(rows: readonly SuppressionRow[]): ReasonTally[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      label: reasonLabel(reason),
      count,
      severe: reasonInfo(reason)?.severe ?? false,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * How an address reaches the list, and what each step is worth knowing for.
 *
 * `built` is false for every step today, and that is the honest state rather than an
 * omission: the SES configuration set, the SNS topic and the `email-events` worker are
 * designed and not written, so nothing writes a suppression yet. A screen that showed an
 * empty list without saying so would read as "this project has never had a bounce", which
 * is a different and much more comfortable claim than the true one.
 */
export interface SuppressionSource {
  id: string;
  title: string;
  detail: string;
  built: boolean;
}

export const SUPPRESSION_SOURCES: readonly SuppressionSource[] = [
  {
    id: "ses-events",
    title: "A provider event",
    detail:
      "SES publishes send, delivery, bounce, complaint and reject to an SNS topic, which posts to an email-events worker, which writes the suppression. That pipeline is designed and not built, so nothing reaches this list today.",
    built: false,
  },
  {
    id: "webhook",
    title: "Your own webhook",
    detail:
      "A hard bounce or a complaint also leaves as an email.bounced event, so your system can react to the same signal rather than discovering it from a support ticket. It arrives when the pipeline above does.",
    built: false,
  },
  {
    id: "manual",
    title: "By hand, from here",
    detail:
      "Adding an address deliberately, to stop mail while something is looked into. It writes the same row a bounce would and is released the same way.",
    built: false,
  },
];
