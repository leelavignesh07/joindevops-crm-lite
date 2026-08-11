# JoinDevOps CRM Lite

A lightweight CRM built to run the JoinDevOps demo/free-session → paid-course
funnel: capture leads from multiple sources, de-duplicate the same person
across emails/phones/sources, route them to sales for follow-up, track
whether they convert (enroll on **Learnyst**), and surface existing customers
who show renewed interest as upsell opportunities.

## Stack

- **Next.js 14** (App Router, TypeScript) — admin panel UI + API routes/webhooks in one app
- **PostgreSQL** via **Prisma ORM** — data store (AWS RDS in production)
- **Redis** + **BullMQ** — background job queue for sending email/WhatsApp and firing outbound webhooks without blocking requests
- **NextAuth** — employee/admin login via **Google Workspace SSO**, restricted to your domain
- **AWS SES** — acknowledgement emails
- **WATI** — direct WhatsApp Business API integration
- **Tailwind CSS** + **Poppins** — admin panel styled to the JoinDevOps brand guideline
- Deploys as **Docker containers** on a single **AWS EC2** instance behind **nginx**

## How a lead flows through the system

1. Someone registers for a **demo or free session** via **Tally.so**, **Webflow**, **Learnyst**,
   or a **Meta (Facebook/Instagram) Lead Ad** relayed through **Pabbly Connect/Zapier** (Meta
   requires Business Verification + App Review for a direct integration, so the lite setup
   routes through a no-code relay instead — see `DEPLOYMENT.md`).
2. `POST /api/webhooks/leads/{source}?token=...` verifies the per-source secret token,
   normalizes the payload (`src/lib/leadSourceParsers.ts`), and calls `ingestLead` (`src/lib/leadIngest.ts`).
3. **Deduplication** (`src/lib/dedupe.ts`) checks whether this is really a new person before
   creating anything — see "No duplicate leads" below. A genuinely new person gets a `Lead`
   record and is **auto-assigned** to the sales rep with the fewest open leads (round robin —
   `src/lib/assignment.ts`); someone we've already seen gets a new touchpoint recorded against
   their existing `Lead` instead of a duplicate row.
4. An acknowledgement **email** (SES) and **WhatsApp** (WATI) job is queued (`src/lib/queue.ts`)
   and processed by the background worker (`src/workers/communicationWorker.ts`).
5. Any **outbound webhooks** you've configured under Settings fire to Pabbly/Zapier
   (`LEAD_CREATED`, `LEAD_ASSIGNED`, `LEAD_STATUS_CHANGED`, `ENROLLMENT_CREATED`).
6. Sales follows up and works the lead through the pipeline: `New → Contacted → Demo Scheduled →
   Demo Attended → Follow Up → Converted / Not Converted`, setting a **Hot/Warm/Cold** probability
   as they go, and leaving notes along the way.
7. When the person actually buys a course on **Learnyst**, that purchase reaches
   `POST /api/webhooks/enrollments/{source}` (`src/lib/enrollmentIngest.ts`), which records an
   `Enrollment`, matches it to the same `Lead` (same dedup logic), and marks the lead
   **Converted** — this is the "evaluate whether the lead converted or not" signal. A *second*
   enrollment, or a *new registration* from someone already converted, is flagged as an
   **upsell opportunity**.

## No duplicate leads

Every inbound registration/enrollment is checked against existing leads before anything is
created (`src/lib/dedupe.ts`):

1. **Exact email match** (case/whitespace-normalized) → same person.
2. **Exact phone match** (digits-only, last 10 digits, so `+91 98765 43210`, `09876543210`, and
   `9876543210` all match) → same person.
3. **Same normalized full name AND same IP address** → same person. (IP alone is never trusted —
   too many people share a network — so it's only used combined with a matching name.)

A match reuses the existing `Lead` and appends a `LeadRegistration` touchpoint recording exactly
what happened (source, course, IP if available), rather than creating a second lead. Every
email/phone/IP ever seen for a lead is kept in `ContactIdentifier` so later registrations keep
matching correctly. Registrations are stored in strict chronological order via a DB-generated
`sequence` counter (`LeadRegistration.sequence`), independent of clock precision — visible on
each lead's **Registration History**.

**Caveat on IP matching:** most lead-capture tools (Tally, Webflow, Meta Lead Ads) don't forward
the visitor's IP in their webhook payload by default, so this signal only works when the form
explicitly captures and forwards it (e.g. a hidden field, or a Pabbly/Zapier step that injects
the request IP). Email/phone matching works unconditionally.

## Admin panel

- **Dashboard** — pipeline + source breakdown, hot-lead count, converted/not-converted,
  existing-customer and upsell-opportunity counts, scoped to "my leads" for SALES reps.
- **Leads** — searchable/filterable list (status, source, **hot-to-cold probability**), quick
  views for **Upsell Opportunities** and **Existing Customers**, manual "Add Lead", and a detail
  page with the activity timeline, enrollment history, registration history, status/probability
  controls, reassignment (MANAGER/ADMIN), and notes.
- **Employees** (MANAGER/ADMIN) — role and active/inactive management. ADMIN can promote/demote.
- **Settings** (ADMIN only) — inbound webhook URLs per source/purpose (lead vs. enrollment),
  outbound webhooks to Pabbly/Zapier, and acknowledgement message templates.

Roles: `ADMIN` (full access), `MANAGER` (all leads + employees, read-only settings),
`SALES` (own leads only). The **first person to ever sign in becomes ADMIN automatically**;
everyone after that starts as `SALES` and gets promoted from the Employees page.

## Project layout

```
prisma/schema.prisma          Data model: Lead, LeadRegistration, ContactIdentifier, Enrollment, ...
prisma/seed.ts                 Seeds default email/WhatsApp acknowledgement templates
src/app/(dashboard)/           Admin panel pages (dashboard, leads, employees, settings)
src/app/login/                 Google sign-in page
src/app/api/webhooks/leads/         Inbound lead/registration webhooks (Tally, Webflow, Learnyst, Pabbly, Zapier)
src/app/api/webhooks/enrollments/   Inbound Learnyst enrollment (paid course purchase) webhooks
src/app/api/leads/             Lead CRUD API
src/app/api/settings/          Templates / outbound webhooks / inbound key management APIs
src/lib/dedupe.ts              Contact matching (email/phone/name+IP) — the "no duplicate leads" engine
src/lib/leadIngest.ts          Lead creation vs. dedup-match + re-registration handling
src/lib/enrollmentIngest.ts    Learnyst enrollment handling, conversion + upsell detection
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

Generate webhook URLs + tokens from **Settings > Inbound Webhooks** in the admin panel (sign in
as ADMIN first) — pick **Lead** for a demo/free-session registration or **Enrollment** for a paid
Learnyst purchase, then:

```bash
# New demo/free-session registration
curl -X POST "http://localhost:3000/api/webhooks/leads/zapier?token=YOUR_LEAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","email":"test@example.com","phone":"+919999999999","course":"DevOps Free Demo"}'

# Paid Learnyst enrollment for the same person (converts the lead above)
curl -X POST "http://localhost:3000/api/webhooks/enrollments/learnyst?token=YOUR_ENROLLMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","course_name":"DevOps Bootcamp","amount":25000}'
```

## Production deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full step-by-step AWS guide: RDS, SES domain
verification, EC2 setup, Docker deployment, nginx + HTTPS, Google OAuth setup, WATI setup, and
wiring up Tally.so / Webflow / Learnyst / Meta Ads / Pabbly / Zapier.

For the hardened production architecture — RDS with an AWS-managed/rotated master password, app
secrets in SSM Parameter Store instead of a hand-edited `.env`, a twice-weekly AWS Backup plan on
top of RDS's own daily backups, and a step-by-step "the EC2 instance died" recovery runbook — see
**[AWS_SETUP_GUIDE.md](./AWS_SETUP_GUIDE.md)**, or provision that exact architecture in one shot
with **[terraform/](./terraform)** (`terraform apply`).

## Extending

- **Outbound webhooks** (Settings > Outbound Webhooks) let you POST any CRM event (including
  `ENROLLMENT_CREATED`) to a Pabbly Connect or Zapier "Catch Hook" without writing more code —
  sign the payload with the webhook's `secret` (HMAC-SHA256 over the raw JSON body, sent as
  `X-CRM-Signature`) to verify authenticity on the receiving end.
- **New lead sources**: add a parser function in `src/lib/leadSourceParsers.ts`, a slug in
  `SOURCE_SLUGS`, and a value in the `LeadSourceType` enum in `prisma/schema.prisma`.
- **New communication channels** (e.g. SMS): add a `CommunicationChannel` enum value, a `send*`
  function in `src/lib/`, and a case in `src/workers/communicationWorker.ts`.
