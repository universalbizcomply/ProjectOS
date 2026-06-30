# BizComply / OPSoft — Current State

> Current-state summary for the BizComply/OPSoft project, for ProjectOS Project Knowledge.
> Sourced read-only from `C:\dev\BizComply V2` on 2026-06-30 with owner authorisation. Unknowns marked clearly.

## Project identity

- **Name:** BizComply OS (marketed as **OPSoft**; this build is **BizComply V2**).
- **Local folder:** `C:\dev\BizComply V2` (owner-confirmed 2026-06-30). Active source tree at `C:\dev\BizComply V2\Source`.
- **Description:** Production-grade, multi-tenant restaurant operating system (SaaS-style).
- **Scope:** POS, KDS, table/floor service, bookings, menu, public website/direct ordering, QR ordering, payments/deposits, finance/EOD/Z-report, inventory/purchasing, workforce/rota/payroll, compliance (Home Office RTW + food/allergen/PPDS), CRM/growth, multi-site/chain.
- **Version:** `bizcomply-os` v0.7.0 (per `package.json`).

## Repo / domain

- **Source repo (origin):** `https://github.com/universalbizcomply/opsoft-ios-lab.git`
  - Local `Source` on branch `main`, HEAD `897569d` ("close SECURITY-ACCESS-HARDEN1A in tracker + link master audit").
- **Full-product mirror (private):** `https://github.com/universalbizcomply/Opsoft-full-Product` (snapshot, 693 files, commit `ecaf149...`).
- **Admin app (Vercel):** `https://bizcomply-admin-app.vercel.app`
- **Marketing/public domain:** NOT VERIFIED — `NEEDS SOURCE`.

## Stack

- **Frontend:** React 19 single-file monolith `Source/frontend/bizcomply-os-v7.jsx` (named React exports only; no default React). Vite 5 build.
- **Mobile/native:** Capacitor 8 (Android build target; iOS lab); PWA + offline.
- **Backend:** Supabase — Postgres (migrations through `0087`), Edge Functions (~37 live after `migrate-v5` decommission), RLS.
- **Email:** Resend. **Payments:** Stripe (Connect + booking deposits, webhooks).
- **Data model:** local-first `localDB` + `commit()` persistence + `useDB()`; sync orchestrator/queue (`syncOrchestrator.js`, `syncQueue.js`).
- **Validation tooling:** large `val-*.cjs` / `verify-*.mjs` suite, Playwright + Puppeteer, Vitest.

## Production / tenant identifiers

- **Production Supabase project ref:** `fkhvnxhdzbyxylnltjtn` (public ref; treated as production — hard-refuse target in Stripe harness guard).
- **Pilot / production tenant:** Kakoli Restaurant (`dad54ba6...`).
- **Sandbox tenant:** `11110000-0000-4000-8000-000000005a1d` (used for lifecycle smoke without touching Kakoli production).

## Multi-tenant / security / RLS sensitivity

- Multi-tenant: tenant isolation is **critical** (RLS-enforced; cross-tenant exposure is the top risk).
- **High-risk gates:** role/security/RLS changes, payment/Stripe (live charge/refund), compliance evidence integrity, production deploy.
- ProjectOS rules should require **strict database/security review** for tenant access, role changes, RLS policies and production deploys.
- An active **SECURITY-ACCESS-HARDEN** track (Track 0) exists; master audit at `Source/docs/OPSOFT_MASTER_AUDIT_AND_EXECUTION_PLAN.md`.

## Governance / roles (as practised in this project)

- **User (Murad):** approves phases, pastes approval-gated implementation prompts.
- **ChatGPT:** consultant, reviewer, execution controller.
- **Claude:** implementation engine — must not write code without an approval-gated implementation prompt.
- Matches the ProjectOS role model. Phases are accept/reject gated by owner before progressing.

## Critical locks (must not modify unless explicitly scoped)

- `handleSaveOrder`, `handleSendToKitchen`, `createOrder`, `sendToKitchen`, KDS core logic, Finance logic.
- Theme colour tokens (`const C`), Sora + JetBrains Mono typography.
- Sync hooks (`scheduleFlush`, `initOrchestrator`, sync badge).
- Do not touch POS, KDS, Finance, payment, stock, printer, QR, menu or compliance unless the phase explicitly scopes them.

## Production status

- **Live pilot** in production on the Kakoli tenant (real £1 Stripe deposit lifecycle proven end-to-end).
- **Dashboard truth (2026-06-21, latest in handoff):** 18 stages · 38 modules · **readiness 41%** · CLOSED 134 · QUEUED 137 · OPEN 0 · DEFERRED 10 · BLOCKED 0.
- `origin/main` recorded untouched at `c94f8af` in handoff; phase work pushed to branch `source-import-2026-05-16`. Local `Source` currently on `main` @ `897569d` — branch/remote posture should be re-confirmed before any deploy.

## Recent closed phases (selected, most recent first)

- **SECURITY-ACCESS-HARDEN1A** (2026-06-21) — decommissioned ungated bulk-write Edge Function `migrate-v5` (audit finding C1); EF count 38→37; validators 15/15 incl live 404 probe.
- **POS-TABLE-KDS-SMOKE1A** (2026-06-21) — validation-only POS/KDS lifecycle smoke on sandbox tenant; Kakoli production untouched.
- **VALIDATOR-HYGIENE-STRIPE1A** (2026-06-18) — re-anchored stale Stripe validator assertions; CI-green.
- **STRIPE-LIVE-HARNESS-TESTMODE1A** (2026-06-18) — gated 9 mutating Stripe harnesses behind `STRIPE_HARNESS_LIVE`; added read-only evidence validator (36/36).
- **PROFESSIONAL-ACCESS1C-LOGIN1A** (2026-06-18) — professional email/password device onboarding; legacy JWT path demoted to Advanced setup.
- **STRIPE-WEBHOOK-FIX1B / STRIPE-DEPOSIT-SUCCESSURL1A / STRIPE-DEPOSIT-ACCEPT** (2026-06-18) — booking-deposit webhook HMAC fix, success/cancel URL tokening, live deposit accept+refund proof.

## Current carry-forward / queued

- **137 queued phases.** Notable:
  - **Stage 18 — SEO, Marketing, Reputation & Growth** (all QUEUED, 0% started).
  - **ANDROID-HW-SMOKE1A / IOS-HW-SMOKE1A** — physical printer + cash-drawer certification on mobile NOT done (Windows/local-bridge proof only so far).
  - **Marketplace (Uber Eats / Deliveroo / Just Eat) — PARKED** (source-of-truth only).
- **Open audit items:** C2 (device-revoke owner-floor), C3 (allergen save-path — LOCKED exception), C4 (stripe2e validator HMAC), H1–H21, plus MEDIUMs.

## Known risks / blockers

- Live multi-tenant production: any RLS/role error risks cross-tenant data exposure on a real pilot tenant.
- Payment paths are live (Stripe Connect / deposits / refunds) — no live charge/refund without explicit owner approval.
- Single-file React monolith + critical locks → high regression risk; surgical edits only.
- Branch/remote posture (main vs `source-import-2026-05-16`) must be reconfirmed before any deploy.
- Compliance evidence integrity is a regulated concern (Home Office RTW, food safety, allergen/PPDS).

## ProjectOS installation considerations

- Require strict database/security review for tenant access, role changes, RLS policies and production deploys.
- No production deploy, no production DB mutation, no live Stripe charge/refund, no real email (Resend) send without explicit owner approval.
- Honour the project's existing critical-locks list and approval-gated phase model.
- Reuse the project's existing validator/evidence discipline (`val-*.cjs`, read-only evidence validators, sandbox-tenant smoke) as the proof-factory pattern.
- Treat **FSA Flutter app as a separate product/track** (not this repo).
- Install a project-local `.projectops` folder only after owner/advisor approval (the path is now authorised for read; write/install still gated).

## Source confidence notes

- All technical facts above sourced read-only from `C:\dev\BizComply V2` (handoff `BIZCOMPLY_OS_HANDOFF_CURRENT.md`, `package.json`, `Source` git metadata) on 2026-06-30 under owner authorisation.
- Supabase project ref and Vercel admin URL are public identifiers (allowed). No secrets, `.env`, service-role keys or password files were opened or included.
- Dashboard counters reflect the handoff as of 2026-06-21; live current counters not independently re-derived this phase.

## Source discipline

- **Confirmed from owner/project memory:** Multi-tenant SaaS-style operational/compliance platform; high-risk gates for role/security/RLS/production deploy; folder `C:\dev\BizComply V2`; this is **BizComply V2** (owner-confirmed 2026-06-30).
- **Confirmed from local repo docs (read-only, authorised):** Name BizComply OS / OPSoft; stack (React 19 monolith, Vite, Capacitor, Supabase, Resend, Stripe); repos `opsoft-ios-lab` + `Opsoft-full-Product`; admin app `bizcomply-admin-app.vercel.app`; prod Supabase ref `fkhvnxhdzbyxylnltjtn`; tenants Kakoli `dad54ba6` + sandbox `11110000-…`; migration head 0087; critical locks; roles; recent closures; dashboard truth 41% / CLOSED 134 / QUEUED 137 (2026-06-21); open audit items; marketplace parked.
- **Not verified:** Live current dashboard counters; current deploy branch/remote posture; marketing/public domain; live EF count today.
- **Needs source:** Marketing/public domain; authoritative live-status snapshot newer than 2026-06-21; whether `source-import-2026-05-16` has been merged to `main`/`origin`.
