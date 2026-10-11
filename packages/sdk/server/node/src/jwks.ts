import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

/** What `jose` wants: a function from a token's header to the key that signed it. */
export type KeyResolver = JWTVerifyGetKey;

/**
 * Where the public keys come from.
 *
 * Two implementations, and both are real. Almost everybody wants the remote one, because
 * keys rotate and a pinned copy stops verifying on the day they do. Pinning is for the
 * deployments that cannot make an outbound call at all, and for tests.
 */
export abstract class JwksSource {
  abstract resolver(): KeyResolver;
}

/**
 * The project's published JWKS, fetched once and kept.
 *
 * Every project signs with its own key, so the set is the project's, at
 * `/v1/projects/{projectId}/jwks.json`. A token minted for another project does not verify
 * against it, whatever its audience says.
 *
 * `jose` owns the caching, and the part worth knowing is what it does on a key it has never
 * seen: it refetches, once, behind a cooldown. That is what makes a rotation invisible to a
 * running server, and the cooldown is what stops a token with an invented `kid` turning every
 * verification into a request to us.
 */
export class RemoteJwks extends JwksSource {
  private readonly resolve: KeyResolver;

  constructor(issuerUrl: string, projectId: string) {
    super();
    this.resolve = createRemoteJWKSet(
      new URL(`v1/projects/${encodeURIComponent(projectId)}/jwks.json`, withSlash(issuerUrl)),
    );
  }

  override resolver(): KeyResolver {
    return this.resolve;
  }
}

/**
 * Keys held in hand, verified against and never refetched.
 *
 * For a deployment with no egress, and for tests. The cost is stated rather than hidden: a
 * key rotation invalidates this set, and every token signed by the new key fails until the
 * copy is replaced.
 */
export class StaticJwks extends JwksSource {
  private readonly resolve: KeyResolver;

  constructor(keys: JSONWebKeySet) {
    super();
    this.resolve = createLocalJWKSet(keys);
  }

  override resolver(): KeyResolver {
    return this.resolve;
  }
}

/** A trailing slash, so the path resolves against the whole base and not its parent. */
function withSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}
