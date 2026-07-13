/**
 * Static owner-control snapshots for the browser preview and desktop build.
 *
 * ProjectOS itself is seeded from the real `projectos/state/projectos-v3.current-state.json` values
 * (status, head phase counts, blockers) as of the accepted post-push baseline; a second synthetic
 * project exercises the decisions/blockers surface. In the Tauri desktop build these are replaced by
 * live state read via the CLI. No backend, no network — fully renderable offline.
 * `ownerSnapshot.test.ts` pins the ProjectOS seed to the canonical state file so it cannot drift stale.
 * Created in PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A; realigned to canonical state in the
 * whole-system UX / functionality / duplication audit.
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
  planStatus: 'IN EXECUTION',
  activePhase: null,
  nextRecommendedPhase: 'PROJECTOS-WHOLE-SYSTEM-UX-FUNCTIONALITY-DUPLICATION-AUDIT1A',
  acceptedPhaseCount: 3,
  totalPhaseCount: 19,
  risks: [
    'R1 (accepted carry-forward): owner approval is manual — not cryptographically bound.',
    'Automated local relay loop not yet implemented; the ChatGPT↔Claude relay is manual / partially automated.',
  ],
  blockers: [
    'Phases 14–16 (PolyGo) are blocked: no authorised trust-anchored local repository. ProjectOS V3 is not closed.',
  ],
  decisionsRequired: [],
  nextSafeAction:
    'Roadmap phases are built and proven locally; 3 of 19 are owner-accepted so far. Review the audit evidence and accept or hold each phase. This is a review step — nothing is deployed, closed, or authorised automatically.',
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
