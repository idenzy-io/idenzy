import { strict as assert } from "node:assert";
import { HttpClient, type HttpRequest, type HttpResponse } from "@idenzy/core/http/http-client";
import { Clock } from "@idenzy/core/time/clock";
import type {
  NewFlow,
  OAuthFlowStore,
  OAuthProvider,
  ProviderCredentials,
  RedirectAllowlist,
  StoredFlow,
} from "@idenzy/domain/ports/oauth-provider";
import { ConformanceSuite } from "./conformance-suite.js";

const PROJECT = "3f2b9c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";
const CALLBACK = "https://auth.example.test/v1/auth/oauth/callback";
const CUSTOMER_ROUTE = "https://app.example.test/auth/finish";

export interface OAuthProviderDependencies {
  readonly http: HttpClient;
  readonly clock: Clock;
  readonly flows: OAuthFlowStore;
  readonly allowlist: RedirectAllowlist;
}

/** An adapter hands back an instance built from exactly these four collaborators. */
export type OAuthProviderFactory = (deps: OAuthProviderDependencies) => OAuthProvider;

/** Records every outbound call, so a case can assert that none happened. */
class Recording extends HttpClient {
  readonly requests: HttpRequest[] = [];

  protected override exchange(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return Promise.resolve({ status: 200, body: "{}" });
  }
}

class FixedClock extends Clock {
  constructor(private readonly instant: Date) {
    super();
  }
  override now(): Date {
    return this.instant;
  }
}

/** In-memory, and single use by contract exactly as the real store is. */
class MemoryFlows implements OAuthFlowStore {
  private readonly open = new Map<string, StoredFlow>();

  seed(state: string, flow: StoredFlow): void {
    this.open.set(state, flow);
  }

  start(_projectId: string, flow: NewFlow): Promise<string> {
    this.open.set(flow.state, {
      id: flow.state,
      provider: flow.provider,
      codeVerifier: flow.codeVerifier,
      nonce: flow.nonce,
      redirectUri: flow.redirectUri,
      linkUserId: flow.linkUserId,
      clientCodeChallenge: flow.clientCodeChallenge,
      expiresAt: flow.expiresAt,
    });
    return Promise.resolve(flow.state);
  }

  consume(
    _projectId: string,
    _provider: string,
    state: string,
    _at: Date,
  ): Promise<StoredFlow | null> {
    const found = this.open.get(state) ?? null;
    this.open.delete(state);
    return Promise.resolve(found);
  }
}

class Allowlist implements RedirectAllowlist {
  constructor(private readonly allowed: readonly string[]) {}
  isAllowed(_projectId: string, uri: string): Promise<boolean> {
    return Promise.resolve(this.allowed.includes(uri));
  }
}

const CREDENTIALS: ProviderCredentials = {
  clientId: "client-id",
  clientSecret: "client-secret",
  scopes: [],
  config: {},
};

function liveFlow(expiresAt: Date): StoredFlow {
  return {
    id: "flow-1",
    provider: "any",
    codeVerifier: "a".repeat(64),
    nonce: null,
    clientCodeChallenge: null,
    redirectUri: CUSTOMER_ROUTE,
    linkUserId: null,
    expiresAt,
  };
}

/**
 * The suite every OAuth adapter must pass before it can be registered
 * (PROJECT.md 7.4, 4.6).
 *
 * It tests the checks a provider inherits and cannot see, never the provider's own wire
 * format, because the wire format is what a provider is allowed to differ about and the
 * checks are what it is not. Every case here asserts that an attack fails.
 *
 * The strongest ones assert that **no HTTP request happened**. A callback with a forged
 * state that still reached the token endpoint would have handed the provider an
 * attacker-supplied code, and a later refusal does not undo that.
 */
export class OAuthProviderConformanceSuite extends ConformanceSuite<OAuthProviderFactory> {
  override readonly familyName = "OAuthProvider";

  protected override defineCases() {
    const now = new Date("2026-01-01T00:00:00Z");

    const build = (
      subject: OAuthProviderFactory,
      flows: MemoryFlows,
      allowed: readonly string[],
    ): { provider: OAuthProvider; http: Recording } => {
      const http = new Recording();
      const provider = subject({
        http,
        clock: new FixedClock(now),
        flows,
        allowlist: new Allowlist(allowed),
      });
      return { provider, http };
    };

    return [
      {
        name: "puts state and an S256 challenge on every authorization url",
        run: ({ subject }: { subject: OAuthProviderFactory }) => {
          const { provider } = build(subject, new MemoryFlows(), [CUSTOMER_ROUTE]);
          const url = new URL(
            provider.authorizationUrl(CREDENTIALS, {
              state: "state-value",
              nonce: "nonce-value",
              codeChallenge: "challenge-value",
              callbackUri: CALLBACK,
            }),
          );

          assert.equal(url.searchParams.get("state"), "state-value", "state is missing");
          assert.equal(url.searchParams.get("code_challenge"), "challenge-value");
          assert.equal(
            url.searchParams.get("code_challenge_method"),
            "S256",
            "PKCE must be S256; plain is not acceptable",
          );
          assert.equal(url.searchParams.get("response_type"), "code");
          assert.equal(
            url.searchParams.get("redirect_uri"),
            CALLBACK,
            "the provider must be sent our callback, never the customer's route",
          );
          assert.ok(
            !url.searchParams.has("client_secret"),
            "a secret must never appear in a front-channel url",
          );
          return Promise.resolve();
        },
      },
      {
        name: "refuses a state it never issued, without calling the provider",
        run: async ({ subject }: { subject: OAuthProviderFactory }) => {
          const { provider, http } = build(subject, new MemoryFlows(), [CUSTOMER_ROUTE]);
          await assert.rejects(
            () =>
              provider.completeFlow(PROJECT, CREDENTIALS, {
                provider: provider.id,
                state: "forged",
                code: "attacker-code",
                callbackUri: CALLBACK,
              }),
            (error: unknown) => (error as { code?: string }).code === "oauth_state_invalid",
            "a forged callback was accepted",
          );
          assert.equal(
            http.requests.length,
            0,
            "an attacker-supplied code reached the provider before state was checked",
          );
        },
      },
      {
        name: "refuses a replayed state, so one callback cannot be used twice",
        run: async ({ subject }: { subject: OAuthProviderFactory }) => {
          const flows = new MemoryFlows();
          flows.seed("once", liveFlow(new Date(now.getTime() + 600_000)));
          const { provider } = build(subject, flows, [CUSTOMER_ROUTE]);
          const callback = {
            provider: provider.id,
            state: "once",
            code: "code-value",
            callbackUri: CALLBACK,
          };

          // The first attempt fails at the provider, which is fine and expected: the
          // recording client answers `{}` and no adapter can build a grant from that.
          await provider.completeFlow(PROJECT, CREDENTIALS, callback).catch(() => undefined);
          await assert.rejects(
            () => provider.completeFlow(PROJECT, CREDENTIALS, callback),
            (error: unknown) => (error as { code?: string }).code === "oauth_state_invalid",
            "state was consumable twice, so it is not a one-shot CSRF token",
          );
        },
      },
      {
        name: "refuses an expired flow, without calling the provider",
        run: async ({ subject }: { subject: OAuthProviderFactory }) => {
          const flows = new MemoryFlows();
          flows.seed("stale", liveFlow(new Date(now.getTime() - 1000)));
          const { provider, http } = build(subject, flows, [CUSTOMER_ROUTE]);

          await assert.rejects(
            () =>
              provider.completeFlow(PROJECT, CREDENTIALS, {
                provider: provider.id,
                state: "stale",
                code: "code-value",
                callbackUri: CALLBACK,
              }),
            (error: unknown) => (error as { code?: string }).code === "oauth_state_invalid",
            "an expired flow was completed",
          );
          assert.equal(http.requests.length, 0, "an expired flow still called the provider");
        },
      },
      {
        name: "refuses a redirect target that is no longer allowlisted",
        run: async ({ subject }: { subject: OAuthProviderFactory }) => {
          const flows = new MemoryFlows();
          flows.seed("live", liveFlow(new Date(now.getTime() + 600_000)));
          // Empty allowlist: the target was registered when the flow started and removed
          // before the callback arrived, which must stop working immediately.
          const { provider, http } = build(subject, flows, []);

          await assert.rejects(
            () =>
              provider.completeFlow(PROJECT, CREDENTIALS, {
                provider: provider.id,
                state: "live",
                code: "code-value",
                callbackUri: CALLBACK,
              }),
            (error: unknown) => (error as { code?: string }).code === "redirect_uri_not_allowed",
            "the allowlist was not re-checked at the callback",
          );
          assert.equal(
            http.requests.length,
            0,
            "the code was exchanged before the redirect target was checked",
          );
        },
      },
    ];
  }
}
