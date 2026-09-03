import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import {
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
  type TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { ProviderId } from "@idenzy/protocol/enums/providers";

interface NotionPerson {
  readonly id?: string;
  readonly name?: string | null;
  readonly avatar_url?: string | null;
  readonly person?: { readonly email?: string | null };
}

/**
 * The person the grant belongs to, out of the token response.
 *
 * Defensive rather than cast, because this is the only description of the user we get and
 * a shape we did not expect must read as absent rather than as an empty identity.
 */
function ownerOf(raw: Readonly<Record<string, unknown>>): NotionPerson | null {
  const owner = raw["owner"];
  if (typeof owner !== "object" || owner === null) return null;
  const user = (owner as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  return user as NotionPerson;
}

/**
 * Notion (PROJECT.md 4.6).
 *
 * The one adapter that is more than an endpoint pair and a mapping, in three ways.
 *
 * Its token endpoint takes JSON. RFC 6749 requires a form and Notion's API speaks nothing
 * but JSON, which is why the base has an encoding hook; a form comes back as an error
 * about the grant type that says nothing about the encoding, so this is a day lost to
 * anyone who has to rediscover it.
 *
 * The profile arrives inside the token response rather than from a call of its own. There
 * is a `/v1/users/me` endpoint, but it describes the integration's bot and not the person
 * who authorized it, so calling it would key every user of one integration on one subject
 * and hand them all the same account. The owner is captured as the grant is mapped, which
 * is the only place it exists, and read back by subject rather than held in a field so
 * that one shared instance can serve every tenant.
 *
 * And there are no scopes: Notion's capabilities are configured on the integration itself,
 * so `scope` is dropped from the authorization url rather than sent empty, and `owner=user`
 * is what asks for a person's authorization rather than a workspace's.
 */
export class NotionProvider extends OAuthProvider {
  override readonly id = ProviderId.Notion;

  /** The owner from the token response, keyed by the grant it arrived with. */
  private readonly owners = new WeakMap<TokenGrant, NotionPerson>();

  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the registry build one.
  constructor(http: HttpClient, clock: Clock, flows: OAuthFlowStore, allowlist: RedirectAllowlist) {
    super(http, clock, flows, allowlist);
  }

  protected override authorizeEndpoint(): string {
    return "https://api.notion.com/v1/oauth/authorize";
  }

  protected override tokenEndpoint(): string {
    return "https://api.notion.com/v1/oauth/token";
  }

  protected override clientAuthentication(): "basic" {
    return "basic";
  }

  protected override tokenEncoding(): "json" {
    return "json";
  }

  protected override defaultScopes(): readonly string[] {
    return [];
  }

  protected override decorateAuthorization(url: URL): void {
    // Notion has no scopes, and an empty `scope` reads as a request for none rather than
    // as the absence of the parameter.
    if (url.searchParams.get("scope") === "") url.searchParams.delete("scope");
    url.searchParams.set("owner", "user");
  }

  protected override mapGrant(raw: Readonly<Record<string, unknown>>): TokenGrant {
    const grant = super.mapGrant(raw);
    const owner = ownerOf(raw);
    if (owner !== null) this.owners.set(grant, owner);
    return grant;
  }

  protected override fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const owner = this.owners.get(grant);
    const id = owner?.id;
    if (owner === undefined || typeof id !== "string") {
      // A workspace-owned grant lands here: it names a bot rather than a person, and there
      // is nobody to sign in.
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the token response named no owning person" },
      });
    }

    return Promise.resolve({
      providerUserId: id,
      email: owner.person?.email ?? null,
      // Notion asserts nothing about the address, so neither do we.
      emailVerified: false,
      displayName: owner.name ?? null,
      avatarUrl: owner.avatar_url ?? null,
    });
  }
}
