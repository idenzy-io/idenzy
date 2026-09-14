# ADR-0014: Usage is drawn from a prepaid wallet by repricing the month, not by charging events

- Status: accepted
- Date: 2026-09-14

## Context

ADR-0011 gave the control plane its own tenant key and the billing schema hangs off it: a wallet
per organisation, credit grants, top-ups, cards, invoices. The Stripe half is in, so money can get
*in*: a customer tops up, a webhook lands, `credit_grants` gains a row and the balance goes up.

Nothing takes it out. `CreditGrantRepository.draw()` has no caller, `assertWithinQuota` allows
everything, and the balance is a number that only rises. That makes the wallet a counter.

The commercial model is **prepaid, pay-as-you-go**: an organisation buys credit and spends it. It
is not postpaid — there is no month-end invoice run, and `invoices` stays empty until enterprise
customers want terms. So the missing piece is not an invoice generator. It is a drawdown.

Four things make it harder than "subtract the cost when something happens".

**MAU cannot be charged per event.** It is a count of *distinct* users in a calendar month, held
as a HyperLogLog sketch, and a sketch cannot be asked whether this sign-in added one — which is
exactly why `dailyBetween` hands back the sketch rather than a number. Nor may a sign-in be
refused over money: `ZERO_KEEPS_WORKING` puts authentication first and it is not a lever we have.

**The price is banded.** 50,000 free, then $0.003, $0.0025 and $0.002 as an organisation grows.
A charge computed on a *delta* has to decide which band the delta falls in, and gets it wrong at
every boundary — the organisation that crosses 250,000 mid-month is the common case, not the edge.

**A charge must never land twice.** At 5M MAU the money involved is four figures a month, and a
worker that ran twice, or two workers that ran at once, must not produce two charges. Nor may a
crash between "took the credit" and "recorded that we took it" leave either half.

**Running out must not be a cliff.** A card that expires on a Friday should not stop a customer's
SMS on a Saturday, and an outage of ours must not either.

## Decision

### 1. Reprice the whole month and charge the difference

Per organisation and calendar month, keep a watermark of what has already been billed. Every pass
computes the price of the month *as it now stands* and charges only what has not been charged:

```
owed = priceOf(mau_now) − billed_cents_so_far
```

Never `priceOf(mau_now − mau_last)`. The distinction is the decision.

This works because MAU within a month is **monotonically non-decreasing** — a distinct count over
a union only grows — so the watermark can only move forward and `owed` is never negative.

Three properties fall out of it rather than being engineered separately:

- **Banding is correct by construction.** The price of a month is a pure function of its MAU, so
  every band boundary is handled by the function and never by the drawdown. Changing the table, or
  changing its *shape* to something with a minimum commitment or a per-organisation override, is a
  change to one function and no change at all here.
- **Replay is free.** Run the pass twice and the second computes `owed = 0`.
- **Concurrency is settled without a lock.** The watermark advances by compare-and-swap on the
  value that was read. Two workers race; one matches a row, the other matches none and retries
  against fresh numbers. This is the shape the SMS spend cap already uses, and for the same reason
  its comment gives: a read followed by a write lets two passes that each looked affordable both
  commit.

The one rule the implementation must hold is that **taking the credit and advancing the watermark
are one transaction**. Both are Postgres, so this is available; splitting them is how a crash
charges twice.

### 2. The free tier and the bands are per organisation

PROJECT.md 5.1 said "free (every project, forever)" and the panel prices per project. That is
revised here: the allowance and the bands are the **organisation's**, because the wallet is, and
because a free tier per project is bought by splitting one project into ten.

Organisation MAU is the **sum** of its projects' monthly MAU, and that sum is exact rather than an
approximation. Users are project-scoped — `users.project_id` is part of the row and the meter
marks `(projectId, userId)` — so two projects' user sets are disjoint by construction and nobody
is counted twice. This is the opposite of summing a project's *days*, where the same person
recurs and only a union is honest (PROJECT.md 5.1); the two cases look alike and are not.

### 3. Credit and debt are separate, because a grant cannot go negative

`credit_grants.remaining_cents` is constrained non-negative and stays that way: a grant is
something that was bought, and a bought thing cannot be worth less than nothing.

What a drawdown cannot cover becomes **debt**, held per organisation. The balance a screen shows
is `spendable credit − debt`, and a top-up settles debt before it becomes spendable. An
organisation $400 in debt that adds $500 has $100 to spend, which is the arithmetic a customer
expects and the arithmetic an accountant expects.

`usage_charges` is the append-only record beneath both: one row per pass that charged something,
carrying what was charged, how much came out of credit and how much went to debt. The materialised
debt figure is the fast answer; the ledger is what it can be rebuilt from when a customer disputes
one. Six-year retention, the same basis as `top_ups` and `invoices`, and no `UPDATE` or `DELETE`
granted on it.

### 4. Tolerance is a share of recent charges, not of recent top-ups

An organisation may go into debt up to a tolerance before anything stops:

```
tolerance = 20% of the charges raised against it in the last 30 days, floored at $50
```

**Charges and not top-ups**, which was the first shape considered. Tolerance keyed on top-ups
moves when a customer happens to pay: one that prepays $10,000 on the first of January has $2,000
of rope until the 31st and none on the 1st of February, having done nothing differently. Keyed on
charges it tracks how much they actually use, which is what the rope is for. The floor stops a new
organisation from having no rope at all on its first overage.

Past the tolerance, `ZERO_STOPS` applies as the panel already describes it: SMS and WhatsApp
refuse, because a message costs us money before it reaches anybody. Authentication, the dashboard,
the API and mail on the shared domain do not stop, whatever is owed.

### 5. A periodic job, and deliberately not a queue

The drawdown runs in `apps/workers` beside `RetentionSweeper` and the usage roller, every five
minutes, over organisations whose projects have recent usage.

A queue was considered and rejected. The meter buffers in memory and flushes on
`USAGE_FLUSH_INTERVAL_SECONDS` (60 by default), so repricing more often than the flush learns
nothing; `usage_projects_with_activity` already answers which projects moved, from migration 0050;
and the watermark makes replays free, which is the one property at-least-once delivery would have
bought. What is left is a handful of indexed reads and at most one write per organisation per
pass. At the 1,000-project shape in PROJECT.md 5.2 that is nothing, and it is the same
cost argument ADR-0012 made against putting every webhook delivery through Cloud Tasks.

**SMS stays synchronous and per-send.** It is the one channel where the money leaves before the
work is done, so it is reserved in the request against the spend cap, as it already is. Batching
it would mean reconciling money that has already gone.

## Consequences

The price list becomes shared data rather than two copies. It lives in `@idenzy/protocol`, and the
panel's `FREE_MAU` and `MAU_PRICE` are removed in favour of it — a screen that priced a month
differently from the server would dispute its own charge, which is worse than a screen that shows
nothing.

The balance can go negative, and every screen that reads it has to expect that. This is not a
failure state: it is an organisation inside its tolerance, and the wallet says so.

A pass that fails leaves the watermark where it was, so the next pass charges the same delta and
nothing is lost. A pass that charges and crashes before committing charges nothing, for the same
reason. The failure this design does not survive is a `usage_daily` sketch that goes *backwards* —
which the storage layer does not permit, since `mergeActiveUsers` only unions.

Repricing the month means a **rate change applies to the whole of the month it lands in**, not
just to usage after it. That is the cost of the property that makes banding correct, it is the
right default for a price cut, and it is a reason to make rate changes at a month boundary.

**The consequence this ADR gets wrong on its own is the ladder.** It says authentication
never stops, quoting `ZERO_KEEPS_WORKING`, and that has since been revised: it stops, at a
much higher tolerance than the metered channels, because the alternative is serving a
non-payer without bound. Email gains a ceiling that exists whether or not anybody owes
money, because the risk there is a shared sending domain's reputation before it is a bill.
Both are recorded in [risks.md](../../risks.md) with what has to exist first — and in the
authentication case, three things do, none of which is built.

Invoices remain unbuilt and `invoices` remains empty. Enterprise customers wanting terms is a
second model — postpaid, against the same meters — and the table is already shaped for it.
