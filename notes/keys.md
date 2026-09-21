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

## Settled while implementing

- **Purpose is shown as a proposed field, once, above the list,** rather than as a column of
  "Not recorded". `api_keys` has no column for it and no management endpoint serves keys yet,
  so the create dialog does not ask for one either. Adding the column is backend work.
- **Created by is read off the audit trail,** the actor on `key.created`. A key older than the
  trail's retention reads "Not recorded", which is true rather than blank.
- **The explicit rotation needs a `replaces` field on the replacement.** The panel models it the
  way it models every management API reply; the server does not store it yet.
- **The tabs are All keys, Publishable keys, Secret keys and Revoked, with their counts,** and
  the tab is kept in the query. All keys was added at the user's request and is the default: it
  lists the live keys of both kinds and every rotation, and a live secret key is set apart there
  in its own colour. A kind tab shows the rotations of its kind, and the header badge says a
  rotation is open when the reader is on a tab that does not show it.
- **Show revoked, a checkbox beside the tabs, adds revoked keys to the other tabs.** Also at the
  user's request; off by default and remembered per viewer. The Revoked tab stays.
- **The figures rail and the key-age tally are gone.** Neither is in the arrangement above, and
  shared-experience.md names the right-hand metrics block as the pattern to avoid.
- **Revoke asks about consumers every time,** and compromise is its own menu item with its own
  acknowledgement, so the urgent path never passes through the rotation.
- **Placement guidance is not on the page or in the reveal,** at the user's request: the page is
  the keys and their rotation, and the reveal is the value and its Copy. A key's detail keeps the
  variable names for its kind, copying the name rather than `pk_us1_4fQ2x9a…`, which would be a
  shortened value (layout blueprint, rule 7).
- **The create dialog's footer leads with Rotate on the newest live key of the kind,** in place
  of a paragraph saying a second key does not replace the first. The tooltip carries that
  sentence.

## Implementation references

- [KeyCreateDialog.vue](../apps/client/app/components/KeyCreateDialog.vue)
- [KeyRevealDialog.vue](../apps/client/app/components/KeyRevealDialog.vue)
- [KeyRevokeDialog.vue](../apps/client/app/components/KeyRevokeDialog.vue)
- [keys.ts](../apps/client/app/stores/keys.ts)
- [keys.ts](../apps/client/app/utils/keys.ts)
