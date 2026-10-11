import { Clock } from "@idenzy/core/time/clock";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { dsrDeadlineFor } from "@idenzy/domain/policies/dsr-deadline";
import { DataSubjectRequestRepository } from "@idenzy/persistence/repository/data-subject-request-repository";
import { OutboxRepository } from "@idenzy/persistence/repository/outbox-repository";
import { UserErasureRepository } from "@idenzy/persistence/repository/user-erasure-repository";
import { UserRepository } from "@idenzy/persistence/repository/user-repository";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { DEFAULT_DSR_DEADLINE_RULE, DsrKind } from "@idenzy/protocol/enums/compliance";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";
import { RevocationPublisher } from "../session/revocation-publisher.js";

/** Where the request came from, for the audit entry. Null where there is nothing to say. */
export interface ErasureRequest {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/**
 * Erases one end user, now (PROJECT.md 4.13.6, GDPR Art. 17).
 *
 * Immediate rather than a soft delete with a grace window: the account is tombstoned, every way
 * back in is deleted and every session it holds ends, in one transaction. A product that deletes
 * an account on a user's request has already decided; holding the person's data for thirty more
 * days in case somebody changes their mind is a retention period with no purpose behind it.
 *
 * The same transaction records the erasure four ways, each for a different reader:
 * - `session.revoked` (scope all), which the revocation reconciler replays into the published set
 *   if the write after the commit is lost;
 * - `user.deleted`, which becomes the customer's webhook and tells the erasure relay to strip the
 *   copies messaging and analytics made (see `UserErasureRelay` in the workers);
 * - an audit entry, keyed on the pseudonymous id the trail keeps on purpose;
 * - a completed `data_subject_requests` row, the proof an auditor asks for.
 *
 * After the commit, the user's watermark goes into the revocation set, so an access token already
 * issued stops verifying within the SDK's polling interval rather than at its expiry. That write is
 * best effort for the reason ADR-0009 gives, and the outbox event is what makes it eventually true.
 */
@Injectable()
export class UserErasureService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly revocations: RevocationPublisher,
  ) {}

  /** False when there is no live user by that id, which the caller answers as not found. */
  async erase(tenant: TenantContext, userId: string, request: ErasureRequest): Promise<boolean> {
    const at = this.clock.now();
    const publicId = PublicId.encode(IdPrefix.User, userId).value;

    const erased = await this.uow.transaction(async (tx) => {
      const user = await new UserRepository(tx, tenant).findById(userId);
      if (user === null || user.isDeleted()) return false;

      // The digests the OTP flows file challenges under, computed the same way, because a digest
      // is the only thing `otp_challenges` can be found by.
      const addresses = [user.email, user.phone].filter((value) => value !== null);
      const ended = await new UserErasureRepository(tx, tenant).erase(
        userId,
        addresses.map((value) => hashToken(value)),
        at,
      );
      if (ended === null) return false;

      const outbox = new OutboxRepository(tx, tenant);
      await outbox.enqueue("session.revoked", {
        userId,
        sessionIds: [...ended],
        scope: "all",
        at: at.toISOString(),
      });
      await outbox.enqueue("user.deleted", { userId, at: at.toISOString() });
      await outbox.enqueue("audit.recorded", {
        action: "user.deleted",
        actorType: tenant.actorType,
        actorId: tenant.actorId,
        target: publicId,
        requestId: tenant.requestId,
        ip: request.ip,
        userAgent: request.userAgent,
        at: at.toISOString(),
        meta: { sessionsEnded: ended.length },
      });
      await new DataSubjectRequestRepository(tx, tenant).recordCompleted({
        subjectUserId: userId,
        kind: DsrKind.Erasure,
        deadlineRule: DEFAULT_DSR_DEADLINE_RULE,
        at,
        dueAt: dsrDeadlineFor(DEFAULT_DSR_DEADLINE_RULE).dueAt(at),
        requestedBy: tenant.actorId ?? tenant.actorType,
      });
      return true;
    });

    if (erased) await this.revocations.userRevoked(tenant, userId, at);
    return erased;
  }
}
