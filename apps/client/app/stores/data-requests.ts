/**
 * Each project's data-subject requests (`data_subject_requests`, PROJECT.md 4.13.6), and the
 * writes an operator makes on one.
 *
 * Every write refuses what the server would: a request is not closed without evidence of
 * the work and a recorded answer, refused without grounds, or extended twice. A refusal
 * resolves to the sentence to show rather than throwing, so the dialog that asked keeps its
 * input and says why.
 *
 * The placeholder is derived from the users store, as the recovery sets are, so every
 * request names an account the users screen lists, and an erasure run here is that store's
 * own erasure. It carries an overdue erasure, a request nobody has verified, one whose
 * subject was never matched and an extended one, because those are the states the screen
 * exists for. Export runs exist only while `EXPORT_JOBS.running` is set: an export on this
 * screen is a claim that somebody's data was assembled, and nothing assembles it yet.
 *
 * A placeholder until the management client exists, like every store here.
 */

import dayjs from "dayjs";
import {
  canClose,
  type DataSubjectRequest,
  type DeadlineRule,
  dueFrom,
  EXPORT_JOBS,
  type ExportJob,
  extendedDue,
  extensionBlocker,
  type IntakeDraft,
  isOpen,
  kindInfo,
  type RefusalGround,
  type RequestKind,
  type ResponseChannel,
  type Verification,
  type VerificationMethod,
  workDone,
} from "~/utils/data-requests";
import type { ProjectUser } from "~/utils/users";

const SAVE_LATENCY = 600;

/* How long a simulated export takes to start and to finish, while exports are switched on. */
const JOB_START = 1200;
const JOB_FINISH = 4800;

export type IntakeInput = Omit<IntakeDraft, "receivedAt"> & { receivedAt: string };

export type VerifyInput =
  | { outcome: "account"; userId: string; method: VerificationMethod; note: string }
  | { outcome: "no_account"; note: string };

export interface ResponseInput {
  channel: ResponseChannel;
  sentAt: string;
  summary: string;
}

export interface RefusalInput {
  ground: RefusalGround;
  reasoning: string;
  channel: ResponseChannel;
  toldAt: string;
}

export interface ExtensionInput {
  reason: string;
  /** The reviewing member's name, as the record keeps it. */
  reviewedBy: string;
  toldAt: string;
}

/** What a write answers: null once it is written, or the sentence saying why it was refused. */
export type Refusal = string | null;

const GONE = "This request is no longer on the project.";
const CLOSED = "This request is closed, and a closed request is not changed.";

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
}

export const useDataRequestsStore = defineStore("data-requests", () => {
  const users = useUsersStore();
  const members = useMembersStore();
  const projects = useProjectStore();

  const requests = ref<Record<string, DataSubjectRequest[]>>({});
  const seeded = ref(false);
  const loading = computed(() => !seeded.value);

  /* Seeded once the users arrive, so every placeholder request names somebody they list. */
  watch(
    () => users.loading,
    (waiting) => {
      if (waiting || seeded.value) return;
      requests.value = { prj_personal: [], prj_acme: acmeRequests(users.forProject("prj_acme")) };
      seeded.value = true;
    },
    { immediate: true },
  );

  function forProject(projectId: string): DataSubjectRequest[] {
    return requests.value[projectId] ?? [];
  }

  function replace(
    projectId: string,
    id: string,
    change: (request: DataSubjectRequest) => DataSubjectRequest,
  ) {
    requests.value = {
      ...requests.value,
      [projectId]: forProject(projectId).map((request) =>
        request.id === id ? change(request) : request,
      ),
    };
  }

  /**
   * Who a write is recorded against: the member reading the page.
   *
   * By way of the organisation, because a membership belongs to one and not to a project.
   * This used to hand the project id straight to the members store, which answered with the
   * owner by luck rather than by rule — and now that the store asks the API, it would be a
   * request for the team of an organisation that does not exist.
   */
  function actor(projectId: string): string {
    const org = projects.orgOf(projectId);
    const me = org === null ? null : members.currentMember(org.id);
    return me?.name ?? "You";
  }

  /**
   * The row a write is about, read after the write's latency the way a server reads the row
   * it is about to change. A string where it cannot be changed at all.
   */
  async function writable(projectId: string, id: string): Promise<DataSubjectRequest | string> {
    await settle();
    const request = forProject(projectId).find((row) => row.id === id) ?? null;
    if (request === null) return GONE;
    return isOpen(request.status) ? request : CLOSED;
  }

  /**
   * Intake. The deadline is computed from when it reached the project, never from now, and
   * logging runs nothing: it records a request and starts its clock where it already was.
   */
  async function log(projectId: string, input: IntakeInput): Promise<string> {
    await settle();
    const request: DataSubjectRequest = {
      id: `dsr_${randomHex(12)}`,
      kind: input.kind,
      status: "received",
      subjectUserId: input.subjectUserId,
      claimedIdentity: input.subjectUserId === null ? input.claimedIdentity.trim() : null,
      receivedAt: input.receivedAt,
      loggedAt: new Date().toISOString(),
      loggedBy: actor(projectId),
      source: input.source,
      reference: input.reference.trim(),
      assigneeId: input.assigneeId,
      rule: input.rule,
      dueAt: dueFrom(input.receivedAt, input.rule),
      extension: null,
      verification: null,
      jobs: [],
      erasure: null,
      correction: null,
      response: null,
      refusal: null,
      completedAt: null,
    };
    requests.value = { ...requests.value, [projectId]: [request, ...forProject(projectId)] };
    return request.id;
  }

  async function assign(
    projectId: string,
    id: string,
    assigneeId: string | null,
  ): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    replace(projectId, id, (row) => ({ ...row, assigneeId }));
    return null;
  }

  /** The gate on everything after it. Moves the request to in progress. */
  async function verify(projectId: string, id: string, input: VerifyInput): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (request.verification !== null) return "Already verified. The record stands as it was made.";
    const verification: Verification = {
      outcome: input.outcome,
      method: input.outcome === "account" ? input.method : null,
      note: input.note.trim(),
      by: actor(projectId),
      at: new Date().toISOString(),
    };
    replace(projectId, id, (row) => ({
      ...row,
      status: "in_progress",
      subjectUserId: input.outcome === "account" ? input.userId : null,
      verification,
    }));
    return null;
  }

  function patchJob(projectId: string, id: string, jobId: string, change: Partial<ExportJob>) {
    replace(projectId, id, (row) => ({
      ...row,
      jobs: row.jobs.map((job) => (job.id === jobId ? { ...job, ...change } : job)),
    }));
  }

  /**
   * Starts an export run, or another one after a failure. Refused outright while nothing
   * builds an export, which is today: the run below is what the worker's answer will look
   * like once it exists, and never happens until then.
   */
  async function prepareExport(projectId: string, id: string): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (!EXPORT_JOBS.running) return EXPORT_JOBS.reason;
    if (kindInfo(request.kind).work !== "export") {
      return "Only an access or portability request is answered with an export.";
    }
    if (request.verification?.outcome !== "account") {
      return "Verify whose account it is first. An export is built for one account.";
    }
    if (request.jobs.some((job) => job.state === "succeeded")) {
      return "An export already finished for this request.";
    }
    if (request.jobs.some((job) => job.state === "queued" || job.state === "running")) {
      return "An export is already running for this request.";
    }
    const job: ExportJob = {
      id: `job_${randomHex(8)}`,
      state: "queued",
      startedAt: new Date().toISOString(),
      startedBy: actor(projectId),
      finishedAt: null,
      failure: null,
      artifactUri: null,
      tables: [],
    };
    replace(projectId, id, (row) => ({ ...row, jobs: [...row.jobs, job] }));
    setTimeout(() => patchJob(projectId, id, job.id, { state: "running" }), JOB_START);
    setTimeout(
      () =>
        patchJob(projectId, id, job.id, {
          state: "succeeded",
          finishedAt: new Date().toISOString(),
          artifactUri: `https://exports.idenzy.io/${job.id}.zip`,
          tables: EXPORT_TABLES,
        }),
      JOB_FINISH,
    );
    return null;
  }

  /**
   * The erasure, through the users store's own: one action in one place, so an erasure run
   * from a request and a Delete on the users screen cannot come to differ. The request keeps
   * the account id and drops the identity they gave when they asked.
   */
  async function erase(projectId: string, id: string): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (request.kind !== "erasure") return "Only an erasure request erases an account.";
    const userId = request.verification?.outcome === "account" ? request.subjectUserId : null;
    if (userId === null) return "Verify whose account it is first. An erasure acts on one account.";
    if (request.erasure !== null) return "The erasure has already run for this request.";
    users.remove([userId]);
    replace(projectId, id, (row) => ({
      ...row,
      claimedIdentity: null,
      erasure: { by: actor(projectId), at: new Date().toISOString() },
    }));
    return null;
  }

  async function recordCorrection(
    projectId: string,
    id: string,
    summary: string,
  ): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (request.kind !== "rectification")
      return "Only a rectification request records a correction.";
    if (request.verification?.outcome !== "account") {
      return "Verify whose account it is first. A correction is made to one account.";
    }
    if (summary.trim() === "") return "Say what was corrected.";
    replace(projectId, id, (row) => ({
      ...row,
      correction: { summary: summary.trim(), by: actor(projectId), at: new Date().toISOString() },
    }));
    return null;
  }

  async function recordResponse(
    projectId: string,
    id: string,
    input: ResponseInput,
  ): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (request.verification === null || !workDone(request)) {
      return "The answer is recorded once the work is done. Until then there is nothing to tell them.";
    }
    if (input.summary.trim() === "") return "Say what was sent.";
    replace(projectId, id, (row) => ({
      ...row,
      response: {
        ...input,
        summary: input.summary.trim(),
        by: actor(projectId),
        at: new Date().toISOString(),
      },
    }));
    return null;
  }

  /** Completion, which only evidence opens: the work done and the answer recorded. */
  async function close(projectId: string, id: string): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (!canClose(request)) {
      return "A request closes once the work is evidenced and the answer is recorded.";
    }
    replace(projectId, id, (row) => ({
      ...row,
      status: "completed",
      completedAt: new Date().toISOString(),
    }));
    return null;
  }

  /** A refusal closes the request, and never without its grounds and reasoning. */
  async function refuse(projectId: string, id: string, input: RefusalInput): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    if (input.reasoning.trim() === "") return "A refusal needs its reasoning written down.";
    const at = new Date().toISOString();
    replace(projectId, id, (row) => ({
      ...row,
      status: "rejected",
      completedAt: at,
      refusal: { ...input, reasoning: input.reasoning.trim(), by: actor(projectId), at },
    }));
    return null;
  }

  /** One extension, told inside the first period, reviewed by somebody other than the actor. */
  async function extend(projectId: string, id: string, input: ExtensionInput): Promise<Refusal> {
    const request = await writable(projectId, id);
    if (typeof request === "string") return request;
    const by = actor(projectId);
    if (input.reviewedBy === by) return "The reviewer has to be somebody other than you.";
    const blocker = extensionBlocker(request, new Date(), 1);
    if (blocker !== null) return blocker;
    if (input.reason.trim() === "") return "Say why it needs longer. They are told the same.";
    if (Date.parse(input.toldAt) > Date.parse(request.dueAt)) {
      return "They have to be told before the first deadline passes.";
    }
    replace(projectId, id, (row) => ({
      ...row,
      dueAt: extendedDue(row.dueAt, row.rule),
      extension: {
        reason: input.reason.trim(),
        reviewedBy: input.reviewedBy,
        toldAt: input.toldAt,
        by,
        at: new Date().toISOString(),
        previousDueAt: row.dueAt,
      },
    }));
    return null;
  }

  return {
    requests,
    loading,
    forProject,
    log,
    assign,
    verify,
    prepareExport,
    erase,
    recordCorrection,
    recordResponse,
    close,
    refuse,
    extend,
  };
});

/*
 * The placeholder.
 */

/** The tables an export reads, as the handler would report them: ones the data map says hold subject fields. */
const EXPORT_TABLES: readonly string[] = [
  "users",
  "identities",
  "sessions",
  "webauthn_credentials",
  "mfa_factors",
  "audit_events",
];

function randomHex(bytes: number): string {
  let out = "";
  for (let index = 0; index < bytes * 2; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** A moment some days ago at a given local hour. Never today, so nothing lands in the future. */
function daysAgo(days: number, hour = 10, minute = 0): string {
  return dayjs()
    .subtract(days, "day")
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toISOString();
}

/** `minutes` after `from`, but never after now. */
function later(from: string, minutes: number): string {
  const at = dayjs(from).add(minutes, "minute");
  return at.isAfter(dayjs()) ? new Date().toISOString() : at.toISOString();
}

const DAY_MINUTES = 24 * 60;

const ANA = "Ana Rodríguez";
const HASAN = "Hasan Musluoglu";
const PIETER = "Pieter de Vries";

function blank(
  id: string,
  kind: RequestKind,
  receivedAt: string,
  rule: DeadlineRule = "gdpr",
): DataSubjectRequest {
  return {
    id,
    kind,
    status: "received",
    subjectUserId: null,
    claimedIdentity: null,
    receivedAt,
    loggedAt: receivedAt,
    loggedBy: ANA,
    source: "email",
    reference: "",
    assigneeId: null,
    rule,
    dueAt: dueFrom(receivedAt, rule),
    extension: null,
    verification: null,
    jobs: [],
    erasure: null,
    correction: null,
    response: null,
    refusal: null,
    completedAt: null,
  };
}

function verified(by: string, at: string, method: VerificationMethod, note = ""): Verification {
  return { outcome: "account", method, note, by, at };
}

/* Each helper answers one request, or nothing where the users store has nobody to hang it on. */

function overdueErasure(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(34, 9, 12);
  return {
    ...blank("dsr_4k2m9x7q1c3v", "erasure", received),
    status: "in_progress",
    subjectUserId: person.id,
    reference: 'Subject: "Please delete my account"',
    loggedAt: later(received, 95),
    assigneeId: "mem_ana",
    verification: verified(
      ANA,
      later(received, DAY_MINUTES + 40),
      "account_address",
      "Replied from the address on the account within the hour.",
    ),
  };
}

function unverifiedAccess(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(26, 16, 40);
  return {
    ...blank("dsr_8n3r5t2w6y0a", "access", received),
    subjectUserId: person.id,
    source: "form",
    reference: "Privacy form, submission 2231",
    loggedAt: later(received, 5),
    assigneeId: "mem_pieter",
  };
}

/** The acceptance check's request: an export that failed and a request still open on it. */
function failedPortability(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(11, 11, 20);
  const started = daysAgo(2, 15, 40);
  return {
    ...blank("dsr_2p6s9v1x4z7b", "portability", received),
    status: "in_progress",
    subjectUserId: person.id,
    source: "ticket",
    reference: "Ticket #5160",
    loggedAt: later(received, 30),
    loggedBy: HASAN,
    assigneeId: "mem_hasan",
    verification: verified(HASAN, later(received, 3 * 60), "signed_in"),
    jobs: EXPORT_JOBS.running
      ? [
          {
            id: "job_5t8w2q4e",
            state: "failed",
            startedAt: started,
            startedBy: HASAN,
            finishedAt: later(started, 12),
            failure:
              "The bundle store refused the upload: the export bucket is over its quota. Nothing was handed over, and the run can be retried as it is.",
            artifactUri: null,
            tables: [],
          },
        ]
      : [],
  };
}

/** Logged two days after it arrived, which is the case the received field exists for. */
function unmatchedAccess(): DataSubjectRequest {
  const received = daysAgo(3, 11, 5);
  return {
    ...blank("dsr_6c1f4h8j2l5n", "access", received),
    claimedIdentity: "k.andersen@example.dk",
    source: "ticket",
    reference: "Ticket #5188",
    loggedAt: daysAgo(1, 9, 30),
    loggedBy: PIETER,
  };
}

function pendingCorrection(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(6, 14, 15);
  return {
    ...blank("dsr_9d3g7k1m5p8r", "rectification", received),
    status: "in_progress",
    subjectUserId: person.id,
    reference: 'Subject: "My name is spelled wrong"',
    loggedAt: later(received, 50),
    loggedBy: HASAN,
    assigneeId: "mem_hasan",
    verification: verified(HASAN, later(received, DAY_MINUTES), "account_address"),
  };
}

function extendedAccess(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(45, 10, 0);
  const firstDue = dueFrom(received, "gdpr");
  return {
    ...blank("dsr_3e7h1k5n9q2t", "access", received),
    status: "in_progress",
    subjectUserId: person.id,
    source: "post",
    reference: "Filed as PRIV-0419",
    loggedAt: later(received, 6 * 60),
    assigneeId: "mem_ana",
    dueAt: extendedDue(firstDue, "gdpr"),
    verification: verified(
      ANA,
      later(received, 3 * DAY_MINUTES),
      "other",
      "Signed letter, matched to the billing address held on the account.",
    ),
    extension: {
      reason:
        "The account spans three workspaces, and each workspace owner has to confirm what in it is this person's before it is exported.",
      reviewedBy: HASAN,
      toldAt: later(received, 20 * DAY_MINUTES),
      by: ANA,
      at: later(received, 20 * DAY_MINUTES),
      previousDueAt: firstDue,
    },
  };
}

function ccpaErasure(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(9, 8, 50);
  return {
    ...blank("dsr_7b2e6h0k4n8q", "erasure", received, "ccpa"),
    status: "in_progress",
    subjectUserId: person.id,
    source: "form",
    reference: "Privacy form, submission 2240",
    loggedAt: later(received, 3),
    loggedBy: PIETER,
    assigneeId: "mem_pieter",
    verification: verified(PIETER, later(received, 4 * 60), "signed_in"),
  };
}

/** Hung on an account the users store already erased, so the tombstone is the evidence. */
function completedErasure(tombstone: ProjectUser): DataSubjectRequest | null {
  if (tombstone.deletedAt === null) return null;
  const erased = tombstone.deletedAt;
  const received = dayjs(erased).subtract(6, "day").toISOString();
  const answered = later(erased, 90);
  return {
    ...blank("dsr_1a5d9g3j7m0p", "erasure", received),
    status: "completed",
    subjectUserId: tombstone.id,
    reference: 'Subject: "Delete everything"',
    loggedAt: later(received, 45),
    assigneeId: "mem_ana",
    verification: verified(ANA, later(received, DAY_MINUTES), "account_address"),
    erasure: { by: ANA, at: erased },
    response: {
      channel: "email",
      sentAt: answered,
      summary: "Confirmed by email that their account and its personal data were erased.",
      by: ANA,
      at: answered,
    },
    completedAt: later(erased, 120),
  };
}

function completedCorrection(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(20, 13, 10);
  const corrected = later(received, 3 * DAY_MINUTES);
  return {
    ...blank("dsr_5f9j3m7q1t4w", "rectification", received),
    status: "completed",
    subjectUserId: person.id,
    source: "ticket",
    reference: "Ticket #5102",
    loggedAt: later(received, 20),
    loggedBy: HASAN,
    assigneeId: "mem_hasan",
    verification: verified(HASAN, later(received, 2 * DAY_MINUTES), "signed_in"),
    correction: { summary: "Display name corrected at their request.", by: HASAN, at: corrected },
    response: {
      channel: "email",
      sentAt: later(corrected, 30),
      summary: "Confirmed the new display name by email.",
      by: HASAN,
      at: later(corrected, 30),
    },
    completedAt: later(corrected, 60),
  };
}

function refusedAccess(): DataSubjectRequest {
  const received = daysAgo(22, 9, 45);
  const told = daysAgo(8, 11, 0);
  return {
    ...blank("dsr_0h4l8p2s6v9y", "access", received),
    status: "rejected",
    claimedIdentity: "unknown.sender@example.com",
    reference: 'Subject: "Send me all my data"',
    loggedAt: later(received, 25),
    assigneeId: "mem_ana",
    refusal: {
      ground: "identity",
      reasoning:
        "Sent from an address no account holds. We asked them to write from the address on their account, and had no answer in fourteen days.",
      channel: "email",
      toldAt: told,
      by: ANA,
      at: told,
    },
    completedAt: told,
  };
}

function nothingHeld(): DataSubjectRequest {
  const received = daysAgo(15, 10, 30);
  const checked = later(received, DAY_MINUTES);
  return {
    ...blank("dsr_4g8k2n6r0u3x", "access", received),
    status: "completed",
    claimedIdentity: "m.ferreira@example.pt",
    reference: 'Subject: "What do you hold on me?"',
    loggedAt: later(received, 15),
    loggedBy: PIETER,
    assigneeId: "mem_pieter",
    verification: {
      outcome: "no_account",
      method: null,
      note: "No account on this project holds that address, or any close spelling of it.",
      by: PIETER,
      at: checked,
    },
    response: {
      channel: "email",
      sentAt: later(checked, 60),
      summary: "Told them no account on this project holds that address, so nothing is held.",
      by: PIETER,
      at: later(checked, 60),
    },
    completedAt: later(checked, 90),
  };
}

/** An export whose bundle has aged out, which is what shows the record outliving the copy. */
function exportedAccess(person: ProjectUser): DataSubjectRequest {
  const received = daysAgo(50, 12, 0);
  const finished = later(received, 6 * DAY_MINUTES);
  return {
    ...blank("dsr_8m2q6t0w3z7c", "access", received),
    status: "completed",
    subjectUserId: person.id,
    source: "form",
    reference: "Privacy form, submission 2105",
    loggedAt: later(received, 10),
    assigneeId: "mem_ana",
    verification: verified(ANA, later(received, DAY_MINUTES), "signed_in"),
    jobs: [
      {
        id: "job_9r3u7x1a",
        state: "succeeded",
        startedAt: later(finished, -25),
        startedBy: ANA,
        finishedAt: finished,
        failure: null,
        /* Nulled when the bundle aged out, as `artifact_uri` is after thirty days. */
        artifactUri: null,
        tables: EXPORT_TABLES,
      },
    ],
    response: {
      channel: "email",
      sentAt: later(finished, 60),
      summary: "Sent the bundle link to the address on the account.",
      by: ANA,
      at: later(finished, 60),
    },
    completedAt: later(finished, 120),
  };
}

function acmeRequests(people: readonly ProjectUser[]): DataSubjectRequest[] {
  const living = people.filter((person) => person.deletedAt === null && person.email !== null);
  const tombstone = people.find((person) => person.deletedAt !== null) ?? null;
  const person = (index: number): ProjectUser | null => living[index] ?? null;

  const rows: (DataSubjectRequest | null)[] = [
    mapped(person(0), overdueErasure),
    mapped(person(1), unverifiedAccess),
    mapped(person(2), failedPortability),
    unmatchedAccess(),
    mapped(person(3), pendingCorrection),
    mapped(person(4), extendedAccess),
    mapped(person(5), ccpaErasure),
    tombstone === null ? null : completedErasure(tombstone),
    mapped(person(6), completedCorrection),
    refusedAccess(),
    nothingHeld(),
    EXPORT_JOBS.running ? mapped(person(7), exportedAccess) : null,
  ];
  return rows.filter((row): row is DataSubjectRequest => row !== null);
}

function mapped(
  person: ProjectUser | null,
  make: (person: ProjectUser) => DataSubjectRequest,
): DataSubjectRequest | null {
  return person === null ? null : make(person);
}
