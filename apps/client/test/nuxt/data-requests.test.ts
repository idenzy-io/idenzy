import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TTL_DAYS,
  artifactExpiresAt,
  type DataSubjectRequest,
  daysLeft,
  dueFrom,
  dueTone,
  dueWords,
  ERASURE_KEEPS,
  filterRequests,
  GDPR_DUE_DAYS,
  isArtifactLive,
  isDueSoon,
  isOpen,
  isOverdue,
  kindInfo,
  NO_REQUEST_FILTERS,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  SUBJECT_ISSUE_LABELS,
  statusLabel,
  summariseRequests,
  validateSubject,
  windowUsed,
} from "../../app/utils/data-requests";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function request(part: Partial<DataSubjectRequest> = {}): DataSubjectRequest {
  const requestedAt = part.requestedAt ?? new Date(NOW.getTime() - 5 * DAY).toISOString();
  return {
    id: "dsr_1",
    subjectUserId: "usr_abc",
    subjectLabel: "amelia.hart@example.com",
    kind: "access",
    status: "received",
    requestedAt,
    dueAt: dueFrom(new Date(requestedAt)),
    completedAt: null,
    artifactUri: null,
    requestedBy: "Their own account",
    ...part,
  };
}

describe("the kinds", () => {
  it("names each one, its article and what it does", () => {
    for (const kind of REQUEST_KINDS) {
      const info = kindInfo(kind);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.article).toMatch(/^Art\. \d+$/);
      expect(info.note.length).toBeGreaterThan(0);
    }
  });

  it("produces a bundle for the two that hand something over and neither of the others", () => {
    expect(kindInfo("access").producesArtifact).toBe(true);
    expect(kindInfo("portability").producesArtifact).toBe(true);
    expect(kindInfo("erasure").producesArtifact).toBe(false);
    expect(kindInfo("rectification").producesArtifact).toBe(false);
  });
});

describe("the status", () => {
  it("counts only the two that are still on the clock as open", () => {
    expect(isOpen("received")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
    expect(isOpen("completed")).toBe(false);
    expect(isOpen("refused")).toBe(false);
  });

  it("hands back a status it has never seen rather than hiding the row", () => {
    expect(statusLabel("received")).toBe("Received");
    expect(statusLabel("escalated")).toBe("escalated");
  });

  it("has a label for every status the column can hold", () => {
    for (const status of REQUEST_STATUSES) expect(statusLabel(status).length).toBeGreaterThan(0);
  });
});

describe("the clock", () => {
  it("computes the deadline at intake, a statutory month out", () => {
    const at = new Date("2026-09-01T00:00:00.000Z");
    expect(dueFrom(at)).toBe(new Date(at.getTime() + GDPR_DUE_DAYS * DAY).toISOString());
  });

  it("counts whole days left and goes negative once it is past", () => {
    expect(daysLeft(request(), NOW)).toBe(GDPR_DUE_DAYS - 5);
    const late = request({ requestedAt: new Date(NOW.getTime() - 34 * DAY).toISOString() });
    expect(daysLeft(late, NOW)).toBeLessThan(0);
  });

  it("calls an open request past its date overdue and a closed one never", () => {
    const late = { requestedAt: new Date(NOW.getTime() - 34 * DAY).toISOString() };
    expect(isOverdue(request(late), NOW)).toBe(true);
    expect(isOverdue(request({ ...late, status: "completed" }), NOW)).toBe(false);
    expect(isOverdue(request({ ...late, status: "refused" }), NOW)).toBe(false);
  });

  it("warns inside a week and not before", () => {
    expect(
      isDueSoon(request({ requestedAt: new Date(NOW.getTime() - 25 * DAY).toISOString() }), NOW),
    ).toBe(true);
    expect(
      isDueSoon(request({ requestedAt: new Date(NOW.getTime() - 5 * DAY).toISOString() }), NOW),
    ).toBe(false);
    expect(
      isDueSoon(request({ requestedAt: new Date(NOW.getTime() - 40 * DAY).toISOString() }), NOW),
    ).toBe(false);
  });

  it("colours overdue as the only error on the screen", () => {
    expect(
      dueTone(request({ requestedAt: new Date(NOW.getTime() - 34 * DAY).toISOString() }), NOW),
    ).toBe("error");
    expect(
      dueTone(request({ requestedAt: new Date(NOW.getTime() - 25 * DAY).toISOString() }), NOW),
    ).toBe("warning");
    expect(dueTone(request(), NOW)).toBe("success");
    expect(dueTone(request({ status: "completed" }), NOW)).toBe("neutral");
  });

  it("writes the deadline the way a row reads it", () => {
    expect(dueWords(request(), NOW)).toBe("25 days left");
    expect(
      dueWords(request({ requestedAt: new Date(NOW.getTime() - 30 * DAY).toISOString() }), NOW),
    ).toBe("Due today");
    expect(
      dueWords(request({ requestedAt: new Date(NOW.getTime() - 31 * DAY).toISOString() }), NOW),
    ).toBe("Overdue by 1 day");
    expect(dueWords(request({ status: "completed" }), NOW)).toBe("Closed");
  });

  it("fills the window as the month is spent, and never past full", () => {
    expect(windowUsed(request({ requestedAt: NOW.toISOString() }), NOW)).toBe(0);
    expect(
      windowUsed(request({ requestedAt: new Date(NOW.getTime() - 15 * DAY).toISOString() }), NOW),
    ).toBeCloseTo(0.5, 2);
    expect(
      windowUsed(request({ requestedAt: new Date(NOW.getTime() - 60 * DAY).toISOString() }), NOW),
    ).toBe(1);
  });
});

describe("the bundle a finished export leaves", () => {
  const completed = (daysSince: number): DataSubjectRequest =>
    request({
      status: "completed",
      completedAt: new Date(NOW.getTime() - daysSince * DAY).toISOString(),
      artifactUri: "https://exports.idenzy.io/dsr_1.zip",
    });

  it("expires a fixed number of days after it was built", () => {
    const done = completed(0);
    expect(artifactExpiresAt(done)).toBe(
      new Date(new Date(done.completedAt ?? "").getTime() + ARTIFACT_TTL_DAYS * DAY).toISOString(),
    );
  });

  it("is live while it is inside the window and gone afterwards", () => {
    expect(isArtifactLive(completed(1), NOW)).toBe(true);
    expect(isArtifactLive(completed(ARTIFACT_TTL_DAYS + 1), NOW)).toBe(false);
  });

  it("has none before the request finishes, and none for a kind that hands nothing over", () => {
    expect(artifactExpiresAt(request())).toBeNull();
    expect(isArtifactLive(request({ kind: "erasure", status: "completed" }), NOW)).toBe(false);
  });
});

describe("what an erasure keeps", () => {
  it("names each thing and the reason it survives", () => {
    expect(ERASURE_KEEPS.length).toBeGreaterThan(0);
    for (const kept of ERASURE_KEEPS) {
      expect(kept.what.length).toBeGreaterThan(0);
      expect(kept.why.length).toBeGreaterThan(0);
    }
  });
});

describe("the list", () => {
  const rows = [
    request({ id: "late", requestedAt: new Date(NOW.getTime() - 34 * DAY).toISOString() }),
    request({ id: "soon", requestedAt: new Date(NOW.getTime() - 25 * DAY).toISOString() }),
    request({ id: "fresh", requestedAt: new Date(NOW.getTime() - 2 * DAY).toISOString() }),
    request({ id: "done", status: "completed", subjectLabel: "wei.zhang@example.net" }),
    request({ id: "erase", kind: "erasure", subjectLabel: "j.okafor@example.net" }),
  ];

  it("opens on what is still on the clock", () => {
    const open = filterRequests(rows, NO_REQUEST_FILTERS, NOW);
    expect(open.map((row) => row.id)).not.toContain("done");
    expect(open).toHaveLength(4);
  });

  it("puts the soonest deadline first, whatever order they arrived in", () => {
    const open = filterRequests(rows, NO_REQUEST_FILTERS, NOW);
    expect(open[0]?.id).toBe("late");
    expect(open[1]?.id).toBe("soon");
  });

  it("narrows to the overdue, which is the tab that pages somebody", () => {
    const late = filterRequests(rows, { ...NO_REQUEST_FILTERS, tab: "overdue" }, NOW);
    expect(late.map((row) => row.id)).toEqual(["late"]);
  });

  it("shows the closed ones on their own tab and everything on all", () => {
    expect(filterRequests(rows, { ...NO_REQUEST_FILTERS, tab: "closed" }, NOW)).toHaveLength(1);
    expect(filterRequests(rows, { ...NO_REQUEST_FILTERS, tab: "all" }, NOW)).toHaveLength(5);
  });

  it("narrows by kind and by text", () => {
    const erasures = filterRequests(
      rows,
      { ...NO_REQUEST_FILTERS, tab: "all", kinds: ["erasure"] },
      NOW,
    );
    expect(erasures.map((row) => row.id)).toEqual(["erase"]);
    const found = filterRequests(rows, { ...NO_REQUEST_FILTERS, tab: "all", text: "wei" }, NOW);
    expect(found.map((row) => row.id)).toEqual(["done"]);
  });

  it("counts what the strip at the top says", () => {
    expect(summariseRequests(rows, NOW)).toEqual({
      open: 4,
      dueSoon: 1,
      overdue: 1,
      closed: 1,
    });
  });
});

describe("naming a subject", () => {
  const known = [{ id: "usr_abc", label: "amelia.hart@example.com" }];

  it("resolves an address or an id, however it was cased", () => {
    expect(validateSubject("Amelia.Hart@example.com", known)).toBeNull();
    expect(validateSubject("usr_abc", known)).toBeNull();
  });

  it("refuses somebody who was never here, rather than logging work that does nothing", () => {
    expect(validateSubject("nobody@example.com", known)).toBe("subject_unknown");
    expect(validateSubject("  ", known)).toBe("subject_missing");
  });

  it("has a sentence for each refusal", () => {
    for (const issue of ["subject_missing", "subject_unknown"] as const) {
      expect(SUBJECT_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});
