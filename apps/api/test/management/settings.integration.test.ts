import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { PostgresHarness } from "@idenzy/testing/postgres-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SettingsService } from "../../dist/management/settings/settings-service.js";

/**
 * A project's settings document, against a real Postgres.
 *
 * The two properties that cannot be unit-tested are the ones worth having: a patch merges
 * at the section level inside one statement, so two screens saved at once do not erase each
 * other, and a document written by an older shape still reads as today's defaults.
 */

const harness = new PostgresHarness();
const ORG = "88888888-8888-8888-8888-888888888888";
const PROJECT = "99999999-9999-9999-9999-999999999999";

let service: SettingsService;
let publicProjectId = "";

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

const context = { orgId: ORG } as OrgContext;

beforeAll(async () => {
  await harness.start();
  service = new SettingsService(new UnitOfWork(harness.db), new PassthroughScope() as never);

  await harness.owner.query(
    `INSERT INTO orgs (id, name)
     VALUES ($1, 'Acme')`,
    [ORG],
  );
  await harness.owner.query(
    `INSERT INTO projects (id, org_id, name, kms_key_name)
     VALUES ($1, $2, 'p', 'k')`,
    [PROJECT, ORG],
  );
  publicProjectId = `prj_${PROJECT.replaceAll("-", "")}`;
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

describe("a project's settings", () => {
  it("reads as the defaults before anything has been saved", async () => {
    const settings = await service.read(context, publicProjectId);
    expect(settings.password.enabled).toBe(true);
    expect(settings.password.minLength).toBe(8);
    expect(settings.password.breachCheck).toBe(true);
    // Off by default, because lockout is a denial of service aimed at the victim (4.5).
    expect(settings.password.lockout).toBe(false);
  });

  it("answers with the whole document after a patch, not with what was sent", async () => {
    const saved = await service.patch(context, publicProjectId, {
      password: {
        enabled: true,
        allowSignUp: false,
        minLength: 12,
        breachCheck: true,
        lockout: false,
        lockoutAttempts: 10,
        resetLifetime: 60,
        signOutOnReset: true,
        notifyOnChange: true,
      },
    });
    expect(saved.password.allowSignUp).toBe(false);
    expect(saved.password.minLength).toBe(12);
    expect(saved.password.resetLifetime).toBe(60);

    const reread = await service.read(context, publicProjectId);
    expect(reread).toEqual(saved);
  });

  /**
   * The reason `mergeSettings` is one statement rather than a read-modify-write.
   *
   * A second section written directly, as another screen would, must survive a patch of
   * the first — and a read-modify-write would have overwritten it with the document this
   * caller happened to read.
   */
  it("leaves sections it was not given alone", async () => {
    await harness.owner.query(
      `UPDATE projects SET settings = settings || '{"somethingElse": {"kept": true}}'::jsonb
       WHERE id = $1`,
      [PROJECT],
    );

    await service.patch(context, publicProjectId, {
      password: {
        enabled: true,
        allowSignUp: true,
        minLength: 16,
        breachCheck: true,
        lockout: false,
        lockoutAttempts: 10,
        resetLifetime: 15,
        signOutOnReset: true,
        notifyOnChange: true,
      },
    });

    const { rows } = await harness.owner.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM projects WHERE id = $1`,
      [PROJECT],
    );
    expect(rows[0]?.settings["somethingElse"]).toEqual({ kept: true });
    expect((await service.read(context, publicProjectId)).password.minLength).toBe(16);
  });

  /**
   * A settings screen that cannot be opened to fix the value that broke it is the worst
   * outcome here, so an unreadable document resolves to defaults rather than throwing.
   */
  it("reads a document of the wrong shape as the defaults", async () => {
    await harness.owner.query(
      `UPDATE projects SET settings = '{"password": 42}'::jsonb WHERE id = $1`,
      [PROJECT],
    );
    const settings = await service.read(context, publicProjectId);
    expect(settings.password.minLength).toBe(8);
    expect(settings.password.enabled).toBe(true);
  });
});
