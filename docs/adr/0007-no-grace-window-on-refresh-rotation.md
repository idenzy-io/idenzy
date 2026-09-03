# ADR-0007: No grace window on refresh rotation

- Status: accepted
- Date: 2026-09-03

## Context

Refresh tokens rotate on every use, and presenting an already-rotated token revokes the whole
family and its session (PROJECT.md 4.2). That is strict, and strictness has a well-known cost:
a client that refreshes twice at once loses the race on the second request and is signed out
of every device.

This is not a rare edge. It is the dominant real-world cause of spurious logouts in browser
SDKs: several components hitting a 401 together, three tabs waking from sleep, a retry after a
timeout. Every large provider has met it, and the standard remedy is a **grace window** — for
some number of seconds after a token is rotated, presenting it again is tolerated rather than
treated as theft.

We were about to build one. This records why we did not.

## Decision

**The server stays strict. There is no grace window, and PROJECT.md 4.2 is unchanged.** The
concurrency problem is solved in the client, where it actually lives.

## Rationale

A grace window has to do one of two things when a spent token is presented, and both are worse
than the problem.

**Return the same successor.** An attacker who stole token `T` replays it after the victim has
rotated, and is handed `T'` — the live token. They gain a capability they did not have, from a
mechanism added to improve reliability.

**Reject without revoking.** Consider the attacker-first ordering, which is the one that
matters. The attacker uses `T` and receives `T'`. The victim then presents `T`, is rejected
without revocation, retries, and is eventually signed out — while the attacker holds a
perfectly valid `T'` and keeps it. Strict revocation kills both, which is the correct outcome
when a token is known to be in two hands.

There is no ordering in which a window beats strictness, because "the same client retrying" and
"a second holder of the same secret" are *definitionally the same observation* at the server. A
rule that separates them has to key on something the client proves, and a bare bearer token
proves nothing. That is what PROJECT.md 4.4's device-bound refresh tokens are for, and until
they exist the two cases genuinely cannot be told apart.

## What we do instead

The fix is in the SDK and it is a *requirement*, not an optimisation:

- one in-flight refresh promise per tab, so components sharing a tab share one rotation;
- `navigator.locks` across tabs, so exactly one tab rotates and the others await its result;
- **never retry a refresh whose response was not observed.** A timed-out or aborted refresh is
  an unknown state, and re-sending the same token converts an unknown into a certain logout.
  Surface re-authentication instead.

## Consequences

- A response genuinely lost after a successful rotation costs that session, and the user signs
  in again. That is fail-secure, and it is the correct price for family-based reuse detection.
- `security.refresh_token_reused` carries `millisecondsSinceRotation` and a derived
  `likelyCause`. **Nothing branches on them.** They exist so that "your SDK is refreshing
  twice" can be told from "somebody has your token" in a support conversation, and there is a
  test asserting the family is revoked identically either way.
- If that telemetry later shows spurious logouts in the field despite a correct client, the
  answer is device-bound tokens (PROJECT.md 4.4, phase 3), which make the two cases
  distinguishable — not a window that makes them indistinguishable in the attacker's favour.
