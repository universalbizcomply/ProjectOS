/**
 * Embedded templates: pure string builders mirroring the framework templates
 * (projectos/templates/*). Embedding keeps the CLI self-contained and its output
 * deterministic and testable, without reading template files at runtime.
 */
import type { ProjectConfig } from '@projectos/core';

export interface ConfigSeed {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectType: string;
  readonly owner: string;
  readonly repo: string;
  readonly localPath: string;
}

/** Canonical forbidden actions / gates applied to every project by default. */
const DEFAULT_FORBIDDEN = [
  'production-deploy',
  'production-db-mutation',
  'real-email-sms-whatsapp',
  'payment-or-live-charge',
  'use-secrets',
  'force-push',
];

const DEFAULT_GATES = [
  'production-deploy',
  'production-db-mutation',
  'real-email-sms-whatsapp',
  'payment-or-live-charge',
  'secrets-handling',
  'phase-closure',
];

/** Build a validated-shape project config from a seed (installStatus = planned). */
export function buildProjectConfig(seed: ConfigSeed): ProjectConfig {
  return {
    projectId: seed.projectId,
    projectName: seed.projectName,
    projectType: seed.projectType,
    owner: seed.owner,
    repo: seed.repo,
    localPath: seed.localPath,
    protectedBranches: ['main'],
    productionFreeze: true,
    allowedActions: ['create-local-files', 'run-local-validation', 'produce-evidence-report'],
    forbiddenActions: DEFAULT_FORBIDDEN,
    approvalGates: DEFAULT_GATES,
    secretsPolicy: {
      allowSecretsInRepo: false,
      redactionRequired: true,
      notes: 'placeholders only',
    },
    validators: ['validate-project-config', 'validate-no-secrets', 'validate-forbidden-actions'],
    evidenceRequirements: ['evidence-pack', 'validator-results'],
    installStatus: 'planned',
  };
}

export interface PromptSeed {
  readonly project: string;
  readonly phaseId: string;
  readonly phaseType: string;
  readonly objective: string;
  readonly localPath: string;
}

/** Render a Claude phase prompt (mirrors claude-phase-prompt.template.txt). */
export function renderPhasePrompt(seed: PromptSeed): string {
  return `You are Claude acting as implementer, tester, reporter and script runner for Murad.

PROJECT: ${seed.project}
PHASE: ${seed.phaseId}
PHASE TYPE: ${seed.phaseType}

OBJECTIVE:
${seed.objective}

ROLE MODEL:
- Murad = owner, final approver
- ChatGPT = consultant, reviewer, governance layer
- Claude = implementer, tester, reporter, script runner (not owner, not approver, not closure authority)

LOCAL MASTER FOLDER: ${seed.localPath}

STRICT SCOPE:
Not allowed:
- production deploy / production DB mutation
- real email/SMS/WhatsApp / payment
- using secrets, adding remotes, pushing, force pushing
- touching product repos not named in this phase
- starting any later phase
- marking this phase closed

REQUIRED EVIDENCE:
- evidence pack at knowledge/reports/<YYYY-MM-DD>_${seed.project}_${seed.phaseId}_AWAITING-REVIEW.md

EXPECTED STATUS:
${seed.phaseId} — IMPLEMENTED LOCALLY / AWAITING OWNER-ADVISOR REVIEW
Do not mark closed. Do not start the next phase.
`;
}

/** Render the .projectops README (mirrors project-install-readme.template.md). */
export function renderInstallReadme(projectName: string): string {
  return `# .projectops — ${projectName}

> Per-project ProjectOS installation. Config + evidence only. The universal ProjectOS
> framework remains the source of truth for schemas/templates/validators.

## Contents
- \`project-config.json\` — this project's config
- \`phases/\`  — phase manifests + persisted phase state
- \`reports/\` — evidence + closure reports for this project

## Rules
- Production / DB / real-send / payment / closure remain owner-gated.
- No secrets in this folder. Use placeholders only.
- ProjectOS never edits product code; it governs the delivery process.
`;
}

/** Render an evidence-pack skeleton (mirrors evidence-pack.template.md, trimmed). */
export function renderEvidenceSkeleton(project: string, phaseId: string, date: string): string {
  return `# ${phaseId} — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated.

1. **Project:** ${project}
2. **Phase:** ${phaseId}
3. **Date:** ${date}
4. **Branch / HEAD:** <fill>
5. **Files changed:** <fill>
6. **Summary:** <fill>
7. **Validators:** <fill>
8. **Secrets used?** No
9. **Gated actions performed?** None
10. **Risks / carry-forward:** <fill>
11. **Decision needed:** owner/advisor review + closure

## Final status
**${phaseId} — AWAITING-REVIEW.**
`;
}
