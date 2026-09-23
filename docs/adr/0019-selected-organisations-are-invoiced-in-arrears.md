# ADR-0019: Selected organisations are invoiced monthly in arrears, through Stripe Invoicing

- Status: accepted
- Date: 2026-09-23

## Context

ADR-0014 made every organisation prepaid: usage is drawn from a wallet, and a wallet that runs
dry stops at the spend gate. That is right for the long tail. It is wrong for a large customer
whose procurement team pays invoices on terms and will not keep a card topped up, and for whom
being stopped by a wallet is not an acceptable outcome.

Such customers are few, and choosing them is a commercial decision. The product ask:
- monthly invoices, for selected organisations only;
- net 14 by default, overridable per organisation;
- an overdue invoice is flagged, and a person decides what happens next;
- the choice is made by Idenzy staff (ADR-0018), not by the customer.

## Decision

### 1. A billing mode per organisation, set only by staff

`billing_settings` gains three columns:
- `billing_mode` (`prepaid` | `invoiced`, default `prepaid`);
- `invoice_terms_days` (default 14, checked 1–90);
- `invoice_email`, which a check constraint requires when the mode is `invoiced`.

Only `PUT /v1/operator/orgs/:orgId/billing` changes them. It needs the `billing` role and a
reason, and writes an `operator_actions` row in the same transaction. Staff use the operator
console's organisation page to call it. The customer's panel shows the result but cannot change
it.

### 2. An invoiced organisation is priced exactly as before, and simply not drawn from

Every existing path keeps running, with one difference each:

| Path | Invoiced behaviour |
| --- | --- |
| Drawdown | Skips the organisation, so the wallet is not drawn and the watermark does not move. |
| Spend gate | Open. An unpaid invoice never stops traffic. |
| Automatic top-up | Skipped, with its own reason (`invoiced`). |
| Live figure (ADR-0017) | Carries `mode: invoiced`. Its pending part is "usage not yet invoiced". |
| `/v1/me` and the wallet | Show unbilled usage, outstanding and overdue, and the terms, instead of a balance. |

The watermark is what makes switching safe in both directions. Say an organisation is switched to
invoiced mid-month. Its prepaid part was already drawn, and the watermark records how much; the
invoice bills the month's price less that watermark, never the whole month again. Switching back
works the same way: the drawdown finds the watermark already at the invoiced total.

### 3. The month is drafted in Postgres, then issued at Stripe

`InvoiceRunner` runs hourly in the workers and pages through invoiced organisations. It waits
until the previous month is closed for every project of the organisation, then works in two
phases.

**Draft, in one transaction:**
- The total is `mauCents(organisation's month MAU) − billed_cents`.
- Any prepaid credit left over is applied, as a negative line debited through `WalletLedger`.
- Any prepaid debt is carried over, as a positive line that clears it.
- The MAU amount is split into one line per project by largest remainder, so the lines sum to the
  total to the cent.
- The `invoices` row is written as `draft`, numbered `IDZ-{YYYYMM}-{org6}`.
- The watermark is advanced by compare-and-swap.

A month that comes to zero gets no invoice. A month wholly covered by credit is recorded as paid
and never reaches Stripe. The unique index on organisation and month, together with the
compare-and-swap, means two runs cannot draft the same month.

**Issue, after the commit:** the runner uses Stripe Invoicing with
`collection_method: send_invoice` and `days_until_due` taken from the terms. It first searches
for an invoice carrying our reference; only if there is none does it create one under an
idempotency key derived from the invoice row. It then adds the items, finalizes and sends. The
Stripe id, the hosted URL, the PDF and the due date are stored on the row.

A crash between the two phases leaves a draft. The next run finds it, and Stripe hands back the
invoice it already made. Drafts are never shown to the customer.

### 4. Stripe's events move the row, and only forward

Every move is guarded by the states it may come from, so replays and out-of-order deliveries are
no-ops:

| Event | Effect |
| --- | --- |
| `invoice.finalized` | Store the number, PDF and hosted URL. |
| `invoice.paid`, `invoice.payment_succeeded` | Move open or past-due to `paid`. |
| `invoice.overdue` | Move open to `past_due`. |
| `invoice.voided` | Move to `void`. |
| `invoice.marked_uncollectible` | Move an outstanding invoice to `uncollectible`. |
| `invoice.payment_failed` | Log it. |
| `customer.deleted` | Release the organisation's customer, so the next charge or invoice makes a new one instead of failing against a customer that no longer exists. |

The rest of `invoice.*`, and all of `invoiceitem.*`, `invoice_payment.*` and `customer.*`, are
stored and acknowledged, and nothing acts on them. The run and the events above already carry
the same facts, and acting on one fact through two paths is how the two come to disagree.

### 5. Overdue is a flag, and a person decides

Nothing stops, suspends or charges an organisation over an unpaid invoice. The panel shows the
overdue amount and a pay button. The operator console lists every overdue invoice across all
organisations (`GET /v1/operator/invoices/overdue`). Suspending an organisation for non-payment
is a decision with a customer on the other end, and so is taken by a person.

### 6. Tax is not applied yet

No invoice carries tax, and `customer.tax_id.*`, `tax.settings.updated` and `tax_rate.*` are
acknowledged, not acted on. Tax depends on the seller's registrations and the customer's location
and VAT status. Getting it wrong is worse than leaving it out on invoices that someone at Idenzy
reviews, for the handful of organisations billed this way. Stripe Tax is the likely answer. It is
recorded as an open decision in `risks.md`, not as an omission.

## Consequences

- A large customer can be billed the way they pay, and the prepaid path is unchanged for
  everyone else.
- An invoiced organisation is extended credit up to a month plus its terms, with no automatic
  stop. That exposure is bounded by who staff choose, and by nothing else; `risks.md` records it.
- SMS, WhatsApp and email usage is not invoiced, just as it is not drawn from the wallet
  (ADR-0017). When the drawdown learns to price them, the invoice run prices them too, from the
  same function.
- The invoice's PDF is Stripe's. Our own `invoice_lines` are the record the panel shows, and
  Stripe's items mirror them one for one.
