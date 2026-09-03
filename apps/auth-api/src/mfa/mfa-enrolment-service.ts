import { AppConfig } from "@idenzy/config/app-config";
import {
  InternalError,
  MfaFactorAlreadyEnrolledError,
  MfaFactorInvalidError,
  ResourceNotFoundError,
} from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { generateRecoveryCodes, hashRecoveryCode } from "@idenzy/crypto/mfa/recovery-codes";
import { Totp } from "@idenzy/crypto/mfa/totp";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import {
  MfaFactorRepository,
  type MfaFactorRow,
} from "@idenzy/persistence/repository/mfa-factor-repository";
import { MfaRecoveryCodeRepository } from "@idenzy/persistence/repository/mfa-recovery-code-repository";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { MfaFactorType } from "@idenzy/protocol/enums/auth";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import type {
  MfaEnrolmentConfirmed,
  MfaFactorList,
  MfaFactorSummary,
  RecoveryCodes,
  TotpEnrolment,
} from "@idenzy/protocol/schemas/mfa";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * Enrolling, listing and removing a second factor (PROJECT.md 4.5).
 *
 * Enrolment is two calls and not one, because the point of the second is to prove that
 * the secret arrived intact. A factor that were usable from the moment it was generated
 * would let a user whose QR code failed to scan lock themselves out of their own account
 * at the next sign-in, which is the failure this whole flow exists to avoid.
 */
@Injectable()
export class MfaEnrolmentService {
  private readonly totp: Totp;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly encryptor: FieldEncryptor,
    private readonly config: AppConfig,
  ) {
    this.totp = new Totp(clock);
  }

  /**
   * Generates a secret and returns it once.
   *
   * An enrolment already in progress is cleared rather than refused: the unique index
   * covers confirmed factors only, so a user who closed the tab has to be able to start
   * again, and an unconfirmed secret can satisfy nothing in the meantime.
   */
  async startTotp(
    context: FlowContext,
    userId: string,
    label: string | null,
  ): Promise<TotpEnrolment> {
    const tenant = tenantContextFrom(context);
    const secret = this.totp.generateSecret();

    const { factorId, account } = await this.uow.run(tenant, async (tx) => {
      const factors = new MfaFactorRepository(tx, tenant);
      if ((await factors.listVerified(userId)).some((f) => f.type === MfaFactorType.Totp)) {
        throw new MfaFactorAlreadyEnrolledError({ detail: { type: MfaFactorType.Totp } });
      }
      await factors.deleteUnverified(userId, MfaFactorType.Totp);

      const user = await new UserRepository(tx, tenant).findById(userId);
      if (user === null) throw new ResourceNotFoundError({ detail: { entity: "user" } });

      return {
        factorId: await factors.create({
          userId,
          type: MfaFactorType.Totp,
          secretEncrypted: this.encryptor.encrypt(secret, context.projectId),
          label,
        }),
        // The label in the URI is what an authenticator app shows in its own list, so it
        // has to name the human. An anonymous account has no address to use and gets the
        // public user id, which is at least stable and theirs.
        account: user.email ?? PublicId.encode(IdPrefix.User, userId).value,
      };
    });

    return {
      factorId: PublicId.encode(IdPrefix.Factor, factorId).value,
      secret,
      uri: this.totp.uri(this.config.get("ISSUER_BASE_URL"), account, secret),
    };
  }

  /**
   * Confirms an enrolment with a code the authenticator generated.
   *
   * The code is checked against the stored secret directly rather than through
   * `TotpFactor`, and that is not a shortcut: the factor is not verified yet, so the
   * factor's own path would correctly refuse it. What is shared is the algorithm, which
   * lives in `@idenzy/crypto`.
   */
  async confirmTotp(
    context: FlowContext,
    userId: string,
    publicFactorId: string,
    code: string,
  ): Promise<MfaEnrolmentConfirmed> {
    const tenant = tenantContextFrom(context);
    const factorId = PublicId.parse(IdPrefix.Factor, publicFactorId).uuid;
    const now = this.clock.now();

    const { row, codes } = await this.uow.run(tenant, async (tx) => {
      const factors = new MfaFactorRepository(tx, tenant);
      const factor = await factors.findForUser(userId, factorId);
      if (factor === null || factor.secretEncrypted === null || factor.verifiedAt !== null) {
        throw new ResourceNotFoundError({ detail: { entity: "mfa_factor" } });
      }

      const secret = this.encryptor.decrypt(factor.secretEncrypted, context.projectId);
      const step = this.totp.verify(secret, code.trim(), null);
      if (step === null) throw new MfaFactorInvalidError({ detail: { stage: "enrolment" } });
      if (!(await factors.confirm(userId, factorId, now))) {
        throw new ResourceNotFoundError({ detail: { entity: "mfa_factor" } });
      }
      await factors.recordUse(factorId, now, step);

      // Issued here rather than left to a second call the customer has to remember, and
      // only when the account has none: regenerating would invalidate a sheet somebody
      // has already printed.
      const recovery = new MfaRecoveryCodeRepository(tx, tenant);
      const issued = (await recovery.countUnused(userId)) === 0 ? generateRecoveryCodes() : null;
      if (issued !== null) {
        await recovery.replaceAll(userId, issued.map(hashRecoveryCode));
      }

      await new OutboxRepository(tx, tenant).enqueue("security.mfa_enrolled", {
        userId,
        type: MfaFactorType.Totp,
        at: now.toISOString(),
      });

      const confirmed = await factors.findForUser(userId, factorId);
      if (confirmed === null) throw new ResourceNotFoundError({ detail: { entity: "mfa_factor" } });
      return { row: confirmed, codes: issued };
    });

    return {
      factor: present(row),
      recoveryCodes: codes === null ? null : { codes: [...codes], generatedAt: now.toISOString() },
    };
  }

  list(context: FlowContext, userId: string): Promise<MfaFactorList> {
    const tenant = tenantContextFrom(context);
    return this.uow.run(tenant, async (tx) => ({
      factors: (await new MfaFactorRepository(tx, tenant).listVerified(userId)).map(present),
      recoveryCodesRemaining: await new MfaRecoveryCodeRepository(tx, tenant).countUnused(userId),
    }));
  }

  /**
   * Replaces the whole sheet. Half a sheet is worse than either state: the user has a
   * printout that partly works and no way to tell which half.
   */
  async regenerateRecoveryCodes(context: FlowContext, userId: string): Promise<RecoveryCodes> {
    const tenant = tenantContextFrom(context);
    const codes = generateRecoveryCodes();
    const now = this.clock.now();
    await this.uow.run(tenant, async (tx) => {
      await new MfaRecoveryCodeRepository(tx, tenant).replaceAll(
        userId,
        codes.map(hashRecoveryCode),
      );
      await new OutboxRepository(tx, tenant).enqueue("security.recovery_codes_regenerated", {
        userId,
        at: now.toISOString(),
      });
    });
    return { codes: [...codes], generatedAt: now.toISOString() };
  }

  /**
   * Removes a factor, and the recovery codes with it when it was the last one.
   *
   * Leaving the sheet behind would leave ten single-use passwords standing in front of
   * an account whose owner believes they turned MFA off.
   */
  async remove(context: FlowContext, userId: string, publicFactorId: string): Promise<void> {
    const tenant = tenantContextFrom(context);
    const factorId = PublicId.parse(IdPrefix.Factor, publicFactorId).uuid;
    const now = this.clock.now();
    await this.uow.run(tenant, async (tx) => {
      const factors = new MfaFactorRepository(tx, tenant);
      if (!(await factors.remove(userId, factorId))) {
        throw new ResourceNotFoundError({ detail: { entity: "mfa_factor" } });
      }
      if ((await factors.listVerified(userId)).length === 0) {
        await new MfaRecoveryCodeRepository(tx, tenant).replaceAll(userId, []);
      }
      await new OutboxRepository(tx, tenant).enqueue("security.mfa_removed", {
        userId,
        factorId,
        at: now.toISOString(),
      });
    });
  }
}

const FACTOR_TYPES = new Set<string>(Object.values(MfaFactorType));

/**
 * Narrowed rather than cast. The column is text, and a row written by an older version
 * of this service must not put a value the wire schema rejects into a list response.
 */
function isFactorType(value: string): value is MfaFactorType {
  return FACTOR_TYPES.has(value);
}

function present(row: MfaFactorRow): MfaFactorSummary {
  if (!isFactorType(row.type)) {
    throw new InternalError({ detail: { reason: "unknown factor type", type: row.type } });
  }
  return {
    id: PublicId.encode(IdPrefix.Factor, row.id).value,
    type: row.type,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}
