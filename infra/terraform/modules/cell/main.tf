terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

locals {
  name_prefix = "idenzy-${var.cell_code}"

  common_labels = {
    app          = "idenzy"
    cell         = var.cell_code
    jurisdiction = lower(var.jurisdiction)
    managed_by   = "terraform"
  }
}

# Per-cell key ring. Per-project signing keys are created inside it at runtime, so a
# compromise of one project's key exposes exactly one tenant (PROJECT.md 4.2).
resource "google_kms_key_ring" "cell" {
  name     = "${local.name_prefix}-ring"
  location = var.region
  project  = var.project_id
}

# Wraps each project's data encryption key for field-level encryption (4.13.4).
resource "google_kms_crypto_key" "dek_wrapping" {
  name     = "${local.name_prefix}-dek-wrapping"
  key_ring = google_kms_key_ring.cell.id
  purpose  = "ENCRYPT_DECRYPT"

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = var.kms_protection_level
  }

  # Keys are never destroyed: ciphertext outlives the decision to stop using a key.
  lifecycle {
    prevent_destroy = true
  }
}

# Private IP only. There is no public path to the database (PROJECT.md 4.11).
#
# `depends_on` the peering rather than merely referencing the network: a private-IP instance cannot
# be created until Private Service Access exists, and the dependency is not visible from the
# attribute reference alone. Without it a first `apply` fails on a race it will win on the retry,
# which is the worst kind of intermittent.
resource "google_sql_database_instance" "primary" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name                = "${local.name_prefix}-pg"
  project             = var.project_id
  region              = var.region
  database_version    = "POSTGRES_17"
  deletion_protection = true

  depends_on = [google_service_networking_connection.private_services]

  settings {
    tier              = var.database_tier
    availability_type = var.database_ha ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    user_labels       = local.common_labels

    ip_configuration {
      ipv4_enabled = false
      # The half that was missing. `ipv4_enabled = false` on its own is an instance with no public
      # address *and* no private one — private-only means reachable from a VPC, so it has to name
      # which. Nothing could have connected to this before.
      private_network = google_compute_network.cell[0].id
      # Even inside the VPC. There is no reason for an unencrypted hop to the database.
      ssl_mode = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      # RPO of 5 minutes or better (PROJECT.md 6.3).
      transaction_log_retention_days = 7
    }

    database_flags {
      # Every policy depends on this being readable per transaction.
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
}

# Roles are cluster-level objects and are created here, not by a schema migration:
# migration 0000 references idenzy_app in its CREATE POLICY statements and therefore
# cannot run on a cluster where the role does not yet exist.
resource "google_sql_user" "app" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name     = "idenzy_app"
  instance = google_sql_database_instance.primary[0].name
  project  = var.project_id
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_user" "owner" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name     = "idenzy_owner"
  instance = google_sql_database_instance.primary[0].name
  project  = var.project_id
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
