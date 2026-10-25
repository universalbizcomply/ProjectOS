/**
 * Objective-driven operation: ProjectOS turns a stated objective into a leader, facts and a team.
 *
 * The user never names an agent. `startObjective` makes sure the project has its one leader, records
 * the objective, derives the facts from the governed records (plus any raise-only supplement from the
 * leader), and runs the ONE selection function. `runLeaderRound` hands the leader a BOUNDED ledger
 * projection reconciled with the governance record, takes its proposal, and routes every part of it
 * through ProjectOS: decisions through `recordLeaderDecision`, panels through `declarePanel`, tasks
 * through `dispatchSpecialistTask` in waves no wider than the parallelism bound.
 *
 * A LEADER CONSULTATION IS A MODEL CALL. It counts against the execution's cumulative call and cost
 * ceiling exactly as a specialist dispatch does, it runs OUTSIDE the store lock, and a proposal larger
 * than the governance cap is refused whole.
 */
import { createHash } from 'node:crypto';
import { canonicalRepositoryIdentity } from '../installation/projectAllowlist.js';
import { nodeInstallationStateDir } from '../nodeRuntimeRoot.js';
import type { System } from '../system.js';
import { ceilingUsage, dispatchSpecialistTask, type DispatchOutcome, type WorkforceRuntime } from './dispatch.js';
import type { LeaderEngine } from './engines.js';
import { WorkforceRefusal, WorkforceStore } from './eventStore.js';
import { combineFacts, deriveRecordFacts, pathsInText, type PhaseRecordFacts, type TaskFacts } from './facts.js';
import { loadWorkforceGovernance } from './governance.js';
import { assertCurrentGeneration, ensureProjectLeader, type LeaderClaim } from './leader.js';
import { declarePanel, recordLeaderDecision, type DecisionOutcome } from './leaderDecisions.js';
import { resolveLeaderModel } from './models.js';
import { projectLedger, reconcileLedger } from './projection.js';
import { effectiveRole, findEntry } from './registry.js';
import { selectTeam, type TeamSelection } from './teamSelection.js';
import type { WorkforceGovernance } from './types.js';

export interface ObjectiveInput {
  readonly objective: string;
  readonly phase: PhaseRecordFacts;
  readonly candidate: string | null;
  /** The leader's engine, when one runs; without one every leader-only fact is recorded as omitted. */
  readonly leaderEngine: LeaderEngine | null;
}

export type ObjectiveOutcome =
  | { readonly ok: true; readonly leader: LeaderClaim; readonly tookOver: boolean; readonly facts: TaskFacts; readonly team: TeamSelection }
  | { readonly ok: false; readonly code: string; readonly reasons: readonly string[]; readonly leader: LeaderClaim | null };

export interface GovernanceRecord {
  readonly activePhase: string | null;
  readonly candidate: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Consult the leader once: ceiling first (fails closed), then the consultation is recorded, then the
 * engine runs OUTSIDE the lock on the governance-reconciled ledger. Returns the untrusted proposal.
 */
function consultLeader(store: WorkforceStore, gov: WorkforceGovernance, generation: number, engine: LeaderEngine, objective: string, governance: GovernanceRecord, team: readonly unknown[]): Record<string, unknown> {
  const ledger = store.withLock(() => {
    assertCurrentGeneration(store, generation, store.sys.now(), gov.config.leader.leaseBoundMs);
    const events = store.readVerified();
    const used = ceilingUsage(events);
    const unit = gov.config.ceilings.costUnits[gov.config.leader.costClass];
    if (used.calls + 1 > gov.config.ceilings.maxCallsPerExecution || used.costUnits + unit > gov.config.ceilings.maxCostUnitsPerExecution) {
      store.append('dispatch-refused', generation, { taskId: 'leader-consultation', stage: 'ceiling', code: 'CEILING_REACHED', reason: `${used.calls} calls, ${used.costUnits} cost units used` });
      throw new WorkforceRefusal('CEILING_REACHED', 'the execution’s call and cost ceiling is reached; the leader is not consulted', true);
    }
    store.append('leader-consulted', generation, { modelRef: engine.modelRef, costUnits: unit });
    const rec = reconcileLedger(projectLedger(store.projectId, store.readVerified()), governance);
    if (rec.disagreements.length > 0) store.append('governance-disagreement', generation, { disagreements: rec.disagreements });
    return rec.ledger;
  });
  const proposal = engine.propose({ objective, ledger, team: team as never });
  return isObj(proposal) ? proposal : {};
}

export function startObjective(store: WorkforceStore, gov: WorkforceGovernance, input: ObjectiveInput): ObjectiveOutcome {
  const leaderModel = resolveLeaderModel(gov.config.leader.modelPreference, gov.modelPolicy);
  if (!leaderModel.ok) return { ok: false, code: leaderModel.code, reasons: [leaderModel.reason], leader: null };
  if (input.leaderEngine !== null && input.leaderEngine.modelRef !== leaderModel.modelRef) {
    return { ok: false, code: 'LEADER_MODEL_NOT_APPROVED', reasons: [`the leader engine runs '${input.leaderEngine.modelRef}', but the model policy names '${leaderModel.modelRef}'`], leader: null };
  }
  let claim: LeaderClaim | null = null;
  try {
    const started = store.withLock(() => {
      const r = ensureProjectLeader(store, { now: store.sys.now(), modelRef: leaderModel.modelRef, leaseBoundMs: gov.config.leader.leaseBoundMs });
      store.append('objective-set', r.claim.generation, { objective: input.objective.slice(0, 4000), phaseId: input.phase.phaseId, candidate: input.candidate });
      return r;
    });
    claim = started.claim;
    const generation = claim.generation;
    const supplied =
      input.leaderEngine === null
        ? {}
        : (() => {
            const proposal = consultLeader(store, gov, generation, input.leaderEngine, input.objective, { activePhase: input.phase.phaseId, candidate: input.candidate }, []);
            return isObj(proposal['facts']) ? proposal['facts'] : {};
          })();
    return store.withLock((): ObjectiveOutcome => {
      assertCurrentGeneration(store, generation, store.sys.now(), gov.config.leader.leaseBoundMs);
      const record = deriveRecordFacts(input.phase, gov.selectionPolicy);
      const facts = combineFacts(record, supplied, gov.selectionPolicy);
      store.append('facts-derived', generation, { record, facts });
      const sel = selectTeam(facts, gov);
      if (!sel.ok) {
        store.append('selection-refused', generation, { code: sel.code, reasons: sel.reasons });
        return { ok: false, code: sel.code, reasons: sel.reasons, leader: started.claim };
      }
      store.append('team-selected', generation, { ...sel.team });
      return { ok: true, leader: started.claim, tookOver: started.tookOver, facts, team: sel.team };
    });
  } catch (e) {
    if (e instanceof WorkforceRefusal) return { ok: false, code: e.code, reasons: [e.reason], leader: claim };
    throw e;
  }
}

export interface RoundOutcome {
  readonly refused: string | null;
  readonly decisions: readonly DecisionOutcome[];
  readonly panels: readonly DecisionOutcome[];
  readonly waves: readonly (readonly string[])[];
  readonly tasks: readonly DispatchOutcome[];
}

/** Waves no wider than `maxParallel`; a role that is not parallel-safe always runs alone. */
export function planWaves(rt: WorkforceRuntime, tasks: readonly Record<string, unknown>[]): string[][] {
  const waves: string[][] = [];
  let current: string[] = [];
  for (const t of tasks) {
    const entry = findEntry(rt.gov.registry, String(t['roleId']));
    const safe = entry !== undefined && effectiveRole(entry, rt.gov.config).parallelSafe;
    const id = String(t['taskId']);
    if (!safe) {
      if (current.length > 0) waves.push(current);
      waves.push([id]);
      current = [];
      continue;
    }
    current.push(id);
    if (current.length >= rt.gov.config.bounds.maxParallel) {
      waves.push(current);
      current = [];
    }
  }
  if (current.length > 0) waves.push(current);
  return waves;
}

export function runLeaderRound(rt: WorkforceRuntime, generation: number, objective: string, leader: LeaderEngine, governance: GovernanceRecord): RoundOutcome {
  const empty = { decisions: [], panels: [], waves: [], tasks: [] };
  const team = rt.store.readVerified().filter((e) => e.type === 'team-selected' && e.generation === generation).at(-1)?.payload['members'];
  let p: Record<string, unknown>;
  try {
    p = consultLeader(rt.store, rt.gov, generation, leader, objective, governance, Array.isArray(team) ? team : []);
  } catch (e) {
    if (e instanceof WorkforceRefusal) return { refused: `${e.code}: ${e.reason}`, ...empty };
    throw e;
  }
  const list = (k: string): unknown[] => (Array.isArray(p[k]) ? (p[k] as unknown[]) : []);
  const size = list('decisions').length + list('panels').length + list('tasks').length;
  if (size > rt.gov.config.leader.maxProposalItems) {
    const reason = `the proposal carries ${size} items; the governance cap is ${rt.gov.config.leader.maxProposalItems}`;
    rt.store.withLock(() => rt.store.append('leader-decision-refused', generation, { kind: 'proposal', gate: 'governance cap leader.maxProposalItems', reason }));
    return { refused: `PROPOSAL_TOO_LARGE: ${reason}`, ...empty };
  }
  const decisions = list('decisions').map((d) =>
    recordLeaderDecision(rt.store, rt.gov, generation, isObj(d) ? { kind: d['kind'], detail: d['detail'] } : { kind: 'unknown', detail: '' }),
  );
  const panels = list('panels').map((d) => declarePanel(rt.store, rt.gov, generation, d));
  const tasks = list('tasks').filter(isObj);
  const waves = planWaves(rt, tasks);
  if (tasks.length > 0) {
    recordLeaderDecision(rt.store, rt.gov, generation, { kind: 'sequence-tasks', detail: `waves: ${waves.map((w) => `[${w.join(', ')}]`).join(' ')}` });
  }
  const byId = new Map(tasks.map((t) => [String(t['taskId']), t]));
  const outcomes: DispatchOutcome[] = [];
  for (const wave of waves) for (const id of wave) outcomes.push(dispatchSpecialistTask(rt, generation, byId.get(id)));
  return { refused: null, decisions, panels, waves, tasks: outcomes };
}

/**
 * Where the workforce's durable state lives: the per-user installation state directory, keyed by the
 * governed repository — OUTSIDE the checkout, beside the degraded-mode ledger. Null when this machine
 * offers no such location or the checkout has no readable origin; the workforce then does not start.
 */
export function workforceStateRoot(sys: System, root: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const base = nodeInstallationStateDir(env);
  const repository = canonicalRepositoryIdentity(sys, root);
  if (base === null || repository === null) return null;
  const key = createHash('sha256').update(repository, 'utf8').digest('hex').slice(0, 16);
  const dir = `${base}/workforce/${key}`;
  const norm = (x: string): string => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (norm(dir).startsWith(`${norm(root)}/`)) return null;
  return dir;
}

/**
 * The workforce's part of `projectos run`: selection is automatic and nothing is named by the user.
 * Specialist EXECUTION is not activated, so this selects and records the team (or previews it on a
 * dry run) and says so. Governance that is absent, invalid or not yet owner-accepted is reported and
 * nothing is written. The project is the one named at the owner-accepted commit.
 */
export function workforceForRun(
  sys: System,
  root: string,
  input: {
    readonly phase: PhaseRecordFacts;
    /** The approved phase scope, as written; its path-shaped tokens become record facts. */
    readonly scopeText?: string;
    readonly objective: string;
    readonly candidate: string | null;
    readonly dryRun: boolean;
    readonly stateRoot?: string;
  },
): readonly string[] {
  // THE BOUNDARY `run` RELIES ON: nothing the workforce does may stop the run. Every failure — a
  // refusal, a malformed record, an unexpected error — becomes one reported line, never a crash.
  try {
    return workforceForRunUnguarded(sys, root, input);
  } catch (e) {
    const why = e instanceof WorkforceRefusal ? `${e.code}: ${e.reason}` : `WORKFORCE_ERROR: ${e instanceof Error ? e.message : String(e)}`;
    return [`Workforce: not active — ${why}`.slice(0, 500)];
  }
}

/**
 * Paths the candidate changed since the owner-accepted commit. A diff that cannot be read is REFUSED,
 * never read as "nothing changed": an empty list would under-staff exactly the change it failed to see.
 */
function candidatePaths(sys: System, root: string, acceptedCommit: string): string[] {
  const r = sys.exec('git', ['-C', root, 'diff', '--name-only', '--no-renames', '--no-ext-diff', acceptedCommit, 'HEAD', '--']);
  if (r.code !== 0) throw new WorkforceRefusal('CANDIDATE_PATHS_UNREADABLE', `the candidate's changed paths since ${acceptedCommit.slice(0, 12)} could not be read`);
  const paths = r.stdout.split(/\r?\n/).filter((p) => p.length > 0);
  if (paths.length > 2000) throw new WorkforceRefusal('CANDIDATE_PATHS_UNBOUNDED', `the candidate changes ${paths.length} paths; the fact bound is 2000`);
  return paths;
}

function workforceForRunUnguarded(
  sys: System,
  root: string,
  input: Parameters<typeof workforceForRun>[2],
): readonly string[] {
  const gov = loadWorkforceGovernance(sys, root);
  if (!gov.ok) return [`Workforce: not active — ${gov.problems[0] ?? 'governance unavailable'}`];
  const phase: PhaseRecordFacts = {
    ...input.phase,
    paths: [...(input.phase.paths ?? []), ...pathsInText(input.scopeText ?? ''), ...candidatePaths(sys, root, gov.value.acceptedCommit)],
  };
  const lines: string[] = [];
  const describe = (team: TeamSelection): void => {
    for (const m of team.members) lines.push(`  - ${m.roleId} (${m.assignment}, ${m.modelRef}): ${m.reasons.join('; ')}`);
    for (const x of team.excluded) lines.push(`  - excluded ${x.roleId}: ${x.reason}`);
    for (const r of team.reductions) lines.push(`  - reduced: ${r}`);
  };
  if (input.dryRun) {
    const facts = combineFacts(deriveRecordFacts(phase, gov.value.selectionPolicy), {}, gov.value.selectionPolicy);
    const sel = selectTeam(facts, gov.value);
    if (!sel.ok) lines.push(`Workforce (preview, not recorded): selection refused — ${sel.reasons.join('; ')}`);
    else {
      lines.push(`Workforce (preview, not recorded): ${sel.team.members.length} specialist(s) for '${sel.team.taskType}' at risk '${sel.team.riskLevel}'`);
      describe(sel.team);
    }
  } else {
    const stateRoot = input.stateRoot ?? workforceStateRoot(sys, root);
    if (stateRoot === null) return ['Workforce: not active — no installation state location outside the checkout is available on this machine'];
    const store = new WorkforceStore(sys, stateRoot, gov.value.projectId, gov.value.config.projection.maxEvents);
    const out = startObjective(store, gov.value, { objective: input.objective, phase, candidate: input.candidate, leaderEngine: null });
    if (!out.ok) lines.push(`Workforce: ${out.code} — ${out.reasons.join('; ')}`);
    else {
      lines.push(`Workforce: leader ${out.leader.leaderId} generation ${out.leader.generation}${out.tookOver ? ' (ProjectOS takeover of a stale leader)' : ''}; ${out.team.members.length} specialist(s) selected for '${out.team.taskType}'`);
      describe(out.team);
    }
  }
  lines.push('Workforce: specialist execution is NOT activated (live execution is an owner activation input; fixture engines only)');
  return lines;
}
