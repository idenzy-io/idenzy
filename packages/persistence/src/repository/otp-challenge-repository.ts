import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNull, sql } from "drizzle-orm";
import { otpChallenges } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** The cap from PROJECT.md 4.7. Reaching it kills the challenge, code lifetime or not. */
export const MAX_OTP_ATTEMPTS = 5;

export interface NewOtpChallenge {
  readonly channel: string;
  readonly targetHash: string;
  readonly targetEncrypted: string;
  readonly codeHash: string;
  readonly flowId: string;
  readonly expiresAt: Date;
}

export interface OtpChallengeRow {
  readonly id: string;
  readonly channel: string;
  readonly targetHash: string;
  readonly targetEncrypted: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * One-time codes (PROJECT.md 4.7).
 *
 * The code is stored as a password hash rather than a SHA-256 digest, and that is the
 * one decision in this file worth arguing about. A six-digit code has a million
 * possibilities: if this table leaks, every unexpired digest falls to an offline sweep
 * that finishes before the coffee does. A memory-hard hash makes that sweep cost real
 * money, and we pay for it once per issue and at most five times per challenge.
 *
 * Random 256-bit tokens elsewhere in the system are SHA-256 and that is fine, because
 * there is nothing to sweep.
 */
export class OtpChallengeRepository extends BaseRepository<typeof otpChallenges> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, otpChallenges);
  }

  async create(input: NewOtpChallenge): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(otpChallenges)
        .values({
          projectId: this.context.projectId,
          channel: input.channel,
          targetHash: input.targetHash,
          targetEncrypted: input.targetEncrypted,
          codeHash: input.codeHash,
          flowId: input.flowId,
          expiresAt: input.expiresAt,
        })
        .returning({ id: otpChallenges.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "otp_challenge" } });
    return row.id;
  }

  /**
   * Which channel carried a challenge, and nothing else.
   *
   * Its own read because the caller that needs it is choosing which flow to hand the
   * challenge to, and it has no business holding the code hash or the encrypted target
   * to make that choice.
   */
  async channelOf(id: string): Promise<string | null> {
    const rows = await this.tx
      .select({ channel: otpChallenges.channel })
      .from(otpChallenges)
      .where(and(this.tenantScope(), eq(otpChallenges.id, id)))
      .limit(1);
    return rows[0]?.channel ?? null;
  }

  async findById(id: string): Promise<OtpChallengeRow | null> {
    const rows = await this.tx
      .select()
      .from(otpChallenges)
      .where(and(this.tenantScope(), eq(otpChallenges.id, id)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      channel: row.channel,
      targetHash: row.targetHash,
      targetEncrypted: row.targetEncrypted,
      codeHash: row.codeHash,
      attempts: row.attempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  /**
   * Counts a wrong guess and returns the new total.
   *
   * Incremented in SQL rather than read-modify-written, so five parallel guesses cost
   * five attempts. A client-side counter, or a select followed by an update, lets an
   * attacker run the whole keyspace concurrently against a cap that never advances.
   */
  async recordAttempt(id: string): Promise<number> {
    const rows = await this.tx
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(and(this.tenantScope(), eq(otpChallenges.id, id)))
      .returning({ attempts: otpChallenges.attempts });
    return rows[0]?.attempts ?? MAX_OTP_ATTEMPTS;
  }

  /** Single use, decided by the database: the loser of a race gets false. */
  async consume(id: string, at: Date): Promise<boolean> {
    const rows = await this.tx
      .update(otpChallenges)
      .set({ consumedAt: at })
      .where(and(this.tenantScope(), eq(otpChallenges.id, id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    return rows.length === 1;
  }

  /**
   * Retires every outstanding challenge for a target before a new one is issued, so a
   * user who clicks "resend" three times leaves one live code and not three.
   */
  async invalidateOutstanding(channel: string, targetHash: string, at: Date): Promise<number> {
    const rows = await this.tx
      .update(otpChallenges)
      .set({ consumedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(otpChallenges.channel, channel),
          eq(otpChallenges.targetHash, targetHash),
          isNull(otpChallenges.consumedAt),
        ),
      )
      .returning({ id: otpChallenges.id });
    return rows.length;
  }
}
