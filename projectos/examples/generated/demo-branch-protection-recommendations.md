# Branch Protection Recommendations — Demo Project (inert)

> Recommendation only. This does NOT configure GitHub. Owner approval required before any installation.

## Protected branches
- main (and any release branches)

## Required local checks (before merge)
- npm run validate
- npm run report:check
- npm run validate:secrets

## Required review evidence
- code-review + security-review evidence in the evidence pack

## No force-push recommendation
- Disallow force-push on protected branches.

## No production auto-deploy recommendation
- No CI job may deploy to production; production deploy stays owner-gated.

## Owner approval gates
- production deploy, DB mutation, real send, payment, CI install, closure — all require Murad/ChatGPT approval.

## Limitations
- Recommendation only. ProjectOS does not call GitHub or configure branch protection in this phase.