import { smsPolicies } from "../schema/messaging.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface SmsPolicyRow {
  readonly allowedCountries: readonly string[];
  readonly dailySpendCap: string;
  readonly currency: string;
  readonly attestationRequired: boolean;
  readonly perNumberDailyLimit: number;
  readonly perIpHourlyLimit: number;
  readonly maxSendsPerVerify: number;
  readonly senderId: string | null;
}

/**
 * What a project may spend on SMS, and where (PROJECT.md 4.8).
 *
 * A project with no row sends nothing. That is the same answer as an empty allowlist,
 * and it is deliberate: a missing policy is a project nobody has configured, and the
 * safe reading of "not configured" for a channel that costs money is off.
 */
export class SmsPolicyRepository extends BaseRepository<typeof smsPolicies> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, smsPolicies);
  }

  async current(): Promise<SmsPolicyRow | null> {
    const rows = await this.tx.select().from(smsPolicies).where(this.tenantScope()).limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      allowedCountries: row.allowedCountries,
      dailySpendCap: row.dailySpendCap,
      currency: row.currency,
      attestationRequired: row.attestationRequired,
      perNumberDailyLimit: row.perNumberDailyLimit,
      perIpHourlyLimit: row.perIpHourlyLimit,
      maxSendsPerVerify: row.maxSendsPerVerify,
      senderId: row.senderId,
    };
  }
}
