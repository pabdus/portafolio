terraform {
  required_version = ">= 1.10"

  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Configuración parcial: el bucket va en backend.hcl (no versionado).
  #   terraform -chdir=infra init -backend-config=backend.hcl
  backend "s3" {
    key          = "portafolio/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region  = var.region # us-east-1: CloudFront exige el certificado ACM en esta región
  profile = var.aws_profile

  default_tags {
    tags = { Project = "portafolio", ManagedBy = "terraform" }
  }
}
