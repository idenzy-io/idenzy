# Compliance: deferred, on purpose

**Status: parked until there is real revenue.** Thousands of dollars a month, not a first
customer. Nothing in this directory is a commitment and nothing here is being worked on.

This file exists so that the state is written down rather than inferred from staleness.
The architecture is still built the way the rest of `docs/compliance/` describes —
column classification, the hash-chained audit trail, per-project envelope encryption,
data-subject field lists. What is deferred is the *programme*: the audits, the
attestations, and the hand-written documents that would be shown to an auditor.

## Why now

Removing the region cells (2026-09-21) invalidated a set of claims that were written when
a project could be pinned to a jurisdiction. Correcting every one of them properly is
several hours of careful prose about a programme that has not started, for an audience
that does not exist yet. The honest cheap move is to say so here.

## What is already true

- `data-map.md` and `ropa.md` are **generated** by `pnpm compliance:generate` and are
  current. CI fails if they are stale, so they stay that way for free.
- The RoPA now states plainly that residency is **not offered**: one deployment, one
  region, for every customer. That correction was made rather than deferred, because a
  generated document asserting a guarantee we do not provide is worse than a stale one.
- PROJECT.md 4.13.10 already lists what is deliberately not being done.

## What is stale and known to be

Hand-maintained files, each of which still describes the regional model:

- `controls.md` — the whole `## Residency` table. Every row is about cells.
- `subprocessors.md` — "US only (`us1`, `us-central1`)", the EU-cell paragraphs, and the
  per-vendor region rows that exist to support a residency claim.
- `us-and-eu-readiness.md` — "Residency by topology (4.13.5)" and the surrounding
  argument.
- `README.md` in the repository root claims "region-pinned data residency". **This one is
  a public claim and was corrected** — it is listed here only so the set is complete.

## What closes it

In order, and none of it before the revenue:

1. Rewrite the three hand-maintained files above against a single-deployment model.
2. Decide whether residency is ever coming back as a product feature. If it is, it is a
   deployment topology decision long before it is a schema one.
3. Then, and only then, the programme itself: DPO, risk register, pen-test cadence,
   vendor questionnaires, awareness training, trust portal (PROJECT.md 4.13.10).
