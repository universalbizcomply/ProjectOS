# Drift Report — DEMO-DRIFT-PHASE1A

> Evidence only. This is not approval and does not repair drift. No live service was checked.

- **Project:** Demo SaaS Platform
- **Phase:** DEMO-DRIFT-PHASE1A
- **Status:** HARD-STOP
- **Target environment:** staging
- **Expected snapshot:** projectos/examples/demo-drift-expected-snapshot.json
- **Observed snapshot:** projectos/examples/demo-drift-observed-snapshot.json

## Drift summary
7 finding(s); status HARD-STOP (forbidden ref / blocker present)

## Findings
| # | Category | Severity | Status | Expected | Observed |
|---|----------|----------|--------|----------|----------|
| 1 | schema-drift | HIGH | DRIFT-DETECTED | present: bookings | MISSING |
| 2 | schema-drift | HIGH | DRIFT-DETECTED | present: bookings.venue_id | MISSING |
| 3 | route-drift | MEDIUM | DRIFT-DETECTED | absent | extra: /debug |
| 4 | env-config-drift | HIGH | DRIFT-DETECTED | present: RESEND_FROM | MISSING |
| 5 | branch-drift | MEDIUM | DRIFT-DETECTED | branch main | branch staging-fix |
| 6 | deploy-target-drift | HIGH | DRIFT-DETECTED | URL_PLACEHOLDER / PROJECT_REF_PLACEHOLDER | URL_PLACEHOLDER / FORBIDDEN_REF_PLACEHOLDER |
| 7 | forbidden-ref-drift | BLOCKER | HARD-STOP | forbidden ref absent | forbidden ref present: FORBIDDEN_REF_PLACEHOLDER |

## Blockers
- forbidden-ref-drift: forbidden ref present: FORBIDDEN_REF_PLACEHOLDER

## Acceptable carry-forward
- owner/advisor to classify non-blocking findings

## Forbidden refs detected
- FORBIDDEN_REF_PLACEHOLDER

## Production touched?
no
## Live inspection used?
no
## Secrets used?
no
## Repair attempted?
no

## Risks
- Static comparison of supplied files only; observed snapshot accuracy is the owner's responsibility.

## Carry-forward
- Resolve blocker(s) before any proof/deploy.

## Decision needed
Owner/advisor: review drift findings; classify acceptable vs blocking. (inert demo)

> No live service checked. No repair attempted. ProjectOS compares supplied files only.
