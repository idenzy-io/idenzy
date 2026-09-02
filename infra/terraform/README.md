# Infrastructure

A **cell** is one independent regional stack: Cloud Run, Cloud SQL, Memorystore, a KMS
key ring, and the network around them. Cells share no data. A project is pinned to one at
creation and does not move (PROJECT.md 4.13.5), which is what lets an EU project be
honestly described as EU-resident.

The control plane (billing, the cell registry, our own dashboard auth) is global and
holds cell pointers and billing identifiers only, never tenant personal data.

## Layout

```
modules/cell/          one region cell, instantiated per environment
environments/dev/      the first cell
```

## What lives here rather than in a migration

Postgres roles. They are cluster-level objects, not schema, so `idenzy_app` and
`idenzy_owner` are created by Terraform on Cloud SQL and by
`infra/docker/postgres-init` locally. Migration 0000 already references `idenzy_app` in
its `CREATE POLICY` statements, so a migration that also created the role could not run
on a fresh cluster.

## Not applied

These files are a skeleton. No state backend is configured and nothing has been applied
to a real project. `terraform validate` is the only thing they are expected to pass at
this stage.
