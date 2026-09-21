# Control map

Which framework asks for what, and where in this repository it is satisfied.

**Idenzy holds no certification and claims none.** This document maps requirements onto
architecture that exists, so that pursuing an audit later is an examination of records
rather than a rebuild. PROJECT.md 4.13.10 lists what is deliberately not being done.

Unlike `data-map.md` and `ropa.md`, this file is hand-maintained. Update it when a
control moves.

## Access control

| Requirement | Where it lives | Evidence |
|---|---|---|
| Tenant data is isolated | RLS on 24 tables, `FORCE ROW LEVEL SECURITY`, runtime role is `NOBYPASSRLS` | `packages/testing/test/tenancy.integration.test.ts` |
| Isolation survives an application bug | Repository cannot be built without a `TenantContext`; RLS is the independent second line | The negative test that queries another tenant directly and gets zero rows |
| Staff access is least-privilege and time-boxed | `staff_access_grants` with `expires_at` and a required reason, granted by someone other than the requester | Quarterly review is a query over that table |
| Production access is deny by default | No standing grants; elevation creates a row | `staff_access_grants` history |
| Customer impersonation is visible to the customer | Written to their audit log, not only ours | `audit_events` |

## Audit and integrity

| Requirement | Where it lives | Evidence |
|---|---|---|
| Audit trail cannot be rewritten | `idenzy_app` holds INSERT and SELECT only; no UPDATE or DELETE privilege exists on the connection | Integration tests asserting SQLSTATE 42501 |
| Tampering is detectable | Per-project hash chain, `entry_hash = H(prev_hash \|\| canonical(entry))` | `packages/compliance/test/hash-chain.test.ts` |
| Retention is enforced, not intended | Monthly partitions dropped on schedule; `retention_policies` drives the purge worker | Partition list |
| HIPAA six-year audit retention | Driven by `projects.compliance_tier` | Retention policy rows |

## Data protection

| Requirement | Where it lives | Evidence |
|---|---|---|
| Every field is classified | `classified()` is the only way to declare a column, enforced by the type system | Build failure on an unclassified column |
| Records of processing exist and are current | Generated from the schema; CI fails on a stale copy | `ropa.md`, `pnpm compliance:check` |
| Personal data does not reach logs | Allowlist generated from classification; undeclared fields dropped | `packages/observability/test/allowlist-logger.test.ts` |
| Sensitive fields encrypted above disk encryption | `FieldEncryptor`, per-project DEK wrapped by the cell KMS key, project id bound as AAD | `packages/crypto/test/crypto.test.ts` |
| Keys are not held by the application | Signing keys live in Cloud KMS; key admins are not key users | Cloud Audit Logs |
| CMEK available for enterprise | Terraform variable, default off | `infra/terraform/modules/cell/variables.tf` |

## Data subject rights

| Requirement | Where it lives | Evidence | In effect |
|---|---|---|---|
| Access, rectification, erasure, portability | `data_subject_requests`, one handler per kind | Request rows with `completed_at` | **No.** `DataSubjectRequestHandler` is abstract and nothing implements it, so no worker assembles an export |
| The deadline is the right one | `DsrDeadline` per request, from the controller's rule, defaulting to the stricter | `dsr-deadline-conformance`, `data_subject_requests.deadline_rule` | Yes |
| The deadline is tracked | `due_at` set at intake from the rule | — | **Partly.** The date is set and stored with the rule that set it; nothing pages when it passes |
| Export covers every field | Field list generated from classification, not hand-listed | Generated subject-field map | Yes, for the list. Nothing consumes it yet |
| Erasure preserves audit integrity | Classified fields tombstoned in place; user row survives as a pseudonymous shell | `Erasure` declarations per column, `retention_tombstone_users` in 0052 | Yes, on the retention path |
| Disposal at end of service | `purge_project` cascades 37 tables and purges the trail | `project_purges`, `project-purge.integration.test.ts` | Yes |

A GDPR deadline is **one calendar month** and not thirty days (Art. 12(3)): a request arriving on
31 January is due on 28 February, and day arithmetic makes it 2 March — late. That is why the
deadline is a class with a conformance suite rather than a constant, and why the rule is stored
next to the date it produced.

## Change management and supply chain

| Requirement | Where it lives | Evidence |
|---|---|---|
| Changes are reviewed and tested | CI: typecheck, lint, unit, integration, build | Workflow runs |
| Dependencies cannot change unreviewed | `--frozen-lockfile`; CI asserts `ignoreScripts` is actually in effect | CI log |
| No arbitrary code at install time | `ignoreScripts: true` with an `onlyBuiltDependencies` allowlist | `pnpm-workspace.yaml` |
| Bill of materials per release | CycloneDX SBOM | CI artifact |
| Known advisories are surfaced | `pnpm audit` on every run | CI log |

## Residency

| Requirement | Where it lives | Evidence | In effect |
|---|---|---|---|
| Data stays in its jurisdiction | Cells are independent stacks | `region_cells`, `infra/terraform/modules/cell` | **No.** One cell is declared, in `environments/dev`, and nothing has been applied |
| `cell_id` is set at creation and never updated | `orgs.cell_id`, `projects.cell_id`, and a trigger on each | Migration 0063, asserted in `tenancy.integration.test.ts` | Yes |
| Cross-cell access is refused | Two checks in `TenantResolutionGuard`: a key's cell segment before any lookup, the resolved project's cell after one | `tenant-resolution.test.ts`, migration 0063 | Yes |
| A cell's email cannot leave its jurisdiction | `JurisdictionPolicy.emailRegion`, checked against `AWS_REGION` at boot | `auth-api/src/main.ts`, `jurisdiction-policy-conformance` | Yes |
| The global control plane holds no **tenant end-user** personal data | Only billing identifiers, cell pointers and customer account data | `orgs` classification, and `control.` in the generated data map | Yes |

The "In effect" column exists because the two columns to its left describe a design and this
file is cited as evidence. A control that is written down and a control that runs are different
claims (PROJECT.md 7.6 makes the same distinction about `ignore-scripts`).

Note the last row is narrower than it used to read. The control plane holds no *end-user* data,
which is the property residency rests on — but `orgs.name`, `org_invitations.email` and the
`onboarding_responses` free-text columns are classified PII with `subjectField: true`, so it is
not free of personal data altogether.

## Availability

| Requirement | Where it lives | Evidence |
|---|---|---|
| Recovery objectives | PITR with 7-day transaction log retention; RPO 5 min, RTO 30 min | Restore drill record, quarterly |
| Graceful degradation | Rate limiting fails open with the WAF as second line; email provider failover | `RateLimitStrategy` |
| Event-loop lag is an SLO | p99 under 20 ms, alert at 50 ms | `EventLoopMonitor` |
