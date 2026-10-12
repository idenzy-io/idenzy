import { IdTokenInvalidError, ValidationFailedError } from "@idenzy/core/errors";
import { Clock } from "@idenzy/core/time/clock";
import { hashToken } from "@idenzy/crypto/tokens/random";
import { ActiveUserMeter } from "@idenzy/domain/ports/active-user-meter";
import {
  type AuthenticatedSubject,
  AuthFlow,
  type FlowAudit,
  type FlowContext,
  type FlowHooks,
  type MfaGate,
} from "@idenzy/domain/ports/auth-flow";
import { verifiesIdTokens } from "@idenzy/domain/ports/oauth-provider";
import { IdTokenNonceRepository } from "@idenzy/persistence/repository/id-token-nonce-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { OauthMode } from "@idenzy/protocol/enums/providers";
import { exchangeIdTokenSchema } from "@idenzy/protocol/schemas/auth";
import { Inject, Injectable } from "@nestjs/common";
import { parseOrThrow } from "../common/parse.js";
import { FLOW_AUDIT, FLOW_HOOKS, MFA_GATE } from "../flows/flow-tokens.js";
import { SessionService } from "../session/session-service.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderSignIn } from "./provider-sign-in.js";

/**
 * Native Sign in with Apple and Google: an ID token from the platform's own sign-in sheet,
 * exchanged for a session (PROJECT.md 4.4).
 *
 * There is no redirect, so none of the redirect flow's defences apply, and everything they
 * protected has to be proved by the token instead. The order below is the design:
 *
 * 1. **The nonce is spent first**, before the token is looked at, so a nonce is worth one
 *    attempt whatever the attempt turns out to be.
 * 2. **The token is verified by the provider adapter**: signature against the provider's
 *    keys, issuer, an audience that is one of this project's own client ids, expiry, and a
 *    `nonce` claim equal to the digest of the nonce just spent. A token from a sign-in this
 *    project did not start fails there.
 * 3. **The account is resolved by the same code the redirect flow uses**, so an unverified
 *    address never links to an existing account by either way in (PROJECT.md 4.6).
 *
 * Instant mode is refused. Our shared OAuth apps have no native client ids, and a token
 * minted for our app would be one any customer's project could redeem.
 */
@Injectable()
export class IdTokenFlow extends AuthFlow {
  override readonly method = AuthMethod.IdTokenExchange;

  constructor(
    sessions: SessionService,
    @Inject(FLOW_HOOKS) hooks: FlowHooks,
    @Inject(FLOW_AUDIT) audit: FlowAudit,
    @Inject(MFA_GATE) mfa: MfaGate,
    actives: ActiveUserMeter,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly registry: ProviderRegistry,
    private readonly signIn: ProviderSignIn,
  ) {
    super(sessions, hooks, audit, mfa, actives);
  }

  protected override async verify(
    context: FlowContext,
    credentials: unknown,
  ): Promise<AuthenticatedSubject> {
    const input = parseOrThrow(exchangeIdTokenSchema, credentials);
    const tenant = tenantContextFrom(context);
    const nonceDigest = hashToken(input.nonce);

    const claimed = await this.uow.transaction((tx) =>
      new IdTokenNonceRepository(tx, tenant).claim(nonceDigest, new Date(this.clock.nowMs())),
    );
    if (!claimed) {
      throw new IdTokenInvalidError({
        detail: { reason: "the nonce was not issued, or is spent" },
      });
    }

    const provider = this.registry.provider(input.provider);
    if (!verifiesIdTokens(provider)) {
      throw new ValidationFailedError({
        message: "That provider has no native sign-in.",
        fields: [{ path: "provider", code: "unsupported" }],
      });
    }
    const { credentials: configured, mode } = await this.registry.configure(
      context.projectId,
      input.provider,
    );
    if (mode === OauthMode.Instant) {
      throw new ValidationFailedError({
        message:
          "Native sign-in needs the project's own client ids, which instant mode does not use.",
        fields: [{ path: "provider", code: "instant_mode" }],
      });
    }

    const verified = await provider.verifyIdToken(configured, input.idToken, nonceDigest);
    // Apple puts the name in front of the app once and never in the token, so the app's copy
    // stands in for a missing one. It only ever names an account being created.
    const profile = { ...verified, displayName: verified.displayName ?? input.displayName ?? null };
    const userId = await this.uow.transaction((tx) =>
      this.signIn.resolve(tx, context, {
        provider: input.provider,
        profile,
        linkUserId: null,
        encryptedTokens: null,
      }),
    );
    return { userId, amr: [AuthMethod.IdTokenExchange], factorVerifiedAt: null };
  }
}
