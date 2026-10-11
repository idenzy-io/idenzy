# Where a data subject's export bundle lands (PROJECT.md 4.13.6).
#
# An access or portability request has to hand somebody a file, and `data_subject_requests`
# carries an `artifact_uri` for it. Three properties are the whole reason this is not a
# general-purpose bucket:
#
#   - **It deletes itself.** An export is the most concentrated personal data we ever assemble:
#     every field one person has, in one object, behind one URL. `artifact_uri` is classified
#     `Retention.Days30` precisely because of that, and the lifecycle rule below is what makes the
#     classification true rather than aspirational.
#   - **Versioning is off.** A deleted export must be gone, not recoverable — otherwise the
#     retention above is a suggestion.
#   - **Public access is impossible**, not merely absent. Uniform bucket-level access plus the
#     project's public-access prevention means a bundle is reached by a signed URL with a short
#     life, and no misconfigured ACL can turn it into a link that works forever.
#
# It lives in the deployment's own region, like everything else: an export is a copy of
# exactly the data an export bundle should not outlive.
resource "google_storage_bucket" "subject_exports" {
  # Bucket names are global, so they carry the Cloud project's id, which is unique already.
  name     = "${var.project_id}-subject-exports"
  project  = var.project_id
  location = var.region
  labels   = local.common_labels

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = false
  }

  lifecycle_rule {
    condition {
      age = var.subject_export_retention_days
    }
    action {
      type = "Delete"
    }
  }

  # An export bundle is worth encrypting under the deployment's own key where CMEK is on, for the same
  # reason the database is: it is the same data, concentrated.
  dynamic "encryption" {
    for_each = var.enable_cmek ? [1] : []
    content {
      default_kms_key_name = google_kms_crypto_key.dek_wrapping.id
    }
  }
}
