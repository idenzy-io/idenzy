import { IdenzyConfigurationError } from "../errors.js";

/** 32 bytes, which is 43 base64url characters: the length the server's challenge regex pins. */
const VERIFIER_BYTES = 32;

/**
 * A PKCE pair for the exchange code we will be handed back (PROJECT.md 4.6).
 *
 * The verifier stays in this browser and the challenge travels, which is what makes the code
 * in the redirect worth less than it looks: an attacker who intercepts it, out of a referrer
 * header or a shared machine's history, still cannot exchange it. We are the client here, so
 * we hold the secret and present it at the end.
 */
export class PkceChallenge {
  private constructor(
    readonly verifier: string,
    readonly challenge: string,
  ) {}

  static async create(): Promise<PkceChallenge> {
    const subtle = requireSubtle();
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES)));
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return new PkceChallenge(verifier, base64Url(new Uint8Array(digest)));
  }
}

/**
 * WebCrypto is only present in a secure context, so its absence means the page is on plain
 * http somewhere other than loopback. Saying that is more useful than the `undefined` that a
 * property access would otherwise produce three frames later.
 */
function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new IdenzyConfigurationError(
      "WebCrypto is unavailable, which means this page is not in a secure context. OAuth needs https or localhost.",
    );
  }
  return subtle;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
