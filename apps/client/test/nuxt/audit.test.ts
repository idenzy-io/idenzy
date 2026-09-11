import { describe, expect, it } from "vitest";
import {
  ACTOR_TYPES,
  type AuditEvent,
  actionInfo,
  actionsFor,
  actorsIn,
  auditCsv,
  auditFilterCount,
  auditScope,
  CHAIN_GENESIS,
  canPerform,
  categoryOf,
  filterAudit,
  groupByDay,
  hiddenEndUserCount,
  INTEGRITY_CLAIMS,
  isContiguous,
  isGenesis,
  isNotable,
  isTeamActor,
  KNOWN_ACTIONS,
  linksTo,
  NO_AUDIT_FILTERS,
  orderBySeq,
  phraseFor,
  SENSITIVE_CRITERION,
  SENSITIVE_LABEL,
  shortHash,
  summarise,
  TEAM_ACTORS,
} from "../../app/utils/audit";

const NOW = new Date("2026-09-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function event(part: Partial<AuditEvent> & Pick<AuditEvent, "seq">): AuditEvent {
  return {
    id: `evt_${part.seq}`,
    createdAt: new Date(NOW.getTime() - part.seq * 1000).toISOString(),
    actorType: "member",
    actorId: "mem_ana",
    actorName: "Ana Rodríguez",
    action: "project.settings_updated",
    target: null,
    targetName: null,
    requestId: "req_test",
    ip: "203.0.113.7",
    ua: "Mozilla/5.0",
    metadata: {},
    prevHash: "a".repeat(64),
    entryHash: "b".repeat(64),
    ...part,
  };
}

/** A run of the chain: each entry links to the one before and the sequence has no gap. */
function chain(count: number): AuditEvent[] {
  const out: AuditEvent[] = [];
  let prevHash = CHAIN_GENESIS;
  for (let index = 0; index < count; index += 1) {
    const entryHash = String(index).padStart(64, "0");
    out.push(event({ seq: index + 1, prevHash, entryHash, id: `evt_${index}` }));
    prevHash = entryHash;
  }
  return out;
}

describe("what a row says", () => {
  it("writes the action as something a person reads", () => {
    expect(phraseFor(event({ seq: 1, action: "member.invited", targetName: "Mei Tanaka" }))).toBe(
      "invited Mei Tanaka",
    );
    expect(
      phraseFor(
        event({
          seq: 2,
          action: "project.settings_updated",
          metadata: { field: "the idle timeout" },
        }),
      ),
    ).toBe("changed the idle timeout");
  });

  it("still reads as a sentence when the target has been erased", () => {
    expect(phraseFor(event({ seq: 3, action: "user.suspended" }))).toBe("suspended a record");
    expect(phraseFor(event({ seq: 4, action: "project.settings_updated" }))).toBe(
      "changed a setting",
    );
  });

  it("falls back to the target id where there is no friendlier name", () => {
    expect(phraseFor(event({ seq: 5, action: "user.deleted", target: "usr_123" }))).toBe(
      "deleted usr_123",
    );
  });

  it("hands an unknown action back as itself rather than hiding the entry", () => {
    const unknown = actionInfo("webhook.delivered");
    expect(unknown.phrase).toBe("webhook.delivered");
    expect(unknown.notable).toBe(false);
    expect(categoryOf("member.something_new")).toBe("team");
  });

  it("flags what a security review is looking for", () => {
    expect(isNotable("member.role_changed")).toBe(true);
    expect(isNotable("key.created")).toBe(true);
    expect(isNotable("staff.access_granted")).toBe(true);
    expect(isNotable("member.signed_in")).toBe(false);
  });

  it("names every action once and gives each one a phrase", () => {
    expect(new Set(KNOWN_ACTIONS.map((entry) => entry.id)).size).toBe(KNOWN_ACTIONS.length);
    for (const entry of KNOWN_ACTIONS) expect(entry.phrase.length).toBeGreaterThan(0);
  });
});

describe("who is in the record", () => {
  it("separates the team from the project's own users", () => {
    expect(ACTOR_TYPES).toEqual(["member", "api_key", "staff", "end_user", "system"]);
    expect(TEAM_ACTORS).not.toContain("end_user");
    expect(isTeamActor("member")).toBe(true);
    expect(isTeamActor("end_user")).toBe(false);
  });

  it("lists the actors present, busiest first, and leaves end users out of it", () => {
    const events = [
      event({ seq: 1, actorId: "mem_ana", actorName: "Ana" }),
      event({ seq: 2, actorId: "mem_ana", actorName: "Ana" }),
      event({ seq: 3, actorId: "key_ci", actorName: "CI", actorType: "api_key" }),
      event({ seq: 4, actorId: "usr_1", actorName: "a@example.com", actorType: "end_user" }),
    ];
    expect(actorsIn(events).map((entry) => [entry.id, entry.count])).toEqual([
      ["mem_ana", 2],
      ["key_ci", 1],
    ]);
  });

  it("counts the changes and the hands behind them", () => {
    const events = [
      event({ seq: 1, actorId: "mem_ana" }),
      event({ seq: 2, actorId: "mem_hasan", action: "key.created" }),
      event({ seq: 3, actorType: "end_user", actorId: "usr_1", action: "session.created" }),
    ];
    expect(summarise(events)).toEqual({ changes: 2, people: 2, notable: 1 });
  });
});

describe("the order", () => {
  it("is the sequence, newest first, whatever the timestamps say", () => {
    const same = new Date(NOW).toISOString();
    const events = [
      event({ seq: 1, createdAt: same }),
      event({ seq: 3, createdAt: same }),
      event({ seq: 2, createdAt: same }),
    ];
    expect(orderBySeq(events).map((entry) => entry.seq)).toEqual([3, 2, 1]);
  });

  it("leaves the list it was given alone", () => {
    const events = [event({ seq: 1 }), event({ seq: 2 })];
    orderBySeq(events);
    expect(events.map((entry) => entry.seq)).toEqual([1, 2]);
  });
});

describe("grouping by day", () => {
  it("names today and yesterday and dates the rest", () => {
    const events = [
      event({ seq: 3, createdAt: NOW.toISOString() }),
      event({ seq: 2, createdAt: new Date(NOW.getTime() - 24 * HOUR).toISOString() }),
      event({ seq: 1, createdAt: new Date(NOW.getTime() - 5 * 24 * HOUR).toISOString() }),
    ];
    const days = groupByDay(events, NOW);
    expect(days).toHaveLength(3);
    expect(days[0]?.label).toBe("Today");
    expect(days[1]?.label).toBe("Yesterday");
    expect(days[2]?.label).not.toBe("Yesterday");
  });

  it("keeps the newest day first and the newest entry first inside it", () => {
    const events = [
      event({ seq: 1, createdAt: NOW.toISOString() }),
      event({ seq: 2, createdAt: NOW.toISOString() }),
    ];
    const days = groupByDay(events, NOW);
    expect(days[0]?.events.map((entry) => entry.seq)).toEqual([2, 1]);
  });
});

describe("the chain", () => {
  it("recognises the genesis link and shortens a digest for a screen", () => {
    expect(isGenesis(CHAIN_GENESIS)).toBe(true);
    expect(shortHash("a".repeat(64))).toBe(`${"a".repeat(12)}…aaaa`);
    expect(shortHash("abc")).toBe("abc");
  });

  it("links an entry to the one before it", () => {
    const [first, second] = chain(2);
    expect(first && second && linksTo(second, first)).toBe(true);
    expect(first && second && linksTo(first, second)).toBe(false);
  });

  it("calls an unbroken run contiguous", () => {
    expect(isContiguous(chain(5))).toBe(true);
    expect(isContiguous([])).toBe(true);
  });

  it("refuses to call a gapped run contiguous, which is what a filter leaves", () => {
    const full = chain(5);
    const gapped = [full[0], full[2], full[4]].filter((entry) => entry !== undefined);
    expect(isContiguous(gapped)).toBe(false);
  });

  it("refuses a run whose sequence is unbroken but whose hashes do not meet", () => {
    const tampered = chain(3).map((entry, index) =>
      index === 1 ? { ...entry, entryHash: "f".repeat(64) } : entry,
    );
    expect(isContiguous(tampered)).toBe(false);
  });
});

describe("filtering", () => {
  const events = [
    event({ seq: 1, action: "member.signed_in", actorId: "mem_ana" }),
    event({
      seq: 2,
      action: "key.revoked",
      actorType: "api_key",
      actorId: "key_ci",
      actorName: "CI deploy key",
    }),
    event({
      seq: 3,
      action: "staff.access_granted",
      actorType: "staff",
      actorId: "stf_1",
      actorName: "Idenzy support",
    }),
    event({
      seq: 4,
      action: "session.created",
      actorType: "end_user",
      actorId: "usr_1",
      actorName: "amelia.hart@example.com",
    }),
    event({
      seq: 5,
      action: "user.suspended",
      actorId: "mem_hasan",
      actorName: "Hasan Musluoglu",
      createdAt: new Date(NOW.getTime() - 40 * 24 * HOUR).toISOString(),
    }),
  ];

  it("leaves the project's own users out until they are asked for", () => {
    const team = filterAudit(events, { ...NO_AUDIT_FILTERS, window: "any" }, NOW);
    expect(team.map((entry) => entry.seq)).toEqual([5, 3, 2, 1]);
    const all = filterAudit(
      events,
      { ...NO_AUDIT_FILTERS, window: "any", includeEndUsers: true },
      NOW,
    );
    expect(all).toHaveLength(5);
  });

  it("says how many it is setting aside", () => {
    expect(hiddenEndUserCount(events, { ...NO_AUDIT_FILTERS, window: "any" }, NOW)).toBe(1);
    expect(
      hiddenEndUserCount(
        events,
        { ...NO_AUDIT_FILTERS, window: "any", includeEndUsers: true },
        NOW,
      ),
    ).toBe(0);
  });

  it("keeps everything inside the window and nothing outside it", () => {
    const recent = filterAudit(events, { ...NO_AUDIT_FILTERS, window: "30d" }, NOW);
    expect(recent.map((entry) => entry.seq)).toEqual([3, 2, 1]);
  });

  it("narrows to one person", () => {
    const ana = filterAudit(
      events,
      { ...NO_AUDIT_FILTERS, window: "any", actorId: "mem_ana" },
      NOW,
    );
    expect(ana.map((entry) => entry.seq)).toEqual([1]);
  });

  it("narrows by kind of actor and by category", () => {
    const staff = filterAudit(
      events,
      { ...NO_AUDIT_FILTERS, window: "any", actors: ["staff"] },
      NOW,
    );
    expect(staff.map((entry) => entry.seq)).toEqual([3]);
    const keys = filterAudit(
      events,
      { ...NO_AUDIT_FILTERS, window: "any", categories: ["keys"] },
      NOW,
    );
    expect(keys.map((entry) => entry.seq)).toEqual([2]);
  });

  it("shows only what is worth reading when asked", () => {
    const flagged = filterAudit(
      events,
      { ...NO_AUDIT_FILTERS, window: "any", notableOnly: true },
      NOW,
    );
    expect(flagged.map((entry) => entry.action).sort()).toEqual([
      "key.revoked",
      "staff.access_granted",
      "user.suspended",
    ]);
  });

  it("matches text against the sentence, so nobody has to know the action id", () => {
    const found = filterAudit(events, { ...NO_AUDIT_FILTERS, window: "any", text: "revoked" }, NOW);
    expect(found.map((entry) => entry.seq)).toEqual([2]);
    const byName = filterAudit(events, { ...NO_AUDIT_FILTERS, window: "any", text: "ana" }, NOW);
    expect(byName.map((entry) => entry.seq)).toEqual([1]);
  });

  it("counts what is set, and the window is not one of them", () => {
    expect(auditFilterCount(NO_AUDIT_FILTERS)).toBe(0);
    expect(auditFilterCount({ ...NO_AUDIT_FILTERS, window: "7d" })).toBe(0);
    expect(
      auditFilterCount({
        ...NO_AUDIT_FILTERS,
        text: "x",
        notableOnly: true,
        includeEndUsers: true,
      }),
    ).toBe(3);
  });
});

describe("the export", () => {
  it("writes a header and one row per entry, newest first", () => {
    const lines = auditCsv(chain(3)).split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]?.startsWith("when,who,what")).toBe(true);
  });

  it("carries the sentence rather than only the action id", () => {
    const csv = auditCsv([event({ seq: 1, action: "member.invited", targetName: "Mei Tanaka" })]);
    expect(csv).toContain("invited Mei Tanaka");
  });

  it("quotes a cell that would otherwise break the row", () => {
    const csv = auditCsv([event({ seq: 1, targetName: 'a,b"c', action: "user.deleted" })]);
    expect(csv).toContain('"a,b""c"');
  });
});

describe("who can have done what", () => {
  it("refuses a service credential the two things only a person with a browser does", () => {
    expect(canPerform("member.signed_in", "api_key")).toBe(false);
    expect(canPerform("member.joined", "api_key")).toBe(false);
    expect(canPerform("member.signed_in", "member")).toBe(true);
    expect(canPerform("member.joined", "member")).toBe(true);
  });

  it("keeps support's own grant to support", () => {
    expect(canPerform("staff.access_granted", "staff")).toBe(true);
    expect(canPerform("staff.access_granted", "member")).toBe(false);
    expect(canPerform("staff.access_granted", "api_key")).toBe(false);
  });

  it("lets a key do the things a key does", () => {
    expect(canPerform("session.revoked", "api_key")).toBe(true);
    expect(canPerform("user.suspended", "api_key")).toBe(true);
    expect(canPerform("project.settings_updated", "api_key")).toBe(true);
  });

  it("allows an action nobody has constrained, so a new one is never invisible", () => {
    expect(canPerform("something.new", "api_key")).toBe(true);
  });

  it("narrows a table of actions to the ones an actor could author", () => {
    const actions = ["member.signed_in", "session.revoked", "staff.access_granted"];
    expect(actionsFor("api_key", actions)).toEqual(["session.revoked"]);
    expect(actionsFor("staff", actions)).toEqual(["session.revoked", "staff.access_granted"]);
  });
});

describe("what the screen may claim", () => {
  it("says entries cannot be edited through the product, not that storage is immutable", () => {
    const claims = INTEGRITY_CLAIMS.map((claim) => claim.detail).join(" ");
    expect(claims).toMatch(/no code path we could add here can change an entry/i);
    expect(claims).toMatch(/detectable is not the same as impossible/i);
  });

  it("names the two fields the chain does not cover, and why", () => {
    const outside = INTEGRITY_CLAIMS.find((claim) => claim.id === "outside");
    expect(outside?.detail).toMatch(/erasure/i);
  });

  it("gives the sensitive flag a rule rather than an opinion about the rest", () => {
    expect(SENSITIVE_LABEL).toBe("Sensitive");
    expect(SENSITIVE_CRITERION).toMatch(/an unmarked entry is not a less important one/i);
  });
});

describe("auditScope", () => {
  it("always states the project, the period, the count and the end-user decision", () => {
    const lines = auditScope(NO_AUDIT_FILTERS, "Acme Inc.", 42, "Last 30 days");
    expect(lines.map((line) => line.label)).toEqual([
      "Project",
      "Period",
      "Entries",
      "Your users' activity",
    ]);
    expect(lines[3]?.value).toBe("Excluded");
  });

  it("says so when the end-user activity is in the file", () => {
    const lines = auditScope(
      { ...NO_AUDIT_FILTERS, includeEndUsers: true },
      "Acme Inc.",
      9,
      "Last 7 days",
    );
    expect(lines.find((line) => line.label === "Your users' activity")?.value).toBe("Included");
  });

  it("lists every filter that narrowed it, so the file cannot outrun the summary", () => {
    const lines = auditScope(
      {
        ...NO_AUDIT_FILTERS,
        text: "invited",
        actors: ["api_key"],
        categories: ["keys"],
        notableOnly: true,
      },
      "Acme Inc.",
      3,
      "Last 30 days",
    );
    const labels = lines.map((line) => line.label);
    expect(labels).toContain("Search");
    expect(labels).toContain("Actor kinds");
    expect(labels).toContain("Categories");
    expect(labels).toContain("Marked");
  });
});
