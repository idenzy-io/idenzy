/**
 * Proof that a human, or a genuine build of a customer's app, is behind a request
 * (PROJECT.md 4.8).
 *
 * reCAPTCHA Enterprise and Turnstile on the web, App Attest and Play Integrity on mobile.
 * One port for all four because the answer we need from each is the same single bit, and
 * the differences between them are entirely in how a token is checked.
 *
 * `verify` answers rather than throws, so the caller decides what a failure means. That
 * matters because it is not always a refusal: a project that has not turned attestation
 * on never asks, and the same false answer is a hard stop only where the policy says so.
 */
export interface AttestationVerifier {
  /**
   * Whether the token is genuine and belongs to this request.
   *
   * The IP is passed because both web providers score a token against the address that
   * solved it, and a token replayed from somewhere else is the case they exist to catch.
   */
  verify(projectId: string, token: string, ip: string | null): Promise<boolean>;
}
