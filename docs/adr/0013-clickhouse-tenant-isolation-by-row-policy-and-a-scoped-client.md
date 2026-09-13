# ADR-0013: Tenant isolation in ClickHouse by row policy plus a client that cannot exist without a tenant

- Status: accepted
- Date: 2026-09-13

## Context

todo.md 3.2 decided that analytics and log storage are ClickHouse rather than Postgres, and listed
one thing that had to be settled before any code: **there is no RLS to lean on.**

ADR-0003 rests on two independent lines. The first is structural — `BaseRepository` takes a
`TenantContext` in its constructor and owns the `project_id` predicate, so a repository with no
tenant is a compile error rather than a repository that reads everything. The second is the
database: every tenant table is `FORCE ROW LEVEL SECURITY` with a policy keyed on
`current_setting('app.project_id')`, and the application connects as a `NOBYPASSRLS` role.

The second line is the one that does not port. ClickHouse has no `current_setting`, no
transaction-local `set_config`, and no transactions to make one local to. It is also, for us, the
store that holds the most obviously sensitive shape of data: analytics events carry IP addresses,
user agents and user ids across every project in a cell, and the queries over them are aggregates
that scan — exactly the shape where a missing predicate returns a plausible-looking answer rather
than an error.

An analytics store that can answer across tenants is the same incident class as a Postgres query
that forgets a `WHERE`. So the question is not whether to filter by `project_id` — obviously we do
— but what stands behind the filter when somebody forgets it.

## Decision

**Two independent lines again, and neither relies on a developer remembering anything.**

### First line, structural: the query is built by something that has a tenant

Analytics queries are issued through a client that takes a tenant in its constructor, the same
shape `BaseRepository` has. It is the only thing in the codebase that holds the ClickHouse
connection, it accepts a parameterised statement rather than a string, and it attaches the tenant
to every request it makes. There is no method on it that issues an unscoped query, so writing one
means writing a second client — which is visible in a diff in a way a missing `WHERE` is not.

### Second line, the server: a row policy keyed on a custom setting

Every tenant table in the analytics database carries:

```sql
CREATE ROW POLICY <table>_tenant ON idenzy.<table>
  USING project_id = toUUID(getSetting('SQL_idenzy_project_id'))
  TO idenzy_app;
```

`getSetting` reads a **custom setting**, which exists only because
`<custom_settings_prefixes>SQL_</custom_settings_prefixes>` is declared in the server config. The
client supplies it per request as an HTTP query parameter, so it is scoped to the one query rather
than to a connection — which is what `set_config(..., true)` buys us in Postgres and what a
connection-level `SET` would have thrown away the first time a pooled connection was reused.

The runtime user's *default* for that setting is the nil uuid. That is deliberate: a policy that
threw on an unset tenant would turn a forgotten scope into a 500 that reads like an outage, whereas
the nil uuid matches no project's rows and gives the same answer Postgres gives when
`app.project_id` was never set.

`idenzy_app` holds `SELECT` and `INSERT` on the analytics database and nothing else — no
`ACCESS MANAGEMENT`, no DDL — so the policy is not something the runtime identity can detach.
`idenzy_owner` runs DDL and is the only identity that reads across tenants, exactly as it is in
Postgres.

### What was verified, rather than assumed

Every line above was run against `clickhouse/clickhouse-server:25.3-alpine` before this ADR was
written, because a mechanism nobody has executed is a design note and not a decision:

| Case | Result |
| --- | --- |
| `SELECT count()` with no setting at all | `0` |
| Scoped to project A | A's rows only |
| Scoped to B | B's rows only |
| Scoped to A, query explicitly asks for B's rows | `0` — the policy ANDs and cannot be widened |
| A setting that is not a uuid | parse error, never a wide read |
| Runtime user drops its own row policy | `ACCESS_DENIED` |
| Runtime user creates a table | `ACCESS_DENIED` |
| Owner reads across tenants | all rows, which migrations need |

## Consequences

- **The tenant travels on every request, not on a connection.** The client is free to pool, and a
  pooled socket carries no tenant state to leak into the next query.
- **A new analytics table needs its own row policy**, the way a new Postgres tenant table needs its
  own `FORCE ROW LEVEL SECURITY` and grant. This is the same trap `docs/guide/repo.md` already
  records for Postgres, and it fails the same way: the policy is absent, the app reads every
  project's rows, and nothing errors. A test asserts every table in the analytics database has a
  policy attached, so forgetting is a red build rather than an incident.
- **The isolation is only as good as the value the client passes**, and that is true of ADR-0003
  too. Neither RLS nor a row policy defends against a *wrong* tenant id; both defend against a
  *missing* predicate, which is the failure that actually happens. The value comes from the same
  `TenantContext` the Postgres side already resolves, so there is one place it is decided.
- **Residency falls out of the topology rather than out of a predicate.** A cell is an independent
  stack (PROJECT.md 4.13.5), so an EU project's events go to the EU cell's ClickHouse and a
  cross-cell query is not a thing that exists to be forgotten.
- **Nothing on the authentication path reads this store.** A deployment with no ClickHouse
  configured runs without analytics rather than failing to boot, which keeps an analytics outage
  from becoming a sign-in outage.

## Alternatives rejected

- **A view per tenant.** `CREATE VIEW idenzy.events_<project>` with the predicate baked in. It is
  the strongest isolation on offer and it is unusable at our scale: a view per project is thousands
  of objects, created and dropped on the project lifecycle, and ClickHouse keeps them in a metadata
  structure that is not built for that churn. It is schema-per-tenant wearing a different hat, and
  PROJECT.md 5.2 lever 4 rejected that for the pricing model.
- **A user per tenant, with the policy bound to the user.** Removes the "wrong value" hole entirely,
  because the identity *is* the tenant. Rejected for connection-pool churn and role explosion, the
  same reasons ADR-0003 gives for a read role per tenant — and worse here, because an analytics
  client wants a warm pool and per-tenant users make every pool one connection deep.
- **Application filtering only.** One forgotten predicate away from an incident with no backstop,
  which is precisely what ADR-0003 refused for Postgres. Reaching for it here because the store is
  "only analytics" would be choosing a weaker control for the data that is most obviously personal.
- **Keeping analytics in Postgres to reuse RLS.** This is what we were doing, and 3.2 exists
  because it does not hold: aggregate scans over event data on the cluster that also serves sign-in
  is the cost and the reliability problem the split is there to solve. Reusing a control is not a
  reason to keep a workload on the wrong engine.
