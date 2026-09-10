# Dashboard second factor

Route: `/auth/two-factor` · [Page source](../apps/client/app/pages/auth/two-factor.vue). Supplemental entry journey.

## Findings

- **P1:** “Use a recovery code instead” links to `/auth/recovery-code`, which has no page in the current route inventory. A fallback for a lost authenticator must not lead to a missing route.
- **P1:** At a 390px viewport, document width measured 451px. The six-code input and its fixed layout need to fit without horizontal page scrolling.
- **P1:** Challenge handling is simulated and not driven by a real sign-in result. Missing/expired challenge state must lead safely back to login; success must establish the authenticated session.
- **P2:** Keep separate invalid, unavailable, expired and exhausted states. Do not announce a countdown every second or blame the user for a service failure.

## Proposed mockup

```text
            Verify your sign-in
  Open your authenticator app and enter its code.
             [ Six-digit code ]
             Inline error/status
                  [Verify]
       Try another verification method
                 Back to log in
```

Use a centered 400px maximum-width column with responsive side padding. Prefer one accessible OTP field styled as six cells, or ensure the current cells shrink at 320px and handle paste. Keep Verify full width below the error region. If six digits auto-submit, prevent duplicate submission from Enter or the button.

“Try another verification method” opens an inline list of only the factors offered by the challenge, with Passkey, Authenticator and Recovery code as available. The recovery entry must have a real implementation. Ended challenges replace entry with one Log in again action.

## Acceptance checks

Enter/paste a code at 320px and 390px, with keyboard and password-manager assistance. No page overflow. Use recovery from an actual challenge. Invalid code preserves a useful retry path; unavailable service is not counted locally as proof of a wrong code.

