/**
 * Every session on every project the panel can show, and the one thing this screen does
 * to them: end one.
 *
 * Built on the users store rather than on a list of its own, for two reasons. Two screens
 * naming different people reads as a bug, and `ProjectUser.activeSessions` is defined as
 * the sessions still live: the generator makes exactly that many per account, so the
 * count in the users table and the rows in this one agree by construction. Revoking here
 * writes the count back so they stay agreeing.
 *
 * The account is joined at read time and never copied onto the row, which is what makes
 * an erasure on the other screen arrive here: a user with `deletedAt` set has had every
 * personal column cleared (PROJECT.md 4.13.6), and a session row is nothing but columns
 * that name a person, so their sessions go with them. The pseudonymous record of what
 * happened lives in the audit trail, which is the thing an erasure is designed to leave.
 *
 * Until the management API client exists the list is generated, deterministically from
 * each user's id, so a screenshot taken today and one taken next week show the same
 * devices. Each action below becomes one call when it does.
 */

import {
  liveCount,
  type NetworkIntel,
  type ProjectSession,
  type RevokeReason,
  reconcileSessions,
  revokeSessions,
  type SessionRow,
  type SignInFactor,
} from "~/utils/sessions";
import { DURATIONS } from "~/utils/time";
import type { ProjectUser } from "~/utils/users";

export const useSessionsStore = defineStore("sessions", () => {
  const users = useUsersStore();

  const sessions = ref<ProjectSession[]>([]);
  const loading = ref(true);

  /* Seeded once, from the first list the users store answers with. Later changes to that
     list are reconciled rather than regenerated, or a revocation made here would be
     undone by a rename made there. */
  let seeded = false;
  watch(
    () => users.users,
    (list) => {
      if (!seeded && list.length > 0) {
        seeded = true;
        sessions.value = placeholderSessions(list);
        loading.value = false;
      }
      reconcile(list);
    },
    { immediate: true },
  );

  /**
   * What the other screen did, applied here: an erasure takes an account's sessions with
   * it, and a sign-out everywhere ends them. The rule is `reconcileSessions`, which is
   * pure and tested; this only decides when to run it.
   */
  function reconcile(list: readonly ProjectUser[]) {
    const next = reconcileSessions(sessions.value, list, new Date());
    if (next.length !== sessions.value.length || next.some((s, i) => s !== sessions.value[i])) {
      sessions.value = next;
    }
  }

  /** The sessions of one project, with the account each belongs to joined on. */
  function forProject(projectId: string): SessionRow[] {
    const byId = new Map(users.users.map((user) => [user.id, user]));
    const rows: SessionRow[] = [];
    for (const session of sessions.value) {
      if (session.projectId !== projectId) continue;
      const user = byId.get(session.userId);
      // A session whose account has gone is not a row: reconcile has already dropped it.
      if (user !== undefined) rows.push({ ...session, user });
    }
    return rows;
  }

  /**
   * Ends the named sessions and reports how many were live to end.
   *
   * The default reason is the one the domain writes for a dashboard revocation. What it
   * does not do, and what the API does not do either, is reach the access tokens already
   * minted: those verify offline until they expire, unless the customer's backend holds a
   * revocation set (ADR-0009). The dialog is where that is said.
   */
  function revoke(ids: readonly string[], reason: RevokeReason = "admin_revoked"): number {
    const now = new Date();
    const result = revokeSessions(sessions.value, ids, reason, now);
    if (result.ended === 0) return 0;
    sessions.value = result.sessions;
    // Keeps `ProjectUser.activeSessions` equal to what is actually left live.
    for (const userId of result.users) {
      users.setActiveSessions(userId, liveCount(sessions.value, userId, now));
    }
    return result.ended;
  }

  return { sessions, loading, forProject, revoke };
});

/*
 * Placeholder devices. Seeded from the account's own id rather than from a counter, so a
 * user keeps their devices across a reload and two projects generated in either order
 * come out the same. Replaced wholesale by the management API.
 */

/** The project's configured timeouts, as a fresh deployment ships them (PROJECT.md 4.2). */
const IDLE_WINDOW = 14 * DURATIONS.DAY;
const ABSOLUTE_LIFETIME = 90 * DURATIONS.DAY;

interface AgentProfile {
  userAgent: string | null;
  /** What a client on this platform calls itself. Empty where none of them does. */
  names: readonly string[];
  /** There is a keystore here to bind a refresh token to (PROJECT.md 4.4). */
  bindable: boolean;
}

/**
 * The clients that actually occur, each with the names one of them would send.
 *
 * The name travels with the agent rather than being drawn beside it, because the screen's
 * whole point is that the two are different kinds of evidence: the name is the client's
 * claim and the line under it is our reading of the string. A fixture that paired
 * "MacBook Pro" with an Android agent would put a contradiction on every other row and
 * teach whoever is working on the page to distrust the one honest half.
 *
 * The last two entries are the ones worth keeping: a client that sends no agent, which is
 * every server-side SDK, and one whose string nothing here can read. Both draw as blanks,
 * and having them in the fixture is what keeps that visible.
 */
const AGENTS: readonly AgentProfile[] = [
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    names: ["MacBook Pro", "Work laptop"],
    bindable: false,
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    names: ["Work laptop", "Home desktop"],
    bindable: false,
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
    names: ["Office PC"],
    bindable: false,
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    names: ["MacBook Air"],
    bindable: false,
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    names: ["iMac"],
    bindable: false,
  },
  {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    names: ["iPhone", "iPhone 16"],
    bindable: true,
  },
  {
    userAgent:
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    names: ["Pixel 9"],
    bindable: true,
  },
  {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    names: ["Galaxy Tab"],
    bindable: true,
  },
  {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    names: ["Home desktop"],
    bindable: false,
  },
  { userAgent: "IdenzyKit/1.4.0 (build 812)", names: ["Checkout terminal"], bindable: true },
  { userAgent: null, names: [], bindable: false },
];

/** Weighted so the ordinary reasons are ordinary and the interesting one is rare. */
const END_REASONS: readonly RevokeReason[] = [
  "signed_out",
  "signed_out",
  "signed_out",
  "signed_out_everywhere",
  "password_changed",
  "admin_revoked",
  "refresh_token_reuse",
];

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

interface Dice {
  random: () => number;
  chance: (probability: number) => boolean;
  int: (from: number, to: number) => number;
  pick: <T>(list: readonly T[]) => T;
  id: (prefix: string) => string;
}

/** mulberry32, as the users fixture uses, seeded from a string rather than a number. */
function dice(seed: string): Dice {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619) >>> 0;
  }
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const roll: Dice = {
    random,
    chance: (probability) => random() < probability,
    int: (from, to) => from + Math.floor(random() * (to - from + 1)),
    // A list here is never empty, so the index is always in range.
    pick: (list) => list[Math.floor(random() * list.length)] as (typeof list)[number],
    id: (prefix) => {
      let out = "";
      for (let i = 0; i < 24; i += 1) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
      return `${prefix}_${out}`;
    },
  };
  return roll;
}

function placeholderSessions(users: readonly ProjectUser[]): ProjectSession[] {
  const now = Date.now();
  return users.flatMap((user) => sessionsFor(user, now));
}

/**
 * A user's devices: exactly as many live sessions as their row claims, plus a history of
 * ended ones. An account that has never signed in has neither, and a tombstone has
 * nothing at all.
 */
function sessionsFor(user: ProjectUser, now: number): ProjectSession[] {
  if (user.deletedAt !== null || user.lastSignInAt === null) return [];

  const roll = dice(user.id);
  const devices = devicesFor(roll, Math.max(1, user.activeSessions), firstNameOf(user));
  const amr = amrFor(roll, user);
  const history = roll.int(0, user.activeSessions > 0 ? 4 : 3);
  const home = roll.pick(COUNTRIES);

  const live = Array.from({ length: user.activeSessions }, (_, index) =>
    liveSession(roll, user, devices[index % devices.length] as Device, amr, home, now),
  );
  const past = Array.from({ length: history }, () =>
    endedSession(roll, user, roll.pick(devices), amr, home, now),
  );
  return [...live, ...past];
}

interface Device {
  id: string | null;
  name: string | null;
  userAgent: string | null;
  bound: boolean;
}

/** Where a project's people are, roughly. One is the account's home; the rest are travel. */
const COUNTRIES: readonly string[] = ["DE", "GB", "US", "TR", "FR", "NL", "JP", "BR", "IN", "SE"];

/** A Tor circuit exits where it exits, so these are the exit node and not the person. */
const TOR_EXITS: readonly string[] = ["DE", "NL", "US", "FR", "RO"];

/**
 * What an IP lookup says about the address, generated per session rather than per device:
 * a laptop is on the office network on Monday and a hotel VPN on Thursday.
 *
 * One in twelve answers nothing at all, which is the case the screen has to draw as its
 * own thing rather than as "clean". The country is the account's home most of the time,
 * because people mostly do not move, and the occasional other one is what an operator is
 * scanning the column for. Tor takes its country from the exit list, because the address
 * places the exit node and nothing about where the person is.
 */
function networkFor(roll: Dice, home: string): NetworkIntel | null {
  if (roll.chance(0.08)) return null;

  const kind = roll.random();
  if (kind < 0.015) {
    return { country: roll.pick(TOR_EXITS), vpn: false, proxy: false, tor: true };
  }
  if (kind < 0.045) {
    return { country: roll.pick(COUNTRIES), vpn: roll.chance(0.3), proxy: true, tor: false };
  }
  if (kind < 0.14) {
    return { country: roll.pick(COUNTRIES), vpn: true, proxy: false, tor: false };
  }
  return {
    country: roll.chance(0.9) ? home : roll.pick(COUNTRIES),
    vpn: false,
    proxy: false,
    tor: false,
  };
}

/**
 * The machines an account signs in from. A client that names its device also has an
 * install id, and one that does neither is a browser, which is most of them. A phone
 * usually names itself and a desktop browser rarely does, which is why so much of the
 * column reads "Unnamed device" and why that has to look deliberate rather than broken.
 *
 * Some of the names carry their owner's, because that is what people call their phones.
 * It is the whole reason `deviceName` is classified as personal data and decides nothing.
 */
function devicesFor(roll: Dice, count: number, owner: string | null): Device[] {
  return Array.from({ length: roll.int(1, Math.max(2, Math.min(count, 4))) }, () => {
    const profile = roll.pick(AGENTS);
    const named = profile.names.length > 0 && roll.chance(profile.bindable ? 0.75 : 0.25);
    const name = named ? roll.pick(profile.names) : null;
    return {
      id: named ? roll.id("dev") : null,
      name: takesPossessive(name, owner) && roll.chance(0.4) ? `${owner}'s ${name}` : name,
      userAgent: profile.userAgent,
      bound: profile.bindable && roll.chance(0.5),
    };
  });
}

/** For a device its owner named after themselves. Absent where the account has no name. */
function firstNameOf(user: ProjectUser): string | null {
  return user.displayName?.trim().split(/\s+/)[0] ?? null;
}

/** The devices somebody carries. Nobody calls the shared till "Jonas's checkout terminal". */
const PERSONAL_DEVICES: ReadonlySet<string> = new Set([
  "iPhone",
  "iPhone 16",
  "Pixel 9",
  "Galaxy Tab",
  "MacBook Pro",
  "MacBook Air",
]);

function takesPossessive(name: string | null, owner: string | null): name is string {
  return name !== null && owner !== null && PERSONAL_DEVICES.has(name);
}

/**
 * What the sign-in proved, read off the account so the two screens agree. A passkey is a
 * factor in itself, so it is never followed by a code; anything else on an account with
 * an authenticator enrolled carries the second factor and RFC 8176's `mfa` marker beside
 * it, which is what the token's `amr` claim holds.
 */
function amrFor(roll: Dice, user: ProjectUser): SignInFactor[] {
  const primary = primaryFactor(roll, user);
  if (primary === "webauthn") return ["webauthn"];
  return user.mfaEnabled ? [primary, "totp", "mfa"] : [primary];
}

function primaryFactor(roll: Dice, user: ProjectUser): SignInFactor {
  const preferred: SignInFactor[] = [];
  for (const method of user.methods) {
    if (method === "password") preferred.push("pwd");
    else if (method === "passkey") preferred.push("webauthn");
    else if (method === "email_otp") preferred.push("otp_email");
    else if (method === "sms_otp") preferred.push("otp_sms");
    else preferred.push("oauth");
  }
  return preferred.length > 0 ? roll.pick(preferred) : "otp_email";
}

/** A second factor is timestamped where the sign-in actually proved one, and not else. */
function factorVerifiedAt(amr: readonly SignInFactor[], createdAt: string): string | null {
  return amr.includes("mfa") || amr.includes("webauthn") ? createdAt : null;
}

function base(
  roll: Dice,
  user: ProjectUser,
  device: Device,
  amr: readonly SignInFactor[],
  home: string,
  createdAt: number,
): Omit<ProjectSession, "lastActiveAt" | "idleExpiresAt" | "absoluteExpiresAt"> {
  const created = new Date(createdAt).toISOString();
  return {
    id: roll.id("ses"),
    projectId: user.projectId,
    userId: user.id,
    deviceId: device.id,
    deviceName: device.name,
    ip: ipFor(roll),
    network: networkFor(roll, home),
    userAgent: device.userAgent,
    amr: [...amr],
    factorVerifiedAt: factorVerifiedAt(amr, created),
    deviceBound: device.bound,
    revokedAt: null,
    revokeReason: null,
    createdAt: created,
  };
}

/** Signed in inside the absolute lifetime and seen inside the idle window: still good. */
function liveSession(
  roll: Dice,
  user: ProjectUser,
  device: Device,
  amr: readonly SignInFactor[],
  home: string,
  now: number,
): ProjectSession {
  const createdAt = now - roll.random() * (ABSOLUTE_LIFETIME - 10 * DURATIONS.DAY);
  const lastActiveAt = Math.max(createdAt, now - roll.random() * (IDLE_WINDOW - DURATIONS.HOUR));
  return {
    ...base(roll, user, device, amr, home, createdAt),
    lastActiveAt: new Date(lastActiveAt).toISOString(),
    idleExpiresAt: new Date(lastActiveAt + IDLE_WINDOW).toISOString(),
    absoluteExpiresAt: new Date(createdAt + ABSOLUTE_LIFETIME).toISOString(),
  };
}

/**
 * A session that is over, in each of the three ways one can be: somebody ended it, it
 * went quiet for longer than the idle window, or it reached the lifetime cap while still
 * in use. The third is the case a screen forgets to draw, and it is the one that looks
 * like a bug to whoever it happens to.
 */
function endedSession(
  roll: Dice,
  user: ProjectUser,
  device: Device,
  amr: readonly SignInFactor[],
  home: string,
  now: number,
): ProjectSession {
  const kind = roll.random();
  const createdAt = now - (ABSOLUTE_LIFETIME + roll.random() * 200 * DURATIONS.DAY);
  const absoluteExpiresAt = createdAt + ABSOLUTE_LIFETIME;

  if (kind < 0.45) {
    // Revoked partway through, so both expiries are still ahead of the revocation.
    const revokedAt = createdAt + roll.random() * (ABSOLUTE_LIFETIME / 2);
    const lastActiveAt = revokedAt - roll.random() * DURATIONS.DAY;
    return {
      ...base(roll, user, device, amr, home, createdAt),
      lastActiveAt: new Date(lastActiveAt).toISOString(),
      idleExpiresAt: new Date(lastActiveAt + IDLE_WINDOW).toISOString(),
      absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
      revokedAt: new Date(revokedAt).toISOString(),
      revokeReason: roll.pick(END_REASONS),
    };
  }

  if (kind < 0.8) {
    // Went quiet: the idle window closes first, and nothing has written the row.
    const lastActiveAt = createdAt + roll.random() * (ABSOLUTE_LIFETIME - 2 * IDLE_WINDOW);
    return {
      ...base(roll, user, device, amr, home, createdAt),
      lastActiveAt: new Date(lastActiveAt).toISOString(),
      idleExpiresAt: new Date(lastActiveAt + IDLE_WINDOW).toISOString(),
      absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
    };
  }

  // In use to the end: the lifetime cap lands before the idle window ever would.
  const lastActiveAt = absoluteExpiresAt - roll.random() * DURATIONS.DAY;
  return {
    ...base(roll, user, device, amr, home, createdAt),
    lastActiveAt: new Date(lastActiveAt).toISOString(),
    idleExpiresAt: new Date(lastActiveAt + IDLE_WINDOW).toISOString(),
    absoluteExpiresAt: new Date(absoluteExpiresAt).toISOString(),
  };
}

/** Mostly v4, occasionally v6, which is what a column of addresses actually looks like. */
function ipFor(roll: Dice): string | null {
  if (roll.chance(0.03)) return null;
  if (roll.chance(0.12)) {
    const groups = Array.from({ length: 4 }, () =>
      roll.int(0, 65535).toString(16).padStart(4, "0"),
    );
    return `2a02:${groups.join(":")}`;
  }
  return `${roll.int(2, 223)}.${roll.int(0, 255)}.${roll.int(0, 255)}.${roll.int(1, 254)}`;
}
