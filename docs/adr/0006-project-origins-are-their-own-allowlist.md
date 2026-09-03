# ADR-0006: Browser origins are their own allowlist

- Status: accepted
- Date: 2026-09-03

## Context

A browser SDK needs CORS, and CORS needs to know which origins a project trusts with a
credentialed response. Two lists of URLs already existed and either looked like it might do:
`redirect_uris`, the exact-match allowlist every OAuth return and magic link lands on, and
`webauthn_relying_parties.origins`, which is already called "origins" and is already an
exact-match list of them.

Deriving the CORS allowlist from one of those is the obvious saving. It is one fewer thing for
a customer to configure and one fewer table to provision.

## Decision

**A new `project_origins` table.** The CORS allowlist is its own list, populated on its own,
and derived from nothing.

## Rationale

**Redirect targets are not origins.** A native app registers `myapp://callback`, which is a
perfectly good redirect target and not a value that can ever appear in an `Origin` header.
A derived list would have to filter, and a filter that silently drops entries is worse than a
list that was never claimed to be complete.

**The sets legitimately differ.** An SPA served from `www.example.com` may post to the auth API
while its OAuth return route lives on `app.example.com`. Neither list is a superset of the
other, so deriving either direction is wrong for real deployments rather than for contrived
ones.

**Derivation makes a privilege change invisible.** If registering a redirect URI also granted
that origin the right to read credentialed responses, then adding a redirect would silently
widen the browser attack surface. Whoever added it would be looking at a dialog about OAuth.
Two lists means two deliberate acts.

**WebAuthn's origins have a different legal shape.** WebAuthn forbids an origin outside the
relying party's own registrable domain; CORS does not. Merging the two would either narrow
CORS to WebAuthn's rule or widen WebAuthn past its spec, and both are worse than a second
column.

## Consequences

- One more thing to configure, and the dashboard should mitigate that by *suggesting* origins
  derived from the registered redirect URIs and asking the customer to confirm. Suggestion in
  the UI, never derivation in the schema.
- Both `resolve_project_by_host` and `resolve_project_by_key_hash` return `allowed_origins`, so
  the CORS layer rides the lookup tenant resolution already performs rather than adding a query
  to the hot path.
- Exact match, no wildcards, exactly as `redirect_uris` has none. The single exception is a
  loopback rule for development that lives in application code and is gated on the environment,
  so it cannot be switched on by data.

## The reversal trigger

If a customer-visible metric shows that misconfigured origins are a common first-run failure
and the dashboard's suggestion is not fixing it, revisit — but the answer is better tooling
around the list, not deletion of it.
