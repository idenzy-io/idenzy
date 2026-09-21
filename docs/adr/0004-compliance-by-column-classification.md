# ADR-0004: Compliance by column classification, with generated artifacts

- Status: accepted
- Date: 2026-09-03

> **Amended 2026-09-21.** Strike the "Residency is immutable" outcome: `cell_id` is gone from
> `orgs` and `projects`, and residency is not offered (PROJECT.md §4.13.5). `controlTable()`
> is gone too — it qualified the registry key with `control.` on the argument that "which
> plane is this table in" was the same question as "which jurisdiction does this column live
> in", which was true only while a cell was an independent stack. Everything else holds:
> every column is still declared through `classified()`, and the data map, RoPA, log
> allowlist and DSR field lists are still generated from those declarations.

## Context

The compliance roadmap is SOC 2 Type II in year one, then ISO 27001, a GDPR DPA, and a HIPAA BAA on
enterprise. None of that is being pursued now.

The trap is treating that as a reason to defer the architecture. Classification, audit integrity,
residency and data-subject rights are schema-shaped concerns. Retrofitting them into a live auth
database, one holding credentials and login history for other people's users, is a quarter-long
migration with a customer-visible risk profile. Designing them in before the first row exists costs
days.

The second trap is the usual failure mode of compliance documentation: a data inventory in a
spreadsheet that was accurate the week it was written and drifts from the schema forever after. An
auditor finding that drift is worse than not having the document.

## Decision

**Data classification is a property of the schema, and every compliance artifact is generated from
it.**

Every column is declared through a `classified()` wrapper carrying its data class, processing
purpose, retention rule, whether it appears in a data-subject access request, and how erasure treats
it:

```ts
email: classified(text("email"), {
  class: DataClass.Pii,
  purpose: Purpose.Authentication,
  retention: Retention.UntilAccountDeletion,
  subjectField: true,
  erasable: Erasure.Tombstone,
})
```

Four artifacts are generated from that single declaration:

1. the GDPR Article 30 record of processing, `docs/compliance/ropa.md`
2. the data map and asset inventory ISO 27001 asks for, `docs/compliance/data-map.md`
3. the Pino redaction allowlist, so a PII column is structurally unloggable
4. the field lists that data-subject export and erasure operate on

## Why this specific design

**A new column cannot escape classification.** `classified()` returns a branded builder and
`classifiedTable` accepts only branded builders, so an unclassified column fails to compile:

```
Property '[CLASSIFIED]' is missing in type 'PgTextBuilder<...>'
```

This is stronger than the lint rule originally planned. A lint rule can be defeated by an aliased
import or an unusual call shape; a type cannot. The GritQL rule is kept as editor-time feedback,
because a type error at the table definition points somewhere less obvious than the column itself.

**The documentation cannot go stale.** It is a build output. CI regenerates it and fails if the
committed copy differs, exactly like a lockfile.

**A data-subject export cannot silently miss a field**, because it reads the same source the schema
does. The most common GDPR Art.15 failure is an export that quietly omits a column someone added two
years ago.

**Log hygiene becomes an allowlist rather than a blocklist.** Blocklists fail silently the day
someone adds a column; allowlists fail closed. "No PHI in logs" is a hard HIPAA requirement, and this
makes it a property of the build.

## Supporting decisions in the same surface

- **Audit trail is append-only and tamper-evident.** `idenzy_app` has `INSERT` and `SELECT` on
  `audit_events` and no `UPDATE` or `DELETE` grant. Each project's stream is a hash chain
  (`entry_hash = H(prev_hash || canonical(entry))`), so tampering by anyone with direct database
  access is detectable, and a scheduled verifier checks it.
- **Retention is tier-driven and enforced by a job.** One year standard, six years for HIPAA, by
  dropping partitions rather than mass deletes. Retention that no job enforces is not retention.
- **Erasure is reconciled with audit integrity in the schema, not per incident.** Classified fields
  are tombstoned in place, the user row survives as a shell, and audit entries keep the pseudonymous
  id. This is the standard GDPR Art.17 and Art.17(3)(b) reconciliation.
- **Residency is immutable.** `cell_id` on org and project is set at creation and never updated;
  moving a project is an explicit audited migration.

## Consequences

- Declaring a column is slightly more verbose. That is the entire cost, and it is paid once per
  column.
- `pnpm compliance:generate` must run whenever the schema changes, and CI enforces it.
- `packages/compliance` is a real package with real tests, not a documentation folder.

## What this is not

This is not compliance. Idenzy holds no certification and claims none. PROJECT.md §4.13.10 lists what
is deliberately not being done: the audits themselves, a DPO, a maintained risk register, a pen-test
cadence, vendor questionnaires, training. The architecture is present so that pursuing certification
later is an examination of records that already exist, rather than a rebuild.
