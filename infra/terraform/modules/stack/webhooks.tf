# Webhook delivery: the retry lane (ADR-0012).
#
# Everything in this file is free to hold and billed only when used: Cloud Tasks charges per
# operation with a million a month free, and a service account, an IAM binding and a queue cost
# nothing at rest. At the design volume — 100M deliveries a month, of which a few per cent are
# retried — the queue line on the bill is a couple of dollars. That is the whole reason the first
# attempt is made inline by the relay and only a failure becomes a task: putting every delivery
# through here would be $80 a month to move work the relay was already holding.
#
# What is deliberately absent is a subscription, a topic and a second database. Pub/Sub has no
# per-message delay, so it cannot express a schedule of seven delays without a topic per tier, and
# the delivery history that would justify a store of its own is the part ADR-0012 decided not to
# keep in Cloud SQL.

data "google_project" "this" {
  project_id = var.project_id
}

# A fixed pool, sharded by endpoint id rather than a queue per customer: 1000 customers is not 1000
# queues. `CloudTasksScheduler` hashes the endpoint id to pick one, so one endpoint's retries are
# always in the same queue and are bounded by that queue's dispatch rate — which is what stops a
# customer whose receiver is down from spending the pool on their own retries.
#
# The count has to match WEBHOOK_TASKS_QUEUE_SHARDS in the workers' environment. Too high and a share
# of retries are armed against a queue that does not exist, which costs those deliveries the sweeper's
# interval rather than losing them; the scheduler logs the refusal so it is visible either way.
resource "google_cloud_tasks_queue" "webhooks" {
  count = var.enable_managed_infrastructure ? var.webhook_queue_shards : 0


  name     = "${local.name_prefix}-webhooks-${count.index}"
  project  = var.project_id
  location = var.region

  rate_limits {
    max_dispatches_per_second = var.webhook_queue_dispatches_per_second
    max_concurrent_dispatches = var.webhook_queue_concurrent_dispatches
  }

  # One attempt per task, because the schedule is ours and published (ADR-0012). A queue retrying on
  # top of it would turn seven documented delays into something nobody can quote, and would double a
  # customer's traffic during an outage: the dispatcher records the attempt and arms the next one
  # itself, so a task that fails has already been accounted for.
  retry_config {
    max_attempts = 1
  }

  # The queue keeps no visible log of its own. What happened to a delivery is on the delivery
  # (PROJECT.md 4.13), and a second copy of somebody's event ids in a queue's log is data we would
  # then owe an answer about.
  stackdriver_logging_config {
    sampling_ratio = 0
  }
}

# The identity a task carries, and the only one the dispatcher accepts.
#
# Keyless: Cloud Tasks mints a short-lived OIDC token for this account when it makes the call, and
# `GoogleOidcVerifier` checks the signature, the audience and this email. There is no shared secret
# between the queue and the worker, which is the point — a token nobody stores is a token nobody
# leaks (PROJECT.md 4.11).
resource "google_service_account" "webhook_tasks" {
  count = var.enable_managed_infrastructure ? 1 : 0

  account_id   = "${local.name_prefix}-webhooks"
  display_name = "Webhook retry dispatcher"
  project      = var.project_id
}

# The workers service enqueues, on these queues and no others.
resource "google_cloud_tasks_queue_iam_member" "enqueue" {
  count = var.enable_managed_infrastructure ? 1 : 0


  project  = var.project_id
  location = var.region
  name     = google_cloud_tasks_queue.webhooks[count.index].name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.webhook_tasks[0].email}"
}

# Cloud Tasks mints the task's token by acting as the account above, which it may only do if its own
# service agent is allowed to. Without this binding a task is created and then fails to call anything,
# which is a confusing outage: the queue is healthy, the retries are just never delivered.
#
# The agent is addressed by project number rather than through `google_project_service_identity`,
# which needs the beta provider for this service.
resource "google_service_account_iam_member" "tasks_may_mint_tokens" {
  count = var.enable_managed_infrastructure ? 1 : 0

  service_account_id = google_service_account.webhook_tasks[0].name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.this.number}@gcp-sa-cloudtasks.iam.gserviceaccount.com"
}

# Not here, and deliberately: `roles/run.invoker` on the workers service for this account. The Cloud
# Run services are not declared in this module yet (see README), so the binding has nowhere to attach
# — and granting the invoker role at project level to make this file look finished would hand a
# webhook identity the right to call every service. It belongs with the service.
