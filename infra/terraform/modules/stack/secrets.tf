# The secrets a deployment reads at boot, as `secret://<name>` references in its environment
# (PROJECT.md 6.2). Terraform declares each secret and who may read it; it never holds a value, so
# no credential is ever in the state file. The values are added by hand, once, with
# `gcloud secrets versions add <name> --data-file=-` (docs/guide/deploy.md says which and how).
locals {
  runtime_secrets = toset([
    "idenzy-database-url",           # DATABASE_URL, as the runtime login
    "idenzy-database-migration-url", # DATABASE_MIGRATION_URL, as the schema owner
    "idenzy-valkey-url",             # VALKEY_URL
    "idenzy-field-key",              # FIELD_KEY_WRAPPED, from `node dist/bootstrap.js field-key`
    "idenzy-aws-secret-access-key",  # AWS_SECRET_ACCESS_KEY, for SES
    "idenzy-clickhouse-password",    # CLICKHOUSE_PASSWORD, the reader's
    "idenzy-clickhouse-ingest-password",
    "idenzy-clickhouse-owner-password",
    "idenzy-clickhouse-eraser-password",
    "idenzy-operator-google-client-secret",
  ])
}

resource "google_secret_manager_secret" "runtime" {
  for_each  = local.runtime_secrets
  project   = var.project_id
  secret_id = each.value
  labels    = local.common_labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.used]
}

# Read access, secret by secret. Not `secretAccessor` on the project: the runtime has no business
# reading any secret this list does not name.
resource "google_secret_manager_secret_iam_member" "runtime_reads" {
  for_each  = google_secret_manager_secret.runtime
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.stack_runtime.email}"
}
