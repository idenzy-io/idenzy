# ADR-0003: Tenant isolation by RLS plus repositories that cannot exist without a tenant

- Status: accepted
- Date: 2026-09-03

> **Superseded in part, 2026-09-21.** Row-level security was removed. The half of this
> decision that survives is the half named in its title: `BaseRepository` still cannot be
> constructed without a `TenantContext`, `OrgRepository` still cannot without an
> `OrgContext`, and every query starts from that predicate. The half that is gone is the
> database's: no policies, no `FORCE ROW LEVEL SECURITY`, no `NOBYPASSRLS`, no
> `set_config('app.project_id')`. The audit that preceded the removal found 232 of 233
> statements already filtering in SQL and fixed the one that did not, so what was lost was
> the second line rather than the first — but it was a real second line, and §7.4's
> nineteen negative tests went with it. See PROJECT.md §4.10.

## Context

Idenzy is fully multi-tenant on a single shared Postgres cluster, which is the decision that makes
$0.0025/MAU possible (PROJECT.md §5.2 lever 4). It also means a cross-tenant read is the worst
possible bug: an auth platform leaking one customer's users into another's response is an
existential incident, not a Sev-2.

Application-level filtering alone is not enough. It fails the day someone writes a query that forgets
a `WHERE project_id = ...`, and code review is not a reliable control against an omission.

## Decision

Two independent lines of defence, neither of which relies on a developer remembering anything.

**First line, structural.** `BaseRepository` takes a `TenantContext` in its constructor and cannot be
instantiated without one. It owns the `project_id` predicate. A repository with no tenant is not a
repository that reads everything; it is a compile error.

**Second line, the database.** Every tenant table has RLS enabled with a policy keyed on
`current_setting('app.project_id')`. The application connects only as `idenzy_app`, created
`NOBYPASSRLS`. Every tenant table is declared `FORCE ROW LEVEL SECURITY`, so table ownership is not an
escape hatch either.

`UnitOfWork.run(cb)` opens a Drizzle transaction and, as its first statement, runs:

```sql
select set_config('app.project_id', $1, true)
```

Three details in that line are deliberate:

- **`set_config` rather than `SET LOCAL`**, because `SET LOCAL` cannot take a bind parameter, and
  building it by string concatenation would put a tenant identifier into SQL text. That is a
  needless injection surface on the most security-critical statement in the system.
- **The third argument `true`** makes the setting transaction-local, so a pooled connection cannot
  carry tenant context into the next checkout. A connection-level `SET` would be a cross-tenant leak
  waiting for a pool reuse.
- **First statement in the transaction**, so no query can run before the policy has something to
  match on.

## Consequences

- All tenant-scoped work happens inside a transaction, because that is what makes the setting local.
  This is a real constraint and it is accepted.
- Migrations run as `idenzy_owner`, a different role from the runtime one.
- `audit_events` goes further: `idenzy_app` holds `INSERT` and `SELECT` and no `UPDATE` or `DELETE`
  grant at all, so no application code path can rewrite history (ADR-0004, PROJECT.md §4.13.3).
- The two lines are tested independently. The RLS negative test deliberately misuses a repository to
  query another tenant's rows and asserts zero rows come back, which proves the second line holds when
  the first is broken. A test that only exercises correct usage would prove nothing.

## Alternatives rejected

- **Schema per tenant.** Fixed cost per tenant, and thousands of schemas make migrations and
  connection pooling painful. Kills the pricing model.
- **Database per tenant.** Supabase's model. Same problem, worse.
- **Application filtering only.** One forgotten predicate away from an incident, with no backstop.
- **A separate read role per tenant.** Connection pool churn, and role explosion at scale.
