import { AccountBannedError, InvalidCredentialsError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { describe, expect, it } from "vitest";
import { User, type UserState } from "../src/entities/user.js";

class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
}

const NOW = new Date("2026-09-03T12:00:00Z");
const clock = new FixedClock(NOW);

function user(overrides: Partial<UserState> = {}): User {
  return new User({
    id: "0191f3c2-9a4d-7b21-8c3e-1f2a3b4c5d6e",
    projectId: "11111111-1111-1111-1111-111111111111",
    email: "hasan@example.com",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    passwordHash: "$argon2id$v=19$m=65536,t=3,p=1$abc",
    passwordAlgoVersion: 1,
    displayName: null,
    avatarUrl: null,
    metadataPublic: {},
    metadataPrivate: {},
    bannedUntil: null,
    lastSignInAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deletedAt: null,
    ...overrides,
  });
}

describe("signing in", () => {
  it("allows an ordinary account", () => {
    expect(() => user().assertCanSignIn(clock)).not.toThrow();
  });

  // PROJECT.md 4.5: a distinguishable answer here is a membership oracle for deleted
  // accounts, so a tombstone fails exactly the way a wrong password does.
  it("refuses a tombstoned user as invalid credentials, not as not-found", () => {
    expect(() => user({ deletedAt: NOW }).assertCanSignIn(clock)).toThrow(InvalidCredentialsError);
  });

  it("refuses a banned user and says so", () => {
    const banned = user({ bannedUntil: new Date("2026-09-04T00:00:00Z") });
    expect(() => banned.assertCanSignIn(clock)).toThrow(AccountBannedError);
  });

  it("lets an expired ban through without an unban step", () => {
    const banned = user({ bannedUntil: new Date("2026-09-03T11:59:59Z") });
    expect(() => banned.assertCanSignIn(clock)).not.toThrow();
  });
});

describe("anonymous accounts", () => {
  it("is anonymous only with no identifier and no credential", () => {
    expect(user({ email: null, passwordHash: null }).isAnonymous()).toBe(true);
    expect(user({ email: null, passwordHash: null, phone: "+14155550123" }).isAnonymous()).toBe(
      false,
    );
    expect(user({ email: null }).isAnonymous()).toBe(false);
  });
});

describe("the public projection", () => {
  it("prefixes the id and never carries credential material", () => {
    const body = JSON.stringify(user().toPublic());
    expect(body).toContain("usr_0191f3c29a4d7b218c3e1f2a3b4c5d6e");
    expect(body).not.toContain("argon2");
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("metadataPrivate");
  });

  it("serializes timestamps as ISO strings", () => {
    const projection = user({ lastSignInAt: NOW }).toPublic();
    expect(projection.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(projection.lastSignInAt).toBe("2026-09-03T12:00:00.000Z");
  });
});
