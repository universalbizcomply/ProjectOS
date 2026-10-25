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

/**
 * LAST RECORDED position — NOT live state, and the surface labels it that way.
 *
 * PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A made the owner surface read the canonical runtime, so
 * this literal is now only the fallback shown when no runtime has reported (a plain browser build,
 * or before the sidecar is ready). It exists because rendering nothing is worse than rendering the
 * last recorded position clearly marked as recorded.
 *
 * It drifted once already — it sat at 3 accepted phases while the canonical record said 16 — which
 * is exactly why the surface must not depend on it when a runtime is available. `ownerSnapshot.test`
 * pins every field here to `projectos/state/projectos-v3.current-state.json` so the drift cannot
 * silently return.
 */
export const PROJECTOS_V3: OwnerControlModel = {
  projectId: 'projectos',
  projectName: 'ProjectOS (self)',
  programme: 'ProjectOS V3',
  planStatus: 'COMPLETE',
  activePhase: null,
  nextRecommendedPhase: '',
  acceptedPhaseCount: 19,
  totalPhaseCount: 19,
  risks: [
    'R1 (accepted carry-forward): owner approval is manual — not cryptographically bound.',
    'Automated local relay loop not yet implemented; the ChatGPT↔Claude relay is manual / partially automated.',
  ],
  blockers: [
    'None for the numbered ProjectOS V3 programme, which is CLOSED at 19 of 19.',
    'Protected authority is unchanged and is NOT granted by that closure: installation, production, provider and credential authority all remain NotAuthorised.',
  ],
  // Left empty deliberately. The final closure decision is LIVE governed state, and this snapshot is
  // the offline fallback for when no runtime has reported — putting a pending decision here would
  // make the fallback assert something it cannot know is still true.
  decisionsRequired: [],
  nextSafeAction:
    'This is the last recorded position, not live state. Start the ProjectOS runtime to see live governed state. All 19 numbered ProjectOS V3 phases are owner-accepted and the programme is CLOSED. Any further work is a NEW ProjectOS-managed project under its own owner-approved plan. Nothing is deployed or authorised automatically.',
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
