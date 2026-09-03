import { and, eq } from "drizzle-orm";
import { oauthProviders } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface ProviderConfigRow {
  readonly provider: string;
  readonly clientId: string | null;
  readonly clientSecretEncrypted: string | null;
  readonly scopes: readonly string[];
  readonly settings: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly mode: string;
}

/**
 * What a project configured for each identity provider (PROJECT.md 4.6).
 *
 * The secret comes back still encrypted. Decrypting is the caller's step and happens in
 * the app, where the field encryptor lives, so this class never holds plaintext and a
 * query log or a crash dump of it never does either.
 */
export class OAuthProviderRepository extends BaseRepository<typeof oauthProviders> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, oauthProviders);
  }

  async find(provider: string): Promise<ProviderConfigRow | null> {
    const rows = await this.tx
      .select()
      .from(oauthProviders)
      .where(and(this.tenantScope(), eq(oauthProviders.provider, provider)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      provider: row.provider,
      clientId: row.clientId,
      clientSecretEncrypted: row.clientSecretEncrypted,
      scopes: row.scopes,
      settings: asRecord(row.settings),
      enabled: row.enabled,
      mode: row.mode,
    };
  }

  async listEnabled(): Promise<readonly string[]> {
    const rows = await this.tx
      .select({ provider: oauthProviders.provider })
      .from(oauthProviders)
      .where(and(this.tenantScope(), eq(oauthProviders.enabled, true)));
    return rows.map((row) => row.provider);
  }
}
