# Branch Protection Recommendations — <PROJECT_NAME>

> Recommendation template only. This does NOT configure GitHub. Owner approval required before any installation.

## Protected branches
- main (and any release branches)

## Required local checks (before merge)
- npm run validate (all ProjectOS validators)
- npm run report:check
- npm run validate:secrets

## Required review evidence
- code-review and security-review evidence in the evidence pack (ECC or named provider)

## No force-push recommendation
- Disallow force-push on protected branches.

## No production auto-deploy recommendation
- No CI job may deploy to production. Production deploy stays owner-gated.

## Owner approval gates
- production deploy, DB mutation, real send, payment, CI install, closure — all require Murad/ChatGPT approval.

## Limitations
- This is a recommendation only. ProjectOS does not call GitHub or configure branch protection in this phase.