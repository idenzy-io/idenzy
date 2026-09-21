import { ResourceNotFoundError } from "@idenzy/core/errors";
import { User } from "@idenzy/domain/entities/user";
import { and, eq } from "drizzle-orm";
import { users } from "../schema/identity.js";
import type { TenantContext } from "../tenancy/tenant-context.js";
import type { CellTx } from "../tenancy/unit-of-work.js";
import { BaseRepository } from "./base-repository.js";
import { asRecord } from "./jsonb.js";
import { OutboxRepository } from "./outbox-repository.js";

type UserRow = typeof users.$inferSelect;

export interface NewUser {
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly phone: string | null;
  readonly phoneVerified?: boolean;
  readonly passwordHash: string | null;
  readonly passwordAlgoVersion: number | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly metadataPublic?: Readonly<Record<string, unknown>>;
}

/**
 * Reads and writes users within one tenant transaction.
 *
 * Every method starts from `tenantScope()`, and the RLS policy on the table is the
 * second, independent line if one ever does not (ADR-0003). Lookups return the `User`
 * entity rather than a row, so the sign-in rules live in one place and this class stays
 * about SQL.
 */
export class UserRepository extends BaseRepository<typeof users> {
  constructor(tx: CellTx, context: TenantContext) {
    super(tx, context, users);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.id, id)))
      .limit(1);
    return this.toEntity(rows[0]);
  }

  /**
   * Case is already folded by `emailSchema` at the boundary, so this is an exact match
   * on the same value the unique index enforces.
   */
  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.email, email)))
      .limit(1);
    return this.toEntity(rows[0]);
  }

  /**
   * Exact match on E.164, which is what the unique index enforces.
   *
   * There is no normalising here on purpose: the value object parses at the boundary, so
   * a number that reached this far is already in the one form we store. Normalising in
   * two places is how a lookup and an index stop agreeing.
   */
  async findByPhone(phone: string): Promise<User | null> {
    const rows = await this.tx
      .select()
      .from(users)
      .where(and(this.tenantScope(), eq(users.phone, phone)))
      .limit(1);
    return this.toEntity(rows[0]);
  }

  /**
   * Writes a user, and announces it in the same statement's transaction.
   *
   * **The `user.created` event is emitted here rather than by the flows**, which is the only place it
   * can be both unforgettable and correct. Six paths create a user — password sign-up, magic link,
   * two OTP channels, an OAuth first link and an anonymous session — and a seventh will be added by
   * somebody who has not read this file; an event each of them has to remember to enqueue is the
   * design PROJECT.md 7.3 rules out. It also has to be in *this* transaction, because an outbox row
   * written after the commit is an event a crash loses and an event a rollback invents (PROJECT.md
   * 9.4), which rules out the `AuthFlow` base that owns the rest of a sign-in's ordering.
   *
   * What the event says is "an account exists" and no more. Not how it was created: the method
   * belongs to the sign-in that follows, which is its own event a moment later, and a bulk import
   * will want a path that creates accounts without claiming six hundred thousand people just signed
   * up.
   */
  async create(input: NewUser): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .insert(users)
        .values({
          projectId: this.context.projectId,
          email: input.email,
          emailVerified: input.emailVerified,
          phone: input.phone,
          phoneVerified: input.phoneVerified ?? false,
          passwordHash: input.passwordHash,
          passwordAlgoVersion: input.passwordAlgoVersion,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
          metadataPublic: input.metadataPublic ?? {},
        })
        .returning(),
    );
    const row = rows[0];
    if (row === undefined) throw new ResourceNotFoundError({ detail: { entity: "user" } });

    await new OutboxRepository(this.tx, this.context).enqueue("user.created", {
      userId: row.id,
      email: row.email,
      phone: row.phone,
      emailVerified: row.emailVerified,
      phoneVerified: row.phoneVerified,
      // The row's own instant rather than a clock this class does not have: the event happened when
      // the insert did.
      at: row.createdAt.toISOString(),
    });
    return this.required(row);
  }

  /** Used both by reset and by a transparent rehash after a successful sign-in. */
  async setPassword(userId: string, hash: string, algorithmVersion: number): Promise<void> {
    await this.tx
      .update(users)
      .set({ passwordHash: hash, passwordAlgoVersion: algorithmVersion, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  async setEmail(userId: string, email: string, verified: boolean): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .update(users)
        .set({ email, emailVerified: verified, updatedAt: new Date() })
        .where(and(this.tenantScope(), eq(users.id, userId)))
        .returning(),
    );
    return this.required(rows[0]);
  }

  async setEmailVerified(userId: string, verified: boolean): Promise<void> {
    await this.tx
      .update(users)
      .set({ emailVerified: verified, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  async setPhoneVerified(userId: string, verified: boolean): Promise<void> {
    await this.tx
      .update(users)
      .set({ phoneVerified: verified, updatedAt: new Date() })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  /**
   * Turns an anonymous account into a real one in place, so everything the customer
   * already attached to the user id survives the upgrade (PROJECT.md 3.1).
   */
  async attachCredentials(
    userId: string,
    email: string,
    hash: string,
    algorithmVersion: number,
  ): Promise<User> {
    const rows = await this.guard(() =>
      this.tx
        .update(users)
        .set({
          email,
          emailVerified: false,
          passwordHash: hash,
          passwordAlgoVersion: algorithmVersion,
          updatedAt: new Date(),
        })
        .where(and(this.tenantScope(), eq(users.id, userId)))
        .returning(),
    );
    return this.required(rows[0]);
  }

  async recordSignIn(userId: string, at: Date): Promise<void> {
    await this.tx
      .update(users)
      .set({ lastSignInAt: at })
      .where(and(this.tenantScope(), eq(users.id, userId)));
  }

  private toEntity(row: UserRow | undefined): User | null {
    if (row === undefined) return null;
    return new User({
      id: row.id,
      projectId: row.projectId,
      email: row.email,
      emailVerified: row.emailVerified,
      phone: row.phone,
      phoneVerified: row.phoneVerified,
      passwordHash: row.passwordHash,
      passwordAlgoVersion: row.passwordAlgoVersion,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      metadataPublic: asRecord(row.metadataPublic),
      metadataPrivate: asRecord(row.metadataPrivate),
      bannedUntil: row.bannedUntil,
      lastSignInAt: row.lastSignInAt,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    });
  }

  /** For writes, where a missing row means the tenant scope excluded it. */
  private required(row: UserRow | undefined): User {
    const entity = this.toEntity(row);
    if (entity === null) throw new ResourceNotFoundError({ detail: { entity: "user" } });
    return entity;
  }
}
