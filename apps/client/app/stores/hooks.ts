/**
 * Each project's hooks: where we would call, how long we would wait, what the last check found,
 * and the secret that signs the calls.
 *
 * Placeholder until the management API answers, seeded off the project id like the other
 * stores, so a hook holds still between visits and two projects differ. Nothing calls a hook
 * (`HOOK_CALLS`), so a check runs its local half only, enabling is refused, and there are no
 * figures. The fixtures that would read as live enforcement stay behind that flag, because a
 * gate that exists only in local state is the thing notes/hooks.md P1 is about.
 */

import {
  type CallResult,
  checkHook,
  defaultHook,
  HOOK_CALLS,
  HOOK_FIGURE_DAYS,
  HOOK_ROTATION_OVERLAP_HOURS,
  HOOK_SECRET_PREFIX,
  HOOK_TYPES,
  type HookCheck,
  type HookConfig,
  type HookSecret,
  type HookStats,
  type HookType,
} from "~/utils/hooks";
import { DURATIONS } from "~/utils/time";

const SAVE_LATENCY = 600;
const CHECK_LATENCY = 900;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useHooksStore = defineStore("hooks", () => {
  const overrides = ref<Record<string, Partial<Record<HookType, HookConfig>>>>({});
  const secrets = ref<Record<string, HookSecret | null>>({});

  const loading = ref(true);
  setTimeout(() => {
    loading.value = false;
  }, 400);

  /** All five, always, in pipeline order. A hook nobody configured is a row that says so. */
  function hooksFor(projectId: string): HookConfig[] {
    const held = overrides.value[projectId] ?? {};
    const seeded = placeholderHooks(projectId);
    return HOOK_TYPES.map((type) => held[type] ?? seeded[type] ?? defaultHook(type));
  }

  function hookFor(projectId: string, type: HookType): HookConfig {
    return hooksFor(projectId).find((hook) => hook.type === type) ?? defaultHook(type);
  }

  function secretFor(projectId: string): HookSecret | null {
    return projectId in secrets.value
      ? (secrets.value[projectId] ?? null)
      : placeholderSecret(projectId);
  }

  function write(projectId: string, type: HookType, change: Partial<HookConfig>) {
    const held = overrides.value[projectId] ?? {};
    overrides.value = {
      ...overrides.value,
      [projectId]: { ...held, [type]: { ...hookFor(projectId, type), ...change } },
    };
  }

  /**
   * Saves where we call, and never enables. The first endpoint on a project makes its hook
   * secret, returned here once and never again. A check handed in is the one the new URL
   * passed, which is how an enabled hook changes endpoint without an untested one being called.
   */
  async function saveEndpoint(
    projectId: string,
    type: HookType,
    url: string,
    check?: HookCheck,
  ): Promise<{ secret: string | null }> {
    await wait(SAVE_LATENCY);
    write(projectId, type, check === undefined ? { url } : { url, check });
    if (secretFor(projectId) !== null) return { secret: null };
    secrets.value = {
      ...secrets.value,
      [projectId]: { createdAt: new Date().toISOString(), rotatedAt: null, previousUntil: null },
    };
    return { secret: makeSecret() };
  }

  async function setDeadline(projectId: string, type: HookType, deadlineMs: number) {
    await wait(SAVE_LATENCY);
    write(projectId, type, { deadlineMs });
  }

  /**
   * Checks the saved configuration, or a URL about to replace it; only the first is kept. The
   * call half is made only where something can make it, so today it is never run.
   */
  async function validate(projectId: string, type: HookType, url?: string): Promise<HookCheck> {
    await wait(CHECK_LATENCY);
    const hook = hookFor(projectId, type);
    const target = url ?? hook.url ?? "";
    const check = checkHook({
      type,
      url: target,
      deadlineMs: hook.deadlineMs,
      secret: secretFor(projectId),
      hooks: hooksFor(projectId),
      call: HOOK_CALLS.running ? placeholderCall(`${projectId}:${target}`, hook.deadlineMs) : null,
      at: new Date().toISOString(),
    });
    if (url === undefined) write(projectId, type, { check });
    return check;
  }

  /** Refused where nothing calls a hook: a switch nothing reads is a gate that is not there. */
  async function enable(projectId: string, type: HookType) {
    await wait(SAVE_LATENCY);
    if (!HOOK_CALLS.running) return;
    write(projectId, type, { enabled: true, enabledAt: new Date().toISOString() });
  }

  /** Out of the path, with the endpoint and the check kept for turning it back on. */
  async function disable(projectId: string, type: HookType) {
    await wait(SAVE_LATENCY);
    write(projectId, type, { enabled: false, enabledAt: null });
  }

  /** Out of the path, and the check goes with the endpoint it was run on. */
  async function removeEndpoint(projectId: string, type: HookType) {
    await wait(SAVE_LATENCY);
    write(projectId, type, { url: null, enabled: false, enabledAt: null, check: null });
  }

  /** A new secret, with the previous one signing beside it until the overlap ends. */
  async function rotateSecret(projectId: string): Promise<{ secret: string; until: string }> {
    await wait(SAVE_LATENCY);
    const now = new Date();
    const until = new Date(now.getTime() + HOOK_ROTATION_OVERLAP_HOURS * DURATIONS.HOUR);
    secrets.value = {
      ...secrets.value,
      [projectId]: {
        createdAt: secretFor(projectId)?.createdAt ?? now.toISOString(),
        rotatedAt: now.toISOString(),
        previousUntil: until.toISOString(),
      },
    };
    return { secret: makeSecret(), until: until.toISOString() };
  }

  /** A week of one hook's calls. Null unless it is called at all, which it never is today. */
  function statsFor(projectId: string, type: HookType): HookStats | null {
    if (!HOOK_CALLS.running) return null;
    const hook = hookFor(projectId, type);
    if (!hook.enabled || hook.url === null) return null;
    return placeholderStats(`${projectId}:${type}`);
  }

  return {
    loading,
    hooksFor,
    hookFor,
    secretFor,
    saveEndpoint,
    setDeadline,
    validate,
    enable,
    disable,
    removeEndpoint,
    rotateSecret,
    statsFor,
  };
});

/*
 * The placeholder.
 */

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

function walk(seed: number, base: number, swing: number): number[] {
  const random = seeded(seed);
  let level = base;
  return Array.from({ length: HOOK_FIGURE_DAYS }, () => {
    level += (random() - 0.5) * swing;
    level = Math.max(base * 0.3, Math.min(base * 1.8, level));
    return Math.round(level);
  });
}

/** A week's failures landing on one bad day rather than spread evenly. */
function burst(seed: number, count: number): number[] {
  const random = seeded(seed);
  const days = Array.from({ length: HOOK_FIGURE_DAYS }, () => 0);
  if (count === 0) return days;
  const day = Math.floor(random() * days.length);
  days[day] = count;
  return days;
}

function placeholderStats(key: string): HookStats {
  const seed = seedOf(key);
  const random = seeded(seed);
  const calls = walk(seed, 400 + Math.floor(random() * 2600), 900);
  const failed = burst(seed + 3, random() < 0.4 ? 0 : Math.floor(sum(calls) * 0.004));
  const p50 = 40 + Math.floor(random() * 120);
  return {
    calls,
    refused: calls.map((count) => Math.floor(count * random() * 0.03)),
    failed,
    timedOut: failed.map((count) => Math.floor(count * 0.6)),
    p50,
    /* A tail an order of magnitude out from the median is the normal shape of a call to
       somebody else's service, and the reason a deadline is set above it. */
    p99: p50 * (4 + Math.floor(random() * 8)),
  };
}

/** What the call half would find, where one can be made: an answer inside the deadline. */
function placeholderCall(key: string, deadlineMs: number): CallResult {
  const random = seeded(seedOf(key));
  return {
    status: 200,
    ms: Math.min(deadlineMs, 60 + Math.floor(random() * 240)),
    bodyOk: true,
    wrongSignatureStatus: 401,
  };
}

/** Day-aligned, so a fixture's dates hold still between reads. */
function daysAgo(days: number): string {
  const today = Math.floor(Date.now() / DURATIONS.DAY) * DURATIONS.DAY;
  return new Date(today - days * DURATIONS.DAY).toISOString();
}

/**
 * One configured hook. Enabled, with the check it passed, only where hooks are called at all:
 * on a deployment that calls none, a fixture reading as enforced is the P1 finding.
 */
function fixture(type: HookType, url: string, deadlineMs: number, enabled: boolean): HookConfig {
  const on = enabled && HOOK_CALLS.running;
  const at = daysAgo(40);
  return {
    type,
    url,
    deadlineMs,
    enabled: on,
    enabledAt: on ? at : null,
    check: on
      ? checkHook({
          type,
          url,
          deadlineMs,
          secret: { createdAt: daysAgo(41), rotatedAt: null, previousUntil: null },
          hooks: [],
          call: placeholderCall(url, deadlineMs),
          at,
        })
      : null,
  };
}

/**
 * What a project has set up. Most run none of these; the ones that do start with
 * before-sign-in, and customize-claims is usually set up and then left off once somebody
 * finds claim templates.
 */
function placeholderHooks(projectId: string): Partial<Record<HookType, HookConfig>> {
  const random = seeded(seedOf(projectId));
  const host = `https://api.${projectId === "prj_acme" ? "acme" : "example"}.com/idenzy/hooks`;
  const hooks: Partial<Record<HookType, HookConfig>> = {};
  if (random() < 0.75) hooks.before_sign_in = fixture("before_sign_in", host, 1500, true);
  if (random() < 0.5) hooks.customize_claims = fixture("customize_claims", host, 2000, false);
  if (random() < 0.3) hooks.send_email = fixture("send_email", `${host}/email`, 3000, true);
  return hooks;
}

/** A project with an endpoint has a secret, made with its first one. */
function placeholderSecret(projectId: string): HookSecret | null {
  const configured = Object.values(placeholderHooks(projectId)).some(
    (hook) => hook !== undefined && hook.url !== null,
  );
  return configured ? { createdAt: daysAgo(41), rotatedAt: null, previousUntil: null } : null;
}

function makeSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${HOOK_SECRET_PREFIX}${hex}`;
}
