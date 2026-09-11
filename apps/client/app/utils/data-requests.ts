/**
 * What a person asked a project to do with their data, where it has got to, and how long
 * is left (`data_subject_requests`, PROJECT.md 4.13.6).
 *
 * The deadline runs from when the request reached the project, never from when somebody
 * typed it in here, and it is counted on the calendar under the rule the request is
 * tracked against. The old screen added thirty days to the moment of logging, which moved
 * the deadline for anything logged late and called a fixed interval GDPR's month
 * (notes/data-requests.md P1).
 *
 * A request is finished by evidence, never by a badge. It can be closed once the work is
 * evidenced (an export that finished, an erasure that ran, a correction recorded, or a
 * check that found no account) and a response to the person is recorded. A refusal closes
 * it only with its grounds and a record of how the person was told.
 *
 * The row as the schema has it holds the kind, the status, the receipt, the deadline,
 * completion and the bundle. Source, assignment, rule, verification, the extension and the
 * records under a request are proposed columns, and the screen says so once.
 */

import dayjs from "dayjs";
import { nameOf, type ProjectUser } from "./users";

/*
 * What was asked for.
 */

/** Mirrored from `DsrKind` in `@idenzy/protocol/enums/compliance`. */
export type RequestKind = "access" | "portability" | "erasure" | "rectification";

export const REQUEST_KINDS: readonly RequestKind[] = [
  "access",
  "portability",
  "erasure",
  "rectification",
];

/** What finishing a kind takes: a bundle built, an erasure run, or a change recorded. */
export type RequestWork = "export" | "erasure" | "correction";

export interface KindInfo {
  id: RequestKind;
  label: string;
  /** Written out in full so @nuxt/icon bundles it. */
  icon: string;
  /** The GDPR article. Shown only where the request is tracked under GDPR. */
  article: string;
  /** What the person asked for, in one line. */
  note: string;
  /** How it is answered, for the reference card. */
  detail: string;
  work: RequestWork;
}

export const REQUEST_KIND_INFO: Record<RequestKind, KindInfo> = {
  access: {
    id: "access",
    label: "Access",
    icon: "material-symbols:visibility-outline",
    article: "Art. 15",
    note: "A copy of everything held about them.",
    detail:
      "A worker builds the bundle from the columns the schema marks as the person's, so a column added later is covered without anybody remembering it.",
    work: "export",
  },
  portability: {
    id: "portability",
    label: "Portability",
    icon: "material-symbols:download",
    article: "Art. 20",
    note: "The same data, in a form they can load somewhere else.",
    detail:
      "The access field list in a machine-readable form. Different obligation, same list, so the two cannot drift apart.",
    work: "export",
  },
  erasure: {
    id: "erasure",
    label: "Erasure",
    icon: "material-symbols:delete-outline",
    article: "Art. 17",
    note: "Their personal data erased. The account stays as a tombstone.",
    detail:
      "The same erasure as deleting the account on the users screen: personal fields cleared in place, the row kept as a tombstone so the audit trail keeps a subject it can no longer name.",
    work: "erasure",
  },
  rectification: {
    id: "rectification",
    label: "Rectification",
    icon: "material-symbols:edit-outline",
    article: "Art. 16",
    note: "Something held about them corrected.",
    detail:
      "Made on the account itself and recorded here, so the request and the change are one story.",
    work: "correction",
  },
};

export function kindInfo(kind: RequestKind): KindInfo {
  return REQUEST_KIND_INFO[kind];
}

/*
 * Where it has got to.
 */

/**
 * Mirrored from `DsrStatus` in `@idenzy/protocol/enums/compliance`, since the panel takes no
 * dependency on that package until the management client does. `rejected` is the
 * protocol's value and Refused is the reader's word for it: this list used to say
 * `refused`, which the API never answers with.
 */
export type RequestStatus = "received" | "in_progress" | "completed" | "rejected";

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "received",
  "in_progress",
  "completed",
  "rejected",
];

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  received: "Received",
  in_progress: "In progress",
  completed: "Completed",
  rejected: "Refused",
};

/** The column is open text, so a status nobody here knows renders as itself. */
export function statusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status as RequestStatus] ?? status;
}

/** Still on the clock. Only these two count against a deadline. */
export function isOpen(status: string): boolean {
  return status === "received" || status === "in_progress";
}

/*
 * How it arrived.
 */

export type RequestSource = "email" | "ticket" | "form" | "post" | "phone" | "other";

export const REQUEST_SOURCES: readonly RequestSource[] = [
  "email",
  "ticket",
  "form",
  "post",
  "phone",
  "other",
];

export interface RequestSourceInfo {
  label: string;
  icon: string;
  /** What the reference field asks for, for this source. */
  placeholder: string;
}

export const SOURCE_INFO: Record<RequestSource, RequestSourceInfo> = {
  email: {
    label: "Email",
    icon: "material-symbols:mail-outline",
    placeholder: "The email's subject line",
  },
  ticket: {
    label: "Support ticket",
    icon: "material-symbols:support-agent",
    placeholder: "Ticket #5120",
  },
  form: {
    label: "Form in your product",
    icon: "material-symbols:web",
    placeholder: "The submission's id",
  },
  post: {
    label: "Letter",
    icon: "material-symbols:description-outline",
    placeholder: "Where the scan is filed",
  },
  phone: {
    label: "Phone call",
    icon: "material-symbols:call-outline",
    placeholder: "Who took the call",
  },
  other: {
    label: "Other",
    icon: "material-symbols:more-horiz",
    placeholder: "Where it came from",
  },
};

/*
 * The clock.
 */

export type DeadlineRule = "gdpr" | "ccpa";

export const DEADLINE_RULES: readonly DeadlineRule[] = ["gdpr", "ccpa"];

interface Period {
  amount: number;
  unit: "month" | "day";
}

export interface RuleInfo {
  id: DeadlineRule;
  label: string;
  /** "one month", for a sentence. */
  period: string;
  citation: string;
  /** What an extension adds at most, for a sentence. */
  extension: string;
  note: string;
  /** What a refusal has to have told the person under this rule. */
  refusalNotice: string;
  within: Period;
  extendBy: Period;
}

export const RULE_INFO: Record<DeadlineRule, RuleInfo> = {
  gdpr: {
    id: "gdpr",
    label: "GDPR",
    period: "one month",
    citation: "Art. 12(3)",
    extension: "two further months",
    note: "One month from receipt. It can be extended once, by up to two further months, where the request is complex or one of many, if the person is told why within the first month.",
    refusalNotice:
      "The message told them why, and that they can complain to a supervisory authority and seek a judicial remedy (Art. 12(4)).",
    within: { amount: 1, unit: "month" },
    extendBy: { amount: 2, unit: "month" },
  },
  ccpa: {
    id: "ccpa",
    label: "CCPA",
    period: "45 days",
    citation: "Cal. Civ. Code 1798.130",
    extension: "45 more days",
    note: "45 days from receipt. It can be extended once, by up to 45 more days, where reasonably necessary, if the person is told within the first 45.",
    refusalNotice: "The message told them the request was refused, and the reasons for it.",
    within: { amount: 45, unit: "day" },
    extendBy: { amount: 45, unit: "day" },
  },
};

/** How the date is counted, said once on the reference card and behind the rule's glyph. */
export const CALENDAR_NOTE =
  "Counted on the calendar from the day it reached you, not as a fixed number of days. A weekend or a public holiday does not move it later here, so the date shown is never later than the rule's own. Which rule applies is your privacy owner's decision.";

/** Inside this and the row says so. A week is enough to do the work in. */
export const DUE_SOON_DAYS = 7;

/** The end of the day `by` lands on, on the calendar the panel writes dates in. */
function shift(from: string | Date, by: Period): string {
  return dayjs(from).add(by.amount, by.unit).endOf("day").toISOString();
}

/**
 * The deadline for a request that reached the project at `receivedAt`. A month is a
 * calendar month, so the 31st of August is due on the 30th of September.
 */
export function dueFrom(receivedAt: string | Date, rule: DeadlineRule): string {
  return shift(receivedAt, RULE_INFO[rule].within);
}

/** The latest an extension can move a deadline to, counted from the one it replaces. */
export function extendedDue(dueAt: string, rule: DeadlineRule): string {
  return shift(dueAt, RULE_INFO[rule].extendBy);
}

/** Calendar days until the due date: 0 on the day itself, negative once it has passed. */
export function daysLeft(request: Pick<DataSubjectRequest, "dueAt">, now: Date): number {
  return dayjs(request.dueAt).startOf("day").diff(dayjs(now).startOf("day"), "day");
}

/** A closed request has no deadline left to miss, whatever the date says. */
export function isOverdue(request: DataSubjectRequest, now: Date): boolean {
  return isOpen(request.status) && now.getTime() > Date.parse(request.dueAt);
}

export function isDueSoon(request: DataSubjectRequest, now: Date): boolean {
  return (
    isOpen(request.status) && !isOverdue(request, now) && daysLeft(request, now) <= DUE_SOON_DAYS
  );
}

/** Calendar days a closed request was answered after its deadline. Zero or less is on time. */
export function answeredLateBy(request: DataSubjectRequest): number {
  if (request.completedAt === null) return 0;
  return dayjs(request.completedAt).startOf("day").diff(dayjs(request.dueAt).startOf("day"), "day");
}

export type DueTone = "success" | "warning" | "error" | "neutral";

export function dueTone(request: DataSubjectRequest, now: Date): DueTone {
  if (!isOpen(request.status)) return answeredLateBy(request) > 0 ? "warning" : "neutral";
  if (isOverdue(request, now)) return "error";
  return isDueSoon(request, now) ? "warning" : "success";
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

/** How the deadline reads on a row: "12 days left", "Overdue by 3 days", "Met". */
export function dueWords(request: DataSubjectRequest, now: Date): string {
  if (!isOpen(request.status)) {
    const late = answeredLateBy(request);
    return late > 0 ? `Late by ${days(late)}` : "Met";
  }
  const left = daysLeft(request, now);
  if (left < 0) return `Overdue by ${days(-left)}`;
  if (left === 0) return "Due today";
  return `${days(left)} left`;
}

/** Calendar days between receipt and logging, for the line that says the clock did not wait. */
export function loggedLateBy(request: Pick<DataSubjectRequest, "receivedAt" | "loggedAt">): number {
  return dayjs(request.loggedAt)
    .startOf("day")
    .diff(dayjs(request.receivedAt).startOf("day"), "day");
}

/*
 * Who asked, and whether it is them.
 */

export type VerificationMethod = "signed_in" | "account_address" | "other";

export const VERIFICATION_METHODS: readonly VerificationMethod[] = [
  "signed_in",
  "account_address",
  "other",
];

export const VERIFICATION_INFO: Record<VerificationMethod, { label: string; note: string }> = {
  signed_in: {
    label: "Asked while signed in",
    note: "It came from inside your product, from a session on the account. Nothing more to ask them for.",
  },
  account_address: {
    label: "Confirmed from the account's address",
    note: "You wrote to the address on the account and the answer came from it.",
  },
  other: {
    label: "Another way",
    note: "Say how in the note. It is what somebody reviewing this later reads.",
  },
};

export interface Verification {
  /** Whether the check found their account, or found that no account holds them. */
  outcome: "account" | "no_account";
  /** Null where no account was found, since there is nothing to prove identity against. */
  method: VerificationMethod | null;
  note: string;
  by: string;
  at: string;
}

/*
 * The work, and what it leaves behind.
 */

export type JobState = "queued" | "running" | "failed" | "succeeded";

export const JOB_STATE_LABELS: Record<JobState, string> = {
  queued: "Queued",
  running: "Running",
  failed: "Failed",
  succeeded: "Finished",
};

export interface ExportJob {
  id: string;
  state: JobState;
  startedAt: string;
  startedBy: string;
  finishedAt: string | null;
  /** Why a run failed, in the words somebody retrying it needs. */
  failure: string | null;
  /** Where the bundle is. Null until one exists, and after it expires. */
  artifactUri: string | null;
  /** What the handler read, as `DsrResult.affectedTables` reports it. */
  tables: readonly string[];
}

/**
 * How long an export bundle survives. `artifact_uri` is classified `Days30` because it
 * holds everything about a person, so a link nobody used stops being a link.
 */
export const ARTIFACT_TTL_DAYS = 30;

/** The run that decides where the work stands: the most recent one. */
export function latestJob(request: DataSubjectRequest): ExportJob | null {
  return request.jobs[request.jobs.length - 1] ?? null;
}

export function bundleExpiresAt(job: ExportJob): string | null {
  if (job.state !== "succeeded" || job.finishedAt === null) return null;
  return dayjs(job.finishedAt).add(ARTIFACT_TTL_DAYS, "day").toISOString();
}

/**
 * Whether there is still a bundle to hand over. Expiry takes the copy and never the
 * record: the run still finished and the request still reads as answered.
 */
export function bundleState(job: ExportJob, now: Date): "none" | "live" | "expired" {
  const expires = bundleExpiresAt(job);
  if (expires === null) return "none";
  return job.artifactUri !== null && now.getTime() < Date.parse(expires) ? "live" : "expired";
}

export interface ErasureRecord {
  by: string;
  at: string;
}

export interface CorrectionRecord {
  summary: string;
  by: string;
  at: string;
}

export type ResponseChannel = "email" | "product" | "post" | "other";

export const RESPONSE_CHANNELS: readonly ResponseChannel[] = ["email", "product", "post", "other"];

export const CHANNEL_LABELS: Record<ResponseChannel, string> = {
  email: "Email",
  product: "In your product",
  post: "Letter",
  other: "Other",
};

export interface ResponseRecord {
  channel: ResponseChannel;
  /** When the person was told, which is the date the obligation was met. */
  sentAt: string;
  summary: string;
  by: string;
  at: string;
}

export type RefusalGround = "unfounded" | "excessive" | "identity" | "exemption";

export const REFUSAL_GROUNDS: readonly RefusalGround[] = [
  "unfounded",
  "excessive",
  "identity",
  "exemption",
];

export const REFUSAL_GROUND_INFO: Record<RefusalGround, { label: string; note: string }> = {
  unfounded: {
    label: "Manifestly unfounded",
    note: "Not a genuine use of the right, such as a request made only to disrupt.",
  },
  excessive: {
    label: "Excessive or repetitive",
    note: "The same request again, with nothing changed since it was last answered.",
  },
  identity: {
    label: "Identity could not be confirmed",
    note: "You asked them to show it is them and they could not, or did not answer.",
  },
  exemption: {
    label: "An exemption applies",
    note: "A legal duty or a legal claim needs what they asked to be erased, or answering would expose somebody else.",
  },
};

export interface RefusalRecord {
  ground: RefusalGround;
  reasoning: string;
  channel: ResponseChannel;
  toldAt: string;
  by: string;
  at: string;
}

export interface ExtensionRecord {
  reason: string;
  /** The second member who agreed it was needed. */
  reviewedBy: string;
  /** When the person was told, which has to fall inside the first period. */
  toldAt: string;
  by: string;
  at: string;
  previousDueAt: string;
}

export interface DataSubjectRequest {
  id: string;
  kind: RequestKind;
  status: RequestStatus;
  /** Null until matched to an account. Kept after an erasure, as proof it ran. */
  subjectUserId: string | null;
  /** How the person identified themselves when they asked. Cleared by an erasure. */
  claimedIdentity: string | null;
  /** When it reached the project (`requested_at`). The deadline runs from here. */
  receivedAt: string;
  /** When it was entered here, which for anything logged by hand is later. */
  loggedAt: string;
  loggedBy: string;
  source: RequestSource;
  reference: string;
  assigneeId: string | null;
  rule: DeadlineRule;
  dueAt: string;
  extension: ExtensionRecord | null;
  verification: Verification | null;
  /** Export runs in the order they were started. Only access and portability have any. */
  jobs: readonly ExportJob[];
  erasure: ErasureRecord | null;
  correction: CorrectionRecord | null;
  response: ResponseRecord | null;
  refusal: RefusalRecord | null;
  completedAt: string | null;
}

/** Whether the work a kind takes is evidenced. A check that found no account needs none. */
export function workDone(request: DataSubjectRequest): boolean {
  if (request.verification?.outcome === "no_account") return true;
  switch (kindInfo(request.kind).work) {
    case "export":
      return request.jobs.some((job) => job.state === "succeeded");
    case "erasure":
      return request.erasure !== null;
    case "correction":
      return request.correction !== null;
  }
}

/** Closing takes a verified subject, evidenced work and a recorded response. */
export function canClose(request: DataSubjectRequest): boolean {
  return (
    isOpen(request.status) &&
    request.verification !== null &&
    workDone(request) &&
    request.response !== null
  );
}

/*
 * The five stages a request moves through, and the one thing to do next.
 */

export type StageId = "received" | "verified" | "work" | "answered" | "closed";

export type StageState = "done" | "current" | "running" | "failed" | "ahead" | "skipped";

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
  at: string | null;
}

const WORK_LABELS: Record<RequestWork, { done: string; todo: string }> = {
  export: { done: "Export prepared", todo: "Prepare export" },
  erasure: { done: "Erasure run", todo: "Run erasure" },
  correction: { done: "Correction made", todo: "Make correction" },
};

function verifiedStage(request: DataSubjectRequest): Stage {
  const check = request.verification;
  if (check !== null) {
    const label = check.outcome === "no_account" ? "No account found" : "Subject verified";
    return { id: "verified", label, state: "done", at: check.at };
  }
  const state = request.status === "rejected" ? "skipped" : "current";
  return { id: "verified", label: "Verify subject", state, at: null };
}

function workEvidenceAt(request: DataSubjectRequest): string | null {
  if (request.verification?.outcome === "no_account") return request.verification.at;
  const finished = request.jobs.filter((job) => job.state === "succeeded");
  return (
    finished[finished.length - 1]?.finishedAt ??
    request.erasure?.at ??
    request.correction?.at ??
    null
  );
}

function workStage(request: DataSubjectRequest): Stage {
  const labels = WORK_LABELS[kindInfo(request.kind).work];
  if (workDone(request)) {
    const label = request.verification?.outcome === "no_account" ? "Nothing held" : labels.done;
    return { id: "work", label, state: "done", at: workEvidenceAt(request) };
  }
  if (request.status === "rejected") {
    return { id: "work", label: labels.todo, state: "skipped", at: null };
  }
  if (request.verification === null) {
    return { id: "work", label: labels.todo, state: "ahead", at: null };
  }
  const job = latestJob(request);
  if (job?.state === "queued" || job?.state === "running") {
    return { id: "work", label: "Export running", state: "running", at: job.startedAt };
  }
  if (job?.state === "failed") {
    return { id: "work", label: "Export failed", state: "failed", at: job.finishedAt };
  }
  return { id: "work", label: labels.todo, state: "current", at: null };
}

function answeredStage(request: DataSubjectRequest): Stage {
  if (request.refusal !== null) {
    return { id: "answered", label: "Refusal sent", state: "done", at: request.refusal.toldAt };
  }
  if (request.response !== null) {
    return { id: "answered", label: "Response sent", state: "done", at: request.response.sentAt };
  }
  const ready = request.verification !== null && workDone(request) && isOpen(request.status);
  return { id: "answered", label: "Send response", state: ready ? "current" : "ahead", at: null };
}

function closedStage(request: DataSubjectRequest): Stage {
  if (request.status === "completed") {
    return { id: "closed", label: "Completed", state: "done", at: request.completedAt };
  }
  if (request.status === "rejected") {
    return { id: "closed", label: "Refused", state: "done", at: request.completedAt };
  }
  return { id: "closed", label: "Close", state: canClose(request) ? "current" : "ahead", at: null };
}

/** Received, verified, the work, the answer, closed: each with what evidences it. */
export function stagesOf(request: DataSubjectRequest): Stage[] {
  return [
    { id: "received", label: "Received", state: "done", at: request.receivedAt },
    verifiedStage(request),
    workStage(request),
    answeredStage(request),
    closedStage(request),
  ];
}

export interface StageSummary {
  label: string;
  tone: "success" | "warning" | "error" | "neutral";
}

const AWAITING: Record<RequestWork, string> = {
  export: "Awaiting export",
  erasure: "Awaiting erasure",
  correction: "Awaiting correction",
};

/** Where a request stands, in the words the table's Stage column uses. */
export function stageSummary(request: DataSubjectRequest): StageSummary {
  if (request.status === "completed") return { label: "Completed", tone: "success" };
  if (request.status === "rejected") return { label: "Refused", tone: "neutral" };
  if (request.verification === null) return { label: "Awaiting verification", tone: "neutral" };
  if (!workDone(request)) {
    const job = latestJob(request);
    if (job?.state === "failed") return { label: "Export failed", tone: "error" };
    if (job?.state === "running") return { label: "Export running", tone: "neutral" };
    if (job?.state === "queued") return { label: "Export queued", tone: "neutral" };
    return { label: AWAITING[kindInfo(request.kind).work], tone: "neutral" };
  }
  if (request.response === null) return { label: "Awaiting response", tone: "neutral" };
  return { label: "Ready to close", tone: "success" };
}

export type NextAction =
  | "verify"
  | "prepare_export"
  | "retry_export"
  | "review_erasure"
  | "record_correction"
  | "record_response"
  | "close"
  | "wait";

export const NEXT_ACTION_LABELS: Record<NextAction, string> = {
  verify: "Verify subject",
  prepare_export: "Prepare export",
  retry_export: "Retry export",
  review_erasure: "Review erasure",
  record_correction: "Record correction",
  record_response: "Record response",
  close: "Close request",
  wait: "Export running",
};

function workAction(request: DataSubjectRequest): NextAction {
  switch (kindInfo(request.kind).work) {
    case "export": {
      const job = latestJob(request);
      if (job?.state === "queued" || job?.state === "running") return "wait";
      return job?.state === "failed" ? "retry_export" : "prepare_export";
    }
    case "erasure":
      return "review_erasure";
    case "correction":
      return "record_correction";
  }
}

/** The one valid next step, which is the only primary action a request offers. */
export function nextActionOf(request: DataSubjectRequest): NextAction | null {
  if (!isOpen(request.status)) return null;
  if (request.verification === null) return "verify";
  if (!workDone(request)) return workAction(request);
  return request.response === null ? "record_response" : "close";
}

/*
 * What this deployment can actually do.
 */

export interface RequestCapability {
  running: boolean;
  reason: string;
}

/**
 * `DataSubjectRequestHandler` is abstract and nothing implements it, so no worker builds a
 * bundle. Flip `running` to see the export states populated; until then an export on this
 * screen would be a claim that somebody's data was assembled.
 */
export const EXPORT_JOBS: RequestCapability = {
  running: false,
  reason:
    "No worker builds an export yet: the request handler that reads the generated field list has no implementation, so nothing can be prepared or handed over from here.",
};

/** The old screen said an overdue request pages somebody. todo.md still lists it as unbuilt. */
export const OVERDUE_ALERTS: RequestCapability = {
  running: false,
  reason:
    "Nothing pages anybody when a request goes overdue yet. This queue is the only place it shows.",
};

/** Why the next action cannot be taken from here, where it cannot. */
export function actionBlocker(action: NextAction): string | null {
  switch (action) {
    case "prepare_export":
    case "retry_export":
      return EXPORT_JOBS.running ? null : EXPORT_JOBS.reason;
    case "wait":
      return "It finishes on its own, and this request updates when it does.";
    default:
      return null;
  }
}

/**
 * Why a deadline cannot be extended, or null where it can. One extension, told to the
 * person inside the first period, and agreed by a second member.
 */
export function extensionBlocker(
  request: DataSubjectRequest,
  now: Date,
  reviewers: number,
): string | null {
  if (!isOpen(request.status)) return "A closed request keeps the deadline it had.";
  if (request.extension !== null) return "Already extended once, which is all a rule allows.";
  if (now.getTime() > Date.parse(request.dueAt)) {
    return `The first ${RULE_INFO[request.rule].period} has passed, and an extension has to be told to the person inside it.`;
  }
  if (reviewers === 0) {
    return "An extension needs a second member to review it, and nobody else on this project can.";
  }
  return null;
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
    what: "The account row, as a tombstone",
    why: "It carries a deletion stamp and no personal data. Deleting it outright would break every audit entry that refers to it.",
  },
  {
    what: "The pseudonymous user id on audit entries",
    why: "It keeps the trail attributable, and identifies nobody once the fields behind it are gone.",
  },
  {
    what: "The address and user agent on audit entries",
    why: "Retained under Art. 17(3)(b), a legal obligation. They sit outside the chain's digest, so this is not read as tampering.",
  },
  {
    what: "This request, with the account id",
    why: "It is the proof the erasure was performed. The identity they gave when they asked is cleared with the rest.",
  },
];

/*
 * Narrowing the queue.
 */

export type RequestView = "open" | "overdue" | "due_soon" | "closed" | "all";

export const REQUEST_VIEWS: readonly RequestView[] = [
  "open",
  "overdue",
  "due_soon",
  "closed",
  "all",
];

/** The owner filter's value for requests nobody holds. */
export const UNASSIGNED = "unassigned";

export interface RequestFilters {
  view: RequestView;
  kinds: RequestKind[];
  /** Empty for anyone, `UNASSIGNED`, or a member id. */
  owner: string;
  text: string;
}

export const NO_REQUEST_FILTERS: RequestFilters = { view: "open", kinds: [], owner: "", text: "" };

export function inView(request: DataSubjectRequest, view: RequestView, now: Date): boolean {
  switch (view) {
    case "open":
      return isOpen(request.status);
    case "overdue":
      return isOverdue(request, now);
    case "due_soon":
      return isDueSoon(request, now);
    case "closed":
      return !isOpen(request.status);
    case "all":
      return true;
  }
}

/**
 * The sort the queue opens on: open requests by deadline, soonest first, then the closed
 * ones, most recently closed first. A closed row's deadline is one nobody is waiting on.
 */
export function deadlineRank(request: DataSubjectRequest): number {
  if (isOpen(request.status)) return Date.parse(request.dueAt);
  return Number.MAX_SAFE_INTEGER - Date.parse(request.completedAt ?? request.dueAt);
}

function matchesOwner(request: DataSubjectRequest, owner: string): boolean {
  if (owner === "") return true;
  if (owner === UNASSIGNED) return request.assigneeId === null;
  return request.assigneeId === owner;
}

/**
 * The rows the queue shows. `describe` adds what the page knows and a request does not,
 * such as the account's name, so a search finds what the reader is looking at.
 */
export function filterRequests(
  requests: readonly DataSubjectRequest[],
  filters: RequestFilters,
  now: Date,
  describe: (request: DataSubjectRequest) => string = () => "",
): DataSubjectRequest[] {
  const text = filters.text.trim().toLowerCase();
  return requests
    .filter((request) => {
      if (!inView(request, filters.view, now)) return false;
      if (filters.kinds.length > 0 && !filters.kinds.includes(request.kind)) return false;
      if (!matchesOwner(request, filters.owner)) return false;
      if (text === "") return true;
      return [
        request.id,
        request.reference,
        request.claimedIdentity ?? "",
        request.subjectUserId ?? "",
        describe(request),
      ]
        .join(" ")
        .toLowerCase()
        .includes(text);
    })
    .sort((first, next) => deadlineRank(first) - deadlineRank(next));
}

/** How many of the menus are narrowing the queue, for the count on the toolbar. */
export function requestFilterCount(filters: RequestFilters): number {
  return (filters.kinds.length > 0 ? 1 : 0) + (filters.owner === "" ? 0 : 1);
}

function first(value: unknown): string {
  const picked = Array.isArray(value) ? value[0] : value;
  return typeof picked === "string" ? picked : "";
}

/**
 * The shareable half of the filters. The search term is left out on purpose: it is
 * whichever person is being looked for, and an address in a URL is personal data in a
 * browser history (notes/shared-experience.md).
 */
export function requestFiltersFromQuery(query: Record<string, unknown>, text = ""): RequestFilters {
  const view = first(query["view"]);
  const kinds = first(query["type"])
    .split(",")
    .filter((kind): kind is RequestKind => (REQUEST_KINDS as readonly string[]).includes(kind));
  return {
    view: (REQUEST_VIEWS as readonly string[]).includes(view) ? (view as RequestView) : "open",
    kinds: REQUEST_KINDS.filter((kind) => kinds.includes(kind)),
    owner: first(query["owner"]),
    text,
  };
}

export function requestFiltersToQuery(filters: RequestFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.view !== "open") query["view"] = filters.view;
  if (filters.kinds.length > 0) {
    query["type"] = REQUEST_KINDS.filter((kind) => filters.kinds.includes(kind)).join(",");
  }
  if (filters.owner !== "") query["owner"] = filters.owner;
  return query;
}

export interface RequestSummary {
  overdue: number;
  dueSoon: number;
  open: number;
  closed: number;
}

/** The strip at the top. Each figure is also the view it filters the queue to. */
export function summariseRequests(
  requests: readonly DataSubjectRequest[],
  now: Date,
): RequestSummary {
  return {
    overdue: requests.filter((request) => isOverdue(request, now)).length,
    dueSoon: requests.filter((request) => isDueSoon(request, now)).length,
    open: requests.filter((request) => isOpen(request.status)).length,
    closed: requests.filter((request) => !isOpen(request.status)).length,
  };
}

/*
 * The person a request is about.
 */

/** What a row is called: the account's name, the identity they gave, or what an erasure left. */
export function subjectTitle(request: DataSubjectRequest, user: ProjectUser | null): string {
  if (user !== null && user.deletedAt === null) return nameOf(user);
  if (request.claimedIdentity !== null) return request.claimedIdentity;
  return request.subjectUserId === null ? "Unknown" : "Erased account";
}

/** The line under it: an address where the name is not one, otherwise the id. */
export function subjectDetail(request: DataSubjectRequest, user: ProjectUser | null): string {
  if (user !== null && user.deletedAt === null) {
    const handle = user.email ?? user.phone;
    return user.displayName !== null && handle !== null ? handle : user.id;
  }
  return request.subjectUserId ?? "Not matched to an account";
}

function searchScore(user: ProjectUser, needle: string): number {
  const fields = [user.email, user.phone, user.displayName, user.id]
    .filter((field): field is string => field !== null)
    .map((field) => field.toLowerCase());
  if (fields.some((field) => field === needle)) return 3;
  if (fields.some((field) => field.startsWith(needle))) return 2;
  return fields.some((field) => field.includes(needle)) ? 1 : 0;
}

/**
 * Accounts a typed name, address, phone or id could mean, best match first. Two characters
 * before anything is offered, because one matches half the project.
 */
export function searchSubjects(
  users: readonly ProjectUser[],
  text: string,
  limit = 5,
): ProjectUser[] {
  const needle = text.trim().toLowerCase();
  if (needle.length < 2) return [];
  return users
    .map((user) => ({ user, score: searchScore(user, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.user);
}

/*
 * Logging one, and the records under one.
 */

export interface IntakeDraft {
  kind: RequestKind;
  subjectUserId: string | null;
  claimedIdentity: string;
  /** Null while the date and time fields do not make an instant. */
  receivedAt: string | null;
  source: RequestSource;
  reference: string;
  assigneeId: string | null;
  rule: DeadlineRule;
}

export type IntakeIssue = "subject_missing" | "received_missing" | "received_future";

export const INTAKE_ISSUE_LABELS: Record<IntakeIssue, string> = {
  subject_missing: "Pick their account, or say how they identified themselves.",
  received_missing: "A date and a time. The deadline runs from here.",
  received_future: "That is in the future. Use when it reached you.",
};

export function intakeIssues(
  draft: IntakeDraft,
  now: Date,
): { subject?: IntakeIssue; received?: IntakeIssue } {
  const issues: { subject?: IntakeIssue; received?: IntakeIssue } = {};
  if (draft.subjectUserId === null && draft.claimedIdentity.trim() === "") {
    issues.subject = "subject_missing";
  }
  if (draft.receivedAt === null) issues.received = "received_missing";
  else if (Date.parse(draft.receivedAt) > now.getTime() + 60_000) {
    issues.received = "received_future";
  }
  return issues;
}

/** The day a record says something happened, checked against the request it belongs to. */
export function dateIssue(at: string | null, receivedAt: string, now: Date): string | null {
  if (at === null) return "A date is needed.";
  if (dayjs(at).isAfter(dayjs(now).endOf("day"))) return "That is in the future.";
  if (dayjs(at).isBefore(dayjs(receivedAt).startOf("day"))) {
    return "That is before the request reached you.";
  }
  return null;
}

export interface RefusalDraft {
  ground: RefusalGround | null;
  reasoning: string;
  toldAt: string | null;
  acknowledged: boolean;
}

/** Everything a refusal is missing. Grounds, reasoning, when they were told, and the notice. */
export function refusalIssues(
  draft: RefusalDraft,
  receivedAt: string,
  now: Date,
): { ground?: string; reasoning?: string; toldAt?: string; notice?: string } {
  const issues: { ground?: string; reasoning?: string; toldAt?: string; notice?: string } = {};
  if (draft.ground === null) issues.ground = "Choose the grounds it is refused on.";
  if (draft.reasoning.trim() === "") {
    issues.reasoning = "Write the reasoning down. It is what a regulator asks to see.";
  }
  const told = dateIssue(draft.toldAt, receivedAt, now);
  if (told !== null) issues.toldAt = told;
  if (!draft.acknowledged) issues.notice = "Confirm what the message to them said.";
  return issues;
}

/*
 * The date and time fields, on the calendar the panel writes dates in.
 */

export function dateInput(at: Date | string): string {
  return dayjs(at).format("YYYY-MM-DD");
}

export function timeInput(at: Date | string): string {
  return dayjs(at).format("HH:mm");
}

/** An instant from a date field and a time field, or null where they do not make one. */
export function fromInputs(date: string, time = "00:00"): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const at = dayjs(`${date}T${time}`);
  return at.isValid() ? at.toISOString() : null;
}
