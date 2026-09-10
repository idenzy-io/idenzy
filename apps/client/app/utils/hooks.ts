/**
 * Synchronous customer hooks: the calls we make into a customer's own service while a
 * request of theirs is waiting on the answer (PROJECT.md 3.2, 9.6).
 *
 * The whole file turns on the difference between this and a webhook, and the difference is
 * the request path. A webhook is told after the fact, retried on a schedule, delivered at
 * least once, and nothing waits for it: a receiver that is down costs a customer some
 * notifications and costs their users nothing. A hook is called *during* the request, the
 * sign-in is blocked on the reply, and there is a hard deadline after which the request
 * fails. So a webhook can never break a sign-in, and a hook is the only thing that can
 * change one. Everything a customer gains and everything they risk comes out of that one
 * sentence, which is why the screen leads with it rather than filing it under a guide.
 *
 * Hooks are **fail-closed with a hard deadline** and that is not configurable. A gate that
 * could be got past by being slow never gated anything: an attacker who can make a
 * customer's endpoint time out would otherwise turn `before-sign-in` off from the outside.
 * The same reasoning `checkStrictly` uses on the SMS path, where allowing what we could not
 * count turns an outage into an unmetered send window.
 *
 * It reads the same way for the two delivery hooks, and that surprises people. An override
 * a customer switched on is a statement that their system is the one sending; quietly
 * sending the mail ourselves when their endpoint is down would be sending mail they believe
 * they took over, which for anybody who overrode it to route through their own logged
 * infrastructure is exactly the failure they were avoiding.
 *
 * The signing scheme is the webhooks' own, imported rather than restated. One scheme means
 * one verification snippet in a customer's codebase and one place for it to be wrong.
 */

import { SIGNATURE_HEADER, TIMESTAMP_HEADER, TIMESTAMP_TOLERANCE_SECONDS } from "./webhooks";

/*
 * The five.
 */

export type HookType =
  | "before_sign_up"
  | "before_sign_in"
  | "customize_claims"
  | "send_email"
  | "send_sms";

/** In the order they would run, which is the order the screen lists them. */
export const HOOK_TYPES: readonly HookType[] = [
  "before_sign_up",
  "before_sign_in",
  "customize_claims",
  "send_email",
  "send_sms",
];

export const HOOK_LABELS: Record<HookType, string> = {
  before_sign_up: "Before sign-up",
  before_sign_in: "Before sign-in",
  customize_claims: "Customize claims",
  send_email: "Send email",
  send_sms: "Send SMS",
};

/** Written out in full so @nuxt/icon bundles them. */
export const HOOK_ICONS: Record<HookType, string> = {
  before_sign_up: "material-symbols:person-add-outline",
  before_sign_in: "material-symbols:login",
  customize_claims: "material-symbols:token-outline",
  send_email: "material-symbols:mail-outline",
  send_sms: "material-symbols:sms-outline",
};

/**
 * What a hook is shaped like, which is what decides what its failure means.
 *
 * A gate answers allow or refuse and its failure is a refusal. A transform answers with
 * data we then carry, and its failure is a request that cannot be completed. An override
 * takes a job off us entirely, and its failure is that job not being done. All three are
 * fail-closed; the three sentences a customer needs are different.
 */
export type HookKind = "gate" | "transform" | "override";

export const HOOK_KINDS: Record<HookType, HookKind> = {
  before_sign_up: "gate",
  before_sign_in: "gate",
  customize_claims: "transform",
  send_email: "override",
  send_sms: "override",
};

export const HOOK_KIND_LABELS: Record<HookKind, string> = {
  gate: "Gate",
  transform: "Transform",
  override: "Override",
};

/** What a customer gets to do with it. */
export const HOOK_NOTES: Record<HookType, string> = {
  before_sign_up:
    "Called once the credential is good and before the account row is written, so refusing here means no user was created. For an invite-only product, a domain allowlist, or a seat count somebody has run out of.",
  before_sign_in:
    "Called after the credential and any second factor are proved, and before a session exists. For a suspension your own system knows about, a terms version somebody has not accepted, or a licence that lapsed this morning.",
  customize_claims:
    "Called while the access token is being minted, for claims we do not hold. Reach for claim templates first: they cost a read the transaction was making anyway, where this puts your round trip inside every sign-in.",
  send_email:
    "Called instead of our sender, with the rendered message. For a customer whose mail has to leave their own infrastructure, or whose compliance log has to see every message before it goes.",
  send_sms:
    "Called instead of our gateway, with the rendered body. Same reasons as email, plus a carrier relationship or a country arrangement of your own that beats ours.",
};

/** Where in the request it runs, in the words the pipeline card uses. */
export const HOOK_STAGES: Record<HookType, string> = {
  before_sign_up: "After the credential is verified, before the user row is written",
  before_sign_in: "After the second factor, before a session is created",
  customize_claims: "While the access token is minted",
  send_email: "In place of our email dispatcher",
  send_sms: "In place of our SMS dispatcher",
};

/** What a 200 has to carry back, so the row can say it without a doc. */
export const HOOK_RETURNS: Record<HookType, string> = {
  before_sign_up: '{ "allow": true } or { "allow": false, "reason": "…" }',
  before_sign_in: '{ "allow": true } or { "allow": false, "reason": "…" }',
  customize_claims: '{ "claims": { … } }',
  send_email: '{ "sent": true }',
  send_sms: '{ "sent": true }',
};

/*
 * How one is configured.
 */

export interface HookConfig {
  type: HookType;
  /** Null until somebody names one. A hook with no URL is off whatever the switch says. */
  url: string | null;
  enabled: boolean;
  /** Milliseconds we will wait before the call is abandoned and the request fails. */
  deadlineMs: number;
  /** Null until it has been called once. */
  lastCalledAt: string | null;
}

export const DEFAULT_DEADLINE_MS = 2000;
export const DEADLINE_MIN_MS = 200;

/**
 * The longest deadline a project may set.
 *
 * Five seconds because a sign-in slower than that is one a person abandons, and a ceiling
 * that let a customer choose thirty would be a ceiling that let them choose an outage. The
 * bound is ours rather than theirs for the same reason the SMS guard's constants are: it
 * describes the shape of the failure and not a preference about it.
 */
export const DEADLINE_MAX_MS = 5000;

export const DEADLINE_ISSUE = {
  range: `Between ${DEADLINE_MIN_MS} and ${DEADLINE_MAX_MS} milliseconds.`,
  integer: "A whole number of milliseconds.",
} as const;

export function defaultHook(type: HookType): HookConfig {
  return { type, url: null, enabled: false, deadlineMs: DEFAULT_DEADLINE_MS, lastCalledAt: null };
}

/**
 * Whether a hook is actually in the path.
 *
 * `enabled` alone is not the answer: a hook switched on with no URL calls nothing, and
 * showing it as live would have somebody hunting for why their gate never refuses anybody.
 */
export function isHookLive(hook: HookConfig): boolean {
  return hook.enabled && hook.url !== null;
}

export type HookState = "off" | "live" | "unset";

export const HOOK_STATE_LABELS: Record<HookState, string> = {
  off: "Off",
  live: "Live",
  unset: "No endpoint",
};

export function hookStateOf(hook: HookConfig): HookState {
  if (hook.url === null) return "unset";
  return hook.enabled ? "live" : "off";
}

/*
 * What being on costs.
 */

/**
 * The worst case a sign-in can pick up, in milliseconds.
 *
 * The two that run on the sign-in path are counted and the delivery overrides are not,
 * because those replace a job that already happened after the answer went back. Worst case
 * rather than measured latency on purpose: it is the number a customer is choosing when
 * they set a deadline, and the one their slowest sign-in will actually meet on the day the
 * endpoint is unwell.
 */
export const SIGN_IN_PATH: readonly HookType[] = [
  "before_sign_up",
  "before_sign_in",
  "customize_claims",
];

export function addedToSignIn(hooks: readonly HookConfig[]): number {
  return hooks
    .filter((hook) => isHookLive(hook) && SIGN_IN_PATH.includes(hook.type))
    .reduce((total, hook) => total + hook.deadlineMs, 0);
}

/** Written the way a latency is read: milliseconds under a second, seconds above it. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

/**
 * Above this much added to a sign-in, the screen says so.
 *
 * A dashboard threshold and never a rule: nothing is refused at this line, and a project
 * that has decided two seconds is worth it keeps its two seconds. It exists because a
 * budget assembled one switch at a time is one nobody adds up.
 */
export const BUDGET_WARNING_MS = 2500;

/*
 * How it is signed and what it may say.
 */

/**
 * The signing headers, re-exported rather than restated.
 *
 * A hook request is signed exactly as a delivery is, so a customer writes the verification
 * once and both paths go through it. Two constants for one scheme is two places for it to
 * drift, and the drift would show up as a signature that fails on one path only.
 */
export const HOOK_SIGNATURE_HEADER = SIGNATURE_HEADER;
export const HOOK_TIMESTAMP_HEADER = TIMESTAMP_HEADER;
export const HOOK_TIMESTAMP_TOLERANCE_SECONDS = TIMESTAMP_TOLERANCE_SECONDS;

/** Says which hook the body is for, so one endpoint can serve all five. */
export const HOOK_TYPE_HEADER = "X-Idenzy-Hook";

/**
 * What a failure is, in the four ways it happens.
 *
 * Named as a list because a customer debugging a refused sign-in needs to know which of
 * these they are looking at, and because all four land on the same answer: the request
 * fails. A hook that is unreachable and a hook that said no are the same outcome for the
 * person signing in, and deliberately different lines in the log.
 */
export const HOOK_FAILURES: readonly { id: string; label: string; note: string }[] = [
  {
    id: "deadline",
    label: "The deadline passed",
    note: "The call is abandoned with an AbortSignal at the deadline. Nothing about the request waits any longer, including whatever your endpoint is still doing.",
  },
  {
    id: "status",
    label: "Anything but a 2xx",
    note: "A 500 and a 403 read the same here. Refusing is a 200 with allow false, because a status code cannot carry the reason your users will be shown.",
  },
  {
    id: "shape",
    label: "A body we cannot parse",
    note: "The reply is schema-checked. An HTML error page from a proxy in front of your service is a failure rather than an allow, which is the whole point of checking it.",
  },
  {
    id: "refused",
    label: "The hook said no",
    note: "The only one of the four that is your service working correctly. It is the one that carries a reason back, and the only one a customer's own error message should be written against.",
  },
];

/** No retries, and the reason is the same one that makes a hook a hook. */
export const NO_RETRY_NOTE =
  "A hook is never retried. The request is waiting, so a second attempt would add a second deadline to somebody's sign-in rather than rescue the first. Retries are what the webhook path is for.";

/*
 * Samples.
 */

export function sampleHookPayload(type: HookType): string {
  const common = '"project": "prj_…", "requestId": "req_…"';
  switch (type) {
    case "before_sign_up":
      return `{ ${common}, "email": "ada@example.com", "method": "password" }`;
    case "before_sign_in":
      return `{ ${common}, "userId": "usr_…", "method": "passkey", "amr": ["passkey"] }`;
    case "customize_claims":
      return `{ ${common}, "userId": "usr_…", "sessionId": "ses_…" }`;
    case "send_email":
      return `{ ${common}, "to": "ada@example.com", "template": "verify_email", "subject": "…", "html": "…" }`;
    case "send_sms":
      return `{ ${common}, "to": "+4477…", "template": "otp", "body": "…", "segments": 1 }`;
  }
}
