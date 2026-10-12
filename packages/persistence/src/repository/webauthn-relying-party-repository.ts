import { webauthnRelyingParties } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface RelyingPartyRow {
  readonly rpId: string;
  readonly rpName: string;
  readonly origins: readonly string[];
}

/**
 * A project's relying party configuration.
 *
 * There is no method that takes an origin and guesses an RP ID, and there will not be
 * one. The RP ID decides which credentials an assertion can even address, so deriving it
 * from whatever origin a request happened to arrive from is the passkey equivalent of a
 * prefix-matched redirect allowlist.
 */
export class WebauthnRelyingPartyRepository extends BaseRepository<typeof webauthnRelyingParties> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, webauthnRelyingParties);
  }

  async find(): Promise<RelyingPartyRow | null> {
    const rows = await this.tx
      .select()
      .from(webauthnRelyingParties)
      .where(this.tenantScope())
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return { rpId: row.rpId, rpName: row.rpName, origins: row.origins };
  }

  /** Creates the project's relying party or replaces it; the unique index makes it the one. */
  async upsert(party: RelyingPartyRow): Promise<void> {
    await this.tx
      .insert(webauthnRelyingParties)
      .values({
        projectId: this.context.projectId,
        rpId: party.rpId,
        rpName: party.rpName,
        origins: [...party.origins],
      })
      .onConflictDoUpdate({
        target: [webauthnRelyingParties.projectId],
        set: { rpId: party.rpId, rpName: party.rpName, origins: [...party.origins] },
      });
  }
}
