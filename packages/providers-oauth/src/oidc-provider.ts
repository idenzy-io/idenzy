import { OauthProviderError } from "@idenzy/core/errors";
import type { HttpClient } from "@idenzy/core/http/http-client";
import type { Clock } from "@idenzy/core/time/clock";
import {
  type OAuthFlowStore,
  OAuthProvider,
  type ProviderCredentials,
  type ProviderProfile,
  type RedirectAllowlist,
  type StoredFlow,
  type TokenGrant,
} from "@idenzy/domain/ports/oauth-provider";
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";

/** One JWKS per issuer, cached across requests. Refetching per sign-in is a self-DoS. */
const keyStores = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = keyStores.get(jwksUri);
  if (existing !== undefined) return existing;
  // jose handles the cooldown and the rotation refetch itself, which is why this is a
  // plain map and not a cache with its own expiry policy to get wrong.
  const created = createRemoteJWKSet(new URL(jwksUri));
  keyStores.set(jwksUri, created);
  return created;
}

/**
 * The intermediate layer for providers that speak OpenID Connect (PROJECT.md 7.2.4).
 *
 * It exists for one reason: the id_token. A plain OAuth 2 provider hands back an access
 * token and we go and ask who it belongs to; an OIDC provider hands back a signed
 * assertion about who it belongs to, and checking that assertion properly is fiddly
 * enough that no adapter should be writing it again.
 *
 * `assertGrantIntegrity` is where the mix-up defence lives. Without the issuer check, an
 * attacker who controls one provider can take a code from it and present it at a
 * provider we trust; the audience check stops an id_token minted for a different client
 * being replayed at ours; and the nonce ties the assertion to the flow we started rather
 * than to one an attacker started earlier.
 *
 * Profiles come from the id_token rather than from a userinfo call, which is one fewer
 * round trip on every sign-in and one fewer thing to be unavailable.
 */
export abstract class OidcProvider extends OAuthProvider {
  protected constructor(
    http: HttpClient,
    clock: Clock,
    flows: OAuthFlowStore,
    allowlist: RedirectAllowlist,
  ) {
    super(http, clock, flows, allowlist);
  }

  /**
   * The mix-up defence itself, and a hook rather than a constant on purpose.
   *
   * Most providers compare `iss` against one fixed string, but Microsoft's `common`
   * endpoint issues an assertion whose issuer names the directory the user came from,
   * so a fixed value would reject every real sign-in and the obvious fix, dropping the
   * check, would reopen the attack. A hook lets that provider be exact about a value it
   * cannot know in advance.
   */
  protected abstract assertIssuer(claims: JWTPayload, credentials: ProviderCredentials): void;
  protected abstract jwksUri(credentials: ProviderCredentials): string;
  protected abstract mapClaims(claims: JWTPayload): ProviderProfile;

  /** Verified claims from the last grant, so the profile is not verified twice. */
  private readonly verified = new WeakMap<TokenGrant, JWTPayload>();

  protected override async assertGrantIntegrity(
    credentials: ProviderCredentials,
    grant: TokenGrant,
    flow: StoredFlow,
  ): Promise<void> {
    if (grant.idToken === null) {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "an oidc token response carried no id_token" },
      });
    }

    // Signature, audience and expiry here; the issuer immediately below. Splitting them
    // is not a weakening: the assertion is refused either way, and nothing between the
    // two calls trusts the payload.
    const { payload } = await jwtVerify(grant.idToken, keysFor(this.jwksUri(credentials)), {
      audience: credentials.clientId,
      clockTolerance: 60,
    }).catch((error: unknown) => {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the id_token did not verify" },
        cause: error,
      });
    });
    this.assertIssuer(payload, credentials);

    // The nonce is checked here and not in jwtVerify, which has no notion of it. A flow
    // that asked for a nonce and got an assertion without one is an assertion replayed
    // from somewhere else.
    if (flow.nonce !== null && payload["nonce"] !== flow.nonce) {
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "the id_token nonce did not match the flow" },
      });
    }

    this.verified.set(grant, payload);
  }

  protected override fetchProfile(
    _credentials: ProviderCredentials,
    grant: TokenGrant,
  ): Promise<ProviderProfile> {
    const claims = this.verified.get(grant);
    if (claims === undefined) {
      // Unreachable through completeFlow, which always verifies first. Reachable by a
      // subclass that called this directly, and that must not silently skip the check.
      throw new OauthProviderError({
        detail: { provider: this.id, reason: "profile requested before the id_token verified" },
      });
    }
    return Promise.resolve(this.mapClaims(claims));
  }
}

/** Refuses an assertion from anyone but the provider we started the flow with. */
export function assertExactIssuer(claims: JWTPayload, expected: string, provider: string): void {
  if (claims.iss !== expected) {
    throw new OauthProviderError({
      detail: { provider, reason: "the id_token came from another issuer" },
    });
  }
}

/** `sub` is the only claim OIDC promises is stable and unique per issuer. */
export function subjectOf(claims: JWTPayload, provider: string): string {
  const sub = claims.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new OauthProviderError({
      detail: { provider, reason: "the id_token carried no sub" },
    });
  }
  return sub;
}

export function stringClaim(claims: JWTPayload, name: string): string | null {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * `email_verified` as providers actually send it, which is not always a boolean.
 *
 * Anything that is not an explicit true reads as false, and that asymmetry is the point:
 * this value decides whether an account can be linked on an address alone, so an
 * unrecognised shape must never resolve to "verified" (PROJECT.md 4.6).
 */
export function verifiedEmailClaim(claims: JWTPayload): boolean {
  const value = claims["email_verified"];
  return value === true || value === "true";
}
