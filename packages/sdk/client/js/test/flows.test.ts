import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { IdenzyHeader } from "@idenzy/protocol/http/headers";
import { describe, expect, it } from "vitest";
import { Idenzy } from "../src/idenzy.js";
import { errorBody, FakeTransport, FixedClock, json, sessionCreated } from "./fixtures.js";

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

describe("every flow that ends in a session", () => {
  /**
   * The property the base class exists for. A flow that returned the body without adopting
   * would look like it worked and leave the client signed out, which nobody notices until a
   * later screen asks for a token.
   */
  it.each([
    [
      "password",
      (client: Idenzy) =>
        client.signIn.withPassword({ email: "a@b.test", password: "correct-horse" }),
    ],
    ["otp", (client: Idenzy) => client.signIn.verifyOtp({ code: "123456", challengeId: "chl_1" })],
    ["magic link", (client: Idenzy) => client.magicLink.exchange("abcdefghijklmnopqrst")],
    ["anonymous", (client: Idenzy) => client.signIn.anonymously()],
  ])("holds the session %s created", async (_name, run) => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const client = build(transport);

    await run(client);

    expect(client.state().status).toBe("signed-in");
    expect(await client.getToken()).toBe("access.one");
  });
});

describe("one-time codes", () => {
  it("remembers the challenge, so the second call carries only the code", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("start")
        ? json(202, {
            challengeId: "chl_00000000000000000001",
            expiresAt: "2026-09-03T12:10:00.000Z",
          })
        : json(200, sessionCreated()),
    );
    const client = build(transport);

    await client.signIn.withEmailOtp({ email: "ada@example.test" });
    await client.signIn.verifyOtp({ code: "123456" });

    expect(transport.bodyOf(transport.to("v1/auth/otp/verify")[0]!)).toEqual({
      challengeId: "chl_00000000000000000001",
      code: "123456",
    });
  });

  it("refuses to guess a challenge nobody started", () => {
    const client = build(new FakeTransport(() => json(200, sessionCreated())));

    expect(() => client.signIn.verifyOtp({ code: "123456" })).toThrowError(/start first/);
  });

  it("names the email channel, which is the only one this phase answers", async () => {
    const transport = new FakeTransport(() =>
      json(202, { challengeId: "chl_00000000000000000001", expiresAt: "2026-09-03T12:10:00.000Z" }),
    );
    const client = build(transport);

    await client.signIn.withEmailOtp({ email: "ada@example.test" });

    expect(transport.bodyOf(transport.to("v1/auth/otp/start")[0]!)).toEqual({
      channel: "email",
      email: "ada@example.test",
    });
  });
});

describe("acting on an account", () => {
  /**
   * A fresh client asks once, because in cookie mode there may be a credential it cannot see,
   * and takes the answer. What it must not do is present a token it does not have.
   */
  it("refuses like the server would when nobody is signed in", async () => {
    const transport = new FakeTransport(() => json(401, errorBody(ErrorCode.MissingCredentials)));
    const client = build(transport);

    await expect(client.account.me()).rejects.toMatchObject({
      code: ErrorCode.MissingCredentials,
    });
    expect(transport.to("v1/users/me")).toHaveLength(0);
  });

  it("stops asking the server once it knows nobody is signed in", async () => {
    const transport = new FakeTransport(() => json(401, errorBody(ErrorCode.MissingCredentials)));
    const client = build(transport);

    await expect(client.account.me()).rejects.toMatchObject({ code: ErrorCode.MissingCredentials });
    await expect(client.account.me()).rejects.toMatchObject({ code: ErrorCode.MissingCredentials });

    expect(transport.to("v1/auth/refresh")).toHaveLength(1);
  });

  it("carries the token on the routes that need one", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/users/me")
        ? json(200, sessionCreated().user)
        : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    await client.account.me();

    expect(transport.to("v1/users/me")[0]?.headers["authorization"]).toBe("Bearer access.one");
  });

  it("signs this client out when it revokes the session it is using", async () => {
    const transport = new FakeTransport((request) =>
      request.method === "DELETE" ? { status: 204, body: "" } : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    await client.sessions.revoke("ses_00000000000000000001");

    expect(client.state().status).toBe("signed-out");
  });

  it("leaves this client alone when it revokes a different session", async () => {
    const transport = new FakeTransport((request) =>
      request.method === "DELETE" ? { status: 204, body: "" } : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    await client.sessions.revoke("ses_00000000000000000002");

    expect(client.state().status).toBe("signed-in");
  });

  it("does not report an error body as a signed-in error code it never sent", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/users/me")
        ? json(403, errorBody(ErrorCode.ReauthenticationRequired))
        : json(200, sessionCreated()),
    );
    const client = build(transport);
    await client.signIn.anonymously();

    await expect(client.account.me()).rejects.toMatchObject({
      code: ErrorCode.ReauthenticationRequired,
      status: 403,
    });
  });
});

/**
 * The name is display text for a "your devices" screen, and it travels only on the request
 * that writes a session row.
 */
describe("naming the device", () => {
  it("sends the name percent-encoded, because a header cannot carry the raw text", async () => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const client = build(transport, "Hasan'ın MacBook'u");

    await client.signIn.anonymously();

    expect(transport.requests[0]?.headers[IdenzyHeader.DeviceName]).toBe(
      encodeURIComponent("Hasan'ın MacBook'u"),
    );
  });

  it("leaves it off every request that does not create a session", async () => {
    const transport = new FakeTransport((request) =>
      request.url.endsWith("v1/sessions")
        ? json(200, { sessions: [] })
        : json(200, sessionCreated()),
    );
    const client = build(transport, "Ada's laptop");
    await client.signIn.anonymously();

    await client.sessions.list();

    expect(transport.to("v1/sessions")[0]?.headers[IdenzyHeader.DeviceName]).toBeUndefined();
  });

  it("sends nothing at all when the customer named no device", async () => {
    const transport = new FakeTransport(() => json(200, sessionCreated()));
    const client = build(transport);

    await client.signIn.anonymously();

    expect(transport.requests[0]?.headers[IdenzyHeader.DeviceName]).toBeUndefined();
  });
});
