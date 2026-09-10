# Members

Route: `/settings/members` · [Page source](../apps/client/app/pages/settings/members.vue)

## User task

I need to invite teammates with appropriate access and retain secure ownership of the workspace.

## Keep

Keep the permission matrix, visible role labels, invitation history and atomic ownership-transfer design.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Members                              [Organisation / project scope] [+ Invite]
[Members] [Pending invitations]
[Name + email | Role | MFA readiness | Last active | Actions]
[Team sign-in policy: require MFA]                       [Review change]
[Effective permission matrix v]
[Ownership: Current owner]                             [Transfer ownership]
```

Put the scope next to the title and Invite at upper right. A role is visible on each row; choosing another role opens a concise before/after review when consequential. Pending invitations have Resend and Revoke on their own rows. Place ownership below routine membership and separate it from a role dropdown.

### Mobile arrangement

Use member cards with email, role and MFA readiness. Open role details in a sheet; keep the invitation action near the page title. The permission matrix becomes a selected-role capability list rather than five compressed columns.

### Buttons, dialogs and states

Invite dialog: email → role cards with concrete capabilities → scope summary → Cancel / Send invitation. Remove: name/email, affected scope, retained machine credentials, Cancel / Remove member. Transfer: choose accepted member, old/new roles and ownership, explicit confirmation, Cancel / Transfer ownership.

## Findings and fixes

### P1 — Roles are described as a dashboard boundary only

The page admits anyone able to create a full-access secret key can exceed the apparent role boundary through the management API. A role matrix must describe effective authority. Align server key-creation permissions/scopes and role promises before presenting least-privilege roles as enforceable.

### P1 — The membership scope needs a single answer

General describes organisation membership while this page and its store use project scope. Invitations and removal must explicitly say which workspace/projects are affected, or a user cannot predict access loss.

### P1 — Requiring MFA needs a real enrollment transition

The toggle promises no lockout and an enrollment step at next sign-in. That flow must exist before enabling the promise. Show unenrolled members and what access they have during transition; test the owner cannot strand the organisation.

### P2 — Inviting and changing roles need understandable outcomes

Use role descriptions with concrete capabilities in the invite form. Show pending/expired/revoked invites and whether an action sends an email. Role changes should state the before/after privileges and when they take effect.

## Proposed page

Members and pending invitations → role/change detail → team security policy → capability matrix. Keep ownership transfer separate from ordinary role changes.

## Dialogs and interactions

MemberInviteDialog: exact workspace, email, role summary and “Send invitation.” MemberRemoveDialog: access affected and machine credentials that remain. MemberTransferDialog: current owner → selected owner, current owner's new role, exact email and an understandable handover confirmation.

## Acceptance checks

Invite a Viewer and verify effective API access matches the UI promise. Transfer to an accepted member while retaining one owner. Enforce MFA for an unenrolled teammate and complete the actual enrollment gate.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [MemberInviteDialog.vue](../apps/client/app/components/MemberInviteDialog.vue)
- [MemberRemoveDialog.vue](../apps/client/app/components/MemberRemoveDialog.vue)
- [MemberTransferDialog.vue](../apps/client/app/components/MemberTransferDialog.vue)
- [members.ts](../apps/client/app/stores/members.ts)
- [members.ts](../apps/client/app/utils/members.ts)
