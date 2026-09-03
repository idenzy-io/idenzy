import { Idenzy } from "@idenzy/js";
import type { ApiRequest, ApiResponse, Transport } from "@idenzy/js/http/transport";
import type { PublicUser } from "@idenzy/protocol/schemas/user";
import type { ReactNode } from "react";
import { IdenzyProvider } from "../src/idenzy-react.js";

/**
 * Records every request and answers from a handler.
 *
 * The whole SDK is built through constructors, so this is the only substitution these tests
 * need: no network, no module mocking, no service worker.
 */
export class FakeTransport implements Transport {
  readonly requests: ApiRequest[] = [];

  constructor(private readonly handler: (request: ApiRequest) => ApiResponse) {}

  send(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    return Promise.resolve(this.handler(request));
  }

  to(path: string): ApiRequest[] {
    return this.requests.filter((request) => request.url.endsWith(path));
  }
}

export function client(transport: Transport): Idenzy {
  return new Idenzy(
    { publishableKey: "pk_test_abc", apiUrl: "https://auth.acme.test" },
    { transport },
  );
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body: JSON.stringify(body) };
}

export function refused(): ApiResponse {
  return json(401, {
    error: { code: "invalid_credentials", message: "no", requestId: "req_test" },
  });
}

export function user(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: "usr_00000000000000000001",
    email: "ada@example.test",
    emailVerified: true,
    phone: null,
    phoneVerified: false,
    displayName: "Ada",
    avatarUrl: null,
    metadataPublic: {},
    createdAt: "2026-09-01T00:00:00.000Z",
    lastSignInAt: null,
    ...overrides,
  };
}

export function sessionCreated(): unknown {
  return {
    status: "authenticated",
    user: user(),
    sessionId: "ses_00000000000000000002",
    accessToken: "access.new",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.new",
  };
}

export function sessionRefreshed(): unknown {
  return {
    sessionId: "ses_00000000000000000001",
    accessToken: "access.one",
    accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
    refreshToken: "refresh.one",
    user: user(),
  };
}

export function wrapperFor(instance: Idenzy, restore = true) {
  return function Wrapper({ children }: { readonly children: ReactNode }): ReactNode {
    return (
      <IdenzyProvider client={instance} restore={restore}>
        {children}
      </IdenzyProvider>
    );
  };
}
