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
- Hosting artefacts present for both Vercel and Netlify; **active live host is Netlify** — `https://jdonlinetesting.netlify.app` (per JD-PORTAL2A-FIX1 Auth Site URL). Public domains: `jdtesting.uk` and `jdtestingonline.com` (the latter also hosts a separate **Shopify** at-home mail-order kit store — distinct from this in-person clinic platform).

## Stack

- **Frontend:** Vite 5 + React 18 + TypeScript, React Router 6, TanStack Query v5, react-hook-form + Zod.
- **UI:** Tailwind CSS + shadcn/ui (Radix), lucide-react, sonner. Lovable design — **no redesign permitted**.
- **Backend:** Supabase — Postgres, Auth, Storage, Edge Functions (Deno). 34 timestamped migrations (immutable history).
- **Payments (current):** Stripe (Checkout + webhook) — partially wired, **not active in booking flow**.
- **Payments (target):** TrueLayer primary / Stripe secondary.
- **Email:** Resend (from Supabase Edge Functions). **PDF:** jsPDF (result certificates). **Test:** Vitest + jsdom + Testing Library. Dev port 8080.
- **Supabase project ref (current live):** `rawfqlvnylobdnwwxraz` (services/content re-targeted here per JD-CONTENT1). **Older ref:** `nmqhqlzxaticlbificos` (still in `supabase/config.toml` — confirm which is authoritative before any DB action).

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
- **Accepted + closed (per master ledger):** JD-BASELINE1, JD-DOMAIN1A, JD-TL1B, JD-STRIPE1A, JD-STAFFNOTIF1, JD-ACCESS5B (+ JD-ACCESS5B-VALIDATE), JD-CONTENT1, JD-PORTAL1, JD-PORTAL2A-FIX1B (portal invite → magic-link → /portal live-verified, 2026-05-12).
- **COMPLETE — awaiting owner acceptance (many):** JD-SITEPAY1/2A, JD-SOURCEPREP1/1B, JD-WEB1A, JD-TL1A, JD-SMS1A, JD-READY1A, JD-ACCESS1/2, JD-STAFFNAV1, JD-CONTENT2, JD-PORTAL2A, JD-PORTALPAY1, JD-SEC-SECRETS1, JD-SHOPIFYAUDIT1, JD-COOKIE1, JD-PRIVACY1.
- **Pending / blocked:** JD-DOMAIN1 (blocked on Supabase access), JD-WEB1 (blocked on client content), JD-ADMIN1, JD-LAUNCH1.
- Current completion %: not published as a single figure in the ledger (status was snapshotted 2026-05-11; git HEAD `ef4e851` is newer — booking party-size work continued after).

## Current carry-forward queue

- **Stripe not wired to booking flow** — `create-checkout-session` exists but `BookService.tsx` bypasses it (currently pay-on-site); webhook security already fixed (JD-STRIPE1A).
- **TrueLayer** (target primary payment) — two Edge Function drafts created (`create-truelayer-payment-link`, `truelayer-webhook`), not deployed, not wired.
- **SMS** — `send-sms-reminder` Edge Function + migration drafts created; needs provider account + activation (JD-SMS1).
- **Branded email sender** `noreply@jdtestingonline.com` blocked on Resend domain DNS verification (owner-side); currently sends from `onboarding@resend.dev`.
- **Site-specific payment routing / finance module** — `sites` lacks payment fields; single global Stripe key; no per-site finance.
- Owner acceptance backlog: many phases sit "COMPLETE — awaiting acceptance".

## Known risks / blockers

- Live payment platform: any production action carries financial + customer risk.
- Health-adjacent personal data → GDPR exposure risk on any data handling.
- Lovable-imported app: theme/design and shadcn primitives must not be changed without client approval.
- Migrations are immutable; only add new timestamped migrations.
- **Two Supabase projects in play** (`rawfqlvnylobdnwwxraz` current vs `nmqhqlzxaticlbificos` in config) — DB actions must target the right one.
- **Two role systems coexist** (`profiles.role` + `user_roles` table) — RLS inconsistency risk.
- Hardcoded `lovable.app` origin in `send-booking-reminders`; ~1.3 MB main JS bundle (pre-launch code-split needed).
- Compliance/claims risk: Shopify audit flagged unsafe marketing claims (ISO accreditation, "2,000+ reviews", medical-outcome claims) — must not be imported unreviewed.

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
- **Confirmed from local ledger (read-only, authorised):** Live host Netlify `jdonlinetesting.netlify.app`; current Supabase ref `rawfqlvnylobdnwwxraz` (older `nmqhqlzxaticlbificos`); closed-phase list; carry-forward (Stripe-wiring/TrueLayer/SMS drafts); dual role systems; Shopify-claims risk. Status snapshot 2026-05-11; git HEAD `ef4e851` newer.
- **Not verified:** Single current completion %; current deploy hash; whether the awaiting-acceptance backlog has since been accepted.
- **Needs source:** Up-to-date status newer than git HEAD; confirmation of authoritative Supabase project; current % if owner tracks one.
