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

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [audit.ts](../apps/client/app/stores/audit.ts)
- [audit.ts](../apps/client/app/utils/audit.ts)
- [filters.ts](../apps/client/app/utils/filters.ts)
