# Control map

Which framework asks for what, and where in this repository it is satisfied.

**Idenzy holds no certification and claims none.** This document maps requirements onto
architecture that exists, so that pursuing an audit later is an examination of records
rather than a rebuild. PROJECT.md 4.13.10 lists what is deliberately not being done.

Unlike `data-map.md` and `ropa.md`, this file is hand-maintained. Update it when a
control moves.

## Access control

| Requirement | Where it lives | Evidence | In effect |
|---|---|---|---|
| Tenant data is isolated | Every query starts from `tenantScope()` on 43 project-keyed tables or `orgScope()` on 15 org-keyed ones; a repository cannot be constructed without the context that supplies the key | `packages/testing/test/repositories.integration.test.ts` | Yes, in the application |
| Isolation survives an application bug | — | — | **No.** See below |
| The runtime role cannot reach what it has no business reaching | `idenzy_app` owns nothing, may create nothing, and is granted verbs one table at a time; `project_purges` is granted none at all | `tenancy.integration.test.ts`, which asserts the shape table by table | Yes |
| Staff access is least-privilege and time-boxed | `staff_access_grants` with `expires_at` and a required reason, granted by someone other than the requester | Quarterly review is a query over that table | Schema only; no review runs |
| Production access is deny by default | No standing grants; elevation creates a row | `staff_access_grants` history | Schema only |
| Customer impersonation is visible to the customer | Written to their audit log, not only ours | `audit_events` | Yes |

**The second row is the one to read.** Tenant isolation used to be two independent lines: the
repository predicate, and row-level security underneath it — a policy on every tenant table,
forced so that ownership was not an escape hatch, with the runtime role `NOBYPASSRLS`. The
policies were removed on 2026-09-21 with the regional architecture (PROJECT.md 4.10, ADR-0003
superseded). The predicate is now the only line, and a query that forgets its scope is answered
rather than refused.

That is a real reduction in assurance and it is recorded here as one. What bounds it: the
removal was preceded by an audit of all 233 repository statements, of which 232 already filtered
in SQL and the one that did not was fixed; `BaseRepository` and `OrgRepository` remain separate
types so a repository cannot take the wrong key; and the grant shapes above still bound what the
role can do, if not which rows it can see. What does not bound it: nothing in the database will
catch the next missing `where`.

## Audit and integrity

| Requirement | Where it lives | Evidence |
|---|---|---|
| Audit trail cannot be rewritten | `idenzy_app` holds INSERT and SELECT only; no UPDATE or DELETE privilege exists on the connection, on the parent or on any partition | Integration tests asserting SQLSTATE 42501, including one addressed to a partition directly |
| Tampering is detectable | Per-project hash chain, `entry_hash = H(prev_hash \|\| canonical(entry))`, ordered by a cluster sequence rather than a timestamp | `packages/compliance/test/hash-chain.test.ts` |
| Retention is enforced, not intended | Monthly partitions dropped on schedule; `retention_policies` drives the purge worker | Partition list |
| HIPAA six-year audit retention | Driven by `projects.compliance_tier` | Retention policy rows |

## Data protection

| Requirement | Where it lives | Evidence |
|---|---|---|
| Every field is classified | `classified()` is the only way to declare a column, enforced by the type system | Build failure on an unclassified column |
| Records of processing exist and are current | Generated from the schema; CI fails on a stale copy | `ropa.md`, `pnpm compliance:check` |
| Personal data does not reach logs | Allowlist generated from classification; undeclared fields dropped | `packages/observability/test/allowlist-logger.test.ts` |
| Sensitive fields encrypted above disk encryption | `FieldEncryptor`, per-project DEK wrapped by the deployment's KMS key, project id bound as AAD | `packages/crypto/test/crypto.test.ts` |
| Keys are not held by the application | Signing keys live in Cloud KMS; key admins are not key users | Cloud Audit Logs |
| CMEK available for enterprise | Terraform variable, default off | `infra/terraform/modules/stack/variables.tf` |

## Data subject rights

| Requirement | Where it lives | Evidence | In effect |
|---|---|---|---|
| Access, rectification, erasure, portability | `data_subject_requests`, one handler per kind | Request rows with `completed_at` | **No.** `DataSubjectRequestHandler` is abstract and nothing implements it, so no worker assembles an export |
| The deadline is the right one | `DsrDeadline` per request, from the controller's rule, defaulting to the stricter | `dsr-deadline-conformance`, `data_subject_requests.deadline_rule` | Yes |
| The deadline is tracked | `due_at` set at intake from the rule | — | **Partly.** The date is set and stored with the rule that set it; nothing pages when it passes |
| Export covers every field | Field list generated from classification, not hand-listed | Generated subject-field map | Yes, for the list. Nothing consumes it yet |
| Erasure preserves audit integrity | Classified fields tombstoned in place; user row survives as a pseudonymous shell | `Erasure` declarations per column, `retention_tombstone_users` | Yes, on the retention path |
| Disposal at end of service | `purge_project` deletes the trail and cascades 39 tables | `project_purges`, `project-purge.integration.test.ts` | Yes |

A GDPR deadline is **one calendar month** and not thirty days (Art. 12(3)): a request arriving on
31 January is due on 28 February, and day arithmetic makes it 2 March — late. That is why the
deadline is a class with a conformance suite rather than a constant, and why the rule is stored
next to the date it produced.

`purge_project` is the one `SECURITY DEFINER` function that deletes audit rows, and it re-checks
that the project belongs to the organisation naming it. That check used to be a backstop behind a
row policy; it is now the only thing separating an org id from another customer's project, which
is why it is asserted directly rather than through the service that also checks.

## Change management and supply chain

| Requirement | Where it lives | Evidence |
|---|---|---|
| Changes are reviewed and tested | CI: typecheck, lint, unit, integration, build | Workflow runs |
| Dependencies cannot change unreviewed | `--frozen-lockfile`; CI asserts `ignoreScripts` is actually in effect | CI log |
| No arbitrary code at install time | `ignoreScripts: true` with an `onlyBuiltDependencies` allowlist | `pnpm-workspace.yaml` |
| Bill of materials per release | CycloneDX SBOM | CI artifact |
| Known advisories are surfaced | `pnpm audit` on every run | CI log |

## Residency

**Not offered, and not a control.** One deployment, in one region, for every customer. A project
cannot be pinned to a jurisdiction, nothing in the schema records one, and no part of the system
refuses a request on the basis of where data sits.

This section previously described five controls over region cells: immutable `cell_id` columns
behind triggers, cross-cell refusal on a key's own prefix, a jurisdiction-pinned email region, and
a global control plane holding no end-user data. All of it was removed on 2026-09-21. The rows are
not moved to "not in effect" — the mechanisms do not exist, and a control map that lists absent
mechanisms is the failure this file exists to prevent.

What follows from that, and belongs in front of any customer conversation rather than in a table:
every customer's data sits wherever the single deployment runs, and for an EEA customer that makes
every byte an international transfer. `subprocessors.md` records what that requires and states
plainly that none of it is in place.

If residency ever returns it is a deployment topology decision — separate stacks, separate
databases — long before it is a schema one, and `infra/terraform/modules/stack` is deliberately
written to be instantiated more than once.

The "In effect" columns above exist because the columns to their left describe a design and this
file is cited as evidence. A control that is written down and a control that runs are different
claims (PROJECT.md 7.6 makes the same distinction about `ignore-scripts`).

## Availability

| Requirement | Where it lives | Evidence |
|---|---|---|
| Recovery objectives | PITR with 7-day transaction log retention; RPO 5 min, RTO 30 min | Restore drill record, quarterly |
| Graceful degradation | Rate limiting fails open with the WAF as second line; email provider failover | `RateLimitStrategy` |
| Event-loop lag is an SLO | p99 under 20 ms, alert at 50 ms | `EventLoopMonitor` |

One region means one region's outage is a total outage. There is no second stack to fail over to,
and the recovery objectives above are about restoring *this* deployment rather than about
surviving the loss of it (risks.md).
