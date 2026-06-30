# Staging Deploy Plan — <PHASE_ID>

> Plan only. No deploy is performed by ProjectOS. Approval is owner/advisor.

- **Project:** <PROJECT_NAME>
- **Phase:** <PHASE_ID>
- **Target environment:** staging
- **Target URL:** URL_PLACEHOLDER
- **Branch:** <BRANCH>
- **Commit:** <COMMIT>

## Files changed
- <path>

## Scope
<scope>

## Validators required
- <validator>

## Reviews required
- code-review
- security-review

## Forbidden actions checked
- production deploy: NOT performed
- production DB mutation: NOT performed
- real sends/payment: NOT performed
- secrets used: NONE

## Production touched?
no

## Database touched?
no

## External sends / payments?
no

## Secrets accessed?
no

## External APIs required?
no

## Rollback plan
<how to revert>

## Staging proof plan
<what evidence will prove the deploy is safe>

## Approval status
<DRAFT | READY-FOR-REVIEW | BLOCKED | APPROVED-FOR-STAGING-DEPLOY | DEPLOYED-TO-STAGING | REJECTED>

## Decision needed
<exact owner/advisor decision>