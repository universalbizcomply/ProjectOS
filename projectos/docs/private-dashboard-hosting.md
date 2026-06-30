# Private Dashboard Hosting — ProjectOS Governance

> ProjectOS-only governance doc. Decision/prep guidance for remote access to the interactive dashboard.
> No hosting is configured by this doc. Hosting requires a separate owner-approved deploy phase.

## Why this exists
Murad wants to use the ProjectOS owner cockpit (`projectos/dashboard/index.html`) remotely
(e.g. phone, away from the workstation). The dashboard holds **governance and project-delivery data**,
so any remote exposure must be private, gated and read-only.

## What the dashboard is (and is not)
- IS: a single self-contained static HTML file (inline CSS + vanilla JS), 0 external requests,
  evidence/reporting only.
- IS NOT: an action surface. It cannot approve closure, deploy, mutate a database, send messages,
  take payments, or install `.projectops` into any project. It does not replace ChatGPT/owner gatekeeping.

## Access-model principles
1. **Private by default.** Public exposure only with explicit written owner acceptance.
2. **Read-only.** No backend, no write paths, no action controls.
3. **No secrets.** The dashboard and repo carry no tokens/keys; an access cred (e.g. host password/SSO)
   is an infrastructure credential held by the host, never committed.
4. **Least privilege.** Owner-only access; no team-wide or anonymous links.
5. **Reversible.** Any hosted route must be deletable with no residue and no impact on product repos.
6. **Separation of duties.** Hosting config is its own approved phase; this phase only decides/prepares.

## Routes considered
See `projectos/dashboard/REMOTE-ACCESS-OPTIONS.md` for the scored matrix.
- **A** Private repo download + open locally — zero exposure, low convenience.
- **B** Private Vercel static + access protection — **recommended**; best usability, gated, static.
- **C** Private Netlify static + access protection — viable alternative to B.
- **D** Internal authenticated app — best long-term, more work, later.
- **E** GitHub Pages — rejected (public by default; unacceptable for governance data).
- **F** Local-only, repo as backup — acceptable fallback.

## Recommended route
**Option B — Private Vercel protected static dashboard**, executed later under
`PROJECTOS-DASHBOARD-PRIVATE-HOSTING-DEPLOY1B` after owner approval.

### What the deploy phase (1B) must guarantee if B is chosen
- Deploy **only** `projectos/dashboard/` static output; no app/server code.
- Access protection ON before/with first deploy: deployment/password protection or SSO; **owner-only**.
- No public production URL without explicit owner sign-off.
- No environment secrets injected into the static build.
- No GitHub Actions / `.github/workflows`; no auto-deploy on push.
- No DB/email/SMS/payment integration; dashboard stays static read-only.
- Documented teardown (delete project) for full reversibility.

## Until hosting is approved
Use Option A/F: pull the private repo on the remote device and open `index.html` locally.
JD Testing and BizComply/OPSoft installs remain not started and wait on this decision
(or an explicit owner choice to proceed without remote hosting).