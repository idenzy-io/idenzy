import { RevocationSet } from "@idenzy/cache/revocation-set";
import { Logger } from "@idenzy/core/logging/logger";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import type { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import { IdPrefix } from "@idenzy/protocol/schemas/common";
import { Injectable } from "@nestjs/common";

/**
 * Puts a revocation where a customer's offline verifier can see it (ADR-0009).
 *
 * Two rules, and both are about ordering rather than content.
 *
 * It is called after the transaction has committed, never inside it. A write that
 * preceded the commit could publish a revocation the transaction then rolled back, and a
 * false entry is not self-correcting: the set is keyed by session id, refreshing mints a
 * new access token for the same session, so nothing the client can do clears it.
 *
 * It never throws. The revocation has already happened and been recorded; failing the
 * call now would report an error for work that succeeded. The `session.revoked` event
 * enqueued in the same transaction is the durable record, so a write lost here delays
 * propagation to the worker rather than dropping it.
 */
@Injectable()
export class RevocationPublisher {
  constructor(
    private readonly set: RevocationSet,
    private readonly logger: Logger,
  ) {}

  /**
   * Specific sessions, as the public ids a token carries, at the instant they were revoked.
   *
   * The instant is the one written to the session row, not the one this call happens at, so
   * the reconciler replaying the same outbox event lands on the same entry rather than
   * pushing its expiry forward.
   *
   * The key is the project's uuid because it is ours and never leaves; the members are
   * public ids because they are published and because `sid` is what the SDK compares.
   */
  async sessionsRevoked(
    tenant: TenantContext,
    sessionIds: readonly string[],
    at: Date,
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.attempt(tenant, () =>
      this.set.revokeSessions(
        tenant.projectId,
        sessionIds.map((id) => PublicId.encode(IdPrefix.Session, id).value),
        at,
      ),
    );
  }

  /**
   * Everything one user holds, as a watermark rather than a list.
   *
   * Signing out everywhere and a password reset both end every session a user has, and a
   * user with many devices would otherwise write one entry each. The watermark is one
   * entry whatever the count, which is what keeps the published set bounded.
   */
  async userRevoked(tenant: TenantContext, userId: string, at: Date): Promise<void> {
    await this.attempt(tenant, () =>
      this.set.revokeUser(tenant.projectId, PublicId.encode(IdPrefix.User, userId).value, at),
    );
  }

  private async attempt(tenant: TenantContext, write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch {
      // Deliberately not rethrown, and deliberately loud. Revocation still takes effect
      // at our own endpoints, which read the session row, and for everyone else it falls
      // back to the token expiring, which is where we were before the set existed.
      this.logger.warn("could not publish a revocation", {
        projectId: tenant.projectId,
        component: "revocation-set",
        outcome: "publish_failed",
      });
    }
  }
}
