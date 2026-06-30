# ProjectOS Staging Deploy Guard

A set of **local-only** scripts/schemas/templates that **prepare, validate and evidence** a staging
deploy *plan* before any deploy is attempted. It builds plans and report skeletons. **It never deploys.**

## What it does
- Validates a **staging deploy request** (`check-staging-deploy-request.cjs`): required fields,
  `targetEnvironment=staging`, `productionTouched=false`, `secretsAccessed=false`, declarations present,
  explicit `approvalStatus`, `decisionNeeded` present.
- Validates the **target** (`check-deploy-target.cjs`): refuses production/prod/live names and
  production-looking URLs; refuses unknown environments unless `--allow-unknown`.
- Generates a **staging deploy plan** (`create-staging-deploy-plan.cjs`) — refuses production targets,
  `productionTouched=true`, `secretsAccessed=true`, or `deployExecuted=true`.
- Generates a **result skeleton** (`create-staging-deploy-result-skeleton.cjs`) with
  `deployAttempted=false`, `deployExecuted=false`, `deployCommand=NOT RUN`.

## What it does NOT do
- It does **not** deploy, run hosting CLIs (Vercel/Netlify/Supabase), or call any external API/MCP.
- It does **not** push, add remotes, mutate databases, send messages or touch payments.
- It does **not** approve deploys. `APPROVED-FOR-STAGING-DEPLOY` only appears if an owner/advisor
  decision is explicitly supplied; the scripts never infer approval.
- It does **not** write outside `C:\dev\ProjectOS` (output paths guarded).

## Why production is refused by default
Production handling is a separate, owner-approved future phase. The guard policy
(`staging-deploy-guard.schema.json`) sets `productionRefuseByDefault: true` and lists production in
`forbiddenTargetEnvironments`. `approvalPolicy.inferApproval` is false.

## Statuses
`DRAFT`, `READY-FOR-REVIEW`, `BLOCKED`, `APPROVED-FOR-STAGING-DEPLOY`, `DEPLOYED-TO-STAGING`, `REJECTED`.

## Rollback + proof
Every request carries a `rollbackPlan` and a `stagingProofPlan`; the generated plan surfaces both for
owner review.

## Future per-project use
A later project-specific phase may wire this guard into a project's `.projectops` (e.g. PolyGo) to
prepare staging-deploy evidence — still local-only, still owner-gated, still no execution here.

## Recommendation is not approval
A guard report may recommend, but the deploy decision and closure remain with Murad/ChatGPT.