/**
 * The structured contracts between ProjectOS, the project leader and the specialists.
 *
 * A specialist returns ONE structured result that validates against `projectos.specialist-result.v1`;
 * anything else — free prose, a partial object, an unknown field, a hidden-reasoning field — is
 * rejected, never repaired. Every free-text field is DATA: nothing reads it for directives, and a
 * summary that says "owner approved" changes nothing anywhere.
 *
 * Specialists never talk to each other. Another agent's output reaches a specialist only as a
 * leader-authored task input that names a RECORDED result by its digest (`result-ref`).
 */
import { PREFIXED_DIGEST } from './canonical.js';
import { RISK_FACTS, type RiskFact, type RiskLevel } from './types.js';

export const TASK_SCHEMA = 'projectos.specialist-task.v1';
export const RESULT_SCHEMA = 'projectos.specialist-result.v1';

const MAX_TEXT = 4000;
const MAX_ITEMS = 100;
/** A whole result, serialised. Below the event store's per-event bound, so a valid result is always recordable. */
export const MAX_RESULT_BYTES = 128 * 1024;
const PANEL_KEYS = [
  'panelId',
  'participants',
  'purpose',
  'inputContract',
  'outputContract',
  'maxRounds',
  'terminationRule',
  'failureRule',
  'costBudgetUnits',
  'contextBudgetBytes',
  'decisionOwner',
] as const;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ROLE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const shortList = (v: unknown): boolean => Array.isArray(v) && v.length <= 20 && v.every((x) => typeof x === 'string' && x.length <= 200);

export type Verdict = 'pass' | 'fail' | 'concern';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** What the leader may PROPOSE for one task. ProjectOS validates it and assembles the real task. */
export interface LeaderTaskProposal {
  readonly taskId: string;
  readonly roleId: string;
  readonly objective: string;
  readonly inputs: readonly ({ readonly kind: 'leader-note'; readonly text: string } | { readonly kind: 'result-ref'; readonly resultDigest: string })[];
  readonly requestedTools?: readonly string[];
  readonly requestedScopes?: { readonly read?: readonly string[]; readonly write?: readonly string[] };
  readonly requestedActions?: readonly string[];
  readonly dependsOn?: readonly string[];
  readonly panelId?: string;
}

/** The task a specialist actually receives, assembled by ProjectOS. */
export interface TaskEnvelope {
  readonly schema: typeof TASK_SCHEMA;
  readonly taskId: string;
  readonly projectId: string;
  readonly generation: number;
  readonly roleId: string;
  readonly roleVersion: number;
  readonly modelRef: string;
  readonly objective: string;
  readonly inputs: readonly ({ readonly kind: 'leader-note'; readonly text: string } | { readonly kind: 'result'; readonly resultDigest: string; readonly summary: string })[];
  readonly grant: { readonly tools: readonly string[]; readonly readScopes: readonly string[]; readonly writeScopes: readonly string[] };
  readonly facts: { readonly riskLevel: RiskLevel; readonly riskFacts: readonly RiskFact[] };
}

export interface Finding {
  readonly subject: string;
  readonly verdict: Verdict;
  readonly severity: Severity;
  readonly detail: string;
}

export interface SpecialistResult {
  readonly schema: typeof RESULT_SCHEMA;
  readonly taskId: string;
  readonly agent: { readonly roleId: string; readonly version: number };
  readonly provenance: { readonly modelRef: string; readonly provider: string; readonly engine: string; readonly substitutedFrom: string | null };
  readonly status: 'completed' | 'failed' | 'partial' | 'blocked';
  readonly summary: string;
  readonly findings: readonly Finding[];
  readonly evidenceRefs: readonly string[];
  readonly affectedFiles: readonly string[];
  readonly risks: readonly { readonly description: string; readonly severity: Severity }[];
  readonly recommendations: readonly string[];
  readonly confidence: 'low' | 'medium' | 'high';
  readonly blockers: readonly string[];
  readonly decisionRequired: null | { readonly question: string; readonly owner: 'leader' | 'gate' | 'owner' };
}

const RESULT_KEYS = [
  'schema',
  'taskId',
  'agent',
  'provenance',
  'status',
  'summary',
  'findings',
  'evidenceRefs',
  'affectedFiles',
  'risks',
  'recommendations',
  'confidence',
  'blockers',
  'decisionRequired',
] as const;
const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high', 'critical'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): boolean => typeof v === 'string' && v.length <= max;
const textList = (v: unknown): boolean => Array.isArray(v) && v.length <= MAX_ITEMS && v.every((x) => text(x, 1000));
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]): string[] => {
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !(k in o));
  return [...extra.map((k) => `unexpected field '${k}'`), ...missing.map((k) => `missing field '${k}'`)];
};

/**
 * Validate a result against the contract AND against the task it answers. The provenance must name
 * the model ProjectOS actually dispatched, so an engine cannot claim another.
 */
export function validateResult(
  v: unknown,
  expect: { readonly taskId: string; readonly roleId: string; readonly version: number; readonly modelRef: string; readonly substitutedFrom: string | null },
): string[] {
  if (!isObj(v)) return ['the result is not a structured object (free prose is not a result)'];
  const e = exactKeys(v, RESULT_KEYS);
  if (e.length > 0) return e;
  if (v['schema'] !== RESULT_SCHEMA) e.push(`schema must be ${RESULT_SCHEMA}`);
  if (v['taskId'] !== expect.taskId) e.push('taskId does not name the dispatched task');
  const agent = v['agent'];
  if (!isObj(agent) || exactKeys(agent, ['roleId', 'version']).length > 0 || agent['roleId'] !== expect.roleId || agent['version'] !== expect.version) {
    e.push('agent does not name the dispatched role and version');
  }
  const prov = v['provenance'];
  if (
    !isObj(prov) ||
    exactKeys(prov, ['modelRef', 'provider', 'engine', 'substitutedFrom']).length > 0 ||
    prov['modelRef'] !== expect.modelRef ||
    prov['substitutedFrom'] !== expect.substitutedFrom ||
    !text(prov['provider'], 100) ||
    !text(prov['engine'], 200)
  ) {
    e.push('provenance does not name the model ProjectOS dispatched (and any substitution)');
  }
  if (!['completed', 'failed', 'partial', 'blocked'].includes(String(v['status']))) e.push('status is not a result status');
  if (!text(v['summary'])) e.push('summary must be text within the bound');
  const findings = v['findings'];
  if (!Array.isArray(findings) || findings.length > MAX_ITEMS) e.push('findings must be a bounded list');
  else {
    for (const f of findings) {
      if (!isObj(f) || exactKeys(f, ['subject', 'verdict', 'severity', 'detail']).length > 0 || !text(f['subject'], 200) || !['pass', 'fail', 'concern'].includes(String(f['verdict'])) || !SEVERITIES.includes(f['severity'] as Severity) || !text(f['detail'])) {
        e.push('a finding is not {subject, verdict, severity, detail}');
        break;
      }
    }
    // ONE verdict per subject: a result that says both is not a result, and each repeat would multiply contradictions.
    const subjects = findings.map((f) => (isObj(f) ? f['subject'] : undefined));
    if (new Set(subjects).size !== subjects.length) e.push('findings name the same subject more than once');
  }
  for (const k of ['evidenceRefs', 'affectedFiles', 'recommendations', 'blockers']) if (!textList(v[k])) e.push(`${k} must be a bounded list of text`);
  const risks = v['risks'];
  if (!Array.isArray(risks) || risks.length > MAX_ITEMS || !risks.every((r) => isObj(r) && exactKeys(r, ['description', 'severity']).length === 0 && text(r['description']) && SEVERITIES.includes(r['severity'] as Severity))) {
    e.push('risks must be a bounded list of {description, severity}');
  }
  if (!['low', 'medium', 'high'].includes(String(v['confidence']))) e.push('confidence must be low, medium or high');
  const dr = v['decisionRequired'];
  if (dr !== null && (!isObj(dr) || exactKeys(dr, ['question', 'owner']).length > 0 || !text(dr['question']) || !['leader', 'gate', 'owner'].includes(String(dr['owner'])))) {
    e.push('decisionRequired must be null or {question, owner}');
  }
  if (e.length === 0 && Buffer.byteLength(JSON.stringify(v), 'utf8') > MAX_RESULT_BYTES) e.push(`the result exceeds ${MAX_RESULT_BYTES} bytes`);
  return e;
}

/** Validate a leader's task proposal's SHAPE. Authority checks happen in dispatch. */
export function validateProposalShape(v: unknown): string[] {
  if (!isObj(v)) return ['the task proposal is not a structured object'];
  const e: string[] = [];
  if (!TASK_ID.test(String(v['taskId']))) e.push('taskId is not a task id');
  if (!ROLE_ID.test(String(v['roleId']))) e.push('roleId is not a role id');
  if (!text(v['objective'])) e.push('objective must be text within the bound');
  for (const k of ['requestedTools', 'requestedActions', 'dependsOn']) {
    if (v[k] !== undefined && !shortList(v[k])) e.push(`${k} must be a short list of short text`);
  }
  const scopes = v['requestedScopes'];
  if (scopes !== undefined && (!isObj(scopes) || !['read', 'write'].every((k) => scopes[k] === undefined || shortList(scopes[k])))) {
    e.push('requestedScopes must be {read?, write?} short lists');
  }
  if (v['panelId'] !== undefined && !TASK_ID.test(String(v['panelId']))) e.push('panelId is not a panel id');
  const inputs = v['inputs'];
  if (!Array.isArray(inputs) || inputs.length > MAX_ITEMS) e.push('inputs must be a bounded list');
  else for (const i of inputs) {
    const ok =
      isObj(i) &&
      ((i['kind'] === 'leader-note' && text(i['text'])) || (i['kind'] === 'result-ref' && PREFIXED_DIGEST.test(String(i['resultDigest']))));
    if (!ok) {
      e.push("an input is neither a leader note nor a result reference by digest (no other channel exists between specialists)");
      break;
    }
  }
  return e;
}

export function isRiskFact(v: unknown): v is RiskFact {
  return RISK_FACTS.includes(v as RiskFact);
}

/** A panel must declare everything before it runs; otherwise it does not run. */
export interface PanelDeclaration {
  readonly panelId: string;
  readonly participants: readonly string[];
  readonly purpose: string;
  readonly inputContract: string;
  readonly outputContract: string;
  readonly maxRounds: number;
  readonly terminationRule: string;
  readonly failureRule: string;
  readonly costBudgetUnits: number;
  readonly contextBudgetBytes: number;
  readonly decisionOwner: 'project-leader' | 'owner';
}

export function validatePanelDeclaration(v: unknown): string[] {
  if (!isObj(v)) return ['the panel declaration is not a structured object'];
  // Recorded whole, so nothing beyond the declared fields is accepted.
  const extra = Object.keys(v).filter((k) => !(PANEL_KEYS as readonly string[]).includes(k));
  const e: string[] = extra.length > 0 ? [`the declaration carries undeclared field(s): ${extra.slice(0, 5).map((k) => `'${k.slice(0, 40)}'`).join(', ')}`] : [];
  if (!TASK_ID.test(String(v['panelId']))) e.push('panelId is missing');
  const participants = v['participants'];
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > 20 || !participants.every((p) => typeof p === 'string' && ROLE_ID.test(p))) {
    e.push('participants must name two to twenty role ids');
  }
  for (const k of ['purpose', 'inputContract', 'outputContract', 'terminationRule', 'failureRule']) if (!text(v[k]) || String(v[k]).trim() === '') e.push(`${k} must be declared`);
  for (const k of ['maxRounds', 'costBudgetUnits', 'contextBudgetBytes']) {
    if (typeof v[k] !== 'number' || !Number.isInteger(v[k]) || (v[k] as number) <= 0) e.push(`${k} must be a positive integer`);
  }
  if (v['decisionOwner'] !== 'project-leader' && v['decisionOwner'] !== 'owner') e.push('decisionOwner must be declared');
  return e;
}
