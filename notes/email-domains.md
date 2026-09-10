# Sending domains

Route: `/email/domains` · [Page source](../apps/client/app/pages/email/domains.vue)

## User task

I need authentication mail to come from my brand and know whether DNS is correct.

## Keep

Keep the shared sending-domain fallback, per-record DNS explanation and distinction between verifying a domain and selecting it as sender.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Sending domains                                        [+ Add domain]
[Current From: Product <no-reply@...>]          [Change sender]
[Current cost / shared or custom reputation]
[Domain | Verification | Sending state | Last check | Manage]
[Selected domain setup]
[1 Add] -> [2 Publish DNS] -> [3 Verify] -> [4 Select sender]
[Type | DNS host [Copy] | Value [Copy] | Required | Status]
[Pending explanation / checked time]        [Check records] [Use sender]
```

Place Add domain in the page header and Change sender next to the actual From line. Keep verification state separate from sending state. In setup, Check records is the action until required checks pass; Use sender becomes primary afterward. Display recurring cost before adding and again before selecting a chargeable sender if applicable.

### Mobile arrangement

Each DNS record becomes a stacked card with Type, Host and Value labels, separate copy buttons and status. Do not truncate the only copy of a DNS name. Keep Check records beneath the record group and show the last check beside it.

### Buttons, dialogs and states

Add-domain dialog: domain, DNS-access prerequisite, applicable charge, Cancel / Add domain. Records view should be a full-height sheet on mobile. Removal names whether the domain is active, shows the fallback From address and uses Cancel / Remove domain.

## Findings and fixes

### P1 — The initial decision needs cost and prerequisites before commitment

The page does explain the custom-domain cost, but it is separate from the short add dialog. Repeat the applicable charge and DNS-access requirement at Add domain, with a clear statement that adding alone does not switch the sender.

### P1 — DNS verification needs a guided operational checklist

Five records, optional DMARC guidance and a separate sender choice are too much to infer from rows. Show required records completed/remaining, last check, exact failure and next retry. Keep Host/Type/Value/TTL individually copyable and explain provider auto-appended domains.

### P1 — Delivery promises contradict implementation status

This page describes bounces as always suppressed, while Suppressions explicitly says the provider-event pipeline is not built. The shared-domain verification and delivery numbers are fixtures. Use capability-backed readiness instead of unqualified operational reassurance.

### P2 — Reputation statistics distract from incomplete setup

Before a custom domain is ready, prioritize records and activation. Later show delivery/reputation trends with exact periods and threshold provenance; a zero or illustrative rate must not imply measured health.

## Proposed page

Current From/Return-Path and cost → domain setup steps → DNS checks → preview sender → activate → delivery health. Keep the safe shared sender available through the process.

## Dialogs and interactions

SendingDomainAddDialog: DNS access and recurring charge. SendingDomainRecordsDialog: required/optional grouping, individual copy actions, checked time and actionable failures. SendingDomainRemoveDialog: replacement sender and impact on pending mail, with no promise that DNS cleanup happens automatically.

## Acceptance checks

Add a synthetic domain, check partial DNS, fix one record and understand what remains. Verify it without changing the sender accidentally. Remove the active custom domain and identify the fallback before confirming.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SendingDomainAddDialog.vue](../apps/client/app/components/SendingDomainAddDialog.vue)
- [SendingDomainRecordsDialog.vue](../apps/client/app/components/SendingDomainRecordsDialog.vue)
- [SendingDomainRemoveDialog.vue](../apps/client/app/components/SendingDomainRemoveDialog.vue)
- [sending-domains.ts](../apps/client/app/stores/sending-domains.ts)
- [sending-domains.ts](../apps/client/app/utils/sending-domains.ts)
