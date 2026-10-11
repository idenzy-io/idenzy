import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { describe, expect, it } from "vitest";
import { IdenzyAdmin, IdenzyAdminError } from "../src/admin.js";

interface Sent {
  readonly url: string;
  readonly method: string | undefined;
  readonly authorization: string | null;
}

function answering(status: number, body = ""): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    sent.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    return Promise.resolve(new Response(status === 204 ? null : body, { status }));
  };
  return { fetch: fake as typeof fetch, sent };
}

describe("deleting a user", () => {
  it("sends the secret key to the user's own route and reports the erasure", async () => {
    const { fetch, sent } = answering(204);
    const admin = new IdenzyAdmin({ baseUrl: "https://auth.acme.test/", secretKey: "sk_x", fetch });

    expect(await admin.users.delete("usr_8f14e45fceea167a5a36dedd4bea2543")).toBe("deleted");
    expect(sent).toEqual([
      {
        url: "https://auth.acme.test/v1/users/usr_8f14e45fceea167a5a36dedd4bea2543",
        method: "DELETE",
        authorization: "Bearer sk_x",
      },
    ]);
  });

  it("reads not-found as an answer, so a retry after a lost response is done", async () => {
    const { fetch } = answering(404, "{}");
    const admin = new IdenzyAdmin({ baseUrl: "https://auth.acme.test", secretKey: "sk_x", fetch });
    expect(await admin.users.delete("usr_gone")).toBe("not_found");
  });

  it("throws the API's own refusal with its code and request id", async () => {
    const body = JSON.stringify({
      error: {
        code: ErrorCode.InsufficientScope,
        message: "This needs a secret key.",
        requestId: "req_1",
      },
    });
    const { fetch } = answering(403, body);
    const admin = new IdenzyAdmin({ baseUrl: "https://auth.acme.test", secretKey: "pk_x", fetch });

    const refused = await admin.users.delete("usr_x").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(IdenzyAdminError);
    expect(refused).toMatchObject({
      code: ErrorCode.InsufficientScope,
      status: 403,
      requestId: "req_1",
    });
  });
});
