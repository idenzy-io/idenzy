import {
  FrameworkTemplate,
  type ScaffoldContext,
  type ScaffoldFile,
} from "../framework-template.js";

/**
 * SvelteKit, which is the one scaffold with a server file in it.
 *
 * The handle verifies the session cookie before a route runs and puts the answer on
 * `locals.idenzy`; the root layout hands it to the browser as a seed. Two things in the layout
 * are load-bearing and neither is obvious: `restore: browser`, because a layout also renders
 * on the server and restoring there rotates a cookie the server does not hold, and passing the
 * seed on even when it is null, because null is a server saying it looked and could not tell.
 */
export class SvelteKitTemplate extends FrameworkTemplate {
  readonly id = "sveltekit";
  readonly title = "SvelteKit";
  readonly packages = ["@idenzy/svelte", "@idenzy/js"];
  readonly markers = ["@sveltejs/kit"];
  readonly envFile = ".env";
  readonly envPrefix = "PUBLIC_";

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
      { path: "src/lib/idenzy.ts", contents: CLIENT },
      { path: "src/lib/auth-errors.ts", contents: ERRORS },
      { path: "src/hooks.server.ts", contents: HOOKS },
      { path: "src/routes/+layout.server.ts", contents: LAYOUT_LOAD },
      { path: "src/routes/+layout.svelte", contents: LAYOUT },
      { path: "src/routes/sign-in/+page.svelte", contents: SIGN_IN },
      { path: "src/routes/sign-up/+page.svelte", contents: SIGN_UP },
      { path: "src/routes/auth/callback/+page.svelte", contents: CALLBACK },
    ];
  }

  protected steps(): readonly string[] {
    return [
      'Declare the handle\'s answer in src/app.d.ts: import type { IdenzyServerSession } from "@idenzy/svelte/server", then add idenzy: IdenzyServerSession to App.Locals.',
      "If you already had src/hooks.server.ts or a root layout, this kept yours. Merge the scaffolded version by hand: the handle has to run, and the layout has to call setIdenzy.",
      "Register http://localhost:5173/auth/callback as a redirect URI, and http://localhost:5173 as a browser origin, for this project.",
      "Everything under src/routes is yours now. Restyle it, rename it, delete what you do not use.",
    ];
  }
}

const CLIENT = `import { PUBLIC_IDENZY_API_URL, PUBLIC_IDENZY_PUBLISHABLE_KEY } from "$env/static/public";
import { Idenzy } from "@idenzy/js";

/**
 * A client per load, never a module singleton.
 *
 * A module-level client on a server is shared between requests, and a session shared between
 * requests is a session shared between people. In the browser this is called once, from the
 * root layout, which is the one client the whole tab uses.
 */
export function createIdenzyClient(): Idenzy {
  return new Idenzy({
    publishableKey: PUBLIC_IDENZY_PUBLISHABLE_KEY,
    apiUrl: PUBLIC_IDENZY_API_URL,
  });
}
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

const HOOKS = `import { IDENZY_PROJECT_ID } from "$env/static/private";
import { PUBLIC_IDENZY_API_URL } from "$env/static/public";
import { createIdenzyHandle } from "@idenzy/svelte/server";

/**
 * Verifies the session cookie against a cached key set, with no network call on the request
 * path, and puts the answer on event.locals.idenzy.
 *
 * Built once, at module scope: the key set is cached inside the handle, and one per request
 * would fetch the key set per request. It never throws, so a key-set outage renders pages
 * that say "not sure yet" rather than 500s.
 */
export const handle = createIdenzyHandle({
  projectId: IDENZY_PROJECT_ID,
  issuerUrl: PUBLIC_IDENZY_API_URL,
});
`;

const LAYOUT_LOAD = `import type { LayoutServerLoad } from "./$types";

/**
 * Hands the browser what the server already worked out, null included.
 *
 * Null is not signed out: it is a server reporting that it looked and could not place this
 * visitor, which is the ordinary case for an expired access token over a live refresh cookie.
 * Dropping it would put your signed-out screen in the HTML of every page.
 */
export const load: LayoutServerLoad = ({ locals }) => ({ session: locals.idenzy.session });
`;

const LAYOUT = `<script lang="ts">
  import { browser } from "$app/environment";
  import { setIdenzy } from "@idenzy/svelte";
  import { createIdenzyClient } from "$lib/idenzy";

  const { data, children } = $props();

  // Both arguments are load-bearing. restore: browser keeps this layout from rotating a
  // refresh cookie during the server render, which is a request to the auth API per page,
  // answered signed-out, for nothing. initial is what makes that safe, and it goes in even
  // when it is null, because null is a server saying it looked and could not tell.
  setIdenzy({ client: createIdenzyClient(), restore: browser, initial: data.session });
</script>

{@render children()}
`;

const SIGN_IN = `<script lang="ts">
  import type { AuthResult, MfaChallenge } from "@idenzy/js/mfa/auth-result";
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Your sign-in page: your markup, your design system, our protocol.
   *
   * A one-time code needs no password, no redirect and no deep link, and it signs up an
   * address that has no account yet, so the same form covers both.
   *
   * Either can end at a second factor rather than a session, which is what \`finish\` is
   * for. A page that navigated anyway would land a half-signed-in visitor on your home page.
   */
  const { client } = getIdenzy();

  let email = $state("");
  let code = $state("");
  let password = $state("");
  let codeSent = $state(false);
  let challenge = $state<MfaChallenge | null>(null);
  let factorCode = $state("");
  let error = $state<string | null>(null);

  async function finish(result: AuthResult): Promise<void> {
    if (result.status === "mfa_required") {
      challenge = result.challenge;
      return;
    }
    await goto("/");
  }

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = $derived(challenge?.factors.includes("totp") ? "totp" : "recovery");

  async function submitSecondFactor(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    const pending = challenge;
    if (pending === null) return;
    try {
      await pending.submit({ factor: codeFactor, code: factorCode });
      await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  /** Runs the WebAuthn ceremony for you. A cancelled prompt is the browser's own error. */
  async function submitPasskey(): Promise<void> {
    error = null;
    const pending = challenge;
    if (pending === null) return;
    try {
      await pending.submitPasskey();
      await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function sendCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await client.signIn.withEmailOtp({ email });
      codeSent = true;
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function verifyCode(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await finish(await client.signIn.verifyOtp({ code }));
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function signInWithPassword(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      await finish(await client.signIn.withPassword({ email, password }));
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function continueWithGoogle(): Promise<void> {
    // This URI has to be registered for the project. It is checked at the start of the flow
    // and again at the callback, and an unregistered one is refused rather than followed.
    await client.signIn.withOAuth({
      provider: "google",
      redirectUri: window.location.origin + "/auth/callback",
    });
  }
</script>

<main>
  <h1>Sign in</h1>
  {#if error}<p role="alert">{error}</p>{/if}

  {#if challenge}
    <section>
      <h2>One more step</h2>
      {#if challenge.factors.includes("passkey")}
        <button type="button" onclick={submitPasskey}>Use your passkey</button>
      {/if}
      <form onsubmit={submitSecondFactor}>
        <label for="factorCode">
          {codeFactor === "recovery"
            ? "A recovery code"
            : "The code from your authenticator app"}
        </label>
        <input id="factorCode" bind:value={factorCode} autocomplete="one-time-code" />
        <button type="submit">Continue</button>
      </form>
    </section>
  {/if}

  {#if codeSent}
    <form onsubmit={verifyCode}>
      <label for="code">The code we emailed you</label>
      <input id="code" bind:value={code} inputmode="numeric" autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>
  {:else}
    <form onsubmit={sendCode}>
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} autocomplete="email" />
      <button type="submit">Email me a code</button>
    </form>
  {/if}

  <form onsubmit={signInWithPassword}>
    <h2>Or use a password</h2>
    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>

  <button type="button" onclick={continueWithGoogle}>Continue with Google</button>
</main>
`;

const SIGN_UP = `<script lang="ts">
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Registration with a password, which is the only way in that needs its own page. Every
   * other route creates the account as it signs somebody in.
   */
  const { client } = getIdenzy();

  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let error = $state<string | null>(null);

  async function signUp(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    try {
      const result = await client.signUp.withPassword({ email, password, displayName });
      // A brand new account has no second factor, so this is a session every time today.
      if (result.status === "authenticated") await goto("/");
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }
</script>

<main>
  <h1>Create an account</h1>
  {#if error}<p role="alert">{error}</p>{/if}

  <form onsubmit={signUp}>
    <label for="displayName">Name</label>
    <input id="displayName" bind:value={displayName} autocomplete="name" />

    <label for="email">Email</label>
    <input id="email" type="email" bind:value={email} autocomplete="email" />

    <label for="password">Password</label>
    <input id="password" type="password" bind:value={password} autocomplete="new-password" />

    <button type="submit">Create account</button>
  </form>
</main>
`;

const CALLBACK = `<script lang="ts">
  import type { MfaChallenge } from "@idenzy/js/mfa/auth-result";
  import { getIdenzy } from "@idenzy/svelte";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { describeAuthError } from "$lib/auth-errors";

  /**
   * Where Google, Apple, GitHub and Microsoft send the browser back.
   *
   * In onMount, and that is not an optimisation: the code in the URL is exchanged with a
   * verifier held in this browser's own session storage, so a server render has nothing to
   * finish the flow with. Null means there was no code in the URL at all.
   *
   * A provider's sign-in can still owe a second factor, and it is asked for here: the
   * challenge lives in this page's memory, so a page that navigated away first would lose it.
   */
  const { client } = getIdenzy();
  let error = $state<string | null>(null);
  let challenge = $state<MfaChallenge | null>(null);
  let factorCode = $state("");

  /** The offered factor that takes a typed code. A passkey has its own button below. */
  const codeFactor = $derived(challenge?.factors.includes("totp") ? "totp" : "recovery");

  onMount(async () => {
    try {
      const result = await client.oauth.completeFromRedirect();
      if (result?.status === "mfa_required") {
        challenge = result.challenge;
        return;
      }
      await goto(result === null ? "/sign-in" : "/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  });

  async function submitSecondFactor(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = null;
    if (challenge === null) return;
    try {
      await challenge.submit({ factor: codeFactor, code: factorCode });
      await goto("/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }

  async function submitPasskey(): Promise<void> {
    error = null;
    if (challenge === null) return;
    try {
      await challenge.submitPasskey();
      await goto("/", { replaceState: true });
    } catch (failure) {
      error = describeAuthError(failure);
    }
  }
</script>

<main>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if challenge}
    <h1>One more step</h1>
    {#if challenge.factors.includes("passkey")}
      <button type="button" onclick={submitPasskey}>Use your passkey</button>
    {/if}
    <form onsubmit={submitSecondFactor}>
      <label for="factorCode">
        {codeFactor === "recovery" ? "A recovery code" : "The code from your authenticator app"}
      </label>
      <input id="factorCode" bind:value={factorCode} autocomplete="one-time-code" />
      <button type="submit">Continue</button>
    </form>
  {:else if !error}
    <p>Signing you in...</p>
  {/if}
</main>
`;
