import { ResourceNotFoundError } from "@idenzy/core/errors";
import {
  RefreshTokenFamily,
  type RefreshTokenState,
} from "@idenzy/domain/entities/refresh-token-family";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { refreshTokens } from "../schema/sessions.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewRefreshToken {
  readonly sessionId: string;
  readonly familyId: string;
  readonly tokenHash: string;
  readonly parentId: string | null;
  readonly expiresAt: Date;
}

/**
 * Rotating refresh tokens and their families (PROJECT.md 4.2).
 *
 * Only the SHA-256 hash is ever stored or queried, so a read of this table yields
 * nothing usable. The interesting method is `consume`, which is the race in this design:
 * two concurrent refreshes must not both succeed.
 */
export class RefreshTokenRepository extends BaseRepository<typeof refreshTokens> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, refreshTokens);
  }

  async issue(input: NewRefreshToken): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(refreshTokens)
        .values({
          projectId: this.context.projectId,
          sessionId: input.sessionId,
          familyId: input.familyId,
          tokenHash: input.tokenHash,
          parentId: input.parentId,
          expiresAt: input.expiresAt,
        })
        .returning({ id: refreshTokens.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "refresh_token" } });
    return row.id;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenState | null> {
    const rows = await this.tx
      .select()
      .from(refreshTokens)
      .where(and(this.tenantScope(), eq(refreshTokens.tokenHash, tokenHash)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      familyId: row.familyId,
      sessionId: row.sessionId,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
    };
  }

  /** The decision object for a token, so the reuse rule stays in the entity. */
  family(state: RefreshTokenState): RefreshTokenFamily {
    return new RefreshTokenFamily(state);
  }

  /**
   * Marks a token rotated, and reports whether this call is the one that did it.
   *
   * The `usedAt is null` predicate is the whole point. Two requests presenting the same
   * token can both pass the reuse check a moment apart, and only one `UPDATE` can match;
   * the loser gets false and must be treated as reuse. Without this the race is a real
   * bypass of reuse detection, not a theoretical one.
   */
  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(refreshTokens)
      .set({ usedAt: at })
      .where(and(this.tenantScope(), eq(refreshTokens.id, id), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id });
    return rows.length === 1;
  }

  /** Reuse means every descendant of one sign-in is suspect, so the family goes together. */
  async revokeFamily(familyId: string, at: Date): Promise<number> {
    const rows = await this.tx
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  /** Defence in depth on sign-out-everywhere: the sessions are already revoked. */
  async revokeForSessions(sessionIds: readonly string[], at: Date): Promise<number> {
    if (sessionIds.length === 0) return 0;
    const rows = await this.tx
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(
        and(
          this.tenantScope(),
          inArray(refreshTokens.sessionId, [...sessionIds]),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length;
  }

  async revokeForSession(sessionId: string, at: Date): Promise<number> {
    const rows = await this.tx
      .update(refreshTokens)
      .set({ revokedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(refreshTokens.sessionId, sessionId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning({ id: refreshTokens.id });
    return rows.length;
  }
}
