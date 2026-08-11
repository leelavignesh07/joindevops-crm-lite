#!/usr/bin/env bash
# Waits for the EC2 instance to register with SSM Session Manager — the
# earliest point at which we can run remote commands on it (make verify/
# redeploy need this). Since no key pair is attached by default, this is
# also effectively "wait until there's any way to reach the instance."
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="$(terraform output -raw aws_region)"
INSTANCE_ID="$(terraform output -raw ec2_instance_id)"

echo "Waiting for $INSTANCE_ID to register with SSM (usually 1-3 minutes after 'terraform apply' finishes)..."
for i in $(seq 1 60); do
  STATUS="$(aws ssm describe-instance-information --region "$REGION" \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || echo "None")"
  if [ "$STATUS" = "Online" ]; then
    echo "SSM agent online on $INSTANCE_ID."
    exit 0
  fi
  sleep 5
done

cat <<MSG
Timed out after 5 minutes waiting for the SSM agent to come online on $INSTANCE_ID.

This usually means one of:
  - The AMI doesn't ship amazon-ssm-agent and the boot script's defensive
    install failed (check the EC2 console's instance system log, or if you
    have a key pair configured, SSH in and check
    /var/log/cloud-init-output.log).
  - The instance has no outbound internet access to reach the SSM endpoints
    (check the public subnet's route table and the instance's security group).

No key pair is attached by default (ec2_key_pair_name), so without SSM there
is currently no way to log into the instance at all — see AWS_SETUP_GUIDE.md
if you need to add SSH access as a fallback.
MSG
exit 1
