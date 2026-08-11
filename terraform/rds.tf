# PostgreSQL lives entirely outside the EC2 instance. Losing, replacing, or
# resizing the EC2 instance never touches this — and the master password is
# never generated or stored by Terraform (manage_master_user_password lets
# RDS create and rotate it in AWS Secrets Manager for you).

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 5 # allow autoscaling up to 5x before you need to act
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name                     = "crm"
  username                    = "crm_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false

  backup_retention_period   = var.db_backup_retention_days
  backup_window             = "17:00-17:30" # UTC ~ 22:30 IST, low-traffic window
  maintenance_window        = "sun:18:00-sun:19:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project_name}-${var.environment}-final"

  apply_immediately = false

  tags = { Name = "${var.project_name}-${var.environment}-db" }
}
