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

## Settled while implementing

- **Readiness is five checks over four screens, and the header badge is read off all of
  them.** `smsReadiness` in `app/utils/sms-policy.ts` is pure and reads what the panel
  already holds, so the answer changes the moment a setting elsewhere does: the method on
  `/methods/otp`, the carrier on `/sms/providers`, the countries and the human check here,
  the balance on `/settings/billing`. A row that is not settled here names the screen it is
  settled on. `Test setup` is a re-read with a visible wait rather than a request.
- **`Set up SMS` writes one policy, and `Create a policy` is gone.** The old button created
  the row with its column defaults and left the project exactly as unable to send as
  before. `SmsSetupDialog` asks for the countries, the cap and the human check, shows what
  delivery is doing without asking anything about it, and writes the row once. Countries
  is first because it is the only one with no safe default.
- **The cap is a draft with its own Save, not a dialog.** It is typed, so saving the "2" of
  a "20" would refuse every send on the project until the "0" landed; and a cap set at or
  below the day's spend stops the channel until midnight UTC, which has to be readable
  before the write rather than after it. `capChange` computes the before, the after and
  that case, and the strip above the button says all three.
- **Today sits beside the controls it constrains**, seven columns and five, so a cap is
  changed against what the day has already cost rather than against a distant panel. It
  separates the reserved and unsettled part of the spend from the whole, because the cap
  reads the ledger and only the settled part is a message somebody was handed, and it
  states the reset in both clocks a reader holds.
- **Nothing draws a meter without a cap.** A project with no policy has no cap, and
  `capShare` answers 1 for a cap of nought, so the bar was full and red at nought spent:
  the opposite of the truth. The meter is drawn only against a policy and the sentence
  under it says why nought is a refusal rather than a quiet day.
- **What nobody configures is folded at the foot**, in two cards: the eight-stage order,
  which is the design and worth reading once, and the fixed guard behaviour. Neither is
  worth eight cards above the two controls this screen exists for.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [SmsSetupDialog.vue](../apps/client/app/components/SmsSetupDialog.vue)
- [SmsCountriesDialog.vue](../apps/client/app/components/SmsCountriesDialog.vue)
- [NumberDialog.vue](../apps/client/app/components/NumberDialog.vue)
- [sms-policy.ts](../apps/client/app/stores/sms-policy.ts)
- [sessions.ts](../apps/client/app/utils/sessions.ts)
- [sms-policy.ts](../apps/client/app/utils/sms-policy.ts)
