# ProjectOS Dashboard — Remote Access Options (decision reference)

> Local/static governance reference only. No hosting is configured. No deploy has happened.
> The dashboard is **evidence/reporting only** and has no approval/closure/deploy/DB/send/payment/install authority.

## Options at a glance

| Opt | Route | Privacy | Remote ease | Public-exposure risk | Secrets needed | Maintenance | Stays static/read-only | Owner-only fit | OK before JD/BizComply install | Reversible | Verdict |
|-----|-------|---------|-------------|----------------------|----------------|-------------|------------------------|----------------|-------------------------------|------------|---------|
| A | Private repo download + open locally | HIGH | LOW | NONE | No | LOW | YES | YES | YES | YES (nothing to undo) | Fallback (zero exposure) |
| B | Private Vercel static + access protection | HIGH (if gated) | HIGH | LOW-MED (config-dependent) | Access cred only (no app secrets) | LOW-MED | YES | YES | YES | YES (delete project) | **RECOMMENDED** (separate deploy phase) |
| C | Private Netlify static + access protection | HIGH (if gated) | HIGH | LOW-MED (config-dependent) | Access cred only | LOW-MED | YES | YES | YES | YES (delete site) | Viable alt to B |
| D | Internal authenticated app later | HIGH | HIGH | LOW | Auth system | HIGH | Needs discipline | YES | Not this phase | YES | Best long-term, later |
| E | GitHub Pages | LOW (public by default) | HIGH | **HIGH** | No | LOW | YES | NO | NO | YES | **REJECTED** unless private access proven |
| F | Continue local-only (repo = backup) | HIGH | LOW | NONE | No | LOW | YES | YES | YES | YES | Acceptable fallback |

## Recommendation
**Option B — Private Vercel protected static dashboard**, deployed in a separate owner-approved phase
`PROJECTOS-DASHBOARD-PRIVATE-HOSTING-DEPLOY1B`. Until then: **DO NOT HOST**; use Option A/F (private repo backup, open locally).

## Hard rules for any hosted route
1. Never public unless owner explicitly accepts that risk in writing.
2. Dashboard contains governance + project-delivery data — treat as confidential.
3. Dashboard stays **read-only static** (inline CSS + vanilla JS, no backend).
4. No secrets in the dashboard or repo.
5. No repo/deploy/DB/email/SMS/payment actions triggered from the dashboard.
6. Dashboard cannot approve project installs.
7. Dashboard does not replace ChatGPT/owner gatekeeping.
8. Hosting configuration is a separate owner-approved phase.
9. JD Testing + BizComply/OPSoft installs wait until hosting/access is settled, or owner chooses to proceed without it.