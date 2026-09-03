import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { describe, expect, it } from "vitest";
import { IdenzyTransportError } from "../src/errors.js";
import { Idenzy } from "../src/idenzy.js";
import type { AuthResult, MfaChallenge } from "../src/mfa/auth-result.js";
import {
  errorBody,
  FakeTransport,
  FixedClock,
  json,
  mfaRequired,
  sessionCreated,
  user,
} from "./fixtures.js";

/** Narrows an outcome the test expects to be a challenge, without a bare throw. */
function challengeIn(result: AuthResult): MfaChallenge {
  if (result.status !== "mfa_required") {
    throw new IdenzyTransportError("expected a challenge", { status: 200 });
  }
  return result.challenge;
}

function required<T>(value: T | null): T {
  if (value === null) throw new IdenzyTransportError("expected a challenge", { status: 200 });
  return value;
}

function build(transport: FakeTransport, deviceName?: string): Idenzy {
  return new Idenzy(
    {
      publishableKey: "pk_test_abc",
      apiUrl: "https://auth.acme.test",
      ...(deviceName === undefined ? {} : { deviceName }),
    },
    { transport, clock: new FixedClock() },
  );
}

describe("a sign-in that stops at a second factor", () => {
  /** The property the union exists for: nothing is adopted, so nothing looks signed in. */
  it("adopts no session and holds no token", async () => {
    // A rotation is refused, which is what a server with no session for this browser does.
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/refresh")
        ? json(401, errorBody("refresh_token_invalid"))
        : json(200, mfaRequired()),
    );
    const client = build(transport);

    const result = await client.signIn.withPassword({
      email: "a@b.test",
      password: "correct-horse",
    });

    expect(result.status).toBe("mfa_required");
    expect(client.state().status).toBe("signed-out");
    expect(await client.getToken()).toBeNull();
  });

  it("carries everything a prompt needs, strongest factor first", async () => {
    const client = build(new FakeTransport(() => json(200, mfaRequired())));
    const result = await client.signIn.withPassword({ email: "a@b.test", password: "pw-good-one" });

    const challenge = challengeIn(result);
    expect(challenge.challengeId).toBe("chl_00000000000000000009");
    expect(challenge.factors).toEqual(["totp", "recovery"]);
    expect(challenge.expiresAt.toISOString()).toBe("2026-09-03T12:05:00.000Z");
  });

  it("finishes through the challenge, and the session is held", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/mfa/verify")
        ? json(200, sessionCreated())
        : json(200, mfaRequired()),
    );
    const client = build(transport);
    const result = await client.signIn.withPassword({ email: "a@b.test", password: "pw-good-one" });
    const challenge = challengeIn(result);

    const session = await challenge.submit({ factor: "totp", code: "123456" });

    expect(session.user.email).toBe("ada@example.test");
    expect(client.state().status).toBe("signed-in");
    expect(transport.bodyOf(transport.to("v1/auth/mfa/verify")[0]!)).toEqual({
      challengeId: "chl_00000000000000000009",
      factor: "totp",
      code: "123456",
    });
  });

  /**
   * The device name travels on the call that creates the session, which with MFA on is the
   * submission rather than the sign-in. A name only on the first request would leave every
   * MFA user's device list a column of blanks.
   */
  it("names the device on the call that actually creates the session", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/mfa/verify")
        ? json(200, sessionCreated())
        : json(200, mfaRequired()),
    );
    const client = build(transport, "Ada's laptop");
    const result = await client.signIn.withPassword({ email: "a@b.test", password: "pw-good-one" });
    const challenge = challengeIn(result);
    await challenge.submit({ factor: "totp", code: "123456" });

    const submitted = transport.to("v1/auth/mfa/verify")[0];
    expect(submitted?.headers[IdenzyHeader.DeviceName]).toBe(encodeURIComponent("Ada's laptop"));
  });
});

describe("enrolling from the client", () => {
  it("returns the uri and the secret, and asks with the caller's token", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/mfa/totp")
        ? json(201, {
            factorId: "mfa_00000000000000000001",
            secret: "JBSWY3DPEHPK3PXP",
            uri: "otpauth://totp/Acme:ada%40example.test?secret=JBSWY3DPEHPK3PXP",
          })
        : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    const enrolment = await client.mfa.enrollTotp({ label: "Phone" });

    expect(enrolment.uri.startsWith("otpauth://totp/")).toBe(true);
    expect(transport.to("v1/auth/mfa/totp")[0]?.headers["authorization"]).toBe("Bearer access.one");
  });

  it("hands back the recovery sheet the confirmation issued", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/mfa/totp/confirm")
        ? json(200, {
            factor: {
              id: "mfa_00000000000000000001",
              type: "totp",
              label: "Phone",
              createdAt: "2026-09-03T12:00:00.000Z",
              lastUsedAt: null,
            },
            recoveryCodes: {
              codes: ["ABCDE-FGHJK-MNPQR-STVWX"],
              generatedAt: "2026-09-03T12:00:00.000Z",
            },
          })
        : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    const confirmed = await client.mfa.confirmTotp({
      factorId: "mfa_00000000000000000001",
      code: "123456",
    });

    expect(confirmed.recoveryCodes?.codes).toEqual(["ABCDE-FGHJK-MNPQR-STVWX"]);
  });
});

describe("stepping up inside a session", () => {
  /** 204 is the honest answer for a user with nothing to be asked for, and it is not an error. */
  it("answers null when there is no factor to ask for", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/auth/mfa/step-up")
        ? { status: 204, body: "" }
        : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    expect(await client.mfa.startStepUp()).toBeNull();
  });

  it("swaps the access token without rotating the refresh token", async () => {
    const transport = new FakeTransport((request) => {
      if (request.url.endsWith("v1/auth/mfa/step-up/verify")) {
        return json(200, {
          accessToken: "access.stepped-up",
          accessTokenExpiresAt: "2026-09-03T12:30:00.000Z",
          factorVerifiedAt: "2026-09-03T12:00:00.000Z",
        });
      }
      if (request.url.endsWith("v1/auth/mfa/step-up")) {
        return json(200, {
          challengeId: "chl_00000000000000000010",
          purpose: "step_up",
          factors: ["totp"],
          expiresAt: "2026-09-03T12:05:00.000Z",
        });
      }
      return json(200, sessionCreated());
    });
    const client = build(transport);
    await client.signIn.anonymously();

    const challenge = required(await client.mfa.startStepUp());
    await challenge.submit({ factor: "totp", code: "123456" });

    expect(await client.getToken()).toBe("access.stepped-up");
    expect(client.session?.user).toEqual(user());
    // No rotation happened, so the refresh route was never called.
    expect(transport.to("v1/auth/refresh")).toHaveLength(0);
  });
});
