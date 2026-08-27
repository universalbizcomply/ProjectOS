/**
 * FIXTURE DATA FOR THE DESIGN-FIDELITY PROOF — TEST-ONLY, never bundled by `npm run build`.
 *
 * The redesign has to be compared against the approved prototype in every state it draws: waiting
 * for you, blocked, running, a plan mid-flight, connections, an empty machine. A real runtime shows
 * one of those at a time and only when it happens to be true, so this file supplies each of them
 * deliberately.
 *
 * It is typed as the real `GovernedProjection`, so it cannot describe a shape the product does not
 * actually receive, and it lives under `test-desktop/` beside the existing Mission Control fixture.
 * Nothing here is reachable from the application.
 */
import type {
  GovernedPhaseView,
  GovernedProjection,
  GovernedProjectsInventory,
} from '../../src/governed/types';

const NOW = Date.parse('2026-08-26T18:40:00Z');
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

function phase(
  phaseId: string,
  description: string,
  status: GovernedPhaseView['status'],
  over: Partial<GovernedPhaseView> = {},
): GovernedPhaseView {
  return {
    phaseId,
    description,
    status,
    dependsOn: [],
    unmetDependencies: [],
    startable: status === 'not-started' || status === 'draft',
    requiredOwnerGates: [],
    requiredBrowserProof: false,
    history: [],
    closedByRecord: status === 'closed',
    ...over,
  };
}

const PHASES: readonly GovernedPhaseView[] = [
  phase('P1', 'Read how bookings work today', 'closed', {
    history: [
      { from: 'draft', to: 'implementing', by: 'Claude', at: ago(2600) },
      { from: 'awaiting_closure', to: 'closed', by: 'Murad', at: ago(2400), note: 'nothing changed — just looking' },
    ],
  }),
  phase('P2', 'Write the reminder email', 'closed', {
    history: [
      { from: 'implementing', to: 'evidence', by: 'Claude', at: ago(900) },
      { from: 'awaiting_closure', to: 'closed', by: 'Murad', at: ago(840) },
    ],
  }),
  phase('P3', 'Try it on a test booking', 'closed', {
    history: [{ from: 'awaiting_closure', to: 'closed', by: 'Murad', at: ago(180) }],
  }),
  phase('P4', 'Check the wording against your notes', 'implementing', {
    history: [
      { from: 'prompted', to: 'implementing', by: 'Claude', at: ago(35) },
    ],
  }),
  phase('P5', 'Send it to real customers', 'not-started', {
    requiredOwnerGates: ['send'],
    dependsOn: ['P4'],
    unmetDependencies: ['P4'],
  }),
  phase('P6', 'Write up what changed', 'not-started', { dependsOn: ['P4'], unmetDependencies: ['P4'] }),
  phase('P7', 'Put it live', 'not-started', { requiredOwnerGates: ['production'], dependsOn: ['P6'], unmetDependencies: ['P6'] }),
];

const BASE: GovernedProjection = {
  connected: true,
  projectId: 'polygo',
  projectName: 'PolyGo',
  repository: {
    repo: 'polygo-s-projects/polygo',
    localPath: 'C:\\dev\\PolyGo',
    branch: 'main',
    head: 'a'.repeat(40),
    protectedBranches: ['main'],
    onProtectedBranch: true,
  },
  plan: {
    planId: 'POLYGO-BOOKING-REMINDER',
    planVersion: '1.2',
    declaredStatus: 'APPROVED',
    ready: true,
    unmetReasons: [],
    planPath: 'C:\\dev\\PolyGo\\.projectops\\plan.json',
    supersedes: null,
  },
  programme: {
    acceptedPhaseCount: 3,
    totalPhaseCount: 7,
    completionPercentage: 43,
    completedPhases: ['P1', 'P2', 'P3'],
    pendingPhases: ['P4', 'P5', 'P6', 'P7'],
  },
  phases: PHASES,
  activePhase: PHASES[3] ?? null,
  nextStartablePhase: PHASES[3] ?? null,
  authority: {
    owner: 'Murad',
    gatekeeper: 'ChatGPT',
    implementer: 'Claude',
    closureAuthority: 'Murad',
    closureDelegation: null,
    ownerOnlyActions: ['production', 'send', 'payment', 'credential', 'installation'],
  },
  gatekeeperStatus: {
    configured: true,
    budget: {
      status: 'OK',
      spentThisMonthMicroUsd: 17_400,
      remainingMicroUsd: 4_982_600,
      warnAtMicroUsd: 4_000_000,
      hardStopAtMicroUsd: 5_000_000,
    },
    spentThisPhaseMicroUsd: 4_200,
    spentThisProjectMicroUsd: 17_400,
    callCount: 4,
    lastCall: { requestId: 'r-4', model: 'gpt-5', at: ago(40), costMicroUsd: 4_200 },
  },
  pendingApprovals: [],
  planDrafts: [],
  sessions: [
    { sessionId: 's-2', phaseId: 'P4', workerId: 'claude', kind: 'implement', startedAt: ago(35), state: 'started', exitCode: null },
    { sessionId: 's-1', phaseId: 'P2', workerId: 'claude', kind: 'implement', startedAt: ago(900), state: 'exited', exitCode: 0 },
  ],
  connections: {
    available: true,
    detail: '',
    connections: [
      { provider: 'github', environment: 'development', credential: 'token', reference: 'ProjectOS/polygo/development/github/token', risk: 'session', status: 'STORED', fingerprint: 'b41f7c92', expiresAt: null },
      { provider: 'resend', environment: 'development', credential: 'api-key', reference: 'ProjectOS/polygo/development/resend/api-key', risk: 'operation', status: 'STORED', fingerprint: '9c02aa15', expiresAt: null },
      { provider: 'supabase', environment: 'development', credential: 'service-key', reference: 'ProjectOS/polygo/development/supabase/service-key', risk: 'operation', status: 'MISSING', fingerprint: null, expiresAt: null },
    ],
  },
  safety: {
    productionFreeze: true,
    forbiddenActions: ['production.deploy', 'payment.capture'],
    approvalGates: ['send', 'production', 'payment', 'credential'],
  },
  blockers: [],
  risks: [],
  nextSafeAction: 'Finishing the booking reminder email, then checking it against a test booking.',
  observedAt: new Date(NOW).toISOString(),
};

const INVENTORY: GovernedProjectsInventory = {
  projects: [
    { projectId: 'polygo', projectName: 'PolyGo', repositoryRoot: 'C:\\dev\\PolyGo', repository: 'polygo-s-projects/polygo' },
    { projectId: 'jd-testing', projectName: 'JD Testing', repositoryRoot: 'C:\\dev\\JDTesting', repository: 'murad/jd-testing' },
    { projectId: 'bizcomply', projectName: 'BizComply / OPSoft', repositoryRoot: 'C:\\dev\\BizComply', repository: 'universalbizcomply/bizcomply' },
    { projectId: 'criclocal', projectName: 'CricLocal', repositoryRoot: 'C:\\dev\\CricLocal', repository: 'murad/criclocal' },
    { projectId: 'coverdrive', projectName: 'Coverdrive', repositoryRoot: 'C:\\dev\\Coverdrive', repository: 'murad/coverdrive' },
    { projectId: 'tkn', projectName: 'TKN', repositoryRoot: 'D:\\work\\TKN', repository: 'murad/tkn' },
  ],
  registryStatus: 'ok',
  refusedCount: 0,
  selectedProjectId: 'polygo',
};

export type ProofState =
  | 'idle'
  | 'waiting'
  | 'blocked'
  | 'warning'
  | 'running'
  | 'noplan'
  | 'nokeys'
  | 'offline'
  | 'empty';

/** The projection for one named state. `offline` and `empty` are handled by the caller. */
export function projectionFor(state: ProofState): GovernedProjection {
  switch (state) {
    case 'waiting':
      return {
        ...BASE,
        pendingApprovals: [
          {
            id: 'AP-1',
            action: 'Send the reminder to 40 real customers',
            gated: true,
            prohibited: false,
            risk: 'send',
            requestedBy: 'Claude',
            requestedAt: ago(6),
          },
        ],
      };
    case 'blocked':
      return {
        ...BASE,
        blockers: [
          "This project's folder isn't there any more",
          'D:\\work\\TKN — not found',
          'drive D: — not mounted',
        ],
        nextSafeAction: 'Point ProjectOS at the folder again and it will carry on from the same place.',
      };
    case 'warning':
      return {
        ...BASE,
        risks: ['A live payment key is still connected', 'Paused for two days'],
      };
    case 'noplan':
      return {
        ...BASE,
        phases: [],
        activePhase: null,
        nextStartablePhase: null,
        programme: { acceptedPhaseCount: 0, totalPhaseCount: 0, completionPercentage: 0, completedPhases: [], pendingPhases: [] },
        plan: { ...BASE.plan, ready: false, declaredStatus: 'DRAFT', unmetReasons: ['No approved plan is recorded for this project.'] },
        nextSafeAction: 'Nothing has been started here yet. Say what you want and you will see the plan first.',
      };
    case 'nokeys':
      return { ...BASE, connections: { available: true, detail: '', connections: [] } };
    default:
      return BASE;
  }
}

export function inventoryFor(state: ProofState): GovernedProjectsInventory {
  if (state === 'empty') return { ...INVENTORY, projects: [], selectedProjectId: null };
  return INVENTORY;
}

export const PROOF_STATES: readonly ProofState[] = [
  'idle', 'waiting', 'blocked', 'warning', 'running', 'noplan', 'nokeys', 'offline', 'empty',
];
