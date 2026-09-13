output "cell_code" {
  description = "Recorded in the region_cells table so routing can resolve it."
  value       = var.cell_code
}

output "kms_key_ring" {
  description = "Per-project signing keys are created inside this ring."
  value       = google_kms_key_ring.cell.id
}

output "database_connection_name" {
  description = "Cloud SQL connection name for the Cloud Run connector."
  value       = google_sql_database_instance.primary.connection_name
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
  value       = google_service_account.webhook_tasks.email
}
