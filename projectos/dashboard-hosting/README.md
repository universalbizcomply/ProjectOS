# ProjectOS Dashboard - Server-Gated Auth App (PROJECTOS-DASHBOARD-AUTH-APP1E)

Public URL, but the dashboard is served **only after login**. Single owner.

## How it works
- `api/app.js` (Vercel Function) handles every route (via `vercel.json` rewrites).
- No valid session -> returns a **login page** (no dashboard, no data).
- Correct username+password -> sets a signed, HttpOnly, Secure session cookie (8h) -> serves the dashboard.
- The dashboard HTML lives in `assets/dashboard.html` (bundled into the function via `includeFiles`), **not** in any public/static path. There is no static route that serves it.

## Required Vercel env vars (Production) - set by OWNER, never in the repo
- `SESSION_SECRET` - random 32-byte hex (signs the session cookie).
- `DASH_PASSWORD_HASH` - **sha256 hex** of your chosen password.
- `DASH_USER` - (optional) required username; if unset, only the password is checked.

Generate locally (plaintext never leaves your machine):
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"          # SESSION_SECRET
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "YOUR_PASSWORD"   # DASH_PASSWORD_HASH
```
Add them in Vercel -> project `projectos-dashboard` -> Settings -> Environment Variables (Production), then redeploy.

If the env vars are missing, the app stays **locked** (shows "not configured") - safe default, never leaks the dashboard.

## Security properties
- Data withheld until authenticated (server-side gate, not client-side).
- Secrets only in Vercel env (git-ignored `.env*`, `.vercel/`); none committed.
- No external assets/CDN/analytics; no DB/send/payment/install controls; dashboard read-only, evidence-only.
- Cookie: HttpOnly + Secure + SameSite=Lax; HMAC-signed; 8h expiry. Logout: `/?action=logout`.

## Deploy
`vercel deploy --prod --scope techcricsmart` (from this folder). Deploys only this folder; touches no product project.