import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq } from "drizzle-orm";
import { identities } from "../schema/identity.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";

export interface NewIdentity {
  readonly userId: string;
  readonly provider: string;
  readonly providerUserId: string;
  readonly email: string | null;
  readonly providerData: Readonly<Record<string, unknown>>;
  readonly encryptedTokens: string | null;
}

export interface IdentityRow {
  readonly id: string;
  readonly userId: string;
  readonly provider: string;
  readonly providerUserId: string;
  readonly email: string | null;
  readonly providerData: Readonly<Record<string, unknown>>;
  readonly createdAt: Date;
}

/**
 * Federated identities: one row per provider account (PROJECT.md 4.6).
 *
 * `findByAccount` keys on the provider's subject and never on the email address, which
 * is the only lookup that is safe to do unconditionally. An address can change hands, a
 * subject cannot, and searching by address is how a provider account gets attached to
 * somebody else's user.
 */
export class IdentityRepository extends BaseRepository<typeof identities> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, identities);
  }

  async findByAccount(provider: string, providerUserId: string): Promise<IdentityRow | null> {
    const rows = await this.tx
      .select()
      .from(identities)
      .where(
        and(
          this.tenantScope(),
          eq(identities.provider, provider),
          eq(identities.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    return this.toRow(rows[0]);
  }

  async listForUser(userId: string): Promise<readonly IdentityRow[]> {
    const rows = await this.tx
      .select()
      .from(identities)
      .where(and(this.tenantScope(), eq(identities.userId, userId)));
    return rows.map((row) => this.required(row));
  }

  /**
   * Attaches a provider account to a user.
   *
   * A duplicate surfaces as a 409 from the unique index rather than as a check followed
   * by an insert, which would be a race and would let two sign-ins arriving together
   * both believe the account was free.
   */
  async link(input: NewIdentity): Promise<IdentityRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(identities)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          provider: input.provider,
          providerUserId: input.providerUserId,
          email: input.email,
          providerData: input.providerData,
          encryptedTokens: input.encryptedTokens,
        })
        .returning(),
    );
    return this.required(rows[0]);
  }

  /** Refreshes what the provider last told us, on every sign-in. */
  async touch(
    id: string,
    email: string | null,
    providerData: Readonly<Record<string, unknown>>,
    encryptedTokens: string | null,
  ): Promise<void> {
    await this.tx
      .update(identities)
      .set({ email, providerData, encryptedTokens })
      .where(and(this.tenantScope(), eq(identities.id, id)));
  }

  async unlink(userId: string, provider: string): Promise<boolean> {
    const rows = await this.tx
      .delete(identities)
      .where(
        and(this.tenantScope(), eq(identities.userId, userId), eq(identities.provider, provider)),
      )
      .returning({ id: identities.id });
    return rows.length > 0;
  }

  private toRow(row: typeof identities.$inferSelect | undefined): IdentityRow | null {
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      providerUserId: row.providerUserId,
      email: row.email,
      providerData: asRecord(row.providerData),
      createdAt: row.createdAt,
    };
  }

  private required(row: typeof identities.$inferSelect | undefined): IdentityRow {
    const mapped = this.toRow(row);
    if (mapped === null) throw new ResourceNotFoundError({ detail: { entity: "identity" } });
    return mapped;
  }
}
