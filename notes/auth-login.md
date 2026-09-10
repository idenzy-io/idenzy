# Dashboard login

Route: `/auth/login` · [Page source](../apps/client/app/pages/auth/login.vue). Supplemental entry journey, outside dashboard navigation.

## Findings

- **P1:** Password, OAuth and magic-link handlers are unconnected. A working-looking button with no outcome is an interaction failure; connect the actual SDK outcome, pending and error states.
- **P1:** “Email me a magic link” points in its handler comment to an email OTP start. Decide which experience is offered and use matching language, endpoint and receiving screen.
- **P2:** The rendered login page has a recovery link but no create-account link. Make registration discoverable for a newcomer.
- **P2:** The two-column desktop form exposes five competing sign-in choices. Keep alternatives visible, but group them under a clear heading and prioritize the most commonly used path after usability testing.

## Proposed mockup

```text
              Idenzy
          Log in to Idenzy

  Email address       | Continue with Google
  Password     [Show] | Continue with Apple
  [Log in]            | Continue with Microsoft
  Forgot password?    | Continue with GitHub
                      | Use an email code / magic link

       New to Idenzy? Create account
```

Use a centered 760px maximum-width block at desktop; a single column around 400px on mobile. Place the primary Log in button directly below password, full width within its column. Put recovery beneath that button and registration below both methods. Alternative email sign-in opens its own address step rather than depending invisibly on the password form's email field.

Show a concise generic credential error above the submit row, preserving the email. Disable repeat submission while pending. MFA-required goes to the challenge flow; only an authenticated result enters the dashboard.

## Acceptance checks

Submit a wrong password, use an alternate provider, request password recovery and find registration. Every control responds. Password-manager autofill, paste and keyboard submission work. The sign-in result preserves the intended return route.

