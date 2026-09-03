/**
 * base64url, both ways.
 *
 * WebAuthn is the one place in this SDK where the wire and the browser API disagree about
 * types: every identifier, challenge and signature is a `BufferSource` in
 * `navigator.credentials` and base64url in JSON. Newer browsers can do this themselves with
 * `PublicKeyCredential.toJSON`, and this is here rather than there because the conversion is
 * forty lines and the browsers that lack it are still the ones a customer's users are on.
 */
export function toBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  // Padding restored explicitly. `atob` tolerates its absence in most browsers and not in
  // all of them, which is the kind of difference that shows up as one vendor's users being
  // unable to sign in.
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
