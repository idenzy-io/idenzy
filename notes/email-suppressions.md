# Suppressions

Route: `/email/suppressions` · [Page source](../apps/client/app/pages/email/suppressions.vue)

## User task

I need to find why a customer is not receiving email and decide whether sending to that address can safely resume.

## Keep

Keep the privacy-conscious exact-address lookup, per-project/channel distinction and individual rather than bulk release.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Blocked email addresses                     [Delivery capability status]
[Email address........................................] [Check address]
[Result: Suppressed / Not found / Lookup unavailable]
[Reason] [Channel] [Recorded at] [Provider / source]
[Recommended next step]                  [View delivery evidence]
[Allow email again] (only when a block exists and release is allowed)
[Advanced: suppression records / digests v]
```

Give the lookup most of the top section. Keep Check address on the field's right at desktop. Results appear directly beneath the field so the operator does not search a separate table. Place the repair recommendation before release. Release is a conditional action, never a generic primary button for an empty list.

### Mobile arrangement

Stack input and a full-width Check address button. Put the result summary, reason and next action in one column. Show the entered address in the result for confirmation without putting it in the route URL.

### Buttons, dialogs and states

Release dialog: exact address/channel → why blocked → evidence it is safe to resume → any required reason → Cancel / Allow email again. Show a distinct successful release state and offer a new lookup; do not silently send test mail.

## Findings and fixes

### P1 — The page contains incompatible reassurance

It opens with addresses that must never be sent to again, but its empty state says the event pipeline is unbuilt and bounced addresses may still receive mail. Lead with capability status, then separate unsupported ingestion from a working list with zero entries.

### P1 — Digest rows are not a useful default investigation list

A table of hashes cannot answer which customer needs help. Make exact-address lookup the main workflow and return a readable result: suppressed/not found, reason, channel, when and what can be done. Keep digest records as advanced evidence.

### P1 — Not found is not proof of deliverability

Ingestion can be absent or delayed. State what was checked and when, and direct the operator to delivery attempts or provider evidence. Do not imply a successful lookup means mail will arrive.

### P2 — The language is categorical rather than diagnostic

“Must never send again” conflicts with a release action. Use “Addresses currently blocked from delivery,” then explain the particular reason and release conditions. Treat hashed addresses as protected identifiers, not as a blanket anonymity claim.

## Proposed page

Search an exact address → delivery-block result with source/time → reason-specific next action → release decision → optional technical digest table.

## Dialogs and interactions

SuppressionReleaseDialog should retain the reason and exact target/channel context, require a specific justification where appropriate, and use “Allow email to this address again.” Releasing a block must not automatically send a message or erase the decision's audit history.

## Acceptance checks

Check an address absent from an unavailable pipeline and see Unknown/unavailable context. Release one email suppression without affecting SMS or another project. Clipboard, URL and logs should not unexpectedly expose the entered address.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SuppressionReleaseDialog.vue](../apps/client/app/components/SuppressionReleaseDialog.vue)
- [suppressions.ts](../apps/client/app/stores/suppressions.ts)
- [suppressions.ts](../apps/client/app/utils/suppressions.ts)
