import { errorFrom } from "./errors.js";
import type { NativeBridge } from "./native-bridge.js";
import {
  type AuthResult,
  type ChallengeStarted,
  challengeFrom,
  factorFrom,
  type IdenzyStatus,
  type IdTokenNonce,
  type MfaChallenge,
  type MfaEnrolmentConfirmed,
  type MfaFactorList,
  type MfaProof,
  nonceFrom,
  type Passkey,
  passkeyFrom,
  Reader,
  type RecoveryCodes,
  recoveryCodesFrom,
  type Session,
  type SessionSummary,
  sessionFrom,
  sessionSummaryFrom,
  startedFrom,
  statusFrom,
  type TotpEnrolment,
  type User,
  userFrom,
} from "./types.js";

export interface IdenzyOptions {
  /** The project's publishable key. A secret key is refused on the device, before anything is sent. */
  readonly publishableKey: string;
  /** The auth API: a custom auth domain, or the shared host. https outside loopback. */
  readonly apiUrl: string;
  /** What the user's own device list calls this device. Left unset, the row is unnamed. */
  readonly deviceName?: string;
}

export type StatusListener = (status: IdenzyStatus) => void;

/**
 * The client a JavaScript app on the native SDKs holds, whichever framework it is written in
 * (ADR-0022). React Native, Lynx and NativeScript differ only in how they reach the native half,
 * so each of their packages is a `configure` that supplies a `NativeBridge`, and this is the rest.
 *
 * A thin layer over the Swift and Kotlin SDKs, which hold the session, keep the refresh token in
 * the Keychain or the Keystore, and apply the refresh rules. Nothing about the session is decided
 * in JavaScript: this turns calls into messages and answers into types.
 *
 * There is no UI in it. Every method takes values and returns values or throws an `IdenzyError`
 * whose `code` your screens are built from.
 */
export class Idenzy {
  private current: IdenzyStatus = { status: "loading" };
  private readonly listeners = new Set<StatusListener>();

  readonly signIn: SignIn;
  readonly signUp: SignUp;
  readonly password: PasswordApi;
  readonly nativeSignIn: NativeSignIn;
  readonly anonymous: AnonymousApi;
  readonly account: AccountApi;
  readonly sessions: SessionsApi;
  readonly mfa: MfaApi;
  readonly passkeys: PasskeysApi;

  /** For a host that brings its own bridge, such as a test. Use your framework's `configure`. */
  constructor(private readonly native: NativeBridge) {
    native.watchStatus((wire) => {
      this.current = statusFrom(Reader.of(wire, "status"));
      for (const listener of this.listeners) listener(this.current);
    });
    this.signIn = new SignIn(this);
    this.signUp = new SignUp(this);
    this.password = new PasswordApi(this);
    this.nativeSignIn = new NativeSignIn(this);
    this.anonymous = new AnonymousApi(this);
    this.account = new AccountApi(this);
    this.sessions = new SessionsApi(this);
    this.mfa = new MfaApi(this);
    this.passkeys = new PasskeysApi(this);
  }

  /**
   * Configures the native SDK for a project, over the bridge a framework's `configure` supplies.
   * One project per app: a second publishable key is refused, because every handle reaches the
   * same native client.
   */
  static async configure(options: IdenzyOptions, native: NativeBridge): Promise<Idenzy> {
    const client = new Idenzy(native);
    await client.call("configure", {
      publishableKey: options.publishableKey,
      apiUrl: options.apiUrl,
      deviceName: options.deviceName ?? null,
    });
    return client;
  }

  /** The session's status as last reported. Stays `loading` until `restore` has answered. */
  get status(): IdenzyStatus {
    return this.current;
  }

  /** Called on every change of status. Returns the unsubscribe. Shaped for `useSyncExternalStore`. */
  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Picks up the session the last launch stored. Call it once, at start-up. When the answer cannot
   * be known yet, offline or with a Keychain locked since boot, it throws and keeps the session.
   */
  async restore(): Promise<Session | null> {
    const wire = await this.call("restore");
    return wire === null || wire === undefined ? null : sessionFrom(Reader.of(wire, "session"));
  }

  /** A token for your own API calls, renewed first if close to expiry. Null when signed out. */
  async getToken(): Promise<string | null> {
    const token = await this.call("getToken");
    return typeof token === "string" ? token : null;
  }

  async currentSession(): Promise<Session | null> {
    const wire = await this.call("session");
    return wire === null || wire === undefined ? null : sessionFrom(Reader.of(wire, "session"));
  }

  /** Ends the session on the server and here. Here happens even when the request fails. */
  async signOut(scope: "current" | "all" = "current"): Promise<void> {
    await this.call("signOut", { scope });
  }

  /** Finishes OAuth from a URL the app was opened with, after the system ended it mid-flow. */
  async completeRedirect(url: string): Promise<AuthResult | null> {
    return this.optionalResult(await this.call("oauth.complete", { url }));
  }

  /** Finishes a magic link from the app link the app was opened with. Null when not ours. */
  async completeMagicLink(url: string): Promise<AuthResult | null> {
    return this.optionalResult(await this.call("magicLink.complete", { url }));
  }

  /** @internal Sends one call and unwraps the answer, turning an error value into a throw. */
  async call(method: string, args: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    const answer = await this.native.call(method, args);
    if (answer.error !== undefined) {
      throw errorFrom(answer.error.code, answer.error.message, answer.error.details ?? {});
    }
    return answer.ok;
  }

  /** @internal */
  async result(method: string, args: Readonly<Record<string, unknown>> = {}): Promise<AuthResult> {
    return this.authResult(Reader.of(await this.call(method, args), method));
  }

  /** @internal */
  async record(method: string, args: Readonly<Record<string, unknown>> = {}): Promise<Reader> {
    return Reader.of(await this.call(method, args), method);
  }

  /** @internal */
  challenge(reader: Reader): MfaChallenge {
    return challengeFrom(reader, async (challengeId: string, proof: MfaProof) =>
      sessionFrom(
        await this.record("mfa.submit", { challengeId, factor: proof.factor, code: proof.code }),
      ),
    );
  }

  private optionalResult(wire: unknown): AuthResult | null {
    return wire === null || wire === undefined ? null : this.authResult(Reader.of(wire, "result"));
  }

  private authResult(reader: Reader): AuthResult {
    if (reader.text("status") === "mfa_required") {
      return { status: "mfa_required", challenge: this.challenge(reader.record("challenge")) };
    }
    return { status: "authenticated", session: sessionFrom(reader.record("session")) };
  }
}

/** Every way in, named the way a sign-in form reads, as in `@idenzy/js`. */
export class SignIn {
  constructor(private readonly client: Idenzy) {}

  /** Sends a code. Answers the same way for an address with an account and one without. */
  async withEmailOtp(input: { readonly email: string }): Promise<ChallengeStarted> {
    return startedFrom(await this.client.record("otp.startEmail", { email: input.email }));
  }

  async withSmsOtp(input: {
    readonly phone: string;
    readonly attestation?: string;
  }): Promise<ChallengeStarted> {
    return startedFrom(
      await this.client.record("otp.startSms", {
        phone: input.phone,
        attestation: input.attestation ?? null,
      }),
    );
  }

  /** Completes the last code started here, or an explicit one carried across a restart. */
  verifyOtp(input: { readonly code: string; readonly challengeId?: string }): Promise<AuthResult> {
    return this.client.result("otp.verify", {
      code: input.code,
      challengeId: input.challengeId ?? null,
    });
  }

  withPassword(input: { readonly email: string; readonly password: string }): Promise<AuthResult> {
    return this.client.result("password.signIn", { email: input.email, password: input.password });
  }

  async withMagicLink(input: {
    readonly email: string;
    readonly redirectUri: string;
  }): Promise<ChallengeStarted> {
    return startedFrom(
      await this.client.record("magicLink.start", {
        email: input.email,
        redirectUri: input.redirectUri,
      }),
    );
  }

  /** The system browser, never a web view. A closed browser throws `IdenzySignInCancelled`. */
  withOAuth(input: {
    readonly provider: string;
    readonly redirectUri: string;
  }): Promise<AuthResult> {
    return this.client.result("oauth.signIn", {
      provider: input.provider,
      redirectUri: input.redirectUri,
    });
  }

  /** The system Sign in with Apple sheet, on iOS. On Android use `withOAuth({ provider: "apple" })`. */
  withApple(): Promise<AuthResult> {
    return this.client.result("apple.signIn");
  }

  /** Credential Manager's Sign in with Google, on Android, with the project's web client id. */
  withGoogle(input: { readonly serverClientId: string }): Promise<AuthResult> {
    return this.client.result("google.signIn", { serverClientId: input.serverClientId });
  }

  /** A real session with no credential, upgradeable later without losing the user id. */
  anonymously(): Promise<AuthResult> {
    return this.client.result("anonymous.signIn");
  }
}

export class SignUp {
  constructor(private readonly client: Idenzy) {}

  withPassword(input: {
    readonly email: string;
    readonly password: string;
    readonly displayName?: string;
  }): Promise<AuthResult> {
    return this.client.result("password.signUp", {
      email: input.email,
      password: input.password,
      displayName: input.displayName ?? null,
    });
  }
}

export class PasswordApi {
  constructor(private readonly client: Idenzy) {}

  async requestReset(input: { readonly email: string }): Promise<void> {
    await this.client.call("password.requestReset", { email: input.email });
  }

  /** Does not sign in: the new password is what proves ownership at the next sign-in. */
  async confirmReset(input: { readonly token: string; readonly password: string }): Promise<void> {
    await this.client.call("password.confirmReset", {
      token: input.token,
      password: input.password,
    });
  }
}

/**
 * A platform sign-in this SDK does not drive itself, such as Google's own SDK on iOS: hand
 * `digest` to it as the nonce, then `exchange` the ID token it returns with the `nonce`.
 */
export class NativeSignIn {
  constructor(private readonly client: Idenzy) {}

  async prepare(): Promise<IdTokenNonce> {
    return nonceFrom(await this.client.record("idToken.prepare"));
  }

  exchange(input: {
    readonly provider: "apple" | "google";
    readonly idToken: string;
    readonly nonce: string;
    readonly displayName?: string;
  }): Promise<AuthResult> {
    return this.client.result("idToken.exchange", {
      provider: input.provider,
      idToken: input.idToken,
      nonce: input.nonce,
      displayName: input.displayName ?? null,
    });
  }
}

export class AnonymousApi {
  constructor(private readonly client: Idenzy) {}

  upgrade(input: { readonly email: string; readonly password: string }): Promise<AuthResult> {
    return this.client.result("anonymous.upgrade", {
      email: input.email,
      password: input.password,
    });
  }
}

export class AccountApi {
  constructor(private readonly client: Idenzy) {}

  async me(): Promise<User> {
    return userFrom(await this.client.record("account.me"));
  }

  async requestEmailVerification(): Promise<void> {
    await this.client.call("account.requestEmailVerification");
  }

  async confirmEmailVerification(token: string): Promise<void> {
    await this.client.call("account.confirmEmailVerification", { token });
  }

  async requestEmailChange(newEmail: string): Promise<void> {
    await this.client.call("account.requestEmailChange", { newEmail });
  }

  /** True once both addresses have confirmed. */
  async confirmEmailChange(token: string): Promise<boolean> {
    return (await this.client.record("account.confirmEmailChange", { token })).flag("applied");
  }
}

export class SessionsApi {
  constructor(private readonly client: Idenzy) {}

  /** Most recently active first, with this device's own marked `current`. */
  async list(): Promise<readonly SessionSummary[]> {
    const rows = await this.client.call("sessions.list");
    if (!Array.isArray(rows)) return [];
    return rows.map((row: unknown) => sessionSummaryFrom(Reader.of(row, "session")));
  }

  async revoke(id: string): Promise<void> {
    await this.client.call("sessions.revoke", { id });
  }
}

/**
 * Passkeys through the platform's own sheet: AuthenticationServices on iOS, Credential Manager on
 * Android. The relying party's domain must list the app, under `webcredentials` in its
 * `apple-app-site-association` and by package and signing certificate in `assetlinks.json`.
 */
export class PasskeysApi {
  constructor(private readonly client: Idenzy) {}

  /** Adds a passkey to the signed-in account. `name` is what the user's own list calls it. */
  async add(input: { readonly name?: string } = {}): Promise<Passkey> {
    return passkeyFrom(await this.client.record("passkey.add", { name: input.name ?? null }));
  }

  /** Signs in with whichever of the user's passkeys the sheet offers. Nothing names the account. */
  signIn(): Promise<AuthResult> {
    return this.client.result("passkey.signIn");
  }

  async list(): Promise<readonly Passkey[]> {
    const rows = await this.client.call("passkey.list");
    if (!Array.isArray(rows)) return [];
    return rows.map((row: unknown) => passkeyFrom(Reader.of(row, "passkey")));
  }

  async remove(id: string): Promise<void> {
    await this.client.call("passkey.remove", { id });
  }
}

export class MfaApi {
  constructor(private readonly client: Idenzy) {}

  async factors(): Promise<MfaFactorList> {
    const reader = await this.client.record("mfa.factors");
    return {
      factors: reader.list("factors").map((factor) => factorFrom(Reader.of(factor, "factor"))),
      recoveryCodesRemaining: reader.count("recoveryCodesRemaining"),
    };
  }

  async enrollTotp(input: { readonly label?: string } = {}): Promise<TotpEnrolment> {
    const reader = await this.client.record("mfa.enrollTotp", { label: input.label ?? null });
    return {
      factorId: reader.text("factorId"),
      secret: reader.text("secret"),
      uri: reader.text("uri"),
    };
  }

  async confirmTotp(input: {
    readonly factorId: string;
    readonly code: string;
  }): Promise<MfaEnrolmentConfirmed> {
    const reader = await this.client.record("mfa.confirmTotp", {
      factorId: input.factorId,
      code: input.code,
    });
    const codes = reader.optionalRecord("recoveryCodes");
    return {
      factor: factorFrom(reader.record("factor")),
      recoveryCodes: codes === null ? null : recoveryCodesFrom(codes),
    };
  }

  async regenerateRecoveryCodes(): Promise<RecoveryCodes> {
    return recoveryCodesFrom(await this.client.record("mfa.regenerateRecoveryCodes"));
  }

  async removeFactor(factorId: string): Promise<void> {
    await this.client.call("mfa.removeFactor", { factorId });
  }

  /** A challenge to raise this session's assurance, or null when none is owed. */
  async startStepUp(): Promise<MfaChallenge | null> {
    const wire = await this.client.call("mfa.startStepUp");
    return wire === null || wire === undefined
      ? null
      : this.client.challenge(Reader.of(wire, "challenge"));
  }
}
