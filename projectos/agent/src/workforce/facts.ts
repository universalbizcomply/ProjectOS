/**
 * Task facts: derived by ProjectOS from governed records wherever a record carries them.
 *
 * FROM THE PHASE RECORD: its risk level, whether a security review is required, and whether browser
 * proof is required. FROM THE PHASE SCOPE AND THE CANDIDATE: every path, through the governance-owned
 * `pathFacts` map in the selection policy (a payment module, a migration, a deployment file, a UI tree).
 * THE TASK TYPE follows from those facts through `taskTypeByFacts`; only when no rule matches may the
 * leader name one, and otherwise the policy default applies.
 *
 * The leader may supply only facts no record carries: a task type where none was derived, ADDITIONAL
 * risk facts, or a HIGHER risk level. It can raise the risk a record establishes and never lower it,
 * and every supplied, omitted or refused leader fact is recorded, so the selection that follows can be
 * reconstructed and challenged.
 */
import { RISK_FACTS, RISK_LEVELS, TASK_TYPES, type RiskFact, type RiskLevel, type SelectionPolicy, type TaskType } from './types.js';

export interface PhaseRecordFacts {
  readonly phaseId: string;
  readonly riskLevel: unknown;
  readonly requiredReviews: readonly string[];
  readonly requiredBrowserProof: boolean;
  /** Paths the governed records name: the phase's implementation scope and, when one exists, the candidate's changed paths. */
  readonly paths?: readonly string[];
}

export interface RecordFacts {
  readonly phaseId: string;
  readonly riskLevel: RiskLevel;
  readonly riskFacts: readonly RiskFact[];
  readonly taskType: TaskType | null;
  readonly notes: readonly string[];
}

export interface LeaderSuppliedFacts {
  readonly taskType?: unknown;
  readonly riskLevel?: unknown;
  readonly riskFacts?: unknown;
}

export interface TaskFacts {
  readonly taskType: TaskType;
  readonly riskLevel: RiskLevel;
  readonly riskFacts: readonly RiskFact[];
  readonly criticality: RiskLevel;
  readonly provenance: {
    readonly fromRecords: readonly string[];
    readonly leaderSupplied: readonly string[];
    readonly omitted: readonly string[];
    readonly refused: readonly string[];
  };
}

const rank = (r: RiskLevel): number => RISK_LEVELS.indexOf(r);
export const maxRisk = (a: RiskLevel, b: RiskLevel): RiskLevel => (rank(a) >= rank(b) ? a : b);

/** `**` matches any depth, `*` one path segment; everything else is literal. Anchored at both ends. */
export function pathPattern(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i] ?? '';
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
    } else if (c === '*') out += '[^/]*';
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Facts the governed records establish. An unreadable risk level is taken as `high`, never as low. */
export function deriveRecordFacts(phase: PhaseRecordFacts, policy: SelectionPolicy): RecordFacts {
  const notes: string[] = [];
  let riskLevel: RiskLevel;
  if (RISK_LEVELS.includes(phase.riskLevel as RiskLevel)) riskLevel = phase.riskLevel as RiskLevel;
  else {
    riskLevel = 'high';
    notes.push(`phase riskLevel '${String(phase.riskLevel)}' is not a risk level; treated as high`);
  }
  const facts = new Set<RiskFact>();
  if (phase.requiredReviews.some((r) => /security/i.test(r))) facts.add('security');
  if (phase.requiredBrowserProof) facts.add('ui');
  const rules = policy.pathFacts.map((r) => ({ re: pathPattern(r.pattern), facts: r.facts }));
  for (const raw of phase.paths ?? []) {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const r of rules) {
      if (!r.re.test(p)) continue;
      for (const f of r.facts) {
        if (!facts.has(f)) notes.push(`path '${p}' carries fact '${f}'`);
        facts.add(f);
      }
    }
  }
  const riskFacts = RISK_FACTS.filter((f) => facts.has(f));
  const rule = policy.taskTypeByFacts.find((r) => r.anyOf.some((f) => facts.has(f)));
  return { phaseId: phase.phaseId, riskLevel, riskFacts, taskType: rule?.taskType ?? null, notes };
}

/** Combine record facts with the leader's supplement under the raise-only rule. */
export function combineFacts(record: RecordFacts, leader: LeaderSuppliedFacts, policy: SelectionPolicy): TaskFacts {
  const fromRecords = [`riskLevel=${record.riskLevel}`, ...record.riskFacts.map((f) => `fact=${f}`), ...(record.taskType === null ? [] : [`taskType=${record.taskType}`])];
  const leaderSupplied: string[] = [];
  const omitted: string[] = [];
  const refused: string[] = [];

  let taskType: TaskType;
  if (record.taskType !== null) {
    taskType = record.taskType;
    if (leader.taskType !== undefined && leader.taskType !== record.taskType) {
      refused.push(`taskType '${String(leader.taskType)}': the records establish '${record.taskType}', and a leader supplies only facts no record carries`);
    }
  } else if (leader.taskType === undefined) {
    taskType = policy.defaultTaskType;
    omitted.push(`taskType (policy default '${policy.defaultTaskType}' applied)`);
  } else if (TASK_TYPES.includes(leader.taskType as TaskType)) {
    taskType = leader.taskType as TaskType;
    leaderSupplied.push(`taskType=${taskType}`);
  } else {
    taskType = policy.defaultTaskType;
    refused.push(`taskType '${String(leader.taskType)}' is not a task type (policy default applied)`);
  }

  let riskLevel = record.riskLevel;
  if (leader.riskLevel === undefined) omitted.push('riskLevel');
  else if (!RISK_LEVELS.includes(leader.riskLevel as RiskLevel)) refused.push(`riskLevel '${String(leader.riskLevel)}' is not a risk level`);
  else if (rank(leader.riskLevel as RiskLevel) < rank(record.riskLevel)) {
    refused.push(`riskLevel '${String(leader.riskLevel)}' would lower the record's '${record.riskLevel}'; a leader may only raise risk`);
  } else {
    riskLevel = maxRisk(record.riskLevel, leader.riskLevel as RiskLevel);
    leaderSupplied.push(`riskLevel=${String(leader.riskLevel)}`);
  }

  const facts = new Set<RiskFact>(record.riskFacts);
  if (leader.riskFacts === undefined) omitted.push('riskFacts');
  else if (!Array.isArray(leader.riskFacts)) refused.push('riskFacts is not a list');
  else {
    for (const f of leader.riskFacts) {
      if (RISK_FACTS.includes(f as RiskFact)) {
        if (!facts.has(f as RiskFact)) leaderSupplied.push(`fact=${String(f)}`);
        facts.add(f as RiskFact);
      } else refused.push(`fact '${String(f)}' is not a declared risk fact`);
    }
  }
  return {
    taskType,
    riskLevel,
    riskFacts: RISK_FACTS.filter((f) => facts.has(f)),
    criticality: riskLevel,
    provenance: { fromRecords, leaderSupplied, omitted, refused },
  };
}
