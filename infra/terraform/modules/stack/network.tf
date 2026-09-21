# The network. **Stage two, not stage one** — every resource here is behind
# `enable_managed_infrastructure` and creates nothing by default.
#
# Stage one is one high-end VPS running the APIs, Postgres, Valkey, ClickHouse and the workers, so
# there is no Cloud Run and therefore nothing that needs a VPC. This file is what a move to Cloud
# SQL requires, kept whole so that move is a variable rather than a design session.
#
# Cloud Run needs no VPC of its own: its egress goes to the internet by default, which is all that
# SES, Twilio, Stripe and every OAuth provider require. What needs a VPC is the other direction —
# reaching a database that has no public address.
#
# `main.tf` declares Cloud SQL with `ipv4_enabled = false`, and Memorystore has no public endpoint
# at all by design. Private IP means "reachable only from a VPC", so without one there is no path
# to either. The instance as written before this file existed had `ipv4_enabled = false` and no
# `private_network`: private-only, attached to nothing, reachable from nowhere.
#
# Cost, since it is the question this usually raises: the network, its subnet, firewall rules and
# the Private Service Access peering below are **free**. What costs money is choosing the wrong
# mechanism to reach them, and there are two such choices — both taken here, both documented where
# they are made: Direct VPC egress rather than a Serverless VPC Access connector, and
# private-ranges-only egress rather than a Cloud NAT gateway.

resource "google_compute_network" "stack" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name                    = "${local.name_prefix}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  description             = "One deployment, one network. No route to each other."
}

# A single regional subnet: the deployment is one region, so neither does its subnet.
#
# `private_ip_google_access` lets workloads reach Google APIs — Cloud Storage for a data-subject
# export, KMS for a signing call — without a public address and without a NAT gateway. That is the
# first of the two cost decisions.
resource "google_compute_subnetwork" "stack" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name                     = "${local.name_prefix}-subnet"
  project                  = var.project_id
  region                   = var.region
  network                  = google_compute_network.stack[0].id
  ip_cidr_range            = var.subnet_cidr
  private_ip_google_access = true
}

# The range Google's managed services get inside our network. Cloud SQL's private IP is allocated
# from here, and so is Memorystore's when it lands.
resource "google_compute_global_address" "private_services" {
  count = var.enable_managed_infrastructure ? 1 : 0

  name          = "${local.name_prefix}-private-services"
  project       = var.project_id
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.stack[0].id
}

# The peering itself. This is what turns `ipv4_enabled = false` from an instance with no route into
# one reachable from this network and nowhere else.
resource "google_service_networking_connection" "private_services" {
  count = var.enable_managed_infrastructure ? 1 : 0

  network                 = google_compute_network.stack[0].id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services[0].name]
}
