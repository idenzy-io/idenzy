# Infrastructure

One deployment: Cloud Run, Cloud SQL, Memorystore, a KMS key ring, and the network around
them, in one region.

This used to describe **cells** — independent regional stacks sharing no data, with a
project pinned to one at creation so that an EU project could be honestly described as
EU-resident, and a global control plane holding cell pointers only. That model was built
and removed on 2026-09-21. **Residency is not offered** (PROJECT.md 4.13.5), and nothing
here should be read as offering it.

Nothing in this directory has been applied.

## Layout

```
modules/stack/         the deployment, instantiated per environment
  main.tf              KMS, Cloud SQL, the Postgres roles
  webhooks.tf          the webhook retry lane: Cloud Tasks queues, an identity, IAM
environments/dev/      the one environment
```

## What lives here rather than in a migration

Postgres roles. They are cluster-level objects, not schema, so `idenzy_app` and
`idenzy_owner` are created by Terraform on Cloud SQL and by
`infra/docker/postgres-init` locally. Migration 0000 already references `idenzy_app` in
its grant statements, so a migration that also created the role could not run on a fresh
cluster.

## The webhook retry lane

`webhooks.tf` is the one part of this that a service actually reads, so the contract between
it and the code is worth stating. Terraform makes the queues and the identity; the workers
service is given five variables and builds `CloudTasksScheduler` from them, or falls back to
sweeping the table if it is given none (ADR-0012):

| Variable | From |
|---|---|
| `GCP_PROJECT_ID` | the Cloud project |
| `WEBHOOK_TASKS_LOCATION` | the region |
| `WEBHOOK_TASKS_QUEUE_PREFIX` | `webhook_queue_prefix` output |
| `WEBHOOK_TASKS_QUEUE_SHARDS` | `webhook_queue_shards` output |
| `WEBHOOK_TASKS_SERVICE_ACCOUNT` | `webhook_tasks_service_account` output |
| `WEBHOOK_DISPATCH_URL` | the workers service URL plus its dispatch path |

Four or five of them is a boot failure rather than a fallback, because the symptom of a
half-configured queue is retry latency nobody is watching.

Everything in that file is free to hold. Cloud Tasks bills per operation with a million a
month free, and a queue, a service account and an IAM binding cost nothing at rest — which is
why the retry lane exists in the skeleton while the rest of the compute does not.

**One binding is missing on purpose**: `roles/run.invoker` on the workers service for that
identity. The Cloud Run services are not declared in this module yet, and granting the invoker
role at project level to make the file look complete would hand a webhook identity the right to
call everything in the deployment.

## Not applied

These files are a skeleton. No state backend is configured and nothing has been applied
to a real project. `terraform validate` is the only thing they are expected to pass at
this stage.

The GCP half of the webhook pipeline is therefore unexercised: the code that creates a task,
the token it asks for and the token it verifies all have tests, but a queue calling the
dispatcher back has never happened. What has been verified end to end is the pipeline without
a queue — a real Postgres, a real receiver over ngrok, and the sweeper as the timer — which is
the arrangement every environment falls back to and the only one that is a delivery guarantee.
