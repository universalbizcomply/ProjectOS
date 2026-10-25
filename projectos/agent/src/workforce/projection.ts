/**
 * The leader's operational ledger: a PROJECTION of the workforce events, never a source of truth.
 *
 * The leader is rebuilt from this bounded projection, not from conversation memory. Where it and a
 * ProjectOS governance record disagree (the phase in flight, the candidate), the governance record
 * wins and the disagreement is reported (`reconcileLedger`). The bound is the event store's: a log past
 * `projection.maxEvents` is refused and escalated, never truncated.
 */
import { claimFromEvents } from './leader.js';
import type { WorkforceEvent } from './eventStore.js';

export interface LedgerTask {
  readonly taskId: string;
  readonly roleId: string;
  readonly generation: number;
  readonly status: 'dispatched' | 'completed' | 'failed' | 'escalated' | 'void';
}

export interface LeaderLedger {
  readonly project: string;
  readonly leader: { readonly leaderId: string; readonly generation: number; readonly modelRef: string } | null;
  readonly objective: string | null;
  readonly currentPhase: string | null;
  readonly candidate: string | null;
  readonly activeTasks: readonly LedgerTask[];
  readonly completedTasks: readonly LedgerTask[];
  readonly activeSpecialists: readonly { readonly roleId: string; readonly assignment: string; readonly reasons: readonly string[] }[];
  readonly completedAssignments: readonly { readonly roleId: string; readonly taskId: string }[];
  readonly dependencies: readonly { readonly taskId: string; readonly dependsOn: readonly string[] }[];
  readonly decisions: readonly { readonly kind: string; readonly outcome: 'recorded' | 'refused'; readonly detail: string }[];
  readonly risks: readonly { readonly taskId: string; readonly description: string; readonly severity: string }[];
  readonly blockers: readonly { readonly taskId: string; readonly blocker: string }[];
  readonly evidence: readonly string[];
  readonly validatorsAndTests: readonly string[];
  readonly reviews: readonly string[];
  readonly carryForward: readonly string[];
  readonly ownerDecisionsRequired: readonly string[];
  readonly openContradictions: readonly { readonly contradictionId: string; readonly subject: string; readonly blocksTasks: readonly string[] }[];
  readonly nextAction: string;
  readonly eventCount: number;
  readonly headDigest: string | null;
}

type P = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Fold the verified events into the ledger. Pure and deterministic. */
export function projectLedger(projectId: string, events: readonly WorkforceEvent[]): LeaderLedger {
  const claim = claimFromEvents(projectId, events);
  const generation = claim?.generation ?? 0;
  let objective: string | null = null;
  let currentPhase: string | null = null;
  let candidate: string | null = null;
  const tasks = new Map<string, LedgerTask>();
  let team: { roleId: string; assignment: string; reasons: string[] }[] = [];
  const completedAssignments: { roleId: string; taskId: string }[] = [];
  const dependencies: { taskId: string; dependsOn: string[] }[] = [];
  const decisions: { kind: string; outcome: 'recorded' | 'refused'; detail: string }[] = [];
  const risks: { taskId: string; description: string; severity: string }[] = [];
  const blockers: { taskId: string; blocker: string }[] = [];
  const evidence: string[] = [];
  const validatorsAndTests: string[] = [];
  const reviews: string[] = [];
  const carryForward: string[] = [];
  const ownerDecisions: string[] = [];
  const contradictions = new Map<string, { contradictionId: string; subject: string; blocksTasks: string[] }>();

  for (const e of events) {
    const p = e.payload as P;
    switch (e.type) {
      case 'objective-set':
        objective = s(p['objective']) || null;
        currentPhase = s(p['phaseId']) || null;
        candidate = s(p['candidate']) || null;
        break;
      case 'team-selected':
        if (e.generation === generation) {
          team = arr(p['members']).map((m) => {
            const mm = m as P;
            return { roleId: s(mm['roleId']), assignment: s(mm['assignment']), reasons: arr(mm['reasons']).map(s) };
          });
        }
        break;
      case 'task-dispatched':
        tasks.set(s(p['taskId']), { taskId: s(p['taskId']), roleId: s(p['roleId']), generation: e.generation, status: 'dispatched' });
        break;
      case 'result-recorded': {
        const t = tasks.get(s(p['taskId']));
        if (t !== undefined) tasks.set(t.taskId, { ...t, status: 'completed' });
        for (const r of arr(p['risks'])) risks.push({ taskId: s(p['taskId']), description: s((r as P)['description']), severity: s((r as P)['severity']) });
        for (const b of arr(p['blockers'])) blockers.push({ taskId: s(p['taskId']), blocker: s(b) });
        for (const ref of arr(p['evidenceRefs'])) evidence.push(s(ref));
        const dr = p['decisionRequired'] as P | null | undefined;
        if (dr !== null && dr !== undefined && s(dr['owner']) === 'owner') ownerDecisions.push(s(dr['question']));
        break;
      }
      case 'task-failed':
      case 'task-escalated': {
        const t = tasks.get(s(p['taskId']));
        if (t !== undefined) tasks.set(t.taskId, { ...t, status: e.type === 'task-failed' ? 'failed' : 'escalated' });
        if (e.type === 'task-escalated') ownerDecisions.push(`task ${s(p['taskId'])}: ${s(p['reason'])}`);
        break;
      }
      case 'assignment-completed':
        completedAssignments.push({ roleId: s(p['roleId']), taskId: s(p['taskId']) });
        break;
      case 'dependency-declared':
        dependencies.push({ taskId: s(p['taskId']), dependsOn: arr(p['dependsOn']).map(s) });
        break;
      case 'leader-decision-recorded':
        decisions.push({ kind: s(p['kind']), outcome: 'recorded', detail: s(p['detail']) });
        break;
      case 'leader-decision-refused':
        decisions.push({ kind: s(p['kind']), outcome: 'refused', detail: `${s(p['gate'])}: ${s(p['reason'])}` });
        break;
      case 'evidence-recorded': {
        const kind = s(p['kind']);
        const ref = s(p['ref']);
        if (kind === 'validator' || kind === 'test') validatorsAndTests.push(ref);
        else if (kind === 'review') reviews.push(ref);
        else if (kind === 'carry-forward') carryForward.push(ref);
        else evidence.push(ref);
        break;
      }
      case 'owner-decision-required':
      case 'contradiction-escalated':
        // An escalated contradiction stays OPEN until a recorded decision closes it.
        ownerDecisions.push(s(p['question']) || s(p['reason']));
        break;
      case 'governance-disagreement':
        for (const d of arr(p['disagreements'])) evidence.push(`governance disagreement: ${s(d)}`);
        break;
      case 'contradiction-recorded':
        contradictions.set(s(p['contradictionId']), {
          contradictionId: s(p['contradictionId']),
          subject: s(p['subject']),
          blocksTasks: arr(p['blocksTasks']).map(s),
        });
        break;
      case 'contradiction-resolved':
        contradictions.delete(s(p['contradictionId']));
        decisions.push({ kind: 'contradiction-resolution', outcome: 'recorded', detail: s(p['rationale']) });
        break;
      default:
        break;
    }
  }

  // Older generations' open work is VOID: it was issued by a leader that no longer exists.
  const all = [...tasks.values()].map((t) => (t.status === 'dispatched' && t.generation !== generation ? { ...t, status: 'void' as const } : t));
  const done = new Set(completedAssignments.map((a) => a.roleId));
  const activeTasks = all.filter((t) => t.status === 'dispatched');
  const activeSpecialists = team.filter((m) => !done.has(m.roleId));
  const openContradictions = [...contradictions.values()];
  const nextAction =
    ownerDecisions.length > 0
      ? 'await the owner decision(s) listed'
      : openContradictions.length > 0
        ? `resolve contradiction ${openContradictions[0]?.contradictionId ?? ''} through its owning gate before dependent work continues`
        : activeTasks.length > 0
          ? 'await the dispatched results'
          : activeSpecialists.length > 0
            ? 'assign the active specialists their bounded tasks'
            : 'select the team for the next objective';
  const last = events[events.length - 1];
  return {
    project: projectId,
    leader: claim === null ? null : { leaderId: claim.leaderId, generation: claim.generation, modelRef: claim.modelRef },
    objective,
    currentPhase,
    candidate,
    activeTasks,
    completedTasks: all.filter((t) => t.status !== 'dispatched'),
    activeSpecialists,
    completedAssignments,
    dependencies,
    decisions,
    risks,
    blockers,
    evidence,
    validatorsAndTests,
    reviews,
    carryForward,
    ownerDecisionsRequired: ownerDecisions,
    openContradictions,
    nextAction,
    eventCount: events.length,
    headDigest: last?.digest ?? null,
  };
}

/** Governance wins: apply the governance record's values and report every disagreement. */
export function reconcileLedger(
  ledger: LeaderLedger,
  governance: { readonly activePhase: string | null; readonly candidate: string | null },
): { readonly ledger: LeaderLedger; readonly disagreements: readonly string[] } {
  const disagreements: string[] = [];
  if (ledger.currentPhase !== governance.activePhase) {
    disagreements.push(`ledger phase '${ledger.currentPhase ?? 'none'}' differs from the governance record '${governance.activePhase ?? 'none'}'; the governance record wins`);
  }
  if (governance.candidate !== null && ledger.candidate !== governance.candidate) {
    disagreements.push(`ledger candidate '${ledger.candidate ?? 'none'}' differs from the governance record '${governance.candidate}'; the governance record wins`);
  }
  return {
    ledger: { ...ledger, currentPhase: governance.activePhase, candidate: governance.candidate ?? ledger.candidate },
    disagreements,
  };
}
