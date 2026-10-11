# Where the VPS puts a nightly encrypted dump of Postgres.
#
# Off the box, because a backup on the same disk as the database is lost with it. Three properties
# make it a backup rather than a copy:
#
#   - **The runtime can add a backup and do nothing else.** `objectCreator`, not `objectAdmin`: a
#     compromised box can neither read old backups nor delete them.
#   - **Nobody can delete one for `backup_lock_days`**, not even the project's owner, because the
#     bucket's retention policy says so. Ransomware that reaches the credential still cannot reach
#     last week.
#   - **The dump is encrypted before it leaves the box**, to a public key whose private half is held
#     offline by the operator (docs/guide/deploy.md), so the bucket holds nothing readable either.
#
# The lifecycle rule ages backups out after `backup_retention_days`, which keeps a deleted user's
# data from living on in old dumps forever: an erasure reaches the backups by expiring them.
resource "google_storage_bucket" "backups" {
  name     = "${var.project_id}-backups"
  project  = var.project_id
  location = var.region
  labels   = local.common_labels

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = false
  }

  retention_policy {
    retention_period = var.backup_lock_days * 86400
  }

  lifecycle_rule {
    condition {
      age = var.backup_retention_days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.used]
}

resource "google_storage_bucket_iam_member" "runtime_writes_backups" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.stack_runtime.email}"
}
