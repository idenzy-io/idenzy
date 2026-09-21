import { orgSecuritySettings } from "../schema/organisation.js";
import type { OrgContext } from "../tenancy/org-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { OrgRepository } from "./org-repository.js";

/**
 * Whether the organisation demands a second factor of its own team on our dashboard.
 *
 * `isMfaRequired` answers false for a missing row rather than null. An organisation that
 * has never opened the screen has not required anything, and a nullable answer here is a
 * branch whose wrong side locks a team out of its own panel.
 */
export class OrgSecuritySettingsRepository extends OrgRepository<typeof orgSecuritySettings> {
  constructor(tx: Transaction, context: OrgContext) {
    super(tx, context, orgSecuritySettings);
  }

  async isMfaRequired(): Promise<boolean> {
    const rows = await this.tx
      .select({ requireMfa: orgSecuritySettings.requireMfa })
      .from(orgSecuritySettings)
      .where(this.orgScope())
      .limit(1);
    return rows[0]?.requireMfa ?? false;
  }

  async setMfaRequired(required: boolean, updatedBy: string | null): Promise<void> {
    const now = new Date();
    await this.guard(() =>
      this.tx
        .insert(orgSecuritySettings)
        .values({ orgId: this.context.orgId, requireMfa: required, updatedBy, updatedAt: now })
        .onConflictDoUpdate({
          target: orgSecuritySettings.orgId,
          set: { requireMfa: required, updatedBy, updatedAt: now },
        }),
    );
  }
}
