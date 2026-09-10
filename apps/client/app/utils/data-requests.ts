/**
 * What a person asked us to do with their data, and how long is left to do it
 * (`data_subject_requests`, PROJECT.md 4.13.6).
 *
 * The clock is the screen. `due_at` is computed at intake, thirty days for GDPR, and an
 * overdue row pages somebody: the regulatory deadline is a monitored property of the
 * system rather than a calendar reminder, which is the difference between a control and
 * an intention. So every list here sorts and colours by what is left rather than by what
 * happened, and "overdue" is the one state on the screen drawn in the error tone.
 *
 * What a request actually touches is generated from the schema rather than listed by
 * anybody. `generateSubjectFields` in `@idenzy/compliance` walks every column declared
 * through `classified()` and reads its `subjectField` and `erasure`, so an export covers
 * a column added two years from now without a person remembering, which is the most
 * common Article 15 failure there is.
 *
 * Erasure keeps the audit trail, and that is a reconciliation rather than a compromise.
 * Classified fields are tombstoned in place, the user row survives as a shell carrying a
 * `deleted_at` and no personal data, and audit entries keep the pseudonymous user id. The
 * address and user agent on an audit entry are retained under Article 17(3)(b), which is
 * a legal obligation and not a preference, and the subject id on the request itself is
 * kept as proof the erasure was performed.
 */

import { DURATIONS } from "./time";

/*
 * What was asked for.
 */

export type RequestKind = "access" | "portability" | "erasure" | "rectification";

export const REQUEST_KINDS: readonly RequestKind[] = [
  "access",
  "portability",
  "erasure",
  "rectification",
];

export interface KindInfo {
  id: RequestKind;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** The article it comes from, because a compliance screen is read by auditors. */
  article: string;
  /** What we do about it. */
  note: string;
  /** Whether finishing it produces a bundle to hand over. */
  producesArtifact: boolean;
}

export const REQUEST_KIND_INFO: Record<RequestKind, KindInfo> = {
  access: {
    id: "access",
    label: "Access",
    icon: "material-symbols:visibility-outline",
    article: "Art. 15",
    note: "Everything we hold about the person, assembled from the columns the schema marks as theirs. A worker builds it, so a column added later is covered without anybody remembering it.",
    producesArtifact: true,
  },
  portability: {
    id: "portability",
    label: "Portability",
    icon: "material-symbols:download",
    article: "Art. 20",
    note: "The same fields as an access request, in a machine-readable form meant to be loaded somewhere else. Different obligation, same field list, so the two cannot diverge.",
    producesArtifact: true,
  },
  erasure: {
    id: "erasure",
    label: "Erasure",
    icon: "material-symbols:delete-outline",
    article: "Art. 17",
    note: "Personal fields are tombstoned in place and the account survives as a shell with no personal data in it. What stays is named below, and each thing that stays has an article behind it.",
    producesArtifact: false,
  },
  rectification: {
    id: "rectification",
    label: "Rectification",
    icon: "material-symbols:edit-outline",
    article: "Art. 16",
    note: "A correction to something we hold. Done against the account rather than by a worker, and recorded here so the request and the change are one story.",
    producesArtifact: false,
  },
};

export function kindInfo(kind: RequestKind): KindInfo {
  return REQUEST_KIND_INFO[kind];
}

/*
 * Where it has got to.
 */

export type RequestStatus = "received" | "in_progress" | "completed" | "refused";

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "received",
  "in_progress",
  "completed",
  "refused",
];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  completed: "Completed",
  refused: "Refused",
};

export const REQUEST_STATUS_TONES: Record<
  RequestStatus,
  "neutral" | "warning" | "success" | "error"
> = {
  received: "neutral",
  in_progress: "warning",
  completed: "success",
  refused: "error",
};

/**
 * The column is open text, so a status nobody here knows renders as itself. The name is
 * longer than the users screen's `STATUS_LABELS` on purpose: Nuxt auto-imports these into
 * one namespace, and an account's status is not a request's.
 */
export function statusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status as RequestStatus] ?? status;
}

/** Still on the clock. Only these two count against a deadline. */
export function isOpen(status: string): boolean {
  return status === "received" || status === "in_progress";
}

export interface DataSubjectRequest {
  id: string;
  /** Kept after erasure, as proof the erasure was performed. */
  subjectUserId: string;
  /** How the person is known to the operator reading this: their address, usually. */
  subjectLabel: string;
  kind: RequestKind;
  status: RequestStatus;
  requestedAt: string;
  /** Set at intake and monitored, because a missed statutory deadline is the finding. */
  dueAt: string;
  completedAt: string | null;
  /** Where the bundle is. Null before it exists and after it expires. */
  artifactUri: string | null;
  /** Who filed it: the person through your own flow, or somebody acting for them. */
  requestedBy: string;
}

/*
 * The clock.
 */

/** GDPR Article 12(3). One month, and the schema computes it at intake. */
export const GDPR_DUE_DAYS = 30;

/** Inside this and the row says so. A week is enough to do the work in. */
export const DUE_SOON_DAYS = 7;

/**
 * How long an export bundle survives. `artifact_uri` is classified `Days30` because it
 * contains everything about a person, so a link nobody used stops being a link.
 */
export const ARTIFACT_TTL_DAYS = 30;

/** Whole days left, negative once the deadline has passed. */
export function daysLeft(request: DataSubjectRequest, now: Date): number {
  const left = new Date(request.dueAt).getTime() - now.getTime();
  return Math.ceil(left / DURATIONS.DAY);
}

/** A closed request has no deadline left to miss, whatever the date says. */
export function isOverdue(request: DataSubjectRequest, now: Date): boolean {
  return isOpen(request.status) && daysLeft(request, now) < 0;
}

export function isDueSoon(request: DataSubjectRequest, now: Date): boolean {
  if (!isOpen(request.status)) return false;
  const left = daysLeft(request, now);
  return left >= 0 && left <= DUE_SOON_DAYS;
}

export function dueTone(
  request: DataSubjectRequest,
  now: Date,
): "success" | "warning" | "error" | "neutral" {
  if (!isOpen(request.status)) return "neutral";
  if (isOverdue(request, now)) return "error";
  return isDueSoon(request, now) ? "warning" : "success";
}

/** How the deadline reads on a row: "12 days left", "Overdue by 3 days", "Due today". */
export function dueWords(request: DataSubjectRequest, now: Date): string {
  if (!isOpen(request.status)) return "Closed";
  const left = daysLeft(request, now);
  if (left < 0) {
    const over = Math.abs(left);
    return `Overdue by ${over} ${over === 1 ? "day" : "days"}`;
  }
  if (left === 0) return "Due today";
  return `${left} ${left === 1 ? "day" : "days"} left`;
}

/** How much of the statutory window is spent, 0 to 1, for the meter beside it. */
export function windowUsed(request: DataSubjectRequest, now: Date): number {
  const from = new Date(request.requestedAt).getTime();
  const to = new Date(request.dueAt).getTime();
  if (to <= from) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - from) / (to - from)));
}

/*
 * The bundle a finished export leaves behind.
 */

export function artifactExpiresAt(request: DataSubjectRequest): string | null {
  if (request.completedAt === null) return null;
  return new Date(
    new Date(request.completedAt).getTime() + ARTIFACT_TTL_DAYS * DURATIONS.DAY,
  ).toISOString();
}

/**
 * Whether there is still something to hand over. A bundle is gone once it expires, and
 * the row keeps saying the request was completed: the obligation was met, the copy of
 * everything about a person was not kept lying around afterwards.
 */
export function isArtifactLive(request: DataSubjectRequest, now: Date): boolean {
  if (request.artifactUri === null) return false;
  const expires = artifactExpiresAt(request);
  return expires !== null && new Date(expires) > now;
}

/*
 * What an erasure leaves behind, and why.
 */

export interface ErasureRetention {
  what: string;
  why: string;
}

export const ERASURE_KEEPS: readonly ErasureRetention[] = [
  {
    what: "The account row, as a shell",
    why: "It carries a deletion stamp and no personal data. Deleting it outright would break every audit entry that refers to it, and an audit trail with holes in it is not one.",
  },
  {
    what: "The pseudonymous user id on audit entries",
    why: "It is what makes the trail attributable. It identifies nobody on its own once the personal fields behind it are gone.",
  },
  {
    what: "The address and user agent on audit entries",
    why: "Retained under Article 17(3)(b), which is a legal obligation rather than a preference. They sit outside the audit chain's digest so this is not read as tampering.",
  },
  {
    what: "This request itself, with the subject id",
    why: "It is the proof the erasure was performed, and it is the first thing an auditor asks to see.",
  },
];

/*
 * Narrowing the list.
 */

export type RequestTab = "open" | "overdue" | "closed" | "all";

export const TAB_LABELS: Record<RequestTab, string> = {
  open: "Open",
  overdue: "Overdue",
  closed: "Closed",
  all: "All",
};

export interface RequestFilters {
  tab: RequestTab;
  text: string;
  kinds: RequestKind[];
}

export const NO_REQUEST_FILTERS: RequestFilters = { tab: "open", text: "", kinds: [] };

function onTab(request: DataSubjectRequest, tab: RequestTab, now: Date): boolean {
  if (tab === "all") return true;
  if (tab === "overdue") return isOverdue(request, now);
  return tab === "open" ? isOpen(request.status) : !isOpen(request.status);
}

/** Newest deadline first for the open ones: the row that runs out soonest is the row. */
export function filterRequests(
  requests: readonly DataSubjectRequest[],
  filters: RequestFilters,
  now: Date,
): DataSubjectRequest[] {
  const text = filters.text.trim().toLowerCase();
  return requests
    .filter((request) => {
      if (!onTab(request, filters.tab, now)) return false;
      if (filters.kinds.length > 0 && !filters.kinds.includes(request.kind)) return false;
      if (text === "") return true;
      return [request.subjectLabel, request.subjectUserId, request.requestedBy, request.id]
        .join(" ")
        .toLowerCase()
        .includes(text);
    })
    .sort((first, next) => new Date(first.dueAt).getTime() - new Date(next.dueAt).getTime());
}

export interface RequestSummary {
  open: number;
  dueSoon: number;
  overdue: number;
  closed: number;
}

/** What the strip at the top says, and the one figure on it that pages somebody. */
export function summariseRequests(
  requests: readonly DataSubjectRequest[],
  now: Date,
): RequestSummary {
  return {
    open: requests.filter((request) => isOpen(request.status)).length,
    dueSoon: requests.filter((request) => isDueSoon(request, now)).length,
    overdue: requests.filter((request) => isOverdue(request, now)).length,
    closed: requests.filter((request) => !isOpen(request.status)).length,
  };
}

/*
 * Logging one.
 */

export type SubjectIssue = "subject_missing" | "subject_unknown";

export const SUBJECT_ISSUE_LABELS: Record<SubjectIssue, string> = {
  subject_missing: "An address or a user id, so the worker knows whose data to act on.",
  subject_unknown:
    "No account on this project matches. A request for somebody who was never here is one to answer rather than to run.",
};

/**
 * Whether the subject names anybody. A request is run by a worker against a user id, so a
 * request that cannot be resolved to one is a request that would silently do nothing.
 */
export function validateSubject(
  value: string,
  known: readonly { id: string; label: string }[],
): SubjectIssue | null {
  const text = value.trim().toLowerCase();
  if (text === "") return "subject_missing";
  const found = known.some(
    (entry) => entry.id.toLowerCase() === text || entry.label.toLowerCase() === text,
  );
  return found ? null : "subject_unknown";
}

/** The deadline a request logged now would carry, which the schema computes at intake. */
export function dueFrom(requestedAt: Date): string {
  return new Date(requestedAt.getTime() + GDPR_DUE_DAYS * DURATIONS.DAY).toISOString();
}
