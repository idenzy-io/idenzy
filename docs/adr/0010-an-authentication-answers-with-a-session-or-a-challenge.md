# ADR-0010: An authentication answers with a session or a challenge, never an error

- Status: accepted
- Date: 2026-09-03

## Context

`AuthFlow` has always had a place for multi-factor: `assertMfaSatisfied` ran between `verify` and
session creation, and threw `MfaRequiredError` when a subject still owed a second factor. Nothing
set that flag, so the branch had never executed. Phase 2 turns it into a real gate, and the
question is what a sign-in that stops at a second factor actually answers with.

The constraint that shapes it is that we ship no authentication UI (ADR-0002). Every prompt is
the customer's, so whatever comes back has to be something a customer's own page can render and
act on: which factors to offer, an identifier to submit against, and a deadline. It also has to
reach eight endpoints and every SDK, because MFA is not a property of one way in.

Three shapes were considered.

**An error carrying the challenge.** `MfaRequiredError` already exists, the exception filter
already maps it, and no controller signature changes. The error body would gain an `mfa` object
beside `retryAfterSeconds`, which is precedent: that field is already present on two codes and
absent everywhere else.

**A session with nullable token fields.** One response type, `accessToken` null until the second
factor lands. Nothing in any signature changes at all.

**A discriminated union.** `authenticate` returns a session or a challenge, and every caller
branches.

## Decision

Every flow answers with a discriminated union, on the wire and in the SDK.

`AuthFlow.authenticate` returns `AuthOutcome`, which is `{ kind: "session" }` or
`{ kind: "mfa" }`. The wire shape is `authOutcomeSchema`, discriminated on `status`
(`authenticated` or `mfa_required`). `@idenzy/js` mirrors it as `AuthResult`, and the challenge
half carries a bound `submit` rather than a bare id.

The gate is an injected port, `MfaGate`, consulted where the old throw stood: after `verify`,
before the hooks and before anything that creates a session.

Every flow returns the union, including the ones that cannot currently challenge.

## Rationale

### A first factor that verified is not a failure

The error shape fails on meaning before it fails on anything else. Nothing went wrong: the user
typed the right password, the server accepted it, and the sign-in is halfway done. Modelling that
as an exception makes the normal path of every MFA-enabled sign-in a `catch` block, and puts it
in the same handler as a wrong password, a rate limit and a banned account. `@idenzy/core` has a
`Result` type precisely because expected outcomes that are not exceptional should not be thrown.

There is a second cost. `errorBodySchema` promises one shape on every endpoint, and its optional
fields are small scalars. An error carrying a factor list and a challenge id is a payload, and
the next feature that wants one would have the precedent.

### Nullable fields fail silently, which is the failure mode we are trying to remove

A session object whose `accessToken` is null compiles everywhere. A customer's page reads
`result.user`, sees a user, and navigates. The application is now on its home screen with no
token, and the failure surfaces on a later screen as a missing credential with nothing pointing
back at the sign-in that never finished. That is the same class of bug `SessionFlow.establish`
exists to prevent on the client, and choosing a shape that reintroduces it in the protocol would
be an odd thing to do.

The union does not compile. A customer who upgrades and turns MFA on finds out at their next
build, which is the earliest and cheapest moment available.

### Every flow returns it, including the ones that cannot challenge

Anonymous sign-in has no user to hold a factor. A passkey with user verification is already two
factors and the gate answers null for it. Neither can produce a challenge today.

They return the union anyway, because which flows can challenge is our decision and it changes.
A controller or a customer that branched on knowing anonymous never challenges is the one that
breaks the day a project can require a factor of every session. Uniformity here costs one
`switch` in code that already had to handle two cases somewhere.

### The gate is a port, and its position is the guarantee

Whether a subject owes a factor needs the user's enrolled factors and a challenge table, neither
of which `@idenzy/domain` may reach (PROJECT.md 8.3). So `MfaGate` is an interface, implemented
in `apps/auth-api`, injected by symbol like `FlowHooks` and `FlowAudit`.

What the base owns is where it is consulted. A flow that wanted to skip the gate would have to
stop extending `AuthFlow`, which is visible in a diff; a flow that forgot it would hand a fully
valid session to somebody who proved one factor of two.

The gate answers null in two cases and both are deliberate. A subject that already carries a
factor verification owes nothing, which is what stops a passkey ceremony being followed by a
demand for a code. And a user with nothing enrolled owes nothing, because a challenge nobody can
answer is a sign-in that cannot be completed rather than one that is refused.

## Consequences

The wire contract for eight endpoints gained a required `status` field. Nothing is published yet,
so there is no migration to write; after Changesets exists this would be a major.

`AuthenticatedSubject.requiresMfa` is gone, replaced by `factorVerifiedAt`. The direction is
reversed on purpose: a flow no longer says whether a factor is owed, which is the gate's
business, and instead says whether it proved one itself. That field is what finally feeds the
`fva` claim, which had been declared in `TokenIssuer` since Phase 0 with nothing to set it.

`@idenzy/testing` gained `sessionOf`, which narrows an outcome to the session it produced and
fails loudly otherwise. It lives there rather than in the domain deliberately: production code
that could unwrap an outcome without deciding what to do with the other half is production code
that can skip a second factor.

The starter templates had to change. Each already awaited a result it discarded, which with a
challenge in the protocol is the worst possible shape: a correct password, no session, no error,
and a page that appears to do nothing. All five now route through one `finish` and render a code
form, and `examples/` is regenerated from them.
