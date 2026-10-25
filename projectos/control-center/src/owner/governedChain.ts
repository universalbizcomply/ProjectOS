/**
 * Governed-chain snapshot for the Control Centre — read-only view of the Phase 4–11 backend.
 *
 * The backend approval queue (`projectos/approval`) and provider guards (`projectos/guards`) are
 * zero-dependency CommonJS Node modules; the browser/desktop UI cannot import them directly. This module
 * mirrors their SHAPES in TypeScript with a synthetic, offline snapshot so the Control Centre can display
 * real governed-chain outputs. In the Tauri desktop build these are replaced by live values read via the
 * CLI/daemon. Pure and deterministic — no backend, no network, no execution.
 * Created in PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
 */
import type { OwnerSafetyState, OwnerBadge } from './ownerModel';

export type GuardDecision = 'ALLOW' | 'OWNER_GATED' | 'REFUSED';
export type ApprovalStatus = 'pending' | 'approved' | 'returned' | 'rejected';

export interface ApprovalItemView {
  readonly id: string;
  readonly kind: string;
  readonly summary: string;
  readonly status: ApprovalStatus;
}

export interface ProviderDecisionView {
  readonly provider: string;
  readonly action: string;
  readonly decision: GuardDecision;
  readonly reason: string;
}

export interface GovernedChainSnapshot {
  readonly projectId: string;
  readonly projectName: string;
  readonly approvalItems: readonly ApprovalItemView[];
  readonly providerDecisions: readonly ProviderDecisionView[];
  readonly safety: OwnerSafetyState;
}

/** Colour tone for a guard decision (ALLOW→ok, OWNER_GATED→warn, REFUSED→crit). */
export function decisionTone(decision: GuardDecision): OwnerBadge['tone'] {
  if (decision === 'ALLOW') return 'ok';
  if (decision === 'OWNER_GATED') return 'warn';
  return 'crit';
}

/** Colour tone for an approval status. */
export function statusTone(status: ApprovalStatus): OwnerBadge['tone'] {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'crit';
  if (status === 'returned') return 'warn';
  return 'mut';
}

const PROJECTOS_CHAIN: GovernedChainSnapshot = {
  projectId: 'projectos',
  projectName: 'ProjectOS (self)',
  approvalItems: [],
  providerDecisions: [
    { provider: 'vercel', action: 'plan-deploy', decision: 'ALLOW', reason: 'plan-only-no-contact' },
    { provider: 'vercel', action: 'deploy-staging', decision: 'REFUSED', reason: 'production-frozen' },
    { provider: 'email', action: 'send', decision: 'REFUSED', reason: 'prohibited-action' },
    { provider: 'payments', action: 'charge', decision: 'REFUSED', reason: 'prohibited-action' },
  ],
  safety: { productionFrozen: true, providerContacted: false, secretCapabilityUsed: false, apiUsed: false },
};

const ACME_CHAIN: GovernedChainSnapshot = {
  projectId: 'acme-app',
  projectName: 'Acme App (synthetic)',
  approvalItems: [
    { id: 'apr_1', kind: 'launch-approval', summary: 'Approve staging launch for phase ACME-P1A', status: 'pending' },
    { id: 'apr_2', kind: 'side-effect', summary: "Provider action 'deploy-staging' on vercel requires owner approval", status: 'pending' },
    { id: 'apr_3', kind: 'plan-decision', summary: 'Resolve conflicting definition of complete', status: 'returned' },
  ],
  providerDecisions: [
    { provider: 'github', action: 'create-branch', decision: 'OWNER_GATED', reason: 'requires-owner-approval' },
    { provider: 'supabase', action: 'apply-migration', decision: 'OWNER_GATED', reason: 'requires-owner-approval' },
    { provider: 'supabase', action: 'mutate-production-db', decision: 'REFUSED', reason: 'prohibited-action' },
    { provider: 'whatsapp', action: 'send', decision: 'REFUSED', reason: 'prohibited-action' },
  ],
  safety: { productionFrozen: true, providerContacted: false, secretCapabilityUsed: false, apiUsed: false },
};

export const GOVERNED_CHAINS: readonly GovernedChainSnapshot[] = [PROJECTOS_CHAIN, ACME_CHAIN];

export function chainFor(projectId: string): GovernedChainSnapshot {
  return GOVERNED_CHAINS.find((c) => c.projectId === projectId) ?? PROJECTOS_CHAIN;
}
