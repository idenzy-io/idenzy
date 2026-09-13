# ADR-0012: Webhook delivery is a queue, not a log

- Status: accepted
- Date: 2026-09-13

## Context

PROJECT.md 3.2 promises webhooks that are "HMAC-signed, retried, replay-safe", and the panel's
`/webhooks` screen already documents the whole customer-facing contract: the header names, the
signed string, a 300-second tolerance, a 24-hour rotation overlap, a retry schedule running from
ten seconds to a day, and thirteen event types. What has never existed is the half that sends
anything. `notes/webhooks.md` says so on the screen rather than pretending, and it carries two P1
findings that are ours to answer here.

The first is custody. `webhooks.secret_hash` in PROJECT.md 12 stores a digest, and a digest
cannot sign. The note is precise about the distinction that was being confused: *unable to
re-reveal* and *unable to sign* are different properties, and only the first is a promise worth
making.

The second is scale, and it is the reason this is an ADR rather than a commit. Take the shape the
business plan aims at: **1000 projects and 10M MAU in one cell**. Sign-ins dominate every other
event, and at four sign-ins per monthly active user that is 40M `session.created` a month before
account, delivery and security events. Assume half of all projects subscribe to the busy events
with 1.2 endpoints each, and the design target is **100M deliveries a month**: 38 a second on
average, and with the usual diurnal shape around 400 a second at peak.

The reflex design — a row per delivery, a row per attempt, retained for thirty days, with a poller
sweeping the table — is the one every naive implementation reaches for, and at this volume it is
the expensive half of the feature by an order of magnitude.

## Decision

**Cloud Tasks is a timer. Postgres holds the work still to do. The history of what happened does
not live in the authentication database.**

Concretely:

1. **One outbox row per event**, written in the transaction that caused it, exactly as today
   (PROJECT.md 9.4). A flow does not know what endpoints exist.
2. **Fan-out is the relay's job.** A worker drains the `webhook` topic off `outbox.seq` with its
   own watermark — the shape `AuditRelay` already uses — reads the project's enabled endpoints
   from Valkey (cache-aside, invalidated on write), and creates one **delivery** per matching
   endpoint. Delivery is the unit the customer sees, and its id is stable across every attempt.
3. **The first attempt is inline**, from the relay's own bounded concurrency pool. The batch is
   already in hand; handing it to a queue to hand back costs a task, a request and a scheduling
   round trip to arrive at the same HTTP call.
4. **Retries are Cloud Tasks**, one task per attempt, `scheduleTime` set from our own published
   schedule, targeting an OIDC-authenticated dispatcher endpoint on the workers service. The
   dispatcher always answers 200 and schedules the next attempt itself, so the queue's own retry
   policy never competes with ours.
5. **A delivery row exists while the delivery is open**, and carries its payload while it might
   still be sent. The payload is cleared when a delivery is **delivered**; a **failed** one keeps it
   until the window drops the row, because a replay has to send the body it was signed from and
   clearing it on either outcome made the replay route impossible to honour. The row is summarised
   into the delivery window, and counters move. The table is bounded by work in flight plus the
   failures of the last three days, not by traffic ever served.
6. **The signing secret is encrypted, not hashed.** `FieldEncryptor` with the project's own data
   key and the project id as additional authenticated data, which is what `provider_credentials`
   and TOTP secrets already use (PROJECT.md 4.13.4). This revises PROJECT.md 12's `secret_hash`.

## Rationale

### Why Cloud Tasks for the retry lane and not Pub/Sub

Pub/Sub has no per-message delay. The subscriber-side remedies are a nack with backoff, which is
capped well below our schedule, or a topic per delay tier, which is a fan of topics whose only
purpose is to encode seven numbers. Cloud Tasks takes `scheduleTime` up to thirty days, which is
the whole of what the retry lane needs, and it bills per operation rather than per hour.

PROJECT.md 6.2 already made this call ("per-task retry with backoff for webhooks"). What is new
here is that the *first* attempt does not go through it, and that the queue does not own the
schedule.

### The first attempt is inline because the queue is the expensive part of the cheap path

At the design volume, putting every delivery through Cloud Tasks and a Cloud Run request costs
about **$40 in task operations and $40 in request fees a month** before any compute, to move work
the relay was already holding. Keeping the first attempt inline and queueing only what fails
takes that to a few dollars, because a few per cent of deliveries fail:

| Item at 100M deliveries/month | Monthly |
|---|---|
| Egress, ~1 KB per delivery, 100 GB at list price | ~$12 |
| Cloud Tasks: retries only, ~6M operations after the free tier | ~$2 |
| Cloud Run requests for the retry dispatcher, ~6M | ~$3 |
| CPU for signing: HMAC-SHA256 over 1 KB is microseconds, 100M of them is ~200 vCPU-seconds | rounding error |
| **Marginal cost of the pipeline** | **under $20** |

Egress is the largest line and it is irreducible: we are being paid to make HTTP requests. That is
the sentence to keep hold of — **a correctly shaped webhook pipeline at 10M MAU costs tens of
dollars a month**, and any design whose bill is materially above that is paying for bookkeeping
rather than delivery.

The signing cost deserves one line because it is the intuition people get wrong: HMAC is not
where the money goes. A thousand-byte HMAC-SHA256 is a couple of microseconds, so the entire
month's signatures are a few CPU-minutes. Delivery cost is network wait, which is why the answer
is concurrency, not cores.

### What a log of every delivery would actually cost

A row per delivery carrying its payload is around 600 bytes; with indexes, call it 900. At 100M a
month and the thirty-day retention PROJECT.md 12 sketches, that is **~90 GB live on the HA primary
plus backup and PITR copies of it**, which is real money but not the objection. The objections are
these:

- It is 38 sustained writes a second, 400 at peak, of jsonb, onto **the instance that
  authenticates users**. Webhook debugging history and sign-in latency would share IOPS, a buffer
  pool and an autovacuum budget, and the failure mode is that a customer's traffic spike makes
  everybody's sign-ins slower.
- Deleting 100M rows a month is a vacuum problem, not a `DELETE`. It wants partitions, and once it
  has partitions it wants a retention job, and both exist to manage data nobody reads after a day.
- Cloud SQL is the most expensive store per byte we operate, and this is the least valuable byte
  we hold: a record that a 200 came back.

So the delivery table holds **open** deliveries. Terminal deliveries are summarised into a window
that is partitioned by day and dropped by partition — 72 hours, which is the horizon somebody
debugging a webhook actually works in — and the long history belongs in the analytics store the
logging track already decided on (ClickHouse, per todo.md 3.2). Health figures are Valkey counters
rolled up daily per endpoint, so the strip on the screen never scans the window at all.

The crossover to state plainly: the Postgres window is right up to roughly 10M deliveries a day.
Past that the window moves to the analytics store and Postgres keeps only the queue.

### Clearing the payload once a delivery is taken is a compliance improvement, not a compromise

An event payload names a user, their address, sometimes their device. It is classified `Pii` with
`Retention.Days30` today because the sketch assumed a thirty-day log. Holding it only until a
delivery is taken — and for failures, only until the window drops them — is strictly less exposure
for the same feature, and it removes a copy of user data from the erasure path: a data-subject
deletion would otherwise have to reach into thirty days of webhook payloads to be complete
(PROJECT.md 4.13.6). The successful case is the overwhelming majority, and it is the one that keeps
nothing.

What the window keeps is the evidence a developer needs and nothing they do not: the event type,
the endpoint, the status code, the duration, the attempt number, and a response excerpt capped at
2 KB. The excerpt is the customer's own bytes coming back, which is why it is capped and why it is
classified rather than logged.

### One slow customer must not slow anybody else

1000 customers is not 1000 queues. A fixed pool of eight Cloud Tasks queues, sharded by endpoint
id, gives per-queue dispatch ceilings without per-tenant infrastructure. Two rules do the rest:

- **A per-endpoint in-flight cap** in Valkey, so one endpoint cannot hold the pool.
- **A short inline timeout, five seconds, against fifteen on the retry lane.** An endpoint slower
  than that falls into the retry lane instead of occupying a slot on the fast path. The customer
  sees a delivery that took two attempts; everybody else sees nothing.

The circuit breaker is the panel's existing number: twenty consecutive failures disables the
endpoint with a reason the screen can state. An endpoint that is down for an afternoon is a retry
schedule; one that is gone is a configuration error, and continuing to call it for a week is how a
pipeline turns into a DDoS with our name on it.

### The secret is encrypted because signing needs it, and we still only show it once

Envelope encryption with the per-project data key gives us both properties the note asks to be
separated. We **can** sign, because the ciphertext decrypts. We **do not** re-reveal, because the
management API has no route that returns it and the audit trail would record one if it did. And a
database backup is not a set of live signing keys, which is what the digest was reaching for.

Rotation is two secrets in force at once for 24 hours, both signing every delivery, newest first
in the header. That is why the header is a list: a customer redeploys their verifier inside the
window and neither secret's deliveries fail. The old secret's ciphertext is cleared when the
window closes, and the panel already documents the deadline.

### Replay safety is the timestamp being signed, plus an id the customer can dedupe on

The signature covers `${timestamp}.${rawBody}`, so a captured request cannot have its timestamp
moved without breaking the digest, and a receiver refusing a timestamp outside 300 seconds turns
an authentic-forever signature into one that expires. That check is the customer's to make, which
is why the verifier ships in the SDK rather than being described in prose: a documented example
that cannot verify its own documented request is the first finding in the note.

At-least-once and unordered, said out loud. A crash between the POST and the write records
nothing, so a delivery can arrive twice; `X-Idenzy-Delivery` is stable across attempts so the
receiver can dedupe, and the envelope carries the event's `sequence` so a receiver that cares
about order can sort rather than assume. Promising exactly-once here would be promising something
no HTTP call can give.

### The endpoint URL is an SSRF surface, and the response excerpt is why it is sharper than usual

We make an HTTPS request to a string a customer typed, and we show them part of the answer. That
is a read primitive against our own network if the string is allowed to name one: a metadata
address, a private range, a loopback. So `webhookUrlSchema` takes https only, refuses userinfo, a
fragment, and any literal loopback, private, link-local, unique-local or metadata host — checked
in the protocol schema, so the panel refuses it while it is typed and the API refuses it whatever
the panel did.

The residual worth naming rather than hiding: a hostname that resolves to a private address is
not caught by parsing, and DNS can change between the check and the call. The mitigation belongs
at delivery time — resolve, refuse non-public answers, connect to the address we resolved — and
until the dispatcher does that, this is a known gap rather than a closed one. It is listed in
todo.md as such.

## Consequences

- The webhook pipeline's marginal cost at 10M MAU is tens of dollars a month, dominated by egress.
  The cost of the feature is its history, and that is the part we deliberately do not keep in
  Cloud SQL.
- `webhooks.secret_hash` is replaced by an encrypted secret plus rotation columns, and PROJECT.md
  12's sketch of that table is superseded here.
- `webhook_deliveries` becomes a working set plus a 72-hour partitioned window. A customer asking
  "what happened three weeks ago" is answered by the analytics store when it exists, and until
  then is answered honestly: we do not keep it.
- The panel's `/webhooks` screen can stop describing delivery as unavailable, but not all at once:
  health figures come from rollups, the failure table from the window, and "send a test event" and
  "retry" become real once the dispatcher exists. Its own copy of the contract moves to
  `@idenzy/protocol` so the panel, the server and the SDK cannot drift.
- Ordering is not offered. A customer who needs it sorts on `sequence`, and the docs example does.
- The retry schedule is ours and published, so changing it is a documented change rather than a
  queue setting somebody edits in a console.
- Nothing here is a certification claim (PROJECT.md 4.13.10). The payload retention change is a
  smaller exposure, not a control.
