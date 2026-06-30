# ProjectOS Staging Drift Detector

A set of **local-only** scripts/schemas/templates that **compare two supplied static JSON snapshots**
(expected vs observed) and generate a **drift report**. It reads files only. **It connects to nothing.**

## What it does
- Validates a **drift check request** (`check-drift-request.cjs`): required fields, non-production target,
  `productionTouched/liveInspectionRequested/secretsAccessed/repairRequested` all false, snapshot paths
  inside `C:\dev\ProjectOS`, explicit `approvalStatus`, `decisionNeeded`.
- Validates a **snapshot** (`check-drift-snapshot.cjs`): required fields, `sourceType` is
  static-file/manual-export/owner-provided, no secret-like values, no live-connection/secret keys.
- Validates the **target** (`check-drift-target.cjs`): refuses production/prod/live; refuses unknown envs
  unless `--allow-unknown`.
- **Compares** expected vs observed (`compare-drift-snapshots.cjs`): detects missing/extra tables, columns,
  functions, routes, migrations, env KEY NAMES and policies; branch and deploy-target drift; and
  **forbidden refs** (hard-stop). Writes a drift report.
- Generates a **drift report skeleton** (`create-drift-report-skeleton.cjs`).

## What it does NOT do
- It does **not** connect to any database or service, inspect live state, repair drift, generate/edit
  migrations, deploy, seed or mutate anything.
- It does **not** call Supabase/Vercel/Netlify/GitHub or any external API/MCP, and does **not** push.
- It does **not** approve or close. Findings are evidence only; `recommendation is not approval`.
- It does **not** write outside `C:\dev\ProjectOS` (output paths guarded).

## Why production is refused by default
The policy schema (`drift-detector-policy.schema.json`) sets `productionRefuseByDefault: true`, lists
production in `forbiddenEnvironments`, and forces `liveInspectionPolicy.allowed=false`,
`repairPolicy.allowed=false`, `secretsPolicy.allowed=false`, `approvalPolicy.inferApproval=false`.

## Snapshots
Both expected and observed snapshots use the `drift-snapshot` shape: static lists of tables/columns/
functions/routes/migrations/env KEY NAMES/policies, plus branch/commit/targetUrl/projectRef and a
`forbiddenRefs` list. **Env values and secrets are never included — key NAMES only.**

## Forbidden refs
If any forbidden ref (from the request or the expected snapshot) appears anywhere in the observed
snapshot, the detector records a `forbidden-ref-drift` finding at `BLOCKER` severity and sets overall
status to `HARD-STOP` — e.g. a project pointing at a banned old project ref.

## Categories / severities / statuses
Categories: schema/migration/function/edge-function/route/env-config/branch/deploy-target/forbidden-ref/
permission-policy/unknown. Severities: INFO/LOW/MEDIUM/HIGH/CRITICAL/BLOCKER. Statuses: NO-DRIFT/
DRIFT-DETECTED/BLOCKED/NEEDS-SOURCE/NOT-VERIFIED/ACCEPTABLE-CARRY-FORWARD/HARD-STOP.

## Future per-project use
A later project-specific phase may wire the detector into a project's `.projectops` (e.g. PolyGo's
staging-parity drift) — still local-only, still owner-gated, still no live inspection or repair.

## Recommendation is not approval
A drift report informs the owner/advisor; classification of findings (acceptable vs blocking) and closure
remain with Murad/ChatGPT.