import { describe, expect, it } from "vitest";
import {
  actionBlocker,
  answeredLateBy,
  bundleState,
  canClose,
  type DataSubjectRequest,
  daysLeft,
  dueFrom,
  dueTone,
  dueWords,
  EXPORT_JOBS,
  type ExportJob,
  extendedDue,
  extensionBlocker,
  filterRequests,
  fromInputs,
  type IntakeDraft,
  intakeIssues,
  isDueSoon,
  isOpen,
  isOverdue,
  loggedLateBy,
  NO_REQUEST_FILTERS,
  nextActionOf,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  type RefusalRecord,
  type ResponseRecord,
  refusalIssues,
  requestFiltersFromQuery,
  requestFiltersToQuery,
  searchSubjects,
  stageSummary,
  stagesOf,
  statusLabel,
  subjectDetail,
  subjectTitle,
  summariseRequests,
  UNASSIGNED,
  type Verification,
  workDone,
} from "../../app/utils/data-requests";
import type { ProjectUser } from "../../app/utils/users";

/* Local wall-clock times throughout. The deadline is counted on the calendar the panel
   writes dates in, so a fixture in UTC would land on another day east of Greenwich. */
function local(year: number, month: number, day: number, hour = 12, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute);
}

function endOfDay(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
}

const NOW = local(2026, 9, 20);

function request(part: Partial<DataSubjectRequest> = {}): DataSubjectRequest {
  const receivedAt = part.receivedAt ?? local(2026, 9, 15).toISOString();
  const rule = part.rule ?? "gdpr";
  return {
    id: "dsr_1",
    kind: "access",
    status: "received",
    subjectUserId: "usr_abc",
    claimedIdentity: null,
    receivedAt,
    loggedAt: receivedAt,
    loggedBy: "Ana Rodríguez",
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
    ...part,
  };
}

const VERIFIED: Verification = {
  outcome: "account",
  method: "signed_in",
  note: "",
  by: "Ana Rodríguez",
  at: local(2026, 9, 16).toISOString(),
};

const RESPONSE: ResponseRecord = {
  channel: "email",
  sentAt: local(2026, 9, 18).toISOString(),
  summary: "Sent the bundle link to the account's address.",
  by: "Ana Rodríguez",
  at: local(2026, 9, 18).toISOString(),
};

function job(part: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "job_1",
    state: "succeeded",
    startedAt: local(2026, 9, 17).toISOString(),
    startedBy: "Ana Rodríguez",
    finishedAt: local(2026, 9, 17, 13).toISOString(),
    failure: null,
    artifactUri: "https://exports.idenzy.io/job_1.zip",
    tables: ["users"],
    ...part,
  };
}

function verified(part: Partial<DataSubjectRequest> = {}): DataSubjectRequest {
  return request({ status: "in_progress", verification: VERIFIED, ...part });
}

describe("the deadline", () => {
  it("runs from receipt on the calendar, so a month is a month and not thirty days", () => {
    expect(dueFrom(local(2026, 8, 31, 10), "gdpr")).toBe(endOfDay(2026, 9, 30));
    expect(dueFrom(local(2026, 9, 5, 16), "gdpr")).toBe(endOfDay(2026, 10, 5));
    expect(dueFrom(local(2026, 1, 31), "gdpr")).toBe(endOfDay(2026, 2, 28));
  });

  it("counts the CCPA's period in days", () => {
    expect(dueFrom(local(2026, 9, 1), "ccpa")).toBe(endOfDay(2026, 10, 16));
  });

  it("does not move when a request is logged days after it arrived", () => {
    const late = request({
      receivedAt: local(2026, 9, 15, 9).toISOString(),
      loggedAt: local(2026, 9, 20, 11).toISOString(),
    });
    expect(late.dueAt).toBe(endOfDay(2026, 10, 15));
    expect(loggedLateBy(late)).toBe(5);
  });

  it("is met until the due day ends, and counts calendar days either side", () => {
    const today = request({ dueAt: endOfDay(2026, 9, 20) });
    expect(daysLeft(today, NOW)).toBe(0);
    expect(dueWords(today, NOW)).toBe("Due today");
    expect(isOverdue(today, NOW)).toBe(false);

    const tomorrow = local(2026, 9, 21, 0, 1);
    expect(isOverdue(today, tomorrow)).toBe(true);
    expect(dueWords(today, tomorrow)).toBe("Overdue by 1 day");

    expect(dueWords(request({ dueAt: endOfDay(2026, 9, 25) }), NOW)).toBe("5 days left");
  });

  it("warns inside a week, and never about a closed request", () => {
    expect(isDueSoon(request({ dueAt: endOfDay(2026, 9, 27) }), NOW)).toBe(true);
    expect(isDueSoon(request({ dueAt: endOfDay(2026, 9, 28) }), NOW)).toBe(false);
    expect(isDueSoon(request({ dueAt: endOfDay(2026, 9, 22), status: "completed" }), NOW)).toBe(
      false,
    );
  });

  it("colours overdue as an error and a week out as a warning", () => {
    expect(dueTone(request({ dueAt: endOfDay(2026, 9, 18) }), NOW)).toBe("error");
    expect(dueTone(request({ dueAt: endOfDay(2026, 9, 24) }), NOW)).toBe("warning");
    expect(dueTone(request({ dueAt: endOfDay(2026, 10, 14) }), NOW)).toBe("success");
  });

  it("calls a closed request met or late, and never overdue", () => {
    const met = request({
      status: "completed",
      dueAt: endOfDay(2026, 9, 10),
      completedAt: local(2026, 9, 10, 18).toISOString(),
    });
    expect(dueWords(met, NOW)).toBe("Met");
    expect(dueTone(met, NOW)).toBe("neutral");
    expect(isOverdue(met, NOW)).toBe(false);

    const late = { ...met, completedAt: local(2026, 9, 13).toISOString() };
    expect(answeredLateBy(late)).toBe(3);
    expect(dueWords(late, NOW)).toBe("Late by 3 days");
    expect(dueTone(late, NOW)).toBe("warning");
  });
});

describe("an extension", () => {
  it("adds the rule's extension to the deadline it replaces", () => {
    expect(extendedDue(endOfDay(2026, 9, 30), "gdpr")).toBe(endOfDay(2026, 11, 30));
    expect(extendedDue(endOfDay(2026, 10, 16), "ccpa")).toBe(endOfDay(2026, 11, 30));
  });

  it("is allowed once, inside the first period, and only with a second member", () => {
    const open = verified({ dueAt: endOfDay(2026, 10, 15) });
    expect(extensionBlocker(open, NOW, 1)).toBeNull();
    expect(extensionBlocker(open, NOW, 0)).toMatch(/second member/);
    expect(extensionBlocker(open, local(2026, 10, 16), 1)).toMatch(/has passed/);
    expect(extensionBlocker({ ...open, status: "completed" }, NOW, 1)).toMatch(/closed/);

    const extended = {
      ...open,
      extension: {
        reason: "Three workspaces.",
        reviewedBy: "Hasan Musluoglu",
        toldAt: NOW.toISOString(),
        by: "Ana Rodríguez",
        at: NOW.toISOString(),
        previousDueAt: open.dueAt,
      },
    };
    expect(extensionBlocker(extended, NOW, 1)).toMatch(/once/);
  });
});

describe("the protocol's values", () => {
  it("uses the statuses the API answers with, and never refused", () => {
    expect([...REQUEST_STATUSES]).toEqual(["received", "in_progress", "completed", "rejected"]);
    expect(REQUEST_STATUSES).not.toContain("refused");
    expect(statusLabel("rejected")).toBe("Refused");
    expect(statusLabel("escalated")).toBe("escalated");
  });

  it("uses the kinds the API knows", () => {
    expect([...REQUEST_KINDS]).toEqual(["access", "portability", "erasure", "rectification"]);
  });

  it("counts only the two that are still on the clock as open", () => {
    expect(isOpen("received")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
    expect(isOpen("completed")).toBe(false);
    expect(isOpen("rejected")).toBe(false);
  });
});

describe("what finishes a request", () => {
  it("asks for the subject to be verified before anything runs", () => {
    const fresh = request();
    expect(nextActionOf(fresh)).toBe("verify");
    const [, verify, work] = stagesOf(fresh);
    expect(verify?.state).toBe("current");
    expect(work?.state).toBe("ahead");
    expect(stageSummary(fresh).label).toBe("Awaiting verification");
  });

  it("prepares an export once verified, and says why it cannot while nothing builds one", () => {
    expect(nextActionOf(verified())).toBe("prepare_export");
    expect(actionBlocker("prepare_export")).toBe(EXPORT_JOBS.running ? null : EXPORT_JOBS.reason);
  });

  it("keeps a request whose export failed open, with a retry as the next step", () => {
    const failed = verified({
      jobs: [job({ state: "failed", failure: "The upload was refused.", artifactUri: null })],
    });
    expect(isOpen(failed.status)).toBe(true);
    expect(workDone(failed)).toBe(false);
    expect(canClose(failed)).toBe(false);
    expect(nextActionOf(failed)).toBe("retry_export");
    expect(stagesOf(failed)[2]?.state).toBe("failed");
    expect(stageSummary(failed)).toEqual({ label: "Export failed", tone: "error" });
  });

  it("waits on an export that is running rather than offering another", () => {
    const running = verified({
      jobs: [job({ state: "running", finishedAt: null, artifactUri: null })],
    });
    expect(nextActionOf(running)).toBe("wait");
    expect(stagesOf(running)[2]?.state).toBe("running");
    expect(actionBlocker("wait")).not.toBeNull();
  });

  it("asks for the response once the work is done, and only then offers to close", () => {
    const exported = verified({ jobs: [job()] });
    expect(nextActionOf(exported)).toBe("record_response");
    expect(canClose(exported)).toBe(false);

    const answered = { ...exported, response: RESPONSE };
    expect(nextActionOf(answered)).toBe("close");
    expect(canClose(answered)).toBe(true);
    expect(stageSummary(answered).label).toBe("Ready to close");
  });

  it("keeps the completion when the bundle expires", () => {
    const old = job({ finishedAt: local(2026, 8, 11).toISOString() });
    expect(bundleState(old, NOW)).toBe("expired");
    expect(bundleState(job(), NOW)).toBe("live");

    const done = verified({
      status: "completed",
      jobs: [old],
      response: RESPONSE,
      completedAt: local(2026, 8, 12).toISOString(),
    });
    expect(workDone(done)).toBe(true);
    expect(stagesOf(done).every((stage) => stage.state === "done")).toBe(true);
    expect(stageSummary(done).label).toBe("Completed");
    expect(nextActionOf(done)).toBeNull();
  });

  it("never counts an erasure as done without the record of it running", () => {
    const asked = verified({ kind: "erasure" });
    expect(nextActionOf(asked)).toBe("review_erasure");
    expect(workDone(asked)).toBe(false);

    const erased = { ...asked, erasure: { by: "Ana Rodríguez", at: NOW.toISOString() } };
    expect(workDone(erased)).toBe(true);
    expect(nextActionOf(erased)).toBe("record_response");
  });

  it("asks a rectification for the correction", () => {
    expect(nextActionOf(verified({ kind: "rectification" }))).toBe("record_correction");
  });

  it("needs no work where no account holds the person", () => {
    const nobody = request({
      status: "in_progress",
      subjectUserId: null,
      claimedIdentity: "m.ferreira@example.pt",
      verification: { ...VERIFIED, outcome: "no_account", method: null },
    });
    expect(workDone(nobody)).toBe(true);
    expect(stagesOf(nobody)[2]?.label).toBe("Nothing held");
    expect(nextActionOf(nobody)).toBe("record_response");
  });

  it("closes a refused request and marks what never happened as skipped", () => {
    const refusal: RefusalRecord = {
      ground: "identity",
      reasoning: "No answer from the address on the account.",
      channel: "email",
      toldAt: NOW.toISOString(),
      by: "Ana Rodríguez",
      at: NOW.toISOString(),
    };
    const refused = request({ status: "rejected", refusal, completedAt: NOW.toISOString() });
    expect(nextActionOf(refused)).toBeNull();
    expect(stagesOf(refused).map((stage) => stage.state)).toEqual([
      "done",
      "skipped",
      "skipped",
      "done",
      "done",
    ]);
    expect(stagesOf(refused)[3]?.label).toBe("Refusal sent");
  });
});

describe("a refusal", () => {
  const receivedAt = local(2026, 9, 15).toISOString();

  it("is not recorded without its grounds, the reasoning, the date and the notice", () => {
    const issues = refusalIssues(
      { ground: null, reasoning: "  ", toldAt: null, acknowledged: false },
      receivedAt,
      NOW,
    );
    expect(Object.keys(issues).sort()).toEqual(["ground", "notice", "reasoning", "toldAt"]);

    const complete = refusalIssues(
      {
        ground: "excessive",
        reasoning: "The same request, answered on the 2nd.",
        toldAt: local(2026, 9, 19).toISOString(),
        acknowledged: true,
      },
      receivedAt,
      NOW,
    );
    expect(complete).toEqual({});
  });

  it("cannot be told before the request arrived, or on a day still to come", () => {
    const draft = { ground: "excessive" as const, reasoning: "Again.", acknowledged: true };
    const early = refusalIssues(
      { ...draft, toldAt: local(2026, 9, 1).toISOString() },
      receivedAt,
      NOW,
    );
    expect(early.toldAt).toMatch(/before/);
    const future = refusalIssues(
      { ...draft, toldAt: local(2026, 9, 25).toISOString() },
      receivedAt,
      NOW,
    );
    expect(future.toldAt).toMatch(/future/);
  });
});

describe("the queue", () => {
  const rows = [
    request({ id: "later", dueAt: endOfDay(2026, 10, 14), assigneeId: "mem_pieter" }),
    request({
      id: "late",
      dueAt: endOfDay(2026, 9, 17),
      assigneeId: "mem_ana",
      reference: "Ticket #5120",
    }),
    request({ id: "soon", dueAt: endOfDay(2026, 9, 24), kind: "erasure" }),
    request({
      id: "done",
      status: "completed",
      dueAt: endOfDay(2026, 10, 1),
      completedAt: local(2026, 9, 12).toISOString(),
    }),
    request({
      id: "refused",
      status: "rejected",
      dueAt: endOfDay(2026, 10, 1),
      completedAt: local(2026, 9, 18).toISOString(),
    }),
  ];

  const ids = (filters: Partial<typeof NO_REQUEST_FILTERS>) =>
    filterRequests(rows, { ...NO_REQUEST_FILTERS, ...filters }, NOW).map((row) => row.id);

  it("opens on what is still open, soonest deadline first", () => {
    expect(ids({})).toEqual(["late", "soon", "later"]);
  });

  it("puts closed requests after the open ones, most recently closed first", () => {
    expect(ids({ view: "all" })).toEqual(["late", "soon", "later", "refused", "done"]);
    expect(ids({ view: "closed" })).toEqual(["refused", "done"]);
  });

  it("narrows to what is overdue or due within the week", () => {
    expect(ids({ view: "overdue" })).toEqual(["late"]);
    expect(ids({ view: "due_soon" })).toEqual(["soon"]);
  });

  it("narrows by type and by owner", () => {
    expect(ids({ kinds: ["erasure"] })).toEqual(["soon"]);
    expect(ids({ owner: UNASSIGNED })).toEqual(["soon"]);
    expect(ids({ owner: "mem_ana" })).toEqual(["late"]);
  });

  it("searches the reference and whatever the page knows about the person", () => {
    expect(ids({ text: "5120" })).toEqual(["late"]);
    const named = filterRequests(rows, { ...NO_REQUEST_FILTERS, text: "amelia" }, NOW, (row) =>
      row.id === "later" ? "Amelia Hart" : "",
    );
    expect(named.map((row) => row.id)).toEqual(["later"]);
  });

  it("counts what the strip says over every request", () => {
    expect(summariseRequests(rows, NOW)).toEqual({ overdue: 1, dueSoon: 1, open: 3, closed: 2 });
  });
});

describe("the address bar", () => {
  it("keeps the view and the menus, and never the search", () => {
    expect(
      requestFiltersToQuery({
        view: "overdue",
        kinds: ["erasure", "access"],
        owner: "mem_ana",
        text: "x",
      }),
    ).toEqual({ view: "overdue", type: "access,erasure", owner: "mem_ana" });
    expect(requestFiltersToQuery(NO_REQUEST_FILTERS)).toEqual({});
  });

  it("reads them back, and ignores what it does not know", () => {
    expect(
      requestFiltersFromQuery({ view: "overdue", type: "erasure,bogus", owner: "mem_ana" }),
    ).toEqual({ view: "overdue", kinds: ["erasure"], owner: "mem_ana", text: "" });
    expect(requestFiltersFromQuery({ view: "everything" }).view).toBe("open");
    expect(requestFiltersFromQuery({ view: ["closed", "all"] }).view).toBe("closed");
  });
});

describe("logging one", () => {
  const draft: IntakeDraft = {
    kind: "access",
    subjectUserId: null,
    claimedIdentity: "",
    receivedAt: local(2026, 9, 18).toISOString(),
    source: "email",
    reference: "",
    assigneeId: null,
    rule: "gdpr",
  };

  it("needs a subject, matched to an account or described as they gave it", () => {
    expect(intakeIssues(draft, NOW).subject).toBe("subject_missing");
    expect(intakeIssues({ ...draft, claimedIdentity: "k.andersen@example.dk" }, NOW).subject).toBe(
      undefined,
    );
    expect(intakeIssues({ ...draft, subjectUserId: "usr_abc" }, NOW).subject).toBe(undefined);
  });

  it("needs when it reached you, and not a time still to come", () => {
    expect(intakeIssues({ ...draft, receivedAt: null }, NOW).received).toBe("received_missing");
    expect(
      intakeIssues({ ...draft, receivedAt: local(2026, 9, 21).toISOString() }, NOW).received,
    ).toBe("received_future");
    expect(intakeIssues(draft, NOW).received).toBe(undefined);
  });

  it("reads the date and time fields on the local calendar", () => {
    expect(fromInputs("2026-09-05", "16:30")).toBe(local(2026, 9, 5, 16, 30).toISOString());
    expect(fromInputs("2026-9-5", "16:30")).toBeNull();
    expect(fromInputs("", "")).toBeNull();
  });
});

describe("the person a request is about", () => {
  function user(part: Partial<ProjectUser> = {}): ProjectUser {
    return {
      id: "usr_abc",
      projectId: "prj_acme",
      email: "amelia.hart@example.com",
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      displayName: "Amelia Hart",
      avatarUrl: null,
      methods: ["password"],
      mfaEnabled: false,
      activeSessions: 0,
      bannedUntil: null,
      lastSignInAt: null,
      createdAt: local(2025, 1, 1).toISOString(),
      updatedAt: local(2025, 1, 1).toISOString(),
      deletedAt: null,
      metadataPublic: {},
      ...part,
    };
  }

  const people = [
    user({ id: "usr_def", email: "amelia.hartley@example.com", displayName: "Amelia Hartley" }),
    user(),
    user({ id: "usr_ghi", email: null, displayName: null, deletedAt: NOW.toISOString() }),
  ];

  it("finds an account by address, name or id, best match first", () => {
    expect(searchSubjects(people, "amelia.hart@example.com")[0]?.id).toBe("usr_abc");
    expect(searchSubjects(people, "hartley").map((person) => person.id)).toEqual(["usr_def"]);
    expect(searchSubjects(people, "usr_ghi").map((person) => person.id)).toEqual(["usr_ghi"]);
  });

  it("offers nothing on one character", () => {
    expect(searchSubjects(people, "a")).toEqual([]);
  });

  it("names a row by the account, the identity they gave, or what an erasure left", () => {
    expect(subjectTitle(request(), user())).toBe("Amelia Hart");
    expect(subjectDetail(request(), user())).toBe("amelia.hart@example.com");

    const unmatched = request({ subjectUserId: null, claimedIdentity: "k.andersen@example.dk" });
    expect(subjectTitle(unmatched, null)).toBe("k.andersen@example.dk");
    expect(subjectDetail(unmatched, null)).toBe("Not matched to an account");

    const tombstone = user({ email: null, displayName: null, deletedAt: NOW.toISOString() });
    expect(subjectTitle(request(), tombstone)).toBe("Erased account");
    expect(subjectDetail(request(), tombstone)).toBe("usr_abc");
  });
});
