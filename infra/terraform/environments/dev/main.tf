terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
  # No backend configured: nothing here has been applied. See ../../README.md.
}

variable "project_id" {
  type = string
}

provider "google" {
  project = var.project_id
  region  = "us-central1"
}

# The first cell. Open decision 2 in PROJECT.md 16 is closed: us-central1.
#
# The cell code and jurisdiction follow the region rather than the other way round, because
# `projects.cell_id` is immutable once set (PROJECT.md 4.13.5) and a cell labelled EU that
# runs in Iowa would make every residency claim built on that column false.
module "cell_us_1" {
  source = "../../modules/cell"

  project_id   = var.project_id
  cell_code    = "us-1"
  region       = "us-central1"
  jurisdiction = "US"

  # Dev runs single-zone and scales to zero; production does neither.
  database_ha   = false
  min_instances = 0
}
