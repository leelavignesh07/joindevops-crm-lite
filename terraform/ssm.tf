# Every value the app needs at boot lives here (or, for the DB password, in
# the Secrets Manager secret RDS manages itself — see rds.tf). Nothing
# sensitive is ever baked into the AMI, user_data, or an EC2 instance's local
# disk: a replacement instance just needs the IAM role below and re-reads
# everything fresh on boot.

locals {
  ssm_prefix = "/${var.project_name}/${var.environment}"
}

resource "aws_ssm_parameter" "nextauth_secret" {
  name  = "${local.ssm_prefix}/NEXTAUTH_SECRET"
  type  = "SecureString"
  value = var.nextauth_secret
}

resource "aws_ssm_parameter" "google_client_id" {
  name  = "${local.ssm_prefix}/GOOGLE_CLIENT_ID"
  type  = "SecureString"
  value = var.google_client_id
}

resource "aws_ssm_parameter" "google_client_secret" {
  name  = "${local.ssm_prefix}/GOOGLE_CLIENT_SECRET"
  type  = "SecureString"
  value = var.google_client_secret
}

resource "aws_ssm_parameter" "allowed_google_workspace_domain" {
  name  = "${local.ssm_prefix}/ALLOWED_GOOGLE_WORKSPACE_DOMAIN"
  type  = "String"
  value = var.allowed_google_workspace_domain
}

resource "aws_ssm_parameter" "ses_from_email" {
  name  = "${local.ssm_prefix}/SES_FROM_EMAIL"
  type  = "String"
  value = var.ses_from_email
}

resource "aws_ssm_parameter" "wati_api_endpoint" {
  name  = "${local.ssm_prefix}/WATI_API_ENDPOINT"
  type  = "SecureString"
  value = var.wati_api_endpoint != "" ? var.wati_api_endpoint : "unset"
}

resource "aws_ssm_parameter" "wati_api_key" {
  name  = "${local.ssm_prefix}/WATI_API_KEY"
  type  = "SecureString"
  value = var.wati_api_key != "" ? var.wati_api_key : "unset"
}

resource "aws_ssm_parameter" "wati_ack_template_name" {
  name  = "${local.ssm_prefix}/WATI_ACK_TEMPLATE_NAME"
  type  = "String"
  value = var.wati_ack_template_name
}

resource "aws_ssm_parameter" "brand_name" {
  name  = "${local.ssm_prefix}/BRAND_NAME"
  type  = "String"
  value = var.brand_name
}

resource "aws_ssm_parameter" "aws_region" {
  name  = "${local.ssm_prefix}/AWS_REGION"
  type  = "String"
  value = var.aws_region
}

resource "aws_ssm_parameter" "nextauth_url" {
  name  = "${local.ssm_prefix}/NEXTAUTH_URL"
  type  = "String"
  value = var.app_domain != "" ? "https://${var.app_domain}" : "http://${aws_eip.app.public_ip}"
}

# Non-secret connection info the bootstrap script needs to assemble
# DATABASE_URL without ever storing the assembled URL (with password) as a
# parameter itself — it's built fresh on each boot from the RDS-managed
# secret plus these.
resource "aws_ssm_parameter" "db_host" {
  name  = "${local.ssm_prefix}/DB_HOST"
  type  = "String"
  value = aws_db_instance.main.address
}

resource "aws_ssm_parameter" "db_name" {
  name  = "${local.ssm_prefix}/DB_NAME"
  type  = "String"
  value = aws_db_instance.main.db_name
}

resource "aws_ssm_parameter" "db_secret_arn" {
  name  = "${local.ssm_prefix}/DB_SECRET_ARN"
  type  = "String"
  value = aws_db_instance.main.master_user_secret[0].secret_arn
}
