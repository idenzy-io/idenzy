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
  description = "The GCP project this cell is provisioned into."
  type        = string
  default     = "idenzy-dev"
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
  cell_code    = "us1"
  region       = "us-central1"
  jurisdiction = "US"

  # Dev runs single-zone and scales to zero; production does neither.
  database_ha   = false
  min_instances = 0
}

/*
 * What this creates, and what it deliberately does not.
 *
 * Stage one is **one high-end VPS** running everything that holds state or serves a request: the
 * APIs, Postgres, Valkey, ClickHouse and the workers. Nothing crosses a network between them, which
 * is why there is no VPC here — a VPC is what Cloud Run needed to reach a private database, and
 * there is neither.
 *
 * So `enable_managed_infrastructure` stays off and this applies exactly three things:
 *
 *   - the **KMS ring** and its DEK-wrapping key, because key custody is the one property that
 *     cannot be rebuilt after a compromise and a key on the box is a key in every snapshot of it;
 *   - the **export bucket**, because a data-subject bundle needs durable storage whose retention
 *     enforces itself, which a directory beside the database is not;
 *   - the **runtime service account** the VPS authenticates as, scoped to those two and nothing
 *     else.
 *
 * Turning the flag on adds Cloud SQL, the VPC and peering it needs, and the Cloud Tasks retry lane.
 * That is the later stage and it needs no application change: ADR-0012's sweeper is a correct
 * deployment rather than a fallback, and every other adapter is already behind a port.
 *
 * Still missing for an actual deploy, on the box rather than here: the KMS issuer. `auth-api`
 * refuses to boot outside development until one exists, so nothing above can serve a request yet.
 */
