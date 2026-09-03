import { type SessionSnapshot, seededSession } from "@idenzy/js/session/session-store";
import { AccessTokenVerifier } from "@idenzy/node";
import type { IdenzyRuntimeOptions } from "./options.js";

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
): Promise<SessionSnapshot | null> {
  const verifier = verifierFor(options);
  if (verifier === null) return null;
  try {
    const verified = await verifier.verifyRequest(headers);
    return seededSession(verified.userId, verified.sessionId);
  } catch {
    // Never fatal. A page renders either way, and an unreadable cookie is the normal case
    // for every signed-out visitor.
    return null;
  }
}

function verifierFor(options: IdenzyRuntimeOptions): AccessTokenVerifier | null {
  const projectId = options.projectId;
  if (projectId === undefined) return null;
  const issuerUrl = options.issuerUrl ?? options.apiUrl;
  const key = `${issuerUrl}|${projectId}`;

  const held = verifiers.get(key);
  if (held !== undefined) return held;
  const built = new AccessTokenVerifier({ issuerUrl, projectId });
  verifiers.set(key, built);
  return built;
}
