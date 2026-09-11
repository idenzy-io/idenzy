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

## Settled while implementing

The name change is inline, so `TotpIssuerDialog` is gone rather than renamed. The mockup
draws the editor with `[Use project name] / [Custom name….]` and `[Cancel] [Save name]`
under it, which is a draft with two save buttons and not a dialog; keeping a dialog beside
that would have been two ways to write one field. The two states are a segmented control,
because following the project's name is a choice and not a blank field: null carries a
later rename of the project along, and a typed name holds still.

The editor and its preview are one card rather than two. Desktop wants them side by side
and mobile wants "preview immediately after its field", and two cards would have put the
save row between them on a phone.

The disable dialog's action is `Turn off authenticator apps`, not the note's `Disable
authenticator requirement`. The screen's whole P1 is that available is not required, so
naming the button after a requirement would put the misreading back on the one control
that must not carry it. The dialog keeps the note's order: count, effect, what is left,
then the named action.

The scenario matrix is six rows and it replaced two cards, not one: the old "Answering a
challenge" card and the "What holding one means" row said the same thing in our words.
Its foot carries the two facts no row can: that the answer is one gate's for every flow,
and, while the method is off, that no row applies today.

There is no setup check. Passkeys and one-time codes have one because their prerequisites
live on other screens; an authenticator needs nothing but a session, so a check card here
would only re-read the switch above it.

`Coverage summary` is a section of `Statistic` tiles and the breakdown is one card per
factor, following the passkeys screen where a row of bars and a bar chart were both tried
and rejected. A bar of 3 against a bar of 214 is a rule and a dot.

## Acceptance checks

A customer explains whether every user must enroll after seeing the header. Rename the issuer and identify whether old entries change. Disable with enrolled users and see the precise effect before saving.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [TotpDisableDialog.vue](../apps/client/app/components/TotpDisableDialog.vue)
- [mfa.ts](../apps/client/app/stores/mfa.ts)
- [mfa.ts](../apps/client/app/utils/mfa.ts)
- [otp.ts](../apps/client/app/utils/otp.ts)
