import {
  type Passkey,
  type PasskeyList,
  passkeyAuthenticationOptionsSchema,
  passkeyListSchema,
  passkeyRegistrationOptionsSchema,
  passkeySchema,
} from "@idenzy/protocol/schemas/webauthn";
import { IdenzyConfigurationError } from "../errors.js";
import { SessionFlow } from "../flows/session-flow.js";
import type { ApiClient } from "../http/api-client.js";
import type { Session } from "../session/session.js";
import type { SessionManager } from "../session/session-manager.js";
import {
  fromAssertion,
  fromAttestation,
  toCreationOptions,
  toRequestOptions,
} from "./ceremony-options.js";

export interface PasskeySignInOptions {
  /**
   * Offer the passkey in the browser's own autofill instead of on a button press. Needs a
   * field marked `autocomplete="webauthn"`, and the promise stays pending until the user
   * picks one, so pass a signal if anything else on the page can end the attempt.
   */
  readonly conditional?: boolean;
  readonly signal?: AbortSignal;
}

/**
 * The two WebAuthn ceremonies, and everything the owner can do with the result
 * (PROJECT.md 4.7).
 *
 * Signing in sends no identifier. There is nothing to send: the options endpoint answers
 * identically for everybody, which is what stops the flow we promote as the default from
 * being an account-enumeration oracle, and discoverable credentials are what let the browser
 * name the account instead.
 *
 * A cancelled prompt arrives as the browser's own `DOMException`, and it is deliberately not
 * translated. `NotAllowedError` for a dismissed or timed-out prompt and `InvalidStateError`
 * for an authenticator that already holds a credential for this account are a web platform
 * contract older than ours, and a mapping into our codes would hide the `name` a developer
 * will search for.
 */
export class PasskeyFlow extends SessionFlow {
  // biome-ignore lint/complexity/noUselessConstructor: it widens the abstract base's protected constructor to public, which is what lets the client build one.
  constructor(api: ApiClient, sessions: SessionManager) {
    super(api, sessions);
  }

  /** False on a browser without WebAuthn. Hide the button rather than letting it fail. */
  isSupported(): boolean {
    return (
      globalThis.PublicKeyCredential !== undefined &&
      globalThis.navigator?.credentials !== undefined
    );
  }

  /** Signs in with whichever passkey the user picks. Takes no address and names none. */
  async signIn(options: PasskeySignInOptions = {}): Promise<Session> {
    const started = await this.api.send(passkeyAuthenticationOptionsSchema, {
      method: "POST",
      path: "v1/auth/passkeys/authentication/options",
    });
    const credential = await this.ask({
      publicKey: toRequestOptions(started.publicKey),
      ...(options.conditional === true ? { mediation: "conditional" as const } : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    return this.establish({
      method: "POST",
      path: "v1/auth/passkeys/authentication",
      body: { challengeId: started.challengeId, response: fromAssertion(credential) },
    });
  }

  /**
   * Enrols a passkey on the account already signed in here.
   *
   * The token is asked for twice on purpose. A ceremony sits waiting on a fingerprint reader
   * for as long as the user takes, which is easily longer than an access token lives.
   */
  async register(input: { readonly name?: string } = {}): Promise<Passkey> {
    const started = await this.api.send(passkeyRegistrationOptionsSchema, {
      method: "POST",
      path: "v1/auth/passkeys/registration/options",
      accessToken: await this.sessions.requireToken(),
    });
    const credential = await this.enrol({ publicKey: toCreationOptions(started.publicKey) });
    return this.api.send(passkeySchema, {
      method: "POST",
      path: "v1/auth/passkeys/registration",
      body: {
        challengeId: started.challengeId,
        response: fromAttestation(credential),
        ...(input.name === undefined ? {} : { name: input.name }),
      },
      accessToken: await this.sessions.requireToken(),
    });
  }

  async list(): Promise<PasskeyList> {
    return this.api.send(passkeyListSchema, {
      method: "GET",
      path: "v1/users/me/passkeys",
      accessToken: await this.sessions.requireToken(),
    });
  }

  async rename(id: string, name: string): Promise<void> {
    await this.api.sendVoid({
      method: "PATCH",
      path: `v1/users/me/passkeys/${encodeURIComponent(id)}`,
      body: { name },
      accessToken: await this.sessions.requireToken(),
    });
  }

  /**
   * Devices are lost, and a credential its owner cannot revoke is a permanent grant to
   * whoever holds the hardware.
   */
  async remove(id: string): Promise<void> {
    await this.api.sendVoid({
      method: "DELETE",
      path: `v1/users/me/passkeys/${encodeURIComponent(id)}`,
      accessToken: await this.sessions.requireToken(),
    });
  }

  private async ask(options: CredentialRequestOptions): Promise<PublicKeyCredential> {
    this.assertSupported();
    const credential = await navigator.credentials.get(options);
    return assertPublicKey(credential);
  }

  private async enrol(options: CredentialCreationOptions): Promise<PublicKeyCredential> {
    this.assertSupported();
    const credential = await navigator.credentials.create(options);
    return assertPublicKey(credential);
  }

  private assertSupported(): void {
    if (this.isSupported()) return;
    throw new IdenzyConfigurationError(
      "This browser has no WebAuthn. Check isSupported() before offering passkeys.",
    );
  }
}

/**
 * `navigator.credentials` is typed for every credential kind, so it can hand back a null or
 * something that is not a public key. Neither can happen for the options we send, and
 * checking beats an assertion that would be wrong exactly once.
 */
function assertPublicKey(credential: Credential | null): PublicKeyCredential {
  if (credential === null || !(credential instanceof PublicKeyCredential)) {
    throw new IdenzyConfigurationError("The browser returned no passkey for this ceremony.");
  }
  return credential;
}
