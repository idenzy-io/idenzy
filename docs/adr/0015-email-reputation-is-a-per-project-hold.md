# ADR-0015: Email reputation is a per-project hold, fed by tagged SES events

- Status: accepted
- Date: 2026-09-14

## Context

PROJECT.md 11.2 item 4 describes SES publishing send, delivery, bounce, complaint and reject
events to SNS, into an HTTPS webhook on an `email-events` worker, into the suppression list. The
SNS receiver was never built, so **no bounce or complaint data reached us at all**.
`SuppressionRepository.suppress()` had exactly one caller in the repository and it was a test: an
address that hard-bounced in March was still being written to in September.

[risks.md](../../risks.md) 2b called that "open, and it blocks every remaining email control", and
listed the three things waiting on it. The suppression list never learns about a hard bounce. The
warm-up ladder in 11.2 item 6 has nothing to grow a ceiling on. And the account-level breaker in
risks.md 2 has nothing to trip on.

That last one is the exposure that matters most, and it is not the one people expect. The shared
sender is already bounded — a burst of three a minute and two hundred a day, refused with
`sending_domain_required` — because SES scores reputation per domain and one project mailing a
scraped list puts every other such project's verification mail in spam. But **mail on a customer's
own verified domain still leaves through our SES account**, and AWS tracks bounce and complaint
rates per account as well as per domain. A bad enough account-wide rate is a review or a sending
suspension that takes mail down for every customer at once, including the ones whose own lists are
spotless. Nothing bounded that at all.

Four things make this harder than "count the bounces".

**An SES event cannot say whose it is.** A notification arrives hours after the request that
caused it, over a channel that knows nothing about it. The shared sender is one address for every
project that has verified no domain, so `mail.source` resolves nothing; no table maps a provider
message id back to a project; and the recipient belongs to the customer, not to us.

**SNS delivers at least once.** A redelivered notification is ordinary. Suppressing the same
address twice is harmless, but counting the same bounce twice is not: a rate is precisely the kind
of figure double counting breaks, and the consequence of getting it wrong is stopping a blameless
customer's password resets.

**A signature proves less than it appears to.** Anybody can create an SNS topic, subscribe our URL
to it, and publish through it — and every one of those messages carries a genuine AWS signature.

**A control that denies service can be wrong.** risks.md 7 makes this argument about the billing
controls and it applies here word for word: an automated decision to stop a customer sending,
computed from numbers produced by code, needs a way back that does not involve a deploy.

## Decision

### 1. A message carries its project as an SES message tag

`EmailProvider.dispatch` is widened to take the project id, and `SesEmailProvider` stamps
`EmailTags: [{ Name: "idenzy_project", Value: projectId }]` on every send. SES echoes message tags
on every event the configuration set publishes, under `mail.tags`.

The tag is therefore the only tenant key a delivery event will ever have, which is why it is
declared once in `@idenzy/providers-email/ses-events` and imported by both the provider that writes
it and the receiver that reads it. An event without one is recorded and counted against nobody:
guessing would suppress an address on the wrong project's list.

This is also why `configurationSet` was already mandatory on `SesOptions`. A message sent outside
a configuration set is a message whose bounce never reaches us; a message sent without the tag is
one whose bounce reaches us and cannot be attributed. Both failures are silent, and the second one
is now the reason the port's signature changed rather than a field being bolted onto
`OutboundEmail`.

### 2. The topic ARN is the check, not the signature

`SnsMessageVerifier` does three things in order, and the order is the design.

The **topic ARN** is checked first, against a configured allowlist, because it is free and it is
the check the signature does not make. A valid signature proves a message came from *an* SNS topic;
the ARN is what makes it ours.

The **signing certificate URL** is validated before it is fetched: https, and a host matching
`^sns\.[a-z0-9-]+\.amazonaws\.com$`, anchored at both ends. A certificate URL taken at face value
turns verification into "fetch a key from whoever sent this, then confirm they signed their own
message", which every forgery passes. The anchoring matters on its own:
`sns.eu-west-1.amazonaws.com.evil.test` contains the host we wanted.

Only then is the **signature** checked, against the canonical string for that message type — the
field list and its order are part of what was signed, so a `SubscriptionConfirmation` verified as a
`Notification` verifies against nothing.

Confirming a subscription is a separate class from verifying one, because confirming is an action
and the judgement has to come first. Confirming an unverified message subscribes us to a stranger's
topic, after which everything they publish arrives carrying a real AWS signature and passes every
check above.

### 3. The event ledger keeps no payload

`email_provider_events` mirrors `payment_provider_events` — provider, provider event id, type,
received/processed timestamps — and the unique index on `(provider, provider_event_id)` is the
idempotency check rather than something done before one. A lookup followed by an insert has a
window two concurrent deliveries both pass; the index does not.

It **diverges in keeping no payload**, and that is deliberate. `payment_provider_events` stores the
provider's verbatim body because a disputed charge is reconciled against it and a re-serialised
copy is not evidence of anything. A bounce is not evidence anybody will dispute, and its payload
carries the recipient address and a `diagnosticCode` that usually repeats it. Storing it would put
personal data in a table for a purpose that does not survive being asked what it is — and give that
table a declared retention that something then has to honour. What is kept instead is the verdict:
`bounce_type` and `bounce_sub_type`, enumerated, not identifying, and all that the suppression
decision and the breaker ever read.

### 4. The breaker is evaluated by a worker and read on the send path

`EmailReputationBreaker` runs in `apps/workers` every five minutes, beside the drawdown and the
sweepers. It reads a seven-day window per project and opens a row in `email_sending_holds` when the
bounce rate reaches 5% or the complaint rate reaches 0.1% — **AWS's own at-risk thresholds**. We
trip where AWS starts looking rather than where it acts, because what it reviews is the account,
and by the time the account-wide figure is bad the damage is already shared.

Below **200 observed sends in the window** no rate is actionable. Two bounces out of five is 40%
and means nothing; without a floor the breaker's first act on a new project would be to close it
over one undeliverable test address.

The send path reads the hold in `DatabaseUsageMeter.assertWithinQuota` and refuses with
`sending_paused` — **before** the dashboard carve-out and before the verified-domain carve-out.
Both of those are exemptions from the sandbox *allowance* and from nothing else. Our own dashboard
sends through the same SES account as every customer.

Splitting evaluation from enforcement buys three things. The send path stays one indexed read
instead of a seven-day aggregate. The refusal is a record carrying the figures that caused it, at
the moment they caused it, rather than a number that has since moved. And a hold is a row a person
can release, which is the way back risks.md 7 asks for.

### 5. The breaker looks at the projects it is holding, not only the ones that are sending

A held project sends nothing, so it produces no delivery events, so within a window it has no
recent rows at all. A breaker that only read "projects with recent activity" could open a hold and
then never see that project again to release it — held forever, over a week that had long since
rolled past.

So `projects_for_email_reputation` returns the union of projects with recent stats and projects
with an open hold. The release path is then the honest one: the bad days age out of the window,
nothing has to improve on them, and the hold lifts on its own.

## Consequences

Two panel screens stop saying the pipeline is unbuilt. `notes/email-suppressions.md`'s P1 findings
were written against a list nothing wrote to, and the capability badge now keys on whether events
are recorded rather than on whether every row on the page is built — because that is the half that
decides what an answer on the page is worth. The delivered/bounced/complained figures on
`notes/email-domains.md`'s screen still answer a dash: they are measured now, and no endpoint
serves them yet. That is a smaller and more honest gap than the one it replaces.

`email_delivery_stats` computes both halves of every rate from one table rather than against
`usage_daily.emails_sent`. The meter counts what we handed to SES; this counts what SES told us
about, and a rate across the two would move whenever the pipeline lagged rather than when a
customer's list got worse.

Neither new table grants `DELETE` to the app role. Both age out through SECURITY DEFINER functions
driven by `EmailRetentionSweeper`, which ships in the same change as the tables — a declared
retention with no sweeper behind it is the bug `docs/guide/backend.md` records against the usage
rollups, where the published answer was ninety days and the real one was forever.

The warm-up ladder of PROJECT.md 11.2 item 6 is now buildable and is still not built. It has what
it needs: a per-project bounce rate over a rolling window.

What this does **not** close is the account-level figure itself. The breaker bounds each project's
contribution to it; nothing yet reads the account's own reputation from SES and reacts to it. That
remains the honest residue and risks.md records it as such.

## Alternatives rejected

- **Resolve the project from the recipient or the sending identity.** Neither can. The shared
  sender is one address for many projects, and the recipient is the customer's user, who may exist
  under several projects at once.
- **Store a message-id to project mapping at send time.** A row per email, on the send path, to
  answer a question a tag answers for free — and one whose retention would have to outlive every
  bounce that could still arrive.
- **Recompute the rate on every send.** A seven-day aggregate on the hot path of every message,
  and a refusal that can only quote whatever the figure is now rather than what stopped the
  project. It also leaves nothing for a person to release.
- **Trip at AWS's suspension thresholds rather than its review ones.** By the time the account is
  at 10% bounces the review has already happened, and it happened to everybody.
- **Put the receiver on `auth-api` or `management-api`.** PROJECT.md 11.2 names an `email-events`
  worker, and `apps/workers` already has the HTTP surface for exactly this shape of caller. SNS is
  not a customer and not the panel, which is the line `InternalServer`'s own docstring draws.
- **Skip the idempotency ledger and rely on the suppression insert being idempotent.** It is, and
  the counters are not. The rate is the thing a redelivery would corrupt.
