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

  /**
   * Every provider the project has configured, enabled or not.
   *
   * Separate from `listEnabled`, which is on the sign-in path and answers one question as
   * cheaply as it can. This one is the dashboard's and carries the whole row, the encrypted
   * secret included — the service strips it, because a repository that decided what a
   * caller may see would be making an authorisation decision in the wrong layer.
   */
  async list(): Promise<readonly ProviderConfigRow[]> {
    const rows = await this.tx
      .select()
      .from(oauthProviders)
      .where(this.tenantScope())
      .orderBy(oauthProviders.provider);
    return rows.map((row) => ({
      provider: row.provider,
      clientId: row.clientId,
      clientSecretEncrypted: row.clientSecretEncrypted,
      scopes: row.scopes,
      settings: asRecord(row.settings),
      enabled: row.enabled,
      mode: row.mode,
    }));
  }

  /**
   * Writes a provider's configuration, creating the row if there is none.
   *
   * `clientSecretEncrypted` is `undefined` to leave the stored secret alone and a string to
   * replace it. That distinction is the whole reason this takes a partial: the panel never
   * reads a secret back, so every save it makes would otherwise blank the one already
   * there — the screen shows "a secret is stored" and the save would quietly make that
   * false.
   */
  async upsert(input: {
    readonly provider: string;
    readonly clientId: string | null;
    readonly clientSecretEncrypted?: string | null;
    readonly scopes: readonly string[];
    readonly settings: Readonly<Record<string, unknown>>;
    readonly enabled: boolean;
    readonly mode: string;
  }): Promise<void> {
    const secret =
      input.clientSecretEncrypted === undefined
        ? {}
        : { clientSecretEncrypted: input.clientSecretEncrypted };
    await this.tx
      .insert(oauthProviders)
      .values({
        projectId: this.context.projectId,
        provider: input.provider,
        clientId: input.clientId,
        scopes: [...input.scopes],
        settings: input.settings,
        enabled: input.enabled,
        mode: input.mode,
        ...secret,
      })
      .onConflictDoUpdate({
        target: [oauthProviders.projectId, oauthProviders.provider],
        set: {
          clientId: input.clientId,
          scopes: [...input.scopes],
          settings: input.settings,
          enabled: input.enabled,
          mode: input.mode,
          ...secret,
        },
      });
  }

  /** Removes the configuration entirely. Identities already linked through it survive. */
  async remove(provider: string): Promise<boolean> {
    const rows = await this.tx
      .delete(oauthProviders)
      .where(and(this.tenantScope(), eq(oauthProviders.provider, provider)))
      .returning({ provider: oauthProviders.provider });
    return rows.length > 0;
  }

  async listEnabled(): Promise<readonly string[]> {
    const rows = await this.tx
      .select({ provider: oauthProviders.provider })
      .from(oauthProviders)
      .where(and(this.tenantScope(), eq(oauthProviders.enabled, true)));
    return rows.map((row) => row.provider);
  }
}
