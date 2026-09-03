import { ResourceNotFoundError } from "@idenzy/core/errors/errors";
import { and, eq, isNull } from "drizzle-orm";
import { magicLinkTokens } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewMagicLink {
  readonly tokenHash: string;
  readonly userId: string | null;
  readonly redirectUri: string;
  readonly expiresAt: Date;
}

export interface MagicLinkRow {
  readonly id: string;
  readonly userId: string | null;
  readonly redirectUri: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * Magic link tokens (PROJECT.md 4.7).
 *
 * `redirectUri` is resolved against the project allowlist when the token is issued and
 * stored on the row, so the destination is fixed for the token's life. Passing the
 * target at click time instead would make the link an open redirect with our domain in
 * front of it, which is the most valuable phishing asset an auth provider can hand out.
 */
export class MagicLinkRepository extends BaseRepository<typeof magicLinkTokens> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, magicLinkTokens);
  }

  async issue(input: NewMagicLink): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(magicLinkTokens)
        .values({
          projectId: this.context.projectId,
          tokenHash: input.tokenHash,
          userId: input.userId,
          redirectUri: input.redirectUri,
          expiresAt: input.expiresAt,
        })
        .returning({ id: magicLinkTokens.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "magic_link" } });
    return row.id;
  }

  async findByHash(tokenHash: string): Promise<MagicLinkRow | null> {
    const rows = await this.tx
      .select()
      .from(magicLinkTokens)
      .where(and(this.tenantScope(), eq(magicLinkTokens.tokenHash, tokenHash)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      redirectUri: row.redirectUri,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  /**
   * Single use, decided by the database.
   *
   * A mail scanner that follows links pre-consumes the token, which is exactly the
   * failure mode that makes OTP the default and links the option (PROJECT.md 4.7). The
   * race matters here for the same reason: the scanner and the user can arrive together.
   */
  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(magicLinkTokens)
      .set({ consumedAt: at })
      .where(
        and(this.tenantScope(), eq(magicLinkTokens.id, id), isNull(magicLinkTokens.consumedAt)),
      )
      .returning({ id: magicLinkTokens.id });
    return rows.length === 1;
  }
}
