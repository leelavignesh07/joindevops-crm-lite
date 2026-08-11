#!/usr/bin/env bash
# Confirms every service the app depends on is actually enabled and running
# — not just that `terraform apply` succeeded. `terraform apply` only waits
# for the EC2 instance to reach "running"; it has no idea whether the boot
# script's docker build, container startup, or nginx/certbot steps have
# finished. This runs a status check *inside* the instance via SSM Run
# Command (no SSH/key pair needed) and a reachability check from out here.
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="$(terraform output -raw aws_region)"
INSTANCE_ID="$(terraform output -raw ec2_instance_id)"
APP_URL="$(terraform output -raw app_url)"

echo "==> Checking services on $INSTANCE_ID via SSM Run Command (this waits up to 5 minutes for the app container to become healthy)..."

REMOTE_SCRIPT='
echo "--- waiting for the app container health endpoint ---"
ok=0
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 5
done
if [ "$ok" = "1" ]; then
  echo "App container: healthy"
else
  echo "App container: NOT healthy after 5 minutes — check: cd /opt/joindevops-crm && docker compose -f docker-compose.prod.yml logs app"
fi

echo "--- systemd services ---"
for svc in docker nginx amazon-ssm-agent; do
  active=$(systemctl is-active "$svc" 2>/dev/null || echo inactive)
  enabled=$(systemctl is-enabled "$svc" 2>/dev/null || echo disabled)
  printf "%-20s active=%-10s enabled=%s\n" "$svc" "$active" "$enabled"
done

echo "--- docker compose containers ---"
cd /opt/joindevops-crm && docker compose -f docker-compose.prod.yml ps

echo "--- app health, direct (127.0.0.1:3000) ---"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/api/health || echo "FAILED"

echo "--- app health, through nginx (127.0.0.1:80) ---"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/api/health || echo "FAILED"

echo "--- nginx HTTPS (127.0.0.1:443) ---"
curl -sfk -o /dev/null -w "HTTP %{http_code}\n" https://127.0.0.1/api/health 2>/dev/null || echo "no HTTPS listener yet (certbot may not have completed — see /var/log/cloud-init-output.log)"
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

echo "Command $CMD_ID sent, waiting for it to finish..."
aws ssm wait command-executed --region "$REGION" --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" 2>/dev/null || true

STATUS="$(aws ssm get-command-invocation --region "$REGION" \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'Status' --output text)"

aws ssm get-command-invocation --region "$REGION" \
  --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query 'StandardOutputContent' --output text

if [ "$STATUS" != "Success" ]; then
  echo "Remote check command finished with status: $STATUS"
  aws ssm get-command-invocation --region "$REGION" \
    --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
    --query 'StandardErrorContent' --output text
fi

echo ""
echo "==> Checking public reachability at $APP_URL ..."
if curl -sf -o /dev/null -w "HTTP %{http_code}\n" "$APP_URL/api/health"; then
  echo "App reachable from the internet at $APP_URL"
else
  echo "Could not reach $APP_URL from here yet — likely DNS still propagating or the certificate isn't issued yet."
  echo "Re-run: make verify"
fi
