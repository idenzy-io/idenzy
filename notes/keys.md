# API keys

Route: `/keys` · [Page source](../apps/client/app/pages/keys.vue)

## User task

I need the right credential for an integration and a safe way to replace it without interrupting traffic.

## Keep

Keep separate publishable/server-secret types, one-time reveal and specific revocation confirmations.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
API keys                                              [+ Create key]
[Publishable keys] [Secret keys] [Revoked]
[Purpose/name | Prefix | Created by | Last observed use | Actions]
[Configured integrations / server-only placement guidance]
[Rotation workflow, only when explicitly started]
  Old key -> Replacement -> Deployment evidence -> Revoke old
  [Copy setup instructions] [View observed use] [Review revocation]
[Advanced key behavior v]
```

Place Create key upper right; type tabs are under the title. Show purpose/name if backed by the API, otherwise say it is a proposed field. Put Rotate in the existing key's action menu; it creates an explicit workflow instead of assuming multiple keys mean rotation. Keep usage evidence beside the old/replacement pair, with observation limitations.

### Mobile arrangement

Show key purpose/type, prefix and last observed use together. Open detail for placement and rotation. One-time reveal uses a full-height sheet with a readable, horizontally scrollable value and an adjacent labelled Copy action.

### Buttons, dialogs and states

Create dialog: browser/server use → purpose if supported → scope only if enforced → Create key. Reveal: Copy, server-placement guidance and explicit Done / Close without saving path. Revoke: exact key, last observation, consumer acknowledgement, Cancel / Revoke key. Never mark a not-yet-deployed replacement safe to remove.

## Findings and fixes

### P1 — The rotation recommendation can reverse the user's intention

The captured page calls a two-day-old unused secret safe to revoke while keeping the older active one. In utils/keys.ts, rotationOf ranks by last use and isQuiet treats never-used as safe. Two live keys do not establish a rotation, and a new undeployed key may be its intended replacement. Make rotation explicit: choose old key, create replacement, deploy it, observe usage, then review revocation.

### P1 — ‘Safe to finish’ overstates the evidence

A key silent for 24 hours can still belong to a weekly job or dormant deployment. Replace certainty with “No observed use in 24 hours,” show the observation window, and ask the operator to confirm all consumers migrated. Never infer absence of consumers from lastUsedAt alone.

### P1 — Secrets need an identifiable purpose

Rows have type, prefix and dates but no human name; the current schema lacks that field. Add a backend-supported label such as “Production worker” and creator/purpose metadata. Do not implement labels only as local decoration.

### P2 — Security reference crowds the integration task

Show browser versus server placement and copyable framework configuration first. Keep storage internals, tenant resolution ordering and repeated “Never” sections as optional reference.

## Proposed page

Keys grouped by purpose/type → create and one-time setup → explicit rotation workflow → recent observed usage → revocation. Compromise response remains a clearly separate urgent action.

## Dialogs and interactions

KeyCreateDialog: choose browser or server use in plain language. KeyRevealDialog: copy plus a deliberate accessible exit without a false saved acknowledgement. KeyRevokeDialog: identify prefix/name, observed use, affected integration and immediate next-request effect. Preserve the inability to retrieve old secret material.

## Acceptance checks

Create a replacement that is not deployed yet; the page must not recommend deleting it as a completed rotation. Revoke an old weekly-job key only after reviewing consumer context. The browser configuration never includes a secret key.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [KeyCreateDialog.vue](../apps/client/app/components/KeyCreateDialog.vue)
- [KeyRevealDialog.vue](../apps/client/app/components/KeyRevealDialog.vue)
- [KeyRevokeDialog.vue](../apps/client/app/components/KeyRevokeDialog.vue)
- [keys.ts](../apps/client/app/stores/keys.ts)
- [keys.ts](../apps/client/app/utils/keys.ts)
