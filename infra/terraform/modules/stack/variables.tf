variable "project_id" {
  description = "GCP project hosting the deployment."
  type        = string
}

variable "region" {
  description = "GCP region. One region, and everything is in it."
  type        = string
}

variable "database_tier" {
  description = "Cloud SQL machine type."
  type        = string
  default     = "db-custom-2-8192"
}

variable "database_ha" {
  description = "Regional HA. On in production; off in dev to save roughly half the cost."
  type        = bool
  default     = true
}

variable "enable_cmek" {
  description = <<-EOT
    Customer-managed encryption keys on Cloud SQL and storage (PROJECT.md 4.13.4).

    Present and off by default. Enabling it for an enterprise or HIPAA-tier deployment is a
    configuration change rather than a migration, which is the whole reason it exists
    before anyone has asked for it.
  EOT
  type        = bool
  default     = false
}

variable "kms_protection_level" {
  description = "SOFTWARE on the free tier, HSM for paid projects (PROJECT.md 4.2)."
  type        = string
  default     = "SOFTWARE"

  validation {
    condition     = contains(["SOFTWARE", "HSM"], var.kms_protection_level)
    error_message = "kms_protection_level must be SOFTWARE or HSM."
  }
}

variable "min_instances" {
  description = "Cloud Run minimum instances. Above zero in production to avoid cold starts on sign-in."
  type        = number
  default     = 2
}

variable "webhook_queue_shards" {
  description = <<-EOT
    Cloud Tasks queues for webhook retries, sharded by endpoint id (ADR-0012).

    Eight is a pool, not a per-tenant resource: one endpoint's retries always land in the
    same queue, so its dispatch ceiling is one queue's rate rather than the whole pool's.
    Must match WEBHOOK_TASKS_QUEUE_SHARDS in the workers' environment.
  EOT
  type        = number
  default     = 8

  validation {
    condition     = var.webhook_queue_shards >= 1 && var.webhook_queue_shards <= 64
    error_message = "webhook_queue_shards must be between 1 and 64."
  }
}

variable "webhook_queue_dispatches_per_second" {
  description = <<-EOT
    Per-queue dispatch ceiling for retries.

    Fifty a second across eight queues is four hundred, which is peak delivery rate at the
    design volume — and retries are a few per cent of that, so the ceiling exists to bound
    a recovering endpoint's backlog rather than to carry normal traffic.
  EOT
  type        = number
  default     = 50
}

variable "webhook_queue_concurrent_dispatches" {
  description = "Retries in flight per queue. Bounds how much of the worker's pool a queue can hold."
  type        = number
  default     = 100
}

variable "subnet_cidr" {
  description = "The single regional subnet. /20 leaves room for Direct VPC egress, which consumes addresses from it per Cloud Run revision."
  type        = string
  default     = "10.8.0.0/20"
}

variable "subject_export_retention_days" {
  description = <<-EOT
    Days a data-subject export bundle survives before the bucket deletes it.

    Thirty, matching `data_subject_requests.artifact_uri`'s `Retention.Days30` classification. It is
    the most concentrated personal data the system ever produces — every field about one person, in
    one object — so the short life is the point rather than a saving.
  EOT
  type        = number
  default     = 30
}

variable "enable_managed_infrastructure" {
  description = <<-EOT
    Whether the deployment runs on Google's managed services or on a VPS.

    **Off, which is the first production stage.** One high-end VPS runs everything that holds
    state or serves a request: the APIs, Postgres, Valkey, ClickHouse and the workers. Nothing
    crosses a network between them, which is why `assertTransportSecurity` is a no-op there and why
    there is no VPC — Cloud Run is what needed one, and there is no Cloud Run.

    What Google still provides, and what this module creates either way, is the two things that
    should not live on the box: **KMS**, because key custody is the one property that cannot be
    rebuilt after a compromise, and **Cloud Storage**, because a data-subject export needs somewhere
    durable and retention-managed to land. Both are outbound HTTPS calls from the VPS.

    Turning this on adds Cloud SQL, its VPC and Private Service Access peering, and the Cloud Tasks
    retry lane. That is the later stage, when revenue justifies roughly the cost of the managed
    database — and the code needs no change for it, which is the point of the ports (ADR-0012's
    sweeper is a correct deployment, not a fallback).
  EOT
  type        = bool
  default     = false
}
