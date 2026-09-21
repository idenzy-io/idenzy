# Compliance: deferred, on purpose

**Status: the programme is parked until there is real revenue.** Thousands of dollars a month,
not a first customer. Nothing in this directory is a commitment.

This file exists so that the state is written down rather than inferred from staleness.
The architecture is still built the way the rest of `docs/compliance/` describes —
column classification, the hash-chained audit trail, per-project envelope encryption,
data-subject field lists. What is deferred is the *programme*: the audits, the
attestations, and the evidence gathering that would be shown to an auditor.

## What changed on 2026-09-21

Removing the region cells invalidated a set of claims written when a project could be pinned
to a jurisdiction. The documents were parked rather than corrected, on the grounds that
careful prose about a programme that has not started, for an audience that does not exist
yet, was not worth the hours.

**That correction has since been made.** The three hand-maintained files now describe a single
deployment:

- `controls.md` — the `## Residency` table is gone. Five controls over cells, immutable
  `cell_id`, cross-cell refusal and a jurisdiction-pinned email region described mechanisms that
  no longer exist, and a control map listing absent mechanisms is the failure it exists to
  prevent. The section now says residency is not offered and why.
- `subprocessors.md` — no per-cell regions, and no EU cell held out as the thing that would
  narrow the transfer problem. There is one deployment, so every EEA customer's data is a
  transfer unless it happens to sit in their jurisdiction, and that is contractual work with no
  architectural half available.
- `us-and-eu-readiness.md` — "Residency by topology" left the list of things the architecture
  already satisfies, because it no longer does.

Two corrections were made in the same pass that were **not** about regions, and both went the
direction a reader would not guess:

- **Tenant isolation lost its second line.** Row-level security went with the cells. The
  repository predicate is now the only thing separating tenants, and `controls.md` records that
  row as not in effect rather than quietly restating the predicate as though it were two
  controls. This is the most significant assurance change in the repository's history and it is
  written down as one.
- **The data-subject export blocker moved.** `us-and-eu-readiness.md` said there was no object
  storage anywhere in the estate. There now is: a port, a conformance suite, and a bucket with
  versioning off and a lifecycle rule. What is missing is a Cloud Storage implementation and the
  wiring, which is a smaller gap than the one recorded.

## What is generated and therefore always current

`data-map.md` and `ropa.md` come from `pnpm compliance:generate`. CI fails if they are stale, so
they stay correct for free. The RoPA states plainly that residency is not offered.

One thing to know about them: they are only as true as the `note` on each `classified()` column.
Forty entries in the data map went on asserting "Enforced by RLS as well as by the repository
layer" after the policies were removed, because `projectIdColumn()`'s note still said so — the
`orgId` half of the identical note was corrected in the same change and this one was missed.
A generated document is not self-correcting — it is a faithful copy of whatever the source says.

## What closes this file

In order, and none of it before the revenue:

1. ~~Rewrite the three hand-maintained files against a single-deployment model.~~ Done.
2. Decide whether residency is ever coming back as a product feature. If it is, it is a
   deployment topology decision long before it is a schema one, and
   `infra/terraform/modules/stack` is written to be instantiated more than once.
3. Then, and only then, the programme itself: DPO, risk register, pen-test cadence,
   vendor questionnaires, awareness training, trust portal (PROJECT.md 4.13.10).

PROJECT.md 4.13.10 remains the authoritative list of what is deliberately not being done.
