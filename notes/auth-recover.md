# Password recovery

Route: `/auth/recover` · [Page source](../apps/client/app/pages/auth/recover.vue). Supplemental entry journey.

## Findings

- **P1:** The page simulates sending; addresses containing “down” simulate failure. A local sent state is not evidence of an email.
- **P1:** This route handles request/sent states; there is no separate reset-completion page in the current route inventory. Design the receiving link and new-password journey before calling recovery complete.
- **P2:** “Expires shortly after it arrives” is vague and can misstate a lifetime measured from issue. Use the effective expiry rule and explain a newer request invalidates an older link when the server does so.
- **P2:** Preserve neutral wording about account existence while giving the requester useful next steps.

## Proposed mockup

```text
              Reset your password
  Email address
  [Send reset link]
  Back to log in

  After request:
  Check your inbox
  If an account can reset here, instructions go to:
  entered@example.com [Change email]
  [Resend link]   Available in 30 seconds
  Back to log in
```

Use one centered column, maximum 420px. Put the primary action under the email field and Back to log in beneath it. Keep resend and correction on the sent screen; announce completion without replacing the address with a vague success toast.

The reset destination should show New password, effective requirements, confirmation if required and “Set new password,” followed by a definite sign-in action. Handle invalid, expired, used and unavailable links separately.

## Acceptance checks

Request, correct an address, resend after cooldown and finish resetting through the email destination. Service failure preserves input. Responses do not disclose whether a particular account exists.

