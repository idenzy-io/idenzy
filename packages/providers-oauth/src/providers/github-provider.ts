import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import type {
  OAuthFlowStore,
  ProviderCredentials,
  ProviderProfile,
  RedirectAllowlist,
  TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { OAuthProvider } from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";

interface GithubUser {
  readonly id?: number;
  readonly login?: string;
  readonly name?: string | null;
  readonly email?: string | null;
  readonly avatar_url?: string | null;
}

interface GithubEmail {
  readonly email?: string;
  readonly primary?: boolean;
  readonly verified?: boolean;
}

/**
 * GitHub (PROJECT.md 4.6).
 *
 * The one provider here that is not OIDC, so it extends the base directly and there is
 * no id_token to verify. That is not a gap in the checks: state, PKCE and the redirect
 * allowlist are all inherited, and the mix-up defence an id_token gives is not available
 * for a provider that does not issue one.
 *
 * The awkward part is the address. `GET /user` returns `email` as whatever the user set
 * as public, which may be blank, may be a `noreply` alias, and carries no verification
 * status at all. Linking an account on that would be linking on an unverified address,
 * so the primary verified address is read from `/user/emails` instead, and a user who
 * has none is reported unverified rather than assumed.
 */
export class GithubProvider extends OAuthProvider {
  override readonly id = ProviderId.Github;

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://github.com/login/oauth/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://github.com/login/oauth/access_token";
  }

  protected override defaultScopes(): readonly string[] {
    return ["read:user", "user:email"];
  }

  protected override async fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const user = await this.get<GithubUser>("https://api.github.com/user", grant);
    if (typeof user.id !== "number") {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the profile carried no numeric id" },
      });
    }

    const primary = await this.primaryEmail(grant);
    return {
      // Stringified because every other provider's subject is a string and the identity
      // table stores one. The value itself is GitHub's immutable numeric id, not the
      // login, which a user can change and hand to somebody else.
      providerUserId: String(user.id),
      email: primary?.email ?? null,
      emailVerified: primary?.verified === true,
      displayName: user.name ?? user.login ?? null,
      avatarUrl: user.avatar_url ?? null,
    };
  }

  /**
   * The primary verified address, or nothing.
   *
   * A token without `user:email` gets a 403 here, which is a scope the project chose not
   * to request rather than a failure: the sign-in continues with no address, and the
   * customer's UI collects one if it needs one.
   */
  private async primaryEmail(grant: TokenGrant): Promise<GithubEmail | null> {
    const response = await this.http.json<readonly GithubEmail[]>({
      url: "https://api.github.com/user/emails",
      method: "GET",
      headers: this.headers(grant),
    });
    if (response.status >= 400 || !Array.isArray(response.data)) return null;
    return response.data.find((entry) => entry.primary === true && entry.verified === true) ?? null;
  }

  private async get<T>(url: string, grant: TokenGrant): Promise<T> {
    const response = await this.http.json<T>({
      url,
      method: "GET",
      headers: this.headers(grant),
    });
    if (response.status >= 400) {
      throw new OauthProviderError({
        detail: { provider: this.id, url, statusCode: response.status },
      });
    }
    return response.data;
  }

  private headers(grant: TokenGrant): Record<string, string> {
    return {
      authorization: `Bearer ${grant.accessToken}`,
      "user-agent": "idenzy-auth",
      "x-github-api-version": "2022-11-28",
    };
  }
}
