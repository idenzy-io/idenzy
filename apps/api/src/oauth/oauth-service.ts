import { createHash } from "node:crypto";
import { AppConfig } from "@idenzy/config/app-config";
import { RedirectUriNotAllowedError } from "@idenzy/core/errors";
import { isIdenzyError } from "@idenzy/core/errors/idenzy-error";
import { Clock } from "@idenzy/core/time/clock";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import type { FlowContext } from "@idenzy/domain/ports/auth-flow";
import type { CompletedFlow } from "@idenzy/domain/ports/oauth-provider";
import { AuthCodeRepository } from "@idenzy/persistence/repository/auth-code-repository";
import { RedirectUriRepository } from "@idenzy/persistence/repository/redirect-uri-repository";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { AuthMethod } from "@idenzy/protocol/enums/auth";
import { Injectable } from "@nestjs/common";
import { RedirectKind } from "../delivery/redirect-targets.js";
import { tenantContextFrom } from "../tenancy/flow-context.js";
import { DatabaseOAuthFlowStore } from "./database-oauth-flow-store.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderSignIn } from "./provider-sign-in.js";

/** RFC 7636 S256: the challenge is the base64url SHA-256 of the verifier. */
function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function withParam(uri: string, name: string, value: string): string {
  const url = new URL(uri);
  url.searchParams.set(name, value);
  return url.toString();
}

/**
 * The two halves of a social sign-in (PROJECT.md 4.6).
 *
 * `start` pins everything the callback will need and hands back a provider URL. `finish`
 * validates the return, decides what the profile means for account identity, and returns
 * the customer's own route carrying a single-use code. We render nothing at any point;
 * the only HTML in the flow belongs to the identity provider.
 *
 * Where failures go is a deliberate split. Anything that fails before the redirect
 * target is proven allowlisted, a forged state or an unknown provider, answers as JSON,
 * because redirecting on those would mean trusting a target we have not checked and that
 * is the open redirect this design exists to avoid. Anything that fails afterwards goes
 * back to the customer's route as `?error=<code>`, because by then the destination is
 * proven and a user stranded on an API error page is a dead end.
 */

@Injectable()
export class OAuthService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly registry: ProviderRegistry,
    private readonly flows: DatabaseOAuthFlowStore,
    private readonly encryptor: FieldEncryptor,
    private readonly signIn: ProviderSignIn,
  ) {}

  async start(
    context: FlowContext,
    providerName: string,
    redirectUri: string,
    linkUserId: string | null,
    clientCodeChallenge: string | null = null,
  ): Promise<string> {
    const provider = this.registry.provider(providerName);
    const { credentials, mode } = await this.registry.configure(context.projectId, providerName);
    ProviderRegistry.assertInstantModeAllowed(mode, redirectUri);

    // Checked here as well as at the callback. Failing now means we never send a user to
    // a provider for a flow that cannot possibly finish.
    const tenant = tenantContextFrom(context);
    const allowed = await this.uow.transaction((tx) =>
      new RedirectUriRepository(tx, tenant).isAllowed(RedirectKind.Oauth, redirectUri),
    );
    if (!allowed) throw new RedirectUriNotAllowedError();

    const state = generateOpaqueToken();
    const nonce = generateOpaqueToken();
    const codeVerifier = generateOpaqueToken(64);

    await this.flows.start(context.projectId, {
      provider: providerName,
      state,
      codeVerifier,
      nonce,
      redirectUri,
      linkUserId,
      clientCodeChallenge,
      expiresAt: this.clock.inSeconds(this.config.get("OAUTH_FLOW_TTL_SECONDS")),
    });

    return provider.authorizationUrl(credentials, {
      state,
      nonce,
      codeChallenge: challengeFor(codeVerifier),
      callbackUri: this.callbackUri(providerName),
    });
  }

  async finish(
    context: FlowContext,
    providerName: string,
    state: string,
    code: string,
  ): Promise<string> {
    const provider = this.registry.provider(providerName);
    const { credentials } = await this.registry.configure(context.projectId, providerName);
    const completed = await provider.completeFlow(context.projectId, credentials, {
      provider: providerName,
      state,
      code,
      callbackUri: this.callbackUri(providerName),
    });

    try {
      const authCode = await this.establish(context, providerName, completed, credentials.config);
      return withParam(completed.flow.redirectUri, "code", authCode);
    } catch (error: unknown) {
      // The destination is proven allowlisted by this point, so a failure here belongs
      // in front of the user's own UI rather than as an API error they cannot read.
      if (isIdenzyError(error)) return withParam(completed.flow.redirectUri, "error", error.code);
      throw error;
    }
  }

  /** Resolves who this profile is, links the identity, and mints the exchange code. */
  private establish(
    context: FlowContext,
    providerName: string,
    completed: CompletedFlow,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<string> {
    const tenant = tenantContextFrom(context);
    const code = generateOpaqueToken();

    return this.uow.transaction(async (tx) => {
      // Only when the customer asked for it. A provider refresh token is a standing
      // grant on someone's Google account, and holding one nobody needs is a liability
      // rather than a feature (PROJECT.md 4.6).
      const tokens =
        settings["storeTokens"] === true
          ? this.encryptor.encrypt(
              JSON.stringify({
                accessToken: completed.grant.accessToken,
                refreshToken: completed.grant.refreshToken,
                expiresAt: completed.grant.expiresAt?.toISOString() ?? null,
              }),
              context.projectId,
            )
          : null;

      const userId = await this.signIn.resolve(tx, context, {
        provider: providerName,
        profile: completed.profile,
        linkUserId: completed.flow.linkUserId,
        encryptedTokens: tokens,
      });

      await new AuthCodeRepository(tx, tenant).issue({
        userId,
        codeHash: hashToken(code),
        amr: [AuthMethod.Oauth],
        redirectUri: completed.flow.redirectUri,
        // Carried from the start of the flow, so the browser that began it is the only one
        // that can finish it. Null when the client sent none, and then nothing is enforced.
        codeChallenge: completed.flow.clientCodeChallenge,
        expiresAt: this.clock.inSeconds(this.config.get("AUTH_CODE_TTL_SECONDS")),
      });
      return code;
    });
  }

  private callbackUri(provider: string): string {
    return new URL(
      `/v1/auth/oauth/${provider}/callback`,
      this.config.get("ISSUER_BASE_URL"),
    ).toString();
  }
}
