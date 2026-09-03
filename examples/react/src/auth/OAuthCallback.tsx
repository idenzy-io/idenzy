import { useIdenzy } from "@idenzy/react";
import { type ReactNode, useEffect, useState } from "react";
import { describeAuthError } from "./auth-errors";

/**
 * Where Google, Apple, GitHub and Microsoft send the browser back.
 *
 * The code in the URL is single use and the verifier that goes with it never left this
 * browser, so only the tab that started the flow can finish it. Null means there was no code
 * in the URL at all, which is somebody opening this route directly.
 */
export function OAuthCallback(): ReactNode {
  const idenzy = useIdenzy();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    idenzy.oauth
      .completeFromRedirect()
      .then((session) => {
        if (cancelled) return;
        window.location.replace(session === null ? "/sign-in" : "/");
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(describeAuthError(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [idenzy]);

  return <main>{error === null ? <p>Signing you in...</p> : <p role="alert">{error}</p>}</main>;
}
