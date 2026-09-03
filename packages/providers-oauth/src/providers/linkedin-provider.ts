import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthFlowStore,
  ProviderProfile,
  RedirectAllowlist,
} from "@idenzy/domain/ports/oauth-provider";
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
 * LinkedIn (PROJECT.md 4.6).
 *
 * OIDC since "Sign In with LinkedIn using OpenID Connect", so the profile comes out of the
 * id_token and there is no userinfo call on the request path. The old `r_liteprofile` API and
 * its two separate calls, one of them for the address, are what this replaces.
 *
 * LinkedIn ignores the PKCE parameters rather than rejecting them, which costs nothing and
 * keeps one authorization URL builder for every provider. The checks that matter here are the
 * ones the id_token carries: signature, issuer, audience and nonce.
 */
export class LinkedinProvider extends OidcProvider {
  override readonly id = ProviderId.Linkedin;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://www.linkedin.com/oauth/v2/authorization";
  }

  protected override tokenEndpoint(): string {
    return "https://www.linkedin.com/oauth/v2/accessToken";
  }

  protected override assertIssuer(claims: JWTPayload): void {
    assertExactIssuer(claims, "https://www.linkedin.com", this.id);
  }

  protected override jwksUri(): string {
    return "https://www.linkedin.com/oauth/openid/jwks";
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "profile", "email"];
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
