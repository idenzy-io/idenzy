# ADR-0017: The automatic top-up, and Valkey carries billing signals but never money

- Status: accepted
- Date: 2026-09-23

## Context

Three gaps sat next to each other.

**The automatic rule was a setting nobody read.** `billing_settings` held a threshold, an
amount and a card, the panel let a customer save them, and nothing charged anything:
`PaymentProvider.chargeOffSession` had no caller. A customer who switched it on was told they
were protected and were not.

**Money that left again was invisible.** The webhook knew three event types. A refunded top-up
kept the credit it had bought; a chargeback kept it too, and Stripe took the money from us
while the customer spent it.

**Charging was slow to react.** ADR-0014 prices usage on a five-minute pass and rejected a
queue on the grounds that the watermark already makes replays free. That argument holds for
correctness. It says nothing about latency, and a rule that is meant to top a wallet up "when
it runs low" should not wait five minutes after the charge that ran it low.

The product ask was a Valkey queue of charge amounts per organisation, drained every five
seconds, with the automatic rule's settings cached in Valkey and checked straight after each
charge. Two properties of this repository make the literal version wrong: the local and test
Valkey run with no persistence at all (`--save "" --appendonly no`), and the rule written into
`backend.md` for the SMS spend cap — "a cache cannot hold a limit whose failure mode is an
invoice" — applies with more force to the invoice itself. An amount held only in Valkey is
revenue a restart deletes, and an amount replayed from it is a double charge unless something
in Postgres refuses the second one.

## Decision

### 1. Valkey carries hints; Postgres carries money

Two sorted sets, `billing:due:drawdown` (project ids) and `billing:due:auto-top-up`
(organisation ids), and a cache of whether each organisation's rule is armed. **None of them
carries an amount.** A mark means "worth looking at soon"; the worker that acts on it re-reads
everything from Postgres, under a lock, before doing anything.

That makes every Valkey failure a latency failure. A lost mark waits for the periodic pass
(five minutes, unchanged); a duplicate mark coalesces in the set; a stale "not armed" in the
cache is ignored by the periodic pass, which reads Postgres directly. No charge anywhere rests
on a value read from Valkey.

Marks are a sorted set rather than a list because coalescing is then the data structure: a
project that flushes a thousand times before the tick is one entry. A mark keeps the latest
time (`ZADD GT`), and the consumer removes an entry only if its score is unchanged since it
read it (a small Lua compare-and-remove), so a mark that lands mid-work is not lost.

Producers are the meter's flush (usage moved), the drawdown when it charges (wallet moved),
and the management API when a rule or card changes (rule changed: drop the cached copy, then
mark). `BillingSignals` is a domain port whose sends never throw — a sign-in's flush and a
settings save must not fail over a hint.

### 2. A five-second tick, and repricing at most once a minute per organisation

*Superseded in part by the amendment below: the ledger is now written at most every five
minutes, and a live figure is computed every five seconds instead.*

`BillingSignalConsumer` drains both sets every five seconds. Usage marks are resolved to
organisations and repriced through the drawdown's existing `runFor`, gated by a Valkey
`SET NX PX` so an organisation is repriced at most once a minute across every worker —
repricing is free of charge (the watermark) but not free of reads (up to thirty-one sketches
per project). A charge marks the wallet, and the same tick gives the rule its look.

ADR-0014's five-minute pass stays, as does its watermark. What this changes is how soon, not
how correctly.

### 3. The automatic rule never charges twice, and the guarantee is in three places

1. **A row lock.** The decision is made inside a transaction holding `SELECT … FOR UPDATE` on
   the organisation's `billing_settings` row. Two workers queue; the second sees the charge
   the first opened.
2. **A partial unique index.** `top_ups_org_automatic_open_key` allows one unsettled
   automatic charge per organisation, whatever the code believes.
3. **An idempotency key.** Stripe is asked with `idenzy-auto-top-up-<row id>`. Asking twice
   about one row charges once, which is what makes crash recovery safe.

The row is opened and committed before Stripe is called, as every payment path here does it.
A timeout is not a failure — the card may have been charged — so the row stays open, blocks
the next charge through the index, and the reconciler finishes it: replay under the same key
inside 23 hours; after that, search Stripe for our reference; cancel only when a search a day
later finds nothing, because a charge that happened would be indexed long before then.

Settlement is one class, `TopUpSettlement`, used by both the worker (from Stripe's synchronous
answer) and the webhook. Whichever arrives first does the work; the second finds `settled_at`
set. A webhook that beats the worker attaches the intent to the row by the reference we
stamped on it, so it can settle rather than find nothing.

### 4. Limits, and when the rule stops itself

`AutoTopUpPolicy` in `@idenzy/domain` is the one place these live:

- **Three attempts per rolling 24 hours** by default, declines included, because a decline is
  what an issuer counts. `auto_top_up_daily_limit` is a per-organisation override between 1
  and 10, set by support and never over the wire.
- **Fifteen minutes between charges** even when both succeed, so an organisation deep in debt
  does not spend its daily allowance in a minute.
- **A doubling backoff after a decline** (one hour, then two).
- **A suspension** where retrying cannot help or would harm: the bank wants 3-D Secure
  (nobody is present off-session), the card is expired or gone, three declines in a row, a
  dispute, a fraud review closed against the payment, or a refund (whose clawback would
  otherwise take the balance under the threshold and charge the card straight back).
  A suspension is cleared only by a person saving the rule.

### 5. The wallet follows money that leaves again

`TopUpReversals` applies refunds and disputes through `WalletLedger`, which is now the only
place either direction of a wallet's arithmetic is written (debit: credit first, then debt;
credit: debt first, then spendable). A refund takes its top-up's credit back when Stripe
reports it pending and gives it back if it fails; a dispute takes it when the funds are
withdrawn and gives it back when they are reinstated. Each movement is claimed on the refund
or dispute row by a conditional update before the wallet is touched, so the four refund events
and five dispute events Stripe may send about one object move the balance once. Anything
already spent becomes debt.

Refund, dispute and review objects carry none of our metadata, so their organisation is found
by asking Stripe for the intent and reading what we stamped on it. `invoice.*`,
`invoiceitem.*`, `invoice_payment.*` and `issuing_dispute.*` are stored and acknowledged:
the product is prepaid and issues no cards. `charge.refunded` is acknowledged too, since its
charge no longer embeds refunds under the pinned API version and `refund.*` carries the money.

### 6. A webhook that fails is retried by Stripe

The receiver used to record a handler failure and answer 200, on the understanding that a
sweep would retry `processed_at is null` rows. No such sweep existed. A failure now answers
500, and a redelivery of an event whose handling never completed is handled again rather than
skipped as a duplicate. Every handler is idempotent by its own predicates, which is what makes
that safe.

## Consequences

- The rule works. Verified end to end against Stripe test mode on 2026-09-23: a real
  off-session charge settled once while the webhook arrived second; 25 concurrent signals
  produced one charge; a fourth attempt inside a day was refused; a decline backed off; an
  authentication-required card suspended the rule; a real refund and a real chargeback (funds
  withdrawn, then won) each moved the wallet once across every event Stripe sent. A lost
  dispute is covered by integration tests only.
- Valkey is now on the billing worker's hot path, and it surfaced a crash that was already
  there: a timer that rethrew a Valkey timeout through `void` killed the whole worker process.
  Those timers now catch.
- Reversals can put an organisation into debt, which the spend gate (ADR-0016) treats like any
  other debt.
- SMS, WhatsApp and email are still not charged to the wallet (only MAU is). The machinery
  here is per-organisation and does not care which meter moved the balance; adding a meter is
  a repricing change in the drawdown. Deferred until the rates stop being placeholders.
- Nobody is emailed when the rule charges, fails, or suspends itself. The panel says so; the
  email is risks.md 4 and waits on SES.

## Amendments

**A live figure every five seconds, and the ledger every five minutes.** Repricing on every
tick wrote a `usage_charges` row per active organisation per tick, which is up to 8.6 million
rows a day at the volume we plan for. That is the wrong price for a number that is mostly read by
a person opening a page. The two are now separate:

- The API meter publishes each instance's month sketch per project to
  `usage:live:{project}:{period}` every five seconds. The Postgres flush stays at sixty seconds.
- On the usage marks, `LiveBalance` unions those sketches with the month's base from Postgres,
  which it caches in worker memory. It prices the result and writes
  `billing:live:{org} = {mode, balanceCents, pendingCents, asOf}` with a ten-minute TTL:
  - `live = ledger balance − pending`;
  - `pending = max(0, mauCents(month MAU) − billed_cents)`.
- The ledger figure comes from a Valkey snapshot, `billing:ledger:{org}`. It is refreshed when the
  wallet moves or when it is five minutes old, so Postgres is read when the ledger changes, not on
  every tick.
- The drawdown writes the ledger at most once every five minutes per organisation
  (`SpacingGate`): at most 288 rows per organisation per day, with the same watermark as before.
- The automatic rule decides on the live figure, so it still reacts within seconds of the usage
  that ran the wallet low.

**Valkey still carries no money.** Every term of the live figure can be rebuilt from Postgres
and the sketches. The published sketches are copies of what the API flushes to Postgres
anyway, so losing Valkey loses no usage. The figure shown falls back to the ledger, at most five
minutes behind.

**The balance is read when the page is opened, not pushed.** `GET /v1/me`, which the panel
already loads on every visit, carries each organisation's figure for owners and admins. It reads
the live figure, falling back to the ledger snapshot and then to Postgres (`OrgBalanceReader`).
There is no SSE, no WebSocket and no polling timer. A person who wants a newer figure reloads the
page, and the figure they get is at most five seconds old.

**The drawdown also finishes the previous month**, for three days after it ends, until every
project in it is closed. Before this, usage flushed after the last pass of the month was never
charged.
