# ProjectOS Proof Factory

A set of **local-only** scripts/schemas/templates that **prepare, validate and evidence** controlled
proofs (e.g. no-send proofs, read-only smokes, sandbox lifecycles) before any proof is attempted.
It builds proof plans, evidence skeletons and cleanup plans. **It runs no proof and no cleanup.**

## What it does
- Validates a **proof request** (`check-proof-request.cjs`): required fields, non-production target,
  `secretsRequired=false`, explicit database/external-send/payment declarations, explicit `approvalStatus`,
  `decisionNeeded`.
- Validates the **target** (`check-proof-target.cjs`): refuses production/prod/live; refuses unknown
  environments unless `--allow-unknown`.
- Generates a **proof plan** (`create-proof-plan.cjs`) — refuses production targets, `secretsRequired=true`,
  or `proofExecuted=true`. Execution steps are descriptive only.
- Generates a **proof evidence skeleton** (`create-proof-evidence-skeleton.cjs`) — `proofAttempted=false`,
  `proofExecuted=false`, `proofResult=NOT RUN`.
- Generates a **cleanup plan** (`create-cleanup-plan.cjs`) — descriptive only; executes no cleanup.

## What it does NOT do
- It does **not** run proof, seed data, mutate or clean up any database, or delete files outside the repo.
- It does **not** call Supabase/Vercel/Netlify/GitHub or any external API/MCP, and does **not** push.
- It does **not** approve proof or cleanup. `APPROVED-FOR-STAGING-PROOF` only appears if an owner/advisor
  decision is explicitly supplied; scripts never infer approval.
- It does **not** write outside `C:\dev\ProjectOS` (output paths guarded).

## Why production is refused by default
Production proofs are out of scope. The policy schema (`proof-factory-policy.schema.json`) sets
`productionRefuseByDefault: true`, lists production in `forbiddenEnvironments`,
`cleanupPolicy.executeCleanup=false`, and `approvalPolicy.inferApproval=false`.

## Test data classification
Requests declare `testDataClassification` (synthetic / masked / anonymised / none). No real PII or
customer/production data. `forbiddenDataActions` always includes production-data-read and real-pii-use.

## Residue + cleanup
Proof plans capture a residue plan; a separate cleanup plan records residue items, descriptive cleanup
actions, forbidden cleanup actions, verification steps and an owner-approval requirement — planned only.

## Statuses
`DRAFT`, `READY-FOR-REVIEW`, `BLOCKED`, `APPROVED-FOR-STAGING-PROOF`, `PROOF-RUN-RECORDED`,
`CLEANUP-REQUIRED`, `CLEANUP-PLANNED`, `CLEANUP-VERIFIED`, `REJECTED`.

## Future per-project use
A later project-specific phase may wire the proof factory into a project's `.projectops` (e.g. PolyGo's
no-send proofs) — still local-only, still owner-gated, still no execution here.

## Recommendation is not approval
A proof factory report may recommend, but the proof/cleanup decision and closure remain with Murad/ChatGPT.