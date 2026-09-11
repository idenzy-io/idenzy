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

  ... a row's Manage opens the setup dialog:
  [1 Add] -> [2 Publish DNS] -> [3 Verify] -> [4 Select sender]
  [Record | Type | Name [Copy] | Value [Copy] | Status]
  [Pending explanation / checked time]      [Check records] [Use sender]
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

## Settled while implementing

- **Verification and sending are two columns**, on the row and on the setup block, with a
  third state between them: a verified domain that is not the sender reads "Ready" rather
  than as either working or broken. `verificationState` and `sendingState` are the two, and
  nothing on the screen states one alone.
- **The answer is one line and three facts, not three paragraphs.** The From line leads the
  page with Change sender beside it, and under it a strip of columns says where a rejection
  goes, whose reputation carries the mail and what a month costs on either domain. The
  reasoning behind each (why DKIM is three records, where SPF goes, why a domain of your own
  is the dearer option under the break-even) is folded away at the foot: a screen that
  explains before it answers is one somebody scrolls past to reach the list.
- **The setup is a dialog**, opened from a row's own control, capped on a desktop and a
  full-height sheet below `lg`. It was a block under the list, which is what this note
  originally asked for; built, it pushed delivery off the fold and left a reader scrolling
  back up to change which domain they were reading. It opens the way the revocation setup
  does, and it scrolls its own records so the page does not move underneath a checklist
  somebody is working through with a DNS console open. Nothing opens it on arrival.
- **The domain list and the record table are the same table**, both on `RecordTable`: one
  set of track widths, one stacked arrangement below 900px where every cell names itself
  through `data-label`. Two hand-kept grids drift, and the one that drifts is the one nobody
  reads at a desk.
- **The records are one table and not four groups.** A group per kind repeated a heading, a
  paragraph and a column strip over five records and made the setup three screens long. Each
  row now carries its kind, whether it is required and what the last check found, with the
  paragraph behind an info glyph beside the name.
- **The relative name is a choice above the table, not a caveat on every row.** A console
  that appends the zone turns `token._domainkey.acme.com` into a record that exists, is
  never found, and is explained nowhere. Both forms are correct in different consoles, so
  Full and Relative is one segmented control and the column, the copy button and the
  explanation under them all follow it. Full is the default: a console that does not append
  the zone refuses a relative name outright, which is the failure somebody notices. TTL is
  stated once, in the table's own description.
- **Delivery moved to the foot and says what it measured.** Sends are counted by the meter
  a customer is billed on; delivered, bounced and complained are provider events and that
  pipeline is not built, so they answer a dash and name what they would have counted. The
  reputation meters are gone: a bar drawn over a fixture is the most confident thing on the
  page. The thresholds stay as reference, each naming whose they are.
- **Change sender sits beside the From line and nowhere else**, and it is a dialog listing
  every domain with its cost, including the ones that cannot send and why. Verifying a
  domain never moves the sender, which is the acceptance check this shape exists for.
- **The add dialog carries the prerequisites**: DNS access, the monthly charge from the
  moment it is added, and that adding changes no sender.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SendingDomainSetup.vue](../apps/client/app/components/SendingDomainSetup.vue)
- [SendingDomainRow.vue](../apps/client/app/components/SendingDomainRow.vue)
- [SendingDomainSenderDialog.vue](../apps/client/app/components/SendingDomainSenderDialog.vue)
- [SendingDomainAddDialog.vue](../apps/client/app/components/SendingDomainAddDialog.vue)
- [SendingDomainRecordsDialog.vue](../apps/client/app/components/SendingDomainRecordsDialog.vue)
- [SendingDomainRemoveDialog.vue](../apps/client/app/components/SendingDomainRemoveDialog.vue)
- [sending-domains.ts](../apps/client/app/stores/sending-domains.ts)
- [sending-domains.ts](../apps/client/app/utils/sending-domains.ts)
