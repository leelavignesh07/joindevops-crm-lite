# ---------- General ----------

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "environment" {
  description = "Short environment name used in tags/parameter paths (e.g. prod, staging)."
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Short name used as a prefix for resource names."
  type        = string
  default     = "joindevops-crm"
}

# ---------- Networking ----------

variable "vpc_cidr" {
  description = "CIDR block for the VPC created for this app."
  type        = string
  default     = "10.42.0.0/16"
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to SSH into the EC2 instance (port 22). Set this to YOUR_IP/32 — never leave it open to 0.0.0.0/0."
  type        = string
}

# ---------- EC2 ----------

variable "instance_type" {
  description = "EC2 instance type running the app + worker containers."
  type        = string
  default     = "t3.small"
}

variable "ec2_root_volume_gb" {
  description = "Root EBS volume size (GB) for the EC2 instance."
  type        = number
  default     = 30
}

variable "ec2_key_pair_name" {
  description = "Name of an existing EC2 key pair to attach for SSH access (create one in the EC2 console first)."
  type        = string
}

variable "app_repo_url" {
  description = "Git URL the EC2 instance clones on boot (and on every replacement)."
  type        = string
  default     = "https://github.com/leelavignesh07/joindevops-crm-lite.git"
}

variable "app_repo_ref" {
  description = "Git branch/tag the EC2 instance checks out."
  type        = string
  default     = "main"
}

# ---------- RDS (PostgreSQL) ----------

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is enough for a lite CRM; go up if lead volume grows."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage_gb" {
  description = "RDS allocated storage in GB (gp3)."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "Run RDS Multi-AZ for automatic failover. Roughly doubles RDS cost — turn on once this is handling real revenue."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "RDS built-in automated (daily) backup retention window, in days. Separate from the twice-weekly AWS Backup plan below."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Prevent RDS from being deleted by a stray `terraform destroy` or console click. Keep true in production."
  type        = bool
  default     = true
}

# ---------- Backups (AWS Backup, on top of RDS's own daily backups) ----------

variable "backup_schedule_cron" {
  description = "AWS Backup schedule (cron, UTC). Default: twice weekly, Monday and Thursday at 03:00 UTC."
  type        = string
  default     = "cron(0 3 ? * MON,THU *)"
}

variable "backup_retention_days" {
  description = "How long AWS Backup keeps each twice-weekly snapshot before deleting it."
  type        = number
  default     = 35
}

# ---------- Application secrets (written to SSM Parameter Store, never into the AMI/image) ----------

variable "nextauth_secret" {
  description = "NextAuth session secret. Generate with `openssl rand -base64 32`."
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth client ID for Workspace SSO."
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret for Workspace SSO."
  type        = string
  sensitive   = true
}

variable "allowed_google_workspace_domain" {
  description = "Google Workspace domain employees must sign in with."
  type        = string
  default     = "joindevops.com"
}

variable "ses_from_email" {
  description = "Verified SES sender address for acknowledgement emails."
  type        = string
  default     = "admissions@joindevops.com"
}

variable "wati_api_endpoint" {
  description = "WATI tenant API endpoint, e.g. https://live-mt-server.wati.io/123456"
  type        = string
  sensitive   = true
  default     = ""
}

variable "wati_api_key" {
  description = "WATI API key."
  type        = string
  sensitive   = true
  default     = ""
}

variable "wati_ack_template_name" {
  description = "Name of the WATI-approved WhatsApp template used for acknowledgements."
  type        = string
  default     = "lead_acknowledgement"
}

variable "brand_name" {
  description = "Brand name used in message templates."
  type        = string
  default     = "JoinDevOps"
}

variable "app_domain" {
  description = "Public domain the app will be served on, e.g. crm.joindevops.com. Leave blank to skip Route 53/SES DNS automation and use the Elastic IP directly for now."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone ID for app_domain's parent domain (required only if app_domain is set and you want DNS + SES verification records created automatically)."
  type        = string
  default     = ""
}
