# PROJECTOS-CLOUD-DASHBOARD1B — Live Supabase + Vercel Deploy (Evidence Pack)

> **Scope:** Owner-authorised completion of the cloud dashboard — create the `projects`
> table on the owner's Supabase project, verify live data, and deploy the Control Center to
> the owner's Vercel team (techcricsmart). Owner explicitly authorised each gated action and
> the credential use. No secrets committed to the repo.

1. **Project:** ProjectOS — Universal Project Delivery OS
2. **Phase:** PROJECTOS-CLOUD-DASHBOARD1B (CLOUD_DEPLOY) — over CLOUD-DASHBOARD1A. Owner-gated actions performed under explicit owner authorisation.
3. **Status:** IMPLEMENTED / DEPLOYED / AWAITING-REVIEW. Closure owner-gated.
4. **Branch:** projectos-v2-core.
5. **Supabase (owner-provided project `vzbzkziksxvyfqrdrwqx`):**
   - Table created via the Supabase Management API (owner-authorised, PAT used transiently in an env var, never written to any file/commit): `public.projects` + public-read RLS + 12 seed rows. Result HTTP 201.
   - Frontend reads it with the **public publishable key only** (`sb_publishable_...`) via `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in a git-ignored `.env.local`.
6. **Live verification (local preview :5178):** Overview shows `data: live (Supabase)`, 12 cards from the DB; the REST fetch `/rest/v1/projects` returns **200** (was 404 before the table existed); zero console errors.
7. **Vercel deploy (owner team `techcricsmart`):**
   - Built static (`vite build`, env baked in) → Vercel Build-Output → `vercel deploy --prebuilt --prod` with an owner-provided token (transient env var, not committed). Authed as `techcricsmart-5931`.
   - **Deployment:** `dpl_4NP66eikVxM4qRiVQWxD6WVHLLjB`, target production, READY. Project `techcricsmart/control-center`.
   - **URL:** https://control-center-62qrjokyf-techcricsmart.vercel.app
   - **Access:** protected by **Vercel Deployment Protection** — the URL 302-redirects to `vercel.com/sso-api`, so only techcricsmart members (owner) can open it; not public. Matches the owner-dashboard posture.
8. **Security:** no `service_role`/`sb_secret`/PAT/Vercel token committed to the repo. `.env.local` and `.vercel/` are git-ignored. The frontend bundle contains only the public Supabase URL + publishable key (safe). **Owner must revoke the leaked `sbp_` PAT and `sb_secret_` key** (only the publishable key is needed).
9. **Typecheck + build:** strict `tsc` + `vite build` EXIT 0.
10. **Framework validators:** unchanged.
11. **Rollback:** delete the `techcricsmart/control-center` Vercel project (or its deployment); drop the `projects` table in Supabase; remove `.env.local`.
12. **Carry-forward:** the deploy created a **new** project `control-center` (not the existing auth-app `projectos-dashboard`) — kept separate to avoid disturbing the earlier login-walled dashboard; owner can alias/rename if desired. A stable production alias exists under the project. Optional: wire live phases/approvals tables next.
13. **Decision needed:** owner/advisor review + closure; revoke the leaked keys.

## Final status
**PROJECTOS-CLOUD-DASHBOARD1B — DEPLOYED / AWAITING-REVIEW.** Live Supabase-backed cloud dashboard deployed to techcricsmart (login-walled). Public keys only in the bundle; no secrets committed. Owner to revoke the leaked PAT + secret key, review, and close.
