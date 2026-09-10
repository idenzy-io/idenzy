import { describe, expect, it } from "vitest";
import {
  canSignInNow,
  methodStandings,
  newAccountOutcome,
  type ProjectSignInSettings,
  pathById,
  signInPaths,
} from "../../app/utils/sign-in-paths";

const ALL_ON: ProjectSignInSettings = {
  passwordEnabled: true,
  emailCodeEnabled: true,
  smsCodeEnabled: true,
  smsPolicyReady: true,
};

describe("signInPaths", () => {
  it("offers the three an operator can hand out", () => {
    expect(signInPaths(ALL_ON).map((path) => path.id)).toEqual([
      "password",
      "email_otp",
      "sms_otp",
    ]);
    expect(signInPaths(ALL_ON).every((path) => path.available)).toBe(true);
  });

  it("refuses SMS where the channel is on and the policy allows nowhere", () => {
    const paths = signInPaths({ ...ALL_ON, smsPolicyReady: false });
    const sms = pathById(paths, "sms_otp");
    expect(sms?.available).toBe(false);
    expect(sms?.note).toContain("no country is allowed");
    expect(sms?.fix?.to).toBe("/sms/policy");
  });

  it("sends an off channel to the screen that turns it on, not to the policy", () => {
    const paths = signInPaths({ ...ALL_ON, smsCodeEnabled: false, smsPolicyReady: false });
    expect(pathById(paths, "sms_otp")?.fix?.to).toBe("/methods/otp");
  });
});

describe("newAccountOutcome", () => {
  it("names the password when one is being set", () => {
    const outcome = newAccountOutcome(
      { email: "nuray@example.com", phone: null, password: true },
      signInPaths(ALL_ON),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.text).toContain("password");
  });

  it("refuses to promise a password the project has switched off", () => {
    const outcome = newAccountOutcome(
      { email: "nuray@example.com", phone: null, password: true },
      signInPaths({ ...ALL_ON, passwordEnabled: false }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.fix?.to).toBe("/methods/passwords");
  });

  it("falls to the address when there is no password", () => {
    const outcome = newAccountOutcome(
      { email: "nuray@example.com", phone: "+14155550123", password: false },
      signInPaths(ALL_ON),
    );
    expect(outcome.text).toContain("nuray@example.com");
  });

  it("says an account with only a number and no SMS has no way in", () => {
    const outcome = newAccountOutcome(
      { email: null, phone: "+14155550123", password: false },
      signInPaths({ ...ALL_ON, smsPolicyReady: false }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.text).toContain("SMS codes");
  });

  it("asks for an identifier when it has neither", () => {
    const outcome = newAccountOutcome(
      { email: null, phone: null, password: false },
      signInPaths(ALL_ON),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.fix).toBeNull();
  });
});

describe("methodStandings", () => {
  it("marks a method the project no longer allows as unusable", () => {
    const standings = methodStandings(
      ["password", "sms_otp"],
      { ...ALL_ON, smsCodeEnabled: false },
      [],
    );
    expect(standings.map((standing) => standing.usable)).toEqual([true, false]);
    expect(standings[1]?.reason).not.toBe("");
  });

  it("never gates a passkey on a project setting", () => {
    const standings = methodStandings(
      ["passkey"],
      {
        passwordEnabled: false,
        emailCodeEnabled: false,
        smsCodeEnabled: false,
        smsPolicyReady: false,
      },
      [],
    );
    expect(standings[0]?.usable).toBe(true);
  });

  it("reads a social provider off the ones the project has switched on", () => {
    expect(methodStandings(["google"], ALL_ON, ["google"])[0]?.usable).toBe(true);
    expect(methodStandings(["google"], ALL_ON, ["github"])[0]?.usable).toBe(false);
  });

  it("says nobody can sign in when nothing on the account stands", () => {
    const standings = methodStandings(["password"], { ...ALL_ON, passwordEnabled: false }, []);
    expect(canSignInNow(standings)).toBe(false);
    expect(canSignInNow(methodStandings(["password"], ALL_ON, []))).toBe(true);
  });

  it("has nothing to say about an account with no methods", () => {
    expect(canSignInNow(methodStandings([], ALL_ON, []))).toBe(false);
  });
});
