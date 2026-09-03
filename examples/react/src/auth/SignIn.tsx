import { useIdenzy } from "@idenzy/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { describeAuthError } from "./auth-errors";

/**
 * Your sign-in screen: your markup, your design system, our protocol.
 *
 * Three ways in, and the order is deliberate. A one-time code needs no password, no redirect
 * and no deep link, and it signs up an address that has no account yet, so the same form
 * covers both. Password and Google are here because most products still want them.
 *
 * Nothing navigates after a successful sign-in. The session changes, every component reading
 * it re-renders, and where the user goes next is your application's decision.
 */
export function SignIn(): ReactNode {
  const idenzy = useIdenzy();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await idenzy.signIn.withEmailOtp({ email });
      setCodeSent(true);
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function verifyCode(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await idenzy.signIn.verifyOtp({ code });
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function signInWithPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await idenzy.signIn.withPassword({ email, password });
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function continueWithGoogle(): Promise<void> {
    // This URI has to be registered for the project. It is checked at the start of the flow
    // and again at the callback, and an unregistered one is refused rather than followed.
    await idenzy.signIn.withOAuth({
      provider: "google",
      redirectUri: window.location.origin + "/auth/callback",
    });
  }

  return (
    <main>
      <h1>Sign in</h1>
      {error === null ? null : <p role="alert">{error}</p>}

      {codeSent ? (
        <form onSubmit={verifyCode}>
          <label htmlFor="code">The code we emailed you</label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit">Continue</button>
        </form>
      ) : (
        <form onSubmit={sendCode}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit">Email me a code</button>
        </form>
      )}

      <form onSubmit={signInWithPassword}>
        <h2>Or use a password</h2>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button type="submit">Sign in</button>
      </form>

      <button type="button" onClick={continueWithGoogle}>
        Continue with Google
      </button>
    </main>
  );
}
