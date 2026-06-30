# ProjectOS CI Governance

A set of **local-only** schemas/templates/scripts/validators that define how a future
ProjectOS-controlled project can use **CI gates** for validation, secret scans, forbidden-action checks,
report/evidence checks, deploy-guard/proof-factory/drift-detector checks, review-agent evidence and
owner-gated controls. **This phase ships templates only — no live CI, no GitHub Actions.**

## What it does
- Defines a **CI governance policy** (`ci-governance-policy.schema.json`) and validates it
  (`check-ci-governance-policy.cjs`) — production auto-deploy, live DB mutation and real send/payment are
  all disabled; secrets in templates prohibited; approval never inferred.
- Provides an **inert GitHub Actions workflow template** under `projectos/templates` (NOT under
  `.github/workflows`) with placeholder check jobs (validate, report-check, secret-scan,
  forbidden-action-check, deploy-guard-check, proof-factory-check, drift-detector-check) and clear
  template-only / not-installed / no-deploy comments.
- Validates the workflow template (`check-ci-workflow-template.cjs`): refuses `.github/workflows` paths,
  scans for dangerous commands (vercel/supabase/netlify deploy, gh workflow, git push, stripe/resend/twilio)
  and secret references, and requires the template-only comment markers.
- Generates a **CI governance report** (`create-ci-governance-report.cjs`) and validates CI results
  (`check-ci-result.cjs`) and install targets (`check-ci-target.cjs` — refuses live install and
  `.github/workflows` output).
- Provides **branch protection recommendations** (a recommendation template; it does not configure GitHub).

## What it does NOT do
- It does **not** install CI, create `.github/workflows`, run GitHub Actions, call the GitHub CLI/API,
  deploy, mutate/seed a database, send messages or touch payments.
- It does **not** approve. CI **can block / warn / report**; it **cannot** approve closure, production
  deploy, DB mutation, real sends or payments. Those remain owner-gated (Murad/ChatGPT).
- It does **not** write outside `C:\dev\ProjectOS` (output paths guarded).

## Why .github/workflows is forbidden in this phase
Placing a workflow under `.github/workflows` would make it live CI. This phase is template-only.
Validators **fail** if any `.github/workflows` path exists under `C:\dev\ProjectOS`.

## Statuses
- **CI result:** PASS / WARN / FAIL / BLOCKED / SKIPPED / NEEDS-SOURCE / NOT-VERIFIED.
- **CI governance:** DRAFT / READY-FOR-REVIEW / BLOCKED / ACTIVE-TEMPLATE / INSTALLED-IN-PROJECT / REJECTED.
  `ACTIVE-TEMPLATE` = reusable template (not live). `INSTALLED-IN-PROJECT` requires a later owner-approved
  project-install phase.

## Why production deploy / live DB / send / payment are disabled by default
CI must never take a real-world gated action. The policy forces these off; enabling any of them requires a
separate, owner-approved phase.

## Future per-project use
A later owner-approved phase (e.g. a project CI-install) may copy the inert template into a project and wire
real checks — still with production deploy and live DB/send/payment owner-gated, and CI as a blocker/reporter
only, never an approver.