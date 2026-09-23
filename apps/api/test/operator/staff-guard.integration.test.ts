import { InsufficientScopeError, MissingCredentialsError } from "@idenzy/core/errors";
import { AccessTokenVerifier } from "@idenzy/node";
import { StaticJwks } from "@idenzy/node/jwks";
import { StaffReader } from "@idenzy/persistence/repository/staff-reader";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { StaffRole } from "@idenzy/protocol/enums/staff";
import { RecordingLogger } from "@idenzy/testing/fakes";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { Reflector } from "@nestjs/core";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// From `dist`, like every other app test: Rolldown does not apply the decorator semantics
// NestJS DI depends on.
import { REQUIRES_STAFF, StaffGuard } from "../../dist/operator/staff.guard.js";

/**
 * Who gets through to an operator route (ADR-0018). Almost every case is an attack.
 *
 * Tokens are really signed and really verified — ES256 against a key set, audience and issuer
 * checked — because "a dashboard token is refused here" is a property of that verification, and a
 * stubbed verifier would agree with whatever the test assumed.
 */
const harness = new PostgresHarness();
const ISSUER = "https://auth.example.test";
const OPERATOR_PROJECT = "0e0e0e0e-0000-4000-8000-000000000001";
const DASHBOARD_PROJECT = "0d0d0d0d-0000-4000-8000-000000000002";
const OPERATOR_PUBLIC = `prj_${OPERATOR_PROJECT.replaceAll("-", "")}`;
const DASHBOARD_PUBLIC = `prj_${DASHBOARD_PROJECT.replaceAll("-", "")}`;

const ADA = "a0a0a0a0-0000-4000-8000-000000000001";
const MALLORY = "b0b0b0b0-0000-4000-8000-000000000002";
const CARL = "c0c0c0c0-0000-4000-8000-000000000003";

let uow: UnitOfWork;
let sign: (claims: { sub: string; aud: string }) => Promise<string>;
let verifier: AccessTokenVerifier;
let logger: RecordingLogger;

class FixedReflector extends Reflector {
  constructor(private readonly required: StaffRole | undefined) {
    super();
  }
  override getAllAndOverride<T>(key: unknown): T {
    // Safe: the guard reads exactly this key and nothing else.
    return (key === REQUIRES_STAFF ? this.required : undefined) as T;
  }
}

function guard(
  required: StaffRole | undefined,
  configured = true,
): { guard: StaffGuard; request: Record<string, unknown> } {
  return {
    guard: new StaffGuard(
      new FixedReflector(required),
      uow,
      new StaffReader(harness.db),
      logger,
      configured ? verifier : null,
      configured ? OPERATOR_PROJECT : null,
    ),
    request: {},
  };
}

function context(request: Record<string, unknown>): never {
  // Safe: the guard reads only these three members of an ExecutionContext.
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

async function attempt(
  required: StaffRole | undefined,
  headers: Record<string, string>,
  configured = true,
): Promise<Record<string, unknown>> {
  const made = guard(required, configured);
  const request = { id: "req_op", headers };
  await made.guard.canActivate(context(request));
  return request;
}

const bearer = async (userId: string, aud = OPERATOR_PUBLIC) => ({
  authorization: `Bearer ${await sign({ sub: `usr_${userId.replaceAll("-", "")}`, aud })}`,
});

async function identity(userId: string, provider: string, email: string): Promise<void> {
  await harness.owner.query(
    `INSERT INTO identities (project_id, user_id, provider, provider_user_id, email)
     VALUES ($1, $2, $3, $4, $5)`,
    [OPERATOR_PROJECT, userId, provider, `${provider}-${userId}`, email],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);

  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
  verifier = new AccessTokenVerifier(
    { issuerUrl: ISSUER, projectId: OPERATOR_PUBLIC },
    new StaticJwks({ keys: [jwk] }),
  );
  sign = (claims) =>
    new SignJWT({ sid: "ses_1" })
      .setProtectedHeader({ alg: "ES256", kid: "k1", typ: "JWT" })
      .setIssuer(ISSUER)
      .setAudience(claims.aud)
      .setSubject(claims.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  const { rows } = await harness.owner.query<{ id: string }>(
    `INSERT INTO orgs (id, name) VALUES (gen_random_uuid(), 'Idenzy') RETURNING id`,
  );
  for (const project of [OPERATOR_PROJECT, DASHBOARD_PROJECT]) {
    await harness.owner.query(
      `INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')`,
      [project, rows[0]?.id],
    );
  }
  for (const user of [ADA, MALLORY, CARL]) {
    await harness.owner.query(`INSERT INTO users (id, project_id) VALUES ($1, $2)`, [
      user,
      OPERATOR_PROJECT,
    ]);
  }
  await identity(ADA, "google", "Ada@idenzy.io");
  await identity(MALLORY, "google", "mallory@gmail.com");
  // Carl has a password on the operator project and no Google identity at all.
  await harness.owner.query(
    `INSERT INTO staff (email, role) VALUES ('ada@idenzy.io', 'billing'), ('carl@idenzy.io', 'admin')`,
  );
}, 180_000);

beforeEach(() => {
  logger = new RecordingLogger();
});

afterAll(async () => {
  await harness.stop();
});

describe("the staff guard", () => {
  it("lets active staff through, and says who they are", async () => {
    const request = await attempt(StaffRole.Billing, await bearer(ADA));
    expect(request["operator"]).toMatchObject({ email: "ada@idenzy.io", role: "billing" });
  });

  it("leaves a route that asks for no staff alone, token or not", async () => {
    await expect(attempt(undefined, {})).resolves.toBeDefined();
  });

  /** The two audiences must never accept each other's tokens. */
  it("refuses a dashboard token, signed by the same key", async () => {
    await expect(
      attempt(StaffRole.Support, await bearer(ADA, DASHBOARD_PUBLIC)),
    ).rejects.toMatchObject({ code: "access_token_invalid" });
  });

  /** The cookie name is the same for every project; the operator surface reads the header only. */
  it("refuses a token presented as a session cookie", async () => {
    const token = (await bearer(ADA)).authorization.slice("Bearer ".length);
    await expect(
      attempt(StaffRole.Support, { cookie: `__Host-idenzy-session=${token}` }),
    ).rejects.toBeInstanceOf(MissingCredentialsError);
  });

  it("refuses a Google account outside idenzy.io", async () => {
    await expect(attempt(StaffRole.Support, await bearer(MALLORY))).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
    expect(logger.records.some((record) => record.message === "operator refused")).toBe(true);
  });

  it("refuses somebody on the staff list who did not sign in with Google", async () => {
    await expect(attempt(StaffRole.Support, await bearer(CARL))).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
  });

  it("refuses staff who have been deactivated, at once", async () => {
    await harness.owner.query(
      `UPDATE staff SET active = false, deactivated_at = now() WHERE email = 'ada@idenzy.io'`,
    );
    await expect(attempt(StaffRole.Support, await bearer(ADA))).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
    await harness.owner.query(
      `UPDATE staff SET active = true, deactivated_at = null WHERE email = 'ada@idenzy.io'`,
    );
  });

  it("refuses a role too junior for the route, as forbidden rather than unknown", async () => {
    await expect(attempt(StaffRole.Admin, await bearer(ADA))).rejects.toBeInstanceOf(
      InsufficientScopeError,
    );
  });

  it("refuses everybody when no operator project is configured", async () => {
    await expect(attempt(StaffRole.Support, await bearer(ADA), false)).rejects.toBeInstanceOf(
      MissingCredentialsError,
    );
  });
});
