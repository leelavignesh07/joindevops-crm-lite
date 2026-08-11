resource "aws_instance" "app" {
  ami                         = var.ami_id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.ec2.id]
  iam_instance_profile        = aws_iam_instance_profile.app.name
  key_name                    = var.ec2_key_pair_name != "" ? var.ec2_key_pair_name : null
  associate_public_ip_address = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ec2_root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  # Every value here is either public config or an SSM path — never a
  # secret — precisely so a replacement instance needs nothing copied by
  # hand. See templates/user_data.sh.tpl.
  user_data = templatefile("${path.module}/templates/user_data.sh.tpl", {
    aws_region    = var.aws_region
    ssm_prefix    = local.ssm_prefix
    app_repo_url  = var.app_repo_url
    app_repo_ref  = var.app_repo_ref
    app_domain    = var.app_domain
    certbot_email = var.certbot_email
  })
  user_data_replace_on_change = true

  # Wait for RDS, every SSM parameter the boot script reads, and (if set) the
  # Route 53 record for app_domain, so DNS already resolves to this
  # instance's Elastic IP by the time the boot script tries to request a
  # certificate for it.
  depends_on = [
    aws_db_instance.main,
    aws_ssm_parameter.db_host,
    aws_ssm_parameter.db_name,
    aws_ssm_parameter.db_secret_arn,
    aws_ssm_parameter.nextauth_secret,
    aws_ssm_parameter.nextauth_url,
    aws_ssm_parameter.google_client_id,
    aws_ssm_parameter.google_client_secret,
    aws_ssm_parameter.allowed_google_workspace_domain,
    aws_ssm_parameter.ses_from_email,
    aws_ssm_parameter.wati_api_endpoint,
    aws_ssm_parameter.wati_api_key,
    aws_ssm_parameter.wati_ack_template_name,
    aws_ssm_parameter.brand_name,
    aws_ssm_parameter.aws_region,
    aws_route53_record.app,
  ]

  tags = { Name = "${var.project_name}-${var.environment}-app" }
}

# A stable public IP that survives replacing the instance underneath it —
# terminate aws_instance.app and let Terraform recreate it (or `terraform
# taint` + `apply`), and this IP re-attaches to the new one automatically.
# No DNS change needed.
resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-${var.environment}-eip" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}
