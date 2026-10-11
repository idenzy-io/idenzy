import {
  FrameworkTemplate,
  type ScaffoldContext,
  type ScaffoldFile,
} from "../framework-template.js";

/**
 * React on Vite: a browser-only application, so there is no seed and no server half.
 *
 * Everything here happens after the first paint, which is exactly why `useSession` has three
 * states. The tree renders `loading` until the first rotation answers, and a component that
 * treated that as signed out would show a sign-in screen to somebody already signed in, once
 * on every page load.
 */
export class ReactTemplate extends FrameworkTemplate {
  readonly id = "react";
  readonly title = "React (Vite)";
  readonly packages = ["@idenzy/react", "@idenzy/js"];
  readonly markers = ["react"];
  readonly envFile = ".env";
  readonly envPrefix = "VITE_";

  protected routes(_context: ScaffoldContext): readonly ScaffoldFile[] {
    return [
      { path: "src/idenzy.ts", contents: CLIENT },
      { path: "src/auth/auth-errors.ts", contents: ERRORS },
      { path: "src/auth/IdenzyRoot.tsx", contents: ROOT },
      { path: "src/auth/SignIn.tsx", contents: SIGN_IN },
      { path: "src/auth/SignUp.tsx", contents: SIGN_UP },
      { path: "src/auth/OAuthCallback.tsx", contents: CALLBACK },
    ];
  }

  protected steps(): readonly string[] {
    return [
      "Wrap your application in src/main.tsx: <IdenzyRoot><App /></IdenzyRoot>.",
      "Route /auth/callback to <OAuthCallback />, however your application does routing.",
      "Register http://localhost:5173/auth/callback as a redirect URI, and http://localhost:5173 as a browser origin, for this project.",
      "Everything under src/auth is yours now. Restyle it, rename it, delete what you do not use.",
    ];
  }
}

const CLIENT = `import { Idenzy } from "@idenzy/js";

/**
 * One client for the whole browser session, built once and outside any render.
 *
 * An Idenzy owns the session, the refresh token and the single-flight refresh that keeps one
 * rotation from becoming two. Two clients on a page rotate the same token, and the second
 * rotation ends every session the user holds.
 */
export const idenzy = new Idenzy({
  publishableKey: import.meta.env.VITE_IDENZY_PUBLISHABLE_KEY ?? "",
  apiUrl: import.meta.env.VITE_IDENZY_API_URL ?? "",
});
`;

const ERRORS = `import { IdenzyApiError } from "@idenzy/js/errors";

/**
 * Every message your users read, in one file you own.
 *
 * Idenzy ships no UI and therefore no copy. What it promises instead is that these codes are
 * stable: they are part of the API, and renaming one would be a breaking change. So branch on
 * the code and write the sentence yourself, in your product's voice and your user's language.
 */
export function describeAuthError(failure: unknown): string {
  if (!(failure instanceof IdenzyApiError)) {
    return "We could not reach the server. Check your connection and try again.";
  }
  switch (failure.code) {
    case "invalid_credentials":
      return "That email and password do not match.";
    case "challenge_invalid":
      return "That code is not right. Check it and try again.";
    case "challenge_expired":
      return "That code has expired. Send yourself a new one.";
    case "challenge_attempts_exhausted":
      return "Too many attempts on that code. Send a new one.";
    case "rate_limited":
      return "Too many attempts. Wait a moment and try again.";
    case "password_breached":
      return "That password has appeared in a public breach. Please choose another.";
    case "password_too_weak":
      return "Please choose a longer password.";
    case "email_not_verified":
      return "Confirm your email address before signing in.";
    default:
      return "Something went wrong. Please try again.";
  }
}
`;

const ROOT = `import { IdenzyProvider } from "@idenzy/react";
import type { ReactNode } from "react";
import { idenzy } from "../idenzy";

/**
 * Put this around your application, once, in src/main.tsx.
 *
 * The client is a prop rather than something this component builds, and that is not a style
 * choice: a render that built one would put a second client on the page, and two clients
 * rotating the same refresh token end every session the user holds.
 */
export function IdenzyRoot({ children }: { readonly children: ReactNode }): ReactNode {
  return <IdenzyProvider client={idenzy}>{children}</IdenzyProvider>;
}
`;

const SIGN_IN = `import type { AuthResult, MfaChallenge } from "@idenzy/js/mfa/auth-result";
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
 *
 * Every way in can end at a second factor rather than a session, which is what \`finish\`
 * below is for. A page that ignored that would look like nothing happened.
 */
export function SignIn(): ReactNode {
  const idenzy = useIdenzy();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [factorCode, setFactorCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** A session, or the factor still owed. The second is not a failure and not a session. */
  function finish(result: AuthResult): void {
    if (result.status === "mfa_required") setChallenge(result.challenge);
  }

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = challenge?.factors.includes("totp") ? "totp" : "recovery";

  async function submitSecondFactor(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      setChallenge(null);
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  /** Runs the WebAuthn ceremony for you. A cancelled prompt is the browser's own error. */
  async function submitPasskey(): Promise<void> {
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submitPasskey();
      setChallenge(null);
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

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
      finish(await idenzy.signIn.verifyOtp({ code }));
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function signInWithPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      finish(await idenzy.signIn.withPassword({ email, password }));
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

      {challenge === null ? null : (
        <section>
          <h2>One more step</h2>
          {challenge.factors.includes("passkey") ? (
            <button type="button" onClick={submitPasskey}>
              Use your passkey
            </button>
          ) : null}
          <form onSubmit={submitSecondFactor}>
            <label htmlFor="factorCode">
              {codeFactor === "recovery"
                ? "A recovery code"
                : "The code from your authenticator app"}
            </label>
            <input
              id="factorCode"
              name="factorCode"
              inputMode={codeFactor === "recovery" ? "text" : "numeric"}
              autoComplete="one-time-code"
              value={factorCode}
              onChange={(event) => setFactorCode(event.target.value)}
            />
            <button type="submit">Continue</button>
          </form>
        </section>
      )}

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
`;

const SIGN_UP = `import { useIdenzy } from "@idenzy/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { describeAuthError } from "./auth-errors";

/**
 * Registration with a password, which is the only way in that needs its own screen.
 *
 * Every other route creates the account as it signs somebody in: a code sent to an address
 * nobody has claimed, a first Google profile, a passkey enrolled during onboarding.
 */
export function SignUp(): ReactNode {
  const idenzy = useIdenzy();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signUp(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await idenzy.signUp.withPassword({ email, password, displayName });
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  return (
    <main>
      <h1>Create an account</h1>
      {error === null ? null : <p role="alert">{error}</p>}

      <form onSubmit={signUp}>
        <label htmlFor="displayName">Name</label>
        <input
          id="displayName"
          name="displayName"
          autoComplete="name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button type="submit">Create account</button>
      </form>
    </main>
  );
}
`;

const CALLBACK = `import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { useIdenzy } from "@idenzy/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { describeAuthError } from "./auth-errors";

/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so only the tab that started the flow can finish it. Null means there was no code
 * in the URL at all, which is somebody opening this route directly.
 *
 * A provider's sign-in can still owe a second factor, and it is asked for here: the challenge
 * lives in this component's memory, and the reload below would lose it.
 */
export function OAuthCallback(): ReactNode {
  const idenzy = useIdenzy();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [factorCode, setFactorCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    idenzy.oauth
      .completeFromRedirect()
      .then((result) => {
        if (cancelled) return;
        if (result?.status === "mfa_required") {
          setChallenge(result.challenge);
          return;
        }
        window.location.replace(result === null ? "/sign-in" : "/");
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(describeAuthError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [idenzy]);

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = challenge?.factors.includes("totp") ? "totp" : "recovery";

  async function submitSecondFactor(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      window.location.replace("/");
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function submitPasskey(): Promise<void> {
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submitPasskey();
      window.location.replace("/");
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  if (challenge !== null) {
    return (
      <main>
        {error === null ? null : <p role="alert">{error}</p>}
        <h1>One more step</h1>
        {challenge.factors.includes("passkey") ? (
          <button type="button" onClick={submitPasskey}>
            Use your passkey
          </button>
        ) : null}
        <form onSubmit={submitSecondFactor}>
          <label htmlFor="factorCode">
            {codeFactor === "recovery" ? "A recovery code" : "The code from your authenticator app"}
          </label>
          <input
            id="factorCode"
            value={factorCode}
            onChange={(event) => setFactorCode(event.target.value)}
            autoComplete="one-time-code"
          />
          <button type="submit">Continue</button>
        </form>
      </main>
    );
  }

  return <main>{error === null ? <p>Signing you in...</p> : <p role="alert">{error}</p>}</main>;
}
`;
