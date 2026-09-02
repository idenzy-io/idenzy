variable "project_id" {
  description = "GCP project hosting this cell."
  type        = string
}

variable "cell_code" {
  description = "Short cell identifier, e.g. eu-1. Appears in logs and the region_cells table."
  type        = string
}

variable "region" {
  description = "GCP region. A cell never spans regions; that is the point of a cell."
  type        = string
}

variable "jurisdiction" {
  description = "Data residency jurisdiction this cell serves, e.g. EU, US."
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

    Present and off by default. Enabling it for an enterprise or HIPAA-tier cell is a
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
