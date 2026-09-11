# Usage

Route: `/usage` · [Page source](../apps/client/app/pages/usage.vue)

## User task

I need to understand this period's usage, what Idenzy will charge, and what may change before month-end.

## Keep

Keep a line-item breakdown, separate actual/projected amounts and visibility of zero-cost included features.

## Proposed mockup

This is the proposed interaction/layout specification, not a description of capabilities already implemented. Apply the shared [layout blueprint](layout-blueprint.md).

### Desktop arrangement

```text
Usage                   [Project / billing entity] [Billing period v]
[Actual charges] [Projected month-end] [Data updated at]
[MAU used / allowance] [Projected MAU + assumption]
[Daily activity chart]                              [Daily | Cumulative]
[Line item | Quantity | Unit rate | Idenzy charge | Billing owner]
[Total / rounding / taxes note]                 [View corresponding invoice]
[Export usage]                                    [Meter definitions v]
```

Put billing period and scope next to the title, ahead of numbers. Label actual and projected amounts separately. Use currency values consistently; each line names units and billing owner. View invoice sits beneath the total. Export is secondary below the breakdown or in the header menu, not a competing prominent CTA.

### Mobile arrangement

Stack actual then projection, allowance, chart and line-item cards. A line item shows quantity, rate and charge vertically, preserving the billed unit. Do not squeeze five pricing columns into an unreadable row.

### Buttons, dialogs and states

No modal for period changes. Preserve filter state in navigation to Billing. Export carries selected period and actual/estimated status. When data is unavailable, show Retry and last known data time instead of a zero-dollar assurance.

## Findings and fixes

### P1 — The free-tier pacing explanation is mathematically misleading

The page says a usage bar ahead of elapsed-month progress will finish outside the allowance and one behind will finish inside. That is a straight-line projection assumption, not a guarantee about future activity. Label it “At the current average rate” and show projected MAU explicitly.

### P1 — The MAU definition contradicts itself

It says anyone authenticated this calendar month, then excludes a user created and never seen after their first day. Overview uses a rolling 30-day description and cross-project deduplication. Publish one authoritative metering definition, with concrete examples and scope.

### P1 — ‘Free’ can hide an external invoice

Own-vendor email/SMS may have no Idenzy carriage fee but still incur vendor charges. Label the line “$0 charged by Idenzy — vendor bills separately.” Keep unshipped logging out of current charges, or unmistakably label it unavailable.

### P2 — Reconciliation and historical periods are missing from the main task

The captured Usage amount and Billing drawdown differ by a cent. Define rounding and timing, show last updated, and let the operator select billing periods and open the corresponding invoice. State whether forecasts include fees and taxes.

## Proposed page

Period and billing scope → actual versus projected cost → usage and allowance → precise line items → invoice link. Keep explanatory metering rules near relevant lines, not in repeated philosophy sections.

## Dialogs and interactions

No page-specific dialog. Export needs the period, units, currency, project/organisation scope and actual-versus-estimated distinction. Pricing shown in this prototype is not an externally verified commercial quote.

## Acceptance checks

Explain the bill for a user who only signs in on sign-up day. Reconcile total with Billing/invoice using the same period and rounding. Distinguish no usage, missing meter data, free allowance and vendor-direct charges.

Related: [Shared experience](shared-experience.md), [dialog rules](dialogs.md).

## Settled while implementing

- **The chart's control is a range, 1d, 7d and 30d, in place of Daily | Cumulative.** Asked for
  by name. Active users are drawn as the billed level, which is the cumulative reading and the
  one that reconciles with the bill; emails and SMS segments are drawn per bucket. The card's
  table view lists every value in either case.
- **The comparison is the same dates a month before, not the window immediately before.**
  Active users are a level that starts again on the 1st, so the seven days before the 7th of a
  month straddle the reset and compare nothing with anything. The tiles compare with the same
  point last month for an open period and with the whole month before for a closed one.
- **Projections are per meter, at the last seven complete days' average.** Dividing the dollars
  by the month's progress projected a domain fee twice over and nothing at all for active users
  still under the allowance. Every projected figure says "At the current average rate".
- **Logging stays in the line items as unmetered**, with no quantity, no charge and no price.
  The proposed rate is gone: a price for something that does not exist is the unverified quote
  this note warns about.
- **Security features are a line of their own at $0.00, marked Included**, which is the "keep
  visibility of zero-cost included features" above.
- **Invoices are raised from closed usage periods in the placeholder**, so the invoice total,
  Billing's draw-down and this screen's total are the same cents by construction.

## Implementation references

- [usage.ts](../apps/client/app/stores/usage.ts)
- [metric-chart.ts](../apps/client/app/utils/metric-chart.ts)
- [usage.ts](../apps/client/app/utils/usage.ts)
