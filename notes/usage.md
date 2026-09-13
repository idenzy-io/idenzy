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
  one that reconciles with the bill; emails and SMS are drawn per bucket. The card's table view
  lists every value in either case. (The 1d range did not survive the wiring — see below.)
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

## Settled while wiring it to the API

The figures are real now: `usage/periods` for what each month cost and `usage` for the daily
series. Two calls rather than one, because only one of the two questions has an answer for an
arbitrary span of dates — a period's figure is the union of that period's sketches, and those are
dropped when the month closes. What the wiring cost the screen is worth stating plainly, because
each item was something the placeholder could show and the meters cannot.

- **The 24-hour range is gone, and with it the hourly chart.** `usage_daily` is a daily rollup and
  deliberately so: it is the shape a bill is raised from, and an hourly one would be twenty-four
  times the rows of a table kept for six years. The placeholder drew hours by splitting a day
  along a plausible curve, which is exactly the number a customer reconciles against and cannot
  find. Hour-by-hour activity is a question for the analytics store (todo.md 3.2).
- **SMS is counted in messages, not segments.** A segment is what a carrier bills by, and nothing
  counts them: `usage_daily` holds messages and the money they cost. The money is still right —
  the cost recorded against each send was priced by segment where it was reserved — so the change
  is to the quantity column and the meter definition, not to the charge.
- **The SMS charge now adds the published 25%.** The meter records what the carrier charged us,
  which is the honest thing for it to store: a margin is a pricing decision and what Twilio
  invoiced in March is not. The margin is applied in the panel's price list beside every other
  rate.
- **The sending configuration is an assumption and says so.** Which domain carried an email, and
  whose account carried an SMS, are not metered and no endpoint serves them, so the email rate and
  the SMS owner read as our shared domain and our routing. The line under the chart says that
  rather than letting two bill lines look like readings.
- **A quiet day carries the level rather than dropping to nought.** The series is sparse — a day
  with no activity has no row — and active users are a level, so the chart fills the gaps forward.
  The counters beside it fill with zero, because no email sent is genuinely none.
- **"Data updated" is a day, not an hour.** The meters buffer in memory and flush on an interval,
  so the honest statement is the day in progress is still moving.

## Implementation references

- [usage.ts](../apps/client/app/stores/usage.ts)
- [metric-chart.ts](../apps/client/app/utils/metric-chart.ts)
- [usage.ts](../apps/client/app/utils/usage.ts)
