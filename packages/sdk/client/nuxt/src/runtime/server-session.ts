import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier } from "@idenzy/node";
import { RemoteJwks } from "@idenzy/node/jwks";
import { RevocationCache } from "@idenzy/node/revocations";
import type { IdenzyRuntimeOptions, IdenzyServerRuntimeOptions } from "./options.js";

/**
 * Server-only. Imported dynamically by the plugin so `@idenzy/node` and the JWKS machinery
 * behind it never reach a browser bundle.
 */

/** One verifier per project, because the JWKS cache is the whole point of holding it. */
const verifiers = new Map<string, AccessTokenVerifier>();

/**
 * What the server can tell about the request, from the session cookie alone.
 *
 * A hit is what makes a server-rendered page for a signed-in user cost no round trip, and it
 * is deliberately narrow: the token names the user and the session and carries no profile, so
 * this is a seed and not a session.
 *
 * Anything else is null rather than signed-out, and the difference matters. The access-token
 * cookie is the short-lived one; a user whose access token expired an hour ago still has a
 * refresh cookie and is still signed in, and rendering them signed-out on the server would
 * put a sign-in screen in the HTML for someone the very next request proves is signed in.
 * Null renders `loading`, which is the truth: the browser is about to find out.
 */
export async function seedFromRequest(
  options: IdenzyRuntimeOptions,
  headers: Readonly<Record<string, string | undefined>>,
  server: IdenzyServerRuntimeOptions = {},
): Promise<SessionSnapshot | null> {
  const verifier = verifierFor(options, server);
  if (verifier === null) return null;
  try {
    const verified = await verifier.verifyRequest(headers);
    return seededSession(verified.userId, verified.sessionId);
  } catch {
    // Never fatal, and a revoked session arrives here as one of these. A page renders either
    // way, and an unreadable cookie is the normal case for every signed-out visitor.
    return null;
  }
}

function verifierFor(
  options: IdenzyRuntimeOptions,
  server: IdenzyServerRuntimeOptions,
): AccessTokenVerifier | null {
  const projectId = options.projectId;
  if (projectId === undefined) return null;
  const issuerUrl = options.issuerUrl ?? options.apiUrl;
  const key = `${issuerUrl}|${projectId}`;

  const held = verifiers.get(key);
  if (held !== undefined) return held;

  // One JWKS source for both, so the snapshot's signature and the token's are checked against
  // the same cached key set rather than two copies of it fetched separately.
  const keys = new RemoteJwks(issuerUrl);
  const revocations = revocationsFor(issuerUrl, projectId, server, keys);
  const built = new AccessTokenVerifier(
    { issuerUrl, projectId, ...(revocations === null ? {} : { revocations }) },
    keys,
  );
  verifiers.set(key, built);
  return built;
}

/**
 * The set, where a secret key was configured to reach it with.
 *
 * `start` is deliberately not awaited. It fetches before it schedules, and awaiting it here
 * would put that fetch on the first render, where a hung connection is a page that never
 * responds rather than a set that is not ready yet. Until the first poll lands the cache reads
 * stale and answers "not revoked", which is the documented fail-open and exactly the exposure
 * a deployment without a set has all the time (ADR-0009).
 */
function revocationsFor(
  issuerUrl: string,
  projectId: string,
  server: IdenzyServerRuntimeOptions,
  keys: RemoteJwks,
): RevocationCache | null {
  const secretKey = server.secretKey;
  if (secretKey === undefined || secretKey === "") return null;

  const cache = new RevocationCache(
    {
      issuerUrl,
      projectId,
      secretKey,
      ...(server.revocationPollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: server.revocationPollIntervalMs }),
    },
    keys,
  );
  void cache.start();
  return cache;
}
