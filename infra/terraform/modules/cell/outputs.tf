output "cell_code" {
  description = "Recorded in the region_cells table so routing can resolve it."
  value       = var.cell_code
}

output "kms_key_ring" {
  description = "Per-project signing keys are created inside this ring."
  value       = google_kms_key_ring.cell.id
}

/*
 * Stage-two outputs answer `null` at stage one rather than failing.
 *
 * `one()` over a counted resource is the idiom: the value where the resource exists, null where it
 * does not. A consumer reading a null here is reading "this cell does not run a managed database",
 * which is a true answer and the one a VPS deployment should get.
 */
output "database_connection_name" {
  description = "Cloud SQL connection name for the Cloud Run connector."
  value       = one(google_sql_database_instance.primary[*].connection_name)
}

output "jurisdiction" {
  description = "Residency jurisdiction, surfaced to customers choosing a cell."
  value       = var.jurisdiction
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
  description = "Self-link of the cell's VPC. What a Cloud Run service attaches Direct VPC egress to."
  value       = one(google_compute_network.cell[*].id)
}

output "subnet" {
  description = "The subnet a Cloud Run revision draws its egress addresses from."
  value       = one(google_compute_subnetwork.cell[*].id)
}

output "subject_export_bucket" {
  description = "Where a data-subject export lands. Read by the DSR worker as SUBJECT_EXPORT_BUCKET."
  value       = google_storage_bucket.subject_exports.name
}

output "runtime_service_account" {
  description = "The identity the VPS running this cell authenticates as. Mint its key by hand; Terraform must not, or the private half lands in state."
  value       = google_service_account.cell_runtime.email
}
