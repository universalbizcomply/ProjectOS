/**
 * The four governance-owned workforce documents, read ONLY from the owner-accepted committed state.
 *
 * Workforce configuration, registry eligibility, selection policy and model policy decide who may be
 * selected, with what grants, on which model. They change only through the owner's commit gate, so
 * ProjectOS never reads them from the working tree (the leader or a worker could write that) and never
 * from an unreviewed local commit (`HEAD` can be one). The owner-accepted state is the commit the
 * branch's UPSTREAM names: in ProjectOS a push happens only through the owner's pre-push gate. A
 * commit carrying the local-candidate trailer is refused even there.
 *
 * RESIDUAL, STATED: a process with shell access to the checkout can move a local ref. That is the same
 * residual every committed-state read in ProjectOS carries; the leader and the specialists hold no
 * shell grant (`GRANTABLE_TOOLS`).
 */
import type { System } from '../system.js';
import { digestOf } from './canonical.js';
import { validateRegistryDocument } from './registry.js';
import {
  COST_CLASSES,
  GRANTABLE_TOOLS,
  RISK_FACTS,
  RISK_LEVELS,
  TASK_TYPES,
  type ModelPolicy,
  type RoleConfiguration,
  type SelectionPolicy,
  type WorkforceConfig,
  type WorkforceGovernance,
} from './types.js';

export const WORKFORCE_DIR = '.projectops/workforce';
export const GOVERNANCE_FILES = {
  config: `${WORKFORCE_DIR}/workforce-config.json`,
  registry: `${WORKFORCE_DIR}/registry.json`,
  selectionPolicy: `${WORKFORCE_DIR}/selection-policy.json`,
  modelPolicy: `${WORKFORCE_DIR}/model-policy.json`,
} as const;

const LOCAL_CANDIDATE_TRAILER = 'ProjectOS-Local-Candidate';
const COMMIT_ID = /^[0-9a-f]{40}$/;

export type Loaded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problems: readonly string[] };

/** The owner-accepted commit: the branch's upstream, refused when it is a local candidate. */
export function ownerAcceptedCommit(sys: System, root: string): Loaded<string> {
  // A REMOTE-TRACKING UPSTREAM ONLY. `branch --set-upstream-to=<local branch>` would otherwise let an
  // unpushed local commit pose as owner-accepted state.
  const name = sys.exec('git', ['-C', root, 'rev-parse', '--symbolic-full-name', '@{upstream}']);
  if (name.code !== 0 || !name.stdout.trim().startsWith('refs/remotes/')) {
    return {
      ok: false,
      problems: ['the branch has no remote-tracking upstream, so no workforce governance is owner-accepted yet (it becomes effective after the owner-gated push)'],
    };
  }
  const r = sys.exec('git', ['-C', root, 'rev-parse', '--verify', '--quiet', '@{upstream}^{commit}']);
  const commit = r.stdout.trim();
  if (r.code !== 0 || !COMMIT_ID.test(commit)) {
    return {
      ok: false,
      problems: ['the branch has no upstream commit, so no workforce governance is owner-accepted yet (it becomes effective after the owner-gated push)'],
    };
  }
  const body = sys.exec('git', ['-C', root, 'log', '-1', '--format=%B', commit]);
  if (body.code !== 0) return { ok: false, problems: [`the owner-accepted commit ${commit.slice(0, 12)} could not be read`] };
  if (body.stdout.split(/\r?\n/).some((line) => line.startsWith(`${LOCAL_CANDIDATE_TRAILER}:`))) {
    return { ok: false, problems: [`commit ${commit.slice(0, 12)} is an unreviewed local candidate and is never owner-accepted state`] };
  }
  return { ok: true, value: commit };
}

function readAt(sys: System, root: string, commit: string, relPath: string): Loaded<unknown> {
  const r = sys.exec('git', ['-C', root, 'show', `${commit}:./${relPath}`]);
  if (r.code !== 0) return { ok: false, problems: [`${relPath} is not committed at the owner-accepted commit ${commit.slice(0, 12)}`] };
  try {
    return { ok: true, value: JSON.parse(r.stdout) as unknown };
  } catch {
    return { ok: false, problems: [`${relPath} at ${commit.slice(0, 12)} is not valid JSON`] };
  }
}

/** Load and validate all four documents from the owner-accepted commit, or refuse with every problem. */
export function loadWorkforceGovernance(sys: System, root: string): Loaded<WorkforceGovernance> {
  const accepted = ownerAcceptedCommit(sys, root);
  if (!accepted.ok) return accepted;
  return loadAt(sys, root, accepted.value);
}

/**
 * DISPLAY ONLY: the documents as committed at `HEAD`, which may not be owner-accepted. Used by
 * `workforce roster --candidate` so a roster is inspectable before the owner's push; nothing that
 * selects, grants or dispatches ever calls this.
 */
export function inspectGovernanceAtHead(sys: System, root: string): Loaded<WorkforceGovernance> {
  const head = sys.exec('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']);
  const commit = head.stdout.trim();
  if (head.code !== 0 || !COMMIT_ID.test(commit)) return { ok: false, problems: ['HEAD is not readable'] };
  return loadAt(sys, root, commit);
}

function loadAt(sys: System, root: string, commit: string): Loaded<WorkforceGovernance> {
  const raw = {
    config: readAt(sys, root, commit, GOVERNANCE_FILES.config),
    registry: readAt(sys, root, commit, GOVERNANCE_FILES.registry),
    selectionPolicy: readAt(sys, root, commit, GOVERNANCE_FILES.selectionPolicy),
    modelPolicy: readAt(sys, root, commit, GOVERNANCE_FILES.modelPolicy),
  };
  const project = readAt(sys, root, commit, '.projectops/project-config.json');
  const problems: string[] = [];
  for (const r of [...Object.values(raw), project]) if (!r.ok) problems.push(...r.problems);
  if (problems.length > 0 || !raw.config.ok || !raw.registry.ok || !raw.selectionPolicy.ok || !raw.modelPolicy.ok || !project.ok) {
    return { ok: false, problems };
  }
  const projectId = (project.value as { projectId?: unknown } | null)?.projectId;
  if (typeof projectId !== 'string' || projectId.length === 0) return { ok: false, problems: ['the project config at the owner-accepted commit names no projectId'] };
  return validateGovernance(commit, projectId, raw.config.value, raw.registry.value, raw.selectionPolicy.value, raw.modelPolicy.value);
}

/** Validate the four documents together (pure). Cross-references are checked, not assumed. */
export function validateGovernance(
  acceptedCommit: string,
  projectId: string,
  config: unknown,
  registry: unknown,
  selectionPolicy: unknown,
  modelPolicy: unknown,
): Loaded<WorkforceGovernance> {
  const problems = [
    ...validateConfig(config),
    ...validateSelectionPolicy(selectionPolicy),
    ...validateModelPolicy(modelPolicy),
  ];
  if (problems.length === 0) {
    problems.push(...validateRegistryDocument(registry, (config as WorkforceConfig).catalogue));
  }
  if (problems.length > 0) return { ok: false, problems };
  const cfg = config as WorkforceConfig;
  const reg = registry as WorkforceGovernance['registry'];
  const sel = selectionPolicy as SelectionPolicy;
  const mod = modelPolicy as ModelPolicy;
  problems.push(...crossReferenceProblems(cfg, reg, sel, mod));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      acceptedCommit,
      projectId,
      config: cfg,
      registry: reg,
      selectionPolicy: sel,
      modelPolicy: mod,
      digests: {
        config: digestOf(cfg),
        registry: digestOf(reg),
        selectionPolicy: digestOf(sel),
        modelPolicy: digestOf(mod),
      },
    },
  };
}

// ---- document validation --------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function validateRole(id: string, r: unknown): string[] {
  const p = `workforce-config roles.${id}`;
  if (!isObj(r)) return [`${p} is not an object`];
  const e: string[] = [];
  for (const k of ['capabilities', 'applicablePhaseTypes', 'tools', 'readScopes', 'writeScopes', 'requiredInputs', 'evidenceRequirements']) {
    if (!Array.isArray(r[k]) || !(r[k] as unknown[]).every((x) => typeof x === 'string')) e.push(`${p}.${k} must be a string array`);
  }
  const role = r as unknown as RoleConfiguration;
  if (Array.isArray(role.tools) && role.tools.some((t) => !GRANTABLE_TOOLS.includes(t))) e.push(`${p}.tools names a tool that is not grantable`);
  if (Array.isArray(role.applicablePhaseTypes) && role.applicablePhaseTypes.some((t) => !TASK_TYPES.includes(t))) {
    e.push(`${p}.applicablePhaseTypes names an unknown task type`);
  }
  if (Array.isArray(role.writeScopes) && role.writeScopes.length > 0) e.push(`${p}.writeScopes must be empty in this phase (no specialist writes)`);
  if (!COST_CLASSES.includes(role.costClass)) e.push(`${p}.costClass is not a cost class`);
  if (!isNonEmpty(role.modelPreference) || !role.modelPreference.startsWith('policy:')) e.push(`${p}.modelPreference must reference the model policy ("policy:<name>")`);
  for (const k of ['parallelSafe', 'implementation', 'review'] as const) if (typeof role[k] !== 'boolean') e.push(`${p}.${k} must be boolean`);
  if (role.riskTier !== 'standard' && role.riskTier !== 'high') e.push(`${p}.riskTier must be standard or high`);
  return e;
}

export function validateConfig(v: unknown): string[] {
  if (!isObj(v)) return ['workforce-config is not an object'];
  const e: string[] = [];
  if (v['schemaVersion'] !== 1) e.push('workforce-config schemaVersion must be 1');
  if (!isNonEmpty(v['configVersion'])) e.push('workforce-config configVersion is missing');
  const cat = v['catalogue'];
  if (!isObj(cat)) e.push('workforce-config catalogue pin is missing');
  else {
    if (!isNonEmpty(cat['upstream']) || !String(cat['upstream']).startsWith('https://')) e.push('catalogue.upstream must be an https URL');
    if (!COMMIT_ID.test(String(cat['commit']))) e.push('catalogue.commit must be a 40-hex commit (never a branch)');
    if (!isPosInt(cat['expectedAgents'])) e.push('catalogue.expectedAgents must be a positive integer');
    if (!isPosInt(cat['expectedDivisions'])) e.push('catalogue.expectedDivisions must be a positive integer');
    if (!isNonEmpty(cat['licence'])) e.push('catalogue.licence is missing');
    const loc = cat['cacheLocation'];
    if (!isObj(loc) || !isNonEmpty(loc['baseEnv']) || !isNonEmpty(loc['relative'])) e.push('catalogue.cacheLocation is missing');
  }
  const leader = v['leader'];
  if (!isObj(leader) || !isPosInt(leader['leaseBoundMs']) || !isNonEmpty(leader['modelPreference']) || !isPosInt(leader['maxProposalItems']) || !COST_CLASSES.includes(leader['costClass'] as never)) {
    e.push('workforce-config leader needs leaseBoundMs, modelPreference, maxProposalItems and costClass');
  }
  const panels = v['panels'];
  if (!isObj(panels) || !isPosInt(panels['maxRounds']) || !isPosInt(panels['maxCostUnits']) || !isPosInt(panels['maxContextBytes'])) {
    e.push('workforce-config panels needs maxRounds, maxCostUnits and maxContextBytes');
  }
  const b = v['bounds'];
  if (!isObj(b)) e.push('workforce-config bounds are missing');
  else {
    for (const k of ['maxTeamSize', 'maxParallel', 'maxContextBytes', 'maxLatencyMs']) if (!isPosInt(b[k])) e.push(`bounds.${k} must be a positive integer`);
    if (!COST_CLASSES.includes(b['maxCostClass'] as never)) e.push('bounds.maxCostClass is not a cost class');
    if (!RISK_LEVELS.includes(b['maxCriticality'] as never)) e.push('bounds.maxCriticality is not a risk level');
  }
  const c = v['ceilings'];
  if (!isObj(c) || !isPosInt(c['maxCallsPerExecution']) || !isPosInt(c['maxCostUnitsPerExecution']) || !isObj(c['costUnits'])) {
    e.push('workforce-config ceilings need maxCallsPerExecution, maxCostUnitsPerExecution and costUnits');
  } else {
    const units = c['costUnits'] as Record<string, unknown>;
    for (const k of COST_CLASSES) if (!isPosInt(units[k])) e.push(`ceilings.costUnits.${k} must be a positive integer`);
  }
  if (!isObj(v['retries']) || !isPosInt((v['retries'] as Record<string, unknown>)['maxAttemptsPerTask'])) e.push('workforce-config retries.maxAttemptsPerTask is missing');
  if (!isObj(v['projection']) || !isPosInt((v['projection'] as Record<string, unknown>)['maxEvents'])) e.push('workforce-config projection.maxEvents is missing');
  const roles = v['roles'];
  if (!isObj(roles)) e.push('workforce-config roles is missing');
  else for (const [id, r] of Object.entries(roles)) e.push(...validateRole(id, r));
  return e;
}

export function validateSelectionPolicy(v: unknown): string[] {
  if (!isObj(v)) return ['selection-policy is not an object'];
  const e: string[] = [];
  if (v['schemaVersion'] !== 1) e.push('selection-policy schemaVersion must be 1');
  if (!isNonEmpty(v['policyVersion'])) e.push('selection-policy policyVersion is missing');
  if (!TASK_TYPES.includes(v['defaultTaskType'] as never)) e.push('selection-policy defaultTaskType is not a task type');
  const types = v['taskTypes'];
  if (!isObj(types)) e.push('selection-policy taskTypes is missing');
  else {
    for (const t of TASK_TYPES) {
      const route = types[t];
      if (!isObj(route) || !isStrArray(route['roles']) || !Array.isArray(route['supportingRoles']) || !isPosInt(route['maxTeam'])) {
        e.push(`selection-policy taskTypes.${t} needs roles, supportingRoles and maxTeam`);
      }
    }
    for (const k of Object.keys(types)) if (!TASK_TYPES.includes(k as never)) e.push(`selection-policy taskTypes names unknown task type '${k}'`);
  }
  const fr = v['factRoles'];
  if (!isObj(fr)) e.push('selection-policy factRoles is missing');
  else for (const [k, roles] of Object.entries(fr)) {
    if (!RISK_FACTS.includes(k as never)) e.push(`selection-policy factRoles names unknown fact '${k}'`);
    if (!isStrArray(roles)) e.push(`selection-policy factRoles.${k} must be a string array`);
  }
  const pf = v['pathFacts'];
  if (!Array.isArray(pf)) e.push('selection-policy pathFacts is missing');
  else for (const r of pf) {
    if (!isObj(r) || !isNonEmpty(r['pattern']) || !Array.isArray(r['facts']) || !(r['facts'] as unknown[]).every((f) => RISK_FACTS.includes(f as never))) {
      e.push('selection-policy pathFacts entries must be {pattern, facts} naming declared facts');
      break;
    }
  }
  const tt = v['taskTypeByFacts'];
  if (!Array.isArray(tt)) e.push('selection-policy taskTypeByFacts is missing');
  else for (const r of tt) {
    if (!isObj(r) || !TASK_TYPES.includes(r['taskType'] as never) || !Array.isArray(r['anyOf']) || (r['anyOf'] as unknown[]).length === 0 || !(r['anyOf'] as unknown[]).every((f) => RISK_FACTS.includes(f as never))) {
      e.push('selection-policy taskTypeByFacts entries must be {anyOf, taskType}');
      break;
    }
  }
  const ir = v['independentReview'];
  if (!isObj(ir) || !Array.isArray(ir['requiredAtRisk']) || !Array.isArray(ir['requiredForFacts']) || !isObj(ir['reviewers'])) {
    e.push('selection-policy independentReview needs requiredAtRisk, requiredForFacts and reviewers');
  } else if (!isStrArray((ir['reviewers'] as Record<string, unknown>)['default'])) {
    e.push('selection-policy independentReview.reviewers.default must name reviewer roles');
  }
  return e;
}

export function validateModelPolicy(v: unknown): string[] {
  if (!isObj(v)) return ['model-policy is not an object'];
  const e: string[] = [];
  if (v['schemaVersion'] !== 1) e.push('model-policy schemaVersion must be 1');
  if (!isNonEmpty(v['policyVersion'])) e.push('model-policy policyVersion is missing');
  if (v['liveExecutionActivated'] !== false) e.push('model-policy liveExecutionActivated must be false: live execution is an activation input');
  const models = v['models'];
  if (!Array.isArray(models) || models.length === 0) e.push('model-policy models is missing');
  else for (const m of models) {
    if (!isObj(m) || !isNonEmpty(m['ref']) || m['kind'] !== 'fixture' || typeof m['approved'] !== 'boolean') {
      e.push('model-policy models entries must be {ref, kind:"fixture", approved}');
    }
  }
  const prefs = v['preferences'];
  if (!isObj(prefs)) e.push('model-policy preferences is missing');
  else for (const [k, p] of Object.entries(prefs)) {
    if (!k.startsWith('policy:')) e.push(`model-policy preference '${k}' must be named "policy:<name>"`);
    if (!isObj(p) || !isNonEmpty(p['primary']) || !(p['fallback'] === null || isNonEmpty(p['fallback']))) {
      e.push(`model-policy preference '${k}' needs primary and fallback (or null)`);
    }
  }
  return e;
}

function crossReferenceProblems(cfg: WorkforceConfig, reg: WorkforceGovernance['registry'], sel: SelectionPolicy, mod: ModelPolicy): string[] {
  const e: string[] = [];
  const ids = new Set(reg.entries.map((x) => x.id));
  const modelRefs = new Set(mod.models.map((m) => m.ref));
  for (const id of Object.keys(cfg.roles)) if (!ids.has(id)) e.push(`workforce-config configures '${id}', which is not registered`);
  const policyRoles = [
    ...Object.values(sel.taskTypes).flatMap((t) => [...t.roles, ...t.supportingRoles]),
    ...Object.values(sel.factRoles).flatMap((r) => r ?? []),
    ...Object.values(sel.independentReview.reviewers).flatMap((r) => r ?? []),
  ];
  for (const id of policyRoles) {
    if (!ids.has(id)) e.push(`selection-policy names '${id}', which is not registered`);
    else if (cfg.roles[id] === undefined) e.push(`selection-policy names '${id}', which has no ProjectOS configuration`);
  }
  for (const [name, p] of Object.entries(mod.preferences)) {
    if (!modelRefs.has(p.primary)) e.push(`model-policy ${name}.primary names an unknown model`);
    if (p.fallback !== null && !modelRefs.has(p.fallback)) e.push(`model-policy ${name}.fallback names an unknown model`);
  }
  const prefNames = new Set(Object.keys(mod.preferences));
  if (!prefNames.has(cfg.leader.modelPreference)) e.push('workforce-config leader.modelPreference is not in the model policy');
  for (const [id, r] of Object.entries(cfg.roles)) if (!prefNames.has(r.modelPreference)) e.push(`role '${id}' modelPreference is not in the model policy`);
  for (const t of TASK_TYPES) if (sel.taskTypes[t].maxTeam > cfg.bounds.maxTeamSize) e.push(`selection-policy ${t}.maxTeam exceeds bounds.maxTeamSize`);
  // REGISTRY ELIGIBILITY names only approved fixture models: live eligibility is an activation input.
  for (const entry of reg.entries) {
    for (const m of entry.eligibility.models) {
      if (!mod.models.some((x) => x.ref === m && x.approved && x.kind === 'fixture')) e.push(`registry entry '${entry.id}' is eligible on '${m}', which is not an approved fixture model`);
    }
  }
  return e;
}
