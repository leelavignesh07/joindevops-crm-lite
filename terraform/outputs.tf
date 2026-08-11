output "app_public_ip" {
  description = "Stable Elastic IP — use this (or app_domain, once DNS is pointed at it) to reach the app."
  value       = aws_eip.app.public_ip
}

output "app_url" {
  value = var.app_domain != "" ? "https://${var.app_domain}" : "http://${aws_eip.app.public_ip}"
}

output "ec2_instance_id" {
  value = aws_instance.app.id
}

output "rds_endpoint" {
  description = "RDS connection host (no credentials — those live in Secrets Manager, see rds_master_secret_arn)."
  value       = aws_db_instance.main.address
}

output "rds_master_secret_arn" {
  description = "Secrets Manager ARN holding the auto-generated, auto-rotatable RDS master password. Terraform never sees the plaintext password."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}

output "ssm_parameter_path" {
  description = "SSM Parameter Store path prefix holding all non-RDS app config/secrets."
  value       = local.ssm_prefix
}

output "backup_vault_name" {
  value = aws_backup_vault.main.name
}

output "backup_schedule" {
  value = "AWS Backup: ${var.backup_schedule_cron} (retained ${var.backup_retention_days} days) — plus RDS's own daily automated backups (retained ${var.db_backup_retention_days} days)"
}

output "ssh_command" {
  value = "ssh -i /path/to/${var.ec2_key_pair_name}.pem ubuntu@${aws_eip.app.public_ip}   # or: aws ssm start-session --target ${aws_instance.app.id} --region ${var.aws_region}"
}

output "ses_dns_records_needed" {
  description = "Only populated when route53_zone_id is not set — add these at your DNS provider to verify SES."
  value = var.app_domain != "" && var.route53_zone_id == "" ? {
    verification_txt = { name = "_amazonses.${local.ses_domain}", value = aws_ses_domain_identity.main[0].verification_token }
    dkim_cnames      = [for t in aws_ses_domain_dkim.main[0].dkim_tokens : { name = "${t}._domainkey.${local.ses_domain}", value = "${t}.dkim.amazonses.com" }]
  } : null
}

output "next_steps" {
  value = <<-EOT
    1. Request SES production access (still manual — AWS Console > SES > Account dashboard > Request production access).
    2. If app_domain was set but route53_zone_id was not, add the DNS records in ses_dns_records_needed at your DNS provider.
    3. Once DNS resolves to app_public_ip, SSH/SSM in and run:
       sudo certbot --nginx -d ${var.app_domain} --non-interactive --agree-tos -m you@${var.app_domain} --redirect
    4. Sign in at ${var.app_domain != "" ? "https://${var.app_domain}" : "http://${aws_eip.app.public_ip}"} with a
       Google account on ${var.allowed_google_workspace_domain} — the first person to sign in becomes ADMIN.
  EOT
}
