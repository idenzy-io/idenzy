import { ResourceNotFoundError } from "@idenzy/core/errors/errors";
import { and, eq, isNull } from "drizzle-orm";
import { authCodes } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewAuthCode {
  readonly userId: string;
  readonly codeHash: string;
  readonly amr: readonly string[];
  readonly redirectUri: string;
  readonly expiresAt: Date;
}

export interface AuthCodeRow {
  readonly id: string;
  readonly userId: string;
  readonly amr: readonly string[];
  readonly redirectUri: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * The single-use code a redirect hands to the customer's own route (PROJECT.md 4.6, 4.7).
 *
 * Every browser-redirect flow ends here, magic link now and OAuth next, which is why it
 * is not called `magic_link_codes`: the exchange is the same regardless of what proved
 * the identity, and one implementation means one place where the single-use rule lives.
 */
export class AuthCodeRepository extends BaseRepository<typeof authCodes> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, authCodes);
  }

  async issue(input: NewAuthCode): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(authCodes)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          codeHash: input.codeHash,
          amr: [...input.amr],
          redirectUri: input.redirectUri,
          expiresAt: input.expiresAt,
        })
        .returning({ id: authCodes.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "auth_code" } });
    return row.id;
  }

  async findByHash(codeHash: string): Promise<AuthCodeRow | null> {
    const rows = await this.tx
      .select()
      .from(authCodes)
      .where(and(this.tenantScope(), eq(authCodes.codeHash, codeHash)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      amr: row.amr,
      redirectUri: row.redirectUri,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  /**
   * Single use, decided by the database.
   *
   * A code travels in a URL, so it reaches browser history, the Referer header and the
   * customer's access logs. Assume it is public the moment it is used once.
   */
  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(authCodes)
      .set({ consumedAt: at })
      .where(and(this.tenantScope(), eq(authCodes.id, id), isNull(authCodes.consumedAt)))
      .returning({ id: authCodes.id });
    return rows.length === 1;
  }
}
