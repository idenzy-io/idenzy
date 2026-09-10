# Users

Route: `/users` · [Page source](../apps/client/app/pages/users/index.vue)

## User task

I need to find the right customer, understand why they cannot sign in, and perform a proportionate support action.

## Keep

Search, status segments, column controls, named row-action triggers and separate destructive confirmations are good foundations.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Users                                             [Export CSV] [+ Add user]
[Search name, email, phone or ID.....................................]
[All] [Active] [Suspended] [Deleted]       [Filters] [Columns]
[User + verification | Status | Methods | Last sign-in | Actions]
[... rows ...]
[Selected: 3] [Suspend] [Sign out] [Delete]       [Clear selection]
[Result count]                 [Rows per page] [Previous] [Next]

After choosing a user:
[List / search, 5 cols] [User detail + Sessions / Activity, 7 cols]
```

Keep Add user as the sole page primary action. Place search directly above the list; make the user identity the detail trigger and keep the ellipsis for secondary actions. Show the bulk bar only while selection exists, with Delete separated and visually destructive. In detail, place Suspend and Sign out below identity/status; put Delete in a More menu or danger section.

### Mobile arrangement

Use stacked identity + verification + status rows. Tapping identity opens a full-height detail sheet with a visible Back to users action and the original list state preserved. Never hide status while keeping Delete available.

### Buttons, dialogs and states

Add user order: identification method → email/phone → optional display name → sign-in method/password → verification decision. Footer: Cancel left, Create account right. Suspension shows duration and sign-out checkbox; deletion shows exact identity and selected count. Pending/error lives beside the confirm action.

## Findings and fixes

### P1 — There is no complete user investigation destination

UserRowActions offers copying, suspension, sign-out and deletion, but no user detail route. Support must piece context together across unrelated pages. Add a subject detail workspace with identities, verification, factors, sessions and filtered audit links.

### P1 — The mobile row hides decisive context

At 390px the initial visible table area presents identity and the action menu, with status outside that area. A suspended account can look like a normal one until the operator scrolls. Keep status beside identity and place secondary attributes in expandable detail.

### P1 — Add user promises a sign-in path without checking readiness

UserAddDialog says an account without a password uses a code. SMS/email code availability depends on project settings. Show the actual enabled path and whether an invitation or verification message will be sent. Its email/optional-phone labels also obscure that either identifier is sufficient.

### P2 — Account creation validates a different password policy

The dialog checks eight characters locally while the project can raise its minimum. Use the current project policy, explain safe server failures, and keep the form open after unsuccessful creation. A manually verified email needs a specific evidence decision.

## Proposed page

Search and status filters → compact user list → persistent user detail. Default columns should answer who, can they sign in, how, and last activity; IDs and extra metadata remain optional.

## Dialogs and interactions

UserAddDialog: use “Email or phone number” with a clear method choice and “Create account” outcome. UserSuspendDialog: explain duration and impact on existing sessions. UserDeleteDialog: identify the account and distinguish permanent erasure from suspension; bulk confirmations need the complete selected scope.

## Acceptance checks

Find one user, inspect their sessions, then return with the original query intact. Add a phone-only account when SMS is unavailable and receive an actionable prerequisite message. Verify selection across pagination before any bulk deletion.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md). Findings describe the current prototype; proposed behavior requires implementation and usability validation.

## Implementation references

- [UserAddDialog.vue](../apps/client/app/components/UserAddDialog.vue)
- [UserSuspendDialog.vue](../apps/client/app/components/UserSuspendDialog.vue)
- [UserDeleteDialog.vue](../apps/client/app/components/UserDeleteDialog.vue)
- [users.ts](../apps/client/app/stores/users.ts)
- [users.ts](../apps/client/app/utils/users.ts)
