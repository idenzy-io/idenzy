# My account

Route: `/account` · [Page source](../apps/client/app/pages/account.vue)

## User task

I need to manage my own dashboard profile, sign-in security and devices, with no ambiguity about whose account changes.

## Keep

Keep separate dashboard-session content, current-device markers and the distinction from customer-user policy.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
My account
[Profile] [Security] [Devices] [Memberships]
Profile: Name [Edit] | Email + verification [Change email]
Security:
  Password [Change password]
  Authenticator [Manage]    Passkeys [Manage]
  Recovery codes [View status / Replace own codes]
Devices:
  [This device] [Other devices]                  [Sign out other devices]
Memberships:
  [Organisation | Role | Open members]           [Leave organisation...]
```

Use local tabs or anchored sections to shorten the page. Profile owns email/name actions; Security owns credential actions; Devices owns session sign-out. Put My account outside project-scoped navigation context and show membership scope separately. Remove avatar/dogfooding essays from the working area.

### Mobile arrangement

Stack these sections or use an accessible horizontally scrollable tab bar. Keep each factor's status and Manage action together. Device details expand; current-device state remains prominent. Leave organisation stays at the bottom of Memberships.

### Buttons, dialogs and states

Email dialog: new email → current address → two-confirmation status → Cancel / Send confirmation links. Password dialog: current password, new password, actual requirements, show control, sign out others, Cancel / Change password. Factor removal uses a specific recent-verification/impact flow. Leave dialog names organisation and owner-transfer blocker.

## Findings and fixes

### P1 — Password change asks for credentials that are not used

AccountPasswordDialog collects current/new passwords but emits only signOutOthers; the store updates a timestamp. This is a prototype, not a functional password change. Wire a real authenticated flow before success feedback and preserve safe invalid-current-password errors.

The email-change handler similarly patches `email` immediately and sets `emailVerified: false`, despite the two-confirmation description. Store a separate pending change and keep the current address until the actual confirmation policy completes; display pending, expired and cancel states explicitly.

### P1 — The strength guidance conflicts with the product policy

The rendered dialog puts mixed case and number/symbol suggestions under “Must contain at least,” while Passwords explicitly rejects composition requirements. Separate actual requirements from optional strength guidance and use the dashboard account's effective policy.

### P1 — Factor removal needs recovery and verification context

The main page provides simple Remove actions for authenticator/passkeys/recovery codes. Before removing protection, identify the specific factor, alternative ways in, required recent verification and any recovery codes invalidated. Do not expose another customer's factor management here.

### P2 — Basic account tasks are buried in product explanations

The page explains avatar infrastructure, Argon2 parameters and dogfooding. “What this page never does” adds a large secondary article. Lead with profile/security/devices; keep implementation rationale in documentation and use “My account” to clarify global scope.

## Proposed page

Profile → security methods and recovery status → dashboard devices → membership links → leave workspace. A compact security checklist can support these actions without repeating their explanations.

## Dialogs and interactions

AccountEmailDialog: new email, both confirmation steps and pending/cancel state. AccountPasswordDialog: concise requirements and successful server result before closing. AccountLeaveDialog: workspace, lost access, owner-transfer prerequisite and whether an invitation is needed to return. Tested account dialogs lack an accessible dialog name; connect their visible heading programmatically.

## Acceptance checks

Change password with a wrong current password and remain in the dialog with a useful error. Start email change and follow both pending confirmations. Leave as owner only after a clear ownership resolution; current dashboard sessions must not be confused with customer sessions.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [AccountEmailDialog.vue](../apps/client/app/components/AccountEmailDialog.vue)
- [AccountPasswordDialog.vue](../apps/client/app/components/AccountPasswordDialog.vue)
- [AccountLeaveDialog.vue](../apps/client/app/components/AccountLeaveDialog.vue)
- [account.ts](../apps/client/app/stores/account.ts)
- [members.ts](../apps/client/app/stores/members.ts)
- [account.ts](../apps/client/app/utils/account.ts)
- [members.ts](../apps/client/app/utils/members.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
