import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { IdenzyCookie, IdenzyHeader, SessionTransport } from "@idenzy/protocol/http/headers";
import { publicUserSchema } from "@idenzy/protocol/schemas/user";
import { describe, expect, it } from "vitest";
import { IdenzyConfig } from "../src/config.js";
import { IdenzyApiError, IdenzyTransportError } from "../src/errors.js";
import { ApiClient } from "../src/http/api-client.js";
import type { CookieJar } from "../src/http/cookie-jar.js";
import { errorBody, FakeTransport, json, user } from "./fixtures.js";

class StubJar implements CookieJar {
  constructor(private readonly values: Record<string, string> = {}) {}

  read(name: string): string | undefined {
    return this.values[name];
  }
}

function clientFor(
  transport: FakeTransport,
  sessionTransport: SessionTransport = SessionTransport.Header,
  jar: CookieJar = new StubJar(),
): ApiClient {
  const config = IdenzyConfig.parse({
    publishableKey: "pk_test_abc",
    apiUrl: "https://auth.acme.test",
    sessionTransport,
  });
  return new ApiClient(config, transport, jar);
}

describe("ApiClient", () => {
  it("names the project on every request, including one that carries a token", async () => {
    const transport = new FakeTransport(() => json(200, user()));
    await clientFor(transport).send(publicUserSchema, {
      method: "GET",
      path: "v1/users/me",
      accessToken: "access.one",
    });

    const [request] = transport.requests;
    expect(request?.headers[IdenzyHeader.PublishableKey]).toBe("pk_test_abc");
    expect(request?.headers["authorization"]).toBe("Bearer access.one");
  });

  it("keeps cookies off a header-mode request, which is what keeps the modes apart", async () => {
    const transport = new FakeTransport(() => json(200, user()));
    await clientFor(transport).send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    expect(transport.requests[0]?.withCredentials).toBe(false);
    expect(transport.requests[0]?.headers[IdenzyHeader.SessionTransport]).toBe(
      SessionTransport.Header,
    );
  });

  it("echoes the csrf cookie in cookie mode, on the methods that change something", async () => {
    const transport = new FakeTransport(() => json(200, user()));
    const jar = new StubJar({ [IdenzyCookie.Csrf]: "csrf-value" });
    const client = clientFor(transport, SessionTransport.Cookie, jar);

    await client.send(publicUserSchema, { method: "POST", path: "v1/users/me", body: {} });
    await client.send(publicUserSchema, { method: "GET", path: "v1/users/me" });

    expect(transport.requests[0]?.headers[IdenzyHeader.Csrf]).toBe("csrf-value");
    expect(transport.requests[0]?.withCredentials).toBe(true);
    expect(transport.requests[1]?.headers[IdenzyHeader.Csrf]).toBeUndefined();
  });

  it("turns the error contract into the code a customer branches on", async () => {
    const transport = new FakeTransport(() => json(401, errorBody(ErrorCode.InvalidCredentials)));
    const attempt = clientFor(transport).send(publicUserSchema, {
      method: "POST",
      path: "v1/auth/sign-in/password",
      body: {},
    });

    await expect(attempt).rejects.toBeInstanceOf(IdenzyApiError);
    await expect(attempt).rejects.toMatchObject({
      code: ErrorCode.InvalidCredentials,
      status: 401,
      requestId: "req_test",
    });
  });

  it("never invents a code for something that is not our error contract", async () => {
    const transport = new FakeTransport(() => ({ status: 502, body: "<html>gateway</html>" }));
    const attempt = clientFor(transport).send(publicUserSchema, {
      method: "GET",
      path: "v1/users/me",
    });

    await expect(attempt).rejects.toBeInstanceOf(IdenzyTransportError);
    await expect(attempt).rejects.toMatchObject({ status: 502 });
  });

  it("refuses an answer that is not the shape the endpoint promises", async () => {
    const transport = new FakeTransport(() => json(200, { hello: "world" }));
    const attempt = clientFor(transport).send(publicUserSchema, {
      method: "GET",
      path: "v1/users/me",
    });

    await expect(attempt).rejects.toBeInstanceOf(IdenzyTransportError);
  });
});
