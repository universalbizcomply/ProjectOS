# PROJECTOPS-STAGING-DRIFT-DETECTOR1A — Phase Report (Evidence Pack)

- **Project:** ProjectOS — Universal Project Delivery OS
- **Phase:** PROJECTOPS-STAGING-DRIFT-DETECTOR1A (STAGING_PARITY / DRIFT_DETECTION / GOVERNANCE_FRAMEWORK)
- **Status:** IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW
- **Branch:** main
- **Commit:** this phase commit; HEAD before work was `e04a474`.

## Files changed
**Schemas (5 new):** drift-snapshot, drift-check-request, drift-finding, drift-report, drift-detector-policy.
**Templates (5 new):** drift-check-request.template.json, drift-snapshot.template.json, drift-finding.template.json, drift-report.template.md, drift-detector-report.template.md.
**Scripts (5 new):** check-drift-request, check-drift-snapshot, compare-drift-snapshots, create-drift-report-skeleton, check-drift-target.
**Validators (4 new, 1 updated):** validate-drift-request/snapshot/output/detector (new); validate-all (wired).
**package.json:** +drift:check, drift:snapshot, drift:compare, drift:report, drift:target, validate:drift.
**Examples (3 new + 2 generated):** demo-drift-expected-snapshot.json, demo-drift-observed-snapshot.json, demo-drift-check-request.json; generated/demo-drift-report.md, demo-drift-report-skeleton.md.
**Docs (1 new, 4 updated):** staging-drift-detector.md (new); safety-gates.md, phase-lifecycle.md, architecture.md, future-roadmap.md (references appended).
Plus this report + a Reports Index row.

## Scope
Central ProjectOS-only. Build a local-only staging drift detector (schemas/templates/scripts/validators/
docs/inert examples) that compares two supplied static JSON snapshots and reports drift. Out of scope
(not done): any live connection/inspection, drift repair, migration generation/edit, DB connect/mutate/seed,
production handling, product repo, PolyGo branch/merge/push, deploy, sends, payments, hosting/Git CLIs,
external APIs, MCP, ECC agent runs, GitHub Actions, remotes, push.

## Forbidden actions checked
- live inspection: NO (compares supplied files only)
- drift repair: NO
- database connection / mutation / seed: NO
- migration generation / edit: NO
- production target: REFUSED by default (proven: production env + production-looking URL refused)
- production touched: NO
- real email/SMS/WhatsApp / payment: NO
- Supabase/Vercel/Netlify/GitHub CLI/API: NO
- secrets used: NONE
- force push / push / remote: NONE
- PolyGo touched / branch switched / merged: NO
- product repo modified: NO

## Validators
`npm run validate` (validate-all) → ALL PASS (23 validators incl. 4 new drift validators).
`npm run validate:drift` → PASS (request, snapshot, output, detector). `report:check` → PASS.
Runtime proofs: drift request-check PASS; snapshot-check PASS (both demo snapshots); target-check
**REFUSED** on production; compare produced a drift report with status **HARD-STOP** (7 findings incl. a
forbidden-ref BLOCKER); report skeleton generated; outputs path-guarded to `C:\dev\ProjectOS`.

## tsc / build / eslint
N/A — dependency-free Node (built-ins only); scripts run under Node v24.

## Security review
Self-check: secret scan over `projectos/` → no matches; `.env` under ProjectOS → NONE. Snapshot validator
rejects secret-like values and live-connection/secret keys. Output-validator asserts the 5 drift scripts
contain **no** DB-SQL, deploy-CLI, or network tokens. Path guard enforced. Snapshots carry env KEY NAMES
only — never values.

## Code review
Self-review only. Scripts reuse the reporter lib for path-guarded output; only `fs`/`path` used; no network;
no live connection; no repair/approval/closure logic.

## Database review
N/A — no database access, no connection, no SQL, no migration.

## Staging proof
N/A — nothing run live. A drift report + skeleton are produced from static files for future use.

## Production touched?
No.

## External sends / payments?
No.

## Residue
NONE in repo. A temporary production-target test JSON was created in the session scratch dir (outside the
repo) to prove refusal; no repo file written for it.

## Risks
- Validators are heading/shape/secret/token checks, not full JSON-Schema or semantic validation.
- The detector trusts the accuracy of supplied static snapshots; it cannot verify they match live state
  (by design — no live inspection). Live snapshot capture remains a separate owner-approved phase.

## Carry-forward
- A later phase to capture real (owner-provided) snapshots and run drift checks for a real project.
- PROJECTOPS-CI-GOVERNANCE1A / MULTI-PROJECT-DASHBOARD1A remain separate, not started.

## Decision needed
1. Accept the staging drift detector baseline (schemas/templates/scripts/validators/docs).
2. Approve moving to the next phase (CI-GOVERNANCE1A or another).

## Drift detector summary
Local-only detector: validate a drift request (`check-drift-request`), validate snapshots
(`check-drift-snapshot`), validate the target (`check-drift-target` — refuses production/unknown),
compare expected vs observed static snapshots (`compare-drift-snapshots` — detects missing/extra
tables/columns/functions/routes/migrations/env-key-names/policies, branch + deploy-target drift, and
forbidden refs → HARD-STOP) and generate a report skeleton (`create-drift-report-skeleton`). Policy schema
sets productionRefuseByDefault=true, liveInspection/secrets/repair all not-allowed, inferApproval=false.
Recommendation is not approval; it repairs nothing and connects to nothing.

## Generated demo outputs
- `projectos/examples/generated/demo-drift-report.md` (status HARD-STOP; 7 findings incl. forbidden-ref BLOCKER; productionTouched/liveInspectionUsed/secretsUsed/repairAttempted all false; no live service checked; no repair)
- `projectos/examples/generated/demo-drift-report-skeleton.md` (skeleton; no live inspection; no repair; decision needed)

## Live inspection used?
No.

## Repair attempted?
No.

## Production target refused?
Yes — refused by default (proven on a production env + production-looking URL).

## External tools used?
No.

## MCP used?
No.

## Autonomous behaviour enabled?
No — scripts run only when invoked; they decide nothing and call nothing external.

## Expected status
PROJECTOPS-STAGING-DRIFT-DETECTOR1A — IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW.
Do not mark closed. Do not start CI-GOVERNANCE1A / MULTI-PROJECT-DASHBOARD1A / PolyGo carry-forward.