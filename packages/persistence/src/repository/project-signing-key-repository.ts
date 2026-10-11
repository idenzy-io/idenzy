import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { projectSigningKeys, projects } from "../schema/projects.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface SigningKeyRow {
  readonly id: string;
  readonly kid: string;
  readonly algorithm: string;
  readonly publicJwk: Readonly<Record<string, unknown>>;
  /** The private half, still wrapped. Nothing in this layer can open it. */
  readonly privateKeyWrapped: string;
  readonly isPrimary: boolean;
  readonly retiredAt: Date | null;
}

export interface NewSigningKey {
  readonly kid: string;
  readonly publicJwk: Readonly<Record<string, unknown>>;
  readonly privateKeyWrapped: string;
}

/**
 * A project's token signing keys (PROJECT.md 4.2, ADR-0017).
 *
 * Reads and writes ciphertext. The private half arrives here already wrapped by the cell's KMS key
 * and leaves the same way, so this layer — and anything that gets a look at the database without
 * KMS — holds a blob that opens nowhere.
 */
export class ProjectSigningKeyRepository extends BaseRepository<typeof projectSigningKeys> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, projectSigningKeys);
  }

  /** The key new tokens are signed with, or null before a project has one. */
  async primary(): Promise<SigningKeyRow | null> {
    const rows = await this.tx
      .select()
      .from(projectSigningKeys)
      .where(and(this.tenantScope(), eq(projectSigningKeys.isPrimary, true)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : present(row);
  }

  /**
   * Every key a token might still have been signed with, oldest first.
   *
   * What the JWKS endpoint publishes. It includes retired-but-not-deleted keys deliberately: a
   * token minted a minute before a rotation is valid until it expires, and a verifier that fetched
   * JWKS after the rotation must still find the key that signed it (§4.2's overlap).
   */
  async publishable(): Promise<SigningKeyRow[]> {
    const rows = await this.tx
      .select()
      .from(projectSigningKeys)
      .where(and(this.tenantScope(), isNull(projectSigningKeys.retiredAt)))
      .orderBy(asc(projectSigningKeys.createdAt));
    return rows.map(present);
  }

  /**
   * Adds a key and makes it the one tokens are signed with.
   *
   * Demote then promote, in that order, inside the caller's transaction. The reverse would leave
   * two rows claiming primary for an instant, and the partial unique index would refuse the second
   * — so the order is what makes rotation work rather than a race that usually wins.
   */
  async promote(key: NewSigningKey): Promise<SigningKeyRow> {
    await this.tx
      .update(projectSigningKeys)
      .set({ isPrimary: false })
      .where(and(this.tenantScope(), eq(projectSigningKeys.isPrimary, true)));

    const rows = await this.guard(() =>
      this.tx
        .insert(projectSigningKeys)
        .values({
          projectId: this.context.projectId,
          kid: key.kid,
          publicJwk: key.publicJwk,
          privateKeyWrapped: key.privateKeyWrapped,
          isPrimary: true,
        })
        .returning(),
    );
    // Unreachable: the insert returns its row or the guard has already thrown.
    return present(rows[0] as typeof projectSigningKeys.$inferSelect);
  }

  /**
   * Drops a key out of JWKS.
   *
   * Separate from demotion and deliberately later. A key stops signing the moment another is
   * promoted; it stops *verifying* only once every token it signed has expired, which is why this
   * is a second step on a timer rather than part of the rotation.
   */
  /** Whether the project exists, asked before a key is generated for it. */
  async projectExists(): Promise<boolean> {
    const rows = await this.tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, this.context.projectId))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Makes `key` the primary unless the project already has one, and answers with whichever is.
   *
   * Two processes minting a project's first token at the same moment both generate a key; the
   * partial unique index on the primary lets exactly one insert land, and the other reads that one
   * back. No lock, and no second primary.
   */
  async createPrimaryIfAbsent(key: NewSigningKey): Promise<SigningKeyRow> {
    await this.tx
      .insert(projectSigningKeys)
      .values({
        projectId: this.context.projectId,
        kid: key.kid,
        publicJwk: key.publicJwk,
        privateKeyWrapped: key.privateKeyWrapped,
        isPrimary: true,
      })
      .onConflictDoNothing({
        target: projectSigningKeys.projectId,
        where: sql`is_primary`,
      });
    const primary = await this.primary();
    // Unreachable: the insert landed or another transaction's primary is there to read.
    if (primary === null) {
      throw new ResourceNotFoundError({ detail: { entity: "project_signing_keys" } });
    }
    return primary;
  }

  async retire(kid: string, at: Date): Promise<void> {
    await this.tx
      .update(projectSigningKeys)
      .set({ retiredAt: at })
      .where(and(this.tenantScope(), eq(projectSigningKeys.kid, kid)));
  }
}

function present(row: typeof projectSigningKeys.$inferSelect): SigningKeyRow {
  return {
    id: row.id,
    kid: row.kid,
    algorithm: row.algorithm,
    publicJwk: row.publicJwk as Readonly<Record<string, unknown>>,
    privateKeyWrapped: row.privateKeyWrapped,
    isPrimary: row.isPrimary,
    retiredAt: row.retiredAt,
  };
}
