import type { PasswordFlow, SignUpWithPasswordInput } from "./flows/password-flow.js";
import type { AuthResult } from "./mfa/auth-result.js";

/**
 * Registration, which is one method because only one way in needs a separate one.
 *
 * A password is the only credential a user has to choose before they have an account. Every
 * other way in creates the account as it signs in: an OTP to an unknown address, a first
 * social profile, a passkey enrolled during onboarding. Aliasing those here would suggest a
 * customer has to pick the right one, and picking wrong would mean a "no such account" error
 * on a screen whose whole job is not to have one.
 */
export class SignUp {
  constructor(private readonly password: PasswordFlow) {}

  withPassword(input: SignUpWithPasswordInput): Promise<AuthResult> {
    return this.password.signUp(input);
  }
}
