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
