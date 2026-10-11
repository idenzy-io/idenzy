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
  description = "The GCP project this deployment is provisioned into."
  type        = string
  default     = "idenzy-dev"
}

provider "google" {
  project = var.project_id
  region  = "us-central1"
}

# The deployment. Open decision 2 in PROJECT.md 16 is closed: us-central1.
#
# There is one, and there is no second planned. This was `module "cell_us_1"` from
# `modules/cell`, with a `cell_code` and a `jurisdiction`, back when a project could be
# pinned to a region; residency is not offered (PROJECT.md 4.13.5).
module "stack" {
  source = "../../modules/stack"

  project_id = var.project_id
  region     = "us-central1"

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
 * So `enable_managed_infrastructure` stays off and this applies:
 *
 *   - the **KMS ring** and its wrapping key, because key custody is the one property that cannot
 *     be rebuilt after a compromise and a key on the box is a key in every snapshot of it; every
 *     project's signing key and the field-encryption key are stored wrapped by it (ADR-0021);
 *   - the **export bucket**, because a data-subject bundle needs durable storage whose retention
 *     enforces itself, which a directory beside the database is not;
 *   - the **backup bucket**, append-only for the box and locked for a week;
 *   - the **secrets** the box reads at boot, declared and never valued;
 *   - the **runtime service account** the VPS authenticates as, scoped to those and nothing else.
 *
 * Turning the flag on adds Cloud SQL, the VPC and peering it needs, and the Cloud Tasks retry lane.
 * That is the later stage and it needs no application change: ADR-0012's sweeper is a correct
 * deployment rather than a fallback, and every other adapter is already behind a port.
 */
