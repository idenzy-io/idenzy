import { ResourceNotFoundError } from "@idenzy/core/errors";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { WebauthnRelyingPartyRepository } from "@idenzy/persistence/repository/webauthn-relying-party-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import type { RelyingParty } from "./passkey-ceremony.js";

/**
 * The relying party a project's passkeys belong to.
 *
 * A project with nothing configured is a configuration error and is surfaced as one,
 * the same way a project with no registered redirect URI is. There is no fallback to
 * the request's Host header: the RP ID decides which credentials an assertion may
 * address, and taking it from a header would let whoever controls the request choose.
 *
 * An empty origin list fails here rather than at verification. Verification against no
 * expected origin refuses everything, so the difference is only whether the customer
 * reads "this project has no relying party configured" or watches every passkey in
 * their application stop working for no stated reason.
 */
@Injectable()
export class RelyingPartyResolver {
  constructor(private readonly uow: UnitOfWork) {}

  async resolve(context: FlowContext): Promise<RelyingParty> {
    const tenant = tenantContextFrom(context);
    const row = await this.uow.transaction((tx) =>
      new WebauthnRelyingPartyRepository(tx, tenant).find(),
    );
    if (row === null || row.origins.length === 0) {
      throw new ResourceNotFoundError({
        message: "This project has no passkey relying party configured.",
        detail: { entity: "webauthn_relying_party", configured: row !== null },
      });
    }
    return { rpId: row.rpId, rpName: row.rpName, origins: row.origins };
  }
}
