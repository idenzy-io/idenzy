import { AppConfig } from "@idenzy/config/app-config";
import { Clock } from "@idenzy/core/time/clock";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import { IdTokenNonceRepository } from "@idenzy/persistence/repository/id-token-nonce-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import type { IdTokenNonce } from "@idenzy/protocol/schemas/auth";
import { Injectable } from "@nestjs/common";
import { tenantContextFrom } from "../tenancy/flow-context.js";

/**
 * The first half of a native sign-in: a nonce the provider will sign into the ID token.
 *
 * Issued by us rather than made up by the app, so the exchange can require one this project
 * handed out, unspent and unexpired. An app-made nonce proves only that the token is
 * whatever the app says it is. Its lifetime is the OAuth flow's, the same allowance for a
 * person working through a provider's sign-in.
 */
@Injectable()
export class IdTokenNonceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  async issue(context: FlowContext): Promise<IdTokenNonce> {
    const nonce = generateOpaqueToken();
    const expiresAt = this.clock.inSeconds(this.config.get("OAUTH_FLOW_TTL_SECONDS"));
    const now = new Date(this.clock.nowMs());
    await this.uow.transaction((tx) =>
      new IdTokenNonceRepository(tx, tenantContextFrom(context)).issue(
        hashToken(nonce),
        expiresAt,
        now,
      ),
    );
    return { nonce, expiresAt: expiresAt.toISOString() };
  }
}
