import { ResourceNotFoundError } from "@idenzy/core/errors";
import { Session, type SessionState } from "@idenzy/domain/entities/session";
import type { AuthMethod, SessionRevokeReason } from "@idenzy/protocol/enums/auth";
import { and, desc, eq, inArray, isNull, lt, ne, or, type SQL } from "drizzle-orm";
import { sessions } from "../schema/sessions.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";

/** A raw session row, as the operator list hands it out before wire shaping. */
export type SessionRow = typeof sessions.$inferSelect;

export interface NewSession {
  readonly userId: string;
  readonly amr: readonly AuthMethod[];
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  readonly factorVerifiedAt: Date | null;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionListItem {
  readonly id: string;
  readonly deviceName: string | null;
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
  constructor(tx: CellTx, context: TenantContext) {
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
          deviceName: input.deviceName,
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
      deviceName: row.deviceName,
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

  /**
   * Every session in the project, newest activity first, for the operator's list.
   *
   * `listForUser` answers the account's own question and this one answers the project's,
   * which is why it is a second method rather than a nullable parameter on the first: the
   * ordering differs — a person reading their own devices wants the one they are on, an
   * operator hunting a device wants whatever moved last — and the predicate differs too,
   * because this one defaults to hiding what is already revoked.
   *
   * Keyset paging on `(last_active_at, id)`, for the reason the users list uses one: an
   * offset skips a row for every session that becomes active behind the reader, which on
   * this table is constant.
   */
  async listForProject(options: {
    readonly userId?: string | undefined;
    readonly includeRevoked: boolean;
    readonly limit: number;
    readonly cursor?: string | undefined;
  }): Promise<{ readonly sessions: readonly SessionRow[]; readonly nextCursor: string | null }> {
    const predicates: (SQL | undefined)[] = [this.tenantScope()];
    if (options.userId !== undefined) predicates.push(eq(sessions.userId, options.userId));
    if (!options.includeRevoked) predicates.push(isNull(sessions.revokedAt));

    const cursor = decodeSessionCursor(options.cursor);
    if (cursor !== null) {
      predicates.push(
        or(
          lt(sessions.lastActiveAt, cursor.lastActiveAt),
          and(eq(sessions.lastActiveAt, cursor.lastActiveAt), lt(sessions.id, cursor.id)),
        ),
      );
    }

    const rows = await this.tx
      .select()
      .from(sessions)
      .where(and(...predicates))
      .orderBy(desc(sessions.lastActiveAt), desc(sessions.id))
      .limit(options.limit + 1);

    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > options.limit && last !== undefined
        ? encodeSessionCursor(last.lastActiveAt, last.id)
        : null;

    return { sessions: page, nextCursor };
  }

  /**
   * Ends the named sessions and answers with the ids it actually ended.
   *
   * One statement, and the already-revoked are excluded by the predicate rather than
   * filtered afterwards: two operators pressing the same button must not both be told they
   * ended it. The ids come back so the caller can report a number it can stand behind.
   */
  async revokeMany(
    ids: readonly string[],
    reason: SessionRevokeReason,
    at: Date,
  ): Promise<readonly string[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx
      .update(sessions)
      .set({ revokedAt: at, revokeReason: reason })
      .where(and(this.tenantScope(), inArray(sessions.id, ids), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.map((row) => row.id);
  }

  /** Slides the idle window. Called on refresh, which is the only proof of liveness we get. */
  async touch(id: string, at: Date, idleExpiresAt: Date): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ lastActiveAt: at, idleExpiresAt })
      .where(and(this.tenantScope(), eq(sessions.id, id)));
  }

  /**
   * Records that a second factor was proved inside this session (PROJECT.md 4.5).
   *
   * Writes `amr` alongside the timestamp, because the two are one fact: a session that
   * claimed a factor age without naming what proved it would be a claim nothing backs.
   * Scoped by user as well as by id, so a step-up cannot raise the factor age of a
   * session that is not the caller's.
   */
  async recordFactorVerification(
    id: string,
    userId: string,
    at: Date,
    amr: readonly string[],
  ): Promise<boolean> {
    const rows = await this.tx
      .update(sessions)
      .set({ factorVerifiedAt: at, amr: [...amr] })
      .where(and(this.tenantScope(), eq(sessions.id, id), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });
    return rows.length === 1;
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
   *
   * Returns the ids rather than a count, because the caller has to revoke the refresh
   * tokens behind them and cannot ask for them again once they are no longer active.
   */
  async revokeAllForUser(
    userId: string,
    reason: SessionRevokeReason,
    at: Date,
    exceptId: string | null = null,
  ): Promise<readonly string[]> {
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
    return rows.map((row) => row.id);
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

function encodeSessionCursor(lastActiveAt: Date, id: string): string {
  return Buffer.from(`${lastActiveAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

/** A cursor we cannot read is the first page, not an error. See the users list for why. */
function decodeSessionCursor(
  cursor: string | undefined,
): { lastActiveAt: Date; id: string } | null {
  if (cursor === undefined || cursor.length === 0) return null;
  try {
    const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (at === undefined || id === undefined) return null;
    const lastActiveAt = new Date(at);
    if (Number.isNaN(lastActiveAt.getTime())) return null;
    return { lastActiveAt, id };
  } catch {
    return null;
  }
}
