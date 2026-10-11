"use client";

import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
import { useIdenzy } from "@idenzy/next";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { describeAuthError } from "../../../lib/auth-errors";

/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so this exchange can only be completed by the tab that started the flow. Null
 * means there was no code in the URL at all, which is somebody opening this page directly.
 *
 * A provider's sign-in can still owe a second factor, and it is asked for here: the challenge
 * lives in this page's memory, so a page that navigated away first would lose it.
 */
export default function OAuthCallbackPage() {
  const idenzy = useIdenzy();
  const router = useRouter();
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
        router.replace(result === null ? "/sign-in" : "/");
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(describeAuthError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [idenzy, router]);

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = challenge?.factors.includes("totp") ? "totp" : "recovery";

  async function submitSecondFactor(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      router.replace("/");
    } catch (failure) {
      setError(describeAuthError(failure));
    }
  }

  async function submitPasskey(): Promise<void> {
    setError(null);
    if (challenge === null) return;
    try {
      await challenge.submitPasskey();
      router.replace("/");
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

  return (
    <main>
      {error === null ? <p>Signing you in...</p> : <p role="alert">{error}</p>}
    </main>
  );
}
