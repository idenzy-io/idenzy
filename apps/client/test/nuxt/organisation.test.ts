import { describe, expect, it } from "vitest";
import {
  ORG_KIND_LABELS,
  ORG_KIND_NOTES,
  ORG_LEGAL_NOTE,
  ORG_OWNS,
  ORG_PROJECTS_NOTE,
  orgKindOf,
  PROJECT_OWNS,
} from "../../app/utils/organisation";

describe("personal or team", () => {
  it("counts the members rather than storing the answer", () => {
    expect(orgKindOf(1)).toBe("personal");
    expect(orgKindOf(2)).toBe("team");
    expect(orgKindOf(9)).toBe("team");
  });

  it("calls an empty organisation personal rather than nothing at all", () => {
    expect(orgKindOf(0)).toBe("personal");
  });

  it("has a label and a sentence for each kind", () => {
    for (const kind of ["personal", "team"] as const) {
      expect(ORG_KIND_LABELS[kind].length).toBeGreaterThan(0);
      expect(ORG_KIND_NOTES[kind].length).toBeGreaterThan(0);
    }
  });

  it("says seats are free on both, because every comparable product charges", () => {
    expect(ORG_KIND_NOTES.personal.toLowerCase()).toContain("free");
    expect(ORG_KIND_NOTES.team.toLowerCase()).toContain("free");
  });
});

describe("what belongs where", () => {
  it("puts the team and the wallet on the organisation", () => {
    const owned = ORG_OWNS.join(" ").toLowerCase();
    expect(owned).toContain("team");
    expect(owned).toContain("wallet");
  });

  it("puts users, keys and sessions on the project", () => {
    const owned = PROJECT_OWNS.join(" ").toLowerCase();
    expect(owned).toContain("keys");
    expect(owned).toContain("sessions");
  });

  it("says an organisation holds several projects and that they share nothing", () => {
    expect(ORG_PROJECTS_NOTE.toLowerCase()).toContain("project");
    expect(ORG_PROJECTS_NOTE.toLowerCase()).toContain("nothing else");
  });

  /* The panel holds a name, never a legal entity: the address and the registration are the
     payment provider's, and claiming otherwise on an invoice screen would be a promise. */
  it("refuses to call the organisation name the legal entity", () => {
    expect(ORG_LEGAL_NOTE.toLowerCase()).toContain("legal name");
    expect(ORG_LEGAL_NOTE.toLowerCase()).toContain("payment provider");
  });
});
