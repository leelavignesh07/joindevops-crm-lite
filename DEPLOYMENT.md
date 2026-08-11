# Deployment Guide — AWS (single EC2 instance)

This walks through hosting the CRM on one EC2 instance with a managed Postgres
database (RDS) and SES for email, plus wiring up every lead source and
integration you mentioned. Replace `crm.yourdomain.com` with your real domain
throughout (you said you don't have one picked yet — a subdomain of
`joindevops.com`, e.g. `crm.joindevops.com`, is a natural choice once you do).

Rough monthly cost at low volume: EC2 `t3.small` (~$15), RDS `db.t3.micro`
(~$13), SES (~$0.10 per 1,000 emails), Route 53 hosted zone (~$0.50) — call it
**$25–35/month** before traffic grows.

---

## 0. Prerequisites

- An AWS account with billing enabled.
- A domain you control (or use a placeholder for now and swap it in later —
  everything below still works with an IP address until you're ready for a
  domain, except HTTPS via Let's Encrypt, which needs one).
- This repository pushed to GitHub (already done if you're reading this from
  the repo).
- A WATI account (https://www.wati.io) for WhatsApp.
- Accounts on whichever of Tally.so / Webflow / Meta Business Suite / Pabbly
  Connect / Zapier you're using for lead sources.

---

## 1. RDS — PostgreSQL database

1. AWS Console → **RDS** → **Create database**.
2. Engine: **PostgreSQL** (latest 16.x). Template: **Free tier** or **Dev/Test**.
3. Settings: DB instance identifier `joindevops-crm`, master username `crm_admin`,
   auto-generate a strong password (save it — you'll put it in `.env`).
4. Instance class: `db.t3.micro` (fine for a lite CRM).
5. Storage: 20 GB gp3, disable storage autoscaling for now (turn on later if needed).
6. **Connectivity**: "Don't connect to an EC2 compute resource" (we'll wire the
   security group manually in step 3), VPC = default, **Public access: No**.
7. Create a new security group `crm-rds-sg` at this step (or after) — you'll
   allow inbound Postgres (5432) from the EC2 instance's security group only.
8. Create the database. Note the **endpoint hostname** once it's available.

Your `DATABASE_URL` will look like:
```
postgresql://crm_admin:YOUR_PASSWORD@joindevops-crm.xxxxxxxxxx.ap-south-1.rds.amazonaws.com:5432/postgres?schema=public
```

---

## 2. SES — sending acknowledgement emails

1. AWS Console → **SES** → **Verified identities** → **Create identity**.
2. Choose **Domain**, enter `joindevops.com` (or the subdomain you'll send
   from, e.g. `mail.joindevops.com`). SES gives you DKIM CNAME records.
3. Add those CNAME records at your DNS provider (Route 53 or wherever
   `joindevops.com` is managed). Wait for verification (usually minutes).
4. Set `SES_FROM_EMAIL` in `.env` to an address on that domain, e.g.
   `admissions@joindevops.com`.
5. **Request production access**: SES starts in the *sandbox* (can only email
   verified addresses, 200/day limit). Console → SES → **Account dashboard** →
   **Request production access**. Explain it's transactional lead
   acknowledgement email for an edtech CRM. Usually approved within a day.
6. Permissions: the EC2 instance sends via an **IAM role** (step 3.5) with
   this policy attached — no static AWS keys needed in `.env` in production:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "ses:SendEmail", "Resource": "*" }
  ]
}
```

---

## 3. EC2 — the app server

### 3.1 Launch the instance

1. EC2 → **Launch instance**. Name `joindevops-crm`.
2. AMI: **Ubuntu Server 24.04 LTS**. Type: `t3.small` (2 vCPU/2GB — comfortable
   for Next.js + worker + Redis; `t3.micro` works too at low traffic).
3. Key pair: create/download one (needed for SSH and for the GitHub Actions
   deploy secret later).
4. Network: default VPC. Create a security group `crm-ec2-sg`:
   - SSH (22) from **your IP only**.
   - HTTP (80) and HTTPS (443) from **anywhere** (0.0.0.0/0).
5. Storage: 20 GB gp3 is plenty.
6. Launch, then allocate and associate an **Elastic IP** so the address is
   stable (EC2 → Elastic IPs → Allocate → Associate with this instance).

### 3.2 Allow EC2 → RDS

Go back to `crm-rds-sg` (the RDS security group) → Inbound rules → Add rule:
type **PostgreSQL**, source = `crm-ec2-sg` (select the EC2 security group,
not an IP). This lets the app reach the database without opening RDS to the
internet.

### 3.3 IAM role for SES (no static keys needed)

1. IAM → **Roles** → **Create role** → AWS service → EC2.
2. Attach a customer-managed policy with the `ses:SendEmail` permission from
   step 2.6 (or `AmazonSESFullAccess` for simplicity while testing).
3. Name it `crm-ec2-ses-role`.
4. EC2 → select your instance → **Actions → Security → Modify IAM role** →
   attach `crm-ec2-ses-role`.

With this role attached, leave `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`
**unset** in production `.env` — the AWS SDK picks up the role automatically.

### 3.4 Install Docker, nginx, certbot

SSH in (`ssh -i your-key.pem ubuntu@<elastic-ip>`) and run:

```bash
sudo apt update && sudo apt upgrade -y
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
# nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx git
```

### 3.5 Point DNS at the instance

At your DNS provider (Route 53 if `joindevops.com` is hosted there), create an
**A record** for `crm.yourdomain.com` → the Elastic IP. Skip this until you've
picked a real domain; you can reach the app via the Elastic IP over HTTP in
the meantime.

---

## 4. Deploy the app

### 4.1 Clone and configure

```bash
git clone https://github.com/leelavignesh07/joindevops-crm-lite.git
cd joindevops-crm-lite
cp .env.example .env
nano .env   # fill in every value — see checklist below
```

`.env` checklist for production:

| Variable | Value |
|---|---|
| `DATABASE_URL` | RDS connection string from step 1 |
| `REDIS_URL` | leave as `redis://redis:6379` — matches `docker-compose.prod.yml`'s service name |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | `https://crm.yourdomain.com` (or `http://<elastic-ip>` before you have a domain/HTTPS) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from step 5 below |
| `ALLOWED_GOOGLE_WORKSPACE_DOMAIN` | `joindevops.com` |
| `AWS_REGION` | e.g. `ap-south-1` |
| `SES_FROM_EMAIL` | e.g. `admissions@joindevops.com` |
| `WATI_API_ENDPOINT` / `WATI_API_KEY` / `WATI_ACK_TEMPLATE_NAME` | from step 6 below |

### 4.2 Build and run

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
docker compose -f docker-compose.prod.yml exec app npm run seed
```

(`app`'s startup command already runs `prisma migrate deploy` before starting
the server — see `docker-compose.prod.yml`.)

Check it's alive: `curl localhost:3000/api/health` should return `{"status":"ok",...}`.

### 4.3 nginx + HTTPS

```bash
sudo cp nginx/crm.conf.example /etc/nginx/sites-available/crm.conf
sudo nano /etc/nginx/sites-available/crm.conf   # set server_name to your real domain
sudo ln -s /etc/nginx/sites-available/crm.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Once DNS is pointed at this instance:
sudo certbot --nginx -d crm.yourdomain.com
```

Certbot edits the nginx config to redirect HTTP→HTTPS and auto-renews via a
systemd timer it installs — nothing further to do.

Visit `https://crm.yourdomain.com` — you should land on the login page.

---

## 5. Google Workspace SSO (employee/admin login)

1. https://console.cloud.google.com → create a project (e.g. "JoinDevOps CRM").
2. **APIs & Services → OAuth consent screen**: User type **Internal** (restricts
   sign-in to your Workspace org automatically — pick this if the project is
   inside your Workspace's Cloud org; otherwise choose External and rely on
   the `hd`/domain check the app already enforces).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `https://crm.yourdomain.com/api/auth/callback/google`
     (and `http://localhost:3000/api/auth/callback/google` for local dev).
4. Copy the **Client ID** and **Client secret** into `.env` as
   `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, then redeploy
   (`docker compose -f docker-compose.prod.yml up -d --build`).
5. Sign in once as yourself (`vignesh@joindevops.com`) — you'll automatically
   become the first `ADMIN`. Promote teammates from the Employees page after
   they sign in for the first time (they start as `SALES`).

---

## 6. WATI — WhatsApp acknowledgements

1. Sign up at https://www.wati.io and connect a WhatsApp Business number
   (WATI walks you through Meta's WhatsApp Business API onboarding).
2. **WATI dashboard → API Docs** to get your **tenant endpoint** (looks like
   `https://live-mt-server.wati.io/123456`) and **API key**. Set these as
   `WATI_API_ENDPOINT` / `WATI_API_KEY`.
3. **Broadcast → Templates → New Template**: create a template named e.g.
   `lead_acknowledgement` with body like:
   > Hi {{1}}! 👋 Thanks for your interest in JoinDevOps. Our team will reach
   > out shortly.

   Submit for Meta approval (usually a few hours to a day). Set
   `WATI_ACK_TEMPLATE_NAME=lead_acknowledgement` in `.env`.
4. The worker sends this template with the lead's name as `{{1}}` the moment a
   lead comes in with a phone number (`src/lib/whatsapp.ts`,
   `src/workers/communicationWorker.ts`).

---

## 7. Wire up lead sources

Every source below posts to:
```
https://crm.yourdomain.com/api/webhooks/leads/<source>?token=<secret>
```
Generate each URL from the admin panel: **Settings → Inbound Lead Webhooks →
pick source → Generate URL → Copy**. Tokens are per-source and revocable.

### Tally.so

1. Open your form → **Integrations → Webhooks**.
2. Paste the CRM's `tally` URL. Tally sends field labels/values; the parser
   (`src/lib/leadSourceParsers.ts`) looks for labels containing "name",
   "email", "phone"/"mobile"/"whatsapp", "course"/"program", "message" — name
   your Tally fields accordingly (case-insensitive, partial match is fine).

### Webflow

1. Site Settings → **Forms** → your form → **Webhooks** (or Webflow Logic, if
   you're on a plan with it) → add a webhook for **Form Submission**.
2. Paste the CRM's `webflow` URL. Field names in your form should contain
   "name", "email", "phone", "course"/"program"/"interest", "message".

### Learnyst — free-session/demo registrations

If a demo/free session is itself hosted or listed on Learnyst (rather than
Tally/Webflow), point Learnyst's registration webhook (or a Pabbly/Zapier
scenario watching Learnyst) at the CRM's `learnyst` **Lead** URL, generated
the same way. Field names should contain "name", "email",
"phone"/"mobile"/"whatsapp", "course"/"program"/"course_name", "message".

### Meta Ads (Facebook/Instagram Lead Ads) — via Pabbly Connect or Zapier

A direct Meta Graph API integration needs Facebook App Review + Business
Verification (multi-day, outside of code), so the lite setup relays through a
no-code tool instead — you already use Pabbly/Zapier, so this reuses that:

**Pabbly Connect:**
1. Create workflow → Trigger app **Facebook Lead Ads** → connect your Meta
   Business account → select Page + Lead Form.
2. Action app → **Webhook** → POST → paste the CRM's `pabbly` URL.
3. Map Facebook's fields (full_name, email, phone_number, etc.) to a flat JSON
   body: `name`, `email`, `phone`, `course`, `message` — the generic parser
   accepts these keys directly (also accepts `full_name`, `email_address`,
   `phone_number`, `whatsapp`, `program`, `interested_in`; see
   `parseGeneric` in `src/lib/leadSourceParsers.ts` for the full list).

**Zapier:** same idea — Trigger **Facebook Lead Ads → New Lead**, Action
**Webhooks by Zapier → POST** to the CRM's `zapier` URL with the same field
mapping.

You can also point other sources (a spreadsheet, another form tool, WhatsApp
click-to-chat forms, etc.) at the same `pabbly`/`zapier` URLs — they're
generic flat-JSON endpoints, not Meta-specific.

---

## 8. Learnyst course enrollments (conversion tracking)

This is what makes the CRM able to answer "did this lead convert?" — a paid
Learnyst course purchase POSTs to a separate **Enrollment** URL, which records
the sale, matches it to the lead's existing record (same dedup logic as
leads), and marks that lead **Converted**:

```
https://crm.yourdomain.com/api/webhooks/enrollments/<source>?token=<secret>
```

Generate it the same way as a lead webhook, but pick **Enrollment** as the
purpose in **Settings → Inbound Webhooks**.

1. Check whether your Learnyst plan has native webhooks (Learnyst → Settings
   → Integrations/Webhooks) for "order completed"/"course purchased" events.
   If so, point it directly at the `learnyst` Enrollment URL.
2. If not, relay it: **Pabbly Connect** or **Zapier** → Trigger on a Learnyst
   order-completed event (Learnyst is available as an app on both, or use
   Learnyst's order-confirmation email/Google Sheet export as a trigger
   source) → Action **Webhook/Webhooks by Zapier → POST** to the CRM's
   `pabbly`/`zapier` Enrollment URL.
3. Map fields to a flat JSON body: `email` (or `phone`), `course_name`,
   `course_id` (optional), `amount` (optional, in INR) — see
   `parseEnrollmentPayload` in `src/lib/enrollmentSourceParsers.ts` for the
   full list of accepted field-name variants (`courseName`, `product_name`,
   `amount_paid`, `order_amount`, etc.).

A second enrollment for the same person, or a new demo/free-session
registration from someone who already converted, is automatically flagged as
an **upsell opportunity** on the Leads page — no extra setup needed.

---

## 9. Outbound webhooks (CRM → Pabbly/Zapier)

**Settings → Outbound Webhooks** lets you fire a signed POST to any Pabbly
Connect/Zapier "Catch Hook" URL on `LEAD_CREATED`, `LEAD_ASSIGNED`,
`LEAD_STATUS_CHANGED`, or `ENROLLMENT_CREATED` — useful for things like a
Slack ping when a lead converts, or logging every enrollment to a Google
Sheet. Each webhook gets its own HMAC-SHA256 signing secret; the receiver can
verify the `X-CRM-Signature` header if you add a Code step, or just trust the
URL's obscurity for lower-stakes internal automations.

---

## 10. CI/CD (optional but recommended)

Ready-made workflows live in `github-workflow-templates/` (not
`.github/workflows/` — see that folder's `README.md` for why, and the copy
commands to activate them). Once copied in:

- `deploy.yml` redeploys automatically on every push to `main`. Add these
  repo secrets first (GitHub → Settings → Secrets and variables → Actions):

  | Secret | Value |
  |---|---|
  | `EC2_HOST` | Elastic IP or domain |
  | `EC2_USER` | `ubuntu` |
  | `EC2_SSH_KEY` | contents of the `.pem` key from step 3.1 |
  | `EC2_APP_DIR` | `/home/ubuntu/joindevops-crm-lite` |

- `ci.yml` runs lint/typecheck/build on every PR.

---

## 11. Operating it day to day

- **Logs**: `docker compose -f docker-compose.prod.yml logs -f app worker`
- **Redeploy after a config change**: `docker compose -f docker-compose.prod.yml up -d --build`
- **Database backups**: RDS automated backups are on by default (check the
  retention window under the RDS instance's **Maintenance & backups** tab).
- **Rotate a leaked webhook token**: Settings → revoke the old inbound key,
  generate a new one, update the source's webhook config.
- **Add a teammate**: they sign in with Google once (starts as `SALES`), then
  an ADMIN promotes them from **Employees**.

## Security checklist

- [ ] RDS security group only allows inbound from the EC2 security group (not `0.0.0.0/0`)
- [ ] SSH (port 22) restricted to your IP
- [ ] `.env` is not committed (already gitignored) and not world-readable on the instance (`chmod 600 .env`)
- [ ] SES is out of the sandbox before relying on it for real leads
- [ ] `NEXTAUTH_SECRET` is a real random value, not the placeholder
- [ ] HTTPS is enforced (certbot handles this once DNS is pointed at the instance)
- [ ] Inbound webhook tokens are treated as secrets (don't post them in Slack, etc.)
