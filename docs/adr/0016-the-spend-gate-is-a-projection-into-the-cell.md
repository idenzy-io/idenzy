# ADR-0016: The spend gate is a projection into the cell, and it fails open

- Status: accepted
- Date: 2026-09-15

## Context

`WalletSolvency` decides whether an organisation may still spend on the metered channels — SMS,
WhatsApp, and email on a verified domain. ADR-0014 settled what it decides: not a zero check, but
a tolerance, so that a card which expired on Friday does not stop one-time codes on Saturday.

What it was not asked at the time is *where it reads that from*. It read three tables —
`org_debts`, `credit_grants` and `usage_charges` — inside `runForOrg`, on the send path, from
`apps/auth-api`. Its own docstring flagged this as unusual and defended it:

> This crosses from a project to its organisation, which is the one place on the request path
> that does.

That defence holds only while the two planes share a database. All three tables are org-keyed and
belong to the global control plane (ADR-0011); the send path belongs to a cell. PROJECT.md 4.13.5
makes cells independent stacks, so "the one place on the request path that crosses" becomes the
one place a cell reaches into another database, and it breaks three ways at once:

- **Credentials.** `apps/auth-api` would need a control-plane connection. A cell exists to bound
  a blast radius, and handing every cell's public-facing service credentials to the plane holding
  every organisation's billing identity is the opposite of that.
- **Availability.** A control-plane outage would stop one-time codes in *every* cell
  simultaneously — the widest possible failure from the narrowest possible cause.
- **Residency and latency.** An EU cell would make a transatlantic query before each send.

This was not in any document. It surfaced while designing the plane split.

## Decision

**The control plane decides and publishes; the cell reads what was published.**

`project_spend_state` is a cell-local table, one row per project: whether it may spend, why not,
when that was computed, and when the answer expires. The drawdown worker writes it for every
organisation it visits — not only the ones it charged, since an organisation past its tolerance
stops accruing new charges the moment it stops being served. `WalletSolvency` reads one indexed
row inside the transaction the request already has.

The arithmetic moved to `SpendTolerance` in `@idenzy/domain`, because it now has two callers. Two
copies of a tolerance rule is how a gate comes to refuse in one place and permit in another for
the same balance.

**A missing or stale row means yes.**

This is the part worth stating plainly, because "fail open on a billing control" reads wrong
until the alternative is written down. Failing closed means: a worker dies, and some minutes or
hours later every paying customer in that cell silently stops receiving one-time codes, with no
error anywhere that names the cause. Failing open means: an organisation that had already stopped
paying keeps sending for up to six hours longer.

ADR-0014 already made this trade and said so — "a card that expired on Friday does not stop SMS
on Saturday, **and neither does an outage of ours**". A projection nobody refreshed *is* an outage
of ours. The staleness horizon is six hours against a five-minute pass: roughly seventy
consecutive failures before the gate opens by itself.

A project with no row at all has simply never been through a drawdown pass — which is every new
project, and every project whose organisation owes nothing. Treating that as a refusal would
refuse the common case.

## Consequences

- The request path no longer crosses the plane boundary anywhere. That was the last place, and
  it is what makes the control-plane split a change of deployment rather than of behaviour.
- The gate is eventually consistent, bounded by the drawdown interval. A customer who settles
  their balance is not unblocked instantly; they are unblocked within a pass. Anything faster
  would mean the send path reading the ledger again, which is what this removes.
- `project_spend_state` is a projection and carries no authority. It can be dropped and rebuilt
  by one drawdown pass, and a project purge takes it by cascade like every other tenant table.
- The drawdown now writes into each cell. Today that is the same database; after the split it
  goes through the cell gateway, which is the shape the split needs anyway.
- One thing this does **not** change: nothing here can stop authentication. `ZERO_KEEPS_WORKING`
  is still the longer list, and sign-in, refresh, the dashboard and mail on the shared sender are
  on it whatever is owed.
