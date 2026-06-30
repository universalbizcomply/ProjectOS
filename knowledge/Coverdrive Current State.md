# Coverdrive — Current State

> Current-state summary for the Coverdrive project, for ProjectOS Project Knowledge.
> Sourced read-only from `C:\dev\Coverdrive` on 2026-06-30 with owner authorisation. Unknowns marked clearly.

## Project identity

- **Name:** Coverdrive Indoor Cricket Centre.
- **Local folder:** `C:\dev\Coverdrive` (active source at `\coverdrive`).
- **Type:** Production SaaS-style **booking platform** for Coverdrive Indoor Cricket Centre, Manchester.
- **Surfaces:** public homepage, live availability grid, booking form + payment + success page, contact; admin (dashboard, bookings, manual lane tracker, pricing settings, customer history) behind Supabase auth login.

## Repo

- **Origin:** `https://github.com/coverdrivemanchester-art/Coverdrive.git`
- Local on branch `main`, HEAD `cfe357f` ("Add revalidate=0 to dashboard for fresh data on every load").

## Stack

- **Framework:** Next.js 14 (App Router) + TypeScript.
- **Backend:** Supabase (`@supabase/ssr`, `@supabase/auth-helpers-nextjs`, `@supabase/supabase-js`; Postgres + Auth). `middleware.ts` present.
- **Payments:** Stripe. **Email:** Resend. **Validation:** Zod. **UI:** Tailwind CSS, lucide-react.
- **Hosting:** Vercel.

## Booking / payment / customer sensitivity

- Stripe payments → **sensitive** (live financial).
- Customer booking + contact data + Resend emails → **sensitive**.
- Booking mutation + lane/pricing admin → **sensitive**.
- ProjectOS should treat payment, customer email, booking mutation and production deploy as **high-risk gates**.

## Production status

- Described as "production-ready"; live URL / current deploy hash **NOT VERIFIED** — `NEEDS SOURCE`.

## Recent closed phases

- **NEEDS SOURCE** — latest commit `cfe357f` (dashboard revalidate fix).

## Current carry-forward queue

- **NEEDS SOURCE.**

## Known risks / blockers

- Live payments + customer PII on a single-tenant booking site.
- Detailed risk register: **NEEDS SOURCE**.

## ProjectOS installation considerations

- Treat payment, customer email, booking mutation and production deploy as high-risk gates; no live charge / real send / production deploy without explicit owner approval.
- Install a project-local `.projectops` folder only after owner/advisor approval.

## Source confidence notes

- Facts sourced read-only from `C:\dev\Coverdrive\coverdrive` (`package.json`, `README.md`, git metadata) on 2026-06-30 under owner authorisation.
- No `.env`/`.env.local` or secrets opened or included.

## Source discipline

- **Confirmed from owner/project memory:** Coverdrive is a Murad project under `C:\dev` (owner-confirmed 2026-06-30).
- **Confirmed from local repo docs (read-only, authorised):** Repo `coverdrivemanchester-art/Coverdrive` (`main`@`cfe357f`); Next.js 14 + TS + Supabase + Stripe + Resend + Tailwind on Vercel; booking platform for Coverdrive Indoor Cricket Centre, Manchester; admin surfaces.
- **Not verified:** Live URL/deploy; closed phases; current status.
- **Needs source:** Live URL + deploy status; closed-phase history; carry-forward; risk register.
