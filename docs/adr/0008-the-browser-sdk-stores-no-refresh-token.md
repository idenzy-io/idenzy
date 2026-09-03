# ADR-0008: The browser SDK stores no refresh token by default

- Status: accepted
- Date: 2026-09-03

## Context

`@idenzy/js` carries a session one of two ways (PROJECT.md 4.3). In **cookie mode** the refresh
token is a `__Host-` `HttpOnly` cookie the SDK cannot read, so nothing about it is the SDK's
decision. In **header mode** the SDK holds the token itself, and header mode is the only mode
available on our shared API host, which is where every customer starts before they point a
custom auth domain at us.

So the question is where a browser keeps that token between page loads. The industry answer is
`localStorage`, and it is what Supabase, Firebase and most SPA auth libraries do by default. It
works, it is convenient, and it is why a session survives a reload.

## Decision

**The default store is memory.** `RefreshTokenStore` is the seam, `MemoryRefreshTokenStore` is
what a client gets unless it is told otherwise, and nothing in the SDK selects web storage on a
customer's behalf.

**We also ship `LocalStorageRefreshTokenStore`, and it is never a default.** A customer who
needs a session to survive a reload before they have an auth domain passes it explicitly, in
their own code, where a reviewer can see it.

> Amended 2026-09-03. The original decision shipped no such class at all. See *Why we ship the
> thing we argued against* below; the default, and every reason for it, are unchanged.

## Rationale

A refresh token in web storage is readable by every script running on the origin, including one
that arrived through a dependency nobody reviewed. What it grants is not a request or two: it
mints access tokens for as long as the session lives.

Rotation and reuse detection do not save us here, and it is worth being exact about why. They
make theft *detectable*, not *preventable*, and the detection happens on the next legitimate
use, which may be minutes or hours later. By then the attacker has had a valid session for that
whole window, and the victim's reward for the detection is being signed out of every device.

The decisive point is that the alternative is not "no persistence". It is **cookie mode**, where
the token outlives the tab and is never reachable by script at all, which is strictly better
than the thing we would be defaulting to. The cost of our default is therefore one page reload,
and the fix for it is a DNS record. That is the same trade PROJECT.md 4.3 already makes when it
calls a custom auth domain a precondition rather than a convenience.

Shipping a `LocalStorageRefreshTokenStore` would settle that trade the other way, whatever the
documentation said next to it. A default nobody changes is the actual policy, and a convenience
we ship is an endorsement.

The PKCE verifier in `SessionStoragePkceStore` is not a contradiction, and the difference is
worth stating because it looks like one. A verifier *has* no memory option: the OAuth flow is a
full-page redirect to another origin and back, so memory is guaranteed to be gone when it is
needed. And what it is worth is nothing on its own: single use, minutes long, and useless
without the code it pairs with, which only ever reaches the registered redirect URI.

## Why we ship the thing we argued against

The argument above is about the *default*, and the original decision drew a second conclusion
from it that does not follow: that we should ship no such store at all.

Nobody's session stops needing to survive a reload because we declined to write the class. What
actually happens is that the customer writes it, in an afternoon, and theirs is worse than ours
in ways that are invisible until they matter. It forgets to remove the entry on sign-out, so a
shared machine keeps a live credential after the user believed they left. It uses one key for
two projects, so switching environments resumes a session against the wrong one. It stores the
access token beside the refresh token because both were in the response.

Ours removes the entry on sign-out, namespaces by publishable key, and holds one value. The
class carries the cost in its own docstring, so it is legible at the call site rather than in a
document nobody reads twice.

This is a narrower claim than "web storage is fine". It is that between a store we wrote and a
store they wrote, ours is safer, and those are the only two options that were ever on the table.

## Consequences

- On the shared API host in header mode, closing the tab signs the user out unless the customer
  opts into the store above. That is documented as the reason to configure an auth domain, not
  hidden as a limitation.
- A customer who *has* an auth domain no longer has to know any of this. The SDK negotiates its
  transport, so cookie mode is what they get by default and this decision never comes up. That
  is deliberately the ordering: the storage question only reaches a customer who is on the
  shared host, which is exactly the population it is a real question for.
- Mobile and desktop SDKs implement this interface over Keychain, Keystore and SecureStore
  (PROJECT.md 4.4). That is the case the seam exists for, and there the storage is genuinely
  protected by the platform rather than by a same-origin rule.
- A customer who insists passes one class to the constructor. That is a visible, reviewable act
  in their repository rather than a flag in ours, and it is the line a security review greps
  for.
- Revisit if the field shows customers writing that store anyway. The answer then is to make
  cookie mode easier to reach, such as provisioning an auth domain during `idenzy init`, rather
  than to ship the store.
