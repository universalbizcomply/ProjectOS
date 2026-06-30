# TKN — Current State

> Current-state summary for the TKN project, for ProjectOS Project Knowledge.
> Sourced read-only from `C:\dev\TKN` on 2026-06-30 with owner authorisation. Unknowns marked clearly.
> Owner referred to this as "TKH"; the folder/package is **TKN (ToKnowNothing)** — treated as the same project.

## Project identity

- **Name:** TKN (ToKnowNothing) — premium streetwear ecommerce clothing brand.
- **Local folder:** `C:\dev\TKN` (active source at `\streetwear`; package name `toknownothing`).
- **Type:** Independent, production-ready **ecommerce** storefront.

## Repo

- **No git repository** in the source (`C:\dev\TKN\streetwear` has no `.git`). Local-only working copy. Remote: `NEEDS SOURCE`.
- A `noir-streetwear.zip` archive also exists at `C:\dev\TKN`.

## Stack

- **Framework:** Next.js 14 (App Router) + TypeScript.
- **Backend:** Supabase (Postgres, Auth, Storage; `@supabase/ssr`, `@supabase/auth-helpers-nextjs`). `middleware.ts` present.
- **Payments:** Stripe **and** PayPal (`@stripe/*`, `@paypal/react-paypal-js`).
- **Email:** Resend. **Forms/validation:** react-hook-form + Zod. **UI:** Tailwind CSS, framer-motion, lucide-react.
- **Hosting:** Vercel (per README).

## Payment / customer sensitivity

- **Stripe + PayPal** checkout → **sensitive** (live financial; dual provider).
- Customer accounts, orders, addresses + Resend emails → personal data, **sensitive**.
- ProjectOS should treat payment, customer email, order mutation and production deploy as **high-risk gates**.

## Production status

- Described as "production-ready"; live URL / deploy status / git remote **NOT VERIFIED** — `NEEDS SOURCE`.

## Recent closed phases

- **NEEDS SOURCE** — no git history available locally; `docs/` not enumerated this pass.

## Current carry-forward queue

- **NEEDS SOURCE.**

## Known risks / blockers

- **No local git** → no version history / source-of-truth tracking; establish a repo before any controlled delivery.
- Dual live payment providers (Stripe + PayPal) increase financial surface.
- Detailed risk register: **NEEDS SOURCE**.

## ProjectOS installation considerations

- Treat payment (Stripe + PayPal), customer email, order mutation and production deploy as high-risk gates; no live charge / real send / production deploy without explicit owner approval.
- Recommend initialising a git repo / remote before ProjectOS controlled-delivery install.
- Install a project-local `.projectops` folder only after owner/advisor approval.

## Source confidence notes

- Facts sourced read-only from `C:\dev\TKN\streetwear` (`package.json`, `README.md`) on 2026-06-30 under owner authorisation.
- No `.env`/`.env.local` or secrets opened or included.

## Source discipline

- **Confirmed from owner/project memory:** TKN (owner wrote "TKH") is a Murad project under `C:\dev` (owner-confirmed 2026-06-30).
- **Confirmed from local repo docs (read-only, authorised):** Package `toknownothing`; Next.js 14 + TS + Supabase + Stripe + PayPal + Resend + Tailwind; premium streetwear ecommerce; no local git.
- **Not verified:** Git remote; live URL/deploy; closed phases; current status.
- **Needs source:** Git remote (if any); live URL + deploy status; closed-phase history; carry-forward; risk register.
