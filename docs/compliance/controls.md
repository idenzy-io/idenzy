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

| Requirement | Where it lives | Evidence |
|---|---|---|
| Access, rectification, erasure, portability | `data_subject_requests`, one handler per kind | Request rows with `completed_at` |
| Statutory deadline is tracked | `due_at` set at intake and monitored | Alerting on overdue rows |
| Export covers every field | Field list generated from classification, not hand-listed | Generated subject-field map |
| Erasure preserves audit integrity | Classified fields tombstoned in place; user row survives as a pseudonymous shell | `Erasure` declarations per column |

## Change management and supply chain

| Requirement | Where it lives | Evidence |
|---|---|---|
| Changes are reviewed and tested | CI: typecheck, lint, unit, integration, build | Workflow runs |
| Dependencies cannot change unreviewed | `--frozen-lockfile`; CI asserts `ignoreScripts` is actually in effect | CI log |
| No arbitrary code at install time | `ignoreScripts: true` with an `onlyBuiltDependencies` allowlist | `pnpm-workspace.yaml` |
| Bill of materials per release | CycloneDX SBOM | CI artifact |
| Known advisories are surfaced | `pnpm audit` on every run | CI log |

## Residency

| Requirement | Where it lives | Evidence |
|---|---|---|
| Data stays in its jurisdiction | Cells are independent stacks; `cell_id` is set at creation and never updated | `region_cells`, Terraform per cell |
| The global control plane holds no personal data | Only billing identifiers and cell pointers | `orgs` classification |

## Availability

| Requirement | Where it lives | Evidence |
|---|---|---|
| Recovery objectives | PITR with 7-day transaction log retention; RPO 5 min, RTO 30 min | Restore drill record, quarterly |
| Graceful degradation | Rate limiting fails open with the WAF as second line; email provider failover | `RateLimitStrategy` |
| Event-loop lag is an SLO | p99 under 20 ms, alert at 50 ms | `EventLoopMonitor` |
