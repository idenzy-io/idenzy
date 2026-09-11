import { describe, expect, it } from "vitest";
import {
  addedTo,
  type CallResult,
  type CheckInput,
  callFigures,
  checkHook,
  deadlineIssue,
  defaultHook,
  enableBlocker,
  failureLine,
  failureRateWords,
  firstFailure,
  HOOK_CALLS,
  type HookConfig,
  type HookSecret,
  type HookStats,
  isCheckCurrent,
  readinessOf,
  readinessWords,
  replacesLiveEndpoint,
  secretSummary,
  stagesFor,
  unreachableReason,
  verdictOf,
} from "../../app/utils/hooks";

const AT = "2026-09-10T12:00:00.000Z";
const URL_OK = "https://api.example.com/idenzy/hooks";
const URL_UNREACHABLE = "https://hooks.acme.invalid/idenzy";
const SECRET: HookSecret = {
  createdAt: "2026-08-01T09:00:00.000Z",
  rotatedAt: null,
  previousUntil: null,
};
const ANSWERED: CallResult = { status: 200, ms: 140, bodyOk: true, wrongSignatureStatus: 401 };

function hook(change: Partial<HookConfig> & Pick<HookConfig, "type">): HookConfig {
  return { ...defaultHook(change.type), deadlineMs: 1500, ...change };
}

function check(url: string, call: CallResult | null, extra: Partial<CheckInput> = {}) {
  return checkHook({
    type: "before_sign_in",
    url,
    deadlineMs: 1500,
    secret: SECRET,
    hooks: [],
    call,
    at: AT,
    ...extra,
  });
}

describe("whether anything calls a hook", () => {
  it("does not claim hooks are called, because the only call point answers without calling", () => {
    expect(HOOK_CALLS.running).toBe(false);
    expect(HOOK_CALLS.reason).toMatch(/without calling anybody/);
  });
});

describe("checking a configuration", () => {
  it("fails a deliberately unreachable endpoint without making a call", () => {
    const result = check(URL_UNREACHABLE, ANSWERED);
    expect(verdictOf(result)).toBe("failed");
    expect(firstFailure(result)?.id).toBe("address");
    expect(result.findings.find((finding) => finding.id === "answer")?.verdict).toBe("skip");
  });

  it("knows which names and addresses nothing outside a network can reach", () => {
    expect(unreachableReason("https://10.0.4.12/hooks")).toMatch(/private address/);
    expect(unreachableReason("https://192.168.1.20/hooks")).toMatch(/private address/);
    expect(unreachableReason("https://build.internal/hooks")).toMatch(/\.internal/);
    expect(unreachableReason("https://172.32.0.1/hooks")).toBeNull();
    expect(unreachableReason(URL_OK)).toBeNull();
  });

  it("refuses loopback and plain http by the webhook rules", () => {
    expect(firstFailure(check("https://localhost:3000/hooks", null))?.id).toBe("address");
    expect(firstFailure(check("http://api.example.com/hooks", null))?.detail).toMatch(/Only https/);
  });

  it("leaves the call half not run where nothing can make a call", () => {
    const result = check(URL_OK, null);
    expect(verdictOf(result)).toBe("partial");
    expect(
      result.findings.filter((finding) => finding.verdict === "skip").map((finding) => finding.id),
    ).toEqual(["answer", "signature"]);
  });

  it("reads each way a call goes wrong as a failure", () => {
    expect(firstFailure(check(URL_OK, { ...ANSWERED, status: null }))?.detail).toMatch(
      /Could not connect/,
    );
    expect(firstFailure(check(URL_OK, { ...ANSWERED, status: 500 }))?.detail).toMatch(
      /Answered 500/,
    );
    expect(firstFailure(check(URL_OK, { ...ANSWERED, ms: 1600 }))?.detail).toMatch(
      /past the 1\.5 s deadline/,
    );
    expect(firstFailure(check(URL_OK, { ...ANSWERED, bodyOk: false }))?.detail).toMatch(/"allow"/);
  });

  it("passes an endpoint that answers in time and refuses a wrong signature", () => {
    expect(verdictOf(check(URL_OK, ANSWERED))).toBe("ready");
  });

  it("warns, without blocking, when a wrongly signed call is accepted", () => {
    const result = check(URL_OK, { ...ANSWERED, wrongSignatureStatus: 200 });
    expect(result.findings.find((finding) => finding.id === "signature")?.verdict).toBe("warn");
    expect(verdictOf(result)).toBe("ready");
  });

  it("fails without a secret to verify against", () => {
    expect(firstFailure(check(URL_OK, ANSWERED, { secret: null }))?.id).toBe("secret");
  });

  it("warns when enabling would push a sign-in past the budget", () => {
    const claims = hook({ type: "customize_claims", url: URL_OK, enabled: true, deadlineMs: 2000 });
    const result = check(URL_OK, ANSWERED, { hooks: [claims] });
    expect(result.findings.find((finding) => finding.id === "budget")?.verdict).toBe("warn");
  });
});

describe("readiness and enabling", () => {
  it("reads unset, unvalidated, failed, partial and ready in turn", () => {
    expect(readinessOf(hook({ type: "before_sign_in" }))).toBe("unset");
    expect(readinessOf(hook({ type: "before_sign_in", url: URL_OK }))).toBe("unvalidated");
    expect(
      readinessOf(
        hook({ type: "before_sign_in", url: URL_UNREACHABLE, check: check(URL_UNREACHABLE, null) }),
      ),
    ).toBe("failed");
    expect(
      readinessOf(hook({ type: "before_sign_in", url: URL_OK, check: check(URL_OK, null) })),
    ).toBe("partial");
    expect(
      readinessOf(hook({ type: "before_sign_in", url: URL_OK, check: check(URL_OK, ANSWERED) })),
    ).toBe("ready");
  });

  it("treats a check as stale once the endpoint or the deadline moves", () => {
    const checked = hook({ type: "before_sign_in", url: URL_OK, check: check(URL_OK, ANSWERED) });
    expect(isCheckCurrent(checked)).toBe(true);
    expect(isCheckCurrent({ ...checked, url: "https://new.example.com/hooks" })).toBe(false);
    expect(isCheckCurrent({ ...checked, deadlineMs: 900 })).toBe(false);
  });

  it("refuses to enable anything while nothing calls hooks", () => {
    const ready = hook({ type: "before_sign_in", url: URL_OK, check: check(URL_OK, ANSWERED) });
    expect(enableBlocker(ready, false)).toMatch(/Nothing on this deployment calls a hook/);
    expect(enableBlocker(ready, true)).toBeNull();
    expect(enableBlocker(hook({ type: "before_sign_in" }), true)).toMatch(/endpoint first/);
  });

  it("names a failed check before the missing caller, since only one of them is the reader's", () => {
    const failing = hook({
      type: "before_sign_in",
      url: URL_UNREACHABLE,
      check: check(URL_UNREACHABLE, null),
    });
    expect(enableBlocker(failing, false)).toMatch(/failed validation/);
  });

  it("never reads an enabled hook as live while nothing calls it", () => {
    const on = hook({ type: "before_sign_in", url: URL_OK, enabled: true });
    expect(readinessWords(on, false).label).toBe("Enabled, not called");
    expect(readinessWords(on, true).tone).toBe("success");
  });

  it("checks a new URL on an enabled hook before it replaces the live one", () => {
    const on = hook({ type: "before_sign_in", url: URL_OK, enabled: true });
    expect(replacesLiveEndpoint(on, "https://new.example.com/hooks")).toBe(true);
    expect(replacesLiveEndpoint(on, URL_OK)).toBe(false);
    expect(replacesLiveEndpoint({ ...on, enabled: false }, "https://new.example.com/hooks")).toBe(
      false,
    );
  });
});

describe("what a request waits on", () => {
  it("counts before-sign-up on a sign-up only, and never the two that send", () => {
    const list = [
      hook({ type: "before_sign_up", url: URL_OK, enabled: true, deadlineMs: 500 }),
      hook({ type: "before_sign_in", url: URL_OK, enabled: true, deadlineMs: 1500 }),
      hook({ type: "customize_claims", url: URL_OK, enabled: false, deadlineMs: 2000 }),
      hook({ type: "send_email", url: URL_OK, enabled: true, deadlineMs: 3000 }),
    ];
    expect(addedTo("sign_in", list)).toBe(1500);
    expect(addedTo("sign_up", list)).toBe(2000);
    expect(addedTo("sign_in", list, { type: "customize_claims", enabled: true })).toBe(3500);
    expect(addedTo("sign_in", list, { type: "before_sign_in", deadlineMs: 800 })).toBe(800);
  });

  it("draws the second factor before the before-sign-in hook, and none on the dispatcher", () => {
    const ids = stagesFor("before_sign_in").map((stage) => stage.id);
    expect(ids.indexOf("mfa")).toBeLessThan(ids.indexOf("before_sign_in"));
    expect(stagesFor("send_sms").some((stage) => stage.id === "mfa")).toBe(false);
  });

  it("bounds a deadline, in milliseconds", () => {
    expect(deadlineIssue("1500")).toBe("");
    expect(deadlineIssue("150")).toMatch(/Between 200 ms and 5 s/);
    expect(deadlineIssue("1.5")).toMatch(/whole number/);
  });
});

describe("what the screen says", () => {
  it("states an override's failure as unsent, and never sent by us instead", () => {
    expect(failureLine("send_email")).toMatch(/not sent, and we do not send it for you/);
    expect(failureLine("before_sign_in")).toMatch(/the sign-in is refused/);
  });

  it("says a rotation's overlap only while it lasts", () => {
    const rotated: HookSecret = {
      createdAt: SECRET.createdAt,
      rotatedAt: "2026-09-10T08:00:00.000Z",
      previousUntil: "2026-09-11T08:00:00.000Z",
    };
    expect(secretSummary(rotated, new Date("2026-09-10T12:00:00.000Z"))).toMatch(/signs beside it/);
    expect(secretSummary(rotated, new Date("2026-09-12T12:00:00.000Z"))).toMatch(/Last rotated/);
    expect(secretSummary(null, new Date(AT))).toMatch(/first endpoint/);
  });
});

describe("observed calls", () => {
  it("reads no data rather than a clean record while nothing is called", () => {
    for (const figure of callFigures([])) {
      expect(figure.value).toBe(0);
      expect(figure.series).toEqual([]);
    }
    expect(failureRateWords(null, false).label).toBe("Not measured");
  });

  it("adds the hooks' days together and rates the failures", () => {
    const week = (count: number) => Array.from({ length: 7 }, () => count);
    const stats: HookStats[] = [
      { calls: week(10), refused: week(1), failed: week(0), timedOut: week(0), p50: 40, p99: 300 },
      { calls: week(5), refused: week(0), failed: week(1), timedOut: week(1), p50: 60, p99: 900 },
    ];
    const [calls, refused, failed, timedOut] = callFigures(stats);
    expect(calls?.value).toBe(105);
    expect(refused?.value).toBe(7);
    expect(failed?.value).toBe(7);
    expect(timedOut?.series).toHaveLength(7);
    expect(failureRateWords(stats[1] ?? null, true)).toMatchObject({
      label: "20.0%",
      tone: "warn",
    });
    expect(failureRateWords(stats[0] ?? null, true)).toMatchObject({ label: "0%", tone: "normal" });
  });
});
