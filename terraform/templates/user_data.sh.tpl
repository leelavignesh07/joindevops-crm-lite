#!/bin/bash
# Bootstraps the app server from scratch. Runs on every boot of a *new*
# instance (first launch, or after you replace a lost/terminated one) —
# nothing here is instance-specific: everything it needs (DB connection info,
# app secrets) is pulled fresh from SSM Parameter Store / Secrets Manager
# using the IAM role attached to the instance, not baked in here.
set -euxo pipefail

AWS_REGION="${aws_region}"
SSM_PREFIX="${ssm_prefix}"
APP_REPO_URL="${app_repo_url}"
APP_REPO_REF="${app_repo_ref}"
APP_DIR="/opt/joindevops-crm"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx unzip jq

# ---------- AWS CLI v2 ----------
if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
fi

# ---------- Docker ----------
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# ---------- Clone/update the app ----------
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$APP_REPO_REF"
  git -C "$APP_DIR" reset --hard "origin/$APP_REPO_REF"
else
  git clone --branch "$APP_REPO_REF" "$APP_REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ---------- Pull config from SSM + the RDS-managed DB secret ----------
get_param() {
  aws ssm get-parameter --region "$AWS_REGION" --name "$SSM_PREFIX/$1" --with-decryption --query 'Parameter.Value' --output text
}

DB_HOST="$(get_param DB_HOST)"
DB_NAME="$(get_param DB_NAME)"
DB_SECRET_ARN="$(get_param DB_SECRET_ARN)"
DB_SECRET_JSON="$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ARN" --query 'SecretString' --output text)"
DB_USER="$(echo "$DB_SECRET_JSON" | jq -r '.username|@uri')"
# URL-encode the password so special characters can't break the connection string.
DB_PASS_ENCODED="$(echo "$DB_SECRET_JSON" | jq -r '.password|@uri')"

cat > "$APP_DIR/.env" <<ENV
DATABASE_URL=postgresql://$DB_USER:$DB_PASS_ENCODED@$DB_HOST:5432/$DB_NAME?schema=public&sslmode=require
REDIS_URL=redis://redis:6379
NEXTAUTH_SECRET=$(get_param NEXTAUTH_SECRET)
NEXTAUTH_URL=$(get_param NEXTAUTH_URL)
GOOGLE_CLIENT_ID=$(get_param GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(get_param GOOGLE_CLIENT_SECRET)
ALLOWED_GOOGLE_WORKSPACE_DOMAIN=$(get_param ALLOWED_GOOGLE_WORKSPACE_DOMAIN)
AWS_REGION=$(get_param AWS_REGION)
SES_FROM_EMAIL=$(get_param SES_FROM_EMAIL)
WATI_API_ENDPOINT=$(get_param WATI_API_ENDPOINT)
WATI_API_KEY=$(get_param WATI_API_KEY)
WATI_ACK_TEMPLATE_NAME=$(get_param WATI_ACK_TEMPLATE_NAME)
BRAND_NAME=$(get_param BRAND_NAME)
ENV
chmod 600 "$APP_DIR/.env"

# ---------- Start the app (migrations run automatically, see docker-compose.prod.yml) ----------
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml exec -T app npm run seed || true

# ---------- nginx reverse proxy ----------
cat > /etc/nginx/sites-available/crm.conf <<'NGINX'
server {
    listen 80;
    server_name _;

    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/crm.conf /etc/nginx/sites-enabled/crm.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo "Bootstrap complete. If app_domain was set and DNS already points here, run: sudo certbot --nginx -d <your-domain> --non-interactive --agree-tos -m <you>@<domain> --redirect"
