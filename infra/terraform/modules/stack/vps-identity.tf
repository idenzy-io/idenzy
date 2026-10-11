# How a deployment that runs outside Google reaches the two things inside it.
#
# Stage one puts the APIs, Postgres, Valkey, ClickHouse and the workers on one VPS. Two things stay
# on Google and only two, each for a reason that is not cost:
#
#   - **KMS**, because key custody is the single property that cannot be rebuilt after a
#     compromise. A signing key on the box is a signing key in every backup of the box, in every
#     snapshot, and in the hands of anybody who ever gets root. PROJECT.md 4.2 rests on the private
#     half never existing in application memory, and that is only true if something else holds it.
#   - **Cloud Storage**, because a data-subject export needs somewhere durable with retention that
#     enforces itself (4.13.6). A directory on the same disk as the database is neither.
#
# Both are ordinary outbound HTTPS calls. Nothing here needs a VPC, a connector, a NAT gateway or
# Cloud Run — those belong to `enable_managed_infrastructure`, and this is what stage one uses
# instead.
resource "google_service_account" "stack_runtime" {
  account_id   = "${local.name_prefix}-runtime"
  project      = var.project_id
  display_name = "Idenzy runtime (off-platform)"
  description  = "Used by the VPS to reach KMS and the export bucket, and nothing else."
}

# Wrap and unwrap with the one key, and nothing else (ADR-0021). Every project's signing key and the
# field-encryption key are stored wrapped by it; the runtime opens them and signs locally, so it
# never needed to sign with KMS. Use, not manage: it cannot create, rotate, disable or destroy the
# key, which is the separation PROJECT.md 4.13.7 asks for between key administrators and key users.
# On the key rather than the ring, so a key added to the ring later is not the runtime's by default.
resource "google_kms_crypto_key_iam_member" "runtime_wraps" {
  crypto_key_id = google_kms_crypto_key.dek_wrapping.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.stack_runtime.email}"
}

# Write an export and hand out a signed link to it. `objectAdmin` rather than `objectCreator`
# because the worker must also be able to delete a bundle a request withdrew before the lifecycle
# rule would have.
#
# Scoped to this bucket, not the project. The runtime has no business reading any other
# bucket, and a project-level grant is how it would come to.
resource "google_storage_bucket_iam_member" "runtime_writes_exports" {
  bucket = google_storage_bucket.subject_exports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.stack_runtime.email}"
}

/*
 * The credential itself is deliberately not here, and that is the one uncomfortable part.
 *
 * A VPS has no metadata server and no OIDC issuer, so there is no workload identity to federate
 * against: reaching this service account means a long-lived JSON key on the box. Which is, read
 * plainly, a secret on the disk that KMS exists to avoid having — so the honest accounting is
 * worth writing down rather than glossing:
 *
 *   - What a stolen key gets is the *use* of the signing key, not the key. It cannot be exported,
 *     the theft is visible in Cloud Audit Logs, and revoking it is one `terraform apply`. A signing
 *     key on the box instead gets copied once and used forever with no trace.
 *   - So the trade is real and it is still strongly favourable. It is not the ideal, and the ideal
 *     arrives with either a GCE instance (metadata server, no key at all) or a federation provider.
 *
 * Terraform deliberately does not create the key: a `google_service_account_key` resource puts the
 * private half in the state file, and the state file is then the most sensitive artifact in the
 * repository. Mint it by hand, put it in the VPS's own secret store, and rotate it on a schedule
 * somebody owns.
 */
