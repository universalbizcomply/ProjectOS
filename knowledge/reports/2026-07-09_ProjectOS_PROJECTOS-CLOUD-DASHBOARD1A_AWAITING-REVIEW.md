# PROJECTOS-CLOUD-DASHBOARD1A — Cloud Data Layer (Evidence Pack)

> **Scope:** Make the Control Center a cloud dashboard — add an optional Supabase data
> source (public anon key only) with a safe seed fallback, plus the schema. Live data +
> Vercel deploy are owner-gated and pending owner-provided credentials/approval. No secrets
> committed. No deploy performed yet.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-CLOUD-DASHBOARD1A — roadmap Phase 9 (data layer), over CONTROL-CENTER1A.
3. **Status:** IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure + provisioning owner-gated.
4. **Branch:** projectos-v2-core (local until pushed).
5. **Files:** `src/data/supabase.ts` (anon-key client + `fetchProjects()` with seed fallback), `src/vite-env.d.ts`, `supabase/schema.sql` (projects table + public-read RLS + 12 seed rows), `.env.example` (local, git-ignored). **Changed:** `App.tsx` (Overview fetches live, falls back to seed, shows the data source), `package.json` (+`@supabase/supabase-js`).
6. **Security posture:** frontend uses **only** the public `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. No `service_role` key, no PAT — none requested, none accepted, none committed. The `projects` table is RLS public-read only. Owner advised to share only URL + anon key (not secrets).
7. **Behaviour:** when env is unset (or a fetch fails), the app renders the static seed and labels the source `seed`; when configured, it reads the `projects` table and labels it `live (Supabase)`.
8. **Typecheck + build:** strict `tsc` EXIT 0; `vite build` EXIT 0 (90 modules, dist ~104 kB gzip).
9. **Runtime verification (seed mode, preview :5178):** Overview shows `12 governed by ProjectOS · data: seed`, 12 cards, KPI 12; **zero console errors**. (Live mode verifies once the owner supplies the URL + anon key.)
10. **Framework validators:** unchanged.
11. **Gated/remaining (owner):**
    - **Supabase project:** the connected MCP is org `jdonlinetesting` (a new project there = **$10/month**), **not** Brik's account. Owner is creating the project on the correct account and will share the URL + anon key.
    - **Vercel deploy:** publishing the dashboard is a gated action; will pause for explicit approval. (Note: monorepo deploy needs core built first, or deploy the prebuilt `dist/`.)
12. **Rollback:** delete `src/data/supabase.ts`, `supabase/schema.sql`, revert the App/package edits.
13. **Decision needed:** owner supplies Supabase URL + anon key (→ I wire `.env.local`, verify live, run the schema), then decides on the Vercel deploy.

## Final status
**PROJECTOS-CLOUD-DASHBOARD1A — AWAITING-REVIEW.** Cloud data layer built + verified (seed mode); Supabase-ready via public anon key with schema; no secrets committed; no resource created, no deploy. Awaiting owner Supabase creds (correct account) + deploy approval.
