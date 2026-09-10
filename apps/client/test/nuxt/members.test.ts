import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  afterTransfer,
  CAPABILITIES,
  canRole,
  INVITE_ISSUE_LABELS,
  INVITE_TTL_DAYS,
  type Invitation,
  inviteExpiresAt,
  isInviteExpired,
  MEMBER_ROLES,
  type Member,
  type MemberRole,
  mayAct,
  membersWithoutMfa,
  ownerOf,
  REFUSAL_LABELS,
  refusalFor,
  roleInfo,
  validateInvite,
  withoutMember,
  withRole,
} from "../../app/utils/members";

const NOW = new Date("2026-09-20T12:00:00.000Z");

function member(id: string, role: MemberRole, part: Partial<Member> = {}): Member {
  return {
    id,
    name: id,
    email: `${id}@acme.com`,
    role,
    mfaEnrolled: true,
    joinedAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: NOW.toISOString(),
    ...part,
  };
}

const TEAM: Member[] = [
  member("owner", "owner"),
  member("admin", "admin"),
  member("dev", "developer"),
  member("viewer", "viewer"),
];

describe("the roles", () => {
  it("names each one and says what it is for", () => {
    for (const role of MEMBER_ROLES) {
      expect(roleInfo(role).label.length).toBeGreaterThan(0);
      expect(roleInfo(role).note.length).toBeGreaterThan(0);
    }
  });

  it("never offers ownership as a role to assign", () => {
    expect(ASSIGNABLE_ROLES).not.toContain("owner");
    expect(ASSIGNABLE_ROLES).toEqual(["admin", "developer", "viewer"]);
  });

  it("gives the owner everything and the viewer only the audit log", () => {
    for (const capability of CAPABILITIES) {
      expect(capability.roles).toContain("owner");
    }
    const viewerHas = CAPABILITIES.filter((entry) => entry.roles.includes("viewer"));
    expect(viewerHas.map((entry) => entry.id)).toEqual(["audit"]);
  });

  it("keeps the team and the billing away from a developer", () => {
    expect(canRole("developer", "members")).toBe(false);
    expect(canRole("developer", "billing")).toBe(false);
    expect(canRole("developer", "keys")).toBe(true);
    expect(canRole("admin", "members")).toBe(true);
  });

  it("leaves transferring and deleting the project to one seat", () => {
    expect(canRole("owner", "project")).toBe(true);
    expect(canRole("admin", "project")).toBe(false);
  });
});

describe("one owner, always", () => {
  it("finds the one there is", () => {
    expect(ownerOf(TEAM)?.id).toBe("owner");
    expect(ownerOf([])).toBeNull();
  });

  it("refuses to assign ownership as a role", () => {
    expect(withRole(TEAM, "admin", "owner")).toEqual(TEAM);
    expect(ownerOf(withRole(TEAM, "admin", "owner"))?.id).toBe("owner");
  });

  it("refuses to demote the owner", () => {
    expect(withRole(TEAM, "owner", "viewer")).toEqual(TEAM);
  });

  it("changes anybody else's role", () => {
    const next = withRole(TEAM, "dev", "admin");
    expect(next.find((entry) => entry.id === "dev")?.role).toBe("admin");
    expect(next).toHaveLength(TEAM.length);
  });

  it("moves ownership and demotes the old owner in the same change", () => {
    const next = afterTransfer(TEAM, "admin");
    expect(next.filter((entry) => entry.role === "owner").map((entry) => entry.id)).toEqual([
      "admin",
    ]);
    expect(next.find((entry) => entry.id === "owner")?.role).toBe("admin");
  });

  it("never produces two owners or none, whatever it is given", () => {
    for (const target of ["owner", "admin", "dev", "viewer", "nobody"]) {
      const next = afterTransfer(TEAM, target);
      expect(next.filter((entry) => entry.role === "owner")).toHaveLength(1);
    }
  });

  it("refuses to remove the owner and removes anybody else", () => {
    expect(withoutMember(TEAM, "owner")).toEqual(TEAM);
    expect(withoutMember(TEAM, "dev").map((entry) => entry.id)).toEqual([
      "owner",
      "admin",
      "viewer",
    ]);
  });

  it("leaves an owner behind after any removal", () => {
    for (const target of TEAM) {
      expect(ownerOf(withoutMember(TEAM, target.id))).not.toBeNull();
    }
  });
});

describe("who may do what to whom", () => {
  const owner = member("owner", "owner");
  const admin = member("admin", "admin");
  const dev = member("dev", "developer");

  it("lets an owner and an admin change the team, and nobody else", () => {
    expect(mayAct("change_role", owner, dev)).toBe(true);
    expect(mayAct("change_role", admin, dev)).toBe(true);
    expect(mayAct("change_role", dev, admin)).toBe(false);
    expect(refusalFor("change_role", dev, admin)).toBe("not_permitted");
  });

  it("refuses to touch the owner, with a different reason for each attempt", () => {
    expect(refusalFor("change_role", admin, owner)).toBe("owner_is_fixed");
    expect(refusalFor("remove", admin, owner)).toBe("owner_cannot_leave");
    expect(refusalFor("remove", owner, owner)).toBe("owner_cannot_leave");
  });

  it("leaves the transfer to the owner", () => {
    expect(mayAct("transfer", owner, admin)).toBe(true);
    expect(refusalFor("transfer", admin, dev)).toBe("only_owner_transfers");
  });

  it("has a sentence for every refusal it can report", () => {
    for (const refusal of [
      "not_permitted",
      "owner_is_fixed",
      "owner_cannot_leave",
      "only_owner_transfers",
    ] as const) {
      expect(REFUSAL_LABELS[refusal].length).toBeGreaterThan(0);
    }
  });
});

describe("invitations", () => {
  function invitation(email: string, days: number): Invitation {
    const invitedAt = new Date(NOW.getTime() - days * 86_400_000);
    return {
      id: `inv_${email}`,
      email,
      role: "developer",
      invitedBy: "owner",
      invitedAt: invitedAt.toISOString(),
      expiresAt: inviteExpiresAt(invitedAt),
    };
  }

  it("stands for a week and then does not", () => {
    expect(isInviteExpired(invitation("a@acme.com", 1), NOW)).toBe(false);
    expect(isInviteExpired(invitation("a@acme.com", INVITE_TTL_DAYS + 1), NOW)).toBe(true);
  });

  it("takes an address nobody on the team already has", () => {
    expect(validateInvite("new@acme.com", TEAM, [])).toBeNull();
  });

  it("refuses something that is not an address", () => {
    expect(validateInvite("not-an-address", TEAM, [])).toBe("email_invalid");
    expect(validateInvite("", TEAM, [])).toBe("email_invalid");
  });

  it("refuses somebody already on the team, however it was cased", () => {
    expect(validateInvite("Admin@ACME.com", TEAM, [])).toBe("already_member");
  });

  it("refuses a second invitation to the same address", () => {
    expect(validateInvite("waiting@acme.com", TEAM, [invitation("waiting@acme.com", 1)])).toBe(
      "already_invited",
    );
  });

  it("has a sentence for every issue it can report", () => {
    for (const issue of ["email_invalid", "already_member", "already_invited"] as const) {
      expect(INVITE_ISSUE_LABELS[issue].length).toBeGreaterThan(0);
    }
  });
});

describe("the second factor", () => {
  it("names who has not enrolled", () => {
    const team = [...TEAM, member("new", "developer", { mfaEnrolled: false })];
    expect(membersWithoutMfa(team).map((entry) => entry.id)).toEqual(["new"]);
    expect(membersWithoutMfa(TEAM)).toEqual([]);
  });
});
