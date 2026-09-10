import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  countByStatus,
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  filterUsers,
  INDEFINITE,
  initialsOf,
  matchesQuery,
  nameOf,
  type ProjectUser,
  sameQuery,
  statusOf,
  summariseUsers,
  type UserFilters,
  usersToCsv,
} from "../../app/utils/users";

const NOW = new Date("2026-09-09T12:00:00.000Z");

function user(overrides: Partial<ProjectUser> = {}): ProjectUser {
  return {
    id: "usr_01",
    projectId: "prj_test",
    email: "nuray@example.com",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    displayName: "Nuray Aksoy",
    avatarUrl: null,
    methods: ["password"],
    mfaEnabled: false,
    activeSessions: 1,
    bannedUntil: null,
    lastSignInAt: "2026-09-08T09:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-08T09:00:00.000Z",
    deletedAt: null,
    metadataPublic: {},
    ...overrides,
  };
}

describe("statusOf", () => {
  it("is active with nothing set", () => {
    expect(statusOf(user(), NOW)).toBe("active");
  });

  it("is suspended while the ban is ahead of now", () => {
    expect(statusOf(user({ bannedUntil: "2026-09-10T00:00:00.000Z" }), NOW)).toBe("suspended");
    expect(statusOf(user({ bannedUntil: INDEFINITE }), NOW)).toBe("suspended");
  });

  it("is active again once the ban has lapsed", () => {
    expect(statusOf(user({ bannedUntil: "2026-09-01T00:00:00.000Z" }), NOW)).toBe("active");
  });

  it("is deleted whatever else is set", () => {
    expect(
      statusOf(user({ deletedAt: "2026-09-01T00:00:00.000Z", bannedUntil: INDEFINITE }), NOW),
    ).toBe("deleted");
  });
});

describe("matchesQuery", () => {
  it("keeps everyone for a blank term", () => {
    expect(matchesQuery(user(), "  ")).toBe(true);
  });

  it("matches the name, the email and the id without regard to case", () => {
    expect(matchesQuery(user(), "NURAY")).toBe(true);
    expect(matchesQuery(user(), "@example.com")).toBe(true);
    expect(matchesQuery(user(), "USR_01")).toBe(true);
    expect(matchesQuery(user(), "james")).toBe(false);
  });

  it("matches a phone however it is punctuated", () => {
    const withPhone = user({ phone: "+14155550123" });
    expect(matchesQuery(withPhone, "(415) 555-0123")).toBe(true);
    expect(matchesQuery(withPhone, "+1 415")).toBe(true);
    expect(matchesQuery(withPhone, "+44")).toBe(false);
  });
});

describe("filterUsers", () => {
  const users = [
    user({ id: "usr_a" }),
    user({ id: "usr_b", methods: ["passkey", "google"], mfaEnabled: true, emailVerified: false }),
    user({ id: "usr_c", bannedUntil: INDEFINITE, lastSignInAt: null }),
    user({ id: "usr_d", deletedAt: "2026-08-01T00:00:00.000Z", methods: [] }),
    user({
      id: "usr_e",
      createdAt: "2026-09-09T08:00:00.000Z",
      lastSignInAt: "2026-09-09T11:00:00.000Z",
    }),
  ];

  const ids = (list: readonly ProjectUser[]) => list.map((entry) => entry.id);

  it("keeps everyone with the empty filters", () => {
    expect(ids(filterUsers(users, EMPTY_FILTERS, NOW))).toEqual([
      "usr_a",
      "usr_b",
      "usr_c",
      "usr_d",
      "usr_e",
    ]);
  });

  it("narrows by status tab", () => {
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, status: "suspended" }, NOW))).toEqual([
      "usr_c",
    ]);
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, status: "deleted" }, NOW))).toEqual([
      "usr_d",
    ]);
  });

  it("keeps a user who has any one of the chosen methods", () => {
    expect(
      ids(filterUsers(users, { ...EMPTY_FILTERS, methods: ["google", "sms_otp"] }, NOW)),
    ).toEqual(["usr_b"]);
  });

  it("reads the tristates both ways", () => {
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, mfa: "yes" }, NOW))).toEqual(["usr_b"]);
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, emailVerified: "no" }, NOW))).toEqual([
      "usr_b",
    ]);
  });

  it("windows creation and last sign-in from now, and 'never' is its own answer", () => {
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, created: "24h" }, NOW))).toEqual(["usr_e"]);
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, lastSignIn: "24h" }, NOW))).toEqual([
      "usr_e",
    ]);
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, lastSignIn: "7d" }, NOW))).toEqual([
      "usr_a",
      "usr_b",
      "usr_d",
      "usr_e",
    ]);
    expect(ids(filterUsers(users, { ...EMPTY_FILTERS, lastSignIn: "never" }, NOW))).toEqual([
      "usr_c",
    ]);
  });

  it("counts each status once and the total under all", () => {
    expect(countByStatus(users, NOW)).toEqual({ all: 5, active: 3, suspended: 1, deleted: 1 });
  });

  it("counts the filters behind the button and not the tab or the search", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, status: "active", query: "x" })).toBe(0);
    expect(
      activeFilterCount({ ...EMPTY_FILTERS, mfa: "yes", methods: ["passkey"], created: "7d" }),
    ).toBe(3);
  });
});

describe("names", () => {
  it("falls back from the name to an identifier to anonymous", () => {
    expect(nameOf(user())).toBe("Nuray Aksoy");
    expect(nameOf(user({ displayName: null }))).toBe("nuray@example.com");
    expect(nameOf(user({ displayName: null, email: null, phone: "+1415" }))).toBe("+1415");
    expect(nameOf(user({ displayName: null, email: null }))).toBe("Anonymous");
  });

  it("takes two initials from a name and one from an address", () => {
    expect(initialsOf(user())).toBe("NA");
    expect(initialsOf(user({ displayName: "Cher" }))).toBe("C");
    expect(initialsOf(user({ displayName: null }))).toBe("N");
    expect(initialsOf(user({ displayName: null, email: null }))).toBe("?");
  });
});

describe("usersToCsv", () => {
  it("writes a header and one row per user, quoting what needs it", () => {
    const csv = usersToCsv([user({ displayName: 'Nuray "Nur" Aksoy, PM' })], NOW);
    const [header, row] = csv.split("\r\n");
    expect(header?.startsWith("id,display_name,email")).toBe(true);
    expect(row).toContain('"Nuray ""Nur"" Aksoy, PM"');
    expect(row).toContain(",active,");
  });

  it("writes a blank for a null", () => {
    const [, row] = usersToCsv([user({ phone: null })], NOW).split("\r\n");
    expect(row).toContain("nuray@example.com,true,,false,");
  });
});

describe("summariseUsers", () => {
  it("counts the living and sets the erased aside", () => {
    const summary = summariseUsers(
      [
        user(),
        user({ id: "usr_02" }),
        user({ id: "usr_03", deletedAt: "2026-09-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(summary.living).toBe(2);
    expect(summary.deleted).toBe(1);
  });

  it("counts a suspension only while it stands", () => {
    const summary = summariseUsers(
      [
        user({ bannedUntil: "2026-09-10T00:00:00.000Z" }),
        user({ id: "usr_02", bannedUntil: "2026-09-01T00:00:00.000Z" }),
      ],
      NOW,
    );
    expect(summary.suspended).toBe(1);
  });

  it("separates never signed in from signed in this week", () => {
    const summary = summariseUsers(
      [
        user({ lastSignInAt: null }),
        user({ id: "usr_02", lastSignInAt: "2026-09-08T09:00:00.000Z" }),
        user({ id: "usr_03", lastSignInAt: "2026-06-01T09:00:00.000Z" }),
      ],
      NOW,
    );
    expect(summary.dormant).toBe(1);
    expect(summary.recent).toBe(1);
  });

  it("reports a share of nobody as zero rather than dividing", () => {
    expect(summariseUsers([], NOW).mfaShare).toBe(0);
    expect(summariseUsers([user({ mfaEnabled: true }), user({ id: "usr_02" })], NOW).mfaShare).toBe(
      50,
    );
  });

  it("leaves an erased row out of every measure over the living", () => {
    const summary = summariseUsers(
      [user({ deletedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-05T00:00:00.000Z" })],
      NOW,
    );
    expect(summary.joined).toBe(0);
    expect(summary.dormant).toBe(0);
  });
});

describe("filters as a query", () => {
  it("writes only what is set", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toEqual({});
    expect(filtersToQuery({ ...EMPTY_FILTERS, status: "suspended", mfa: "no" })).toEqual({
      status: "suspended",
      mfa: "no",
    });
  });

  it("never writes the search term", () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, query: "nuray@example.com" })).toEqual({});
  });

  it("reads a query back into the same filters", () => {
    const filters: UserFilters = {
      ...EMPTY_FILTERS,
      status: "active",
      emailVerified: "no",
      mfa: "yes",
      methods: ["passkey", "google"],
      created: "30d",
      lastSignIn: "never",
    };
    expect(filtersFromQuery(filtersToQuery(filters))).toEqual(filters);
  });

  it("ignores what a stale or hand-typed link asks for wrongly", () => {
    expect(
      filtersFromQuery({ status: "banned", mfa: "maybe", created: "1y", method: "telepathy" }),
    ).toEqual(EMPTY_FILTERS);
  });

  it("takes the search term from the caller and not from the URL", () => {
    expect(filtersFromQuery({ query: "someone@example.com" }, "typed").query).toBe("typed");
  });

  it("reads a repeated key as its first value", () => {
    expect(filtersFromQuery({ status: ["suspended", "active"] }).status).toBe("suspended");
  });

  it("compares two filter sets by what they would put in the URL", () => {
    expect(sameQuery(EMPTY_FILTERS, { ...EMPTY_FILTERS, query: "anything" })).toBe(true);
    expect(sameQuery(EMPTY_FILTERS, { ...EMPTY_FILTERS, mfa: "yes" })).toBe(false);
  });
});
