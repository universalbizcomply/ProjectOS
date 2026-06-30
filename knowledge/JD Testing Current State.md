# JD Testing — Current State

> Current-state summary for the JD Testing project, for ProjectOS Project Knowledge.
> Sourced read-only from `C:\dev\JD Project` on 2026-06-30 with owner authorisation. Unknowns marked clearly.

## Project identity

- **Name:** JD Testing / JD Project.
- **Client / owner:** Jon (owner). Murad delivers; ChatGPT coordinates/reviews.
- **Local folder:** `C:\dev\JD Project`.
- **Type:** Controlled completion + improvement of an existing **Lovable-imported** web app.
- **Business domain:** Intolerance testing / appointment booking (customers browse services, book at sites or at-home kits, complete a consultation form, later receive results).

## Live domain

- `jdtesting.uk` (owner-confirmed). Live booking / payment / customer platform.

## Repo

- **Origin:** `https://github.com/jdonlinetesting/JDtesting.git`
- Local on branch `main`, HEAD `ef4e851` ("fix(bookings): load participant attendance status for party-size flows").
- Hosting artefacts present for both **Vercel** (`.vercel`) and **Netlify** (`.netlify`) — active production host NOT VERIFIED this pass (`NEEDS SOURCE`).

## Stack

- **Frontend:** Vite 5 + React 18 + TypeScript, React Router 6, TanStack Query v5, react-hook-form + Zod.
- **UI:** Tailwind CSS + shadcn/ui (Radix), lucide-react, sonner. Lovable design — **no redesign permitted**.
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno). 34 timestamped migrations (immutable history).
- **Payments (current):** Stripe (Checkout + webhook) — partially wired, **not active in booking flow**.
- **Payments (target):** TrueLayer primary / Stripe secondary.
- **Email:** Resend (from Supabase Edge Functions). **PDF:** jsPDF (result certificates). **Test:** Vitest + jsdom + Testing Library. Dev port 8080.
- **Supabase project ref:** `nmqhqlzxaticlbificos` (public ref).

## Roles / access

- Three tiers enforced by `RouteGuard`: **public**, **staff or admin**, **admin only**. Roles live in the `profiles` table.
- Notable Edge Functions: `create-public-booking` (no auth), `create-checkout-session`, `stripe-webhook`, `send-confirmation-email` (`verify_jwt=false`), `send-booking-reminders` (cron), `send-results-email`, `send-staff-assignment-email`, `get-result-by-token`, `consultation-form-public`, `admin-users` / `create-user` (admin-gated).

## Booking / payment / email / SMS sensitivity

- **Stripe + TrueLayer (open banking)** payment flows are **sensitive** (live financial).
- **Customer / health-adjacent data:** intolerance testing, consultation forms, result certificates → GDPR special-category-adjacent personal data — **sensitive**.
- Booking / customer emails (Resend) are **sensitive**.
- Booking mutation is **sensitive**.
- **Payment safety rule (project-enforced):** a booking must not be marked `confirmed` until the payment provider **webhook** confirms payment; no static/reusable payment links for bookings.
- ProjectOS must treat payment, customer/health data, customer email, booking mutation and production deploy as **high-risk gates**.

## Production status

- **Live** (`jdtesting.uk`).
- Precise current deployment hash / release status and active host (Vercel vs Netlify): **NOT VERIFIED** — `NEEDS SOURCE`.

## Recent closed phases

- Delivery is **phased, approval-gated** ("same discipline as BizComply OS"). Canonical phase memory lives in:
  - `docs/JD_PROJECT_MASTER_LEDGER.md` (project memory + phase roadmap + handover)
  - `docs/JD_PROJECT_EXECUTION_PLAN.md` (per-phase scope + validation)
  - `docs/JD_PROJECT_AUDIT_LOG.md` (all changes to date)
- Specific closed-phase list / current completion %: **not enumerated this pass** — `NEEDS SOURCE` (read those ledgers to populate).

## Current carry-forward queue

- Open-banking **TrueLayer** activation (target primary payment) appears in progress (TrueLayer company/developer checklists in `docs/`).
- Exact carry-forward items: **NEEDS SOURCE** (from master ledger / execution plan).

## Known risks / blockers

- Live payment platform: any production action carries financial + customer risk.
- Health-adjacent personal data → GDPR exposure risk on any data handling.
- Lovable-imported app: theme/design and shadcn primitives must not be changed without client approval.
- Migrations are immutable; only add new timestamped migrations.
- Detailed risk register: **NEEDS SOURCE**.

## ProjectOS installation considerations

- Treat payment, customer/health data, customer email, booking mutation and production deploy as high-risk gates.
- No real charge, no real customer/health-data send, no booking mutation, no production deploy without explicit owner approval.
- Enforce the project's payment-safety invariant (no `confirmed` before webhook) and migration-hygiene rule.
- Honour "no redesign" and "phased delivery only" client rules.
- Reuse the project's before/after report-per-phase discipline as the proof/reporting pattern.
- Install a project-local `.projectops` folder only after owner/advisor approval (path now authorised for read; write/install still gated).

## Source confidence notes

- Facts sourced read-only from `C:\dev\JD Project` (`CLAUDE.md`, `docs/JD_PROJECT_MASTER_LEDGER.md`, `supabase/config.toml`, git metadata) on 2026-06-30 under owner authorisation.
- Supabase project ref is a public identifier (allowed). No `.env`, service-role/Stripe/TrueLayer keys opened or included.
- Phase counts / completion % / live host not independently verified this pass.

## Source discipline

- **Confirmed from owner/project memory:** Domain `jdtesting.uk`; live booking/payment/customer platform; payment, customer email, booking mutation high-risk; folder `C:\dev\JD Project` under `C:\dev` (owner-confirmed 2026-06-30).
- **Confirmed from local repo docs (read-only, authorised):** Name JD Testing / JD Project; client Jon; Lovable-imported intolerance-testing booking app; stack (Vite5/React18/TS, Supabase, Stripe current + TrueLayer target, Resend, jsPDF); repo `jdonlinetesting/JDtesting` (`main`@`ef4e851`); Supabase ref `nmqhqlzxaticlbificos`; role tiers + edge functions; payment-safety + no-redesign + phased-delivery rules; 34 immutable migrations.
- **Not verified:** Current completion %; enumerated closed phases; active production host (Vercel vs Netlify); current deploy hash.
- **Needs source:** Closed-phase list + current % from master ledger; carry-forward queue; active host/deploy status; risk register.
