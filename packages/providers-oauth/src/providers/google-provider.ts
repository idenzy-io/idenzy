import type { ProviderProfile } from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import type { JWTPayload } from "jose";
import {
  assertExactIssuer,
  OidcProvider,
  stringClaim,
  subjectOf,
  verifiedEmailClaim,
} from "../oidc-provider.js";

/**
 * Google (PROJECT.md 4.6).
 *
 * Endpoints and a claim mapping, which is all a provider should be. Everything about
 * state, PKCE, the redirect allowlist and the id_token is inherited.
 *
 * `prompt=select_account` is deliberate: without it a user signed into several Google
 * accounts is silently taken through the one the browser happens to prefer, and the
 * account they end up in is not the one they thought they chose.
 */
export class GoogleProvider extends OidcProvider {
  override readonly id = ProviderId.Google;

  protected override authorizeEndpoint(): string {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }

  protected override tokenEndpoint(): string {
    return "https://oauth2.googleapis.com/token";
  }

  protected override assertIssuer(claims: JWTPayload): void {
    assertExactIssuer(claims, "https://accounts.google.com", this.id);
  }

  protected override jwksUri(): string {
    return "https://www.googleapis.com/oauth2/v3/certs";
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "email", "profile"];
  }

  protected override decorateAuthorization(url: URL): void {
    url.searchParams.set("prompt", "select_account");
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    return {
      providerUserId: subjectOf(claims, this.id),
      email: stringClaim(claims, "email"),
      emailVerified: verifiedEmailClaim(claims),
      displayName: stringClaim(claims, "name"),
      avatarUrl: stringClaim(claims, "picture"),
    };
  }
}
