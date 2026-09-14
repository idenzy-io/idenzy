# Audit log

Route: `/audit` · [Page source](../apps/client/app/pages/audit.vue)

## User task

I need to establish who changed something, when, and why, with enough context to investigate.

## Keep

Keep the readable event timeline, actor grouping, expandable evidence and emphasis on administrative changes.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Audit log                                        [Export filtered view]
[Search actor, resource, request ID.................................]
[Time range v] [Actor v] [Action v] [Administrative only x]
[Include end-user activity] [Sensitive changes only]
[Timeline, 8 cols]                   [Actors / filter summary, 4 cols]
  Time — Actor — action — target      [Known exclusions]
  [Expanded event: before/after, request, sequence, related resource]
[Load more / pagination]                        [Integrity details v]
```

Put search and all applied filters above the timeline. Export says filtered view and is secondary at the upper right. Every event's target is an actionable resource link when permitted; expansion is separate from that link. Before/after values and request correlation precede hash-chain metadata.

### Mobile arrangement

Use a single timeline with actor, action and target wrapping naturally. Keep exact time available by expansion, not hover only. Move actor facets into a Filters sheet that shows active selections and Apply/Clear buttons.

### Buttons, dialogs and states

No general modal is needed for event detail; use inline expansion or a persistent detail panel. Export review lists scope/period and redaction policy before download when sensitive. Loading and append errors appear at the timeline boundary without losing visible events.

## Findings and fixes

### P1 — ‘All’ is not the complete trail at first glance

The initial view sets aside end-user activity while offering All-type filtering language. Make exclusions visible in a persistent filter chip such as “Administrative activity only,” with an explicit Include end-user activity action.

### P1 — The sample timeline includes semantically confusing events

The captured trail contains a CI deploy key signing in to the dashboard. Distinguish a service credential API action from a human dashboard sign-in; otherwise the audit story undermines the role model.

### P2 — ‘Worth reading’ hides the selection rule

Rename to a concrete category such as “Sensitive changes” and explain its criteria. Avoid implying that unmarked events do not matter. Preserve full access to the trail.

### P2 — Integrity and retention deserve accurate scope

Append-only runtime grants and a hash chain do not mean no privileged actor can ever alter storage. Say entries cannot be edited through the product and integrity can be checked. Show exact timestamps/timezone, sequence and request correlation in detail; keep hashes optional.

## Proposed page

Search and explicit actor/action/time filters → readable event timeline → detail with target, actor, before/after and related request → export and integrity metadata.

## Dialogs and interactions

The page owns event expansion rather than a named dialog. Give each row a clear accessible expansion label. Export should state active filters, period, project and included/excluded end-user activity; distinguish empty export from permission or load failure.

## Acceptance checks

Find a user's sign-in after seeing the default administrative view. Explain why an event is marked sensitive. Export a filtered result and confirm its scope matches the visible filter summary.

## Settled while implementing

- **The exclusion is a chip in the filter row, not a switch in a rail.** It carries the
  count and its own way off, and the period control's last option is `All time` rather than
  `All`, which read as "the complete trail" over a view that sets the end-user activity
  aside. An exclusion an auditor cannot see is one they will not account for.
- **An actor can only have done what that actor can do.** `ACTION_ACTORS` says which kinds
  may author an action and the fixtures draw from that, so a service credential no longer
  signs in to the dashboard or joins the project. A trail that contradicts the role model is
  a trail that undermines the thing it is evidence for.
- **"Worth reading" is now `Sensitive`, and the rule is next to the control.**
  `SENSITIVE_CRITERION` names what earns the mark — membership and roles, keys, a second
  factor removed, a session revoked, an erasure completed, support let in — and ends by
  saying an unmarked entry is not a less important one.
- **The integrity claim stops where the guarantee stops.** The header says entries cannot be
  edited through the product and that a change underneath is detectable. `INTEGRITY_CLAIMS`
  carries the three halves in a folded card, and the second of them says in as many words
  that detectable is not the same as impossible.
- **The detail leads with what moved, then the request, then the chain.** A settings entry
  carries `from` and `to` and the row draws them as a before and an after; `requestId` is a
  column of its own rather than a line in the metadata, and it is searchable. The hashes are
  last, under "Tamper evidence".
- **The metadata is Shiki-highlighted**, in the panel's own palette through `CodeBlock`, so
  a payload here reads the way one does on the claims and webhooks screens. It renders plain
  until the highlighter loads rather than suspending the row, and an action with no metadata
  draws no block at all instead of a pair of braces.
- **Export is reviewed before it is taken.** The button says `Export filtered view` and
  `AuditExportDialog` states the project, the period, the count, every filter in force and —
  the line that matters — whether the customer's own users' activity is in the file. An
  empty result is drawn as an answer about the filters rather than as a failure.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

**The trail is the management API's now, and the screen reads a bound rather than a
period.** `GET .../projects/:projectId/audit` at viewer, keyset on `seq` — which this table
can do and the users list cannot, because `seq` is per-project, unique and monotonic and is
the order the chain is built in, so a page boundary never falls between two entries a
reader expects to see linked.

What the wiring cost this screen is one claim, and it is the one worth naming. The
placeholder could total a period because it had invented every entry in it; a real trail is
read newest-first and the read is bounded, so past that bound the figures describe what was
fetched and not the period. The screen says so — in the strip, and again in the export
dialog's scope, because that dialog exists to stop somebody reading a narrowed file as the
whole trail and the read's own bound is a second way it is narrow, one the filters do not
mention. Narrowing the period is what makes a total honest again, which is why the period
is the one control that goes back to the API instead of filtering what arrived.

**The second P1 above is answered by the trail being real.** The CI deploy key signing in
to the dashboard was the generator's invention; nothing emits it, because nothing can —
a key acts through the API and a person signs in, and the vocabulary now comes from
`audit_events.actor_type` rather than from a second set the panel made up.

That vocabulary was the find worth keeping. The panel had `end_user`, `member` and `staff`
against the column's `user`, `customer_staff` and `idenzy_staff`: three of five names
disagreed, so a filter built on the panel's set would have matched nothing at all. The
database's names win because they are the ones that exist, and the screen's labels are
labels now rather than a parallel set of ids. The category is the same story in reverse —
it is derived from the action's prefix and is deliberately not a column, so an action
shipped next year falls into a group without a migration, and an unknown one is filed under
settings rather than dropped.

An entry's `actorName` is the server's answer and only for accounts. A team member, an API
key and a background job are not rows in this project, so the screen prints the actor's
kind instead of crossing a tenant boundary for a label. A name that resolves to nothing
stays null: the trail outlives its subject on purpose, and an erased account is the normal
case rather than an error.

Export is still assembled in the browser from what is on screen. That is honest while the
screen says what it holds, and it is not a substitute for the real one: an export of a
year's trail is a file a worker writes, which is the DSR path's shape and does not exist
yet.

## Implementation references

- [AuditEntryRow.vue](../apps/client/app/components/AuditEntryRow.vue)
- [AuditExportDialog.vue](../apps/client/app/components/AuditExportDialog.vue)
- [audit.ts](../apps/client/app/stores/audit.ts)
- [audit.ts](../apps/client/app/utils/audit.ts)
- [filters.ts](../apps/client/app/utils/filters.ts)
