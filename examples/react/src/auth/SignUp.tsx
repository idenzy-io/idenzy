import { useIdenzy } from "@idenzy/react";
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
