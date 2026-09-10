# Billing

Route: `/settings/billing` · [Page source](../apps/client/app/pages/settings/billing.vue)

## User task

I need to fund the correct account, understand automatic charges and retrieve invoices confidently.

## Keep

Keep payment collection in the payment provider's portal, explicit balance, minimum top-up and a clear distinction between alerts and hard caps.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Billing                      [Organisation / billing entity]
[Balance] [Payment status / next invoice]             [+ Add credit]
[Card: Visa ...6411]                              [Manage payment method]
[Automatic top-up: Off / below $X add $Y]                 [Configure]
[Spend alert: $X]                                        [Edit]
[Current-period charges]                              [View usage]
[Invoices: period | amount | paid/due | issued | PDF]
[Billing details and tax]                         [Open billing portal]
```

Put the billing entity at the top and Add credit beside balance. A failed payment replaces the normal status with a specific repair action. Automatic top-up and spend alerts are distinct adjacent rows. Keep Open billing portal beside billing details; invoice PDF links live on their own rows.

### Mobile arrangement

Balance and payment status come first, then a full-width Add credit button, card, automatic funding, alerts and invoices. Do not keep a global Top up action competing with this page's own funding control.

### Buttons, dialogs and states

Add-credit dialog: amount presets + custom value → currency → payment method → total charge → estimated resulting balance → Cancel / Add $X credit. Auto-top-up dialog: enabled switch → threshold → amount → card → sentence preview → Cancel / Save automatic top-up. Provider authentication/redirect has a distinct pending state.

## Findings and fixes

### P1 — Money scope is unsettled

General says billing belongs to the organisation, but the page and header show a project-derived balance. Settle the ownership model and show the charged legal/billing entity in every checkout and automatic-top-up confirmation.

### P1 — Charge actions need provider-confirmed outcomes

Top-up and portal flows are simulated. Never treat a changed local balance as proof of a successful payment. Design processing, authentication-required, failed, cancelled and confirmed states; use idempotent backend payment handling.

### P1 — Automatic top-up needs understandable exposure

Threshold and amount are present, but users also need the payment method, whether saving enables the rule, what happens if the threshold is already crossed, and how to disable it. Explain repeat charges and offer a spending safeguard if the eventual product supports one.

### P2 — Commercial promises are stronger than the prototype

“Forever,” unlimited authentication despite debt and nothing expiring require product-approved billing policy. Replace unverified categorical promises with actual terms and clear service behavior. Reconcile the penny difference seen between Billing and Usage and show last-updated time.

## Proposed page

Billing entity and payment status → balance/funding → automatic funding and alerts → current-period reconciliation → invoices. A failed payment deserves a visible action, not an optimistic runway estimate.

## Dialogs and interactions

BillingTopUpDialog: “Add $50.00 credit,” actual payment method, charge total and balance after confirmation. BillingAutoTopUpDialog: plain-language rule preview and explicit enabled state. Explain portal handoff and return; cancellation should not change balance.

## Acceptance checks

Cancel checkout and confirm balance does not change. Retry after a provider timeout without duplicate charging. Save an automatic rule and explain exactly when/how much/which card can be charged.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Implementation references

- [BillingTopUpDialog.vue](../apps/client/app/components/BillingTopUpDialog.vue)
- [BillingAutoTopUpDialog.vue](../apps/client/app/components/BillingAutoTopUpDialog.vue)
- [billing.ts](../apps/client/app/stores/billing.ts)
- [usage.ts](../apps/client/app/stores/usage.ts)
- [billing.ts](../apps/client/app/utils/billing.ts)
- [usage.ts](../apps/client/app/utils/usage.ts)
