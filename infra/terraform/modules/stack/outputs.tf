output "kms_key_ring" {
  description = "The ring the wrapping key lives in."
  value       = google_kms_key_ring.stack.id
}

output "kms_key_name" {
  description = "KMS_KEY_NAME: wraps every project's signing key and the field-encryption key (ADR-0021)."
  value       = google_kms_crypto_key.dek_wrapping.id
}

output "backup_bucket" {
  description = "Where the nightly encrypted Postgres dump goes."
  value       = google_storage_bucket.backups.name
}

output "secret_names" {
  description = "The secrets to give a value, once, before the first start."
  value       = sort([for secret in google_secret_manager_secret.runtime : secret.secret_id])
}

/*
 * Stage-two outputs answer `null` at stage one rather than failing.
 *
 * `one()` over a counted resource is the idiom: the value where the resource exists, null where it
 * does not. A consumer reading a null here is reading "this deployment does not run a managed database",
 * which is a true answer and the one a VPS deployment should get.
 */
output "database_connection_name" {
  description = "Cloud SQL connection name for the Cloud Run connector."
  value       = one(google_sql_database_instance.primary[*].connection_name)
}

output "webhook_queue_prefix" {
  description = "WEBHOOK_TASKS_QUEUE_PREFIX for the workers service; the shards are -0 to -N."
  value       = "${local.name_prefix}-webhooks"
}

output "webhook_queue_shards" {
  description = "WEBHOOK_TASKS_QUEUE_SHARDS. The worker hashes an endpoint id into this many queues."
  value       = var.webhook_queue_shards
}

output "webhook_tasks_service_account" {
  description = "WEBHOOK_TASKS_SERVICE_ACCOUNT: the identity a retry task carries, and the only one the dispatcher accepts."
  value       = one(google_service_account.webhook_tasks[*].email)
}

output "network" {
  description = "Self-link of the VPC. What a Cloud Run service attaches Direct VPC egress to."
  value       = one(google_compute_network.stack[*].id)
}

output "subnet" {
  description = "The subnet a Cloud Run revision draws its egress addresses from."
  value       = one(google_compute_subnetwork.stack[*].id)
}

output "subject_export_bucket" {
  description = "Where a data-subject export lands. Read by the DSR worker as SUBJECT_EXPORT_BUCKET."
  value       = google_storage_bucket.subject_exports.name
}

output "runtime_service_account" {
  description = "The identity the VPS authenticates as. Mint its key by hand; Terraform must not, or the private half lands in state."
  value       = google_service_account.stack_runtime.email
}
