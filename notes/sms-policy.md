# SMS policy & spend

Route: `/sms/policy` · [Page source](../apps/client/app/pages/sms/policy.vue)

## User task

I need to enable SMS for intended countries while controlling fraud and cost.

## Keep

Keep the readiness checklist, explicit hard spend cap, default-deny countries and clear UTC-day label.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
SMS policy & spend                             [Ready / N blockers]
[Readiness: Method | Vendor | Countries | Human check | Funding]
[Allowed countries, 7 cols]        [Today, UTC, 5 cols]
[Change countries]                Spent / Reserved / Cap / Reset
[Daily cap $........]             [Open delivery diagnostics]
[Before/after remaining budget]           [Cancel] [Save cap]
[Human verification] [Rate limits]
[Advanced fraud pipeline v]
```

Use the readiness checklist as the first section. A blank project gets Set up SMS there, not Create policy. The country list owns Change countries; the cap editor owns Save cap. Show spent/remaining/reset beside the cap so changing it does not require comparing distant panels. Fixed guard behavior stays collapsed.

### Mobile arrangement

Stack readiness, today's budget, cap editor, countries and additional controls. Long country lists collapse after a summary with a clear Show all count. Keep currency units visible and use the appropriate numeric keyboard.

### Buttons, dialogs and states

Country picker: search at top, selected-count summary, checkboxes, Clear selection as a quiet explicit action, Cancel / Save N countries footer. Cap confirmation explains whether sends stop immediately. A readiness failure links to the exact missing setup step.

## Findings and fixes

### P1 — ‘Create a policy’ exposes a database step

The action creates a row but leaves the project unable to send. Replace it with “Set up SMS” and a guided transaction covering countries, cap, verification prerequisites and delivery readiness. Keep defaults safe.

### P1 — Readiness spans several screens

OTP method enablement, provider account, country allowance, cap and attestation all contribute. Show one combined checklist with links that return to this task. A policy must not say ready when the vendor transport or required verifier is unavailable.

### P1 — Spend changes need money context

For a cap edit, show spent today, remaining budget, next reset in local time plus UTC, and the effect of setting the cap below current spend. Distinguish provider-reserved charges from successfully delivered messages.

### P2 — Eight guard stages dominate a simple setup task

The fraud pipeline is informative but should be advanced reference. Put the decisions the user owns first, and keep technical fixed protections as a compact summary.

## Proposed page

Setup/readiness → countries and estimated destination costs → daily cap and remaining allowance → verification/fraud controls → advanced diagnostics.

## Dialogs and interactions

SmsCountriesDialog: search, selected count, explicit empty selection and the effect of removing countries. NumberDialog: name the metric and unit; for money use currency input and a before/after impact summary. Do not make clearing all countries look like harmless list cleanup.

## Acceptance checks

Set up a blank project and identify every remaining blocker. Lower the cap below current usage and understand the hard stop. Search/select countries with keyboard and verify the saved selection survives a failed request.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SmsCountriesDialog.vue](../apps/client/app/components/SmsCountriesDialog.vue)
- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
