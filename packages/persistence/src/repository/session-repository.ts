import { ResourceNotFoundError } from "@idenzy/core/errors/errors";
import { Session, type SessionState } from "@idenzy/domain/entities/session";
import type { AuthMethod, SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { sessions } from "../schema/sessions.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { Transaction } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

type SessionRow = typeof sessions.$inferSelect;

export interface NewSession {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly deviceId: string | null;
  readonly factorVerifiedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

/** A session row as the "your devices" list needs it, before it is shaped for the wire. */
export interface SessionListItem {
  readonly id: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly amr: readonly AuthMethod[];
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokeReason: SessionRevokeReason | null;
}

/**
 * Session records, the server-side half of the token model (PROJECT.md 4.2).
 *
 * Revocation is a write here, not a token property, which is what makes "sign out
 * everywhere" instant regardless of how long an access token still has to live.
 */
export class SessionRepository extends BaseRepository<typeof sessions> {
  constructor(tx: Transaction, context: TenantContext) {
    super(tx, context, sessions);
  }

  async create(input: NewSession): Promise<Session> {
    const rows = await this.guard(() =>
      this.tx
        .insert(sessions)
        .values({
          projectId: this.context.projectId,
          userId: input.userId,
          amr: [...input.amr],
          ip: input.ip,
          userAgent: input.userAgent,
          deviceId: input.deviceId,
          factorVerifiedAt: input.factorVerifiedAt,
          idleExpiresAt: input.idleExpiresAt,
          absoluteExpiresAt: input.absoluteExpiresAt,
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "session" } });
    return this.toEntity(row);
  }

  async findById(id: string): Promise<Session | null> {
    const rows = await this.tx
      .select()
      .from(sessions)
      .where(and(this.tenantScope(), eq(sessions.id, id)))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : this.toEntity(row);
  }

  /** Includes revoked and expired rows: "your devices" is also a security history. */
  async listForUser(userId: string, limit = 100): Promise<readonly SessionListItem[]> {
    const rows = await this.tx
      .select()
      .from(sessions)
      .where(and(this.tenantScope(), eq(sessions.userId, userId)))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(limit);
    return rows.map((row) => ({
      id: row.id,
      ip: row.ip,
      userAgent: row.userAgent,
      amr: this.toAmr(row.amr),
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      revokedAt: row.revokedAt,
      revokeReason: row.revokeReason as SessionRevokeReason | null,
    }));
  }

  /** Slides the idle window. Called on refresh, which is the only proof of liveness we get. */
  async touch(id: string, at: Date, idleExpiresAt: Date): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ lastActiveAt: at, idleExpiresAt })
      .where(and(this.tenantScope(), eq(sessions.id, id)));
  }

  /** Idempotent: an already-revoked session keeps its original reason and timestamp. */
  async revoke(id: string, reason: SessionRevokeReason, at: Date): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ revokedAt: at, revokeReason: reason })
      .where(and(this.tenantScope(), eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  /**
   * Sign out everywhere. `exceptId` keeps the session doing the signing out alive, which
   * is what a password change wants: end every other session without logging the user
   * out of the device they are holding.
   */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    at: Date,
    exceptId: string | null = null,
  ): Promise<number> {
    const rows = await this.tx
      .update(sessions)
      .set({ revokedAt: at, revokeReason: reason })
      .where(
        and(
          this.tenantScope(),
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptId === null ? undefined : ne(sessions.id, exceptId),
        ),
      )
      .returning({ id: sessions.id });
    return rows.length;
  }

  private toEntity(row: SessionRow): Session {
    const state: SessionState = {
      id: row.id,
      projectId: row.projectId,
      userId: row.userId,
      amr: this.toAmr(row.amr),
      factorVerifiedAt: row.factorVerifiedAt,
      idleExpiresAt: row.idleExpiresAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
      revokedAt: row.revokedAt,
      revokeReason: row.revokeReason as SessionRevokeReason | null,
    };
    return new Session(state);
  }

  /**
   * `amr` is a text array in Postgres and an enum in the protocol. The cast is safe in
   * one direction only: we write values from the enum, so anything else in the column
   * came from outside this application and would be a bigger problem than a bad claim.
   */
  private toAmr(value: readonly string[]): readonly AuthMethod[] {
    return value as readonly AuthMethod[];
  }
}
