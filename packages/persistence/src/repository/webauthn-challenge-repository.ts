import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNull } from "drizzle-orm";
import { webauthnChallenges } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/**
 * Which ceremony a challenge was minted for.
 *
 * Stored and checked, because the two are not interchangeable. A registration challenge
 * carries the user it may enrol onto; accepting one at the authentication endpoint would
 * mean a signed-in user could mint a nonce and use it to complete a sign-in that was
 * never bound to anybody.
 */
export const WebauthnCeremony = {
  Registration: "registration",
  Authentication: "authentication",
} as const;
export type WebauthnCeremony = (typeof WebauthnCeremony)[keyof typeof WebauthnCeremony];

export interface NewWebauthnChallenge {
  readonly ceremony: WebauthnCeremony;
  readonly challengeHash: string;
  readonly userId: string | null;
  readonly expiresAt: Date;
}

export interface WebauthnChallengeRow {
  readonly id: string;
  readonly ceremony: string;
  readonly challengeHash: string;
  readonly userId: string | null;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/** The nonce half of a WebAuthn ceremony. Single use, decided by the database. */
export class WebauthnChallengeRepository extends BaseRepository<typeof webauthnChallenges> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, webauthnChallenges);
  }

  async create(input: NewWebauthnChallenge): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(webauthnChallenges)
        .values({
          projectId: this.context.projectId,
          ceremony: input.ceremony,
          challengeHash: input.challengeHash,
          userId: input.userId,
          expiresAt: input.expiresAt,
        })
        .returning({ id: webauthnChallenges.id }),
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ResourceNotFoundError({ detail: { entity: "webauthn_challenge" } });
    }
    return row.id;
  }

  /**
   * Takes a challenge and returns it, or returns null because somebody else already did.
   *
   * Reading and consuming are one statement rather than a select followed by an update,
   * so two ceremonies racing on one challenge cannot both proceed. The database decides
   * the winner, which is the same reason `oauth_flows` consumes its state this way.
   *
   * Claiming happens before verification, never after. A nonce burnt only on success is
   * one an attacker may keep signing against, which is most of what a nonce is for; the
   * cost is that a user whose authenticator fails has to start again, and that is the
   * cheaper half of the trade.
   */
  async claim(id: string, at: Date): Promise<WebauthnChallengeRow | null> {
    const rows = await this.tx
      .update(webauthnChallenges)
      .set({ consumedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(webauthnChallenges.id, id),
          isNull(webauthnChallenges.consumedAt),
        ),
      )
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      ceremony: row.ceremony,
      challengeHash: row.challengeHash,
      userId: row.userId,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }
}
