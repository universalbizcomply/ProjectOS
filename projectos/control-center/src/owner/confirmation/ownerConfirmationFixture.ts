/**
 * Synthetic protected-operation confirmation fixtures.
 *
 * PROJECTOS-V3-OWNER-PRESENCE-CONFIRMATION-UX1A. Deterministic, host-authoritative-SHAPED preview data
 * used by the OwnerControlPlane preview and by tests. NOTHING here creates authority, contacts Windows,
 * or executes an action — every fixture is `syntheticPreview: true`. No nonce/SID/digest/credential.
 */
import type { ProtectedOperationSummary } from './ownerConfirmationModel';

/** A fixed synthetic "now" so the preview and tests are deterministic (no real clock). */
export const SYNTHETIC_NOW_MS = 1_000_000;

/** Default synthetic summary: a production, irreversible, high-impact action with required evidence. */
export const SYNTHETIC_CONFIRMATION: ProtectedOperationSummary = {
  requestId: 'synthetic-req-1',
  projectName: 'ProjectOS V3',
  repositoryLabel: 'universalbizcomply/ProjectOS',
  environment: 'Production',
  phaseId: 'phase-preview',
  actionTitle: 'Apply a database migration',
  actionDescription:
    'Run the pending schema migration against the live production database for ProjectOS V3.',
  affectedResource: 'Production database (projectos-v3)',
  expectedResult: 'The schema is updated to the latest migration.',
  reversibility: 'Irreversible',
  riskLevel: 'Critical',
  impacts: ['CustomerData', 'MachineConfiguration'],
  reason: 'The approved plan requires the migration before the next phase can start.',
  requesterLabel: 'ProjectOS delivery worker',
  expectedDurationLabel: 'about 30 seconds',
  expiresAt: SYNTHETIC_NOW_MS + 120_000,
  evidence: 'RequiredAvailable',
  advancedDetails: 'Operation is bound to the current runtime, IPC session and trusted clock (host-side).',
  hostState: 'Requested',
  syntheticPreview: true,
};

/** Build a synthetic summary with overrides for component/unit tests. */
export function makeSummary(
  overrides: Partial<ProtectedOperationSummary> = {},
): ProtectedOperationSummary {
  return { ...SYNTHETIC_CONFIRMATION, ...overrides };
}
