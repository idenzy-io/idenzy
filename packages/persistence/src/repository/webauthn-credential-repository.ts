import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, asc, eq } from "drizzle-orm";
import { webauthnCredentials } from "../schema/mfa.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewWebauthnCredential {
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly aaguid: string | null;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly name: string | null;
}

export interface WebauthnCredentialRow {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly aaguid: string | null;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  readonly name: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

/**
 * Enrolled passkeys (PROJECT.md 4.7).
 *
 * `findByCredentialId` is the whole of how a passkey sign-in identifies its user, which
 * is why the lookup is tenant-scoped and keyed on the unique index rather than on the
 * user. A discoverable credential names itself and nothing else, so the credential id
 * arriving from the browser is the only thing we have to go on, and resolving it inside
 * the tenant is what stops one project's authenticator asserting into another's.
 */
export class WebauthnCredentialRepository extends BaseRepository<typeof webauthnCredentials> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, webauthnCredentials);
  }

  async findByCredentialId(credentialId: string): Promise<WebauthnCredentialRow | null> {
    const rows = await this.tx
      .select()
      .from(webauthnCredentials)
      .where(and(this.tenantScope(), eq(webauthnCredentials.credentialId, credentialId)))
      .limit(1);
    return this.toRow(rows[0]);
  }

  async findForUser(id: string, userId: string): Promise<WebauthnCredentialRow | null> {
    const rows = await this.tx
      .select()
      .from(webauthnCredentials)
      .where(
        and(
          this.tenantScope(),
          eq(webauthnCredentials.id, id),
          eq(webauthnCredentials.userId, userId),
        ),
      )
      .limit(1);
    return this.toRow(rows[0]);
  }

  async listForUser(userId: string): Promise<readonly WebauthnCredentialRow[]> {
    const rows = await this.tx
      .select()
      .from(webauthnCredentials)
      .where(and(this.tenantScope(), eq(webauthnCredentials.userId, userId)))
      .orderBy(asc(webauthnCredentials.createdAt));
    return rows.map((row) => this.required(row));
  }

  /**
   * Enrols a credential.
   *
   * A credential already registered anywhere in the project collides on the unique index
   * and surfaces as a 409 rather than as a check followed by an insert. That matters
   * more here than elsewhere: the check-then-insert version lets the same authenticator
   * be attached to two accounts by two requests arriving together, and the second
   * account then signs in with somebody else's device.
   */
  async register(input: NewWebauthnCredential): Promise<WebauthnCredentialRow> {
    const rows = await this.guard(() =>
      this.tx
        .insert(webauthnCredentials)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          credentialId: input.credentialId,
          publicKey: input.publicKey,
          signCount: input.signCount,
          transports: [...input.transports],
          aaguid: input.aaguid,
          backupEligible: input.backupEligible,
          backupState: input.backupState,
          name: input.name,
        })
        .returning(),
    );
    return this.required(rows[0]);
  }

  /**
   * Advances the sign counter after an assertion verifies.
   *
   * The counter is the clone signal, so it is stored on every use and never skipped:
   * an authenticator that reports a value it has already used is either replayed or
   * copied, and the stored value is the only thing that can tell. `backupState` is
   * written here too because it genuinely changes over a credential's life, when a
   * platform authenticator that was eligible for backup is finally backed up.
   */
  async recordUse(id: string, signCount: number, backupState: boolean, at: Date): Promise<void> {
    await this.tx
      .update(webauthnCredentials)
      .set({ signCount, backupState, lastUsedAt: at })
      .where(and(this.tenantScope(), eq(webauthnCredentials.id, id)));
  }

  async rename(id: string, userId: string, name: string): Promise<boolean> {
    const rows = await this.tx
      .update(webauthnCredentials)
      .set({ name })
      .where(
        and(
          this.tenantScope(),
          eq(webauthnCredentials.id, id),
          eq(webauthnCredentials.userId, userId),
        ),
      )
      .returning({ id: webauthnCredentials.id });
    return rows.length === 1;
  }

  /** Scoped to the owner as well as the tenant, so an id alone cannot delete a stranger's. */
  async remove(id: string, userId: string): Promise<boolean> {
    const rows = await this.tx
      .delete(webauthnCredentials)
      .where(
        and(
          this.tenantScope(),
          eq(webauthnCredentials.id, id),
          eq(webauthnCredentials.userId, userId),
        ),
      )
      .returning({ id: webauthnCredentials.id });
    return rows.length === 1;
  }

  private toRow(
    row: typeof webauthnCredentials.$inferSelect | undefined,
  ): WebauthnCredentialRow | null {
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      credentialId: row.credentialId,
      publicKey: row.publicKey,
      signCount: row.signCount,
      transports: row.transports,
      aaguid: row.aaguid,
      backupEligible: row.backupEligible,
      backupState: row.backupState,
      name: row.name,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  private required(
    row: typeof webauthnCredentials.$inferSelect | undefined,
  ): WebauthnCredentialRow {
    const mapped = this.toRow(row);
    if (mapped === null) {
      throw new ResourceNotFoundError({ detail: { entity: "webauthn_credential" } });
    }
    return mapped;
  }
}
