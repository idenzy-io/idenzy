import type { ChallengeStarted } from "@idenzy/protocol/schemas/auth";
import type { AnonymousFlow } from "./flows/anonymous-flow.js";
import type { MagicLinkFlow, StartMagicLinkInput } from "./flows/magic-link-flow.js";
import type { OtpFlow, SmsOtpOptions } from "./flows/otp-flow.js";
import type { PasswordFlow, SignInWithPasswordInput } from "./flows/password-flow.js";
import type { AuthResult } from "./mfa/auth-result.js";
import type { OAuthFlow, StartOAuthInput } from "./oauth/oauth-flow.js";
import type { PasskeyFlow, PasskeySignInOptions } from "./passkey/passkey-flow.js";

/**
 * Every way in, named the way a customer's form reads.
 *
 * A mapper over the flows and deliberately nothing more: no branching, no state, no order of
 * its own. Each flow keeps whatever it has to remember, so this stays the part that can be
 * reshaped for a framework SDK without moving any of the behaviour.
 *
 * `withEmailOtp` is listed first because it is what we document first. It needs no redirect,
 * no page and no deep link, and it signs in an address that has no account yet by creating
 * one, so a customer's UI has a single passwordless entry point rather than two forms that
 * differ only in which error they show.
 */
export class SignIn {
  constructor(
    private readonly password: PasswordFlow,
    private readonly otp: OtpFlow,
    private readonly magicLink: MagicLinkFlow,
    private readonly oauth: OAuthFlow,
    private readonly passkeys: PasskeyFlow,
    private readonly anonymous: AnonymousFlow,
  ) {}

  /** Sends a code. Answers the same way for an address with an account and one without. */
  withEmailOtp(input: { readonly email: string }): Promise<ChallengeStarted> {
    return this.otp.startEmail(input.email);
  }

  /**
   * Texts a code to an E.164 number, and creates the account if the number has none.
   *
   * `attestation` carries a CAPTCHA or app-attestation token for projects that require one,
   * which is the default: SMS costs real money per message, so a project sends only after a
   * human has been proved to be there (PROJECT.md 4.8).
   */
  withSmsOtp(input: { readonly phone: string } & SmsOtpOptions): Promise<ChallengeStarted> {
    const { phone, ...options } = input;
    return this.otp.startSms(phone, options);
  }

  /** Completes the code we sent, over either channel. The challenge names which. */
  verifyOtp(input: { readonly code: string; readonly challengeId?: string }): Promise<AuthResult> {
    return this.otp.verify(input);
  }

  withPassword(input: SignInWithPasswordInput): Promise<AuthResult> {
    return this.password.signIn(input);
  }

  /** Mails a link. The session is created later, by `magicLink.exchange` on the landing route. */
  withMagicLink(input: StartMagicLinkInput): Promise<ChallengeStarted> {
    return this.magicLink.start(input);
  }

  /** Leaves the page. Finish with `oauth.completeFromRedirect()` on the route it returns to. */
  withOAuth(input: StartOAuthInput): Promise<void> {
    return this.oauth.signIn(input);
  }

  withPasskey(options?: PasskeySignInOptions): Promise<AuthResult> {
    return this.passkeys.signIn(options);
  }

  /** A real session with no credential behind it, upgradeable later without losing the id. */
  anonymously(): Promise<AuthResult> {
    return this.anonymous.signIn();
  }
}
