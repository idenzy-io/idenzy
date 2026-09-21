import { ResourceNotFoundError } from "@idenzy/core/errors";
import type { VerificationPurpose } from "@idenzy/protocol/enums/auth";
import { and, eq, isNull } from "drizzle-orm";
import { verificationTokens } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewVerificationToken {
  readonly userId: string;
  readonly purpose: VerificationPurpose;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export interface VerificationTokenRow {
  readonly id: string;
  readonly userId: string;
  readonly purpose: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * Single-use tokens for email verification and password reset (PROJECT.md 4.5).
 *
 * `findByHash` takes the purpose as well as the hash, and that is not defensive
 * duplication: a token minted to reset a password must not be accepted as proof that an
 * address is real, or anyone who can trigger a reset for an address they do not own can
 * have it marked verified.
 */
export class VerificationTokenRepository extends BaseRepository<typeof verificationTokens> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, verificationTokens);
  }

  async issue(input: NewVerificationToken): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(verificationTokens)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          purpose: input.purpose,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning({ id: verificationTokens.id }),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ResourceNotFoundError({ detail: { entity: "verification_token" } });
    }
    return row.id;
  }

  async findByHash(
    purpose: VerificationPurpose,
    tokenHash: string,
  ): Promise<VerificationTokenRow | null> {
    const rows = await this.tx
      .select()
      .from(verificationTokens)
      .where(
        and(
          this.tenantScope(),
          eq(verificationTokens.purpose, purpose),
          eq(verificationTokens.tokenHash, tokenHash),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      purpose: row.purpose,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(verificationTokens)
      .set({ consumedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(verificationTokens.id, id),
          isNull(verificationTokens.consumedAt),
        ),
      )
      .returning({ id: verificationTokens.id });
    return rows.length === 1;
  }

  /**
   * Retires every other outstanding token of this purpose for the user.
   *
   * Called when one is issued and again when one is used, so a reset link mailed an hour
   * ago stops working the moment a newer one is requested. Without it, every reset mail
   * a user has ever received stays live until it expires, and the oldest one is the one
   * most likely to be sitting in a mailbox someone else can read.
   */
  async invalidateOutstanding(
    userId: string,
    purpose: VerificationPurpose,
    at: Date,
  ): Promise<number> {
    const rows = await this.tx
      .update(verificationTokens)
      .set({ consumedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(verificationTokens.userId, userId),
          eq(verificationTokens.purpose, purpose),
          isNull(verificationTokens.consumedAt),
        ),
      )
      .returning({ id: verificationTokens.id });
    return rows.length;
  }
}
