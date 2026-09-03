import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNull, sql } from "drizzle-orm";
import { mfaChallenges } from "../schema/mfa.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** The same cap an OTP gets. Reaching it kills the challenge, lifetime or not. */
export const MAX_MFA_ATTEMPTS = 5;

export interface NewMfaChallenge {
  readonly userId: string;
  readonly purpose: string;
  readonly sessionId: string | null;
  readonly amr: readonly string[];
  readonly expiresAt: Date;
}

export interface MfaChallengeRow {
  readonly id: string;
  readonly userId: string;
  readonly purpose: string;
  readonly sessionId: string | null;
  readonly amr: readonly string[];
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * A proved first factor waiting on a second (PROJECT.md 4.5).
 *
 * Shaped like the OTP challenge on purpose, down to the attempt counter being an in-SQL
 * increment: a six-digit TOTP code has the same million candidates, and a cap that a
 * client-side counter advances is a cap concurrent guesses walk straight past.
 */
export class MfaChallengeRepository extends BaseRepository<typeof mfaChallenges> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, mfaChallenges);
  }

  async create(input: NewMfaChallenge): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(mfaChallenges)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          purpose: input.purpose,
          sessionId: input.sessionId,
          amr: [...input.amr],
          expiresAt: input.expiresAt,
        })
        .returning({ id: mfaChallenges.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "mfa_challenge" } });
    return row.id;
  }

  async findById(id: string): Promise<MfaChallengeRow | null> {
    const rows = await this.tx
      .select()
      .from(mfaChallenges)
      .where(and(this.tenantScope(), eq(mfaChallenges.id, id)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      userId: row.userId,
      purpose: row.purpose,
      sessionId: row.sessionId,
      amr: row.amr,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  /** Counts a wrong guess and returns the new total, incremented in SQL. */
  async recordAttempt(id: string): Promise<number> {
    const rows = await this.tx
      .update(mfaChallenges)
      .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
      .where(and(this.tenantScope(), eq(mfaChallenges.id, id)))
      .returning({ attempts: mfaChallenges.attempts });
    return rows[0]?.attempts ?? MAX_MFA_ATTEMPTS;
  }

  /** Single use, decided by the database: the loser of a race gets false. */
  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(mfaChallenges)
      .set({ consumedAt: at })
      .where(and(this.tenantScope(), eq(mfaChallenges.id, id), isNull(mfaChallenges.consumedAt)))
      .returning({ id: mfaChallenges.id });
    return rows.length === 1;
  }
}
