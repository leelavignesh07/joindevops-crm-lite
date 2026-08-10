# JoinDevOps CRM Lite

A lightweight CRM for JoinDevOps: lead capture from multiple sources, automatic
routing to the sales team, and automated acknowledgement emails/WhatsApp
messages — plus outbound webhooks so you can plug the CRM into Pabbly Connect
or Zapier for anything else.

## Stack

- **Next.js 14** (App Router, TypeScript) — admin panel UI + API routes/webhooks in one app
- **PostgreSQL** via **Prisma ORM** — data store (AWS RDS in production)
- **Redis** + **BullMQ** — background job queue for sending email/WhatsApp and firing outbound webhooks without blocking requests
- **NextAuth** — employee/admin login via **Google Workspace SSO**, restricted to your domain
- **AWS SES** — acknowledgement emails
- **WATI** — direct WhatsApp Business API integration
- **Tailwind CSS** — admin panel styling
- Deploys as **Docker containers** on a single **AWS EC2** instance behind **nginx**

## How a lead flows through the system

1. A lead fills a form on **Tally.so**, **Webflow**, or a **Meta (Facebook/Instagram) Lead Ad**.
2. It reaches the CRM's inbound webhook:
   - Tally and Webflow POST directly to the CRM (native webhook support).
   - Meta Ads leads are relayed via **Pabbly Connect** or **Zapier** (Meta requires Business
     Verification + App Review for a direct integration, so the lite setup routes through
     a no-code relay instead — see `DEPLOYMENT.md`).
3. `POST /api/webhooks/leads/{source}?token=...` (`src/app/api/webhooks/leads/[source]/route.ts`)
   verifies the per-source secret token, normalizes the payload
   (`src/lib/leadSourceParsers.ts`), and creates the `Lead` record.
4. The lead is **auto-assigned** to the sales rep with the fewest open leads (round robin —
   `src/lib/assignment.ts`).
5. An acknowledgement **email** (SES) and **WhatsApp** (WATI) job is queued (`src/lib/queue.ts`)
   and processed by the background worker (`src/workers/communicationWorker.ts`).
6. Any **outbound webhooks** you've configured under Settings fire to Pabbly/Zapier
   (`LEAD_CREATED`, `LEAD_ASSIGNED`, `LEAD_STATUS_CHANGED`) so you can chain further automations.
7. Sales reps work the lead through the pipeline (New → Contacted → Qualified → Proposal →
   Won/Lost) in the admin panel, leaving notes along the way.

## Admin panel

- **Dashboard** — pipeline + source breakdown, scoped to "my leads" for SALES reps.
- **Leads** — searchable/filterable list, manual "Add Lead", detail page with activity
  timeline, status control, reassignment (MANAGER/ADMIN), and notes.
- **Employees** (MANAGER/ADMIN) — role and active/inactive management. ADMIN can promote/demote.
- **Settings** (ADMIN only) — inbound webhook URLs per source, outbound webhooks to
  Pabbly/Zapier, and acknowledgement message templates.

Roles: `ADMIN` (full access), `MANAGER` (all leads + employees, read-only settings),
`SALES` (own leads only). The **first person to ever sign in becomes ADMIN automatically**;
everyone after that starts as `SALES` and gets promoted from the Employees page.

## Project layout

```
prisma/schema.prisma          Data model (Lead, User, Communication, webhooks, templates...)
prisma/seed.ts                 Seeds default email/WhatsApp acknowledgement templates
src/app/(dashboard)/           Admin panel pages (dashboard, leads, employees, settings)
src/app/login/                 Google sign-in page
src/app/api/webhooks/leads/    Inbound lead webhooks (Tally, Webflow, Pabbly, Zapier)
src/app/api/leads/             Lead CRUD API
src/app/api/settings/          Templates / outbound webhooks / inbound key management APIs
src/lib/                       Prisma client, auth, RBAC, queue, SES, WATI, webhook dispatcher
src/workers/communicationWorker.ts   Background worker (separate process/container)
src/components/                Admin panel UI components
```

## Local development

**Prerequisites:** Node.js 20+, Docker (for Postgres/Redis), a Google Cloud OAuth client
(see `DEPLOYMENT.md` for how to create one — you can also stub this in dev).

```bash
cp .env.example .env          # fill in DATABASE_URL stays as-is, add Google OAuth creds
docker compose up -d          # starts Postgres + Redis
npm install
npm run prisma:migrate:dev    # creates tables
npm run seed                  # seeds default templates
npm run dev                   # http://localhost:3000
```

In a second terminal, run the background worker so acknowledgements actually send:

```bash
npm run worker
```

Sign in at `http://localhost:3000/login` with a Google account on your Workspace domain
(`ALLOWED_GOOGLE_WORKSPACE_DOMAIN` in `.env`). The first account to sign in becomes ADMIN.

### Testing inbound webhooks locally

Generate a webhook URL + token from **Settings > Inbound Lead Webhooks** in the admin panel
(sign in as ADMIN first), then:

```bash
curl -X POST "http://localhost:3000/api/webhooks/leads/zapier?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","email":"test@example.com","phone":"+919999999999","course":"DevOps Bootcamp"}'
```

## Production deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full step-by-step AWS guide: RDS, SES domain
verification, EC2 setup, Docker deployment, nginx + HTTPS, Google OAuth setup, WATI setup, and
wiring up Tally.so / Webflow / Meta Ads / Pabbly / Zapier.

## Extending

- **Outbound webhooks** (Settings > Outbound Webhooks) let you POST any CRM event to a Pabbly
  Connect or Zapier "Catch Hook" without writing more code — sign the payload with the webhook's
  `secret` (HMAC-SHA256 over the raw JSON body, sent as `X-CRM-Signature`) to verify authenticity
  on the receiving end.
- **New lead sources**: add a parser function in `src/lib/leadSourceParsers.ts`, a slug in
  `SOURCE_SLUGS`, and a value in the `LeadSourceType` enum in `prisma/schema.prisma`.
- **New communication channels** (e.g. SMS): add a `CommunicationChannel` enum value, a `send*`
  function in `src/lib/`, and a case in `src/workers/communicationWorker.ts`.
