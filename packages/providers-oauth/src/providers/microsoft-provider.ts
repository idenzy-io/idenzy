import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthFlowStore,
  ProviderCredentials,
  ProviderProfile,
  RedirectAllowlist,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";
import type { JWTPayload } from "jose";
import { assertExactIssuer, OidcProvider, stringClaim, subjectOf } from "../oidc-provider.js";

/** Which Microsoft directory to sign in against. `common` is personal plus work accounts. */
function tenant(credentials: ProviderCredentials): string {
  const configured = credentials.config["tenant"];
  return typeof configured === "string" && configured.length > 0 ? configured : "common";
}

/**
 * Microsoft identity platform (PROJECT.md 4.6).
 *
 * Two things differ from Google and both matter.
 *
 * The issuer is per directory, so it is derived from the `tid` claim rather than
 * hardcoded, and the `common` endpoint issues tokens whose `iss` names the tenant the
 * user actually came from. Hardcoding `common` there would fail every real sign-in.
 *
 * And Microsoft sends no `email_verified`. Work accounts are verified by the directory
 * and personal accounts are not, and nothing in the token says which, so this reports
 * false and a customer's user goes through email OTP before we link on the address. That
 * is the conservative reading and the one PROJECT.md 4.6 asks for.
 */
export class MicrosoftProvider extends OidcProvider {
  override readonly id = ProviderId.Microsoft;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(credentials: ProviderCredentials): string {
    return `https://login.microsoftonline.com/${tenant(credentials)}/oauth2/v2.0/authorize`;
  }

  protected override tokenEndpoint(credentials: ProviderCredentials): string {
    return `https://login.microsoftonline.com/${tenant(credentials)}/oauth2/v2.0/token`;
  }

  /**
   * The issuer names the directory the user signed in from, which the `common` endpoint
   * only reveals in the token itself. Trusting `tid` blindly would defeat the check, so
   * it is trusted only to name the issuer it is embedded in, and the two must agree.
   */
  protected override assertIssuer(claims: JWTPayload, credentials: ProviderCredentials): void {
    const configured = credentials.config["tenant"];
    const pinned = typeof configured === "string" && configured !== "common" ? configured : null;
    const directory = pinned ?? (typeof claims["tid"] === "string" ? claims["tid"] : "");
    assertExactIssuer(claims, `https://login.microsoftonline.com/${directory}/v2.0`, this.id);
  }

  protected override jwksUri(credentials: ProviderCredentials): string {
    return `https://login.microsoftonline.com/${tenant(credentials)}/discovery/v2.0/keys`;
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "email", "profile"];
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    return {
      providerUserId: subjectOf(claims, this.id),
      email: stringClaim(claims, "email") ?? stringClaim(claims, "preferred_username"),
      // No claim asserts this, so we do not assert it either.
      emailVerified: false,
      displayName: stringClaim(claims, "name"),
      avatarUrl: null,
    };
  }
}
