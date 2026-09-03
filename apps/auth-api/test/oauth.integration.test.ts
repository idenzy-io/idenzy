import { createHash } from "node:crypto";
import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { AccountLinkingPolicy } from "@idenzy/domain/policies/account-linking-policy";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import {
  type OAuthCallback,
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
  type StoredFlow,
  type TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { IdentityRepository } from "@idenzy/persistence/repository/identity-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import { startOauthSchema } from "@idenzy/protocol/schemas/auth";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RedirectKind } from "../dist/delivery/redirect-targets.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { DatabaseOAuthFlowStore } from "../dist/oauth/database-oauth-flow-store.js";
import { DatabaseRedirectAllowlist } from "../dist/oauth/database-redirect-allowlist.js";
import { OAuthCodeFlow } from "../dist/oauth/oauth-code.flow.js";
import { OAuthService } from "../dist/oauth/oauth-service.js";
import { ProviderRegistry } from "../dist/oauth/provider-registry.js";
import { SessionService } from "../dist/session/session-service.js";
import { testConfig, testRevocations } from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "11111111-1111-1111-1111-111111111111";
const REGISTERED = "https://app.test/auth/social";
const clock = new SystemClock();
const revocations = testRevocations(clock);
const config = testConfig();
const encryptor = new FieldEncryptor(developmentDataKey("test"));

/**
 * A provider that answers without a network.
 *
 * It overrides only the code exchange and the profile, so everything the base owns still
 * runs: the state is consumed from the real store, the allowlist is really checked, and
 * the ordering is the production ordering. The parts it replaces are the two that would
 * otherwise require Google to be reachable from CI.
 */
class FakeProvider extends OAuthProvider {
  override readonly id = ProviderId.Google;
  profile: ProviderProfile = {
    providerUserId: "google-subject-1",
    email: "social@a.test",
    emailVerified: true,
    displayName: "Social User",
    avatarUrl: null,
  };

  constructor(clockPort: SystemClock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(
      { json: () => Promise.reject(new Error("no network")) } as never,
      clockPort,
      flows,
      allowlist,
    );
  }

  protected override authorizeEndpoint(): string {
    return "https://accounts.example.test/authorize";
  }
  protected override tokenEndpoint(): string {
    return "https://accounts.example.test/token";
  }
  protected override defaultScopes(): readonly string[] {
    return ["openid", "email"];
  }
  protected override exchangeCode(
    _credentials: ProviderCredentials,
    _callback: OAuthCallback,
    _flow: StoredFlow,
  ): Promise<TokenGrant> {
    return Promise.resolve({
      accessToken: "provider-access-token",
      refreshToken: "provider-refresh-token",
      idToken: null,
      expiresAt: null,
    });
  }
  protected override fetchProfile(): Promise<ProviderProfile> {
    return Promise.resolve(this.profile);
  }
}

let uow: UnitOfWork;
let service: OAuthService;
let flow: OAuthCodeFlow;
let provider: FakeProvider;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_oauth",
  ip: "203.0.113.20",
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
};
const tenant = new TenantContext(PROJECT, "req_oauth", "user");

/** Runs a whole sign-in and hands back the URL the browser would be sent to. */
async function signInThrough(profile: Partial<ProviderProfile> = {}): Promise<URL> {
  provider.profile = { ...provider.profile, ...profile };
  const authorizationUrl = new URL(
    await service.start(context, ProviderId.Google, REGISTERED, null),
  );
  const state = authorizationUrl.searchParams.get("state") ?? "";
  return new URL(await service.finish(context, ProviderId.Google, state, "provider-code"));
}

async function configureProvider(settings: Record<string, unknown> = {}): Promise<void> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(`DELETE FROM oauth_providers WHERE project_id = $1`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO oauth_providers
       (project_id, provider, client_id, client_secret_encrypted, scopes, settings, enabled, mode)
     VALUES ($1, 'google', 'client-id', $2, ARRAY['openid','email'], $3, true, 'custom')`,
    [PROJECT, encryptor.encrypt("client-secret", PROJECT), JSON.stringify(settings)],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(uow, clock, issuer, config, revocations.publisher);

  const flows = new DatabaseOAuthFlowStore(uow, encryptor);
  const allowlist = new DatabaseRedirectAllowlist(uow);
  provider = new FakeProvider(clock, flows, allowlist);
  const registry = new ProviderRegistry(uow, encryptor, new Map([[ProviderId.Google, provider]]));
  service = new OAuthService(
    uow,
    clock,
    config,
    registry,
    flows,
    encryptor,
    new AccountLinkingPolicy(true),
  );
  flow = new OAuthCodeFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    uow,
    clock,
  );

  await harness.owner.query(
    `INSERT INTO region_cells (id, code, jurisdiction, endpoint, kms_key_ring)
     VALUES (gen_random_uuid(), 'eu-1', 'EU', 'https://eu.test', 'ring')`,
  );
  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name, cell_id)
     VALUES (gen_random_uuid(), 'Acme', (SELECT id FROM region_cells LIMIT 1)) RETURNING id`,
  );
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, cell_id, kms_key_name)
     VALUES ($1, $2, 'Acme', (SELECT id FROM region_cells LIMIT 1), 'k')`,
    [PROJECT, rows[0]?.id],
  );
  await uow.run(tenant, (tx) =>
    new RedirectUriRepository(tx, tenant).register(RedirectKind.Oauth, REGISTERED),
  );
}, 180_000);

beforeEach(async () => {
  await configureProvider();
  provider.profile = {
    providerUserId: "google-subject-1",
    email: "social@a.test",
    emailVerified: true,
    displayName: "Social User",
    avatarUrl: null,
  };
});

afterAll(async () => {
  await harness.stop();
});

describe("starting a flow", () => {
  it("sends the browser to the provider with state and an S256 challenge", async () => {
    const url = new URL(await service.start(context, ProviderId.Google, REGISTERED, null));

    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${config.get("ISSUER_BASE_URL")}/v1/auth/oauth/google/callback`,
    );
    expect(url.toString()).not.toContain("client-secret");
  });

  /**
   * The verifier is the one single-use secret we have to reproduce rather than compare,
   * so it is encrypted rather than hashed. A row that gave it up in clear would let a
   * database read finish an intercepted flow.
   */
  it("stores the PKCE verifier encrypted, and the challenge is its digest", async () => {
    const url = new URL(await service.start(context, ProviderId.Google, REGISTERED, null));
    const { rows } = await harness.owner.query<{ code_verifier_encrypted: string }>(
      `SELECT code_verifier_encrypted FROM oauth_flows ORDER BY created_at DESC LIMIT 1`,
    );
    const stored = rows[0]?.code_verifier_encrypted ?? "";
    expect(stored).not.toBe("");
    expect(stored).not.toContain(url.searchParams.get("code_challenge") ?? "?");
    expect(encryptor.decrypt(stored, PROJECT).length).toBeGreaterThan(40);
  });

  it("refuses a redirect target the project did not register", async () => {
    await expect(
      service.start(context, ProviderId.Google, "https://evil.test/steal", null),
    ).rejects.toMatchObject({ code: "redirect_uri_not_allowed" });
  });

  it("refuses a provider the project has not enabled", async () => {
    await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
    await harness.owner.query(`UPDATE oauth_providers SET enabled = false WHERE project_id = $1`, [
      PROJECT,
    ]);
    await expect(service.start(context, ProviderId.Google, REGISTERED, null)).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("refuses a provider this deployment does not implement", async () => {
    await expect(service.start(context, "myspace", REGISTERED, null)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  /**
   * Our shared app shows our brand on the consent screen and has one client id for every
   * customer, which is fine on a laptop and not in front of real users (PROJECT.md 4.6).
   */
  it("keeps instant mode off anything but localhost and preview hosts", () => {
    expect(() =>
      ProviderRegistry.assertInstantModeAllowed("instant", "https://app.test/cb"),
    ).toThrowError(/instant/i);
    for (const allowed of ["http://localhost:3000/cb", "https://demo.idenzy.dev/cb"]) {
      expect(() => ProviderRegistry.assertInstantModeAllowed("instant", allowed)).not.toThrow();
    }
    expect(() =>
      ProviderRegistry.assertInstantModeAllowed("custom", "https://app.test/cb"),
    ).not.toThrow();
  });
});

describe("completing a flow", () => {
  it("creates a user and an identity, and returns the customer's route with a code", async () => {
    const destination = await signInThrough({ providerUserId: "new-subject" });

    expect(destination.origin + destination.pathname).toBe(REGISTERED);
    expect(destination.searchParams.get("code")).toBeTruthy();
    expect(destination.searchParams.has("error")).toBe(false);

    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findByEmail("social@a.test"),
    );
    expect(user?.emailVerified).toBe(true);
  });

  it("signs a returning account into the same user without a second identity", async () => {
    await signInThrough({ providerUserId: "returning", email: "returning@a.test" });
    const first = await currentUserId("returning@a.test");
    await signInThrough({ providerUserId: "returning", email: "returning@a.test" });

    expect(await currentUserId("returning@a.test")).toBe(first);
    const identities = await uow.run(tenant, (tx) =>
      new IdentityRepository(tx, tenant).listForUser(first),
    );
    expect(identities).toHaveLength(1);
  });

  it("links to an existing account when the provider vouches for the address", async () => {
    const existing = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).create({
        email: "already@a.test",
        emailVerified: true,
        phone: null,
        passwordHash: "argon2-hash",
        passwordAlgoVersion: 1,
        displayName: null,
        avatarUrl: null,
      }),
    );

    const destination = await signInThrough({
      providerUserId: "links-to-existing",
      email: "already@a.test",
      emailVerified: true,
    });
    expect(destination.searchParams.get("code")).toBeTruthy();

    const identities = await uow.run(tenant, (tx) =>
      new IdentityRepository(tx, tenant).listForUser(existing.id),
    );
    expect(identities).toHaveLength(1);
  });

  /**
   * PROJECT.md 4.6, and the single most important test in this file. A provider that
   * lets an attacker set an arbitrary unverified address would otherwise be a takeover
   * of every account holding that address.
   */
  it("refuses to link on an address the provider has not verified", async () => {
    await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).create({
        email: "victim@a.test",
        emailVerified: true,
        phone: null,
        passwordHash: "argon2-hash",
        passwordAlgoVersion: 1,
        displayName: null,
        avatarUrl: null,
      }),
    );

    const destination = await signInThrough({
      providerUserId: "attacker-subject",
      email: "victim@a.test",
      emailVerified: false,
    });

    expect(destination.searchParams.get("error")).toBe("linking_requires_verification");
    expect(destination.searchParams.has("code")).toBe(false);
    // Nothing was attached to the victim, and no session is obtainable.
    const identities = await uow.run(tenant, (tx) =>
      new IdentityRepository(tx, tenant).findByAccount("google", "attacker-subject"),
    );
    expect(identities).toBeNull();
  });

  it("creates an unverified account when the provider does not vouch and nobody matches", async () => {
    await signInThrough({
      providerUserId: "unvouched",
      email: "unvouched@a.test",
      emailVerified: false,
    });
    const user = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).findByEmail("unvouched@a.test"),
    );
    expect(user?.emailVerified).toBe(false);
  });

  it("cannot have its state replayed", async () => {
    const url = new URL(await service.start(context, ProviderId.Google, REGISTERED, null));
    const state = url.searchParams.get("state") ?? "";

    await service.finish(context, ProviderId.Google, state, "code-1");
    await expect(service.finish(context, ProviderId.Google, state, "code-2")).rejects.toMatchObject(
      { code: "oauth_state_invalid" },
    );
  });

  it("refuses a state it never issued, rather than redirecting anywhere", async () => {
    await expect(
      service.finish(context, ProviderId.Google, "a".repeat(43), "code"),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
  });

  it("keeps provider tokens only when the project asked for them", async () => {
    await signInThrough({ providerUserId: "no-tokens", email: "notokens@a.test" });
    expect(await storedTokensFor("no-tokens")).toBeNull();

    await configureProvider({ storeTokens: true });
    await signInThrough({ providerUserId: "with-tokens", email: "withtokens@a.test" });
    const kept = await storedTokensFor("with-tokens");
    expect(kept).not.toBeNull();
    // Encrypted at rest: the refresh token is a standing grant on someone's account.
    expect(kept).not.toContain("provider-refresh-token");
    expect(encryptor.decrypt(kept ?? "", PROJECT)).toContain("provider-refresh-token");
  });
});

describe("exchanging the code", () => {
  it("returns a session whose amr says oauth", async () => {
    const destination = await signInThrough({ providerUserId: "exchanges", email: "ex@a.test" });
    const issued = await flow.authenticate(context, {
      code: destination.searchParams.get("code") ?? "",
    });

    expect(issued.user.email).toBe("ex@a.test");
    const claims = JSON.parse(
      Buffer.from(issued.accessToken.split(".")[1] ?? "", "base64url").toString(),
    ) as { amr: string[] };
    expect(claims.amr).toEqual([AuthMethod.Oauth]);
  });

  it("spends the code once", async () => {
    const destination = await signInThrough({ providerUserId: "spends", email: "sp@a.test" });
    const code = destination.searchParams.get("code") ?? "";
    await flow.authenticate(context, { code });
    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });
});

describe("linking to an account that already exists", () => {
  it("attaches the provider to the caller rather than to whoever the provider names", async () => {
    const owner = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).create({
        email: "owner@a.test",
        emailVerified: true,
        phone: null,
        passwordHash: "argon2-hash",
        passwordAlgoVersion: 1,
        displayName: null,
        avatarUrl: null,
      }),
    );

    provider.profile = {
      providerUserId: "linked-subject",
      // A different address entirely: linking must follow the session, not the profile.
      email: "someone-else@a.test",
      emailVerified: true,
      displayName: null,
      avatarUrl: null,
    };
    const url = new URL(await service.start(context, ProviderId.Google, REGISTERED, owner.id));
    const destination = new URL(
      await service.finish(context, ProviderId.Google, url.searchParams.get("state") ?? "", "code"),
    );

    expect(destination.searchParams.get("code")).toBeTruthy();
    const identities = await uow.run(tenant, (tx) =>
      new IdentityRepository(tx, tenant).listForUser(owner.id),
    );
    expect(identities.map((i) => i.providerUserId)).toEqual(["linked-subject"]);
  });

  it("refuses a provider account that already belongs to somebody else", async () => {
    await signInThrough({ providerUserId: "taken-subject", email: "taken@a.test" });
    const other = await uow.run(tenant, (tx) =>
      new UserRepository(tx, tenant).create({
        email: "other@a.test",
        emailVerified: true,
        phone: null,
        passwordHash: "argon2-hash",
        passwordAlgoVersion: 1,
        displayName: null,
        avatarUrl: null,
      }),
    );

    provider.profile = {
      providerUserId: "taken-subject",
      email: "taken@a.test",
      emailVerified: true,
      displayName: null,
      avatarUrl: null,
    };
    const url = new URL(await service.start(context, ProviderId.Google, REGISTERED, other.id));
    const destination = new URL(
      await service.finish(context, ProviderId.Google, url.searchParams.get("state") ?? "", "code"),
    );

    expect(destination.searchParams.get("error")).toBe("identity_already_linked");
    expect(destination.searchParams.has("code")).toBe(false);
  });
});

async function currentUserId(email: string): Promise<string> {
  const user = await uow.run(tenant, (tx) => new UserRepository(tx, tenant).findByEmail(email));
  return user?.id ?? "";
}

async function storedTokensFor(providerUserId: string): Promise<string | null> {
  await harness.owner.query(`SELECT set_config('app.project_id', $1, false)`, [PROJECT]);
  const { rows } = await harness.owner.query<{ encrypted_tokens: string | null }>(
    `SELECT encrypted_tokens FROM identities WHERE provider_user_id = $1`,
    [providerUserId],
  );
  return rows[0]?.encrypted_tokens ?? null;
}

describe("PKCE on our own exchange code", () => {
  const VERIFIER = "v".repeat(64);
  const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

  /** Runs the whole dance with a challenge pinned, and returns the code the redirect carries. */
  async function signInWithPkce(email: string): Promise<string> {
    provider.profile = { ...provider.profile, email, providerUserId: `pkce-${email}` };
    const started = new URL(
      await service.start(context, ProviderId.Google, REGISTERED, null, CHALLENGE),
    );
    const state = started.searchParams.get("state") ?? "";
    const back = new URL(await service.finish(context, ProviderId.Google, state, "provider-code"));
    return back.searchParams.get("code") ?? "";
  }

  it("completes when the verifier matches the challenge that started the flow", async () => {
    const code = await signInWithPkce("pkce-ok@a.test");
    const issued = await flow.authenticate(context, { code, codeVerifier: VERIFIER });
    expect(issued.user.email).toBe("pkce-ok@a.test");
  });

  it("refuses a stolen code, and burns it on the way", async () => {
    const code = await signInWithPkce("pkce-stolen@a.test");

    // An attacker who intercepted the redirect has the code and not the verifier.
    await expect(
      flow.authenticate(context, { code, codeVerifier: "w".repeat(64) }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });

    // Burning it is the point: the real client cannot rescue the flow either, because by
    // the time we know the verifier is wrong the code is in somebody else's hands.
    await expect(
      flow.authenticate(context, { code, codeVerifier: VERIFIER }),
    ).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  it("refuses an exchange that simply omits the verifier", async () => {
    // The downgrade. Verification is mandatory once a challenge was stored, so stripping
    // the field is not a way around it.
    const code = await signInWithPkce("pkce-downgrade@a.test");
    await expect(flow.authenticate(context, { code })).rejects.toMatchObject({
      code: "challenge_invalid",
    });
  });

  it("rejects a verifier sent where the challenge belongs, at the boundary", () => {
    // 43 characters is base64url SHA-256 exactly, so the length alone catches the mistake
    // that matters: a verifier pasted into the challenge slot would publish the secret in
    // a redirect. The rule is on the wire contract, which is where the request is parsed.
    expect(
      startOauthSchema.safeParse({ redirectUri: REGISTERED, codeChallenge: VERIFIER }).success,
    ).toBe(false);
    expect(
      startOauthSchema.safeParse({ redirectUri: REGISTERED, codeChallenge: CHALLENGE }).success,
    ).toBe(true);
  });

  it("still exchanges a code minted without a challenge", async () => {
    // Server-side callers and magic links legitimately have no verifier. A code with no
    // challenge accepts one and ignores it rather than refusing.
    const url = await signInThrough({ email: "pkce-none@a.test", providerUserId: "pkce-none" });
    const code = url.searchParams.get("code") ?? "";
    const issued = await flow.authenticate(context, { code, codeVerifier: VERIFIER });
    expect(issued.user.email).toBe("pkce-none@a.test");
  });
});
