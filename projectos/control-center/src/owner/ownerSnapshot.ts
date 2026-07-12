/**
 * Static owner-control snapshots for the browser preview and desktop build.
 *
 * ProjectOS itself is seeded from the real `projectos/state/projectos-v3.current-state.json` values;
 * a second synthetic project exercises the decisions/blockers surface. In the Tauri desktop build these
 * are replaced by live state read via the CLI. No backend, no network — fully renderable offline.
 * Created in PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A.
 */
import type { OwnerControlModel } from './ownerModel';

const OWNER_ONLY_ACTIONS: readonly string[] = [
  'Approve plan',
  'Approve phase closure',
  'Approve commit / push',
  'Authorise production deploy',
  'Authorise database mutation',
  'Authorise external send',
  'Authorise payment',
  'Authorise provider access',
];

export const PROJECTOS_V3: OwnerControlModel = {
  projectId: 'projectos',
  projectName: 'ProjectOS (self)',
  programme: 'ProjectOS V3',
  planStatus: 'PLAN READY',
  activePhase: null,
  nextRecommendedPhase: 'PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A',
  acceptedPhaseCount: 3,
  totalPhaseCount: 19,
  risks: [
    'R1 (accepted carry-forward): owner approval is manual (MANUAL_GOVERNANCE_APPROVAL, tamperProof: false) — not cryptographically bound.',
    'Automated local relay loop not yet implemented; the ChatGPT↔Claude relay is manual / partially automated.',
  ],
  blockers: [],
  decisionsRequired: [],
  nextSafeAction: 'Continue Phase 3 — implement the owner control plane, then proceed through the remaining V3 phases locally.',
  restrictedActions: OWNER_ONLY_ACTIONS,
  safety: { productionFrozen: true, providerContacted: false, secretCapabilityUsed: false, apiUsed: false },
};

/** Synthetic project mid-import: awaiting owner approval, with a real decision + a surfaced conflict. */
export const DEMO_ACME: OwnerControlModel = {
  projectId: 'acme-app',
  projectName: 'Acme App (synthetic)',
  programme: 'Acme Delivery',
  planStatus: 'AWAITING OWNER APPROVAL',
  activePhase: 'ACME-P1A',
  nextRecommendedPhase: 'ACME-P2A',
  acceptedPhaseCount: 0,
  totalPhaseCount: 4,
  risks: ['Imported plan authority is a canonical-config binding — owner confirmation required before PLAN READY.'],
  blockers: ['One conflicting definition-of-complete between two sources is unresolved.'],
  decisionsRequired: [
    {
      id: 'acme-doc-conflict',
      title: 'Resolve conflicting definition of complete',
      detail: 'Two discovered plans disagree on the definition of complete. Choose the authoritative source or return for correction.',
      severity: 'warn',
    },
    {
      id: 'acme-approve-plan',
      title: 'Approve imported plan',
      detail: 'The imported draft is complete enough for review. Approving records owner approval; PLAN READY still runs the evidence gate.',
      severity: 'info',
    },
  ],
  nextSafeAction: 'Review the conflict and the imported draft, then approve, return for correction, or reject.',
  restrictedActions: OWNER_ONLY_ACTIONS,
  safety: { productionFrozen: true, providerContacted: false, secretCapabilityUsed: false, apiUsed: false },
};

export const OWNER_MODELS: readonly OwnerControlModel[] = [PROJECTOS_V3, DEMO_ACME];
