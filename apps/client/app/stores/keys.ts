/**
 * Each project's API keys, and the two things that can be done to them.
 *
 * The store never holds a plaintext key. `create` returns one and forgets it in the same
 * breath, exactly as the server does: the row it writes carries a digest, and the value
 * exists only in the reply. Keeping it here so the screen could show it twice would rebuild,
 * in a Pinia store, the retrievable-key design the schema went out of its way to avoid.
 *
 * The rows themselves are a placeholder until the management API answers, seeded off the
 * project id so a key holds still between visits and two projects differ. Keys made and
 * revoked this session are kept beside the derivation rather than folded into it, so an
 * action survives a project switch and back.
 */

import {
  type ApiKeyKind,
  isLive,
  KEY_FORMAT,
  KEY_KIND_PREFIXES,
  type ProjectApiKey,
} from "~/utils/keys";
import { DURATIONS } from "~/utils/time";

export interface KeyStats {
  /** Keys that would resolve a request right now. */
  live: number;
  /** Live keys nothing has ever called. */
  unused: number;
  /** Calls that presented a key, over the window. */
  calls: number;
  callsDaily: number[];
  /** Calls refused because the key was unknown or revoked (`invalid_api_key`). */
  refused: number;
  refusedDaily: number[];
}

const WORK_LATENCY = 700;
const WINDOW_DAYS = 30;

export const useKeysStore = defineStore("keys", () => {
  /** Rows the operator made this session, by project. They carry no plaintext either. */
  const made = ref<Record<string, ProjectApiKey[]>>({});
  /** Ids revoked this session, and when, by project. */
  const revoked = ref<Record<string, Record<string, string>>>({});

  const loading = ref(true);

  /* One tick, so the list arrives the way it will when a request is behind it. */
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 400));
  void ready.then(() => {
    loading.value = false;
  });

  /** Every key on the project, newest first. */
  function keysFor(projectId: string): ProjectApiKey[] {
    const extra = made.value[projectId] ?? [];
    const gone = revoked.value[projectId] ?? {};
    return [...placeholderKeys(projectId), ...extra]
      .map((key) => {
        const at = gone[key.id];
        return at === undefined ? key : { ...key, revokedAt: at };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Issues a key and hands back the only copy of it.
   *
   * The value is returned rather than stored, which is the whole shape of this call: the
   * server keeps `sha256(key)` under a unique index, so there is nothing to read back and
   * nothing here worth keeping either.
   */
  async function create(
    projectId: string,
    kind: ApiKeyKind,
  ): Promise<{ key: ProjectApiKey; secret: string }> {
    await new Promise((resolve) => setTimeout(resolve, WORK_LATENCY));
    const secret = `${KEY_KIND_PREFIXES[kind]}${randomBody()}`;
    const key: ProjectApiKey = {
      id: `key_${randomBody().slice(0, 16)}`,
      kind,
      prefix: secret.slice(0, KEY_FORMAT.prefixLength),
      scopes: [],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    };
    made.value = { ...made.value, [projectId]: [...(made.value[projectId] ?? []), key] };
    return { key, secret };
  }

  /**
   * Takes a key out of service. Immediate and total: the resolution function filters on
   * `revoked_at` with no cache in front of it, so the next request carrying this key is
   * refused rather than the one after some expiry.
   */
  async function revoke(projectId: string, keyId: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, WORK_LATENCY));
    const held = revoked.value[projectId] ?? {};
    revoked.value = {
      ...revoked.value,
      [projectId]: { ...held, [keyId]: new Date().toISOString() },
    };
  }

  function stats(projectId: string): KeyStats {
    const keys = keysFor(projectId);
    const live = keys.filter(isLive);
    const seed = seedOf(projectId);
    const callsDaily = walk(seed + 11, WINDOW_DAYS, live.length === 0 ? 0 : 4200, 1400);
    const refusedDaily = sprinkle(seed + 13, live.length === 0 ? 0 : 9);
    return {
      live: live.length,
      unused: live.filter((key) => key.lastUsedAt === null).length,
      calls: sum(callsDaily),
      callsDaily,
      refused: sum(refusedDaily),
      refusedDaily,
    };
  }

  return { loading, keysFor, create, revoke, stats };
});

/*
 * Key material for the placeholder.
 */

const BODY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 32 bytes as base64url is 43 characters, which is what `generateOpaqueToken` returns and
 * therefore the width a real key has. Drawn one character per random byte rather than by
 * encoding, because the point is the shape rather than the bytes underneath it.
 */
const BODY_LENGTH = 43;

function randomBody(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  crypto.getRandomValues(bytes);
  let text = "";
  for (const byte of bytes) text += BODY_ALPHABET[byte % BODY_ALPHABET.length] ?? "A";
  return text;
}

/** The same shape, from a seed, so a placeholder key holds still between visits. */
function seededBody(random: () => number): string {
  let text = "";
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    text += BODY_ALPHABET[Math.floor(random() * BODY_ALPHABET.length)] ?? "A";
  }
  return text;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function walk(seed: number, days: number, base: number, swing: number): number[] {
  if (base === 0) return Array.from({ length: days }, () => 0);
  const random = seeded(seed);
  let level = base;
  return Array.from({ length: days }, () => {
    level += (random() - 0.5) * swing;
    level = Math.max(base * 0.3, Math.min(base * 1.8, level));
    return Math.round(level);
  });
}

/** A month's worth of a rare event, scattered over its days. */
function sprinkle(seed: number, total: number): number[] {
  const random = seeded(seed);
  const days = Array.from({ length: WINDOW_DAYS }, () => 0);
  for (let event = 0; event < total; event += 1) {
    const day = Math.floor(random() * days.length);
    days[day] = (days[day] ?? 0) + 1;
  }
  return days;
}

/**
 * A project's keys.
 *
 * Shaped like a project that has been running a while rather than one that was made this
 * morning: one publishable key in the bundle, a secret key the backend uses, an older secret
 * key that was rotated out and revoked, and on some projects a second live secret key,
 * because a half-finished rotation is the state this screen exists to make visible.
 */
function placeholderKeys(projectId: string): ProjectApiKey[] {
  const random = seeded(seedOf(projectId));
  const now = Date.now();

  const at = (daysAgo: number) => new Date(now - daysAgo * DURATIONS.DAY).toISOString();
  const build = (
    kind: ApiKeyKind,
    createdDaysAgo: number,
    lastUsed: string | null,
    revokedAt: string | null = null,
  ): ProjectApiKey => {
    const body = seededBody(random);
    return {
      id: `key_${body.slice(0, 16)}`,
      kind,
      prefix: `${KEY_KIND_PREFIXES[kind]}${body}`.slice(0, KEY_FORMAT.prefixLength),
      scopes: [],
      createdAt: at(createdDaysAgo),
      lastUsedAt: lastUsed,
      revokedAt,
    };
  };

  const keys: ProjectApiKey[] = [
    build("publishable", 402, new Date(now - 3 * DURATIONS.MINUTE).toISOString()),
    /* Last used when it was taken away, which is what a finished rotation leaves behind. */
    build("secret", 402, at(96), at(96)),
    build("secret", 97, new Date(now - 2 * DURATIONS.MINUTE).toISOString()),
  ];

  /* Half-finished rotations are common and invisible, so some projects are shown in one. */
  if (random() < 0.6) {
    keys.push(build("secret", 2, null));
  }

  return keys;
}
