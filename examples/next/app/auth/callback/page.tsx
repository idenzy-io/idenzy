"use client";

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
