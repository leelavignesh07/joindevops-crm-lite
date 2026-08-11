#!/usr/bin/env bash
# Pulls the latest app_repo_ref and rebuilds/restarts the containers on the
# already-running instance — no infrastructure changes, no new instance.
# For "the instance itself is gone", use `make deploy` instead (relaunches
# via Terraform, which reconnects to the same RDS/secrets automatically).
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="$(terraform output -raw aws_region)"
INSTANCE_ID="$(terraform output -raw ec2_instance_id)"

REMOTE_SCRIPT='
set -e
cd /opt/joindevops-crm
git fetch origin main
git reset --hard origin/main
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml exec -T app npm run seed || true
echo "Redeploy complete."
'

PARAMS_FILE="$(mktemp)"
trap 'rm -f "$PARAMS_FILE"' EXIT
jq -n --arg script "$REMOTE_SCRIPT" '{commands: [$script]}' >"$PARAMS_FILE"

CMD_ID="$(aws ssm send-command --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --timeout-seconds 600 \
  --parameters "file://$PARAMS_FILE" \
  --query 'Command.CommandId' --output text)"

echo "Redeploy command $CMD_ID sent, waiting for it to finish..."
aws ssm wait command-executed --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" 2>/dev/null || true

aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text

STATUS="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" --query 'Status' --output text)"
if [ "$STATUS" != "Success" ]; then
  echo "Redeploy finished with status: $STATUS"
  aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'StandardErrorContent' --output text
  exit 1
fi
