terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment and configure once you've created the bucket/table below so
  # `terraform apply` state is itself durable and shared, not a local file
  # that dies with your laptop:
  #
  # backend "s3" {
  #   bucket         = "joindevops-crm-terraform-state"
  #   key            = "crm-lite/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "joindevops-crm-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "joindevops-crm-lite"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
