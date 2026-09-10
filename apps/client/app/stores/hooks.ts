/**
 * Each project's hook endpoints and how the calls to them have been going.
 *
 * Placeholder until the management API answers, seeded off the project id like the other
 * stores, so a hook holds still between visits and two projects differ. Shaped like a real
 * estate: almost nobody has all five, most have none, and the one people reach for first is
 * `before-sign-in`, because it is the only place a customer's own idea of "this account may
 * not sign in today" can be applied to somebody else's sign-in.
 *
 * The figures are per hook rather than per project. A hook's health is its own: the whole
 * point of a deadline is that one slow endpoint does not become an argument about the
 * platform, and a page that only totalled them would hide which one to fix.
 */

import { defaultHook, HOOK_TYPES, type HookConfig, type HookType, isHookLive } from "~/utils/hooks";
import { DURATIONS } from "~/utils/time";

export interface HookStats {
  /** Calls made over the window. */
  calls: number;
  callsDaily: number[];
  /** Calls the hook refused: a 200 saying no. Working correctly, and worth watching. */
  refused: number;
  /** Calls that failed for any of the other three reasons, so the request failed. */
  failed: number;
  failedDaily: number[];
  /** Milliseconds, over the window. Null where nothing has been called. */
  p50: number | null;
  p99: number | null;
}

const SAVE_LATENCY = 600;
const WINDOW_DAYS = 30;

export const useHooksStore = defineStore("hooks", () => {
  const overrides = ref<Record<string, Partial<Record<HookType, HookConfig>>>>({});
  const lastSaved = ref<Record<string, string>>({});

  const loading = ref(true);
  const ready = new Promise<void>((resolve) => setTimeout(resolve, 400));
  void ready.then(() => {
    loading.value = false;
  });

  /** All five, always, in pipeline order. A hook nobody configured is a row that says so. */
  function hooksFor(projectId: string): HookConfig[] {
    const held = overrides.value[projectId] ?? {};
    const seeded = placeholderHooks(projectId);
    return HOOK_TYPES.map((type) => held[type] ?? seeded[type] ?? defaultHook(type));
  }

  function hookFor(projectId: string, type: HookType): HookConfig {
    return hooksFor(projectId).find((hook) => hook.type === type) ?? defaultHook(type);
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  /** Writes the fields given and leaves the rest; resolves once the server has them. */
  async function patch(
    projectId: string,
    type: HookType,
    change: Partial<HookConfig>,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const held = overrides.value[projectId] ?? {};
    overrides.value = {
      ...overrides.value,
      [projectId]: { ...held, [type]: { ...hookFor(projectId, type), ...change } },
    };
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  /**
   * How one hook has been going.
   *
   * A hook that is not live has no figures rather than zeroes: zero calls and "never
   * called" read the same on a tile, and only one of them is true of a switch nobody has
   * turned on.
   */
  function statsFor(projectId: string, type: HookType): HookStats | null {
    const hook = hookFor(projectId, type);
    if (!isHookLive(hook)) return null;

    const seed = seedOf(`${projectId}:${type}`);
    const random = seeded(seed);
    const callsDaily = walk(seed, WINDOW_DAYS, 400 + Math.floor(random() * 2600), 900);
    const calls = sum(callsDaily);
    /* Failures are rare and bursty: an endpoint is fine, then it is not, for an hour. */
    const failedDaily = burst(seed + 3, random() < 0.4 ? 0 : Math.floor(calls * 0.004));
    const p50 = 40 + Math.floor(random() * 120);
    return {
      calls,
      callsDaily,
      refused: Math.floor(calls * random() * 0.03),
      failed: sum(failedDaily),
      failedDaily,
      p50,
      /* A tail an order of magnitude out from the median is the normal shape of an HTTP
         call to somebody else's service, and the reason a deadline is set above it. */
      p99: p50 * (4 + Math.floor(random() * 8)),
    };
  }

  return { loading, hooksFor, hookFor, patch, lastSavedAt, statsFor };
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

function walk(seed: number, days: number, base: number, swing: number): number[] {
  const random = seeded(seed);
  let level = base;
  return Array.from({ length: days }, () => {
    level += (random() - 0.5) * swing;
    level = Math.max(base * 0.3, Math.min(base * 1.8, level));
    return Math.round(level);
  });
}

/** A month's worth of failures landing on one or two bad days rather than spread evenly. */
function burst(seed: number, total: number): number[] {
  const random = seeded(seed);
  const days = Array.from({ length: WINDOW_DAYS }, () => 0);
  if (total === 0) return days;
  const day = Math.floor(random() * days.length);
  days[day] = Math.round(total * 0.8);
  const other = Math.floor(random() * days.length);
  days[other] = (days[other] ?? 0) + (total - Math.round(total * 0.8));
  return days;
}

/**
 * What a project has set up.
 *
 * Weighted the way a real estate is. Most projects run none of these, because the platform
 * is meant to be enough on its own; the ones that do almost always start with
 * `before-sign-in`, and `customize-claims` is usually a switch somebody turned off again
 * once they found claim templates.
 */
function placeholderHooks(projectId: string): Partial<Record<HookType, HookConfig>> {
  const random = seeded(seedOf(projectId));
  const host = `https://api.${projectId === "prj_acme" ? "acme" : "example"}.com/idenzy/hooks`;
  const hooks: Partial<Record<HookType, HookConfig>> = {};

  if (random() < 0.75) {
    hooks.before_sign_in = {
      type: "before_sign_in",
      url: host,
      enabled: true,
      deadlineMs: 1500,
      lastCalledAt: new Date(
        Date.now() - Math.floor(random() * 4) * DURATIONS.MINUTE,
      ).toISOString(),
    };
  }

  /* Set up, then switched off: the shape of somebody who found claim templates after. */
  if (random() < 0.5) {
    hooks.customize_claims = {
      type: "customize_claims",
      url: host,
      enabled: false,
      deadlineMs: 2000,
      lastCalledAt: new Date(Date.now() - 26 * DURATIONS.DAY).toISOString(),
    };
  }

  if (random() < 0.3) {
    hooks.send_email = {
      type: "send_email",
      url: `${host}/email`,
      enabled: true,
      deadlineMs: 3000,
      lastCalledAt: new Date(Date.now() - 18 * DURATIONS.MINUTE).toISOString(),
    };
  }

  return hooks;
}
