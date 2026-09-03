# ADR-0009: The revocation set is a published snapshot, not a lookup service

- Status: accepted
- Date: 2026-09-03

## Context

An access token is verified offline against a cached JWKS, which is what makes a server-rendered
page for a signed-in user cost no round trip (PROJECT.md 4.3). The price is stated where it is
charged: an offline verifier cannot see a session revoked in the last few minutes, so a revoked
session keeps working until its access token expires. PROJECT.md 4.2 already commits to the
remedy, a revocation set of session ids revoked in the last max-TTL window, cached in Valkey and
exposed on a signed cacheable endpoint.

`RevocationSet` exists in `@idenzy/cache`. Nothing constructs a Valkey client and nothing calls
it, so the set is empty in every environment and no revocation has ever reached it.

Two facts shape what to build, and both were wrong in our first plan.

**Our own API does not need it.** `SessionGuard` reads the session row on every authenticated
request, so revocation already takes effect immediately for our endpoints. The set is not a fix
for us. It is a fix for the customer's verifier, which is offline on purpose.

**The customer cannot be given a lookup.** A revocation check on their request path that reached
our Valkey would put our latency and our availability inside their request, which is the exact
property offline verification exists to sell. Any design that costs a network call per request
is a worse product than the problem it solves.

## Decision

**We publish the set. We do not answer questions about it.**

The auth API maintains the set in Valkey per project. A signed, cacheable endpoint serves the
whole current set. A server SDK polls that endpoint on a timer and checks an in-process replica,
so a revocation check on the request path is a hash lookup with no I/O.

Three kinds of entry, because one shape cannot carry all three cases:

- a **session id**, for revoking one session;
- a **user watermark**, `revokedBefore`, compared against the token's `iat`, for signing out
  everywhere and for a password reset;
- a **project watermark**, same comparison, for a key compromise or a breach.

Watermarks exist because writing one entry per session does not bound. A user with forty devices
would write forty entries, and a project-wide kill would write every session the project has.

Entries are retained for the access token lifetime plus clock skew, and no longer. A token minted
one millisecond before a revocation expires at most one lifetime later, so nothing older can
still be presented. That retention is what keeps the set small enough to publish whole.

## Rationale

### A snapshot, not a delta feed

A cursor feed of revocation events is the reflex, and it is the wrong shape here. Because entries
expire on their own, the set is small: it holds only what was revoked in the last few minutes, so
even a large project is hundreds to low thousands of ids. Publishing the whole thing every time
means there is no cursor to drift, no missed event to recover, no ordering to guarantee, and a
poll that fails costs nothing because the next one is complete. `ETag` makes an unchanged set a
304, and the edge absorbs the fan-out, so a customer running five hundred instances does not
reach our origin.

A delta feed would buy bytes we are not short of and cost correctness we would have to prove.

### The failure directions are not symmetric, and they decide the write ordering

A **missed** revocation degrades to exactly today's documented behaviour: the token dies at
expiry. The customer is no worse off than before the set existed.

A **false** revocation is worse than it first looks. The set is keyed by session id, and
refreshing does not change the session id: the client rotates its refresh token, gets a new
access token, and presents the same `sid`. So a spurious entry locks that user out of the
customer's backend for the whole retention window, and nothing the client does can clear it.
Signing in again would, but the user has no way to know that is the remedy.

So the two are not to be traded off against each other. **Never write to the set before the
database transaction commits.** A write that precedes the commit can revoke a session that the
transaction then rolls back. Write after, where a failure costs propagation speed rather than
somebody's session.

### The outbox is the durable path and the direct write is the fast one

Writing to Valkey after a commit is a dual write, and dual writes lose. Every revocation site
already enqueues `session.revoked` inside the same transaction as the revocation itself, so the
durable record exists whatever Valkey does. A worker replays those events into the set.

That makes the synchronous write an optimisation on top of a transactional guarantee rather than
the guarantee itself: a Valkey blip delays propagation to the worker's next pass instead of
losing the revocation permanently. Writing it any other way would mean a revocation could be
absent from the set with nothing left to notice it.

### The snapshot is signed because it is cacheable

Cacheable means a CDN, a proxy, or somebody on the path can serve an old copy. Without a
signature they could serve any copy. That is the attack this endpoint invites and it has to be
closed at the payload, not at the transport.

It is a JWS signed with the project's own ES256 key, so an SDK verifies it with the JWKS it
already caches: no new key material, no second trust root, no new verification path to get wrong.

It carries `iat` and `exp`. Without an expiry, an attacker who controls the cache could pin one
snapshot forever and revocation would silently stop working with nothing observable from either
end. With one, a frozen snapshot becomes a stale snapshot, which is a state the SDK can see and
act on.

### A stale replica is a third state

The same rule the JWKS path already keeps: `JWKSTimeout` is rethrown as itself rather than
becoming an invalid token, and `protectRoutes` answers 503 rather than redirecting, because
authorisation code told "no claims" when the truth is "cannot tell" refuses the right people for
the wrong reason.

So a replica the SDK could not refresh is stale, not empty. The default is to keep verifying,
because the token is cryptographically valid and the exposure is bounded by its lifetime anyway,
which is the guarantee the customer had before they turned the feature on. The SDK exposes the
snapshot's age so a customer who would rather fail closed can. What it must never do is throw
from verification over a stale replica: that converts our outage into theirs, on every request,
which is worse than the revocation delay it was avoiding.

Reads on our side fail open too, and for a different reason: the session row is the authority in
our own API, so the set is only ever an accelerator there.

## Consequences

- Revocation reaches a customer's backend in poll interval plus edge TTL, seconds rather than up
  to the token lifetime. Customers who want it faster still set a shorter TTL, unchanged.
- The set is bounded by revocations per retention window, not by anything cumulative. It cannot
  grow with tenure.
- Retention is derived from the configured access token lifetime. When per-project lifetimes
  land (PROJECT.md 4.2), retention becomes the project's own, since the set is already keyed per
  project.
- The set is per cell. A revocation must reach the cell the customer polls, so replication lag
  between cells is part of the propagation number we advertise and not a detail below it.
- Consuming the set stays opt-in in the server SDKs. A customer who does not turn it on keeps a
  package that makes no network call of its own, which is what `@idenzy/node` documents today.
- No certification is claimed anywhere here. This is an architecture decision, not a control
  (PROJECT.md 4.13.10).
