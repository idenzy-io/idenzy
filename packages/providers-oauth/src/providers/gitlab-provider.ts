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

const GITLAB_COM = "https://gitlab.com";

/**
 * Which GitLab this project signs in against, without a trailing slash.
 *
 * Self-managed GitLab is the reason this is configuration rather than a constant: an
 * instance is a directory of its own, and `sub` numbers users inside one instance and
 * means nothing across two. A project that repoints this is pointing at a different set
 * of people, so the value is also the issuer every assertion is checked against.
 *
 * Only https, and nothing that could smuggle a second target past the check: this string
 * becomes the host we send a client secret to, so a mistyped or hostile one is refused
 * rather than called.
 */
function instance(credentials: ProviderCredentials): string {
  const configured = credentials.config["instance"];
  if (typeof configured !== "string" || configured.length === 0) return GITLAB_COM;

  const url = URL.parse(configured);
  if (url === null || url.protocol !== "https:" || url.username !== "" || url.search !== "") {
    throw new OauthProviderError({
      detail: {
        provider: ProviderId.Gitlab,
        reason: "the configured instance is not an https url",
      },
    });
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * GitLab (PROJECT.md 4.6).
 *
 * OIDC, so the profile arrives in the id_token and there is no userinfo call on the
 * request path. GitLab confirms an address before it will use it and says so in
 * `email_verified`, which makes it one of the providers a returning user can link an
 * existing account with.
 *
 * The instance is configurable because self-managed GitLab is the common case for the
 * customers who ask for this provider. That makes the issuer configurable too, and the
 * check is what keeps it honest: an assertion signed by gitlab.com is refused for a
 * project configured against its own instance, and the other way round.
 */
export class GitlabProvider extends OidcProvider {
  override readonly id = ProviderId.Gitlab;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(credentials: ProviderCredentials): string {
    return `${instance(credentials)}/oauth/authorize`;
  }

  protected override tokenEndpoint(credentials: ProviderCredentials): string {
    return `${instance(credentials)}/oauth/token`;
  }

  protected override assertIssuer(claims: JWTPayload, credentials: ProviderCredentials): void {
    assertExactIssuer(claims, instance(credentials), this.id);
  }

  protected override jwksUri(credentials: ProviderCredentials): string {
    return `${instance(credentials)}/oauth/discovery/keys`;
  }

  protected override defaultScopes(): readonly string[] {
    return ["openid", "profile", "email"];
  }

  protected override mapClaims(claims: JWTPayload): ProviderProfile {
    return {
      // The numeric user id, never `nickname`: a GitLab username can be changed and the
      // old one becomes available to whoever claims it next.
      providerUserId: subjectOf(claims, this.id),
      email: stringClaim(claims, "email"),
      emailVerified: verifiedEmailClaim(claims),
      displayName: stringClaim(claims, "name") ?? stringClaim(claims, "nickname"),
      avatarUrl: stringClaim(claims, "picture"),
    };
  }
}
