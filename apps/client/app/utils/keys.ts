/**
 * API keys as the server issues and checks them (`api_keys`, PROJECT.md 12), and the small
 * amount of arithmetic the screen does over them.
 *
 * Three properties of that table decide almost everything this file and its screen do.
 *
 * What is stored is a SHA-256 digest under a unique index, not ciphertext. There is no
 * decrypt path to add, so a key is shown exactly once, at the moment it is made, and the
 * panel could not offer to show it a second time whoever asked. That is the trade the
 * industry states out loud and this schema has already settled: a dashboard that can
 * re-reveal a key is friendlier, and it makes a far more attractive database.
 *
 * `prefix` is stored beside the digest, first characters only, so a key can be named in a
 * log without being usable. It is therefore the only handle a key has here. The table
 * carries no name column, so a key is told apart by its prefix, its kind and its dates, and
 * matching a row against your own `.env` means matching the prefix.
 *
 * `revoked_at` is read on the request path: `resolve_project_by_key_hash` filters on it with
 * no cache in front, so a revocation is immediate and total. That is what makes rotation a
 * procedure and not a button. There is no grace window to grant, so the overlap has to be
 * two live keys at once, and `last_used_at` is the only thing that says when the old one has
 * gone quiet enough to take away.
 *
 * The kinds are written out rather than imported from `@idenzy/protocol`, for the reason
 * `sessions.ts` writes out `AuthMethod`: the panel takes no dependency on that package until
 * the management API client does, and then both come from the one place.
 */

import { DURATIONS } from "./time";

/*
 * The two kinds.
 */

export type ApiKeyKind = "publishable" | "secret";

/** Publishable first, because it is the one a project needs before anything works. */
export const API_KEY_KINDS: readonly ApiKeyKind[] = ["publishable", "secret"];

export const KEY_KIND_LABELS: Record<ApiKeyKind, string> = {
  publishable: "Publishable key",
  secret: "Secret key",
};

/** Written out in full so @nuxt/icon bundles them. */
export const KEY_KIND_ICONS: Record<ApiKeyKind, string> = {
  publishable: "material-symbols:public",
  secret: "material-symbols:lock-outline",
};

/**
 * The prefix each kind is issued under. Part of the wire contract in
 * `@idenzy/protocol/schemas/common`, so changing one is a breaking change for every
 * customer matching on it.
 */
export const KEY_KIND_PREFIXES: Record<ApiKeyKind, string> = {
  publishable: "pk_",
  secret: "sk_",
};

/** Where the key belongs, in one line. The row's whole reason for existing. */
export const KEY_KIND_NOTES: Record<ApiKeyKind, string> = {
  publishable:
    "Meant to sit in a browser bundle. It names your project and nothing more: it cannot read a user, change a setting or mint a token, so shipping it is the point rather than a risk.",
  secret:
    "Meant never to leave a server. It acts as the project on the management API, so anything your backend can do it can do. A secret key in a client bundle is published at the next build, and nothing after that unpublishes it.",
};

/** How a key of each kind reaches us, for the row that says so. */
export const KEY_KIND_CARRIERS: Record<ApiKeyKind, string> = {
  publishable: "x-idenzy-publishable-key",
  secret: "Authorization: Bearer",
};

/*
 * How a key is made and kept.
 */

export const KEY_FORMAT = {
  /** `generateOpaqueToken` in `@idenzy/crypto/tokens/random`, from node's CSPRNG. */
  bytes: 32,
  bits: 256,
  encoding: "base64url",
  digest: "SHA-256",
  /**
   * Characters of the key kept in the clear, prefix included. Enough to pick a row out of a
   * log or an `.env`, far too few to be worth guessing the rest of.
   */
  prefixLength: 11,
} as const;

/** The environment variables the CLI writes, and the one it will not. */
export const ENV_NAMES = {
  /** Under whatever prefix the framework exposes to a browser: `VITE_`, `NEXT_PUBLIC_`. */
  publishable: "IDENZY_PUBLISHABLE_KEY",
  apiUrl: "IDENZY_API_URL",
  /** Server runtime config only. There is deliberately no public spelling of this one. */
  secret: "IDENZY_SECRET_KEY",
} as const;

/*
 * A key as the panel sees it.
 */

export interface ProjectApiKey {
  /** The row's own id, which is what an audit entry names as the actor. */
  id: string;
  kind: ApiKeyKind;
  /** First `KEY_FORMAT.prefixLength` characters, kind prefix included. */
  prefix: string;
  /** Nothing reads these yet, and the screen says so rather than offering them. */
  scopes: readonly string[];
  createdAt: string;
  /** Null until something calls with it. The field a rotation is finished by. */
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * The three states a key is in.
 *
 * `unused` is not a lesser `in_use`: a live key nothing has called is either a rotation
 * somebody started and did not finish, or a key that was made, pasted somewhere unknown and
 * forgotten. Both are worth seeing, and neither shows up if the list only sorts by date.
 */
export type KeyState = "in_use" | "unused" | "revoked";

export const KEY_STATES: readonly KeyState[] = ["in_use", "unused", "revoked"];

export const KEY_STATE_LABELS: Record<KeyState, string> = {
  in_use: "In use",
  unused: "Never used",
  revoked: "Revoked",
};

export function keyStateOf(key: ProjectApiKey): KeyState {
  if (key.revokedAt !== null) return "revoked";
  return key.lastUsedAt === null ? "unused" : "in_use";
}

export function isLive(key: ProjectApiKey): boolean {
  return key.revokedAt === null;
}

/** For sorting the state column: what an operator wants grouped at the top. */
export const KEY_STATE_RANK: Record<KeyState, number> = { unused: 0, in_use: 1, revoked: 2 };

/*
 * Narrowing the list.
 */

export type KeyFilter = "live" | "revoked" | "all";

export const KEY_FILTERS: readonly KeyFilter[] = ["live", "revoked", "all"];

export function matchesKeyFilter(key: ProjectApiKey, filter: KeyFilter): boolean {
  if (filter === "all") return true;
  return filter === "live" ? isLive(key) : !isLive(key);
}

export interface KeyCounts {
  all: number;
  live: number;
  revoked: number;
  /** Live keys nothing has ever called. The one count worth a colour. */
  unused: number;
}

export function countKeys(keys: readonly ProjectApiKey[]): KeyCounts {
  const counts: KeyCounts = { all: keys.length, live: 0, revoked: 0, unused: 0 };
  for (const key of keys) {
    if (isLive(key)) {
      counts.live += 1;
      if (key.lastUsedAt === null) counts.unused += 1;
    } else {
      counts.revoked += 1;
    }
  }
  return counts;
}

/*
 * Rotating.
 */

/**
 * How long a live key must have been silent before taking it away is safe.
 *
 * A stated constant rather than a setting, because it is not a preference: it is how long a
 * deployment takes to finish rolling and how long a cached client holds an old value. A
 * project that wants longer waits longer, and the screen will keep saying the same thing.
 */
export const QUIET_HOURS = 24;

export interface Rotation {
  kind: ApiKeyKind;
  live: readonly ProjectApiKey[];
  /**
   * The live key traffic is arriving on: the most recently used, or the newest where none
   * has been used at all. What a customer would call "the current key".
   */
  current: ProjectApiKey | null;
  /** Every other live key of this kind. Taking these away is what ends the rotation. */
  previous: readonly ProjectApiKey[];
  /** Two or more live keys of one kind, which is a rotation that has not been finished. */
  rotating: boolean;
  /** Every `previous` key has been silent for `QUIET_HOURS`, so revoking breaks nothing. */
  quiet: boolean;
}

function usedAt(key: ProjectApiKey): number {
  return key.lastUsedAt === null ? 0 : new Date(key.lastUsedAt).getTime();
}

/** Whether a key has been silent long enough that revoking it should break nothing. */
export function isQuiet(key: ProjectApiKey, now: Date): boolean {
  if (key.lastUsedAt === null) return true;
  return now.getTime() - new Date(key.lastUsedAt).getTime() > QUIET_HOURS * DURATIONS.HOUR;
}

/**
 * Where each kind stands, which is the only question worth asking mid-rotation.
 *
 * `current` is decided by use and not by age, deliberately. The newest key is the one you
 * just made and have not deployed yet; the one traffic is actually arriving on is the one
 * you must not revoke. Sorting by `createdAt` would name the wrong key on exactly the day it
 * matters.
 */
export function rotationOf(keys: readonly ProjectApiKey[], kind: ApiKeyKind, now: Date): Rotation {
  const live = keys.filter((key) => key.kind === kind && isLive(key));
  const ranked = [...live].sort((a, b) => {
    const used = usedAt(b) - usedAt(a);
    return used !== 0 ? used : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const current = ranked[0] ?? null;
  const previous = ranked.slice(1);
  return {
    kind,
    live,
    current,
    previous,
    rotating: live.length > 1,
    quiet: previous.every((key) => isQuiet(key, now)),
  };
}

/*
 * How old the live keys are.
 */

export interface AgeBucket {
  id: string;
  label: string;
  /** Days since the key was made. Inclusive at `from`, exclusive at `to`. */
  from: number;
  to: number;
  /** A text colour class where the bucket is one to think about. */
  tone: string;
}

export const AGE_BUCKETS: readonly AgeBucket[] = [
  { id: "new", label: "Under a month", from: 0, to: 30, tone: "" },
  { id: "recent", label: "1 to 3 months", from: 30, to: 90, tone: "" },
  { id: "older", label: "3 to 12 months", from: 90, to: 365, tone: "" },
  {
    id: "ancient",
    label: "Over a year",
    from: 365,
    to: Number.POSITIVE_INFINITY,
    tone: "text-warning",
  },
];

export interface AgeTally extends AgeBucket {
  count: number;
  /** Of the live keys counted, rounded, for the bar. */
  share: number;
}

export function ageInDays(key: ProjectApiKey, now: Date): number {
  return Math.floor((now.getTime() - new Date(key.createdAt).getTime()) / DURATIONS.DAY);
}

export function tallyKeyAges(keys: readonly ProjectApiKey[], now: Date): AgeTally[] {
  const live = keys.filter(isLive);
  const counts = new Map<string, number>();
  for (const key of live) {
    const days = ageInDays(key, now);
    const bucket = AGE_BUCKETS.find((entry) => days >= entry.from && days < entry.to);
    if (bucket) counts.set(bucket.id, (counts.get(bucket.id) ?? 0) + 1);
  }
  const total = live.length;
  return AGE_BUCKETS.map((bucket) => {
    const count = counts.get(bucket.id) ?? 0;
    return { ...bucket, count, share: total === 0 ? 0 : Math.round((count / total) * 100) };
  });
}

/*
 * Writing one down.
 */

/** The dots that stand for the part of a key nobody will see again. */
export const KEY_MASK = "•".repeat(10);

/** What the panel can show of a key it does not hold: the prefix, then the mask. */
export function maskedKey(key: ProjectApiKey): string {
  return `${key.prefix}${KEY_MASK}`;
}

/**
 * What is true of scopes today, in one place.
 *
 * The column exists, the resolver returns it and nothing reads it: `SecretKeyGuard` checks
 * only that the caller is a key at all. Offering a scope picker would put a control on the
 * screen that describes a restriction nobody enforces, which is the same mistake
 * `UnconfiguredAttestation` refuses to make on the SMS screen. So the screen says "full
 * access" and says why, and the picker arrives with the guard that reads it.
 */
export const SCOPES = {
  label: "Full access",
  note: "Every secret key can do everything the management API offers. The column that would narrow it exists on the row and no guard reads it yet, so a picker here would describe a restriction nothing applies.",
} as const;
