/**
 * Synchronous customer hooks: the calls we make into a customer's own service while one of
 * their users waits on the answer (PROJECT.md 3.2, 9.6, notes/hooks.md).
 *
 * The difference from a webhook is the request path. A webhook is told afterwards, retried,
 * and cannot break anything. A hook is called during the request, the request waits on it,
 * and a hard deadline fails it. So a hook is the only way a customer's code changes a sign-in,
 * and the only way their downtime becomes their users'. Fail-closed is not a setting: a gate
 * that could be got past by being slow never gated anything.
 *
 * Nothing calls a hook yet. `AuthFlow` has the before-sign-in call point and it is bound to
 * `NullFlowHooks`, which answers yes without calling anybody; the other four have no call point
 * at all. `HOOK_CALLS` says so, and everything that needs a call reads it: the call half of a
 * check is not run, nothing can be enabled, and no figure is drawn (notes/hooks.md P1).
 *
 * Signing is the webhooks' scheme with a secret of its own. Webhook secrets are per endpoint
 * and a project can hold none or several, so "your webhook secret" named no credential at all.
 */

import type { BadgeTone } from "~/components/StatusBadge.vue";
import { formatDate, formatDateTime } from "./time";
import {
  ENDPOINT_ISSUE_LABELS,
  ROTATION_OVERLAP_HOURS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  TIMESTAMP_TOLERANCE_SECONDS,
  validateEndpointUrl,
} from "./webhooks";

/*
 * Whether anything calls one.
 */

export interface HookCapability {
  running: boolean;
  /** Why not, in the reader's words, for the strip that says so. */
  reason: string;
}

/** Read by everything that needs a call to have been made. */
export const HOOK_CALLS: HookCapability = {
  running: false,
  reason:
    "The sign-in path has its call point, and it answers yes without calling anybody. Endpoints and deadlines are saved; none of them is enforced.",
};

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
 * What a hook is shaped like, which decides what its failure means. A gate's failure is a
 * refusal, a transform's is a token that cannot be issued, an override's is a job not done.
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

/** What each kind is called on a button: Turn off gate, Enable override. */
export const KIND_NOUNS: Record<HookKind, string> = {
  gate: "gate",
  transform: "hook",
  override: "override",
};

/** One line for the row: what it is for, before how it works (P2). */
export const HOOK_PURPOSES: Record<HookType, string> = {
  before_sign_up: "Refuse a sign-up before the account exists.",
  before_sign_in: "Refuse a sign-in before a session exists.",
  customize_claims: "Add claims we do not hold to each access token.",
  send_email: "Send our emails through your own system.",
  send_sms: "Send our text messages through your own gateway.",
};

/** Who reaches for it, under the purpose in the selected hook's header. */
export const HOOK_NOTES: Record<HookType, string> = {
  before_sign_up:
    "For an invite-only product, a domain allowlist or a seat count somebody has run out of. Refusing here creates nobody.",
  before_sign_in:
    "For a suspension your own system knows about, terms somebody has not accepted, or a licence that lapsed this morning.",
  customize_claims:
    "For claims only your system holds. A claim template costs no round trip, where this sits inside every token we issue, so reach for one first.",
  send_email:
    "For mail that has to leave your own infrastructure, or a compliance log that has to see every message before it goes.",
  send_sms:
    "For a carrier arrangement of your own, or a log that has to see every message before it goes.",
};

/** The request each hook's failure lands on, for "from the next …". */
export const NEXT_REQUEST: Record<HookType, string> = {
  before_sign_up: "sign-up",
  before_sign_in: "sign-in",
  customize_claims: "token",
  send_email: "email",
  send_sms: "text message",
};

/*
 * Where it runs.
 */

/** One step of a request, ours or a hook's, in the order it runs. */
export interface PipelineStage {
  id: string;
  label: string;
  /** Present where the step is a hook rather than ours. */
  hook?: HookType;
}

/**
 * The sign-in path. The second factor comes before any hook, because `AuthFlow` consults the
 * MFA gate after `verify` and before the hooks, so a hook is never handed a half-signed-in user.
 */
const SIGN_IN_STAGES: readonly PipelineStage[] = [
  { id: "verify", label: "Credential verified" },
  { id: "before_sign_up", label: "Before sign-up", hook: "before_sign_up" },
  { id: "mfa", label: "Second factor" },
  { id: "before_sign_in", label: "Before sign-in", hook: "before_sign_in" },
  { id: "session", label: "Session created" },
  { id: "customize_claims", label: "Customize claims", hook: "customize_claims" },
  { id: "answer", label: "Answer sent" },
];

/** The sign-in path for three; the dispatcher, after the answer, for the two that send. */
export function stagesFor(type: HookType): readonly PipelineStage[] {
  if (HOOK_KINDS[type] !== "override") return SIGN_IN_STAGES;
  return [
    { id: "answer", label: "Request answered" },
    { id: "render", label: "Message rendered" },
    { id: type, label: HOOK_LABELS[type], hook: type },
  ];
}

export const HOOK_PLACEMENT: Record<HookType, string> = {
  before_sign_up: "On a sign-up only, once the credential is good and before the account exists.",
  before_sign_in:
    "Once the credential and any second factor are proved, and before a session exists. The second factor comes first, so a hook is never handed a half-signed-in user and cannot wave one past a challenge.",
  customize_claims:
    "While an access token is minted, after the claim template: at sign-in and again at every refresh.",
  send_email:
    "On our dispatcher, in place of our sender, after the request that asked for the email has been answered.",
  send_sms:
    "On our dispatcher, in place of our SMS gateway, after the request that asked for the message has been answered.",
};

/*
 * What a call costs, and what its failure does.
 */

/** What a failed call leaves behind, the clause every consequence line is built from. */
const FAILS: Record<HookType, string> = {
  before_sign_up: "the sign-up is refused",
  before_sign_in: "the sign-in is refused",
  customize_claims: "no token is issued, so the sign-in or refresh fails",
  send_email: "the email is not sent",
  send_sms: "the text message is not sent",
};

/** The one line above Enable: what a late, unreachable or malformed answer does. */
export function failureLine(type: HookType): string {
  const tail = HOOK_KINDS[type] === "override" ? ", and we do not send it for you" : "";
  return `If your endpoint is late, unreachable or answers badly, ${FAILS[type]}${tail}.`;
}

/** What the deadline means, said with the value. */
export function deadlineOutcome(type: HookType, deadlineMs: number): string {
  return `At ${formatDuration(deadlineMs)} the call is abandoned and ${FAILS[type]}.`;
}

/** The delay a person feels, which leads the selected hook (P2). */
export function delayLine(type: HookType, deadlineMs: number): string {
  const most = `for up to ${formatDuration(deadlineMs)}`;
  const lines: Record<HookType, string> = {
    before_sign_up: `Every sign-up waits on your answer, ${most}.`,
    before_sign_in: `Every sign-in and sign-up waits on your answer, ${most}.`,
    customize_claims: `Every access token waits on your answer, ${most}: each sign-in and each refresh.`,
    send_email: `Each email waits on your answer before it goes, ${most}.`,
    send_sms: `Each text message waits on your answer before it goes, ${most}.`,
  };
  return lines[type];
}

/** What stops when a hook is turned off or loses its endpoint, from the next request. */
export const HOOK_SKIPPED: Record<HookType, string> = {
  before_sign_up:
    "Sign-ups stop being checked by your service. Anybody the project's sign-in methods accept can make an account, from the next sign-up.",
  before_sign_in:
    "Sign-ins stop being checked by your service. Whatever it refuses on, a suspension or a lapsed licence, is not applied from the next sign-in.",
  customize_claims:
    "Tokens are issued without the claims your service adds, from the next sign-in or refresh. Code that reads them finds them missing.",
  send_email: "We send these emails ourselves again, from the next one.",
  send_sms:
    "We send these text messages ourselves again, from the next one, under the project's SMS policy.",
};

/** What a gate's acknowledgement names: the requests it stops checking. */
export const GATE_SUBJECTS: Partial<Record<HookType, string>> = {
  before_sign_up: "sign-ups",
  before_sign_in: "sign-ins",
};

/*
 * How one is configured.
 */

export type FindingVerdict = "pass" | "warn" | "fail" | "skip";

export interface CheckFinding {
  id: "address" | "secret" | "budget" | "answer" | "signature";
  label: string;
  verdict: FindingVerdict;
  detail: string;
}

export interface HookCheck {
  at: string;
  /** What it ran against, so a changed endpoint or deadline reads as not validated. */
  url: string;
  deadlineMs: number;
  findings: CheckFinding[];
}

export interface HookConfig {
  type: HookType;
  /** Null until somebody names one. */
  url: string | null;
  /** In the path. Only ever set where something calls hooks (`HOOK_CALLS`). */
  enabled: boolean;
  /** How long we wait before the call is abandoned and the request fails. */
  deadlineMs: number;
  /** The last check of the saved configuration, kept with what it ran against. */
  check: HookCheck | null;
  enabledAt: string | null;
}

export const DEFAULT_DEADLINE_MS = 2000;
export const DEADLINE_MIN_MS = 200;

/**
 * The longest deadline a project may set. A sign-in slower than five seconds is one a person
 * abandons, and a ceiling that allowed thirty would be one that allowed an outage.
 */
export const DEADLINE_MAX_MS = 5000;

export function defaultHook(type: HookType): HookConfig {
  return {
    type,
    url: null,
    enabled: false,
    deadlineMs: DEFAULT_DEADLINE_MS,
    check: null,
    enabledAt: null,
  };
}

/** Why a typed deadline is refused, or empty when it stands. */
export function deadlineIssue(text: string): string {
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isInteger(value)) return "A whole number of milliseconds.";
  if (value < DEADLINE_MIN_MS || value > DEADLINE_MAX_MS) {
    return `Between ${formatDuration(DEADLINE_MIN_MS)} and ${formatDuration(DEADLINE_MAX_MS)}, in milliseconds.`;
  }
  return "";
}

/*
 * What being on costs a request.
 */

export type RequestPath = "sign_in" | "sign_up";

/** A sign-up passes the before-sign-in point too, which is why its budget is the longer one. */
const ON_PATH: Record<RequestPath, readonly HookType[]> = {
  sign_in: ["before_sign_in", "customize_claims"],
  sign_up: ["before_sign_up", "before_sign_in", "customize_claims"],
};

export const PATH_WORDS: Record<RequestPath, string> = {
  sign_in: "sign-in",
  sign_up: "sign-up",
};

/** The path a hook's delay lands on, or null for the two that send. */
export function pathOf(type: HookType): RequestPath | null {
  if (type === "before_sign_up") return "sign_up";
  return ON_PATH.sign_in.includes(type) ? "sign_in" : null;
}

export interface HookChange {
  type: HookType;
  deadlineMs?: number;
  enabled?: boolean;
}

/**
 * The longest a request on `path` can wait on hooks, in milliseconds: every enabled hook on it,
 * each to its own deadline. With a change, what it would be after it.
 *
 * Worst case rather than a measured latency on purpose. It is the number a deadline chooses, and
 * the one a request meets on the day the endpoint is unwell.
 */
export function addedTo(
  path: RequestPath,
  hooks: readonly HookConfig[],
  change?: HookChange,
): number {
  let total = 0;
  for (const hook of hooks) {
    if (!ON_PATH[path].includes(hook.type)) continue;
    const own = change !== undefined && change.type === hook.type ? change : null;
    const enabled = own?.enabled ?? hook.enabled;
    if (enabled && hook.url !== null) total += own?.deadlineMs ?? hook.deadlineMs;
  }
  return total;
}

/** Written the way a latency is read: milliseconds under a second, seconds above it. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

/** Above this much added to a request, the screen says so. A threshold, never a rule. */
export const BUDGET_WARNING_MS = 2500;

/*
 * How a call is signed.
 */

export interface HookSecret {
  createdAt: string;
  rotatedAt: string | null;
  /** When the previous secret stops signing, after a rotation. */
  previousUntil: string | null;
}

/** The webhooks' own headers, re-exported so the two paths cannot drift apart. */
export const HOOK_SIGNATURE_HEADER = SIGNATURE_HEADER;
export const HOOK_TIMESTAMP_HEADER = TIMESTAMP_HEADER;
export const HOOK_TIMESTAMP_TOLERANCE_SECONDS = TIMESTAMP_TOLERANCE_SECONDS;
export const HOOK_ROTATION_OVERLAP_HOURS = ROTATION_OVERLAP_HOURS;

/** Says which hook the body is for, so one route can serve all five. */
export const HOOK_TYPE_HEADER = "X-Idenzy-Hook";

export const HOOK_SECRET_PREFIX = "hksec_";

/** Where the project's hook secret stands, in one sentence for the signing row. */
export function secretSummary(secret: HookSecret | null, now: Date): string {
  if (secret === null) {
    return "Made when the first endpoint is saved, and shown once then. One secret signs all five hooks on this project.";
  }
  const { rotatedAt, previousUntil } = secret;
  if (rotatedAt !== null && previousUntil !== null && Date.parse(previousUntil) > now.getTime()) {
    return `Rotated ${formatDateTime(rotatedAt)}. The previous one signs beside it until ${formatDateTime(previousUntil)}.`;
  }
  const made =
    rotatedAt === null
      ? `Made ${formatDateTime(secret.createdAt)}`
      : `Last rotated ${formatDateTime(rotatedAt)}`;
  return `${made}. Shown only when it is made, so a lost one is replaced rather than looked up.`;
}

/*
 * Checking a configuration before it is enabled.
 */

/**
 * Names and addresses nothing outside a network can reach: the special-use names of RFC 2606,
 * 6761 and 6762, ICANN's private-use `.internal`, and the private IPv4 ranges. Saved, because
 * the form cannot know a tunnel is about to be set up, and failed at the check, where it shows
 * before anything is enabled (notes/hooks.md acceptance checks).
 */
const PRIVATE_SUFFIXES = [
  ".test",
  ".example",
  ".invalid",
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];
const PRIVATE_IPV4 = /^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254)\.\d+\.\d+$/;

export function unreachableReason(value: string): string | null {
  let host: string;
  try {
    host = new URL(value.trim()).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  if (PRIVATE_IPV4.test(host)) {
    return `${host} is a private address, which nothing outside your network can reach.`;
  }
  const suffix = PRIVATE_SUFFIXES.find((entry) => host.endsWith(entry));
  return suffix === undefined
    ? null
    : `${host} ends in ${suffix}, a name that never resolves on the public internet, so nothing of ours can reach it.`;
}

/** What the call half found. Null anywhere a call could not be made. */
export interface CallResult {
  /** Null when no connection was made. */
  status: number | null;
  ms: number;
  /** Whether the body parsed as this hook's answer. */
  bodyOk: boolean;
  /** What the same request drew when signed with the wrong secret. */
  wrongSignatureStatus: number | null;
}

export interface CheckInput {
  type: HookType;
  url: string;
  deadlineMs: number;
  secret: HookSecret | null;
  hooks: readonly HookConfig[];
  /** Null where nothing can make the call, which is every deployment today. */
  call: CallResult | null;
  at: string;
}

const ANSWER_SHAPES: Record<HookKind, string> = {
  gate: '{ "allow": … }',
  transform: '{ "claims": { … } }',
  override: '{ "sent": true }',
};

const NOT_RUN = "Not run: nothing on this deployment can call your endpoint yet.";
const ADDRESS_FIRST = "Not run: the address has to pass first.";

const is2xx = (status: number | null) => status !== null && status >= 200 && status < 300;

function addressFinding(url: string): CheckFinding {
  const found = { id: "address", label: "A public https address" } as const;
  const issue = validateEndpointUrl(url, []);
  if (issue !== null) return { ...found, verdict: "fail", detail: ENDPOINT_ISSUE_LABELS[issue] };
  const unreachable = unreachableReason(url);
  if (unreachable !== null) return { ...found, verdict: "fail", detail: unreachable };
  return {
    ...found,
    verdict: "pass",
    detail: "https, and not a name or an address that only exists inside a network.",
  };
}

function secretFinding(secret: HookSecret | null): CheckFinding {
  const found = { id: "secret", label: "A secret to verify our signature" } as const;
  return secret === null
    ? {
        ...found,
        verdict: "fail",
        detail:
          "This project has no hook secret, so there is nothing to check our signature against.",
      }
    : {
        ...found,
        verdict: "pass",
        detail: `The project's hook secret, made ${formatDate(secret.createdAt)}.`,
      };
}

function budgetFinding(input: CheckInput): CheckFinding {
  const path = pathOf(input.type);
  if (path === null) {
    return {
      id: "budget",
      label: "Off the sign-in path",
      verdict: "pass",
      detail: "It delays a message, never a sign-in.",
    };
  }
  /* The hook as it would be once enabled, beside every other hook as it is. */
  const others = input.hooks.filter((hook) => hook.type !== input.type);
  const self: HookConfig = {
    ...defaultHook(input.type),
    url: input.url,
    deadlineMs: input.deadlineMs,
    enabled: true,
  };
  const worst = addedTo(path, [...others, self]);
  const found = { id: "budget", label: "Inside the sign-in budget" } as const;
  const words = PATH_WORDS[path];
  return worst > BUDGET_WARNING_MS
    ? {
        ...found,
        verdict: "warn",
        detail: `Enabled, it lets a ${words} wait up to ${formatDuration(worst)} on hooks, past the ${formatDuration(BUDGET_WARNING_MS)} this screen flags.`,
      }
    : {
        ...found,
        verdict: "pass",
        detail: `Enabled, a ${words} waits at most ${formatDuration(worst)} on hooks.`,
      };
}

function answerFinding(input: CheckInput, addressOk: boolean): CheckFinding {
  const found = { id: "answer", label: "Answers in time, with the expected body" } as const;
  const { call } = input;
  if (!addressOk) return { ...found, verdict: "skip", detail: ADDRESS_FIRST };
  if (call === null) return { ...found, verdict: "skip", detail: NOT_RUN };
  const fail = (detail: string): CheckFinding => ({ ...found, verdict: "fail", detail });
  if (call.status === null) return fail("Could not connect, so every call would fail the request.");
  if (!is2xx(call.status)) {
    return fail(`Answered ${call.status}. Anything but a 2xx fails the request.`);
  }
  if (call.ms > input.deadlineMs) {
    return fail(
      `Answered in ${formatDuration(call.ms)}, past the ${formatDuration(input.deadlineMs)} deadline, so the request would have failed.`,
    );
  }
  if (!call.bodyOk) {
    return fail(
      `Answered ${call.status} with a body that is not ${ANSWER_SHAPES[HOOK_KINDS[input.type]]}.`,
    );
  }
  return {
    ...found,
    verdict: "pass",
    detail: `Answered ${call.status} in ${formatDuration(call.ms)} with a body we could read.`,
  };
}

/**
 * The second call, signed with the wrong secret. An endpoint that answers it with a 2xx is not
 * checking who is calling. A warning rather than a failure: the hook still works, and whose
 * problem an unverified endpoint is depends on what is behind it.
 */
function signatureFinding(input: CheckInput, addressOk: boolean): CheckFinding {
  const found = { id: "signature", label: "Refuses a wrongly signed request" } as const;
  const { call } = input;
  if (!addressOk) return { ...found, verdict: "skip", detail: ADDRESS_FIRST };
  if (call === null) return { ...found, verdict: "skip", detail: NOT_RUN };
  if (call.status === null) {
    return { ...found, verdict: "skip", detail: "Not run: the endpoint could not be reached." };
  }
  const status = call.wrongSignatureStatus;
  if (is2xx(status)) {
    return {
      ...found,
      verdict: "warn",
      detail: `Answered a request signed with the wrong secret with ${status}, so it is not checking who is calling.`,
    };
  }
  return {
    ...found,
    verdict: "pass",
    detail:
      status === null
        ? "Dropped a request signed with the wrong secret."
        : `Answered ${status} to a request signed with the wrong secret.`,
  };
}

/**
 * Checks one configuration: the address, the secret and the budget here, then a signed call and
 * a wrongly signed one where a call can be made. A pass says the endpoint answered just now,
 * never that it will tomorrow, which is why the figures stay on the screen after it.
 */
export function checkHook(input: CheckInput): HookCheck {
  const address = addressFinding(input.url);
  const addressOk = address.verdict === "pass";
  return {
    at: input.at,
    url: input.url,
    deadlineMs: input.deadlineMs,
    findings: [
      address,
      secretFinding(input.secret),
      budgetFinding(input),
      answerFinding(input, addressOk),
      signatureFinding(input, addressOk),
    ],
  };
}

export type CheckVerdict = "failed" | "partial" | "ready";

/** A warning never blocks; a finding that was not run always does. */
export function verdictOf(check: HookCheck): CheckVerdict {
  if (check.findings.some((finding) => finding.verdict === "fail")) return "failed";
  if (check.findings.some((finding) => finding.verdict === "skip")) return "partial";
  return "ready";
}

export function firstFailure(check: HookCheck | null): CheckFinding | null {
  return check?.findings.find((finding) => finding.verdict === "fail") ?? null;
}

/** A check speaks for the endpoint and deadline it ran against, and for nothing after them. */
export function isCheckCurrent(hook: HookConfig): boolean {
  return (
    hook.check !== null && hook.check.url === hook.url && hook.check.deadlineMs === hook.deadlineMs
  );
}

/*
 * Readiness, which is what the list leads with (P1).
 */

export type HookReadiness = "unset" | "unvalidated" | "failed" | "partial" | "ready" | "enabled";

export function readinessOf(hook: HookConfig): HookReadiness {
  if (hook.url === null) return "unset";
  if (hook.enabled) return "enabled";
  if (hook.check === null || !isCheckCurrent(hook)) return "unvalidated";
  return verdictOf(hook.check);
}

export interface ReadinessWords {
  label: string;
  tone: BadgeTone;
  detail: string;
}

/** An enabled hook reads as live only where something calls it. */
export function readinessWords(hook: HookConfig, running: boolean): ReadinessWords {
  switch (readinessOf(hook)) {
    case "unset":
      return { label: "Not set up", tone: "neutral", detail: "No endpoint" };
    case "unvalidated":
      return {
        label: "Not validated",
        tone: "neutral",
        detail: hook.check === null ? "Validate before enabling" : "Changed since its check",
      };
    case "failed":
      return {
        label: "Failed validation",
        tone: "error",
        detail: firstFailure(hook.check)?.label ?? "",
      };
    case "partial":
      return {
        label: "Call untested",
        tone: "warning",
        detail: running ? "Validate it again" : "Nothing can call it yet",
      };
    case "ready":
      return { label: "Ready to enable", tone: "neutral", detail: "Validated, not enabled" };
    case "enabled":
      return running
        ? { label: "Enabled", tone: "success", detail: "" }
        : { label: "Enabled, not called", tone: "warning", detail: "Nothing calls hooks yet" };
  }
}

/**
 * Why Enable is not on offer, or null when it is. A failed check comes first because it is the
 * reader's to fix; a deployment that calls nothing comes next because no check would change it.
 */
export function enableBlocker(hook: HookConfig, running: boolean): string | null {
  if (hook.url === null) return "Set an endpoint first.";
  if (hook.enabled) return null;
  const check = isCheckCurrent(hook) ? hook.check : null;
  const verdict = check === null ? null : verdictOf(check);
  if (verdict === "failed") return "Fix what failed validation, then validate again.";
  if (!running) {
    return "Nothing on this deployment calls a hook yet, so enabling one would enforce nothing.";
  }
  if (verdict === null) {
    return hook.check === null
      ? "Validate this configuration first."
      : "It changed since it was validated. Validate it again.";
  }
  return verdict === "partial" ? "Part of the check was not run. Validate it again." : null;
}

/** A new URL on an enabled hook is checked before it replaces the one a request waits on (P1). */
export function replacesLiveEndpoint(hook: HookConfig, url: string): boolean {
  return hook.enabled && hook.url !== null && hook.url !== url;
}

/*
 * Observed calls.
 */

export const HOOK_FIGURE_DAYS = 7;

export interface HookStats {
  /** One count a day, oldest first, over `HOOK_FIGURE_DAYS`. */
  calls: number[];
  /** Answered with a no: a 200 that refused. The hook working as meant. */
  refused: number[];
  /** Late, unreachable, not a 2xx or not readable. Each one failed a request. */
  failed: number[];
  /** The share of `failed` abandoned at the deadline. */
  timedOut: number[];
  /** Milliseconds over the window. */
  p50: number | null;
  p99: number | null;
}

export interface CallFigure {
  id: "calls" | "refused" | "failed" | "timed_out";
  label: string;
  /** Tells one tile's stand-in wave from the next one's. */
  seed: number;
  info: string;
  value: number;
  /** Empty where nothing was counted, which a `UsageTile` draws as No data. */
  series: number[];
}

const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

function sumDaily(lists: readonly (readonly number[])[]): number[] {
  return Array.from({ length: HOOK_FIGURE_DAYS }, (_, day) =>
    lists.reduce((sum, list) => sum + (list[day] ?? 0), 0),
  );
}

function callFigure(
  id: CallFigure["id"],
  label: string,
  seed: number,
  info: string,
  series: number[],
): CallFigure {
  const value = total(series);
  return { id, label, seed, info, value, series: value === 0 ? [] : series };
}

/** A week across every enabled hook. With nothing called, every tile reads No data. */
export function callFigures(stats: readonly HookStats[]): CallFigure[] {
  return [
    callFigure(
      "calls",
      "Calls",
      81,
      "Calls made to your endpoints, across every enabled hook.",
      sumDaily(stats.map((entry) => entry.calls)),
    ),
    callFigure(
      "refused",
      "Refused",
      83,
      "Calls your service answered with a no. The one outcome that is the hook working as meant.",
      sumDaily(stats.map((entry) => entry.refused)),
    ),
    callFigure(
      "failed",
      "Failed",
      85,
      "Calls that were late, unreachable, not a 2xx or not readable. Each one failed somebody's request.",
      sumDaily(stats.map((entry) => entry.failed)),
    ),
    callFigure(
      "timed_out",
      "Timed out",
      87,
      "Of the failed, the calls abandoned at the deadline.",
      sumDaily(stats.map((entry) => entry.timedOut)),
    ),
  ];
}

export interface RateWords {
  label: string;
  detail: string;
  tone: "quiet" | "normal" | "warn";
}

function shareOf(part: number, whole: number): string {
  if (part === 0) return "0%";
  const share = (part / whole) * 100;
  return share < 0.1 ? "<0.1%" : `${share.toFixed(1)}%`;
}

/** The row's failure rate. Not measured is not nought, and says so. */
export function failureRateWords(stats: HookStats | null, running: boolean): RateWords {
  if (!running) return { label: "Not measured", detail: "Nothing calls it yet", tone: "quiet" };
  if (stats === null) return { label: "Not called", detail: "Not enabled", tone: "quiet" };
  const calls = total(stats.calls);
  const failed = total(stats.failed);
  if (calls === 0) {
    return { label: "No calls", detail: `In ${HOOK_FIGURE_DAYS} days`, tone: "quiet" };
  }
  return {
    label: shareOf(failed, calls),
    detail: `${failed.toLocaleString("en")} of ${calls.toLocaleString("en")} calls`,
    tone: failed > 0 ? "warn" : "normal",
  };
}

/** The tail is past the deadline, so a share of calls is being cut off on purpose. */
export function tailPastDeadline(stats: HookStats | null, deadlineMs: number): boolean {
  return stats !== null && stats.p99 !== null && stats.p99 > deadlineMs;
}

/*
 * The contract, shown while configuring (P2).
 */

const SAMPLE_COMMON = { projectId: "prj_8f2c1d4e", requestId: "req_4b71e9a0c2" };

const SAMPLE_REQUESTS: Record<HookType, Record<string, unknown>> = {
  before_sign_up: {
    hook: "before_sign_up",
    ...SAMPLE_COMMON,
    email: "ada@example.com",
    method: "password",
    ip: "203.0.113.24",
  },
  before_sign_in: {
    hook: "before_sign_in",
    ...SAMPLE_COMMON,
    userId: "usr_29d0c4a1",
    method: "passkey",
    amr: ["passkey"],
    ip: "203.0.113.24",
  },
  customize_claims: {
    hook: "customize_claims",
    ...SAMPLE_COMMON,
    userId: "usr_29d0c4a1",
    sessionId: "ses_71be03f9",
    reason: "refresh",
  },
  send_email: {
    hook: "send_email",
    ...SAMPLE_COMMON,
    to: "ada@example.com",
    template: "verify_email",
    locale: "en",
    subject: "Your sign-in code",
    html: "<p>Your code is 491026</p>",
    text: "Your code is 491026",
  },
  send_sms: {
    hook: "send_sms",
    ...SAMPLE_COMMON,
    to: "+447700900123",
    template: "otp",
    body: "Your sign-in code is 491026",
    segments: 1,
  },
};

const SAMPLE_ANSWERS: Record<HookType, Record<string, unknown>> = {
  before_sign_up: { allow: false, reason: "Sign-ups are invite only." },
  before_sign_in: { allow: false, reason: "This account is suspended." },
  customize_claims: { claims: { plan: "pro", org_id: "org_5c1e" } },
  send_email: { sent: true },
  send_sms: { sent: true },
};

export function sampleRequest(type: HookType): string {
  return JSON.stringify(SAMPLE_REQUESTS[type], null, 2);
}

export function sampleResponse(type: HookType): string {
  return JSON.stringify(SAMPLE_ANSWERS[type], null, 2);
}

/** What the body carries, and for a gate what it never does. */
export const REQUEST_NOTES: Record<HookType, string> = {
  before_sign_up:
    "Who is signing up and how. Never the password, the code or the passkey assertion.",
  before_sign_in:
    "Who is signing in and how. Never the password, the code or the passkey assertion.",
  customize_claims:
    "Who the token is for, and whether it is being minted at a sign-in or a refresh.",
  send_email: "The rendered email, code included: sending it is the job you took over.",
  send_sms: "The rendered message, code included: sending it is the job you took over.",
};

export const ANSWER_NOTES: Record<HookType, string> = {
  before_sign_up:
    '{ "allow": true } lets it through. A refusal\'s reason reaches your application in the error, for your own screen to show.',
  before_sign_in:
    '{ "allow": true } lets it through. A refusal\'s reason reaches your application in the error, for your own screen to show.',
  customize_claims:
    "Merged over the claim template. A reserved name such as sub or aud is refused, and so is a set past the token's size cap.",
  send_email:
    "Anything but a 2xx with this body is a failure, and the email is then not sent at all.",
  send_sms:
    "Anything but a 2xx with this body is a failure, and the message is then not sent at all.",
};

/*
 * The reference, folded at the foot of the screen.
 */

/** The four ways a call does not come back with a yes. All four fail the request. */
export const HOOK_FAILURES: readonly { id: string; label: string; note: string }[] = [
  {
    id: "deadline",
    label: "The deadline passed",
    note: "The call is abandoned at the deadline and the request stops waiting, whatever your endpoint is still doing.",
  },
  {
    id: "status",
    label: "Anything but a 2xx",
    note: "A 500 and a 403 read the same. A refusal is a 200 saying no, because a status code cannot carry the reason your users are shown.",
  },
  {
    id: "shape",
    label: "A body we cannot read",
    note: "The answer is schema-checked, so an HTML error page from a proxy in front of your service is a failure and never an allow.",
  },
  {
    id: "refused",
    label: "Your service said no",
    note: "The one outcome that is your service working. It carries its reason back, and it is the one to write your own message against.",
  },
];

export const NO_RETRY_NOTE =
  "A hook is never retried. The request is waiting, so a second attempt adds a second deadline to somebody's sign-in rather than rescuing the first.";

export const FAIL_CLOSED_NOTE =
  "Fail-closed is not a switch and will not become one. A gate that could be got past by being slow was never a gate: anybody able to make your endpoint time out could turn it off from outside.";

/** The comparison the note keeps, as rows rather than two cards of prose. */
export const HOOK_OR_WEBHOOK: readonly {
  id: string;
  label: string;
  hook: string;
  webhook: string;
}[] = [
  {
    id: "when",
    label: "When it is called",
    hook: "During the request, while somebody waits",
    webhook: "Afterwards, while nobody waits",
  },
  {
    id: "change",
    label: "What it can change",
    hook: "The outcome: refuse it, or add to the token",
    webhook: "Nothing that already happened",
  },
  {
    id: "retry",
    label: "When a call fails",
    hook: "The request fails. One attempt, never retried",
    webhook: "Retried for about a day, at least once",
  },
  {
    id: "down",
    label: "When your endpoint is down",
    hook: "Your users cannot finish what it guards",
    webhook: "You miss notifications; your users notice nothing",
  },
];
