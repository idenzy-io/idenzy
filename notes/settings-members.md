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

## Settled while implementing

**The team is a `DataTable`, which is what the arrangement above already drew.** The first
implementation built `[Name + email | Role | MFA readiness | Last active | Actions]` as an
avatar list inside a card, under three more cards, so a screen whose task is "find a person
and act" read like a configuration page. It is now the `/users` shape: the figures strip,
then one card holding a toolbar and a table, with Members and Invitations as the toolbar's
own tabs and a search beside them. Two screens with the same task are now read the same way.

`?view=` still names the list and is still replaced rather than pushed. The search term is
deliberately not in the query: an address in a URL is personal data in a browser history,
which is the rule [data-requests.md](data-requests.md) already keeps.

**Ownership lost its card and kept its act.** Who holds it is a fact in the strip; handing it
on is performed on the person receiving it, from their own row. The card's only control
opened a dialog that then asked "to whom?", so there were two routes to one act and the
shorter one was hidden in an overflow menu.

The second-factor policy is the one setting left on the screen, and it still says that the
requirement is recorded rather than enforced. The capability matrix is folded, carries its
counts while shut, and keeps the sentence about API keys directly under it: that line is
where the dashboard's roles stop being a security boundary, and it must not become a
tooltip.

**"Last active" is a real column now.** It had a header and a formatter and nothing that
ever wrote it, so every row read "Never signed in" — including the row belonging to whoever
was reading the page, which is the version of this bug that is impossible to miss and was
missed anyway. `MembershipGuard` stamps it on the membership check every dashboard request
already makes, at most once a day per member: the value comes back from the check itself,
so a member who was here an hour ago costs no extra read and no write. It is stamped after
the role check rather than before, so a refused request does not report a seat as in use.

## Implementation references

- [FactGrid.vue](../apps/client/app/components/FactGrid.vue)
- [MemberInviteDialog.vue](../apps/client/app/components/MemberInviteDialog.vue)
- [MemberRemoveDialog.vue](../apps/client/app/components/MemberRemoveDialog.vue)
- [MemberTransferDialog.vue](../apps/client/app/components/MemberTransferDialog.vue)
- [members.ts](../apps/client/app/stores/members.ts)
- [members.ts](../apps/client/app/utils/members.ts)
