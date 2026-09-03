import { MfaFactorType } from "@idenzy/protocol/enums/auth";
import { type MfaProof, mfaPasskeyOptionsSchema } from "@idenzy/protocol/schemas/mfa";
import { IdenzyConfigurationError } from "../errors.js";
import type { ApiClient } from "../http/api-client.js";
import { fromAssertion, toRequestOptions } from "../passkey/ceremony-options.js";

/**
 * The second-factor half of the WebAuthn ceremony.
 *
 * A free function rather than a method, because both the sign-in challenge and the step-up
 * challenge need it and neither owns the other. It asks for options against the challenge
 * it is answering, which is what pins the ceremony to the account already named, and hands
 * back the proof rather than submitting it: what happens next differs between the two.
 */
export async function proveWithPasskey(api: ApiClient, challengeId: string): Promise<MfaProof> {
  if (globalThis.navigator?.credentials === undefined) {
    throw new IdenzyConfigurationError("This browser does not support passkeys.");
  }
  const started = await api.send(mfaPasskeyOptionsSchema, {
    method: "POST",
    path: "v1/auth/mfa/passkey/options",
    body: { challengeId },
  });
  const credential = await globalThis.navigator.credentials.get({
    publicKey: toRequestOptions(started.publicKey),
  });
  if (credential === null || !(credential instanceof globalThis.PublicKeyCredential)) {
    throw new IdenzyConfigurationError("The browser returned no passkey assertion.");
  }
  return {
    factor: MfaFactorType.Passkey,
    ceremonyId: started.challengeId,
    response: fromAssertion(credential),
  };
}
