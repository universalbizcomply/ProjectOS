/**
 * Deterministic synthetic fixture data for the isolated Mission Control desktop fixture.
 *
 * TEST-ONLY. Never imported by production `src/**`. Every name/id is obviously synthetic — no
 * real customer, booking, payment, employee, credential or token appears. These snapshots feed
 * the REAL Mission Control components through the FixtureTransport; nothing here connects to a
 * daemon, Supabase, network or filesystem.
 */
import type { DaemonSnapshot, LiveEvent } from '../../src/daemon/types';

export type ScenarioId = 'connected' | 'owner-decision' | 'disconnected' | 'blocked';

export interface BlockedAction {
  readonly action: string;
  readonly reason: string;
  readonly requiresOwnerApproval: true;
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly label: string;
  /** When true the transport emits `closed` (no snapshot) → a clean Disconnected state. */
  readonly disconnected: boolean;
  readonly snapshot: DaemonSnapshot;
  readonly events: readonly LiveEvent[];
  readonly blocked?: BlockedAction;
}

const PROJECT = 'acme-demo-shop';
const PHASE = 'FIXTURE-DEMO-PHASE1A';
const WORKER = 'fixture-claude';
const BRANCH = 'fixture/demo';
const T = (s: string) => `2026-01-01T10:00:${s}.000Z`;

const baseHealth: DaemonSnapshot['health'] = {
  running: true,
  version: 'fixture-0.0.0',
  uptimeMs: 42_000,
  projects: 1,
  workers: 1,
  watchers: 1,
  pendingEvents: 0,
  pendingPrompts: 0,
  pendingReports: 0,
  pendingApprovals: 0,
  recovered: false,
};

/** SCENARIO A — connected / healthy: worker validating, validators green, no decision. */
const connected: Scenario = {
  id: 'connected',
  label: 'Connected / healthy',
  disconnected: false,
  snapshot: {
    health: baseHealth,
    workers: [
      {
        worker: WORKER,
        provider: 'synthetic',
        project: PROJECT,
        phase: PHASE,
        status: 'validating',
        online: true,
        currentAction: 'running validators',
        updatedAt: T('05'),
      },
    ],
    phases: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'validating',
        status: 'validating',
        validators: 'pass',
        decisionRequired: false,
        worker: WORKER,
        branch: BRANCH,
        blockers: [],
      },
    ],
    projects: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'validating',
        worker: WORKER,
        validators: 'pass',
        decisionRequired: false,
        branch: BRANCH,
      },
    ],
    notifications: [
      { kind: 'dashboard-synced', project: PROJECT, phase: PHASE, at: T('04'), message: 'Synthetic snapshot synced (no production connection).' },
    ],
  },
  events: [
    { id: 'ev-a1', at: T('01'), type: 'PHASE_IMPLEMENTING', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
    { id: 'ev-a2', at: T('03'), type: 'VALIDATION_PASSED', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
  ],
};

/** SCENARIO B — owner decision required: awaiting review, decision flagged, owner-only. */
const ownerDecision: Scenario = {
  id: 'owner-decision',
  label: 'Owner decision required',
  disconnected: false,
  snapshot: {
    health: { ...baseHealth, pendingApprovals: 1, pendingReports: 1 },
    workers: [
      {
        worker: WORKER,
        provider: 'synthetic',
        project: PROJECT,
        phase: PHASE,
        status: 'waiting-approval',
        online: true,
        currentAction: 'awaiting owner approval',
        updatedAt: T('12'),
      },
    ],
    phases: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'awaiting_review',
        status: 'awaiting_review',
        validators: 'pass',
        decisionRequired: true,
        worker: WORKER,
        branch: BRANCH,
        blockers: [],
      },
    ],
    projects: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'awaiting_review',
        worker: WORKER,
        validators: 'pass',
        decisionRequired: true,
        branch: BRANCH,
      },
    ],
    notifications: [
      { kind: 'approval-required', project: PROJECT, phase: PHASE, at: T('11'), message: 'Owner approval required — only Murad can approve. Claude cannot approve or close.' },
      { kind: 'review-required', project: PROJECT, phase: PHASE, at: T('10'), message: 'Report ready for owner + ChatGPT review.' },
    ],
  },
  events: [
    { id: 'ev-b1', at: T('08'), type: 'VALIDATION_PASSED', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
    { id: 'ev-b2', at: T('10'), type: 'REPORT_READY', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
    { id: 'ev-b3', at: T('11'), type: 'APPROVAL_REQUESTED', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
  ],
};

/** SCENARIO C — disconnected / safe: transport reports closed; no mutation; safety retained. */
const disconnected: Scenario = {
  id: 'disconnected',
  label: 'Disconnected / safe',
  disconnected: true,
  snapshot: connected.snapshot,
  events: [],
};

/** SCENARIO D — blocked action: a gated production action is displayed as blocked with reason. */
const blocked: Scenario = {
  id: 'blocked',
  label: 'Blocked action',
  disconnected: false,
  snapshot: {
    health: { ...baseHealth, pendingApprovals: 1 },
    workers: [
      {
        worker: WORKER,
        provider: 'synthetic',
        project: PROJECT,
        phase: PHASE,
        status: 'blocked',
        online: true,
        currentAction: 'blocked on gated action',
        updatedAt: T('20'),
      },
    ],
    phases: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'blocked',
        status: 'blocked',
        validators: 'unknown',
        decisionRequired: true,
        worker: WORKER,
        branch: BRANCH,
        blockers: ['production-deploy requires explicit owner approval'],
      },
    ],
    projects: [
      {
        project: PROJECT,
        phase: PHASE,
        stage: 'blocked',
        worker: WORKER,
        validators: 'unknown',
        decisionRequired: true,
        branch: BRANCH,
      },
    ],
    notifications: [
      { kind: 'approval-required', project: PROJECT, phase: PHASE, at: T('20'), message: 'Blocked: production deploy needs owner approval. Claude cannot approve.' },
    ],
  },
  events: [
    { id: 'ev-d1', at: T('19'), type: 'ACTION_BLOCKED', project: PROJECT, phase: PHASE, actor: WORKER, worker: WORKER },
  ],
  blocked: {
    action: 'Production deploy',
    reason: 'Deploying to production is a gated action; it stays blocked until the owner approves.',
    requiresOwnerApproval: true,
  },
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  connected,
  'owner-decision': ownerDecision,
  disconnected,
  blocked,
};

export const SCENARIO_ORDER: readonly ScenarioId[] = ['connected', 'owner-decision', 'disconnected', 'blocked'];

/** Static safety posture shown by the fixture chrome — identical across scenarios. */
export const SAFETY_MATRIX: ReadonlyArray<readonly [string, string]> = [
  ['Production touched', 'NO'],
  ['Deploy', 'NO'],
  ['Database mutation', 'NO'],
  ['External sends', 'NO'],
  ['Payments', 'NO'],
  ['Forbidden actions', 'BLOCKED'],
  ['Secrets', 'ABSENT'],
];
