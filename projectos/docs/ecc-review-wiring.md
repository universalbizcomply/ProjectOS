# ECC Review Wiring (controlled)

ECC (and any other named review provider) is a **pluggable review/execution layer** under ProjectOS.
ProjectOS remains the authority for process, gates, evidence and closure.

## Core rules
- ECC reviews run **only when a phase manifest requires them** — never autonomously, never on a schedule.
- **External tools are disabled by default.** Enabling them needs an owner-approved later phase.
- **MCP / live tools are forbidden** unless explicitly owner-approved in a later phase.
- ECC **output goes into the evidence pack** as evidence only.
- ECC **cannot close phases.** Only Murad/ChatGPT close phases.
- ECC **cannot approve** production deploy, DB mutation, real sends or payments. Those stay owner-gated.
- **Recommendation is not approval.**

## How it wires together
1. **project-config** declares `reviewAgents[]` (id, provider, category, displayName, allowedModes,
   externalToolsAllowed=false, requiresOwnerApprovalForExternalTools, evidencePackSection, enabledByDefault),
   plus `reviewAgentGroups`, `defaultRequiredReviews`, `externalToolsPolicy`, `mcpPolicy`,
   `autonomousBehaviourPolicy`, `reviewEvidenceTargets`.
2. **phase-manifest** declares `requiredReviews[]` / `optionalReviews[]`. Each review has
   `reviewId, category, required, agentRef, evidenceTarget, blocking, externalToolsAllowed=false,
   mcpAllowed=false, ownerApprovalRequiredForExternalTools`. Plus `reviewDispatchPolicy`
   (`manual-owner-or-advisor`), `reviewEvidenceRequired`, and phase-level
   `externalToolsAllowed=false`, `mcpAllowed=false`, `autonomousReviewAllowed=false`.
3. Each `agentRef` maps to a `reviewAgents[].id`.
4. **evidence-pack** captures each review's output (category, status, output, limitations, scope,
   externalToolsUsed, mcpUsed, ownerApprovalRequired, recommendation) under the matching section.

## Review categories
code-review, security-review, database-review, build-lint-typecheck-review, test-review,
quality-gate-review, planner-review, silent-failure-review.

Example ECC agent names (configurable only — not assumed installed/callable):
code-reviewer, security-reviewer, database-reviewer, build-error-resolver, tdd-guide, planner,
quality-gate, silent-failure-hunter.

## Why this reduces self-review risk
Earlier phases relied on Claude self-review. Required reviews route work to independent named
reviewers whose findings land in the evidence pack, so the owner reviews diverse evidence rather than
a single self-assessment. ProjectOS still decides; ECC only supplies evidence.

## Output format
See `projectos/templates/ecc-review-output.template.md` and routing in
`projectos/templates/ecc-review-routing.template.json`. Inert demo:
`projectos/examples/demo-ecc-review-routing.projectos.json`.

## Validators
- `validate-review-agents` — reviewAgents + requiredReviews shape; agentRef mapping; external/MCP/autonomous default off.
- `validate-ecc-routing` — routing defaults off; categories/agentRef/evidenceTarget present; placeholders only.