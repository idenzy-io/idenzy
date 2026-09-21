import { ApiKeyRepository } from "@idenzy/persistence/repository/api-key-repository";
import { BillingSettingsRepository } from "@idenzy/persistence/repository/billing-settings-repository";
import { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { CellTx, ControlTx } from "@idenzy/persistence/tenancy/unit-of-work";
import { describe, expect, it } from "vitest";

/**
 * That a repository cannot be handed the wrong plane's transaction (ADR-0003, ADR-0011).
 *
 * **A type test, because the property is a compile-time one.** `@ts-expect-error` inverts the
 * assertion: if the line below it ever starts compiling, the directive itself becomes the error
 * and `pnpm turbo run typecheck` fails. So this file passing at runtime is incidental; what it
 * really asserts is checked by `tsc` on `tsconfig.test.json`.
 *
 * The failure being designed against is **silent**, which is why a runtime test could not replace
 * this. Both planes are one Postgres today and will be two databases once the control plane moves
 * (PROJECT.md 4.13.5). Under RLS, a transaction that bound `app.org_id` querying a tenant table
 * matches nothing: no error, no rows, and a caller with no way to tell "this organisation has no
 * API keys" from "I asked the wrong database". A test asserting zero rows would pass in both
 * worlds. The compiler is the only line that can tell them apart.
 */

// Stand-ins. Nothing is executed: the brands are phantom types with no runtime value, so a cast
// is the whole of what a type test needs and connecting to Postgres would prove nothing extra.
const cellTx = {} as CellTx;
const controlTx = {} as ControlTx;
const tenant = new TenantContext("11111111-1111-1111-1111-111111111111", "req_test", "system");
const org = new OrgContext("22222222-2222-2222-2222-222222222222", "req_test", "system");

describe("the two planes cannot be confused", () => {
  it("lets each repository take its own plane", () => {
    expect(new ApiKeyRepository(cellTx, tenant)).toBeInstanceOf(ApiKeyRepository);
    expect(new BillingSettingsRepository(controlTx, org)).toBeInstanceOf(BillingSettingsRepository);
  });

  it("refuses a control-plane transaction to a tenant repository", () => {
    // @ts-expect-error a tenant table needs app.project_id, which a ControlTx has not bound
    expect(() => new ApiKeyRepository(controlTx, tenant)).toBeDefined();
  });

  it("refuses a cell transaction to a control-plane repository", () => {
    // @ts-expect-error an org-keyed table needs app.org_id, which a CellTx has not bound
    expect(() => new BillingSettingsRepository(cellTx, org)).toBeDefined();
  });

  it("refuses a bare transaction to either, so neither plane has an unbranded way in", () => {
    const unbranded = {};
    // @ts-expect-error a transaction that bound no key at all belongs to no plane
    expect(() => new ApiKeyRepository(unbranded, tenant)).toBeDefined();
    // @ts-expect-error the same, one plane up
    expect(() => new BillingSettingsRepository(unbranded, org)).toBeDefined();
  });

  /**
   * The contexts are branded by nothing and never were; they are distinct classes. Worth asserting
   * beside the transaction brands so the pair is read together: a repository needs the right
   * transaction *and* the right context, and the two are checked independently.
   */
  it("refuses the wrong context kind as well as the wrong transaction", () => {
    // @ts-expect-error an OrgContext carries no projectId for a tenant repository to scope on
    expect(() => new ApiKeyRepository(cellTx, org)).toBeDefined();
    // @ts-expect-error and a TenantContext carries no orgId
    expect(() => new BillingSettingsRepository(controlTx, tenant)).toBeDefined();
  });
});
