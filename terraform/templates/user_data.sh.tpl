#!/bin/bash
# Bootstraps the app server from scratch. Runs on every boot of a *new*
# instance (first launch, or after you replace a lost/terminated one) —
# nothing here is instance-specific: everything it needs (DB connection info,
# app secrets) is pulled fresh from SSM Parameter Store / Secrets Manager
# using the IAM role attached to the instance, not baked in here.
#
# Works on both RHEL/CentOS-family (dnf) and Debian/Ubuntu-family (apt) AMIs
# — the default AMI for this stack is RHEL 9, so that path gets the extra
# RHEL-specific handling (SELinux, firewalld, EPEL for certbot) below.
set -euxo pipefail

AWS_REGION="${aws_region}"
SSM_PREFIX="${ssm_prefix}"
APP_REPO_URL="${app_repo_url}"
APP_REPO_REF="${app_repo_ref}"
APP_DOMAIN="${app_domain}"
CERTBOT_EMAIL="${certbot_email}"
APP_DIR="/opt/joindevops-crm"

if [ -f /etc/redhat-release ]; then
  IS_RHEL=1
else
  IS_RHEL=0
fi

if [ "$IS_RHEL" = "1" ]; then
  dnf install -y ca-certificates curl git nginx unzip jq policycoreutils
else
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git nginx unzip jq
fi

# ---------- AWS CLI v2 ----------
if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
  unzip -q /tmp/awscliv2.zip -d /tmp
  /tmp/aws/install
fi

# ---------- SSM Session Manager agent ----------
# No key pair is attached to this instance (see variables.tf) — SSM Session
# Manager is the only way in. AWS's own RHEL/Ubuntu AMIs ship it already
# running; a custom/third-party AMI might not, so install+start it
# defensively rather than assume. Non-fatal: if this fails, IAM permissions
# are still correct and a rebuild with a stock AMI will pick it up cleanly.
if ! systemctl is-active --quiet amazon-ssm-agent 2>/dev/null; then
  if [ "$IS_RHEL" = "1" ]; then
    dnf install -y "https://s3.$AWS_REGION.amazonaws.com/amazon-ssm-$AWS_REGION/latest/linux_amd64/amazon-ssm-agent.rpm" || true
  else
    curl -fsSL -o /tmp/amazon-ssm-agent.deb "https://s3.$AWS_REGION.amazonaws.com/amazon-ssm-$AWS_REGION/latest/debian_amd64/amazon-ssm-agent.deb" && \
      dpkg -i /tmp/amazon-ssm-agent.deb || true
  fi
  systemctl enable --now amazon-ssm-agent || true
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
# Written from scratch (not relying on the distro package's default
# sites-available/conf.d skeleton) so the exact same config is correct on
# both RHEL and Debian — RHEL's stock nginx.conf ships its own inline
# `default_server` block that would otherwise compete with ours.
SERVER_NAME="$${APP_DOMAIN:-_}"
if [ "$IS_RHEL" = "1" ]; then
  NGINX_USER=nginx
else
  NGINX_USER=www-data
fi
cat > /etc/nginx/nginx.conf <<NGINXCONF
user $NGINX_USER;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;
events { worker_connections 1024; }
http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    server {
        listen 80 default_server;
        server_name $SERVER_NAME;

        client_max_body_size 5m;

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
}
NGINXCONF
rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

if [ "$IS_RHEL" = "1" ]; then
  # SELinux blocks nginx from proxying to another port by default.
  setsebool -P httpd_can_network_connect 1 || true

  # Security group already restricts inbound traffic; still open the
  # OS-level firewall if this AMI ships firewalld active, so port 80/443
  # aren't silently dropped at the host level too.
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --reload
  fi
fi

nginx -t && systemctl enable --now nginx && systemctl restart nginx

# ---------- HTTPS (Let's Encrypt via certbot) ----------
# Best-effort and fully non-fatal: the app is already up on plain HTTP by
# this point (nginx started above), so nothing here should be able to abort
# the rest of the boot. Re-run the printed command by hand if this fails.
if [ -n "$APP_DOMAIN" ] && [ -n "$CERTBOT_EMAIL" ]; then
  (
    set +e
    if [ "$IS_RHEL" = "1" ]; then
      dnf install -y "https://dl.fedoraproject.org/pub/epel/epel-release-latest-9.noarch.rpm"
      dnf install -y certbot python3-certbot-nginx
    else
      apt-get install -y certbot python3-certbot-nginx
    fi

    echo "Waiting up to 2 minutes for $APP_DOMAIN to resolve before requesting a certificate..."
    for i in $(seq 1 24); do
      getent hosts "$APP_DOMAIN" >/dev/null 2>&1 && break
      sleep 5
    done

    certbot --nginx -d "$APP_DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
    if [ $? -ne 0 ]; then
      echo "certbot failed (commonly: DNS hasn't fully propagated yet, or certbot/EPEL install failed). Re-run manually once $APP_DOMAIN resolves to this instance's Elastic IP: sudo certbot --nginx -d $APP_DOMAIN --agree-tos -m $CERTBOT_EMAIL --redirect"
    fi
  )
else
  echo "app_domain/certbot_email not set — skipping automatic HTTPS setup. Serving on plain HTTP for now."
fi

echo "Bootstrap complete."
