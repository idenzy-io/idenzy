# Risks

What can cost us money, take a customer down, or take *their users* down — and what
currently stands between us and each one.

This is a register rather than a plan. Each entry says what the risk is, what the exposure
actually works out to, what exists today, and what would close it. Where nothing exists,
it says so plainly: a register that lists a control we have not built is worse than one
that admits the gap, because the second gets fixed.

Read it with [PROJECT.md](./PROJECT.md) 5.1 for the price list, 5.2 for unit economics, and
[ADR-0014](./docs/adr/0014-usage-is-drawn-from-a-prepaid-wallet-by-repricing-the-month.md)
for how the wallet works.

## The unit costs everything below rests on

| What | Our cost per unit | 10,000 units | Source |
| --- | --- | --- | --- |
| SMS (US) | ~$0.012 | $120 | 5.1, wholesale plus 25% |
| WhatsApp | Meta template rate | comparable | 5.1 |
| Email via SES | $0.0001 | $1 | 5.2, $0.10 per 1,000 |
| Authentication | ~$0.0008 / MAU / month | — | 5.2, marginal infra target |

SMS is roughly **120× email per unit**. That asymmetry is why the three are treated
differently, and it is the single most load-bearing number on this page.

---

## 1. The exposure ladder

An organisation that stops paying does not lose everything at once. Three tiers, and the
order is by what each costs us per unit:

| Tier | Stops at | Why here |
| --- | --- | --- |
| SMS and WhatsApp | The tolerance | Money leaves before the message arrives. Nothing to reconcile afterwards. |
| Email on the shared sender | A burst of 3/minute and 200 a day, always | Not a payment control. Pooled reputation: a sandbox to build against, never a production facility. |
| Email on a verified domain | Not limited here | The reputation at stake is mostly the customer's own. |
| Authentication | 30% of recent charges, and **it does stop** | Taking it down takes the customer's product down. Last resort, never the first, and not built. |

**Authentication stopping is a reversal**, and it should be recorded as one. The panel's
`ZERO_KEEPS_WORKING` says it never stops, on the argument that refusing to authenticate
over an unpaid balance takes a customer's product down and their users with it. That
argument is still true. What it missed is that the alternative is unbounded: an
organisation at 500,000 MAU that never pays costs us roughly $400 a month in infrastructure
alone (5.2) on top of about $1,225 of unbilled revenue, for as long as it likes. A business
with no ability to stop serving a non-payer has no commercial relationship, only a
donation.

So it stops — late, loudly, and never by surprise, and **at 30% of the charges raised against
it over the last thirty days** against the 20% the metered channels get (decision 3, closed).
`authToleranceCents` is the arithmetic and nothing calls it: the control it parameterises must
not ship before section 7's three safeguards exist.

The copy has been rewritten. `ZERO_KEEPS_WORKING` no longer promises that authentication never
stops — it says what is true today, which is that nothing refuses a sign-in over a balance and
that we would say so well in advance if that changed. It does not promise the stop either,
because there is no mechanism behind one. The third entry on that list was also simply wrong:
it said email on the shared domain never stops, which the sandbox cap had already made false.

---

## 2. The shared sender, and why it is a sandbox

**Risk.** Every project that has configured nothing sends from `mail.idenzy.io`. SES scores
reputation per domain, so one project blasting to scraped addresses puts **every other such
project's** verification mail in spam — customers who did nothing wrong and have no way to
fix it. The cost of the volume ($0.0001 an email) was never the point; the pooled reputation
is.

**The rule.** The shared sender is a place to build an integration against and **not a
place to run a product on**, whatever a customer is paying. Anyone going to production
verifies a sending domain of their own. This is not a free-tier restriction — the free tier
is 50,000 MAU and has nothing to do with which domain mail leaves from.

**Today.** Enforced. `DatabaseUsageMeter.assertWithinQuota` refuses past **a burst of three
refilling at one a minute, and two hundred a day**, on the shared sender only. Generous for
building against, hopeless for anything real, and the refusal is
`sending_domain_required` rather than a rate limit — a rate limit says "try again later",
which is true and useless, where this says the one thing that makes the send work.

Checked `checkStrictly`, so a cache we cannot reach refuses rather than allows. That is the
opposite of the call sign-in makes and the same one `SmsFraudGuard` makes: a developer
blocked by a Valkey outage is a minor inconvenience, an unmetered window on a shared sender
is the thing this exists to prevent.

**Two carve-outs, both deliberate and both visible.**

A project with its **own verified sending domain** is not limited here, because the
reputation at stake is then mostly its own. Not entirely — see below.

**Our own dashboard is exempt**, because we run the panel on our own product (PROJECT.md
9.5) and it has no verified sending domain yet, so it would be held to a developer's
allowance and our sign-ups would stop at two hundred a day. The durable fix is to verify a
domain for it, which also makes us the first user of the feature. Until then the exemption
is a named branch rather than a quiet one.

**The account-level rate, which was the open half.** Mail on a customer's own domain still
leaves through **our SES account**, and AWS tracks bounce and complaint rates per account as
well as per domain. A bad enough account-wide rate is a review or a suspension that takes mail
down for everyone at once.

That is bounded now. `EmailReputationBreaker` in `apps/workers` reads a seven-day window per
project every five minutes and opens a row in `email_sending_holds` at **5% bounces or 0.1%
complaints** — AWS's own at-risk thresholds, so we trip where it starts looking rather than
where it acts, because what it reviews is the account and by then the damage is shared. Below
**200 sends in the window** no rate is actionable: two bounces out of five is 40% and means
nothing, and without that floor the breaker's first act on a new project would be to close it
over an undeliverable test address.

`assertWithinQuota` reads the hold and refuses with `sending_paused`, **above both carve-outs**.
A verified sending domain and our own dashboard are exempt from the sandbox allowance and from
nothing else — the account is shared whatever domain a message leaves from. A hold is released
by the breaker when the bad days age out of the window, and by a person at any time; the row
survives the release, so what was stopped and on what evidence outlives the block.

**What this does not close** is the account's own figure. Each project's contribution to it is
bounded; nothing yet reads SES's account-level reputation and reacts to it. That is the honest
residue and it is smaller than what it replaces.

**Status: closed. The account's own reputation figure is unread, which is a smaller gap.**

---

## 2b. Nothing told us when mail bounced

**Risk.** PROJECT.md 11.2 item 4 describes SES publishing send, delivery, bounce, complaint
and reject events to SNS, into a webhook on our side, into the suppression list. The SNS
receiver at our end was never built, so for a long time **no bounce or complaint data reached
us at all** — and `SuppressionRepository.suppress()` had exactly one caller in the repository,
which was a test.

**Exposure.** Three things depend on it and none can be built without it: the suppression
list never learns about a hard bounce and we keep sending to it; the warm-up ladder
PROJECT.md 11.2 item 6 specifies has nothing to grow a ceiling on; and the account-level
breaker above has nothing to trip on. It is also how we would find out we have a problem
*before* AWS tells us.

**Today.** Built. SES publishes to SNS, an `email-events` route on the workers' internal
server receives it, and a permanent bounce or a complaint writes the suppression row on its own.

Three things in it are worth knowing before changing any of it, and all three are in
[ADR-0015](./docs/adr/0015-email-reputation-is-a-per-project-hold.md). **A message carries its
project as an SES message tag**, because nothing else in a notification can say whose it is —
the shared sender is one address for many projects and no table maps a message id back to one.
**The topic ARN is the check the signature does not make**: anybody can create an SNS topic,
subscribe our URL to it, and publish messages carrying a genuine AWS signature. And **the
ledger keeps no payload** — a bounce body carries the recipient address and a diagnostic code
that repeats it, and the enumerated verdict is all anything here reads.

The warm-up ladder (PROJECT.md 11.2 item 6) now has what it needs and is still not built.

**Status: closed.**

---

## 3. Authentication cannot currently be stopped

**Risk.** There is no suspension mechanism at any level. No column, no flag, no route. An
organisation that has used $50,000 of service and paid nothing is served exactly like one
that pays on time.

**Exposure.** Unbounded, and it grows with the size of the customer — the ones worth the
most are the ones worth the most to lose money on.

**Today.** Nothing. `WalletSolvency` gates SMS only.

**What closes it.** A suspension state on the organisation, a much higher tolerance than the
metered channels use, and the three safeguards in section 7 below — none of which exist
either. **This control must not ship before those do**, which is the whole of section 7's
point.

**Status: open.**

---

## 4. Nobody is told before anything stops

**Risk.** `billing_settings` carries a spend-alert threshold and a
`spend_alert_sent_for_month` column to make the notice idempotent. Nothing reads either.
There is no path by which a customer learns their card failed, their balance is low, or
their account is about to be limited.

**Exposure.** This is what turns every control on this page from a business decision into
an incident. A customer whose card expired on Friday and whose SMS stopped on Saturday with
no warning is a customer who churns and tells people why — and they would be right to.

**Today.** The settings exist and are editable on the wallet screen. Nothing fires.

It got wider on 2026-09-23. The automatic top-up now charges cards, declines, and suspends
itself (ADR-0017), and a refund or a chargeback now takes credit back — all without telling
anybody. The wallet screen says when the rule has paused and why; nobody is emailed. Each of
those events is a natural trigger for the notification this section asks for, and the code
paths that would send it are the ones that log `automatic top-up settled`, `rule_changed` and
`dispute moved a wallet`.

**What closes it.** A worker that reads the threshold, sends on the `spend_alert` template,
and claims the month through `claimSpendAlert` so a restart does not send twice. It needs a
notification template, which does not exist either — the catalogue has ten types and none
of them is about billing.

**Status: open, and it blocks section 3.**

---

## 5. The drawdown runs every five minutes, so spend is always slightly behind

**Risk.** MAU cannot be charged per event: it is a distinct count held as a sketch, and a
sketch cannot be asked whether this sign-in added one (ADR-0014). So it is priced by a job,
and between passes an organisation can spend money the wallet does not know about yet.

**Exposure.** Small and bounded by arithmetic. Even a very large customer adds at most a few
thousand new actives in five minutes, which at the top band is single-digit dollars. The
meter itself buffers and flushes on a 60-second interval, so some of that lag is upstream of
the job and would exist whatever the cadence.

**Today.** Accepted deliberately. Running faster than the meter flush reads the same numbers
again.

**Status: accepted.** Worth revisiting only if a customer ever appears whose five-minute
delta is material.

---

## 6. A Stripe webhook that never arrives is money taken and credit not granted

**Risk.** A customer's card is charged on Stripe's hosted page. Credit appears on our side
only when the `checkout.session.completed` webhook lands. If it never does — a
misconfigured endpoint, a secret rotated without updating ours, an outage on our side
outlasting Stripe's retry window — the customer has paid and has nothing.

**Exposure.** Direct, visible, and the worst kind: a customer who has been charged and can
prove it, looking at a balance that says zero.

**Today.** Partly mitigated. Delivery is recorded in `payment_provider_events` with the
provider's event id as a unique key, so a late retry still works whenever it arrives, and
Stripe retries for days. `stripeSettingsFrom` refuses a partial configuration outright, so
the specific case of "checkout configured, webhook secret missing" is a boot failure rather
than a silent one.

**What is still missing.** Nothing reconciles a *manual* checkout. If its event is lost for
good, no pass ever notices that a `top_ups` row has sat `pending` for a week. A sweep over stale
pending top-ups that asks Stripe directly would close it.

*Automatic* charges are reconciled now (ADR-0017): an open one is asked about by intent, or
replayed under its idempotency key inside a day, or searched for by reference after. The same
machinery would serve the manual sweep; what differs is that a manual row is keyed on the
checkout session until it completes, so the sweep would ask about the session.

A webhook whose handling fails also answers 500 now, so Stripe's retry is the retry. It used
to answer 200 and leave the row for a sweep that did not exist.

**A narrower version of this was worse and is fixed.** The event could arrive perfectly and
still leave money uncollected: `settleIntent` granted the full amount as credit and never
touched `org_debts`, whose only production caller adds to it. So debt was write-only. An
organisation $300 down that paid $1,000 got $1,000 to spend *and* kept the $300 owing, for
good. A top-up now settles debt inside the same transaction as the grant and only the
remainder becomes spendable, which is what ADR-0014 section 3 always said it did. The wallet
subtracts debt too, so a balance can read negative — which it has to, because an organisation
inside its tolerance is exactly that.

**Status: partly open.** The lost-event sweep is the remaining half.

---

## 6b. The automatic top-up charges a card with nobody present

**Risk.** Three ways it costs somebody money: charging twice, charging in a loop, and charging a
card in a pattern that gets our merchant account flagged — which would stop payments for every
customer at once.

**Today.** Built, and bounded (ADR-0017). Never twice: a row lock on the decision, a partial
unique index allowing one open automatic charge per organisation, and a Stripe idempotency key
per row, with crash recovery that replays under that key. Never a loop: the rule cannot add less
than it triggers on (a check constraint), fires at most three times in any rolling day (attempts,
declines included), fifteen minutes apart, and backs off after a decline. It suspends itself —
until a person saves it again — on a card that needs 3-D Secure, a card that is gone or expired,
three declines in a row, a dispute, a fraud review, or a refund.

**What this does not close.** The ceiling is still three times the customer's own amount per
day, every day. `notes/settings-billing.md` asks for "a spending safeguard"; a monthly cap on
automatic charges the customer sets themselves is the obvious one and does not exist. And nobody
is emailed when the rule charges, fails or pauses (section 4).

**Status: closed for correctness, open for a customer-set cap.**

## 6c. Money that left again stayed spendable

**Risk.** A refunded top-up kept the credit it bought, and so did a charged-back one — Stripe took
the money from us, the customer kept spending it, and the automatic rule would happily have
charged the disputing card again.

**Today.** Closed (ADR-0017). A refund takes the credit back when Stripe reports it pending and
returns it if it fails; a dispute takes it when the funds are withdrawn and returns it when they
are reinstated. Spent credit becomes debt, which the spend gate treats like any other. Each
movement happens once across every event Stripe sends. A dispute, a refund and a fraud review
each suspend the automatic rule.

**What is left.** A lost dispute leaves debt that only a later payment settles; nothing chases
it. That is the same exposure as any other debt and is bounded by the same tolerance.

**Status: closed.**

---

## 7. The controls above can hurt people who are not our customers

This section is the reason the others are written carefully, and it is the one to argue
with before building anything in section 3.

**A customer's users are not our customers.** Suspending authentication does not inconvenience
the organisation that owes us money — it locks out every person who has an account with
them. Those people have no relationship with us, no way to find out what happened, and no
way to fix it. We would be taking a service away from thousands of people to apply pressure
to one.

**A billing bug becomes an outage.** Every control here is an automated decision to deny
service, made from a number computed by code on this page. The drawdown was written in one
sitting; a mistake in the pricing function, the watermark, or the tolerance is a mistake
that suspends a paying customer. The blast radius of being wrong is larger than the loss
being prevented.

**Three safeguards before authentication can be stoppable**, and none exists yet:

1. **A notification chain that has actually run.** Section 4. Nothing should stop that was
   not warned about repeatedly, in advance, to a human being.
2. **An explicit hold that a person can set**, so support can stop a suspension without a
   deploy. An automated control with no manual override is a control that will eventually be
   wrong at the worst moment. `email_sending_holds` is the same idea one floor down and is
   **not** this: it holds a project's *mail* over a bounce rate, has nothing to do with money,
   and satisfies none of this section. What it does show is the shape — a stored decision with
   the evidence on it and a release a person can perform.
3. **A floor that a customer cannot fall through by accident** — a suspension needs to be
   the end of a long, visible process rather than the arithmetic result of a card that
   expired.

Worth considering alongside them: a size above which suspension requires a person rather
than a job. The customers big enough to hurt us are also the ones where being wrong is
unrecoverable.

**Status: none of the three exists.**

---

## 7b. ~~A customer can be permanently pinned to the wrong jurisdiction~~

**Closed 2026-09-21, by removing the thing that created it.**

The risk was that `projects.cell_id` was immutable, one cell existed, and the "explicit,
audited migration operation" PROJECT.md 4.13.5 promised for moving a project between cells
did not exist — so every project created before an EU cell was provisioned would have been
US-resident for ever, with no way out but deleting the project and making every end user
register again.

Region cells are gone (PROJECT.md 4.13.5). There is no `cell_id`, no registry, and no
region picker, so nothing can be pinned to the wrong jurisdiction.

**What the closure costs, said plainly, because it is not a win.** The second-order note in
the original entry was that the panel offered a region picker fed by a fixture, so a
customer who chose EU in development had been misled. That is fixed by not offering the
choice at all. The exposure that replaces it is simpler and larger: **we cannot offer EU
residency to anyone.** An EEA buyer who needs it is a buyer we decline, rather than one we
mislead. That is a better failure and it is still a lost deal, and it belongs on this page
rather than in a changelog.


## 8. Closed, and worth keeping closed

**Free tier by project splitting.** The allowance used to be per project, so an organisation
could get ten times it by making ten projects. It is per organisation now (ADR-0014, 5.1
revised).

**Charging twice for the same usage.** The drawdown reprices the month and charges the
difference against a watermark advanced by compare-and-swap, so a pass that runs twice
charges nothing and two passes at once let exactly one through. The test that proves it
interleaves two transactions by hand — the first version used `Promise.all`, which the
connection pool serialises, and it passed with the guard deleted.

**Volume bands priced wrongly at a boundary.** Pricing a delta has to guess which band it
falls in. Repricing the total makes every boundary the pricing function's problem and none
of the job's.

**SMS spend without a ceiling.** `sms_policies.daily_spend_cap` is reserved in one
conditional statement per send, and a project with no policy row sends nothing.

**A grant going negative.** `credit_grants.remaining_cents` is constrained non-negative;
overage lands on `org_debts` instead, and a top-up settles debt before becoming spendable. That
last clause described an intention rather than the code until recently — see section 6.

**Nothing telling us an address bounced.** The SNS receiver is built (2b), so the suppression
list has a writer that is not a test.

**One project's bounce rate costing every customer their mail.** A per-project breaker bounds
each project's contribution to the account-wide rate AWS reviews (2).

---

## Open decisions

| # | Decision | Needed for |
| --- | --- | --- |
| 1 | Whether our own dashboard gets a verified sending domain, retiring its exemption | 2 |
| 4 | Whether suspension above some size requires a person | 3, 7 |
| 5 | Email and SMS rates, which are placeholders in the price list pending a margin study | 5.1 |
| 6 | Whether to read SES's account-level reputation directly, now that each project's share is bounded | 2 |
| 7 | Whether customers get a monthly cap on automatic top-ups, and what it defaults to | 6b |

Closed: **2**, the per-project bounce-rate breaker, built alongside the SNS receiver (section 2).
**3**, the authentication tolerance, at 30% of charges over thirty days against the metered 20%
(section 1) — the number is settled and the control it parameterises is not built.
