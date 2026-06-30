# Private Hosting Decision — Template

> Fill per hosting decision. ProjectOS-only. Recording a decision here does NOT configure hosting.

- **Project:** ProjectOS — Universal Project Delivery OS
- **Phase:** <PHASE-ID>
- **Date:** <YYYY-MM-DD>
- **Decided by (owner/advisor):** <name>
- **Artifact to host:** projectos/dashboard/ (static, read-only)

## Decision
- **Chosen option:** <A repo-local | B private Vercel | C private Netlify | D internal app later | F local-only>
- **Public exposure accepted?** <NO (default) | YES — explicit owner statement quoted below>
- **Access model:** <owner-only password | SSO | none (local)>
- **Deploy phase required?** <yes → PROJECTOS-DASHBOARD-PRIVATE-HOSTING-DEPLOY1B | no>

## Safety confirmations (must all be YES before any deploy phase)
- [ ] Dashboard static + read-only
- [ ] No secrets in dashboard or repo
- [ ] No repo/deploy/DB/send/payment/install actions from dashboard
- [ ] Access gated, owner-only
- [ ] No GitHub Actions / .github/workflows
- [ ] Reversible (documented teardown)
- [ ] Hosting config is a separate approved phase

## Owner statement (verbatim)
<paste exact owner approval text, including any explicit acceptance of exposure risk>

## Next phase boundaries (if deploy approved)
<list what the deploy phase may and may not do>