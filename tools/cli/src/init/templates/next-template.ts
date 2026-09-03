import {
  FrameworkTemplate,
  type ScaffoldContext,
  type ScaffoldFile,
} from "../framework-template.js";

/**
 * Next, App Router: the target the fifteen-minute exit criterion is measured against.
 *
 * Everything scaffolded is a client component except the two `lib` modules, because holding a
 * session, subscribing to it and using context are all things a server component cannot do.
 * The seed is the exception and the point: `IdenzyServer` verifies the session cookie during
 * the render with no network call, and the answer goes into the tree as `initialSession`.
 */
export class NextTemplate extends FrameworkTemplate {
  readonly id = "next";
  readonly title = "Next.js (App Router)";
  readonly packages = ["@idenzy/next", "@idenzy/js"];
  readonly markers = ["next"];
  readonly envFile = ".env.local";
  readonly envPrefix = "NEXT_PUBLIC_";

  protected override envEntries(context: ScaffoldContext) {
    return [
      ...super.envEntries(context),
      {
        key: "IDENZY_PROJECT_ID",
        value: "",
        comment: "Server-side only. The audience every token for this project carries.",
      },
    ];
  }

  protected routes(_context: ScaffoldContext): readonly ScaffoldFile[] {
    return [
      { path: "lib/idenzy.ts", contents: CLIENT },
      { path: "lib/idenzy-server.ts", contents: SERVER },
      { path: "lib/auth-errors.ts", contents: ERRORS },
      { path: "app/providers.tsx", contents: PROVIDERS },
      { path: "app/sign-in/page.tsx", contents: SIGN_IN },
      { path: "app/sign-up/page.tsx", contents: SIGN_UP },
      { path: "app/auth/callback/page.tsx", contents: CALLBACK },
    ];
  }

  protected steps(): readonly string[] {
    return [
      "Wrap your tree in app/layout.tsx: const session = await idenzyServer.session(), then <Providers initialSession={session}>{children}</Providers>. Pass the seed through even when it is null.",
      "Register http://localhost:3000/auth/callback as a redirect URI, and http://localhost:3000 as a browser origin, for this project.",
      "Fill IDENZY_PROJECT_ID in .env.local. The publishable key belongs in the browser; the project id and the secret key do not.",
      "Everything under app/ is yours now. Restyle it, rename the routes, delete what you do not use.",
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
  // Dot access, not process.env["..."]: Next inlines NEXT_PUBLIC_ variables by matching the
  // literal text, and a bracket lookup is left as an undefined read in the browser bundle.
  publishableKey: process.env.NEXT_PUBLIC_IDENZY_PUBLISHABLE_KEY ?? "",
  apiUrl: process.env.NEXT_PUBLIC_IDENZY_API_URL ?? "",
});
`;

const SERVER = `import { IdenzyServer } from "@idenzy/next/server";

/**
 * The server half: it verifies the session cookie against a cached key set, with no network
 * call on the request path.
 *
 * Built once, at module scope. One of these per request would fetch the key set per request.
 */
export const idenzyServer = new IdenzyServer({
  projectId: process.env.IDENZY_PROJECT_ID ?? "",
  issuerUrl: process.env.NEXT_PUBLIC_IDENZY_API_URL ?? "",
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
    case "account_locked":
      return "This account is locked. Try again later.";
    default:
      return "Something went wrong. Please try again.";
  }
}
`;

const PROVIDERS = `"use client";

import { IdenzyProvider, type SessionSnapshot } from "@idenzy/next";
import type { ReactNode } from "react";
import { idenzy } from "../lib/idenzy";

/**
 * Put this around your tree in app/layout.tsx:
 *
 *   const session = await idenzyServer.session();
 *   return (
 *     <html lang="en">
 *       <body>
 *         <Providers initialSession={session}>{children}</Providers>
 *       </body>
 *     </html>
 *   );
 *
 * Hand the seed over even when it is null, and especially then. Null is the server reporting
 * that it looked and could not place the visitor, which holds the tree in "loading" until the
 * browser settles it. Leaving the prop out says nobody looked, and renders your signed-out
 * screen at somebody whose refresh cookie is about to sign them straight back in.
 */
export function Providers({
  children,
  initialSession,
}: {
  readonly children: ReactNode;
  readonly initialSession: SessionSnapshot | null;
}): ReactNode {
  return (
    <IdenzyProvider client={idenzy} initialSession={initialSession}>
      {children}
    </IdenzyProvider>
  );
}
`;

const SIGN_IN = `"use client";

import type { AuthResult, MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { useIdenzy } from "@idenzy/next";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { describeAuthError } from "../../lib/auth-errors";

/**
 * Your sign-in page: your markup, your design system, our protocol.
 *
 * Three ways in, and the order is deliberate. A one-time code needs no password, no redirect
 * and no deep link, and it signs up an address that has no account yet, so the same form
 * covers both. Password and Google are here because most products still want them.
 *
 * Every one of them can end at a second factor rather than a session, which is why they all
 * go through \`finish\` below. A page that ignored that would look like nothing happened.
 */
export default function SignInPage() {
  const idenzy = useIdenzy();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [factorCode, setFactorCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  /** A session, or the factor still owed. Never navigate on the second one. */
  function finish(result: AuthResult): void {
    if (result.status === "mfa_required") {
      setChallenge(result.challenge);
      return;
    }
    router.push("/");
  }

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = challenge?.factors.includes("totp") ? "totp" : "recovery";

  async function submitSecondFactor(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      router.push("/");
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
      router.push("/");
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

const SIGN_UP = `"use client";

import { useIdenzy } from "@idenzy/next";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { describeAuthError } from "../../lib/auth-errors";

/**
 * Registration with a password, which is the only way in that needs its own page.
 *
 * Every other route creates the account as it signs somebody in: a code sent to an address
 * nobody has claimed, a first Google profile, a passkey enrolled during onboarding. So the
 * sign-in page is the whole story for those, and this one exists for the credential a user
 * has to choose before they have an account.
 */
export default function SignUpPage() {
  const idenzy = useIdenzy();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function signUp(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const result = await idenzy.signUp.withPassword({ email, password, displayName });
      // A brand new account has no second factor, so this is a session every time today.
      // Reading the status anyway is what keeps the page right if that ever changes.
      if (result.status === "authenticated") router.push("/");
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

const CALLBACK = `"use client";

import { useIdenzy } from "@idenzy/next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { describeAuthError } from "../../../lib/auth-errors";

/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so this exchange can only be completed by the tab that started the flow. Null
 * means there was no code in the URL at all, which is somebody opening this page directly.
 */
export default function OAuthCallbackPage() {
  const idenzy = useIdenzy();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    idenzy.oauth
      .completeFromRedirect()
      .then((session) => {
        if (cancelled) return;
        router.replace(session === null ? "/sign-in" : "/");
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(describeAuthError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [idenzy, router]);

  return (
    <main>
      {error === null ? <p>Signing you in...</p> : <p role="alert">{error}</p>}
    </main>
  );
}
`;
