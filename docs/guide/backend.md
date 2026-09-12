# The server halves

The browser-facing edge, the authentication flows and everything behind them. Read
[PROJECT.md](../../PROJECT.md) 7 before changing any of it.

## Working on the browser-facing edge

Five rules, each of which is load-bearing somewhere it is not obvious.

- **Tenant resolution is first-present-wins, not a fallback chain.** Header, then
  `Authorization`, then `Host`. A header that is present but unresolvable is a hard failure;
  falling through to `Host` would let a request that named project A execute against whatever
  project the Host maps to, and nobody would notice.
- **The publishable-key header takes `pk_` only**, refused on the prefix before any lookup, so
  a real secret key and a fabricated one cost the same work and give the same answer.
- **CORS is enforced on the actual response, not the preflight.** A preflight cannot see the
  key header, so it can only be strict where `Host` names a project. An unregistered origin
  gets a normal answer with no `Access-Control-Allow-Origin`, never a 403: the refusal is the
  browser's, and a hard status would tell a prober the difference between "checked and
  refused" and "never configured".
- **Cookie mode needs a custom auth domain, and `SameSite` is why.** It is a *site* rule, so
  `app.customer.com` to `auth.customer.com` works and `app.customer.com` to the shared API host
  never will. Cookie mode is refused where it cannot work rather than granted and dropped,
  because a cookie the browser discards looks exactly like a sign-in that does nothing.
- **A route a browser *navigates* to cannot name its project.** A top-level navigation carries
  neither our header nor `Authorization`, so it resolves by `Host` alone and works only behind a
  custom auth domain. Anything a browser has to start on the shared host needs a JSON twin it
  can call and navigate itself, which is what `POST v1/auth/oauth/:provider/start` is for. The
  twin is also stricter: not being `@BrowserNavigation()`, it keeps the cross-site checks.

The cross-site checks run **before the credential is stashed on the request**. A forged request
that consumed the victim's refresh token would trip reuse detection, which revokes the whole
family: without that ordering, an attacker could sign someone out of every device by making
their browser send one request. Four routes are exempt via `@BrowserNavigation()` because
Apple form-posts its callback with its own `Origin`; they are defended by a one-shot `state`
and a single-use code instead.

## Adding an authentication flow

Extend `AuthFlow` in `@idenzy/domain` and implement `verify` only. The base owns MFA
gating, hook invocation, session creation and audit ordering, and a flow that wanted to
skip any of them would have to stop extending it, which is visible in a diff. Sign-up is
an `AuthFlow` too: establishing the subject there means creating them.

`verify` returns an `AuthenticatedSubject`, whose `factorVerifiedAt` says whether the flow
itself proved a factor rather than whether one is owed. That is the gate's business, and
`authenticate` therefore returns a session *or* a challenge (ADR-0010).

`FlowHooks` and `FlowAudit` are interfaces, so they are injected with the symbol tokens
in `apps/auth-api/src/flows/flow-tokens.ts` rather than by type.

Anything security-critical needs a test that asserts the attack fails (PROJECT.md 7.4),
not only that the happy path works. The existing ones are the models: refresh reuse
revoking the family, revoking a stranger's session answering 404, and a missing user
costing the same Argon2 work as a wrong password.

## Working on the second factor

Five rules, and the first one is the shape everything else hangs off.

- **An authentication ends in a session or a challenge, and never an error** (ADR-0010).
  `AuthFlow.authenticate` returns a union, the wire discriminates on `status`, and `@idenzy/js`
  mirrors it as `AuthResult`. A first factor that verified is not a failure: modelling it as one
  would put the normal path of every MFA sign-in in the same `catch` as a wrong password, and a
  session object with a nullable token compiles everywhere and fails on a later screen. Every
  flow returns it, including the ones that cannot challenge, because which those are is our
  decision and it changes.
- **The gate decides, not the flow.** `MfaGate` is consulted where the old throw stood: after
  `verify`, before the hooks, before anything that creates a session. It answers null for a
  subject that already carries a `factorVerifiedAt`, which is what stops a passkey ceremony
  being followed by a demand for a code, and null for a user with nothing enrolled, because a
  challenge nobody can answer is a sign-in that cannot be completed rather than one refused.
- **One refusal, whatever went wrong.** `MfaFactor.check` returns a boolean and only the base
  throws, so a wrong code, a spent step, a crossed-off recovery code and a factor the user never
  enrolled are indistinguishable. Everyone who reaches a challenge has already got past a first
  factor, which is exactly where a stolen password puts an attacker.
- **A proof is not a string, and holding a factor is not owing one.** `check` takes the
  protocol's discriminated union, because a passkey assertion is not a code; every factor
  refuses a proof meant for another in its first line, which is both the guard and the
  narrowing. And `demandsChallenge` is separate from `enrolled`: an authenticator turns MFA on
  for the account, a passkey and a recovery code only answer a challenge something else
  demanded. Collapsing the two would make enrolling a passkey a change to every password
  sign-in on that account.
- **A TOTP code is spent by writing its step back.** `Totp.verify` returns the step rather than a
  boolean for that reason: a code is valid for its whole thirty seconds, so the only defence
  against one read over a shoulder is refusing a step already used. The counter moves with a
  `greatest()` guard, because two requests inside one step would otherwise let the second write
  it back down.
- **A recovery code is spent scoped to its user, never looked up by digest.** They are compared
  by value, so a lookup on the digest alone would sign the caller in as whoever owned the code.
  They are 100 bits, which is what makes SHA-256 defensible where a six-digit OTP needs Argon2id;
  Argon2id could not be used here anyway, because a submitted code is checked against every
  unspent code the user holds.

Two more things are easy to get wrong by accident. Recovery codes go with the last factor when
it is removed: ten single-use passwords must not outlive the thing they were the fallback for,
on an account whose owner believes they turned MFA off. And a step-up challenge is pinned to the
session it was minted in as well as to the user, or a device that proved nothing inherits a proof
made somewhere else.

`assertRecent` is called from the service performing the action rather than from a guard. A guard
would have to run after `SessionGuard`, and getting that order wrong is a silent bypass rather
than a loud failure. It lets a user with nothing enrolled past, which is the honest shape of the
guarantee: the check is worth exactly as much as the second factor behind it.

## Touching the passkey ceremonies

Five rules, each of which is load-bearing somewhere it is not written.

- **Authentication options take no identifier and name no credential.** An endpoint that
  accepted an email would answer differently for an address with passkeys and one without,
  which is an enumeration oracle in front of the flow we promote as the default.
- **`residentKey: required` at registration is what pays for that**, and the coupling
  crosses two endpoints. Relax it and sign-in has nothing discoverable to offer, so the
  usernameless flow quietly stops working for credentials enrolled after the change.
- **The challenge is claimed before anything is verified, not after.** `claim` reads and
  consumes in one statement and returns the row. A nonce burnt only on success is one an
  attacker can keep signing against.
- **Do not re-implement the sign-counter check.** It lives inside
  `verifyAuthenticationResponse`, throws rather than returns, and fires before we would see
  the new value. What is ours is writing the counter back: a value never stored leaves a
  comparison that always passes and a replayed assertion that works forever.
- **`pubKeyCredParams` and `supportedAlgorithmIDs` are the same list**, passed explicitly
  in both directions. Advertising an algorithm the verifier rejects enrols an authenticator
  that can never sign in, and it fails on the user's next visit rather than at enrolment.

The relying party is per project and read from `webauthn_relying_parties`, never derived
from the request Host: the RP ID decides which credentials an assertion may address. One
row per project, enforced by a unique index, because a credential is bound to the RP ID it
was created under and two would split a customer's passkeys into disjoint sets.

Tests use `TestAuthenticator` from `@idenzy/testing`, which is a real software
authenticator: a real P-256 key, real CBOR, a real signature. That is deliberate. Every
attack worth testing here (replayed challenge, cloned counter, wrong origin, another
tenant's credential) is one a fake verifier would happily accept.

## Working on claim templates

What a project's access tokens carry beyond the claims we assemble ourselves. Five rules.

- **The claimable user fields are an allowlist, and it is `publicUserSchema`.** A column
  added to `users` tomorrow is not publishable until somebody adds it to
  `CLAIMABLE_USER_FIELDS`, and `satisfies readonly (keyof PublicUser)[]` is what stops that
  list drifting from the profile endpoint. A denylist would have made a password hash
  claimable the day it was forgotten.
- **The reserved names live in `@idenzy/protocol`.** A dashboard validating a template and
  the issuer applying it check the same list, because the alternative is a template somebody
  can save and never use.
- **A required claim that resolves to nothing fails the issue.** A claim an authorisation
  check branches on is one where absent and false read the same, so emitting the token
  without it would let a sign-in through a check that never ran. Absent, never `null`: a
  verifier reading `null` has to decide what it means and every one of them decides
  differently.
- **The bytes are capped twice.** A save sees only names, and a render is the first thing
  that sees a value: a template of three short names can still render a profile blob. A
  token silently trimmed of the claim an authorisation check reads is worse than a sign-in
  that says it could not be completed.
- **Mapping `metadata_private` needs an acknowledgement, and what is stored is when it was
  given.** That column is the one place a customer keeps what they did not want a browser to
  see, and a token is read by everything the device sends it to. The question a reviewer asks
  is when somebody agreed, not whether a box is ticked.

`SessionService.mintAccessToken` takes the `User` and reads the template itself, so a new way
of minting a token cannot leave a project's claims out. That read is a primary-key lookup on
a tiny table; the project-config cache PROJECT.md 4.2 assumes is what removes it, and nothing
else wants one yet.

## Adding a provider, factor or channel

Extend the family's abstract base in `@idenzy/domain/ports` and implement only what
varies. The base owns what must never be skipped: the state check for OAuth, the
suppression check for email, the spend reservation for SMS, the single refusal for an
MFA factor. Do not re-implement those in
a subclass, and do not add an abstraction until there are two real implementations.

For an OAuth provider that means an endpoint pair and a profile mapping, plus running
`OAuthProviderConformanceSuite` from `@idenzy/testing`. Two rules the suite cannot check
for you. `emailVerified` must be false whenever the provider does not explicitly assert
otherwise, because that field alone decides whether an account can be linked on an
address. And the subject must be the provider's immutable id, never a username or an
address: GitHub logins can be renamed and handed to someone else, and a Slack member id is
unique only inside a workspace, so its subject carries the workspace too.

Where the wire format differs the base already has the hook, and it is one hook per
decision rather than one per symptom. `clientAuthentication` returns `basic` for the six
providers whose token endpoint refuses credentials in the body, and it moves the secret
into the header **and** drops `client_secret` from the form, because RFC 6749 forbids
presenting them both ways and doing half of it is accepted by some providers and refused
by others. `tokenEncoding` returns `json` for Notion alone, whose API takes nothing else
and reports a form as an error about the grant type.

A concrete provider needs an explicit constructor that only calls `super`. It is not
useless: it widens the abstract base's `protected` constructor to `public`, which is what
lets the registry build one. Biome flags it, so the suppression carries that reason.

## Working on the SMS path

The one channel where a request costs us money before it reaches anybody, which is why
almost everything here is stricter than its email equivalent (PROJECT.md 4.8).

- **The order of the checks in `SmsFraudGuard` is the design, not a sequence.** Placing the
  number is first because it is free and settles two refusals on its own. Attestation is
  next, *before any counter*, because a counter is a write: without that ordering anybody
  could exhaust a stranger's daily allowance by naming their number, and the victim would
  find their own sign-in refused having never been sent a code. Three tests fail if it moves.
- **Every counter on this path is strict, and `check` is not the method to use.**
  `RateLimitStrategy.check` fails open, which is right for a sign-in attempt and wrong here:
  allowing what we could not count turns a Valkey outage into an unmetered send window.
  `checkStrictly` propagates the store's error and the guard turns it into a refusal that
  says "later" rather than "our cache is down".
- **The spend cap lives in Postgres, and the reservation is one statement.** A cache cannot
  hold a limit whose failure mode is an invoice. The check and the increment are a single
  conditional upsert, because a read followed by a write lets two sends that each fit under
  the cap both pass. The first send of a day takes the insert branch, which no `setWhere`
  covers, so the caller's own cost is compared against the cap before the statement runs.
- **A reservation that was never settled stands.** A dispatch that threw may still have put
  a message on the wire, so the day is left overstated rather than released. `settle` takes
  what was reserved *and* what was charged, because a ledger holds the day's total and not
  this send's share of it.
- **`ProviderRouter` never retries.** The failed send already reserved the spend and already
  spent the number's velocity, and a gateway timeout is the case where the message usually
  went out. Failover is on the next request. Same reasoning as never retrying a refresh.
- **The allowlist is ISO country and the geography reads libphonenumber's `max` metadata.**
  Twenty countries share +1, and a project allowing the United States must not thereby be
  allowing every Caribbean range on the prefix. A number that cannot be placed is refused:
  an allowlist that admits what it could not identify is not one.
- **A project with no `sms_policies` row sends nothing**, which is the same answer as an
  empty allowlist. "Nobody configured this" is not a reason to start spending.
- **`UnconfiguredAttestation` answers false for everything.** A verifier that accepted what
  it cannot check would make `attestation_required` read as protection while being none. It
  does mean SMS is unusable on a project that requires attestation until a real provider is
  wired, and that is the intended failure.
- **An SMS is billed by segment.** `measure()` in `@idenzy/templating` is what prices a body,
  and the two numbers do not move together: the 161st plain character costs a second segment,
  and one curly apostrophe drops the whole message from 160 characters to 70. The built-in
  copy is ASCII and a test holds it inside one segment, because the failure is silent and
  arrives as a bill.
- **Both OTP flows check the challenge's channel against their own.** `OtpVerification`
  dispatches on the row rather than on anything the client said, and each flow checks again,
  because a dispatch is a convenience and that check is a guarantee: an SMS challenge
  resolved by the email flow looks a phone number up in the email column, misses, and creates
  an account with a phone number stored as an address, on a code the caller had every right
  to present.

## Working on the revocation set

The thing that lets a five-minute access token behave like a sixty-second one without a
refresh storm (PROJECT.md 4.2, ADR-0009). Read the ADR first: three of these are decisions
that look arbitrary until you know what they are avoiding.

- **It is published, never queried.** A customer's verifier is offline on purpose, so it polls
  a snapshot and checks an in-process copy. A lookup on their request path would put our
  latency and our availability inside their request, which is the property offline
  verification exists to sell. Our own API does not read the set at all: `SessionGuard` reads
  the session row, so revocation is already immediate there.
- **Everything that verifies offline can hold one, and nothing has to.** `@idenzy/node` takes
  a `RevocationCache` on its verifier, and the five SSR helpers pass one through to the same
  place. It stays opt-in in every one of them: a customer who builds none keeps a package
  whose only outbound call is for the key set. What changes when one is attached is the
  answer, not the shape of it, so see the SSR helper section for where a revoked session has
  to land in a gate.
- **Publish after the commit, never inside it.** The failure directions are not symmetric. A
  missed revocation degrades to the token expiring, which is where we were before the set
  existed. A false one is unrecoverable: the set is keyed by session id, refreshing mints a
  new access token for the same session, so nothing the client does clears the entry. Reuse
  detection is the sharp case, because it revokes and then throws; there is a test that fails
  when the publish moves after the throw.
- **`RevocationPublisher` never throws.** The revocation has already happened and the outbox
  event is already written in the same transaction, so failing the call would report an error
  for work that succeeded. The outbox is the durable path; the direct write is the fast one.
- **A bulk revoke publishes a watermark, not a list.** Signing out everywhere and a password
  reset end every session a user holds, and one entry per session does not bound. The
  watermark is compared strictly against `iat` and floored to the second, so a token minted in
  the revocation's own second survives it: `iat` is second-accurate, and under-revoking by
  under a second beats revoking a token issued after the event.
- **The endpoint takes a secret key.** PROJECT.md 4.2 sketched it as cacheable, which reads as
  public, and it cannot be: the payload names users and times their security events, and a
  project id is the `aud` of every token we sign, so it reaches every browser. The ETag is
  what keeps polling cheap instead of a CDN.
- **One key signs both kinds of statement.** A snapshot carries a `typ` that is not `JWT`,
  both access-token verifiers require `JWT`, and `TokenIssuer.issueStatement` refuses to put
  `sub` or `sid` in a statement at all. Any one of those alone would be a single point of
  failure for token confusion (RFC 8725 section 3.11).
- **The reconciler is why a failed write is survivable, and a cache restart is not fatal.**
  `RevocationReconciler` in `apps/workers` sweeps the outbox and replays revocations into the
  set. The failed write is the smaller reason: Valkey is a cache, so a restart empties every
  project's set and the published snapshot starts telling every customer that nothing is
  revoked, with nothing in the request path to notice.
- **The set is keyed by the instant of the revocation, not the instant of the write.** That is
  what makes replaying free: a sweep lands on the entry it already wrote, and the entry still
  ages out on schedule. Key it by write time and every pass pushes every expiry forward, so a
  set bounded by retention becomes a set bounded by nothing.
- **The reconciler reads a window, never a cursor, and never touches `published_at`.** That
  column belongs to the relay that will drain the outbox to Pub/Sub, and two consumers sharing
  one watermark is a bug waiting for the second one to be written.
- **`revocation_events_since` is SECURITY DEFINER and deliberately narrow.** A relay serves
  every project and has no `app.project_id`, so the read has to cross tenants. It returns two
  topics and nothing else, which is what stops it becoming a way to read every event any
  project has emitted. A test fails if that filter goes.
- **Retention is one access token lifetime plus skew.** A token minted immediately before a
  revocation expires one lifetime later, so nothing older can still be presented. That bound
  is the only reason the set is small enough to publish whole, and pruning runs on write as
  well as on read, because pruning only on read let a deployment with no poller grow forever.

## Working on the audit trail

The one control the whole compliance story rests on, and until recently it recorded
nothing: the table, the partitions, the append-only grants and the chain helper all
existed and no code had ever written a row. Five rules.

- **The chain has exactly one writer, and it is the relay in `apps/workers`.** Each entry
  links to its project's current tip, so two request handlers reading the same tip would
  both claim it and fork. Serialising that on the request path would queue every sign-in
  for a busy project behind the one before it, so a flow enqueues to the outbox and the
  relay drains it. Seconds of lag, and a chain that cannot fork.
- **`seq` is what makes "the tip" a question with one answer.** `created_at` ties at
  millisecond precision. Order by `seq`, never by time.
- **Everything the relay touches goes through a SECURITY DEFINER function.** A relay serves
  every project and sets no `app.project_id`, so `audit_events`'s FORCE RLS refuses its
  inserts and hides its reads. That failed silently once: no error, and a trail that stayed
  empty. None of the functions can UPDATE or DELETE, so the append-only grant from migration
  0001 still holds.
- **`ip` and `ua` are outside the digest.** They are the two fields a lawful erasure may
  pseudonymise, and a chain that hashed them would read a compliant erasure as tampering.
  What the chain protects is who did what to whom and when.
- **The watermark is the relay's own row in `relay_offsets`.** `outbox.published_at` belongs
  to the Pub/Sub relay, and two consumers sharing one watermark means whichever runs first
  decides what the other never sees.

