# ProjectOS Multi-Project Dashboard

A **local-only, static** dashboard that reads ProjectOS-owned knowledge/report files and generates
dashboard data (JSON), a static HTML dashboard, and a generation report. It is a **reporting surface only**.

## What it does
- `collect-dashboard-data.cjs` reads only approved files under `knowledge/` and `knowledge/reports/`,
  parses the Reports Index into phase rows and each `* Current State.md` into a project summary, and writes
  `projectos/dashboard/dashboard-data.json`. Unclear values are marked `UNKNOWN` / `NEEDS-SOURCE` / `NOT-VERIFIED`.
- `build-static-dashboard.cjs` renders `projectos/dashboard/index.html` from that JSON using **inline CSS only**
  (no external CDN/JS/CSS, no fonts, no analytics, no network).
- `check-dashboard-data.cjs`, `check-dashboard-safety.cjs` and `create-dashboard-report.cjs` validate the data,
  scan for external/network/secret/dangerous patterns, and write `dashboard-generation-report.md`.

## What it does NOT do
- It does **not** scan product repos, connect to live services, or call GitHub/Supabase/Vercel/Netlify/
  Stripe/Resend/Twilio or any external API.
- It does **not** deploy, mutate/seed a database, send messages, touch payments, push, or repair drift.
- It does **not** approve or close. The dashboard config sets `dashboardCanApprove=false` and
  `dashboardCanClose=false`. Dashboard output is **evidence only**.
- It does **not** read `.env`/secret files or anything outside `C:\dev\ProjectOS`.

## Input sources (static, local)
`knowledge/ProjectOS Reports Index.md`, `knowledge/README.md`, `knowledge/Project Progress Prompt.txt`,
and the per-project `knowledge/<Project> Current State.md` files. Reports under `knowledge/reports/`.

## Why no product-repo scanning / external APIs
The dashboard reflects what ProjectOS already knows in its static knowledge pack. Live/product inspection is
out of scope and would breach the read-only, owner-gated model. Statuses are heuristic; confirm
`NEEDS-SOURCE` items with the owner.

## Statuses / risk levels
- **Project:** ACTIVE / LIVE / FROZEN / PILOT / BLUEPRINT / BLOCKED / PARKED / UNKNOWN / NEEDS-SOURCE / NOT-VERIFIED.
- **Phase:** CLOSED / AWAITING-REVIEW / BLOCKED / IMPLEMENTED-LOCALLY / ACCEPTED-FOR-CLOSURE / DO-NOT-CLOSE / NOT-STARTED / UNKNOWN.
- **Risk:** LOW / MEDIUM / HIGH / CRITICAL / BLOCKER / UNKNOWN.

## Future per-project dashboards
A later owner-approved phase may produce project-scoped dashboards from each project's `.projectops` evidence
— still local static, still evidence-only, still no external calls and no approval authority.