# AWS Setup Guide — durable data, twice-weekly backups, and a painless recovery story

This is a from-scratch, manual (AWS CLI / console) walkthrough for provisioning this CRM's
production infrastructure so that:

- **The database is never on the EC2 instance.** It's a separate managed RDS PostgreSQL
  instance, in its own private subnets, reachable only from the app server's security group.
  Terminating, replacing, or resizing the EC2 instance has zero effect on it.
- **Every secret the app needs lives in AWS-managed services**, not on the instance's disk or in
  a file you hand-copy around: the RDS master password is generated and rotated by RDS itself in
  **Secrets Manager**, and every other secret (NextAuth, Google OAuth, WATI, ...) lives in **SSM
  Parameter Store**. A replacement EC2 instance needs only an IAM role — nothing to copy by hand.
- **Backups run twice a week** via **AWS Backup**, independent of (and in addition to) RDS's own
  daily automated backups — two separate safety nets with separate retention policies.
- **Losing the EC2 instance is a non-event.** See the recovery runbook near the end: relaunch an
  instance with the same IAM role and boot script, and it reconnects to the same database and
  pulls the same secrets automatically. No DNS change, no credential hunting.

Prefer not to run 40 CLI commands by hand? **`terraform/`** in this repo provisions this exact
architecture in one `terraform apply` — see `terraform/README.md`. This guide is for doing it
by hand (to understand what Terraform is doing, to adapt it to an existing AWS environment, or
if you'd rather not run Terraform at all), and it's the reference this repo's Terraform config
is built from — the resource names below match 1:1 with what's in `terraform/*.tf`.

For steps this guide doesn't repeat (Google OAuth client, WATI account/template, wiring up
Tally/Webflow/Learnyst/Meta Ads lead sources, nginx+certbot config detail), see **`DEPLOYMENT.md`**
— this guide only covers getting the durable-storage-and-recovery architecture stood up; once the
EC2 instance is running, everything in `DEPLOYMENT.md` from "Google Workspace SSO" onward applies
unchanged.

---

## Architecture at a glance

```
                                   ┌─────────────────────────────┐
                                   │   Route 53 / your DNS        │
                                   │   crm.yourdomain.com  ──────┼──► Elastic IP (stable)
                                   └─────────────────────────────┘             │
                                                                                ▼
┌───────────────────────────────────────── VPC (10.42.0.0/16) ─────────────────────────────────────────┐
│                                                                                                          │
│   ┌─────────────── Public subnet ───────────────┐        ┌──────────── Private subnets (2 AZs) ──────┐ │
│   │  EC2 instance (IAM role, no static keys)     │        │  RDS PostgreSQL                            │ │
│   │   - docker: app + worker + redis             │──5432─▶│   - storage_encrypted, Multi-AZ optional   │ │
│   │   - boots via user_data: pulls secrets from  │        │   - master password in Secrets Manager     │ │
│   │     SSM/Secrets Manager, never bakes them in │        │   - daily automated backups (7 days)       │ │
│   └───────────────────────────────────────────────┘        │   - + AWS Backup snapshots 2x/week (35d)  │ │
│                                                              └─────────────────────────────────────────┘ │
│   SSM Parameter Store: /joindevops-crm/prod/*  (NextAuth, Google OAuth, WATI, SES, ...)                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 0. Prerequisites

- AWS CLI v2 installed and configured (`aws configure`) with an account that can create
  VPC/EC2/RDS/IAM/SSM/SecretsManager/Backup/SES resources.
- `jq` installed locally (used to parse CLI JSON output in a couple of places).
- An EC2 key pair for SSH (or skip it and use SSM Session Manager exclusively — this guide sets
  up both).

Set these once and reuse them in every command below:

```bash
export AWS_REGION=us-east-1
export PROJECT=joindevops-crm
export ENVIRONMENT=prod
export MY_IP=$(curl -s ifconfig.me)/32
```

---

## 1. VPC and subnets

```bash
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.42.0.0/16 \
  --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$PROJECT-vpc}]" \
  --query 'Vpc.VpcId' --output text --region $AWS_REGION)
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region $AWS_REGION
aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $AWS_REGION

IGW_ID=$(aws ec2 create-internet-gateway \
  --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$PROJECT-igw}]" \
  --query 'InternetGateway.InternetGatewayId' --output text --region $AWS_REGION)
aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $AWS_REGION

AZ1=$(aws ec2 describe-availability-zones --region $AWS_REGION --query 'AvailabilityZones[0].ZoneName' --output text)
AZ2=$(aws ec2 describe-availability-zones --region $AWS_REGION --query 'AvailabilityZones[1].ZoneName' --output text)

PUBLIC_SUBNET_ID=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.42.0.0/24 \
  --availability-zone $AZ1 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-public}]" \
  --query 'Subnet.SubnetId' --output text --region $AWS_REGION)
aws ec2 modify-subnet-attribute --subnet-id $PUBLIC_SUBNET_ID --map-public-ip-on-launch --region $AWS_REGION

PRIVATE_SUBNET_A=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.42.10.0/24 \
  --availability-zone $AZ1 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-private-a}]" \
  --query 'Subnet.SubnetId' --output text --region $AWS_REGION)
PRIVATE_SUBNET_B=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.42.11.0/24 \
  --availability-zone $AZ2 --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$PROJECT-private-b}]" \
  --query 'Subnet.SubnetId' --output text --region $AWS_REGION)

RT_ID=$(aws ec2 create-route-table --vpc-id $VPC_ID \
  --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$PROJECT-public-rt}]" \
  --query 'RouteTable.RouteTableId' --output text --region $AWS_REGION)
aws ec2 create-route --route-table-id $RT_ID --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $AWS_REGION
aws ec2 associate-route-table --route-table-id $RT_ID --subnet-id $PUBLIC_SUBNET_ID --region $AWS_REGION

aws rds create-db-subnet-group --db-subnet-group-name $PROJECT-db-subnets \
  --db-subnet-group-description "$PROJECT RDS subnets" \
  --subnet-ids $PRIVATE_SUBNET_A $PRIVATE_SUBNET_B --region $AWS_REGION
```

Save the IDs printed above (or re-derive them with `aws ec2 describe-vpcs --filters
"Name=tag:Name,Values=$PROJECT-vpc"` etc.) — you'll need `$VPC_ID`, `$PUBLIC_SUBNET_ID` again
below.

---

## 2. Security groups

```bash
EC2_SG_ID=$(aws ec2 create-security-group --group-name $PROJECT-ec2-sg \
  --description "App server" --vpc-id $VPC_ID --query 'GroupId' --output text --region $AWS_REGION)
aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 22  --cidr $MY_IP --region $AWS_REGION
aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 80  --cidr 0.0.0.0/0 --region $AWS_REGION
aws ec2 authorize-security-group-ingress --group-id $EC2_SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $AWS_REGION

RDS_SG_ID=$(aws ec2 create-security-group --group-name $PROJECT-rds-sg \
  --description "Postgres, app-server only" --vpc-id $VPC_ID --query 'GroupId' --output text --region $AWS_REGION)
aws ec2 authorize-security-group-ingress --group-id $RDS_SG_ID --protocol tcp --port 5432 \
  --source-group $EC2_SG_ID --region $AWS_REGION
```

`RDS_SG_ID` has **no** inbound rule from `0.0.0.0/0` — Postgres is never reachable from the
internet, only from `EC2_SG_ID`.

---

## 3. RDS PostgreSQL (outside the instance, password managed by AWS)

`--manage-master-user-password` tells RDS to generate the master password itself and store it in
Secrets Manager — you (and Terraform, if you use it) never see or handle the plaintext password.

```bash
aws rds create-db-instance \
  --db-instance-identifier $PROJECT-$ENVIRONMENT \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro \
  --allocated-storage 20 --max-allocated-storage 100 --storage-type gp3 --storage-encrypted \
  --db-name crm --master-username crm_admin --manage-master-user-password \
  --db-subnet-group-name $PROJECT-db-subnets --vpc-security-group-ids $RDS_SG_ID \
  --backup-retention-period 7 --preferred-backup-window "17:00-17:30" \
  --preferred-maintenance-window "sun:18:00-sun:19:00" \
  --no-publicly-accessible --deletion-protection --copy-tags-to-snapshot \
  --region $AWS_REGION
```

`--multi-az` adds automatic failover to a standby in a second AZ (roughly doubles RDS cost) —
add it once this is handling real revenue; skip it for now.

Wait for it to come up (takes 5-10 minutes), then capture its endpoint and the Secrets Manager
ARN holding its password:

```bash
aws rds wait db-instance-available --db-instance-identifier $PROJECT-$ENVIRONMENT --region $AWS_REGION

DB_HOST=$(aws rds describe-db-instances --db-instance-identifier $PROJECT-$ENVIRONMENT \
  --query 'DBInstances[0].Endpoint.Address' --output text --region $AWS_REGION)
DB_SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier $PROJECT-$ENVIRONMENT \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text --region $AWS_REGION)
echo "DB_HOST=$DB_HOST"
echo "DB_SECRET_ARN=$DB_SECRET_ARN"
```

---

## 4. IAM role for the EC2 instance

One role, attached by instance *profile* — when you replace the instance later, you attach the
same profile and it has everything it needs again.

```bash
cat > /tmp/ec2-trust-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": {"Service": "ec2.amazonaws.com"}, "Action": "sts:AssumeRole" }]
}
JSON
aws iam create-role --role-name $PROJECT-$ENVIRONMENT-ec2-role \
  --assume-role-policy-document file:///tmp/ec2-trust-policy.json

# SSM Session Manager — shell into the instance from the AWS Console/CLI, no SSH key needed.
aws iam attach-role-policy --role-name $PROJECT-$ENVIRONMENT-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SSM_PREFIX="/$PROJECT/$ENVIRONMENT"

cat > /tmp/app-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "SendAcknowledgementEmail", "Effect": "Allow", "Action": ["ses:SendEmail","ses:SendRawEmail"], "Resource": "*" },
    { "Sid": "ReadAppConfig", "Effect": "Allow", "Action": ["ssm:GetParameter","ssm:GetParameters","ssm:GetParametersByPath"],
      "Resource": "arn:aws:ssm:$AWS_REGION:$ACCOUNT_ID:parameter$SSM_PREFIX/*" },
    { "Sid": "ReadDbMasterPassword", "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "$DB_SECRET_ARN" },
    { "Sid": "DecryptViaSsmOrSecretsManager", "Effect": "Allow", "Action": "kms:Decrypt", "Resource": "*",
      "Condition": { "StringEquals": { "kms:ViaService": ["ssm.$AWS_REGION.amazonaws.com","secretsmanager.$AWS_REGION.amazonaws.com"] } } }
  ]
}
JSON
aws iam put-role-policy --role-name $PROJECT-$ENVIRONMENT-ec2-role \
  --policy-name $PROJECT-$ENVIRONMENT-app-policy --policy-document file:///tmp/app-policy.json

aws iam create-instance-profile --instance-profile-name $PROJECT-$ENVIRONMENT-ec2-profile
aws iam add-role-to-instance-profile --instance-profile-name $PROJECT-$ENVIRONMENT-ec2-profile \
  --role-name $PROJECT-$ENVIRONMENT-ec2-role
sleep 10 # instance profiles take a few seconds to propagate before EC2 can use them
```

---

## 5. Application secrets in SSM Parameter Store

Every value here is something the boot script reads at startup — nothing is ever written to the
instance's disk except the assembled `.env` file, which is regenerated from scratch (from these
parameters) every time the instance boots.

```bash
put() { aws ssm put-parameter --region $AWS_REGION --name "$SSM_PREFIX/$1" --value "$2" --type "$3" --overwrite; }

put NEXTAUTH_SECRET "$(openssl rand -base64 32)" SecureString
put GOOGLE_CLIENT_ID "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID" SecureString
put GOOGLE_CLIENT_SECRET "REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_SECRET" SecureString
put ALLOWED_GOOGLE_WORKSPACE_DOMAIN "joindevops.com" String
put SES_FROM_EMAIL "admissions@joindevops.com" String
put WATI_API_ENDPOINT "https://live-mt-server.wati.io/REPLACE_WITH_TENANT_ID" SecureString
put WATI_API_KEY "REPLACE_WITH_WATI_API_KEY" SecureString
put WATI_ACK_TEMPLATE_NAME "lead_acknowledgement" String
put BRAND_NAME "JoinDevOps" String
put AWS_REGION "$AWS_REGION" String
put DB_HOST "$DB_HOST" String
put DB_NAME "crm" String
put DB_SECRET_ARN "$DB_SECRET_ARN" String
# NEXTAUTH_URL: set to your Elastic IP for now (step 6), update to https://your-domain once DNS is live:
# put NEXTAUTH_URL "http://<elastic-ip>" String
```

See `DEPLOYMENT.md` §5–6 for where `GOOGLE_CLIENT_ID`/`SECRET` and the `WATI_*` values come from.

---

## 6. EC2 instance, Elastic IP, and the boot script

The boot script is `terraform/templates/user_data.sh.tpl` in this repo — it's plain bash with a
couple of `${...}` placeholders Terraform fills in; for a manual launch, just substitute them
yourself:

```bash
sed -e "s|\${aws_region}|$AWS_REGION|g" \
    -e "s|\${ssm_prefix}|$SSM_PREFIX|g" \
    -e "s|\${app_repo_url}|https://github.com/leelavignesh07/joindevops-crm-lite.git|g" \
    -e "s|\${app_repo_ref}|main|g" \
    terraform/templates/user_data.sh.tpl > /tmp/user_data.sh

AMI_ID=$(aws ec2 describe-images --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" "Name=virtualization-type,Values=hvm" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text --region $AWS_REGION)

INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID --instance-type t3.small \
  --key-name YOUR_EXISTING_KEY_PAIR_NAME \
  --subnet-id $PUBLIC_SUBNET_ID --security-group-ids $EC2_SG_ID \
  --iam-instance-profile Name=$PROJECT-$ENVIRONMENT-ec2-profile \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true}}]' \
  --user-data file:///tmp/user_data.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT-$ENVIRONMENT-app}]" \
  --query 'Instances[0].InstanceId' --output text --region $AWS_REGION)

aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION

EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$PROJECT-$ENVIRONMENT-eip}]" \
  --query 'AllocationId' --output text --region $AWS_REGION)
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP_ALLOC --region $AWS_REGION
ELASTIC_IP=$(aws ec2 describe-addresses --allocation-ids $EIP_ALLOC --query 'Addresses[0].PublicIp' --output text --region $AWS_REGION)
echo "App will be reachable at: http://$ELASTIC_IP  (once boot finishes, ~3-5 minutes)"

put NEXTAUTH_URL "http://$ELASTIC_IP" String  # update to https://your-domain once DNS/certbot are set up
```

The boot script installs Docker, clones this repo, builds `.env` from the SSM parameters + the
RDS-managed secret, runs `docker compose -f docker-compose.prod.yml --env-file .env up -d
--build` (which runs `prisma migrate deploy` before starting), seeds default templates, and
configures nginx as a reverse proxy on port 80. Watch it happen:

```bash
aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION
# once connected:
sudo tail -f /var/log/cloud-init-output.log
```

Once DNS points `crm.yourdomain.com` at `$ELASTIC_IP`, follow `DEPLOYMENT.md` §4.3 to run
certbot for HTTPS (same nginx config this script installs).

---

## 7. AWS Backup — twice-weekly snapshots

This is **on top of** RDS's own daily automated backups (step 3's `--backup-retention-period 7`)
— an independent vault, independent schedule, independent retention.

```bash
aws backup create-backup-vault --backup-vault-name $PROJECT-$ENVIRONMENT-vault --region $AWS_REGION

cat > /tmp/backup-trust-policy.json <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [{ "Effect": "Allow", "Principal": {"Service": "backup.amazonaws.com"}, "Action": "sts:AssumeRole" }]
}
JSON
aws iam create-role --role-name $PROJECT-$ENVIRONMENT-backup-role \
  --assume-role-policy-document file:///tmp/backup-trust-policy.json
aws iam attach-role-policy --role-name $PROJECT-$ENVIRONMENT-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup
aws iam attach-role-policy --role-name $PROJECT-$ENVIRONMENT-backup-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores
BACKUP_ROLE_ARN=$(aws iam get-role --role-name $PROJECT-$ENVIRONMENT-backup-role --query 'Role.Arn' --output text)

cat > /tmp/backup-plan.json <<JSON
{
  "BackupPlanName": "$PROJECT-$ENVIRONMENT-plan",
  "Rules": [{
    "RuleName": "twice-weekly",
    "TargetBackupVaultName": "$PROJECT-$ENVIRONMENT-vault",
    "ScheduleExpression": "cron(0 3 ? * MON,THU *)",
    "StartWindowMinutes": 60,
    "CompletionWindowMinutes": 180,
    "Lifecycle": { "DeleteAfterDays": 35 }
  }]
}
JSON
PLAN_ID=$(aws backup create-backup-plan --backup-plan file:///tmp/backup-plan.json \
  --query 'BackupPlanId' --output text --region $AWS_REGION)

DB_ARN=$(aws rds describe-db-instances --db-instance-identifier $PROJECT-$ENVIRONMENT \
  --query 'DBInstances[0].DBInstanceArn' --output text --region $AWS_REGION)

cat > /tmp/backup-selection.json <<JSON
{ "SelectionName": "$PROJECT-$ENVIRONMENT-rds-selection", "IamRoleArn": "$BACKUP_ROLE_ARN", "Resources": ["$DB_ARN"] }
JSON
aws backup create-backup-selection --backup-plan-id $PLAN_ID \
  --backup-selection file:///tmp/backup-selection.json --region $AWS_REGION
```

`cron(0 3 ? * MON,THU *)` = every Monday and Thursday at 03:00 UTC. Adjust the days/time to
taste (AWS Backup's cron format, always UTC).

Check it's wired up: **AWS Console → Backup → Backup plans → `joindevops-crm-prod-plan`** should
show the RDS instance as a protected resource, next run within the next few days.

---

## Recovery runbook 1 — the EC2 instance is gone

Nothing on the instance was load-bearing. Relaunch one:

```bash
# Reuse the same command from step 6 — same AMI lookup, same security group,
# same instance profile, same user_data script. A brand-new instance ID comes
# up, boots, pulls the same secrets from SSM/Secrets Manager, and connects to
# the same RDS database with all your leads intact.
INSTANCE_ID=$(aws ec2 run-instances --image-id $AMI_ID --instance-type t3.small \
  --key-name YOUR_EXISTING_KEY_PAIR_NAME --subnet-id $PUBLIC_SUBNET_ID \
  --security-group-ids $EC2_SG_ID --iam-instance-profile Name=$PROJECT-$ENVIRONMENT-ec2-profile \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true}}]' \
  --user-data file:///tmp/user_data.sh \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT-$ENVIRONMENT-app}]" \
  --query 'Instances[0].InstanceId' --output text --region $AWS_REGION)
aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $AWS_REGION

# Re-point the existing Elastic IP at it — same public IP, so DNS doesn't need touching:
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $EIP_ALLOC --region $AWS_REGION --allow-reassociation
```

That's the entire recovery procedure. No database credentials to dig up, no `.env` file to
reconstruct from memory, no DNS changes — the new instance is indistinguishable from the old one
within a few minutes of boot.

(If you used Terraform instead: this is just `terraform apply -replace=aws_instance.app`.)

## Recovery runbook 2 — restoring from a backup (data loss / corruption, not just a lost instance)

Restoring RDS (from either its own automated backups or an AWS Backup recovery point) always
creates a **new** DB instance with a new endpoint and a new Secrets Manager secret — the old one
is left untouched so you can compare/verify before cutting over.

```bash
# Option A: point-in-time restore from RDS's own daily backups (any second in the last 7 days)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier $PROJECT-$ENVIRONMENT \
  --target-db-instance-identifier $PROJECT-$ENVIRONMENT-restored \
  --restore-time "2026-08-10T03:00:00Z" \
  --db-subnet-group-name $PROJECT-db-subnets --vpc-security-group-ids $RDS_SG_ID \
  --region $AWS_REGION

# Option B: restore a specific twice-weekly AWS Backup recovery point
aws backup list-recovery-points-by-backup-vault --backup-vault-name $PROJECT-$ENVIRONMENT-vault --region $AWS_REGION
aws backup start-restore-job --recovery-point-arn <ARN_FROM_ABOVE> \
  --iam-role-arn $BACKUP_ROLE_ARN \
  --metadata "{\"DBInstanceIdentifier\":\"$PROJECT-$ENVIRONMENT-restored\",\"DBSubnetGroupName\":\"$PROJECT-db-subnets\",\"VpcSecurityGroupIds\":\"$RDS_SG_ID\"}" \
  --region $AWS_REGION
```

Then, once the restored instance is available, point the app at it:

```bash
aws rds wait db-instance-available --db-instance-identifier $PROJECT-$ENVIRONMENT-restored --region $AWS_REGION
NEW_DB_HOST=$(aws rds describe-db-instances --db-instance-identifier $PROJECT-$ENVIRONMENT-restored \
  --query 'DBInstances[0].Endpoint.Address' --output text --region $AWS_REGION)
NEW_DB_SECRET_ARN=$(aws rds describe-db-instances --db-instance-identifier $PROJECT-$ENVIRONMENT-restored \
  --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text --region $AWS_REGION)

put DB_HOST "$NEW_DB_HOST" String
put DB_SECRET_ARN "$NEW_DB_SECRET_ARN" String

# Also grant the EC2 role access to the *new* secret (its ARN is different from the original):
# update /tmp/app-policy.json's ReadDbMasterPassword Resource to $NEW_DB_SECRET_ARN, then:
aws iam put-role-policy --role-name $PROJECT-$ENVIRONMENT-ec2-role \
  --policy-name $PROJECT-$ENVIRONMENT-app-policy --policy-document file:///tmp/app-policy.json

# Re-run the boot script on the running instance to pick up the new DB (or just reboot it —
# user_data reruns on every boot):
aws ec2 reboot-instances --instance-ids $INSTANCE_ID --region $AWS_REGION
```

Once you've confirmed the restored data looks right, you can rename/delete the old RDS instance
and rename `-restored` to the original identifier if you want the naming to match again.

---

## Cost snapshot (us-east-1, on-demand, low volume)

| Resource | Approx. monthly cost |
|---|---|
| EC2 `t3.small` | ~$15 |
| RDS `db.t4g.micro`, single-AZ, 20GB gp3 | ~$13 |
| AWS Backup (twice-weekly, ~20GB snapshots, 35-day retention) | ~$2–4 |
| SES | ~$0.10 per 1,000 emails |
| Elastic IP (attached) | $0 (AWS only charges for *unattached* EIPs) |
| SSM Parameter Store (standard tier, this many params) | $0 |
| Route 53 hosted zone (if used) | ~$0.50 |

**~$30–35/month**, plus SES usage. Multi-AZ RDS roughly doubles the RDS line item.
