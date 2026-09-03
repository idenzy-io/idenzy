import type {
  AuthenticationResponse,
  authenticatorSelectionSchema,
  PublicKeyCredentialCreationOptions as CreationOptionsJson,
  RegistrationResponse,
  PublicKeyCredentialRequestOptions as RequestOptionsJson,
} from "@idenzy/protocol/schemas/webauthn";
import type { z } from "zod";
import { fromBase64Url, toBase64Url } from "./base64url.js";

type AuthenticatorSelection = z.infer<typeof authenticatorSelectionSchema>;

/**
 * The translation between our JSON and `navigator.credentials`, in one place.
 *
 * Field names are the W3C ones on both sides, so this converts encodings and nothing else. A
 * friendlier shape here would mean every SDK owning a mapping that can drift from the
 * server's verifier, and a mismatch in a signed field fails as an invalid assertion with
 * nothing to point at.
 */
export function toCreationOptions(json: CreationOptionsJson): PublicKeyCredentialCreationOptions {
  return {
    rp: json.rp,
    user: {
      id: fromBase64Url(json.user.id),
      name: json.user.name,
      displayName: json.user.displayName,
    },
    challenge: fromBase64Url(json.challenge),
    pubKeyCredParams: json.pubKeyCredParams.map((parameter) => ({
      type: parameter.type,
      alg: parameter.alg,
    })),
    ...(json.timeout === undefined ? {} : { timeout: json.timeout }),
    ...(json.excludeCredentials === undefined
      ? {}
      : { excludeCredentials: json.excludeCredentials.map(toDescriptor) }),
    ...(json.authenticatorSelection === undefined
      ? {}
      : { authenticatorSelection: toSelection(json.authenticatorSelection) }),
    ...(json.attestation === undefined ? {} : { attestation: json.attestation }),
  };
}

export function toRequestOptions(json: RequestOptionsJson): PublicKeyCredentialRequestOptions {
  return {
    challenge: fromBase64Url(json.challenge),
    rpId: json.rpId,
    ...(json.timeout === undefined ? {} : { timeout: json.timeout }),
    ...(json.allowCredentials === undefined
      ? {}
      : { allowCredentials: json.allowCredentials.map(toDescriptor) }),
    ...(json.userVerification === undefined ? {} : { userVerification: json.userVerification }),
  };
}

/** What the browser hands back after `create()`, as the registration endpoint wants it. */
export function fromAttestation(credential: PublicKeyCredential): RegistrationResponse {
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = response.getTransports?.() ?? [];
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    ...(credential.authenticatorAttachment === null ||
    credential.authenticatorAttachment === undefined
      ? {}
      : { authenticatorAttachment: attachment(credential.authenticatorAttachment) }),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      ...(transports.length === 0 ? {} : { transports: [...transports] }),
    },
  };
}

/** What the browser hands back after `get()`, as the authentication endpoint wants it. */
export function fromAssertion(credential: PublicKeyCredential): AuthenticationResponse {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: "public-key",
    ...(credential.authenticatorAttachment === null ||
    credential.authenticatorAttachment === undefined
      ? {}
      : { authenticatorAttachment: attachment(credential.authenticatorAttachment) }),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      ...(response.userHandle === null ? {} : { userHandle: toBase64Url(response.userHandle) }),
    },
  };
}

/**
 * Rebuilt key by key rather than passed through. `residentKey: required` is the setting the
 * usernameless flow depends on, and it is the server's to choose; copying it across a type
 * boundary that allows `undefined` for absent is how it would quietly become `preferred`.
 */
function toSelection(json: AuthenticatorSelection): AuthenticatorSelectionCriteria {
  return {
    ...(json.authenticatorAttachment === undefined
      ? {}
      : { authenticatorAttachment: json.authenticatorAttachment }),
    ...(json.residentKey === undefined ? {} : { residentKey: json.residentKey }),
    ...(json.requireResidentKey === undefined
      ? {}
      : { requireResidentKey: json.requireResidentKey }),
    ...(json.userVerification === undefined ? {} : { userVerification: json.userVerification }),
  };
}

function toDescriptor(descriptor: {
  id: string;
  type: "public-key";
  transports?: string[] | undefined;
}): PublicKeyCredentialDescriptor {
  return {
    id: fromBase64Url(descriptor.id),
    type: descriptor.type,
    // The wire keeps transports as free strings on purpose: the registry grows, and a hint
    // we do not recognise is still worth echoing. The browser's type is the narrower of the
    // two, and it ignores a value it does not know.
    ...(descriptor.transports === undefined
      ? {}
      : { transports: descriptor.transports as AuthenticatorTransport[] }),
  };
}

/** The attachment the browser reports is one of two strings; the schema names the same two. */
function attachment(value: string): "platform" | "cross-platform" {
  return value === "cross-platform" ? "cross-platform" : "platform";
}
