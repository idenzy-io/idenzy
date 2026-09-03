import { OauthProviderError } from "@idenzy/core/errors/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthCallback,
  OAuthFlowStore,
  ProviderCredentials,
  ProviderProfile,
  RedirectAllowlist,
  StoredFlow,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import { importPKCS8, type JWTPayload, SignJWT } from "jose";
import {
  assertExactIssuer,
  OidcProvider,
  stringClaim,
  subjectOf,
  verifiedEmailClaim,
} from "../oidc-provider.js";

const ISSUER = "https://appleid.apple.com";
/** Apple caps the client secret's lifetime at six months; ten minutes is all we need. */
const SECRET_TTL_SECONDS = 600;

function requireConfig(credentials: ProviderCredentials, key: string): string {
  const value = credentials.config[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new OauthProviderError({
      detail: { provider: ProviderId.Apple, reason: `apple requires ${key} in its config` },
    });
  }
  return value;
}

/**
 * Sign in with Apple (PROJECT.md 4.6).
 *
 * Apple differs from every other provider in three ways, and each one is a place an
 * implementation quietly goes wrong.
 *
 * **There is no client secret.** What Apple calls one is an ES256 JWT we sign per
 * request with a private key, naming our team as issuer and Apple as audience. It is
 * minted here rather than stored, because a stored one expires and the failure surfaces
 * months later as sign-in breaking for no visible reason.
 *
 * **The name arrives once.** Apple sends the user's name in the callback body on the
 * very first authorization and never again, so a profile mapped from the id_token alone
 * has no display name. Capturing it is the customer's to do from the callback payload;
 * we do not invent one from the email local part.
 *
 * **The address may be a relay.** `privaterelay.appleid.com` addresses are real and
 * deliverable but are per-app aliases, so the same human has a different address at
 * every customer. Apple asserts them verified, and they are, so linking works; the thing
 * not to do is treat the address as an identity across projects.
 */
export class AppleProvider extends OidcProvider {
  override readonly id = ProviderId.Apple;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return `${ISSUER}/auth/authorize`;
  }

  protected override tokenEndpoint(): string {
    return `${ISSUER}/auth/token`;
  }

  protected override jwksUri(): string {
    return `${ISSUER}/auth/keys`;
  }

  protected override assertIssuer(claims: JWTPayload): void {
    assertExactIssuer(claims, ISSUER, this.id);
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "email", "name"];
  }

  /**
   * Requesting any scope beyond `openid` makes Apple POST the callback instead of
   * redirecting to it, so the controller has to accept both verbs. Setting this here
   * rather than leaving it to the default keeps the two facts next to each other.
   */
  protected override decorateAuthorization(url: URL, credentials: ProviderCredentials): void {
    const scopes = credentials.scopes.length > 0 ? credentials.scopes : this.defaultScopes();
    if (scopes.some((scope) => scope !== "openid")) {
      url.searchParams.set("response_mode", "form_post");
    }
  }

  protected override async tokenRequest(
    credentials: ProviderCredentials,
    callback: OAuthCallback,
    flow: StoredFlow,
  ): Promise<Record<string, string>> {
    return {
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: callback.callbackUri,
      client_id: credentials.clientId,
      client_secret: await this.clientSecret(credentials),
      code_verifier: flow.codeVerifier,
    };
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    return {
      providerUserId: subjectOf(claims, this.id),
      email: stringClaim(claims, "email"),
      emailVerified: verifiedEmailClaim(claims),
      // Apple sends it in the callback body on first authorization only, never here.
      displayName: null,
      avatarUrl: null,
    };
  }

  /** The signed assertion Apple accepts in place of a static secret. */
  private async clientSecret(credentials: ProviderCredentials): Promise<string> {
    const teamId = requireConfig(credentials, "teamId");
    const keyId = requireConfig(credentials, "keyId");
    const key = await importPKCS8(credentials.clientSecret, "ES256").catch((error: unknown) => {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the apple signing key is not a PKCS#8 ES256 key" },
        cause: error,
      });
    });

    const issuedAt = Math.floor(this.clock.nowMs() / 1000);
    return new SignJWT({ sub: credentials.clientId })
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setAudience(ISSUER)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + SECRET_TTL_SECONDS)
      .sign(key);
  }
}
