# The Google APIs a stage-one deployment calls. Declared rather than clicked, so a new project is one
# `terraform apply` from usable and an API somebody switched off is put back by the next one.
#
# `disable_on_destroy = false`: destroying this module must not switch an API off under anything
# else in the project that uses it.
resource "google_project_service" "used" {
  for_each = toset([
    "cloudkms.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
