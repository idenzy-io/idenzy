import { OauthProviderError } from "@idenzy/core/errors";
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

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }

  protected override tokenEndpoint(): string {
    return "https://oauth2.googleapis.com/token";
  }

  /**
   * The issuer, and — where the project restricts sign-in to one Google Workspace — the domain.
   *
   * **The `hd` claim and not the email.** Anybody can create a personal Google account on an
   * address they control at any domain, and Google will mark that address verified; an email
   * ending `@example.com` therefore proves nothing about membership of example.com's Workspace.
   * `hd` is set by Google only for an account the domain's Workspace manages, so it is the one
   * claim that answers the question. The email is checked as well, because an account can carry
   * a secondary address, and a verified one is required, because a guard downstream will key on it.
   *
   * Refused here, after the signature and before anything is mapped or stored: an assertion from
   * outside the domain never becomes a user in the project at all.
   */
  protected override assertIssuer(claims: JWTPayload, credentials: ProviderCredentials): void {
    // Google documents both spellings as its issuer, and a token from a native sign-in may
    // carry either. Two exact values, never a pattern.
    if (claims.iss !== "accounts.google.com") {
      assertExactIssuer(claims, "https://accounts.google.com", this.id);
    }

    const domain = hostedDomainOf(credentials);
    if (domain === null) return;
    const hd = typeof claims["hd"] === "string" ? claims["hd"].toLowerCase() : null;
    const email = stringClaim(claims, "email")?.toLowerCase() ?? null;
    if (hd !== domain) {
      throw new OauthProviderError({
        detail: {
          provider: this.id,
          reason: "the account is not in the required Workspace domain",
        },
      });
    }
    if (email === null || !email.endsWith(`@${domain}`) || !verifiedEmailClaim(claims)) {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the account has no verified address in the domain" },
      });
    }
  }

  protected override jwksUri(): string {
    return "https://www.googleapis.com/oauth2/v3/certs";
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "email", "profile"];
  }

  protected override decorateAuthorization(url: URL, credentials: ProviderCredentials): void {
    url.searchParams.set("prompt", "select_account");
    // A hint to Google's account chooser and nothing more: a person can edit it out of the URL,
    // which is why `assertIssuer` checks the claim rather than trusting this.
    const domain = hostedDomainOf(credentials);
    if (domain !== null) url.searchParams.set("hd", domain);
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

/**
 * The Workspace domain a project restricts Google sign-in to, from `oauth_providers.settings`,
 * lower case; null where it restricts nothing, which is every customer that has not asked.
 */
function hostedDomainOf(credentials: ProviderCredentials): string | null {
  const value = credentials.config["hostedDomain"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}
