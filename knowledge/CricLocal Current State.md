# CricLocal — Current State

> Current-state summary for the CricLocal project, for ProjectOS Project Knowledge.
> Sourced read-only from `C:\dev\CricLocal` on 2026-06-30 with owner authorisation. Unknowns marked clearly.

## Project identity

- **Name:** CricLocal.
- **Local folder:** `C:\dev\CricLocal` (contains `criclocal-repo` [canonical git], `CricLocal-Source`, `CricLocal-Cowork`).
- **Type:** Local cricket league / club management + live-scoring platform (SaaS-style).
- **Features (per README):** live scoring (Supabase realtime), dashboard/analytics, marketplace/auctions/transfers, club management, tournaments (drafts/matches), dispute resolution, umpire analytics, player profiles (karma/stats/trade), DLS calculator + AI player analysis as Edge Functions.

## Repo

- **Origin:** `https://github.com/muraddevbuild-maker/criclocal`
- Canonical local checkout `criclocal-repo` on branch `main`, HEAD `4ae5eb4` ("add custom match rules setup").
- `CricLocal-Source` and `CricLocal-Cowork` are additional local copies (no git in `CricLocal-Source`).

## Stack

- **Frontend (per `package.json`):** React + TypeScript via Create React App (`react-scripts`), React Router, Recharts, framer-motion, jsPDF + jspdf-autotable, xlsx, idb-keyval.
- **Backend:** Supabase (`@supabase/supabase-js`; realtime/auth/Postgres; Edge Functions per README).
- **Hosting:** Vercel (`vercel.json`, `.vercel`).
- **Payments:** Stripe (per README).
- **Note:** README also claims "React 19" and external services (Pinecone, Peak); the committed `package.json` is a `react-scripts` CRA app — treat `package.json` as authoritative, README feature list as aspirational/marketing.

## Booking / payment / customer sensitivity

- Stripe payments present → **sensitive** (live financial if activated).
- User/player profiles + trade/marketplace data → personal data, **sensitive**.
- ProjectOS should treat payment and production deploy as **high-risk gates**.

## Production status

- Vercel-hosted; live URL / current deploy hash **NOT VERIFIED** — `NEEDS SOURCE`.

## Recent closed phases

- **NEEDS SOURCE** — `criclocal-repo/docs` not enumerated this pass. Latest commit `4ae5eb4` (custom match rules).

## Current carry-forward queue

- **NEEDS SOURCE.**

## Known risks / blockers

- Multiple local copies (`criclocal-repo` vs `CricLocal-Source` vs `CricLocal-Cowork`) → drift / source-of-truth risk; `criclocal-repo` (git) is canonical.
- Payment (Stripe) and any production deploy are high-risk.
- Detailed risk register: **NEEDS SOURCE**.

## ProjectOS installation considerations

- Treat payment and production deploy as high-risk gates; no live charge / production deploy without explicit owner approval.
- Resolve which local copy is canonical before any install (use `criclocal-repo`).
- Install a project-local `.projectops` folder only after owner/advisor approval.

## Source confidence notes

- Facts sourced read-only from `C:\dev\CricLocal` (`criclocal-repo/package.json`, `README.md`, git metadata) on 2026-06-30 under owner authorisation.
- No `.env`/`.env.local` or secrets opened or included.

## Source discipline

- **Confirmed from owner/project memory:** CricLocal is a Murad project under `C:\dev` (owner-confirmed 2026-06-30).
- **Confirmed from local repo docs (read-only, authorised):** Repo `muraddevbuild-maker/criclocal` (`main`@`4ae5eb4`); CRA React + TS stack with Supabase + Vercel + Stripe; cricket league/scoring/club/marketplace feature set; three local copies.
- **Not verified:** Live URL/deploy; React-19 claim; Pinecone/Peak usage; closed phases; current status.
- **Needs source:** Live URL + deploy status; canonical-copy confirmation; closed-phase history; carry-forward; risk register.
