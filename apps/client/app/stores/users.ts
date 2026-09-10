/**
 * The users of every project the panel can show, and the four things the users screen
 * does to them.
 *
 * A store rather than state inside the page, because the dialogs, the row menu and the
 * selection bar all act on the same list and would otherwise each hold a copy, and
 * because this is where the management API client plugs in: each action below becomes
 * one call and the list becomes what the API answered. Until then the list is generated,
 * deterministically, so a screenshot taken today and one taken next week show the same
 * people, and the actions rewrite it in place the way the server would.
 *
 * Two of the actions carry a rule the server enforces and the screen has to say. A
 * suspension takes effect at the next token rotation, so an open session keeps working
 * for up to one access-token lifetime (refresh-service.ts). A deletion is an erasure
 * (PROJECT.md 4.13.6): the personal columns are cleared and the row survives as a
 * tombstone with a `deletedAt`, so the audit trail keeps its pseudonymous subject.
 */
import { DURATIONS } from "~/utils/time";
import { INDEFINITE, type ProjectUser, type SignInMethod } from "~/utils/users";

export interface AddUserInput {
  email: string | null;
  phone: string | null;
  displayName: string | null;
  /** Given, the account can sign in with it at once; absent, it signs in some other way. */
  password: string | null;
  emailVerified: boolean;
}

/** How long the placeholder takes to "arrive". A real fetch is about this. */
const PLACEHOLDER_LATENCY = 700;

/** What a write costs, so a form's pending state is something a person can see. */
const WRITE_LATENCY = 420;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, WRITE_LATENCY));
}

export const useUsersStore = defineStore("users", () => {
  const users = ref<ProjectUser[]>([]);

  /* True until the list has been answered, so the screen draws bones and not "no
     users". The placeholder arrives the way the API will: after a moment, all at once,
     which is what makes the loading state something that can be seen rather than
     something that happens to be true for a frame. */
  const loading = ref(true);
  setTimeout(() => {
    users.value = placeholderUsers();
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): ProjectUser[] {
    return users.value.filter((user) => user.projectId === projectId);
  }

  /**
   * Creates the account and answers with it. Asynchronous because the form it belongs to
   * closes on a settled call and not on a click: a dialog that closes on the click has
   * reported a success nothing confirmed (notes/dialogs.md).
   */
  async function add(projectId: string, input: AddUserInput): Promise<ProjectUser> {
    await settle();
    const now = stamp();
    const methods: SignInMethod[] = input.password ? ["password"] : [];
    if (!input.password && input.email) methods.push("email_otp");
    if (!input.password && !input.email && input.phone) methods.push("sms_otp");
    const user: ProjectUser = {
      id: `usr_${idFrom(Math.random)}`,
      projectId,
      email: input.email,
      emailVerified: input.email !== null && input.emailVerified,
      phone: input.phone,
      phoneVerified: false,
      displayName: input.displayName,
      avatarUrl: null,
      methods,
      mfaEnabled: false,
      activeSessions: 0,
      bannedUntil: null,
      lastSignInAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      metadataPublic: {},
    };
    users.value = [user, ...users.value];
    return user;
  }

  /** Every listed account that is not a tombstone gets the same end date. */
  function suspend(ids: readonly string[], until: string): number {
    return rewrite(ids, (user) =>
      user.deletedAt === null ? { ...user, bannedUntil: until, updatedAt: stamp() } : user,
    );
  }

  function restore(ids: readonly string[]): number {
    return rewrite(ids, (user) =>
      user.bannedUntil !== null ? { ...user, bannedUntil: null, updatedAt: stamp() } : user,
    );
  }

  function signOutEverywhere(ids: readonly string[]): number {
    return rewrite(ids, (user) =>
      user.activeSessions > 0 ? { ...user, activeSessions: 0, updatedAt: stamp() } : user,
    );
  }

  /**
   * What the sessions screen writes back after ending one of a user's devices, so the
   * count here stays what it says it is: the sessions still live. No `updatedAt`, because
   * this is a joined figure and not a column, and nothing about the account changed.
   */
  function setActiveSessions(id: string, count: number): void {
    rewrite([id], (user) =>
      user.activeSessions === count ? user : { ...user, activeSessions: count },
    );
  }

  /** The erasure: personal columns cleared, the row kept, sessions gone with it. */
  function remove(ids: readonly string[]): number {
    return rewrite(ids, (user) => (user.deletedAt === null ? erase(user, stamp()) : user));
  }

  /** Applies `change` to the named rows and reports how many it actually altered. */
  function rewrite(ids: readonly string[], change: (user: ProjectUser) => ProjectUser): number {
    const wanted = new Set(ids);
    let changed = 0;
    users.value = users.value.map((user) => {
      if (!wanted.has(user.id)) return user;
      const next = change(user);
      if (next !== user) changed += 1;
      return next;
    });
    return changed;
  }

  return {
    users,
    loading,
    forProject,
    add,
    suspend,
    restore,
    signOutEverywhere,
    setActiveSessions,
    remove,
  };
});

/**
 * What erasure leaves of a user: the id, the project, the timestamps, and nothing that
 * names a person. Shared by the action and the fixture so a generated tombstone is the
 * same shape as one the action makes.
 */
function erase(user: ProjectUser, at: string): ProjectUser {
  return {
    ...user,
    email: null,
    emailVerified: false,
    phone: null,
    phoneVerified: false,
    displayName: null,
    avatarUrl: null,
    methods: [],
    mfaEnabled: false,
    activeSessions: 0,
    bannedUntil: null,
    metadataPublic: {},
    updatedAt: at,
    deletedAt: at,
  };
}

function stamp(): string {
  return new Date().toISOString();
}

/** Crockford's base 32, which is what the public ids look like. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function idFrom(random: () => number, length = 24): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/*
 * Placeholder people. A seeded generator rather than a literal list, because a list long
 * enough to need paging, filtering and sorting is too long to read as code, and the
 * same seed gives the same list on every load, which is what makes a screenshot
 * comparable to the last one. Dates are offsets from the moment the store is built, so
 * "3d ago" stays true. Replaced wholesale by the management API.
 */

const FIRST = [
  "Nuray",
  "James",
  "Sophia",
  "Emma",
  "Matthew",
  "Arthur",
  "Elif",
  "Lucas",
  "Amara",
  "Noah",
  "Yuki",
  "Mateo",
  "Zara",
  "Leon",
  "Priya",
  "Oscar",
  "Ines",
  "Kenji",
  "Farah",
  "Hugo",
  "Mei",
  "Jonas",
  "Layla",
  "Felix",
  "Aisha",
  "Ravi",
  "Clara",
  "Tomas",
  "Sena",
  "Ivan",
];
const LAST = [
  "Aksoy",
  "Brown",
  "Williams",
  "Wright",
  "Johnson",
  "Taylor",
  "Kaya",
  "Silva",
  "Okafor",
  "Schmidt",
  "Tanaka",
  "Garcia",
  "Hussain",
  "Novak",
  "Sharma",
  "Lindqvist",
  "Moreau",
  "Sato",
  "Haddad",
  "Bernard",
  "Chen",
  "Weber",
  "Rahman",
  "Keller",
  "Diallo",
  "Iyer",
  "Rossi",
  "Horvat",
  "Demir",
  "Petrov",
];
const DOMAINS = ["example.com", "mail.example", "acme.test", "example.org", "corp.example"];
const COUNTRY_CODES = ["1", "44", "49", "90", "81"];
const PROVIDERS: readonly SignInMethod[] = ["google", "apple", "microsoft", "github"];
const PLANS = ["free", "pro", "team"];

interface Dice {
  random: () => number;
  chance: (probability: number) => boolean;
  pick: <T>(list: readonly T[]) => T;
}

/** mulberry32: small, fast and good enough for a fixture. */
function dice(seed: number): Dice {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    chance: (probability) => random() < probability,
    // A list here is never empty, so the index is always in range.
    pick: (list) => list[Math.floor(random() * list.length)] as (typeof list)[number],
  };
}

function placeholderUsers(): ProjectUser[] {
  return [...generate("prj_personal", 138, 7), ...generate("prj_acme", 41, 11)];
}

function generate(projectId: string, count: number, seed: number): ProjectUser[] {
  const roll = dice(seed);
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const person = personFor(roll, index);
    const dates = datesFor(roll, now);
    const user: ProjectUser = {
      id: `usr_${idFrom(roll.random)}`,
      projectId,
      ...person,
      avatarUrl: null,
      methods: methodsFor(roll, person.email !== null, person.phone !== null),
      mfaEnabled: roll.chance(0.24),
      activeSessions: dates.lastSignInAt === null ? 0 : Math.floor(roll.random() * 4),
      bannedUntil: banFor(roll, now),
      ...dates,
      deletedAt: null,
      metadataPublic: roll.chance(0.4) ? { plan: roll.pick(PLANS) } : {},
    };
    if (!roll.chance(0.06)) return user;
    const ageMs = now - new Date(user.createdAt).getTime();
    const deletedAt = new Date(now - roll.random() * Math.min(ageMs, 90 * DURATIONS.DAY));
    return erase(user, deletedAt.toISOString());
  });
}

function personFor(roll: Dice, index: number) {
  const first = roll.pick(FIRST);
  const last = roll.pick(LAST);
  const hasEmail = roll.chance(0.94);
  const hasPhone = !hasEmail || roll.chance(0.28);
  const email = hasEmail
    ? `${first}.${last}${index % 7 === 0 ? index : ""}@${roll.pick(DOMAINS)}`.toLowerCase()
    : null;
  const phone = hasPhone ? `+${roll.pick(COUNTRY_CODES)}${digits(roll, 9)}` : null;
  return {
    email,
    emailVerified: hasEmail && roll.chance(0.86),
    phone,
    phoneVerified: hasPhone && roll.chance(0.7),
    displayName: roll.chance(0.82) ? `${first} ${last}` : null,
  };
}

function methodsFor(roll: Dice, hasEmail: boolean, hasPhone: boolean): SignInMethod[] {
  const methods: SignInMethod[] = [];
  if (roll.chance(0.55)) methods.push("password");
  if (roll.chance(0.3)) methods.push("passkey");
  if (hasEmail && roll.chance(0.35)) methods.push("email_otp");
  if (hasPhone && roll.chance(0.5)) methods.push("sms_otp");
  if (roll.chance(0.45)) methods.push(roll.pick(PROVIDERS));
  if (methods.length === 0) methods.push(hasEmail ? "email_otp" : "sms_otp");
  return [...new Set(methods)];
}

function datesFor(roll: Dice, now: number) {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const createdMs = roll.random() * 400 * DURATIONS.DAY + DURATIONS.HOUR;
  const signedIn = roll.chance(0.84);
  const lastSignInMs = signedIn ? roll.random() * Math.min(createdMs, 60 * DURATIONS.DAY) : null;
  return {
    createdAt: ago(createdMs),
    updatedAt: ago(lastSignInMs ?? roll.random() * createdMs),
    lastSignInAt: lastSignInMs === null ? null : ago(lastSignInMs),
  };
}

/** Most accounts are not banned; of those that are, a few for good, most for a while,
    and some whose ban has already lapsed, so the screen shows every case. */
function banFor(roll: Dice, now: number): string | null {
  if (!roll.chance(0.07)) return null;
  const kind = roll.random();
  if (kind < 0.3) return INDEFINITE;
  const span = roll.random() * 30 * DURATIONS.DAY;
  return new Date(kind < 0.85 ? now + span : now - span / 3).toISOString();
}

function digits(roll: Dice, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += Math.floor(roll.random() * 10);
  return out;
}
