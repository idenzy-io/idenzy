import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { IdenzyHeader, SessionTransport } from "@idenzy/protocol/http/headers";
import { publicUserSchema } from "@idenzy/protocol/schemas/user";
import { describe, expect, it } from "vitest";
import { IdenzyConfig, type IdenzyOptions } from "../src/config.js";
import { ApiClient } from "../src/http/api-client.js";
import { type SessionTransportPreference, TransportMode } from "../src/http/transport-mode.js";
import { errorBody, FakeTransport, json, user } from "./fixtures.js";

const OPTIONS: IdenzyOptions = {
  publishableKey: "pk_test_abc",
  apiUrl: "https://api.idenzy.test",
};

function clientFor(transport: FakeTransport, preference?: SessionTransportPreference) {
  const config = IdenzyConfig.parse(
    preference === undefined ? OPTIONS : { ...OPTIONS, sessionTransport: preference },
  );
  const notices: string[] = [];
  const mode = new TransportMode(config.sessionTransport, (message) => notices.push(message));
  return { client: new ApiClient(config, transport, mode), mode, notices };
}

/** The shared API host's answer: cookie mode cannot work here, and it says so plainly. */
function refusesCookies(transport: FakeTransport): void {
  transport.answerWith((request) =>
    request.headers[IdenzyHeader.SessionTransport] === SessionTransport.Cookie
      ? json(400, errorBody(ErrorCode.SessionTransportUnavailable))
      : json(200, user()),
  );
}

describe("choosing a transport", () => {
  it("asks for cookie mode first, because the client cannot tell from its own url", async () => {
    const transport = new FakeTransport(() => json(200, user()));
    const { client, mode } = clientFor(transport);

    await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    expect(transport.requests[0]?.headers[IdenzyHeader.SessionTransport]).toBe(
      SessionTransport.Cookie,
    );
    expect(mode.usesCookies).toBe(true);
    expect(transport.requests).toHaveLength(1);
  });

  it("steps down once and retries, so the refusal costs the caller nothing", async () => {
    const transport = new FakeTransport();
    refusesCookies(transport);
    const { client, mode, notices } = clientFor(transport);

    const profile = await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    expect(profile.id).toBe("usr_00000000000000000001");
    expect(transport.requests.map((r) => r.headers[IdenzyHeader.SessionTransport])).toEqual([
      SessionTransport.Cookie,
      SessionTransport.Header,
    ]);
    expect(mode.usesCookies).toBe(false);
    expect(notices).toHaveLength(1);
  });

  it("steps down once and not once per request", async () => {
    const transport = new FakeTransport();
    refusesCookies(transport);
    const { client, notices } = clientFor(transport);

    await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });
    await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    // Two requests for the first call, one for the second: the answer is remembered.
    expect(transport.requests).toHaveLength(3);
    expect(notices).toHaveLength(1);
  });

  /**
   * An explicit ask gets the plain refusal the server designed. Cookie mode that silently
   * became header mode is a customer believing their tokens are HttpOnly when they are not.
   */
  it("never downgrades a client that named cookie mode itself", async () => {
    const transport = new FakeTransport();
    refusesCookies(transport);
    const { client, mode, notices } = clientFor(transport, SessionTransport.Cookie);

    await expect(
      client.send(publicUserSchema, { method: "GET", path: "v1/users/me" }),
    ).rejects.toMatchObject({ code: ErrorCode.SessionTransportUnavailable });
    expect(mode.usesCookies).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect(notices).toHaveLength(0);
  });

  it("never upgrades a client that named header mode itself", async () => {
    const transport = new FakeTransport(() => json(200, user()));
    const { client } = clientFor(transport, SessionTransport.Header);

    await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    expect(transport.requests[0]?.headers[IdenzyHeader.SessionTransport]).toBe(
      SessionTransport.Header,
    );
    expect(transport.requests[0]?.withCredentials).toBe(false);
  });

  it("retries nothing else, whatever the server refused it for", async () => {
    const transport = new FakeTransport(() => json(429, errorBody(ErrorCode.RateLimited)));
    const { client, mode } = clientFor(transport);

    await expect(
      client.send(publicUserSchema, { method: "GET", path: "v1/users/me" }),
    ).rejects.toMatchObject({ code: ErrorCode.RateLimited });
    expect(transport.requests).toHaveLength(1);
    expect(mode.usesCookies).toBe(true);
  });
});
