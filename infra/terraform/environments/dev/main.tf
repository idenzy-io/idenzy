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
  region  = "europe-west4"
}

# The first cell. europe-west4 versus us-central1 is open decision 2 in PROJECT.md 16.
module "cell_eu_1" {
  source = "../../modules/cell"

  project_id   = var.project_id
  cell_code    = "eu-1"
  region       = "europe-west4"
  jurisdiction = "EU"

  # Dev runs single-zone and scales to zero; production does neither.
  database_ha   = false
  min_instances = 0
}
