# Terraform — one-shot AWS provisioning

Stands up the whole production architecture in one `terraform apply`:

- A dedicated VPC (1 public subnet for the app server, 2 private subnets for RDS)
- **RDS PostgreSQL**, encrypted, in the private subnets, security-group-locked to the app
  server only — never reachable from the internet, and completely independent of the EC2
  instance's lifecycle. Its master password is generated and managed by RDS itself in AWS
  Secrets Manager (`manage_master_user_password = true`) — Terraform and its state file never
  see the plaintext password.
- **AWS Backup**, twice a week (Mon/Thu 03:00 UTC by default, see `backup_schedule_cron`), on
  top of RDS's own daily automated backups — two independent safety nets.
- An **EC2 instance** with an **Elastic IP** that survives replacing the instance underneath it,
  an **IAM instance role** (no long-lived access keys anywhere), and a boot script
  (`templates/user_data.sh.tpl`) that installs Docker, clones the app repo, pulls every secret
  fresh from SSM Parameter Store / Secrets Manager, and starts the app.
- All non-RDS app secrets (NextAuth, Google OAuth, WATI, ...) in **SSM Parameter Store**
  (`SecureString`), scoped to `/joindevops-crm/<environment>/*`.
- Optional **SES** domain identity + DKIM, and Route 53 records, if you pass `app_domain` +
  `route53_zone_id`.

See the repo root's `AWS_SETUP_GUIDE.md` for the equivalent manual (console) walkthrough and the
"replacing a lost instance" runbook — this file only covers running Terraform itself.

## Why this design makes replacing the EC2 instance a non-event

The database, its credentials, and every application secret all live in AWS-managed services
(RDS, Secrets Manager, SSM) that are **not attached to the EC2 instance's lifecycle**. The
instance itself carries no state — it's rebuilt from `user_data` on every boot. So if the
instance is lost, terminated by mistake, or you just want to resize it:

```bash
terraform apply -replace=aws_instance.app
```

Terraform launches a fresh instance, re-attaches the same IAM role and the same Elastic IP
(no DNS change needed), and the boot script re-pulls the DB connection info and every secret
from SSM/Secrets Manager exactly as it did the first time. Nothing to copy by hand.

## Usage

**Easiest path — the repo root `Makefile`** drives Terraform *and* confirms the app actually
came up (Terraform only waits for the EC2 instance to reach "running", not for Docker/nginx/the
app inside it to finish starting):

```bash
cd terraform && cp terraform.tfvars.example terraform.tfvars && $EDITOR terraform.tfvars
cd ..
make deploy   # apply -> wait for SSM -> verify every service is enabled and running -> print a summary
```

See the root `Makefile`'s targets (`make help`) for `plan`, `status` (re-check without changing
anything), `redeploy` (push app updates to the running instance), and `destroy`.

**Or run Terraform directly:**

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: ssh_allowed_cidr, nextauth_secret, google_client_id/secret,
# ses_from_email, wati_*, and app_domain/route53_zone_id/certbot_email if you have them

terraform init
terraform plan   # review what it's about to create
terraform apply
```

Prerequisites:
- An AWS account with credentials configured (`aws configure`, or `AWS_PROFILE`/env vars) with
  permission to create VPC/EC2/RDS/IAM/SSM/SecretsManager/Backup/(SES/Route53) resources.
- `terraform`, the `aws` CLI, and `jq` on your machine (`make check` verifies all three plus your
  AWS credentials before doing anything).
- No EC2 key pair needed — `ec2_key_pair_name` defaults to blank, and access is via SSM Session
  Manager (`terraform output ssh_command`, or `make verify`/`make redeploy` which use it
  directly). Set `ec2_key_pair_name` only if you specifically want SSH too.

After `apply` finishes, run `terraform output` — it prints the app URL, SSH/SSM commands, and a
`next_steps` block (SES production access request, DNS records if needed, certbot command).

### Remote state (recommended once this isn't just a one-off test)

By default this uses local state (a `terraform.tfstate` file on your machine — gitignored, and
a single point of failure for your infrastructure's source of truth). Before this becomes your
real production environment, create an S3 bucket + DynamoDB lock table once, then uncomment the
`backend "s3"` block in `versions.tf` and re-run `terraform init`:

```bash
# us-east-1 is special-cased by S3: do NOT pass --create-bucket-configuration
# there (it errors) — outside us-east-1 you do need it, e.g.
# --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api create-bucket --bucket joindevops-crm-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket joindevops-crm-terraform-state \
  --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name joindevops-crm-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST --region us-east-1
```

### Destroying

`aws_db_instance.main` has `deletion_protection = true` by default — `terraform destroy` will
fail on it until you either set `db_deletion_protection = false` in your tfvars and re-`apply`,
or delete the RDS instance manually first. That's intentional friction for a production database.
