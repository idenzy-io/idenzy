# Dashboard registration

Route: `/auth/register` · [Page source](../apps/client/app/pages/auth/register.vue). Supplemental entry journey.

## Findings

- **P1:** The strength meter says “Must contain at least” above optional mixed-case/symbol suggestions, contradicting the password policy. Separate actual requirements from guidance.
- **P1:** Account-creation/provider/link handlers are placeholders. Model verification required, account created, MFA challenge and recoverable failure explicitly.
- **P2:** Password confirmation increases effort. Keep it only if observed error prevention justifies it; a reveal control and password-manager support can reduce typing without inventing composition rules.
- **P2:** After registration, the next screen should explain verification and project setup, not present invented operating traffic.

## Proposed mockup

```text
           Create your Idenzy account
  Email address      | [Provider options]
  Password    [Show] | Use an email code / link
  Required: ...
  Strength suggestion, clearly optional
  Confirm password (if retained)
  [Create account]
          Already registered? Log in
```

Match Login's widths and typography. Keep Create account below the required fields and Log in below the form. Put email errors under email, breached-password errors under password, and general service errors beside submission. The action row stays after the final field on mobile; do not let guidance consume most of the first screen.

After a successful result, show the next task explicitly: verify email → create/select project → integrate SDK. Display applicable terms/privacy links using approved product copy without inventing contractual text.

## Acceptance checks

A valid long passphrase without mixed case or symbols is not described as invalid. Autofill and paste work. Verification-required does not look like completed setup. The alternative passwordless label matches the implemented flow.

