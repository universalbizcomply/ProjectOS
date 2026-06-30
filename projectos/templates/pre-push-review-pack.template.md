# Pre-Push Review Pack — <PHASE_ID>

> Prepared for owner/advisor review BEFORE any push. Claude does not push.

## Change summary
- Branch: <BRANCH>
- Commits to be pushed: <list>
- Files changed: <list>

## Diff stat
<git diff --stat output>

## Safety checklist
- [ ] No secrets / tokens / keys in diff
- [ ] No production deploy
- [ ] No production DB mutation
- [ ] No real email/SMS/WhatsApp
- [ ] No payment/live charge
- [ ] No force push intended
- [ ] Target branch correct
- [ ] CI / validators pass locally

## Reviews
- Code review: <result>
- Security review: <result>
- Database review: <result or N/A>

## Owner decision needed
<approve push? to which branch/remote?>