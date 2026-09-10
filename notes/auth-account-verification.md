# Email verification

Route: `/auth/account-verification` · [Page source](../apps/client/app/pages/auth/account-verification.vue). Supplemental entry journey.

## Findings

- **P1:** Outcomes are simulated from token contents/length. The screen's success is not real account verification.
- **P1:** “Send a new link” needs the actual email-verification operation, not an ambiguous OTP placeholder, and must show a resend failure.
- **P2:** Visiting without a token currently diagnoses email-client line wrapping. That is only one possible cause; begin with “This verification link is incomplete” and offer recovery without pretending to know why.
- **P2:** Keep the existing distinct unavailable/expired/already-used states and token removal from the URL.

## Proposed mockup

```text
              Verify your email
       [Progress / outcome icon]
       One clear outcome sentence
       One clear next action

  Success:       [Continue to dashboard / Log in]
  Expired:       Email address [Send a new link]
  Incomplete:    Email address [Send a new link]
  Unavailable:   [Try again]
                 Back to log in
```

Use a centered 440px column. Put the outcome heading above a short explanation and one primary action; place Back to log in below. Reuse the same layout dimensions between loading and completion to avoid jumps. Announce the changed outcome, not a constant countdown.

If verification succeeds without an authenticated dashboard session, the primary action must log in rather than implying verification itself grants a session.

## Acceptance checks

Test no token, malformed, expired, already-used, unavailable and verified. Each state has a meaningful exit. A retry after a network error does not automatically request another email, and no token appears in copied support information.

