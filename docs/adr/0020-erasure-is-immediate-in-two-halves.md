# ADR-0020: An erasure is immediate, in two halves

- Status: accepted
- Date: 2026-10-11

## Context

PROJECT.md 4.13.6 promises that a data subject can be erased, and nothing could erase one. The
pieces existed: every column says what an erasure does to it (`classified()`), the subject fields
are generated from that, `data_subject_requests` has a table, and `retention_tombstone_users` would
strip an account whose `deleted_at` was old enough. Nothing wrote `deleted_at`, nothing read the
generated field lists, and the panel's Delete button refused with "not built".

The customers who need this first are applications deleting an account because their own user
asked them to. By the time they call us the decision is made, so the design question is not
whether to wait but what "erased" has to cover, and how fast each part of it can honestly be done.

An account's data lives in three kinds of place. The account itself and every way back into it
are rows in Postgres, keyed on the user. Copies of some of it were made on the way through other
parts of the system: outbox events and webhook deliveries carry an address or the network a
sign-in came from, and ClickHouse holds every authentication event keyed on the user. And the
audit trail holds the pseudonymous id, the address an action came from, and what was done.

## Decision

**Immediate, with no grace window.** A soft delete that keeps the person's data for thirty days in
case somebody changes their mind is a retention period with no purpose behind it, and the product
that asked has already decided.

**The first half is one transaction.** `erase_user` tombstones the account (the row stays, because
the trail points at its id), deletes every identity, factor, passkey, recovery code, challenge,
code, token, link and flow, clears and revokes every session, and deletes their refresh tokens. In
the same transaction: `session.revoked` (scope all), `user.deleted`, an audit entry and a completed
`data_subject_requests` row. The user's revocation watermark is published after the commit, so an
access token already issued stops verifying offline within a poll. When the request returns, the
person cannot sign in, nothing they held works, and no row in the primary store names them.

**The second half is the copies, a minute later.** `UserErasureRelay` follows `user.deleted` and,
per target with its own position, strips the personal fields from the erased user's outbox events
and open webhook deliveries, and deletes their ClickHouse rows with a mutation. It waits on purpose:
a copy still on its way when the erasure committed (a fan-out in flight, an event still queued for
ingestion) would otherwise arrive afterwards and outlive the erasure. Analytics waits for the
ingest stream to drain past the erasure instead of guessing a delay.

**The audit trail keeps what it keeps.** The actor id, address and user agent on `audit_events`
are retained as proof the erasure was performed (Art. 17(3)(b)), which is their classification
already, and the hash chain leaves `ip` and `ua` outside the digest for exactly the day a lawful
pseudonymisation needs them changed.

**The SQL is held to the classification.** `erase_user` names its tables and columns, and a test
reads the function and requires every end-user table with something to erase to be deleted from,
or updated with exactly its classified erasure columns. Tables whose rows belong to a user now
declare that as their `subject`, which is what puts them in the test's view.

**One answer for gone and never existed.** All three routes answer 404 for an unknown, malformed or
already erased id, so a retry reads as done and the id space does not confirm that somebody existed.

## Consequences

- An erasure costs index walks however large the project: migration 0012 adds the user indexes the
  short-lived tables lacked and partial expression indexes on the outbox and open deliveries. The
  outbox one is a write on its hottest insert; it is one btree entry, and the alternative was a
  scan of the whole outbox per erasure batch.
- ClickHouse gets a fourth identity, `idenzy_eraser`, with ALTER DELETE on the erasable tables and
  nothing else, granted by the migration.
- The dashboard's "sign out everywhere" now revokes the way a user's own does (refresh tokens, the
  event, the watermark). It ended the session rows and nothing else, so an offline verifier kept
  accepting the access token until it expired.
- Not covered: entries in the analytics dead-letter stream (read by a person, capped at 10,000) and
  delivered webhook attempt logs, whose payload is already gone and which can no longer be matched to
  a user; both age out in their own windows. The outbox has no retention sweep yet, which the
  stripping makes harmless for erased users but is a gap of its own.
