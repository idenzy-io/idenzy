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

**The default store is memory. We ship no web-storage implementation.** `RefreshTokenStore` is
an interface with one shipped implementation, `MemoryRefreshTokenStore`, and a customer who
needs persistence supplies their own.

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

## Consequences

- On the shared API host in header mode, closing the tab signs the user out. That is documented
  as the reason to configure an auth domain, not hidden as a limitation.
- Mobile and desktop SDKs implement this interface over Keychain, Keystore and SecureStore
  (PROJECT.md 4.4). That is the case the seam exists for, and there the storage is genuinely
  protected by the platform rather than by a same-origin rule.
- A customer who insists writes about ten lines in their own repository. That is a visible,
  reviewable act on their side rather than a flag on ours.
- Revisit if the field shows customers writing that store anyway. The answer then is to make
  cookie mode easier to reach, such as provisioning an auth domain during `idenzy init`, rather
  than to ship the store.
