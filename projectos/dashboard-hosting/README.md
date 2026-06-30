# ProjectOS Dashboard — Private Vercel Hosting Wrapper

> **Status: PREPARED, NOT DEPLOYED.** Phase `PROJECTOS-DASHBOARD-PRIVATE-HOSTING-DEPLOY1B` left this wrapper
> ready but **did not deploy** (see report). Deploy + protection must be performed under explicit owner
> authorization. A publicly reachable dashboard is a hard stop / failure.

## What this is
A minimal **static-only** Vercel project that serves exactly one artifact: the self-contained ProjectOS
owner cockpit at `public/index.html`. No backend, no functions, no DB, no env vars, no secrets, no CDN.

## Why deploy was not performed in 1B
The deploy step needs an account-authenticated mechanism. Within phase 1B's constraints, none was available:
- The Vercel **MCP** deploy action is disallowed by the phase (no MCP tools).
- The Vercel **CLI/API** needs a token; the phase forbids asking for / printing / reading tokens, and the
  runner is non-interactive (so `vercel login` cannot complete).
So deploy was **blocked before exposure** — the correct safe outcome — rather than risk a public URL.

## Required protection model (MUST be true before any URL is accepted)
- **Vercel Authentication** ON for the deployment (owner/team-member-only). Available on all plans.
- **No** public access. **No** Deployment Protection Exceptions. **No** shareable links. **No** automation
  bypass secret. **No** GitHub Pages. **No** paid add-on enabled without separate owner approval.
- If the plan cannot protect the **production** deployment without a paid add-on: do **not** enable it —
  deploy only a genuinely-protected preview, or **block**. If the only possible result is public: **block**.

## One-time deploy runbook (run only under owner authorization — do NOT run automatically)
1. From `projectos/dashboard-hosting/`: `vercel link` (create/select a **private** project under the owner's account/team).
2. In Vercel project **Settings → Deployment Protection**: enable **Vercel Authentication** for **all deployments**
   (or production + preview). Confirm: no exceptions, no bypass, no shareable link, no automation bypass secret.
3. Deploy: `vercel deploy` (preview) then, only if protection is confirmed, `vercel deploy --prod`.
4. **Verify protection BEFORE accepting the URL:**
   - Authorized browser (owner signed into Vercel) → dashboard loads after auth.
   - Incognito / unauthenticated → Vercel auth wall blocks; dashboard content NOT visible.
   - Network: 0 external requests beyond Vercel's own auth flow; 0 console errors; no secrets; no action controls.
5. If unauthenticated access can see the dashboard → **hard stop**, disable the deployment, report SECURITY BLOCKER.

## Config notes
- `vercel.json`: static (`framework: null`, no build/install), `outputDirectory: public`, `public: false`,
  GitHub auto-deploy disabled, hardening headers (nosniff, DENY frame, no-referrer, restrictive permissions).
- `package.json`: private, no dependencies, no build step.