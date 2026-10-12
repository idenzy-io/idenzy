import { createHash } from "node:crypto";
import { IdTokenInvalidError } from "@idenzy/core/errors";
import { SystemClock } from "@idenzy/core/time/clock";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { NullAnalyticsRecorder } from "@idenzy/domain/ports/analytics-recorder";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import {
  type IdTokenVerifier,
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
} from "@idenzy/domain/ports/oauth-provider";
import { IdentityRepository } from "@idenzy/persistence/repository/identity-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { decodeJwt } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectSettingsReader } from "../dist/config/project-settings-reader.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { DatabaseOAuthFlowStore } from "../dist/oauth/database-oauth-flow-store.js";
import { DatabaseRedirectAllowlist } from "../dist/oauth/database-redirect-allowlist.js";
import { IdTokenFlow } from "../dist/oauth/id-token.flow.js";
import { IdTokenNonceService } from "../dist/oauth/id-token-nonce-service.js";
import { ProviderRegistry } from "../dist/oauth/provider-registry.js";
import { ProviderSignIn } from "../dist/oauth/provider-sign-in.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "22222222-2222-2222-2222-222222222222";
const clock = new SystemClock();
const config = testConfig();
const encryptor = new FieldEncryptor(developmentDataKey("test"));

/**
 * Apple, minus the cryptography.
 *
 * Signature, issuer, audience, expiry and nonce are verified for real against signed tokens
 * in `@idenzy/providers-oauth` (native-id-token.test.ts). This one stands in at the seam so
 * the database half can be tested: it accepts exactly one token, and only with the digest of
 * the nonce the test expects, and it records every call so a test can prove a refused nonce
 * never reached it.
 */
class FakeApple extends OAuthProvider implements IdTokenVerifier {
  override readonly id = ProviderId.Apple;
  expectedDigest = "";
  calls = 0;
  profile: ProviderProfile = {
    providerUserId: "001234.apple",
    email: "ada@example.test",
    emailVerified: true,
    displayName: null,
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

  verifyIdToken(
    _credentials: ProviderCredentials,
    idToken: string,
    nonceDigest: string,
  ): Promise<ProviderProfile> {
    this.calls += 1;
    if (idToken !== "apple-id-token" || nonceDigest !== this.expectedDigest) {
      return Promise.reject(new IdTokenInvalidError());
    }
    return Promise.resolve(this.profile);
  }

  protected override authorizeEndpoint(): string {
    return "https://appleid.example.test/authorize";
  }
  protected override tokenEndpoint(): string {
    return "https://appleid.example.test/token";
  }
  protected override defaultScopes(): readonly string[] {
    return ["openid"];
  }
  protected override fetchProfile(): Promise<ProviderProfile> {
    return Promise.resolve(this.profile);
  }
}

let uow: UnitOfWork;
let nonces: IdTokenNonceService;
let flow: IdTokenFlow;
let apple: FakeApple;

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_id_token",
  ip: "203.0.113.30",
  userAgent: "vitest",
  deviceName: "Ada's iPhone",
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_id_token", "user");
const digest = (nonce: string) => createHash("sha256").update(nonce).digest("hex");

/** A nonce as the app would get it, with the fake told which digest the "token" carries. */
async function issued(): Promise<string> {
  const { nonce } = await nonces.issue(context);
  apple.expectedDigest = digest(nonce);
  return nonce;
}

function exchange(nonce: string, extra: Record<string, unknown> = {}) {
  return flow.authenticate(context, {
    provider: "apple",
    idToken: "apple-id-token",
    nonce,
    ...extra,
  });
}

async function configureApple(mode = "custom"): Promise<void> {
  await harness.owner.query(`DELETE FROM oauth_providers WHERE project_id = $1`, [PROJECT]);
  await harness.owner.query(
    `INSERT INTO oauth_providers (project_id, provider, client_id, scopes, settings, enabled, mode)
     VALUES ($1, 'apple', 'com.example.web', ARRAY['openid'], $2, true, $3)`,
    [PROJECT, JSON.stringify({ nativeAudiences: "com.example.ios" }), mode],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  const issuer = await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300);
  const sessions = new SessionService(
    uow,
    clock,
    issuer,
    config,
    testRevocations(clock).publisher,
    claimTemplates(uow, clock),
    new NullAnalyticsRecorder(),
    new ProjectSettingsReader(uow),
  );
  apple = new FakeApple(
    clock,
    new DatabaseOAuthFlowStore(uow, encryptor),
    new DatabaseRedirectAllowlist(uow),
  );
  const registry = new ProviderRegistry(uow, encryptor, new Map([[ProviderId.Apple, apple]]));
  nonces = new IdTokenNonceService(uow, clock, config);
  flow = new IdTokenFlow(
    sessions,
    new NullFlowHooks(),
    new OutboxFlowAudit(uow, clock),
    testMfaGate(uow, clock, config),
    testActives(clock),
    uow,
    clock,
    registry,
    new ProviderSignIn(clock, new ProjectSettingsReader(uow)),
  );

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name) VALUES (gen_random_uuid(), 'Acme') RETURNING id`,
  );
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'Acme', 'k')`,
    [PROJECT, rows[0]?.id],
  );
}, 180_000);

beforeEach(async () => {
  await configureApple();
  await harness.owner.query(`DELETE FROM id_token_nonces`);
  apple.calls = 0;
  apple.profile = {
    providerUserId: "001234.apple",
    email: "ada@example.test",
    emailVerified: true,
    displayName: null,
    avatarUrl: null,
  };
});

afterAll(async () => {
  await harness.stop();
});

describe("issuing a nonce", () => {
  it("stores its digest and never the nonce", async () => {
    const { nonce, expiresAt } = await nonces.issue(context);
    const { rows } = await harness.owner.query<{ nonce_hash: string }>(
      `SELECT nonce_hash FROM id_token_nonces`,
    );
    expect(rows.map((row) => row.nonce_hash)).toEqual([digest(nonce)]);
    expect(nonce).toHaveLength(43);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("clears this project's nonces that expired unspent", async () => {
    await harness.owner.query(
      `INSERT INTO id_token_nonces (project_id, nonce_hash, expires_at)
       VALUES ($1, 'stale', now() - interval '1 minute')`,
      [PROJECT],
    );
    await nonces.issue(context);
    const { rows } = await harness.owner.query(
      `SELECT 1 FROM id_token_nonces WHERE nonce_hash = 'stale'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("exchanging an ID token", () => {
  it("signs in a new user, named by the app where the token cannot name them", async () => {
    const session = sessionOf(await exchange(await issued(), { displayName: "Ada Lovelace" }));

    expect(session.user.toPublic().displayName).toBe("Ada Lovelace");
    expect(session.user.emailVerified).toBe(true);
    expect(decodeJwt(session.accessToken)["amr"]).toEqual([AuthMethod.IdTokenExchange]);
    const identity = await uow.transaction((tx) =>
      new IdentityRepository(tx, tenant).findByAccount("apple", "001234.apple"),
    );
    expect(identity?.userId).toBe(session.userId);
  });

  it("signs the same Apple account into the same user the second time", async () => {
    const first = sessionOf(await exchange(await issued()));
    const second = sessionOf(await exchange(await issued(), { displayName: "Somebody Else" }));
    expect(second.userId).toBe(first.userId);
    expect(second.user.toPublic().displayName).toBe(first.user.toPublic().displayName);
  });

  /** The replay: the same nonce twice is one sign-in, and the second never reaches the provider. */
  it("spends a nonce once", async () => {
    const nonce = await issued();
    sessionOf(await exchange(nonce));
    await expect(exchange(nonce)).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(apple.calls).toBe(1);
  });

  it("refuses a nonce this project never issued, before the token is looked at", async () => {
    await expect(exchange("n".repeat(43))).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(apple.calls).toBe(0);
  });

  it("refuses an expired nonce", async () => {
    const nonce = await issued();
    await harness.owner.query(
      `UPDATE id_token_nonces SET expires_at = now() - interval '1 second'`,
    );
    await expect(exchange(nonce)).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(apple.calls).toBe(0);
  });

  /** The nonce is burnt by the attempt, so a token that failed cannot be tried again with it. */
  it("spends the nonce even when the token is refused", async () => {
    const nonce = await issued();
    await expect(
      flow.authenticate(context, { provider: "apple", idToken: "forged", nonce }),
    ).rejects.toMatchObject({ code: "id_token_invalid" });
    await expect(exchange(nonce)).rejects.toMatchObject({ code: "id_token_invalid" });
    expect(apple.calls).toBe(1);
  });

  it("refuses instant mode, which has no client ids of the project's own", async () => {
    await configureApple("instant");
    await expect(exchange(await issued())).rejects.toMatchObject({ code: "validation_failed" });
  });

  /**
   * The takeover the shared resolver exists to stop (PROJECT.md 4.6): an account on an
   * address the provider does not vouch for is never joined by either way in.
   */
  it("does not join an existing account on an address Apple did not verify", async () => {
    await uow.transaction((tx) =>
      new UserRepository(tx, tenant).create({
        email: "victim@example.test",
        emailVerified: true,
        phone: null,
        passwordHash: null,
        passwordAlgoVersion: null,
        displayName: "Victim",
        avatarUrl: null,
      }),
    );
    apple.profile = {
      ...apple.profile,
      providerUserId: "attacker.apple",
      email: "victim@example.test",
      emailVerified: false,
    };
    await expect(exchange(await issued())).rejects.toMatchObject({
      code: "linking_requires_verification",
    });
  });
});
