# ProjectOS Dashboard — static hosting output (public/)

This folder is the **only** content served by the Vercel deployment.

- `index.html` — the self-contained ProjectOS owner cockpit (inline CSS + vanilla JS; data embedded; 0 external requests).
- No backend, no serverless functions, no database, no secrets, no environment variables, no external CDN/scripts/analytics.
- Dashboard is **evidence/reporting only**. It cannot approve closure, deploy, mutate a database, send messages, take payments, or install into any project.

Read-only. Do not add scripts, trackers, or action controls here.