import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RelyingPartyService } from "../../dist/management/passkeys/relying-party-service.js";

/**
 * A project's passkey relying party, against a real Postgres: the one row per project the
 * unique index promises, and the refusal to move passkeys that exist to another domain.
 */

const harness = new PostgresHarness();
const ORG = "77777777-7777-7777-7777-777777777777";
const PROJECT = "66666666-6666-6666-6666-666666666666";
const ANDROID = "android:apk-key-hash:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

let service: RelyingPartyService;
const publicProjectId = `prj_${PROJECT.replaceAll("-", "")}`;
const context = { orgId: ORG } as OrgContext;

/** The project scope as the controller would resolve it, without a dashboard session. */
class PassthroughScope {
  async of(_context: OrgContext, publicId: string): Promise<TenantContext> {
    const raw = publicId.slice("prj_".length);
    const dashed = [
      raw.slice(0, 8),
      raw.slice(8, 12),
      raw.slice(12, 16),
      raw.slice(16, 20),
      raw.slice(20),
    ].join("-");
    return await Promise.resolve(new TenantContext(dashed, "req_test", "customer_staff"));
  }
}

beforeAll(async () => {
  await harness.start();
  service = new RelyingPartyService(new UnitOfWork(harness.db), new PassthroughScope() as never);
  await harness.owner.query("INSERT INTO orgs (id, name) VALUES ($1, 'Acme')", [ORG]);
  await harness.owner.query(
    "INSERT INTO projects (id, org_id, name, kms_key_name) VALUES ($1, $2, 'p', 'k')",
    [PROJECT, ORG],
  );
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("a project's passkey relying party", () => {
  it("is absent until one is saved, and then reads back as saved, Android apps included", async () => {
    expect(await service.find(context, publicProjectId)).toEqual({
      relyingParty: null,
      passkeys: 0,
    });

    const party = {
      rpId: "example.com",
      rpName: "Example",
      origins: ["https://app.example.com", ANDROID],
    };
    await service.save(context, publicProjectId, party);

    expect(await service.find(context, publicProjectId)).toEqual({
      relyingParty: party,
      passkeys: 0,
    });
  });

  it("stays one row however many times it is saved", async () => {
    await service.save(context, publicProjectId, {
      rpId: "example.com",
      rpName: "Example, renamed",
      origins: ["https://example.com"],
    });
    const { rows } = await harness.owner.query(
      "SELECT rp_name FROM webauthn_relying_parties WHERE project_id = $1",
      [PROJECT],
    );
    expect(rows).toEqual([{ rp_name: "Example, renamed" }]);
  });

  it("moves to another domain freely while no passkey depends on it", async () => {
    await service.save(context, publicProjectId, {
      rpId: "example.org",
      rpName: "Example",
      origins: ["https://example.org"],
    });
    expect((await service.find(context, publicProjectId)).relyingParty?.rpId).toBe("example.org");
  });

  it("moves once passkeys exist only when told how many it strands, and keeps them", async () => {
    const { rows } = await harness.owner.query<{ id: string }>(
      `INSERT INTO users (project_id, email, email_verified)
       VALUES ($1, 'ada@example.org', true) RETURNING id`,
      [PROJECT],
    );
    await harness.owner.query(
      `INSERT INTO webauthn_credentials (project_id, user_id, credential_id, public_key, sign_count)
       VALUES ($1, $2, 'Y3JlZA', 'cHVibGljLWtleQ', 0)`,
      [PROJECT, rows[0]?.id],
    );

    await expect(
      service.save(context, publicProjectId, {
        rpId: "example.net",
        rpName: "Example",
        origins: ["https://example.net"],
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      detail: { rpId: "example.org", passkeys: 1 },
    });

    // A count read before another passkey arrived is not an acknowledgement of this state.
    await expect(
      service.save(context, publicProjectId, {
        rpId: "example.net",
        rpName: "Example",
        origins: ["https://example.net"],
        strandPasskeys: 2,
      }),
    ).rejects.toMatchObject({ code: "conflict", detail: { passkeys: 1 } });

    // The name and the origins still change: only the domain is bound to the credentials.
    await service.save(context, publicProjectId, {
      rpId: "example.org",
      rpName: "Renamed",
      origins: ["https://example.org", ANDROID],
    });
    expect((await service.find(context, publicProjectId)).relyingParty?.origins).toEqual([
      "https://example.org",
      ANDROID,
    ]);
  });

  it("moves with the right count, and the stranded passkeys stay, to come back if it does", async () => {
    await service.save(context, publicProjectId, {
      rpId: "example.net",
      rpName: "Example",
      origins: ["https://example.net"],
      strandPasskeys: 1,
    });
    expect((await service.find(context, publicProjectId)).relyingParty?.rpId).toBe("example.net");
    const { rows } = await harness.owner.query(
      "SELECT count(*)::int AS kept FROM webauthn_credentials WHERE project_id = $1",
      [PROJECT],
    );
    expect(rows).toEqual([{ kept: 1 }]);
  });
});
