# Production: stage one, a VPS with KMS, Secret Manager and Cloud Storage on Google
# (modules/stack/outputs.tf). One `terraform apply` from an empty Cloud project; the steps around it
# are in docs/guide/deploy.md.
terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  description = "The Cloud project production lives in. No default: production is never a guess."
  type        = string
}

variable "region" {
  description = <<-EOT
    Where the keys, secrets and backups live. Frankfurt by default, beside a VPS in Germany, so a
    boot's KMS and Secret Manager calls stay short and the data stays in the EU region it is
    offered in.
  EOT
  type        = string
  default     = "europe-west3"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "stack" {
  source = "../../modules/stack"

  project_id = var.project_id
  region     = var.region
}

output "kms_key_name" {
  value = module.stack.kms_key_name
}

output "runtime_service_account" {
  value = module.stack.runtime_service_account
}

output "backup_bucket" {
  value = module.stack.backup_bucket
}

output "secret_names" {
  value = module.stack.secret_names
}
