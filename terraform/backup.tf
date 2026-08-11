# RDS already takes its own daily automated backups (db_backup_retention_days,
# see rds.tf) for point-in-time recovery. This is a second, independent
# safety net: AWS Backup takes a full snapshot twice a week (Mon/Thu by
# default) into its own vault with its own retention, so a mistake that
# somehow corrupts or disables the RDS-native backups (or a retention window
# that's too short) doesn't leave you exposed.

resource "aws_backup_vault" "main" {
  name = "${var.project_name}-${var.environment}-vault"
}

resource "aws_backup_plan" "main" {
  name = "${var.project_name}-${var.environment}-plan"

  rule {
    rule_name         = "twice-weekly"
    target_vault_name = aws_backup_vault.main.name
    schedule          = var.backup_schedule_cron
    start_window      = 60  # minutes to start before giving up
    completion_window = 180 # minutes to finish before it's marked failed

    lifecycle {
      delete_after = var.backup_retention_days
    }
  }
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.project_name}-${var.environment}-backup-role"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "backup_restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_backup_selection" "rds" {
  name         = "${var.project_name}-${var.environment}-rds-selection"
  plan_id      = aws_backup_plan.main.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = [aws_db_instance.main.arn]
}
