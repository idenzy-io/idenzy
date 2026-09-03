import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthFlowStore,
  ProviderProfile,
  RedirectAllowlist,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import type { JWTPayload } from "jose";
import { assertExactIssuer, OidcProvider, stringClaim, subjectOf } from "../oidc-provider.js";

/**
 * LINE Login (PROJECT.md 4.6).
 *
 * OIDC, so the profile is in the id_token and there is no profile call on the request
 * path. Two things about it look like mistakes and are not.
 *
 * The hosts differ by purpose: a browser is sent to `access.line.me` and the token and key
 * endpoints are on `api.line.me`. The issuer is the first of those, because the issuer is
 * whoever made the assertion rather than whoever handed it over, and getting that backwards
 * would reject every real sign-in.
 *
 * And there is no `email_verified`. LINE confirms an address before it is attached to an
 * account and says nothing about it in the token, so this reports false and an account is
 * not linked on a LINE address. The claim is also absent entirely unless the channel has
 * been granted the email permission, which is a review LINE runs per application, so a
 * profile with no address is the normal case rather than a failure.
 */
export class LineProvider extends OidcProvider {
  override readonly id = ProviderId.Line;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://access.line.me/oauth2/v2.1/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://api.line.me/oauth2/v2.1/token";
  }

  protected override assertIssuer(claims: JWTPayload): void {
    assertExactIssuer(claims, "https://access.line.me", this.id);
  }

  protected override jwksUri(): string {
    return "https://api.line.me/oauth2/v2.1/certs";
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "profile", "email"];
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    return {
      providerUserId: subjectOf(claims, this.id),
      email: stringClaim(claims, "email"),
      // No claim asserts this, so we do not assert it either.
      emailVerified: false,
      displayName: stringClaim(claims, "name"),
      avatarUrl: stringClaim(claims, "picture"),
    };
  }
}
