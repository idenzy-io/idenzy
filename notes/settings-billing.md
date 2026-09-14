# Billing

Route: `/billing` · [Shell](../apps/client/app/pages/billing.vue) · [Overview](../apps/client/app/pages/billing/index.vue) · [Wallet](../apps/client/app/pages/billing/wallet.vue) · [Payment methods](../apps/client/app/pages/billing/methods.vue) · [Invoices](../apps/client/app/pages/billing/invoices.vue)

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

## Settled while implementing

The screen is a shell and four tabs rather than one page, on the settings shell's rail:
Overview, Wallet, Payment methods, Invoices. The arrangement above is the overview's order
read across the tabs: entity and payment status and the balance on the overview, automatic
funding and the credit on the wallet, the card on the methods tab, the invoices on their own.

**Cards are gone.** The first implementation stacked six equally weighted frames, which is
[shared-experience.md](shared-experience.md)'s diagnosis word for word. Each tab is now a
`PageHeader`, one warning that nothing can charge, and sections parted by a rule; the
balance is a `FactGrid` on the overview (balance, charged, projected, payment state) and on
the wallet (balance, purchased, promotional, expiring), with the explanation behind each
label's glyph rather than in a paragraph under it.

**A failed payment replaces the status, as asked, and is a soft banner.** `BillingPastDue`
is a tint of the error colour with the repair and the way to the portal beside it. A solid
band was tried and read as shouting; the error colour is kept for the glyph and the action.

`useBillingScreen` derives every figure once for the four tabs, so the balance the overview
shows is the balance the top-up dialog is handed and the wallet's fact band repeats.

## Settled while implementing

**The screens are the management API's now, and the first finding is kept true one layer
lower than it was.** A changed local balance must never read as proof of a payment, and it
cannot: nothing in the panel adds a cent to a ref. Adding credit asks for a hosted page and
leaves for it, the credit arrives when the provider tells the *server* it was paid, and the
wallet learns by reading itself again. Landing on the success URL is deliberately not
`confirmed` — the page completing is not the money moving, and calling it confirmed would be
the same simulated success moved up a floor.

**`PAYMENTS.running` is gone.** It was a module constant reading `false`, which was true
when it was written and would have outlived its truth silently the moment a provider was
configured. Whether a card can be charged is the server's answer about this deployment —
`wallet.provider` is null where none is — and a screen with no way to add money still
explains itself rather than looking broken.

**"Add a method" opened `https://billing.idenzy.io/portal`,** a hostname nobody had
registered. It asks for a session now: minted for this organisation, expiring, which is what
makes the card that comes back attributable to them. Same tab rather than a popup, because a
card saved in a popup leaves the reader looking at a page that does not know it happened.

**A card on file is no longer a condition of the first top-up.** That rule was written for
charging a saved card; a hosted checkout lets the cardholder pick one on the provider's page,
including a card nobody has used here before, so demanding one first refused the only route a
new customer has.

**The invoices tab is empty rather than invented.** It used to derive an invoice per closed
usage period, which is a forecast wearing an invoice's clothes — and it had to be, with
nothing that issues one. It reads what was issued now, and nothing has been: the job that
closes a month is money *out* and is its own piece of work.

## Implementation references

- [billing-screen.ts](../apps/client/app/composables/billing-screen.ts)
- [BillingAddCredit.vue](../apps/client/app/components/BillingAddCredit.vue)
- [BillingPastDue.vue](../apps/client/app/components/BillingPastDue.vue)
- [BillingTopUpDialog.vue](../apps/client/app/components/BillingTopUpDialog.vue)
- [BillingAutoTopUpDialog.vue](../apps/client/app/components/BillingAutoTopUpDialog.vue)
- [billing.ts](../apps/client/app/stores/billing.ts)
- [usage.ts](../apps/client/app/stores/usage.ts)
- [billing.ts](../apps/client/app/utils/billing.ts)
- [usage.ts](../apps/client/app/utils/usage.ts)
