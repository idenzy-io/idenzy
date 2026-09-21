import { ResourceNotFoundError } from "@idenzy/core/errors";
import { and, eq, isNull } from "drizzle-orm";
import { oauthFlows } from "../schema/challenges.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

export interface NewOAuthFlow {
  readonly provider: string;
  readonly state: string;
  readonly codeVerifierEncrypted: string;
  readonly nonce: string | null;
  readonly redirectUri: string;
  readonly linkUserId: string | null;
  readonly expiresAt: Date;
  readonly clientCodeChallenge: string | null;
}

export interface OAuthFlowRow {
  readonly id: string;
  readonly provider: string;
  readonly codeVerifierEncrypted: string;
  readonly nonce: string | null;
  readonly redirectUri: string;
  readonly linkUserId: string | null;
  readonly expiresAt: Date;
  readonly clientCodeChallenge: string | null;
}

/**
 * In-flight OAuth authorizations (PROJECT.md 4.6).
 *
 * `consume` is one statement, and that is the whole design of this class. Reading the
 * row and then marking it used is two, and between them a second callback carrying the
 * same state passes the same check: `state` stops being a one-shot CSRF token and
 * becomes a value that merely has to match, which is the bug this table exists to
 * prevent. The `consumed_at is null` predicate makes the database pick a winner.
 *
 * The provider is part of the predicate as well as the state. A callback arriving at one
 * provider's route carrying a state issued for another is a mix-up attempt, and it finds
 * nothing here rather than being caught later by the issuer check.
 */
export class OAuthFlowRepository extends BaseRepository<typeof oauthFlows> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, oauthFlows);
  }

  async start(input: NewOAuthFlow): Promise<string> {
    const rows = await this.guard(() =>
      this.tx
        .insert(oauthFlows)
        .values({
          projectId: this.context.projectId,
          provider: input.provider,
          state: input.state,
          codeVerifierEncrypted: input.codeVerifierEncrypted,
          nonce: input.nonce,
          redirectUri: input.redirectUri,
          linkUserId: input.linkUserId,
          clientCodeChallenge: input.clientCodeChallenge,
          expiresAt: input.expiresAt,
        })
        .returning({ id: oauthFlows.id }),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "oauth_flow" } });
    return row.id;
  }

  /** Marks the flow used and returns it, or returns null. Never both, never twice. */
  async consume(provider: string, state: string, at: Date): Promise<OAuthFlowRow | null> {
    const rows = await this.tx
      .update(oauthFlows)
      .set({ consumedAt: at })
      .where(
        and(
          this.tenantScope(),
          eq(oauthFlows.provider, provider),
          eq(oauthFlows.state, state),
          isNull(oauthFlows.consumedAt),
        ),
      )
      .returning();
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      provider: row.provider,
      codeVerifierEncrypted: row.codeVerifierEncrypted,
      nonce: row.nonce,
      redirectUri: row.redirectUri,
      linkUserId: row.linkUserId,
      clientCodeChallenge: row.clientCodeChallenge,
      expiresAt: row.expiresAt,
    };
  }
}
