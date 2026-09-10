# Authenticator apps

Route: `/mfa/totp` · [Page source](../apps/client/app/pages/mfa/totp.vue)

## User task

I need to offer authenticator-based MFA and understand whether it is optional or required for my application's users.

## Keep

Keep the issuer preview, two-call enrollment explanation and recovery-code linkage.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Authenticator apps                      [Available / Disabled]
[Enrollment optional — not required for every user]
[Make authenticator enrollment available: switch]
[Name shown in authenticator apps]      [Live sample account entry]
  [Use project name] / [Custom name....]
  [Cancel] [Save name]
[Who is challenged?  Scenario | Result]
[Enrollment & recovery checklist]
[Coverage summary]                       [Technical details v]
```

Lead with availability and enforcement scope. Put the name editor next to the preview, with Save name directly below it. The scenario table is reference for the user's configuration decision; a link to Recovery codes follows the enrollment checklist. Keep the example secret behind “Show sample enrollment data,” clearly labelled sample.

### Mobile arrangement

Stack preview immediately after its field; the scenario matrix becomes short labelled rows. The method-off warning appears before the switch confirmation, not below enrollment metrics.

### Buttons, dialogs and states

Disable dialog: enrolled-account count → authentication effect → alternative protection → Cancel / Disable authenticator requirement. The ordinary name change should stay inline; if TotpIssuerDialog remains, use “Save authenticator name” and explain existing enrollments keep their labels.

## Findings and fixes

### P1 — Enabled can be mistaken for required

The On badge enables authenticator enrollment; it does not require every customer user to enroll. Show “Available to users · enrollment optional” as the main state. Keep project-wide enforcement visibly unavailable until its enrollment journey exists.

### P1 — Disabling deserves an account-impact decision

The description says enrolled authenticators stop being demanded while the method is off. Put the number of affected accounts and the security effect at the switch; provide a specific confirmation instead of relying on a paragraph.

### P2 — The factor model is buried in specialized language

“Demands,” “answers,” and “first second factor” are hard to scan. Use a small scenario matrix: password sign-in with authenticator → additional proof; verified passkey sign-in → no extra code; recovery code → lost-factor fallback.

### P2 — The issuer editor asks the user to learn an implementation term

“Rename the issuer” can become “Name shown in authenticator apps.” Show a live example and clearly state that existing enrollments keep their old label. Algorithm, key size and SQL behavior belong in optional technical help.

## Proposed page

Enrollment availability and coverage → app-label preview/editor → user enrollment/recovery journey → concise scenario matrix. Avoid letting sample secret/code content look like the dashboard member's own MFA enrollment.

## Dialogs and interactions

TotpIssuerDialog: label the project-name fallback, explain which future enrollments change, and use “Save authenticator name.” Keep the sample secret clearly marked as an example. Account MFA belongs on Account, not this page.

## Acceptance checks

A customer explains whether every user must enroll after seeing the header. Rename the issuer and identify whether old entries change. Disable with enrolled users and see the precise effect before saving.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [TotpIssuerDialog.vue](../apps/client/app/components/TotpIssuerDialog.vue)
- [mfa.ts](../apps/client/app/stores/mfa.ts)
- [mfa.ts](../apps/client/app/utils/mfa.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
