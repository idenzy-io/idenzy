import { SystemClock } from "@idenzy/core/time/clock";
import { Argon2idHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { BreachedPasswordChecker } from "@idenzy/domain/ports/breached-password-checker";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ClaimSource, MAX_CLAIM_BYTES } from "@idenzy/protocol/schemas/claims";
import { sessionOf } from "@idenzy/testing/auth-outcome";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ClaimTemplateService } from "../dist/claims/claim-template-service.js";
import { NullFlowHooks } from "../dist/flows/null-flow-hooks.js";
import { OutboxFlowAudit } from "../dist/flows/outbox-flow-audit.js";
import { PasswordSignInFlow } from "../dist/password/password-sign-in.flow.js";
import { PasswordSignUpFlow } from "../dist/password/password-sign-up.flow.js";
import { SessionService } from "../dist/session/session-service.js";
import {
  claimTemplates,
  testActives,
  testConfig,
  testMfaGate,
  testRevocations,
} from "./fixtures.js";

const harness = new PostgresHarness();
const PROJECT = "44444444-4444-4444-4444-444444444444";
const clock = new SystemClock();
const actives = testActives(clock);
const config = testConfig();
const revocations = testRevocations(clock);

let uow: UnitOfWork;
let templates: ClaimTemplateService;
let signUp: PasswordSignUpFlow;
let signIn: PasswordSignInFlow;

class NoBreaches extends BreachedPasswordChecker {
  protected override fetchRange(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}

const context: FlowContext = {
  projectId: PROJECT,
  requestId: "req_claims",
  ip: null,
  userAgent: "vitest",
  deviceName: null,
  locale: "en",
  attestation: null,
};
const tenant = new TenantContext(PROJECT, "req_claims", "user");

/** The payload as a customer's verifier reads it once the signature checks out. */
function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

const PASSWORD = "a-password-1";

/** Creates the account. Its token is minted before any metadata is set. */
async function newUser(email: string): Promise<string> {
  const issued = sessionOf(await signUp.authenticate(context, { email, password: PASSWORD }));
  return issued.accessToken;
}

/** Signs an existing account back in, which is where a template is actually observed. */
async function signInAgain(email: string): Promise<string> {
  const issued = sessionOf(await signIn.authenticate(context, { email, password: PASSWORD }));
  return issued.accessToken;
}

async function withMetadata(
  email: string,
  metadataPublic: Record<string, unknown>,
  metadataPrivate: Record<string, unknown>,
): Promise<void> {
  await harness.owner.query(
    `UPDATE users SET metadata_public = $2, metadata_private = $3
     WHERE project_id = $1 AND email = $4`,
    [PROJECT, JSON.stringify(metadataPublic), JSON.stringify(metadataPrivate), email],
  );
}

beforeAll(async () => {
  await harness.start();
  uow = new UnitOfWork(harness.db);
  templates = claimTemplates(uow, clock);
  const sessions = new SessionService(
    uow,
    clock,
    await LocalEs256Issuer.create(clock, config.get("ISSUER_BASE_URL"), 300),
    config,
    revocations.publisher,
    templates,
  );
  const gate = testMfaGate(uow, clock, config);
  const audit = new OutboxFlowAudit(uow, clock);
  signUp = new PasswordSignUpFlow(
    sessions,
    new NullFlowHooks(),
    audit,
    gate,
    actives,
    uow,
    new Argon2idHasher(),
    new NoBreaches(),
  );
  signIn = new PasswordSignInFlow(
    sessions,
    new NullFlowHooks(),
    audit,
    gate,
    actives,
    uow,
    new Argon2idHasher(),
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
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("a project that has configured nothing", () => {
  it("issues the tokens it always did", async () => {
    const token = await newUser("claims-none@a.test");
    const claims = claimsOf(token);

    expect(claims["sub"]).toBeDefined();
    expect(Object.keys(claims).sort()).toEqual(
      ["amr", "aud", "exp", "iat", "iss", "sid", "sub"].sort(),
    );
  });

  it("reads back an empty template rather than a missing one", async () => {
    const saved = await templates.read(tenant);
    expect(saved.claims).toEqual([]);
    expect(saved.acknowledgePrivateMetadata).toBe(false);
  });
});

describe("saving a template", () => {
  it("refuses a reserved claim", async () => {
    await expect(
      templates.save(tenant, {
        claims: [{ name: "sub", source: ClaimSource.User, path: "email" }],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses a user field the public profile does not have", async () => {
    await expect(
      templates.save(tenant, {
        claims: [{ name: "pw", source: ClaimSource.User, path: "passwordHash" }],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses two mappings onto one claim", async () => {
    await expect(
      templates.save(tenant, {
        claims: [
          { name: "role", source: ClaimSource.MetadataPublic, path: "role" },
          { name: "role", source: ClaimSource.MetadataPublic, path: "roleV2" },
        ],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  /**
   * That column is the one place a customer keeps what they did not want a browser to
   * see, and a token is read by everything the device sends it to.
   */
  it("refuses private metadata without an acknowledgement", async () => {
    await expect(
      templates.save(tenant, {
        claims: [{ name: "billing", source: ClaimSource.MetadataPrivate, path: "stripeId" }],
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("saves it once the acknowledgement is there, and records that it was given", async () => {
    const saved = await templates.save(tenant, {
      claims: [{ name: "billing", source: ClaimSource.MetadataPrivate, path: "stripeId" }],
      acknowledgePrivateMetadata: true,
    });

    expect(saved.acknowledgePrivateMetadata).toBe(true);
    const { rows } = await harness.owner.query<{ at: Date | null }>(
      `SELECT private_metadata_acknowledged_at AS at FROM claim_templates WHERE project_id = $1`,
      [PROJECT],
    );
    expect(rows[0]?.at).not.toBeNull();
  });

  it("refuses names that cannot fit inside a token", async () => {
    await expect(
      templates.save(tenant, {
        claims: Array.from({ length: 16 }, (_unused, index) => ({
          name: `${"n".repeat(63)}${index}`.slice(0, 64),
          source: ClaimSource.MetadataPublic,
          path: "x",
        })),
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("refuses more claims than a template may hold", async () => {
    await expect(
      templates.save(tenant, {
        claims: Array.from({ length: 17 }, (_unused, index) => ({
          name: `c${index}`,
          source: ClaimSource.MetadataPublic,
          path: "x",
        })),
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("applying a template to a token", () => {
  // Each case configures its own, so one leaving a required claim behind cannot decide
  // the next: a template is project-wide state and these all share a project.
  beforeEach(async () => {
    await templates.save(tenant, { claims: [] });
  });

  it("carries the mapped claims, from every source", async () => {
    const email = "claims-applied@a.test";
    await newUser(email);
    await withMetadata(email, { plan: "pro" }, { stripeId: "cus_1" });
    await templates.save(tenant, {
      claims: [
        { name: "email", source: ClaimSource.User, path: "email" },
        { name: "plan", source: ClaimSource.MetadataPublic, path: "plan" },
        { name: "billing", source: ClaimSource.MetadataPrivate, path: "stripeId" },
      ],
      acknowledgePrivateMetadata: true,
    });

    const claims = claimsOf(await signInAgain(email));
    expect(claims["email"]).toBe(email);
    expect(claims["plan"]).toBe("pro");
    expect(claims["billing"]).toBe("cus_1");
  });

  /** Absent and not null: a verifier reading null has to decide what it means. */
  it("omits an optional claim the user has nothing for", async () => {
    const email = "claims-optional@a.test";
    await newUser(email);
    await templates.save(tenant, {
      claims: [{ name: "plan", source: ClaimSource.MetadataPublic, path: "plan" }],
    });

    const claims = claimsOf(await signInAgain(email));
    expect(claims).not.toHaveProperty("plan");
  });

  it("refuses to sign anybody in when a required claim resolves to nothing", async () => {
    await templates.save(tenant, {
      claims: [{ name: "org", source: ClaimSource.MetadataPublic, path: "orgId", required: true }],
    });

    await expect(signInAgain("claims-optional@a.test")).rejects.toMatchObject({
      code: "claim_template_unsatisfied",
    });
  });

  /**
   * The save saw only names. This is the first moment anything knows how big a metadata
   * value is, and a token a proxy rejects for header size fails with no sign of what did
   * it.
   */
  it("refuses a token whose rendered claims outgrow the budget", async () => {
    const email = "claims-oversized@a.test";
    await newUser(email);
    await withMetadata(email, { blob: "x".repeat(MAX_CLAIM_BYTES + 1) }, {});
    await templates.save(tenant, {
      claims: [{ name: "blob", source: ClaimSource.MetadataPublic, path: "blob" }],
    });

    await expect(signInAgain(email)).rejects.toMatchObject({
      code: "claim_template_unsatisfied",
    });
  });

  it("goes back to plain tokens when the template is emptied", async () => {
    await templates.save(tenant, { claims: [] });
    const claims = claimsOf(await newUser("claims-emptied@a.test"));

    expect(Object.keys(claims).sort()).toEqual(
      ["amr", "aud", "exp", "iat", "iss", "sid", "sub"].sort(),
    );
  });
});
