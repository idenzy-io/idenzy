import { WebauthnAssertionInvalidError } from "@idenzy/core/errors";
import type {
  AuthenticationResponse,
  PublicKeyCredentialCreationOptions,
  PublicKeyCredentialRequestOptions,
  RegistrationResponse,
} from "@idenzy/protocol/schemas/webauthn";
import { Injectable } from "@nestjs/common";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";

/**
 * COSE algorithms we advertise, and the same list we verify against.
 *
 * Ed25519, ES256 and RS256, in the order authenticators should prefer them. The two
 * lists have to agree: advertising an algorithm the verifier then rejects registers an
 * authenticator that can never sign in, and the failure appears weeks later on the
 * user's next attempt rather than at enrolment.
 */
const SUPPORTED_ALGORITHMS = [-8, -7, -257] as const;

export interface RelyingParty {
  readonly rpId: string;
  readonly rpName: string;
  readonly origins: readonly string[];
}

export interface CeremonySubject {
  readonly userHandle: string;
  readonly name: string;
  readonly displayName: string;
}

export interface RegisteredCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly aaguid: string | null;
  readonly transports: readonly string[];
  readonly backupEligible: boolean;
  readonly backupState: boolean;
}

export interface AssertedCredential {
  readonly signCount: number;
  readonly backupState: boolean;
}

/** What a stored credential has to supply for an assertion to be checked against it. */
export interface StoredCredential {
  readonly credentialId: string;
  readonly publicKey: string;
  readonly signCount: number;
  readonly transports: readonly string[];
}

/**
 * The WebAuthn ceremonies, and the line between what we write and what we delegate
 * (PROJECT.md 4.7).
 *
 * Options are built here, by hand, because a `PublicKeyCredentialCreationOptions` is a
 * JSON literal wrapped around a random nonce and generating it ourselves keeps the shape
 * we publish in `@idenzy/protocol` the shape we actually send. Verification is delegated
 * to `@simplewebauthn/server`, because that half is CBOR parsing, COSE key decoding and
 * signature checking over attestation formats, and PROJECT.md 6.2 chose an audited
 * library for exactly this.
 *
 * The class holds no state and takes no dependencies. Everything a ceremony needs
 * arrives as an argument, so one instance serves every tenant and no relying party
 * configuration can survive between two requests.
 */
@Injectable()
export class PasskeyCeremony {
  /**
   * Registration options.
   *
   * Two settings are not negotiable. `residentKey: required` makes the credential
   * discoverable, which is what lets sign-in ask for nobody in particular and is the
   * whole reason our authentication endpoint needs no username (PROJECT.md 4.7).
   * `userVerification: required` is what makes the passkey a complete authentication
   * rather than one factor, since possession alone would be a password with extra steps.
   */
  registrationOptions(
    rp: RelyingParty,
    subject: CeremonySubject,
    challenge: string,
    exclude: readonly StoredCredential[],
    timeoutMs: number,
  ): PublicKeyCredentialCreationOptions {
    return {
      rp: { id: rp.rpId, name: rp.rpName },
      user: { id: subject.userHandle, name: subject.name, displayName: subject.displayName },
      challenge,
      pubKeyCredParams: SUPPORTED_ALGORITHMS.map((alg) => ({ type: "public-key", alg })),
      timeout: timeoutMs,
      // Their own credentials, so listing them enumerates nothing. It is what makes a
      // second enrolment on the same authenticator fail in the browser with something
      // the user understands rather than as a 409 from us.
      excludeCredentials: exclude.map((credential) => ({
        id: credential.credentialId,
        type: "public-key",
        transports: [...credential.transports],
      })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      // We do not collect attestation. Knowing the make of somebody's authenticator is
      // an enterprise requirement we do not have, and asking for it adds a privacy
      // prompt on some platforms for information we would then throw away.
      attestation: "none",
    };
  }

  /**
   * Authentication options, with no `allowCredentials` and deliberately so.
   *
   * An empty list tells the browser to offer whatever discoverable credential it holds
   * for this RP ID, which is both what conditional UI needs and what keeps this endpoint
   * from answering differently for an address that has passkeys and one that does not.
   */
  authenticationOptions(
    rp: RelyingParty,
    challenge: string,
    timeoutMs: number,
  ): PublicKeyCredentialRequestOptions {
    return {
      challenge,
      rpId: rp.rpId,
      timeout: timeoutMs,
      userVerification: "required",
    };
  }

  /**
   * Verifies an attestation.
   *
   * `expectedChallenge` is a predicate rather than a value because we store only the
   * digest of the nonce we issued (see `webauthn_challenges`). The library hands us the
   * challenge the browser signed over and asks whether we recognise it, which a
   * comparison of digests answers without ever holding the plaintext.
   */
  async verifyRegistration(
    rp: RelyingParty,
    response: RegistrationResponse,
    expectedChallenge: (challenge: string) => boolean,
  ): Promise<RegisteredCredential> {
    const verification = await this.attempt("registration", () =>
      verifyRegistrationResponse({
        response: {
          id: response.id,
          rawId: response.rawId,
          type: response.type,
          // Browser-reported and unsigned, so the verifier ignores it and so do we. The
          // trustworthy answers to "is this discoverable" and "is this backed up" are
          // the BE and BS flags inside the signed authenticator data below.
          clientExtensionResults: {},
          response: {
            clientDataJSON: response.response.clientDataJSON,
            attestationObject: response.response.attestationObject,
            ...(response.response.transports === undefined
              ? {}
              : { transports: [...response.response.transports] }),
          },
        },
        expectedChallenge,
        expectedOrigin: [...rp.origins],
        expectedRPID: rp.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [...SUPPORTED_ALGORITHMS],
      }),
    );

    if (!verification.verified) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "registration" } });
    }
    const { credential, aaguid, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      signCount: credential.counter,
      aaguid: aaguid.length === 0 ? null : aaguid,
      transports: response.response.transports ?? [],
      backupEligible: credentialDeviceType === "multiDevice",
      backupState: credentialBackedUp,
    };
  }

  /**
   * Verifies an assertion against one stored credential.
   *
   * The sign-counter check lives inside the library and throws rather than returning,
   * which is why this method does not repeat it: a counter that did not advance means
   * the assertion was replayed or the authenticator was cloned, and re-implementing the
   * comparison here would give us two places to disagree about the same rule. What we
   * own is storing the new value afterwards, because a counter that is never written
   * back is a check that always passes.
   */
  async verifyAuthentication(
    rp: RelyingParty,
    response: AuthenticationResponse,
    stored: StoredCredential,
    expectedChallenge: (challenge: string) => boolean,
  ): Promise<AssertedCredential> {
    const verification = await this.attempt("authentication", () =>
      verifyAuthenticationResponse({
        response: {
          id: response.id,
          rawId: response.rawId,
          type: response.type,
          clientExtensionResults: {},
          response: {
            clientDataJSON: response.response.clientDataJSON,
            authenticatorData: response.response.authenticatorData,
            signature: response.response.signature,
            ...(response.response.userHandle === undefined
              ? {}
              : { userHandle: response.response.userHandle }),
          },
        },
        expectedChallenge,
        expectedOrigin: [...rp.origins],
        expectedRPID: rp.rpId,
        credential: {
          id: stored.credentialId,
          publicKey: Uint8Array.from(Buffer.from(stored.publicKey, "base64url")),
          counter: stored.signCount,
          transports: [...stored.transports],
        },
        requireUserVerification: true,
      }),
    );

    if (!verification.verified) {
      throw new WebauthnAssertionInvalidError({ detail: { stage: "authentication" } });
    }
    return {
      signCount: verification.authenticationInfo.newCounter,
      backupState: verification.authenticationInfo.credentialBackedUp,
    };
  }

  /**
   * Runs a verification and flattens every way it can fail into one error.
   *
   * The library signals a bad origin, an unrecognised challenge, a failed signature and
   * a regressed counter as distinct exceptions with descriptive messages. Those messages
   * are a map of our verification logic drawn for whoever is probing us, so they go to
   * `detail`, which the exception filter keeps internal, and the caller gets one answer.
   */
  private async attempt<T>(stage: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      throw new WebauthnAssertionInvalidError({
        detail: { stage, reason: error instanceof Error ? error.message : "unknown" },
        cause: error,
      });
    }
  }
}
