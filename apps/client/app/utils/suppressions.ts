/**
 * Addresses a project is currently blocked from sending to, and what can be found out
 * about one (PROJECT.md 11.1, 11.2).
 *
 * Three facts shape the screen. The target is stored as a digest and never as an address,
 * so the list cannot be read, only asked: `suppressions.target_hash` is the SHA-256 of the
 * trimmed, lowercased target, written that way so a customer's block list is not a
 * harvestable list of every address that ever bounced for them. A row names a channel, so
 * an email block says nothing about SMS to the same person. And nothing writes a row yet,
 * which is why an answer of "not blocked" carries what was checked and when instead of
 * reading as proof that the next message arrives.
 *
 * `hashAddress` has to agree with `hashToken` in `@idenzy/crypto` exactly, or a lookup
 * finds nothing and a release removes nothing. A test pins it to known digests.
 */

import type { BadgeTone } from "~/components/StatusBadge.vue";

/** Every channel the table can hold. Only email consults it today. */
export type SuppressionChannel = "email" | "sms" | "whatsapp";

export const SUPPRESSION_CHANNEL_LABELS: Record<SuppressionChannel, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

/**
 * Why an address is blocked.
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
  /** Whether a provider reported it, rather than somebody here choosing it. */
  reported: boolean;
  /** Whether ignoring it would damage a sending reputation shared with every project. */
  severe: boolean;
  note: string;
}

export const SUPPRESSION_REASONS: readonly ReasonInfo[] = [
  {
    id: "hard_bounce",
    label: "Hard bounce",
    icon: "material-symbols:cancel-outline",
    reported: true,
    severe: true,
    note: "The receiving server said the address does not exist. Sending again is the single fastest way to lose a sending reputation, and the reputation is shared with every project on the domain.",
  },
  {
    id: "complaint",
    label: "Marked as spam",
    icon: "material-symbols:report-outline",
    reported: true,
    severe: true,
    note: "The recipient pressed the spam button and their provider told us. Weighted far more heavily than a bounce by every mailbox provider, and the one signal that gets a domain blocked outright.",
  },
  {
    id: "invalid_address",
    label: "Rejected as invalid",
    icon: "material-symbols:error-outline",
    reported: true,
    severe: true,
    note: "The provider refused the address before it was ever delivered anywhere. Retrying costs a rejection every time and counts against the same reputation.",
  },
  {
    id: "list_unsubscribe",
    label: "Unsubscribed",
    icon: "material-symbols:unsubscribe-outline",
    reported: true,
    severe: false,
    note: "The reader used the one-click unsubscribe header. Rare on transactional mail, and worth reading as a signal that a message is arriving where it is not wanted.",
  },
  {
    id: "manual",
    label: "Added by you",
    icon: "material-symbols:person-edit-outline",
    reported: false,
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

/** Who put the row there, which is the first thing a reader asks of a block. */
export function sourceLabel(reason: string): string {
  const info = reasonInfo(reason);
  if (info === undefined) return "Recorded by the delivery pipeline";
  return info.reported ? "Reported by the mailbox provider" : "Added from this dashboard";
}

/*
 * What this page can and cannot do today.
 *
 * The list is enforced and can be asked and released; the pipeline that writes a row is
 * designed and not built. Those are different halves and the screen has to say which is
 * which, because an empty list and an absent recorder look identical from here.
 */

export type CapabilityState = "live" | "not_built";

export interface DeliveryCapability {
  id: string;
  /** What it does, in the reader's words. */
  label: string;
  state: CapabilityState;
  /** What is true today, naming the thing it is true of. */
  finding: string;
}

export const DELIVERY_CAPABILITIES: readonly DeliveryCapability[] = [
  {
    id: "enforcement",
    label: "Blocking a send",
    state: "live",
    finding:
      "Checked by the provider base before any transport runs, so no adapter can skip it. A blocked send answers delivery_suppressed and a 403, and is not retryable.",
  },
  {
    id: "lookup",
    label: "Asking about one address",
    state: "live",
    finding:
      "The address is hashed in this browser and the digest is what goes looking, so the address is not sent to us, not logged and not put in a URL.",
  },
  {
    id: "release",
    label: "Allowing email again",
    state: "live",
    finding:
      "One address at a time, on one channel, with the decision recorded. There is no bulk release: clearing a list of bounces in one click is how a domain gets blocked.",
  },
  {
    id: "provider_events",
    label: "Recording a bounce or a complaint",
    state: "not_built",
    finding:
      "SES publishes bounce, complaint and reject to an SNS topic, which posts to an email-events worker, which writes the row. That pipeline is designed and not written, so nothing reaches this list and an address that bounced today is still being sent to.",
  },
  {
    id: "delivery_log",
    label: "Showing what happened to one message",
    state: "not_built",
    finding:
      "There is no per-message delivery record here, so what a mailbox did with a message lives in the provider console and not in this panel.",
  },
  {
    id: "webhook",
    label: "Telling your own system",
    state: "not_built",
    finding:
      "A hard bounce or a complaint will also leave as an email.bounced event so your system can react to the same signal. It arrives when the pipeline above does.",
  },
  {
    id: "manual",
    label: "Blocking an address by hand",
    state: "not_built",
    finding:
      "Writing a row deliberately, to stop mail while something is looked into, is not offered yet. Until it is, the only way an address is blocked is a provider event.",
  },
];

export interface DeliveryStatus {
  /** The badge beside the title. */
  label: string;
  tone: BadgeTone;
  /** One line: what works, and what the answers here therefore cannot settle. */
  detail: string;
}

/**
 * The capability headline, which is the first thing the page says.
 *
 * Two words rather than a sentence: it sits beside the title, and `PageHeader` truncates
 * one line, so a longer badge is a page title with its end cut off on a phone. The detail
 * under it is where the sentence goes.
 */
export function deliveryStatus(
  capabilities: readonly DeliveryCapability[] = DELIVERY_CAPABILITIES,
): DeliveryStatus {
  const built = capabilities.every((entry) => entry.state === "live");
  if (built) {
    return {
      label: "Fully recorded",
      tone: "success",
      detail:
        "Blocks are recorded, enforced, looked up and released here, so an answer on this page is the whole answer.",
    };
  }
  return {
    label: "Not recording",
    tone: "warning",
    detail:
      "Blocking, lookups and releases work here. Nothing records a new block yet, so an address absent from the list is unknown rather than reachable.",
  };
}

/** Whether a bounce or a complaint reaches the list at all, which decides every verdict. */
export function ingestionAvailable(
  capabilities: readonly DeliveryCapability[] = DELIVERY_CAPABILITIES,
): boolean {
  return capabilities.find((entry) => entry.id === "provider_events")?.state === "live";
}

/*
 * Hashing.
 */

/** Lowercased and trimmed, so a block written for one casing covers the other. */
export function normalizeTarget(target: string): string {
  return target.trim().toLowerCase();
}

/** Whether this browser can hash at all. False outside a secure context. */
export function canHash(): boolean {
  return typeof crypto !== "undefined" && crypto.subtle !== undefined;
}

/**
 * The digest the table is keyed by: SHA-256 of the normalised target, as lowercase hex.
 *
 * Computed here rather than by asking the server to hash an address for us, so the
 * address itself never travels. `crypto.subtle` needs a secure context, which the panel
 * has everywhere but a plain-http host: `canHash` is what the lookup checks first.
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
 * Deliberately loose. The point is to catch a typo before somebody reads "not blocked" as
 * an answer about an address they did not actually ask about; it is not a validator for
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
 * The list itself.
 */

export interface SuppressionRow {
  /** The row's own id, as the management API names it. */
  id: string;
  channel: SuppressionChannel;
  /** SHA-256 hex. The address is not stored anywhere and cannot be recovered from this. */
  targetHash: string;
  reason: string;
  createdAt: string;
  /** The provider event that wrote it, where one did. Evidence, not an identifier. */
  providerEventId?: string;
}

/** What a release leaves behind, because the row itself is deleted. */
export interface ReleaseRecord {
  id: string;
  channel: SuppressionChannel;
  targetHash: string;
  /** The reason the block carried, kept so the decision can be read back. */
  reason: string;
  releasedAt: string;
  /** What the operator gave as their justification, where one was required. */
  justification: string;
}

/** One line per reason, biggest first, for the breakdown in the records card. */
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

/*
 * The lookup and its answer.
 */

/** Suppressed, not found, or nothing was checked. The three the mockup names. */
export type LookupVerdict = "blocked" | "clear" | "unavailable";

/** Why nothing was checked. Both are reachable and neither is a bad address. */
export type LookupFailure = "not_read" | "no_crypto";

export const LOOKUP_FAILURES: Record<LookupFailure, { title: string; detail: string }> = {
  not_read: {
    title: "The block list has not been read",
    detail:
      "This project's list could not be loaded, so nothing was compared and the answer is neither blocked nor clear. Try again in a moment.",
  },
  no_crypto: {
    title: "This browser would not hash the address",
    detail:
      "Hashing needs a secure context and this page is not in one, so the address was not turned into a digest and nothing left this machine. Open the dashboard over https and ask again.",
  },
};

export interface LookupAnswer {
  /** The address as it was asked about, for the sentence that reports the result. */
  asked: string;
  /** Empty where the address was never hashed. */
  digest: string;
  /** When the list was asked, which is half of what "not found" is worth. */
  checkedAt: string;
  verdict: LookupVerdict;
  /** The email block, where there is one. This screen's own channel. */
  email: SuppressionRow | null;
  /** The same address blocked on another channel: context, and released elsewhere. */
  others: readonly SuppressionRow[];
  /** Set only where the verdict is unavailable. */
  failure: LookupFailure | null;
}

/** What was compared, in one line, so a verdict is never read without its scope. */
export function checkedLine(answer: LookupAnswer, projectName: string): string {
  return answer.verdict === "unavailable"
    ? `Nothing was compared against ${projectName}.`
    : `Compared against the email block list for ${projectName}, ${SUPPRESSION_CHANNEL_LABELS.email.toLowerCase()} channel only.`;
}

/*
 * The repair, which comes before the release.
 */

export interface NextStep {
  title: string;
  detail: string;
  /** In order, and written to be pasted into a support ticket. */
  steps: readonly string[];
}

/**
 * What to do about the answer, keyed off the reason rather than off the verdict alone.
 *
 * A hard bounce is repaired by correcting an address and a complaint is repaired by
 * asking its owner, so one "release it" button under every block would be the wrong
 * advice five times out of six.
 */
export function nextStepFor(answer: LookupAnswer, ingestion: boolean): NextStep {
  if (answer.verdict === "unavailable") {
    const failure = LOOKUP_FAILURES[answer.failure ?? "not_read"];
    return {
      title: failure.title,
      detail: failure.detail,
      steps: [
        "Ask again, and read the answer's own timestamp rather than this one.",
        "Treat the address as unknown until something answers: an unread list is not an empty one.",
        "Where it keeps failing, the provider console still holds what happened to the last message.",
      ],
    };
  }

  if (answer.email === null) return clearStep(ingestion);

  switch (answer.email.reason) {
    case "hard_bounce":
      return {
        title: "Confirm the address before allowing email again",
        detail:
          "The receiving server said this address does not exist, and a mistyped sign-up is the usual cause. A corrected address is a different address and is not blocked, so fixing the account is the repair; releasing this one helps only where the same mailbox has started working.",
        steps: [
          "Read the address on the account back to its owner. One wrong character is the common case.",
          "Where it is wrong, change it on the account. Mail to the corrected address is attempted normally and nothing has to be released.",
          "Where it is right, have the owner confirm the mailbox accepts mail, then allow email again.",
        ],
      };
    case "complaint":
      return {
        title: "Ask the owner before resuming",
        detail:
          "Somebody at this address pressed the spam button and their provider told us. Mailbox providers weigh a complaint far more heavily than a bounce, and the sending reputation is shared with every project on the domain, so resuming without being asked costs more than one person's sign-in mail.",
        steps: [
          "Ask the owner whether they still want sign-in mail from this project.",
          "Have them move the last message out of their spam folder, which is what stops the next one going the same way.",
          "Then allow email again, with the reason recorded.",
        ],
      };
    case "invalid_address":
      return {
        title: "The address itself was refused",
        detail:
          "The provider would not accept it before anything was sent, so this is a shape or a domain problem rather than a full mailbox. Retrying costs a rejection every time and counts against the same reputation.",
        steps: [
          "Check the local part and the domain on the account for a stray or a missing character.",
          "Check the domain still exists and still accepts mail. A lapsed domain rejects everything.",
          "Correct it on the account. Releasing this record changes nothing while the address is unusable.",
        ],
      };
    case "list_unsubscribe":
      return {
        title: "Confirm sign-in mail is wanted again",
        detail:
          "The reader used the one-click unsubscribe header. That is rare on authentication mail and usually means a message arrived that they did not expect, so the useful step is finding out which one.",
        steps: [
          "Check what they were sent last. An unexpected sign-in code reads as mail nobody asked for.",
          "Confirm with them that sign-in mail is wanted before resuming.",
          "Then allow email again.",
        ],
      };
    case "manual":
      return {
        title: "Find out why it was blocked by hand",
        detail:
          "This row was written deliberately rather than by a provider event, usually to stop mail while something was looked into. Nothing on the row says whether that is finished.",
        steps: [
          "Check the audit trail for who added it and when.",
          "Where the investigation is closed, allow email again.",
          "Where it is not, leave it. Nothing else on the project has to change for it to stay.",
        ],
      };
    default:
      return {
        title: "Read the record before releasing",
        detail:
          "The reason on this row is not one this screen has words for, which usually means a newer provider event than the panel knows about. The reason as it was recorded is in the delivery evidence.",
        steps: [
          "Open the delivery evidence and read the reason exactly as the provider wrote it.",
          "Where the provider refused the address, correct it on the account rather than releasing.",
          "Where you can tell resuming is safe, allow email again with that reason recorded.",
        ],
      };
  }
}

/** The answer for an address nothing holds, which is the one most easily misread. */
function clearStep(ingestion: boolean): NextStep {
  const steps = [
    "Compare what you typed with the address on the account. A lookup answers about the address it was given and nothing else.",
    "Check the provider console for the last attempt to this address. Ours is a record of what we refuse, never of what a mailbox accepted.",
  ];
  return ingestion
    ? {
        title: "Nothing here is blocking this address",
        detail:
          "The email block list for this project holds nothing for it, so the next message to it is attempted normally. That is not the same as one arriving: this list says what we refuse to send, never what a mailbox did with what we sent.",
        steps,
      }
    : {
        title: "Not blocked, and that settles less than it sounds",
        detail:
          "The list holds nothing for this address, and nothing writes to the list yet. So this answer cannot tell a mailbox that never bounced apart from one that bounced without being recorded, and a dead address is still being sent to.",
        steps: [
          ...steps,
          "Treat this as unknown rather than as deliverable until the provider events land.",
        ],
      };
}

/*
 * Releasing.
 */

export type ReleaseRule = "direct" | "justified" | "elsewhere";

export interface ReleaseDecision {
  rule: ReleaseRule;
  /** Whether this screen can do it at all. */
  allowed: boolean;
  /** The words on the action, or where the release lives instead. */
  note: string;
}

/**
 * Whether a block can be released from here, and what it costs to do it.
 *
 * Release is conditional on purpose (notes/email-suppressions.md): a channel this screen
 * does not own is not touched by anything on it, and a block a provider reported is
 * overruling a mailbox rather than undoing a mistake, so it asks for a reason.
 */
export function releaseDecision(row: SuppressionRow): ReleaseDecision {
  if (row.channel !== "email") {
    return {
      rule: "elsewhere",
      allowed: false,
      note: `This screen releases the email block only. The ${SUPPRESSION_CHANNEL_LABELS[row.channel]} block on this address is a separate record and nothing here touches it.`,
    };
  }
  if (reasonInfo(row.reason)?.reported ?? true) {
    return {
      rule: "justified",
      allowed: true,
      note: "A provider reported this one, so releasing it asks for the evidence that sending can resume. The reason is kept with the release.",
    };
  }
  return {
    rule: "direct",
    allowed: true,
    note: "This block was added from the dashboard rather than reported, so releasing it needs no further evidence.",
  };
}

export const JUSTIFICATION_MIN = 12;

export type JustificationIssue = "empty" | "too_short";

export const JUSTIFICATION_ISSUE_LABELS: Record<JustificationIssue, string> = {
  empty: "Say what makes it safe to send to this address again.",
  too_short: `A few words at least: ${JUSTIFICATION_MIN} characters, so the record means something to whoever reads it next.`,
};

export function validateJustification(value: string): JustificationIssue | null {
  const trimmed = value.trim();
  if (trimmed === "") return "empty";
  return trimmed.length < JUSTIFICATION_MIN ? "too_short" : null;
}

/** An example in the reader's own case, so the field is not answered with "fixed". */
export function justificationExample(reason: string): string {
  switch (reason) {
    case "hard_bounce":
      return "For example: owner confirmed the mailbox accepts mail again.";
    case "complaint":
      return "For example: owner asked us to resume sign-in mail on this address.";
    case "invalid_address":
      return "For example: the domain was mistyped in our own template, not on the account.";
    case "list_unsubscribe":
      return "For example: owner confirmed they still want sign-in codes.";
    default:
      return "For example: the investigation this was added for is closed.";
  }
}
