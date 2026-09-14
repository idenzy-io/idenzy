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
| Authentication | A much higher tolerance, and **it does stop** | Taking it down takes the customer's product down. Last resort, never the first. |

**Authentication stopping is a reversal**, and it should be recorded as one. The panel's
`ZERO_KEEPS_WORKING` says it never stops, on the argument that refusing to authenticate
over an unpaid balance takes a customer's product down and their users with it. That
argument is still true. What it missed is that the alternative is unbounded: an
organisation at 500,000 MAU that never pays costs us roughly $400 a month in infrastructure
alone (5.2) on top of about $1,225 of unbilled revenue, for as long as it likes. A business
with no ability to stop serving a non-payer has no commercial relationship, only a
donation.

So it stops — late, loudly, and never by surprise. The copy on the wallet and the
`ZERO_KEEPS_WORKING` list both need rewriting to say this; today they promise something we
are choosing not to honour.

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

**Still open: the account-level rate.** Mail on a customer's own domain still leaves through
**our SES account**, and AWS tracks bounce and complaint rates per account as well as per
domain. A bad enough account-wide rate is a review or a suspension that takes mail down for
everyone at once. The control for that is a bounce-rate breaker per project, and it needs
bounce data — which brings us to the next entry.

**Status: closed for the shared sender. The account-level rate is open.**

---

## 2b. Nothing tells us when mail bounces

**Risk.** PROJECT.md 11.2 item 4 describes SES publishing send, delivery, bounce, complaint
and reject events to SNS, into a webhook on our side, into the suppression list. The SNS
receiver at our end was never built, so **no bounce or complaint data reaches us at all**.

**Exposure.** Three things depend on it and none can be built without it: the suppression
list never learns about a hard bounce and we keep sending to it; the warm-up ladder
PROJECT.md 11.2 item 6 specifies has nothing to grow a ceiling on; and the account-level
breaker above has nothing to trip on. It is also how we would find out we have a problem
*before* AWS tells us.

**Today.** Nothing. The suppression list and its repository exist and are only ever written
by hand.

**Status: open, and it blocks every remaining email control.**

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

**What is still missing.** Nothing reconciles. If an event is lost for good, no pass ever
notices that a `top_ups` row has sat `pending` for a week. A sweep over stale pending
top-ups that asks Stripe directly would close it.

**Status: partly open.**

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
   wrong at the worst moment.
3. **A floor that a customer cannot fall through by accident** — a suspension needs to be
   the end of a long, visible process rather than the arithmetic result of a card that
   expired.

Worth considering alongside them: a size above which suspension requires a person rather
than a job. The customers big enough to hurt us are also the ones where being wrong is
unrecoverable.

**Status: none of the three exists.**

---

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
overage lands on `org_debts` instead, and a top-up settles debt before becoming spendable.

---

## Open decisions

| # | Decision | Needed for |
| --- | --- | --- |
| 1 | Whether our own dashboard gets a verified sending domain, retiring its exemption | 2 |
| 2 | The account-level bounce-rate breaker, once the SNS receiver exists | 2, 2b |
| 3 | The authentication tolerance — how much larger than the metered one | 3 |
| 4 | Whether suspension above some size requires a person | 3, 7 |
| 5 | Email and SMS rates, which are placeholders in the price list pending a margin study | 5.1 |
