# ADR-0009: The revocation set is a published snapshot, not a lookup service

- Status: accepted
- Date: 2026-09-03

## Context

An access token is verified offline against a cached JWKS, which is what makes a server-rendered
page for a signed-in user cost no round trip (PROJECT.md 4.3). The price is stated where it is
charged: an offline verifier cannot see a session revoked in the last few minutes, so a revoked
session keeps working until its access token expires. PROJECT.md 4.2 already commits to the
remedy: a revocation set of session ids revoked in the last max-TTL window, cached in Valkey and
exposed on a signed endpoint. It sketched that endpoint as cacheable, which this record revises.

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

The auth API maintains the set in Valkey per project. A signed endpoint, reachable only with the
project's secret key, serves the whole current set. A server SDK polls that endpoint on a timer
and checks an in-process replica, so a revocation check on the request path is a hash lookup with
no I/O.

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
304, so a customer running five hundred pollers costs us five hundred conditional requests and
almost no bytes.

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
durable record exists whatever Valkey does. `RevocationReconciler` in the workers replays those
events into the set on a timer.

That makes the synchronous write an optimisation on top of a transactional guarantee rather than
the guarantee itself: a Valkey blip delays propagation to the reconciler's next pass instead of
losing the revocation permanently.

The stronger reason is not a failed write at all. **Valkey is a cache.** A restart empties every
project's set, and because the published snapshot is served from that set, every customer polling
it would be told that nothing is revoked. Nothing in the request path would notice, because
nothing in the request path reads the set: our own guard reads the session row. Without the
reconciler, a routine cache restart silently opens the exact window this whole design exists to
close.

**It sweeps a window rather than following a cursor**, and that falls out of a property worth
naming. The set is keyed by the *instant of the revocation*, taken from the event, not by the
instant of the write. Replaying an event therefore lands on the entry it already wrote, so a
sweep is idempotent and an entry still ages out on schedule. Keying by write time instead would
push every entry's expiry forward on every pass, and a set bounded by retention would become a
set bounded by nothing.

A window also keeps the reconciler out of the outbox's own `published_at`, which belongs to the
relay that will drain this table to Pub/Sub. Two consumers sharing one watermark is a bug waiting
for the second consumer to be written.

The read crosses tenants, which RLS forbids by construction: a relay serves every project and
has no `app.project_id`. The narrow fix is the one migration 0002 already used for project
resolution, a SECURITY DEFINER function scoped to exactly this read. `revocation_events_since`
returns two topics and nothing else, so it cannot become a way to read every event any project
has emitted, and there is a test that fails if that filter is removed.

### A secret key, not a public URL

PROJECT.md 4.2 sketched this as a *cacheable* endpoint, which reads as public. It cannot be.

The payload names users whose sessions were all ended, and when. A project id is not a secret:
it is the `aud` of every access token we sign, so it reaches every browser the customer serves.
A public endpoint addressed by project id would therefore let anyone who has ever held one token
poll that project's revocation stream indefinitely and watch its users' security events. That is
a surveillance channel handed out with every sign-in.

So it takes the project's secret key on `Authorization`, which the existing tenant guard already
resolves and already records as the one credential that is a machine acting rather than an
application being used. A publishable key is refused: that is the key that reaches browsers, and
it is the whole reason the endpoint cannot be public.

The cost is that a shared CDN cannot serve it, so the fan-out lands on our origin. An `ETag` over
the content is what makes that affordable: a poll that finds nothing changed is a 304 with no
body and no signature, which is the common case by a wide margin. The response is
`Cache-Control: private`, because a shared cache keyed on the URL would serve one project's set
to another project's key.

### It is signed as well as authenticated

TLS ends wherever the customer terminates it, and a private cache is still a cache. The signature
is what makes the payload's origin checkable at the SDK rather than at the last hop.

It is a JWS signed with the project's own ES256 key, so an SDK verifies it with the JWKS it
already caches: no new key material, no second trust root, no new verification path to get wrong.

That reuse creates the one hazard worth naming. The same key signs access tokens, so a signature
alone does not say which kind of statement is in hand. Two things separate them. A snapshot
carries a `typ` that is not `JWT`, and both access-token verifiers now require `JWT`. And the
issuer refuses to put `sub` or `sid` in a statement at all, so a snapshot cannot be shaped like a
credential even if some future verifier forgets to check the media type.

It carries `iat` and `exp`. Without an expiry, anything on the path could pin one snapshot
forever and revocation would silently stop working with nothing observable from either end. With
one, a frozen snapshot becomes a stale snapshot, which is a state the SDK can see and act on.

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
- The reconciler sweeps every project's window on each pass rather than only what changed. That
  is affordable because the window is small by construction, and it is what makes the sweep
  stateless. If it ever stops being affordable, the answer is a longer interval before it is a
  cursor, because a cursor reintroduces the state a window exists to avoid.
- Consuming the set stays opt-in in the server SDKs. A customer who does not turn it on keeps a
  package that makes no network call of its own, which is what `@idenzy/node` documents today.
- Turning it on means giving a server SDK a secret key, which it does not need for anything else.
  That is a real addition to what a customer configures, and it is server-side only: a secret key
  in a browser bundle is the mistake the publishable key exists to prevent.
- If origin fan-out ever becomes the constraint, the escape hatch is a short-lived signed URL
  rather than making the endpoint public, because the leak is in the payload and not the
  transport.
- No certification is claimed anywhere here. This is an architecture decision, not a control
  (PROJECT.md 4.13.10).
