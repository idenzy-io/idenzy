# ADR-0001: Drizzle for schema, queries and migrations

- Status: accepted
- Date: 2026-09-03
- Supersedes: the "no ORM is permitted" rule in the first draft of PROJECT.md §12

## Context

An earlier draft mandated hand-written SQL behind a thin repository base and explicitly banned ORMs.
The reasoning was sound and still is: this system depends on Postgres features that a runtime ORM
hides or fights. Row Level Security, `set_config('app.project_id', ...)` per transaction, table
partitioning on `audit_events`, and precise index use are all load-bearing for tenancy (PROJECT.md
§4.10) and cost (§5.2).

The counter-pressure is real too. Hand-written SQL across roughly thirty tables gives no compile-time
column safety, so a renamed column becomes a runtime error found by a test if we are lucky and by a
customer if we are not. It also means writing a migration tool, or gluing one on.

## Decision

Use **Drizzle** (`drizzle-orm` plus `drizzle-kit`) as the schema definition, query builder and
migration generator, used from inside the class-based repositories of PROJECT.md §9.4.

## Why this is not a reversal of the original objection

The objection was to a *runtime ORM*, and Drizzle is not one.

- **No runtime engine.** There is no client daemon, no query planner of its own, and no lazy-loading
  proxy layer. It builds SQL and hands it to `pg`.
- **No runtime dependencies.** This matters directly for PROJECT.md §7.6: the package we put on the
  hot path of every authentication adds nothing to the transitive surface.
- **The SQL is predictable from the call site.** A reviewer reads a Drizzle query and knows the SQL.
  That is the property we actually wanted from "hand-written SQL", and we keep it.
- **RLS is a first-class schema object.** `pgPolicy` and `.enableRLS()` let the policy live next to
  the table it protects, in the same file, reviewed in the same diff. Hand-written SQL would have put
  the policy in a migration far from the table definition.
- **Migrations are plain SQL files.** `drizzle-kit generate` emits numbered SQL that we read, edit if
  needed, and commit. There is no opaque migration engine deciding what to do at deploy time.

What we gain over hand-written SQL is compile-time column safety and a schema that is one artifact
rather than a definition plus a drifting set of migrations.

## What we give up

1. **Partitioning is not generated.** `audit_events` and `sessions` are partitioned, and `drizzle-kit`
   will not produce those DDL statements. They are hand-authored with `drizzle-kit generate --custom`
   and live in the same numbered sequence. This is written into PROJECT.md §9.4 because it is exactly
   the kind of detail that rots silently.
2. **Roles, grants and `FORCE ROW LEVEL SECURITY` are also custom migrations.** Drizzle models
   policies but not the surrounding privilege setup.
3. **A query builder can still hide a bad plan.** Mitigated by reviewing generated SQL on any query in
   a hot path, and by query timing metrics in `BaseRepository`.

## Consequences

- The schema in `packages/persistence/src/schema/` is the source of truth. PROJECT.md §12 is
  descriptive, not normative.
- Every column is declared through the `classified()` wrapper (ADR-0004), which composes with
  Drizzle's column builders.
- Biome's `noDrizzleDeleteWithoutWhere` and `noDrizzleUpdateWithoutWhere` rules are enabled. An
  unqualified `DELETE` on a multi-tenant table is the worst bug we could ship, and the linter now
  refuses it.
- Tenancy safety does not rest on Drizzle. RLS at the database is an independent second line, and the
  negative tests in PROJECT.md §7.4 assert isolation holds when the repository layer is deliberately
  misused.

## When to revisit

Reverse this if any of the following happens:

- Drizzle's generated SQL diverges from what we intend on a hot path and we cannot express the query
  we need.
- Its RLS or migration support regresses, or the project's maintenance stalls.
- We move to a database Drizzle does not target well.

The exit is cheap by construction: repositories own their queries behind an abstract base, so
replacing the query builder is a change inside a known set of classes, not a rewrite.
