/**
 * Specialist dispatch: the ONLY way work reaches a specialist, and the order it is checked in.
 *
 *   1. the project leader exists, is live, and the task's generation is the current one — checked
 *      BEFORE any context is assembled or any engine is invoked;
 *   2. the role is an active member of the team ProjectOS selected (the leader cannot widen it);
 *   3. no open contradiction blocks the task, and no specialist is re-asked for a different answer;
 *   4. a panel, if named, was declared and has rounds left;
 *   5. every requested tool and scope is inside the grant ProjectOS configuration gives the role;
 *   6. every requested protected action goes to the gate that owns it — and is refused;
 *   7. the context is assembled from leader notes and RECORDED results by digest, within the budget;
 *   8. the cumulative call and cost ceiling of this execution is checked (fails closed);
 *   9. the imported instruction text is hashed and compared with its registered digest;
 *  10. the text is framed with a fresh random marker and the fixture engine runs, attempts bounded;
 *  11. the result must validate against the contract, arrive under the current generation and stay
 *      inside the grant; anything else is FAILED, never defaulted or synthesised.
 *
 * Every step that decides anything writes its event here, at the point where it happens.
 */
import { canonicalJson, digestOf, sha256Hex } from './canonical.js';
import { TASK_SCHEMA, validateProposalShape, validateResult, type LeaderTaskProposal, type SpecialistResult, type TaskEnvelope } from './contracts.js';
import type { EngineOutput, SpecialistEngine } from './engines.js';
import { WorkforceRefusal, type WorkforceEvent, type WorkforceStore } from './eventStore.js';
import { frameInstruction } from './framing.js';
import { assertCurrentGeneration } from './leader.js';
import { resolveRoleModel } from './models.js';
import { classifyRequestedAction, requestProtectedAction } from './protectedActions.js';
import { effectiveRole, findEntry, type EffectiveRole } from './registry.js';
import type { TeamMember } from './teamSelection.js';
import { PROTECTED_FACTS, RISK_LEVELS, type RegistryEntry, type RiskFact, type RiskLevel, type WorkforceGovernance } from './types.js';

/** Where verified instruction bytes come from: the quarantined cache, or fixture texts in proofs. */
export interface InstructionSource {
  read(entry: RegistryEntry): { readonly ok: true; readonly bytes: Uint8Array } | { readonly ok: false; readonly reason: string };
}

export interface WorkforceRuntime {
  readonly store: WorkforceStore;
  readonly gov: WorkforceGovernance;
  /** Engines by the model they execute. Fixture engines only in this phase. */
  readonly engines: ReadonlyMap<string, SpecialistEngine>;
  readonly instructions: InstructionSource;
}

export type DispatchOutcome =
  | { readonly kind: 'recorded'; readonly taskId: string; readonly result: SpecialistResult; readonly resultDigest: string; readonly contradictions: readonly string[] }
  | { readonly kind: 'refused'; readonly taskId: string; readonly code: string; readonly reason: string; readonly stage: string }
  | { readonly kind: 'failed'; readonly taskId: string; readonly reason: string; readonly escalated: boolean; readonly attempts: number };

interface TeamState {
  readonly members: readonly TeamMember[];
  readonly riskLevel: RiskLevel;
  readonly riskFacts: readonly RiskFact[];
  readonly completedRoles: ReadonlySet<string>;
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The team the current generation selected, from the events alone. */
export function currentTeam(events: readonly WorkforceEvent[], generation: number): TeamState | null {
  let team: TeamState | null = null;
  const completed = new Set<string>();
  for (const e of events) {
    if (e.generation !== generation) continue;
    if (e.type === 'team-selected') {
      const p = e.payload;
      team = {
        members: arr(p['members']) as TeamMember[],
        riskLevel: s(p['riskLevel']) as RiskLevel,
        riskFacts: arr(p['riskFacts']) as RiskFact[],
        completedRoles: completed,
      };
      completed.clear();
    } else if (e.type === 'assignment-completed') completed.add(s(e.payload['roleId']));
  }
  return team;
}

/** At most this many contradictions one result may raise; a result raising more is rejected, not half-recorded. */
export const MAX_CONTRADICTIONS_PER_RESULT = 20;

/** Digests of the COMPLETED results the team's contributors recorded in this generation, in order. */
export function contributorResults(events: readonly WorkforceEvent[], generation: number, team: Pick<TeamState, 'members'>): string[] {
  const contributors = new Set(team.members.filter((m) => m.assignment === 'contribute').map((m) => m.roleId));
  return events
    .filter((e) => e.type === 'result-recorded' && e.generation === generation && e.payload['status'] === 'completed' && contributors.has(s(e.payload['roleId'])))
    .map((e) => s(e.payload['resultDigest']));
}

function scopeAllowed(requested: string, granted: readonly string[]): boolean {
  // Repository-relative, forward-slash paths only: no parent step, root, drive, UNC, backslash, home or NUL.
  if (requested.includes('..') || /^[/~]/.test(requested) || /^[A-Za-z]:/.test(requested) || /[\\\0]/.test(requested)) return false;
  return granted.some((g) => g === '**' || g === requested || (g.endsWith('/**') && (requested === g.slice(0, -3) || requested.startsWith(g.slice(0, -2)))));
}

/** Calls and cost units this execution has consumed, across every generation (the ceiling is cumulative). */
export function ceilingUsage(events: readonly WorkforceEvent[]): { readonly calls: number; readonly costUnits: number } {
  let calls = 0;
  let costUnits = 0;
  for (const e of events) {
    // A leader consultation is a model call too, and counts exactly like a specialist dispatch.
    if (e.type !== 'task-dispatched' && e.type !== 'leader-consulted') continue;
    calls += 1;
    costUnits += Number(e.payload['costUnits'] ?? 0);
  }
  return { calls, costUnits };
}

/**
 * Dispatch ONE leader-proposed task. The proposal is untrusted input: every field is checked here.
 */
export function dispatchSpecialistTask(rt: WorkforceRuntime, generation: number, proposal: unknown): DispatchOutcome {
  // Untrusted until the shape is validated, so it is bounded before it can reach an event.
  const taskId = s((proposal as Record<string, unknown> | null)?.['taskId']).slice(0, 80) || '<unnamed>';
  try {
    return rt.store.withLock(() => dispatchLocked(rt, generation, proposal, taskId));
  } catch (e) {
    if (e instanceof WorkforceRefusal) return { kind: 'refused', taskId, code: e.code, reason: e.reason, stage: 'store' };
    throw e;
  }
}

function refuseStage(rt: WorkforceRuntime, generation: number, taskId: string, roleId: string, stage: string, code: string, reason: string): DispatchOutcome {
  rt.store.append('dispatch-refused', generation, { taskId, roleId, stage, code, reason });
  return { kind: 'refused', taskId, code, reason, stage };
}

function dispatchLocked(rt: WorkforceRuntime, generation: number, proposal: unknown, taskId: string): DispatchOutcome {
  const now = rt.store.sys.now();
  // 1. THE LEADER GATE, FIRST. Nothing is assembled and no engine is touched before this passes.
  try {
    assertCurrentGeneration(rt.store, generation, now, rt.gov.config.leader.leaseBoundMs);
  } catch (e) {
    if (!(e instanceof WorkforceRefusal)) throw e;
    rt.store.append('dispatch-refused', 0, { taskId, stage: 'leader', code: e.code, reason: e.reason });
    return { kind: 'refused', taskId, code: e.code, reason: e.reason, stage: 'leader' };
  }
  const shape = validateProposalShape(proposal);
  if (shape.length > 0) return refuseStage(rt, generation, taskId, '', 'contract', 'PROPOSAL_INVALID', shape.join('; '));
  const p = proposal as LeaderTaskProposal;
  const events = rt.store.readVerified();

  // 2. TEAM MEMBERSHIP. Selection is ProjectOS's; a leader cannot add a member by naming one.
  const team = currentTeam(events, generation);
  const member = team?.members.find((m) => m.roleId === p.roleId);
  if (team === null || member === undefined) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'ROLE_NOT_ON_TEAM', `'${p.roleId}' is not on the team ProjectOS selected; the leader cannot widen the team`);
  }
  if (events.some((e) => e.type === 'task-dispatched' && e.payload['taskId'] === p.taskId)) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'TASK_ALREADY_DISPATCHED', `task '${p.taskId}' was already dispatched; results are never re-requested`);
  }

  // 3. CONTRADICTIONS. A party is never re-asked for a different answer; dependent work stops.
  //    An ESCALATED contradiction stays open: only a recorded resolution closes one, and the leader may
  //    not record one for an escalated contradiction.
  const views = contradictionViews(events);
  const openParty = views.open.find((c) => c.roles.includes(p.roleId));
  const reask = openParty ?? views.resolved.find((c) => c.roles.includes(p.roleId) && mentions(p, c.subject));
  if (reask !== undefined) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'contradiction', 'NO_REDISPATCH_FOR_A_DIFFERENT_ANSWER', `'${p.roleId}' is a party to contradiction ${reask.contradictionId} on '${reask.subject}'; a specialist is never re-asked for a different answer`);
  }
  const refs = p.inputs.flatMap((i) => (i.kind === 'result-ref' ? [i.resultDigest] : []));
  const blocked = views.open.find(
    (c) => c.blocksTasks.includes(p.taskId) || (p.dependsOn ?? []).some((d) => c.taskIds.includes(d)) || refs.some((r) => c.resultDigests.includes(r)),
  );
  if (blocked !== undefined) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'contradiction', 'BLOCKED_BY_CONTRADICTION', `contradiction ${blocked.contradictionId} on '${blocked.subject}' is open: dependent work and its results stop until a recorded decision`);
  }
  if (team.completedRoles.has(p.roleId)) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'ASSIGNMENT_COMPLETED', `'${p.roleId}' completed its bounded assignment and has left the active team`);
  }
  const unmet = (p.dependsOn ?? []).filter((d) => !events.some((e) => e.type === 'result-recorded' && e.payload['taskId'] === d && e.payload['status'] === 'completed'));
  if (unmet.length > 0) return refuseStage(rt, generation, p.taskId, p.roleId, 'dependency', 'DEPENDENCY_NOT_MET', `depends on ${unmet.join(', ')}, which has no completed result`);
  if ((p.dependsOn ?? []).length > 0) rt.store.append('dependency-declared', generation, { taskId: p.taskId, dependsOn: p.dependsOn ?? [] });

  // 4. PANELS: only a declared panel runs, and only up to its declared rounds.
  if (p.panelId !== undefined) {
    const panel = panelState(events, generation, p.panelId);
    if (panel === null) {
      rt.store.append('panel-refused', generation, { panelId: p.panelId, reason: 'undeclared panel' });
      return { kind: 'refused', taskId: p.taskId, code: 'PANEL_UNDECLARED', reason: `panel '${p.panelId}' was never declared`, stage: 'panel' };
    }
    if (!panel.participants.includes(p.roleId)) return refuseStage(rt, generation, p.taskId, p.roleId, 'panel', 'NOT_A_PANEL_PARTICIPANT', `'${p.roleId}' is not a declared participant`);
    const unit = rt.gov.config.ceilings.costUnits[effectiveRoleCost(rt, p.roleId)];
    if (panel.rounds >= panel.maxRounds || panel.costUnits + unit > panel.costBudgetUnits) {
      const why = panel.rounds >= panel.maxRounds ? `declared limit of ${panel.maxRounds} rounds reached` : `declared cost budget of ${panel.costBudgetUnits} units reached`;
      rt.store.append('panel-refused', generation, { panelId: p.panelId, reason: why });
      return { kind: 'refused', taskId: p.taskId, code: 'PANEL_LIMIT_REACHED', reason: `panel '${p.panelId}' stopped at its ${why}`, stage: 'panel' };
    }
  }

  // 4b. AN INDEPENDENT REVIEWER REVIEWS THE WHOLE WORK: it runs only once every contributor has finished,
  //     and its task must reference EVERY result they completed — a review of the low-risk half is not a review.
  if (member.assignment === 'independent-review') {
    const contributors = team.members.filter((m) => m.assignment === 'contribute').map((m) => m.roleId);
    const unfinished = contributors.filter((r) => !team.completedRoles.has(r));
    if (unfinished.length > 0) {
      return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'REVIEW_BEFORE_CONTRIBUTIONS_COMPLETE', `'${p.roleId}' reviews the finished work; ${unfinished.join(', ')} ha${unfinished.length === 1 ? 's' : 've'} not completed an assignment`);
    }
    const required = contributorResults(events, generation, team);
    const reviewed = required.filter((d) => refs.includes(d));
    if (reviewed.length === 0) {
      return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'REVIEW_TASK_NEEDS_A_SUBJECT', `'${p.roleId}' is the independent reviewer: its task must reference the contributors' recorded results, and it is never given implementation work`);
    }
    if (reviewed.length < required.length) {
      return refuseStage(rt, generation, p.taskId, p.roleId, 'team', 'REVIEW_MUST_COVER_ALL_RESULTS', `the review names ${reviewed.length} of the ${required.length} completed contributor result(s); it must be given every one`);
    }
  }

  // 5. THE GRANT: from ProjectOS configuration and the registry, never from the instruction text.
  const entry = findEntry(rt.gov.registry, p.roleId);
  if (entry === undefined) return refuseStage(rt, generation, p.taskId, p.roleId, 'grant', 'ROLE_NOT_REGISTERED', 'not registered');
  const role = effectiveRole(entry, rt.gov.config);
  const wantTools = p.requestedTools ?? [];
  const wantRead = p.requestedScopes?.read ?? [];
  const wantWrite = p.requestedScopes?.write ?? [];
  const outside = [
    ...wantTools.filter((t) => !role.tools.includes(t as never)).map((t) => `tool '${t}'`),
    ...wantRead.filter((r) => !scopeAllowed(r, role.readScopes)).map((r) => `read scope '${r}'`),
    ...wantWrite.filter((w) => !scopeAllowed(w, role.writeScopes)).map((w) => `write scope '${w}'`),
  ];
  if (outside.length > 0) return refuseStage(rt, generation, p.taskId, p.roleId, 'grant', 'OUTSIDE_GRANT', `requested outside the grant: ${outside.join(', ')}`);

  // 6. PROTECTED ACTIONS go to the gate that owns them.
  for (const a of p.requestedActions ?? []) {
    const cls = classifyRequestedAction(a);
    const verdict = requestProtectedAction({ actionClass: cls ?? 'gate-bypass', requestedBy: 'project-leader', at: now });
    rt.store.append('owner-decision-required', generation, { taskId: p.taskId, question: `protected action '${a}' was requested`, reason: `${verdict.gate}: ${verdict.reasons.join('; ')}` });
    return refuseStage(rt, generation, p.taskId, p.roleId, 'protected-action', 'PROTECTED_ACTION_REFUSED', `${verdict.gate}: ${verdict.reasons.join('; ')}`);
  }

  // 7. CONTEXT: leader notes, and recorded results by digest — no other channel exists.
  const inputs: TaskEnvelope['inputs'][number][] = [];
  for (const i of p.inputs) {
    if (i.kind === 'leader-note') inputs.push({ kind: 'leader-note', text: i.text });
    else {
      // THIS generation's results only: contradictions are detected within a generation, so an older
      // leader's result could be passed on here without ever having been checked against this team's.
      const rec = events.find((e) => e.type === 'result-recorded' && e.payload['resultDigest'] === i.resultDigest);
      if (rec === undefined) return refuseStage(rt, generation, p.taskId, p.roleId, 'context', 'UNKNOWN_RESULT_REF', `no recorded result has digest ${i.resultDigest}`);
      if (rec.generation !== generation) {
        return refuseStage(rt, generation, p.taskId, p.roleId, 'context', 'RESULT_FROM_ANOTHER_GENERATION', `result ${i.resultDigest.slice(0, 19)}… was recorded under leader generation ${rec.generation}, not ${generation}`);
      }
      inputs.push({ kind: 'result', resultDigest: i.resultDigest, summary: s(rec.payload['summary']) });
    }
  }
  const envelope: TaskEnvelope = {
    schema: TASK_SCHEMA,
    taskId: p.taskId,
    projectId: rt.store.projectId,
    generation,
    roleId: role.id,
    roleVersion: role.version,
    modelRef: member.modelRef,
    objective: p.objective,
    inputs,
    // LEAST PRIVILEGE PER TASK: exactly what this task asked for and the role may hold — not the role's whole grant.
    grant: { tools: wantTools, readScopes: wantRead, writeScopes: wantWrite },
    facts: { riskLevel: team.riskLevel, riskFacts: team.riskFacts },
  };
  const contextBytes = Buffer.byteLength(canonicalJson(envelope), 'utf8');
  const panelBudget = p.panelId === undefined ? Infinity : (panelState(events, generation, p.panelId)?.contextBudgetBytes ?? 0);
  const contextBound = Math.min(rt.gov.config.bounds.maxContextBytes, panelBudget);
  if (contextBytes > contextBound) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'context', 'CONTEXT_BUDGET_EXCEEDED', `${contextBytes} bytes exceeds the bound of ${contextBound}`);
  }
  if (RISK_LEVELS.indexOf(team.riskLevel) > RISK_LEVELS.indexOf(rt.gov.config.bounds.maxCriticality)) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'bounds', 'CRITICALITY_ABOVE_BOUND', 'the task criticality exceeds the workforce bound');
  }

  // 8-9. MODEL, INSTRUCTION INTEGRITY. Eligibility is re-checked here, independent of the leader.
  const model = resolveRoleModel(role, rt.gov.modelPolicy);
  if (!model.ok || model.modelRef !== member.modelRef) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'model', model.ok ? 'MODEL_CHANGED' : model.code, model.ok ? 'the selected model no longer resolves' : model.reason);
  }
  const text = rt.instructions.read(entry);
  if (!text.ok) return refuseStage(rt, generation, p.taskId, p.roleId, 'instruction', 'INSTRUCTION_UNAVAILABLE', text.reason);
  const actual = sha256Hex(text.bytes);
  if (actual !== entry.source.digest) {
    return refuseStage(rt, generation, p.taskId, p.roleId, 'instruction', 'INSTRUCTION_INTEGRITY', `the instruction text hashes to ${actual.slice(0, 16)}…, not its registered digest ${entry.source.digest.slice(0, 16)}…; '${p.roleId}' is refused`);
  }
  const framed = frameInstruction(role.id, Buffer.from(text.bytes).toString('utf8'));

  const taskDigest = digestOf(envelope);
  rt.store.append('grant-issued', generation, { taskId: p.taskId, roleId: role.id, grant: envelope.grant, taskDigest, panelId: p.panelId ?? null, inputResults: refs });
  return runAttempts(rt, generation, role, envelope, framed.frame, taskDigest, p.panelId ?? null);
}

function runAttempts(rt: WorkforceRuntime, generation: number, role: EffectiveRole, envelope0: TaskEnvelope, frame: string, taskDigest: string, panelId: string | null): DispatchOutcome {
  const cfg = rt.gov.config;
  let envelope = envelope0;
  let substitutedFrom: string | null = null;
  const failures: string[] = [];
  for (let attempt = 1; attempt <= cfg.retries.maxAttemptsPerTask; attempt += 1) {
    // 8. THE CEILING, before EVERY dispatch — retries count against it.
    const events = rt.store.readVerified();
    const used = ceilingUsage(events);
    const unit = cfg.ceilings.costUnits[role.costClass];
    if (used.calls + 1 > cfg.ceilings.maxCallsPerExecution || used.costUnits + unit > cfg.ceilings.maxCostUnitsPerExecution) {
      failures.push(`ceiling reached (${used.calls} calls, ${used.costUnits} cost units used)`);
      rt.store.append('dispatch-refused', generation, { taskId: envelope.taskId, roleId: role.id, stage: 'ceiling', code: 'CEILING_REACHED', reason: failures[failures.length - 1] ?? '' });
      break;
    }
    // AND A PANEL'S DECLARED BUDGET, before every attempt too: a retry or a fallback spends it like a first attempt.
    if (panelId !== null) {
      const panel = panelState(events, generation, panelId);
      if (panel === null || panel.costUnits + unit > panel.costBudgetUnits) {
        failures.push(`panel '${panelId}' reached its declared cost budget`);
        rt.store.append('panel-refused', generation, { panelId, reason: failures[failures.length - 1] ?? '' });
        break;
      }
    }
    rt.store.append('task-dispatched', generation, { taskId: envelope.taskId, roleId: role.id, modelRef: envelope.modelRef, attempt, taskDigest, costUnits: unit, panelId });
    const engine = rt.engines.get(envelope.modelRef);
    const started = Date.now();
    const out: EngineOutput = engine === undefined ? { kind: 'unavailable' } : engine.execute({ frame, task: envelope, substitutedFrom }, { latencyMs: cfg.bounds.maxLatencyMs });
    const elapsed = Date.now() - started;
    if (out.kind === 'unavailable') {
      // STATIC SUBSTITUTION from the owner-approved model policy — never a routing choice.
      const fb = substitutedFrom === null ? resolveRoleModel(role, rt.gov.modelPolicy, true) : null;
      if (fb === null || !fb.ok) {
        failures.push(`engine unavailable and ${fb === null ? 'the fallback was already used' : `fallback refused (${fb.code}: ${fb.reason})`}`);
        continue;
      }
      rt.store.append('fallback-applied', generation, { taskId: envelope.taskId, roleId: role.id, from: envelope.modelRef, to: fb.modelRef });
      substitutedFrom = envelope.modelRef;
      envelope = { ...envelope, modelRef: fb.modelRef };
      continue;
    }
    if (out.kind === 'timeout' || elapsed > cfg.bounds.maxLatencyMs) {
      failures.push(`attempt ${attempt}: timed out`);
      continue;
    }
    if (out.kind === 'failure') {
      failures.push(`attempt ${attempt}: engine failure (${out.reason})`);
      continue;
    }
    const accepted = acceptResult(rt, generation, envelope, out.value, substitutedFrom, panelId, engine === undefined ? null : { engineId: engine.engineId, provider: engine.provider });
    if (accepted.kind === 'recorded') return accepted;
    failures.push(`attempt ${attempt}: ${accepted.reason}`);
    if (accepted.kind === 'refused' && accepted.code === 'GENERATION_VOID') return accepted;
  }
  return failTask(rt, generation, role.id, envelope, failures);
}

/**
 * A result ARRIVING for a task. Checked against the current generation first, then the contract, then
 * the grant. A result that fails any check is rejected and recorded — never repaired or defaulted.
 */
export function acceptResult(
  rt: WorkforceRuntime,
  generation: number,
  envelope: TaskEnvelope,
  value: unknown,
  substitutedFrom: string | null,
  panelId: string | null,
  /** The engine ProjectOS actually dispatched to, recorded beside the provenance the engine CLAIMS. */
  dispatchedEngine: { readonly engineId: string; readonly provider: string } | null = null,
): DispatchOutcome {
  try {
    assertCurrentGeneration(rt.store, envelope.generation, rt.store.sys.now(), rt.gov.config.leader.leaseBoundMs);
  } catch (e) {
    if (!(e instanceof WorkforceRefusal)) throw e;
    rt.store.append('result-rejected', generation, { taskId: envelope.taskId, roleId: envelope.roleId, code: e.code, reason: e.reason });
    return { kind: 'refused', taskId: envelope.taskId, code: e.code, reason: e.reason, stage: 'arrival' };
  }
  const problems = validateResult(value, {
    taskId: envelope.taskId,
    roleId: envelope.roleId,
    version: envelope.roleVersion,
    modelRef: envelope.modelRef,
    substitutedFrom,
  });
  const r = value as SpecialistResult;
  if (problems.length === 0 && envelope.grant.writeScopes.length === 0 && r.affectedFiles.length > 0) {
    problems.push(`the result claims to have changed ${r.affectedFiles.length} file(s), but the grant holds no write scope`);
  }
  if (problems.length === 0 && (r.status === 'partial' || r.status === 'failed')) problems.push(`the specialist reported status '${r.status}', which is never treated as success`);
  const resultDigest = problems.length === 0 ? digestOf(r) : '';
  // Counted BEFORE anything is recorded: a result that would raise more contradictions than the bound
  // is rejected whole, never recorded with some of its disagreements silently dropped.
  const contradictions = problems.length === 0 ? findContradictions(rt.store.readVerified(), generation, r, resultDigest) : [];
  if (contradictions.length > MAX_CONTRADICTIONS_PER_RESULT) {
    problems.push(`the result would raise ${contradictions.length} contradictions; the bound is ${MAX_CONTRADICTIONS_PER_RESULT}`);
  }
  if (problems.length > 0) {
    rt.store.append('result-rejected', generation, { taskId: envelope.taskId, roleId: envelope.roleId, code: 'RESULT_INVALID', reason: problems.join('; ') });
    return { kind: 'failed', taskId: envelope.taskId, reason: `result rejected: ${problems.join('; ')}`, escalated: false, attempts: 1 };
  }
  rt.store.append('result-recorded', generation, {
    taskId: r.taskId,
    roleId: r.agent.roleId,
    resultDigest,
    status: r.status,
    provenance: r.provenance,
    dispatchedEngine,
    summary: r.summary,
    findings: r.findings,
    risks: r.risks,
    blockers: r.blockers,
    evidenceRefs: r.evidenceRefs,
    decisionRequired: r.decisionRequired,
    panelId,
  });
  for (const c of contradictions) rt.store.append('contradiction-recorded', generation, c);
  rt.store.append('assignment-completed', generation, { roleId: r.agent.roleId, taskId: r.taskId, outcome: r.status });
  return { kind: 'recorded', taskId: r.taskId, result: r, resultDigest, contradictions: contradictions.map((c) => String(c['contradictionId'])) };
}

function failTask(rt: WorkforceRuntime, generation: number, roleId: string, envelope: TaskEnvelope, failures: readonly string[]): DispatchOutcome {
  const reason = failures.join('; ') || 'no attempt produced a valid result';
  rt.store.append('task-failed', generation, { taskId: envelope.taskId, roleId, reason, attempts: failures.length });
  const protectedFacts = envelope.facts.riskFacts.filter((f) => PROTECTED_FACTS.includes(f));
  if (protectedFacts.length > 0) {
    rt.store.append('task-escalated', generation, {
      taskId: envelope.taskId,
      roleId,
      facts: protectedFacts,
      reason: `a task carrying ${protectedFacts.join(', ')} cannot proceed on a failed specialist result`,
    });
  }
  rt.store.append('assignment-completed', generation, { roleId, taskId: envelope.taskId, outcome: 'failed' });
  return { kind: 'failed', taskId: envelope.taskId, reason, escalated: protectedFacts.length > 0, attempts: failures.length };
}

// ---- contradictions ------------------------------------------------------------------------------

export interface ContradictionView {
  readonly contradictionId: string;
  readonly subject: string;
  readonly roles: readonly string[];
  readonly taskIds: readonly string[];
  readonly resultDigests: readonly string[];
  readonly blocksTasks: readonly string[];
  readonly escalated: boolean;
}

/**
 * Open and resolved contradictions. ONLY a recorded resolution closes one: an escalation hands it to
 * the owner and leaves it open — and blocking — until the owner's decision is recorded.
 */
export function contradictionViews(events: readonly WorkforceEvent[]): { open: ContradictionView[]; resolved: ContradictionView[] } {
  const all = new Map<string, ContradictionView>();
  const closed = new Set<string>();
  const escalated = new Set<string>();
  for (const e of events) {
    if (e.type === 'contradiction-recorded') {
      const results = arr(e.payload['results']) as { roleId?: unknown; taskId?: unknown; resultDigest?: unknown }[];
      all.set(s(e.payload['contradictionId']), {
        contradictionId: s(e.payload['contradictionId']),
        subject: s(e.payload['subject']),
        roles: results.map((r) => s(r.roleId)),
        taskIds: results.map((r) => s(r.taskId)),
        resultDigests: results.map((r) => s(r.resultDigest)),
        blocksTasks: arr(e.payload['blocksTasks']).map(s),
        escalated: false,
      });
    } else if (e.type === 'contradiction-resolved') closed.add(s(e.payload['contradictionId']));
    else if (e.type === 'contradiction-escalated') escalated.add(s(e.payload['contradictionId']));
  }
  for (const [id, c] of all) if (escalated.has(id)) all.set(id, { ...c, escalated: true });
  const open: ContradictionView[] = [];
  const resolved: ContradictionView[] = [];
  for (const c of all.values()) (closed.has(c.contradictionId) ? resolved : open).push(c);
  return { open, resolved };
}

export const openContradictions = (events: readonly WorkforceEvent[]): ContradictionView[] => contradictionViews(events).open;

function mentions(p: LeaderTaskProposal, subject: string): boolean {
  const text = [p.objective, ...p.inputs.map((i) => (i.kind === 'leader-note' ? i.text : ''))].join('\n');
  return subject.length > 0 && text.includes(subject);
}

/**
 * Every disagreement between this result and earlier ones in the generation, SIDE BY SIDE; overwrites
 * nothing. Pure: the caller records them. One per (subject, earlier result), and never one already recorded.
 */
function findContradictions(events: readonly WorkforceEvent[], generation: number, r: SpecialistResult, resultDigest: string): Record<string, unknown>[] {
  const known = new Set(events.filter((e) => e.type === 'contradiction-recorded').map((e) => s(e.payload['contradictionId'])));
  const out: Record<string, unknown>[] = [];
  for (const f of r.findings) {
    if (f.verdict === 'concern') continue;
    for (const e of events) {
      if (e.type !== 'result-recorded' || e.generation !== generation || e.payload['taskId'] === r.taskId) continue;
      const other = (arr(e.payload['findings']) as { subject?: unknown; verdict?: unknown; severity?: unknown }[]).find(
        (g) => s(g.subject) === f.subject && (s(g.verdict) === 'pass' || s(g.verdict) === 'fail') && s(g.verdict) !== f.verdict,
      );
      if (other === undefined) continue;
      const contradictionId = `C-${digestOf({ subject: f.subject, a: e.payload['resultDigest'], b: resultDigest }).slice(7, 19)}`;
      if (known.has(contradictionId)) continue;
      known.add(contradictionId);
      const dependents = events
        .filter((d) => d.type === 'dependency-declared' && arr(d.payload['dependsOn']).some((x) => x === r.taskId || x === e.payload['taskId']))
        .map((d) => s(d.payload['taskId']));
      out.push({
        contradictionId,
        subject: f.subject,
        results: [
          { taskId: s(e.payload['taskId']), roleId: s(e.payload['roleId']), verdict: s(other.verdict), severity: s(other.severity), resultDigest: s(e.payload['resultDigest']) },
          { taskId: r.taskId, roleId: r.agent.roleId, verdict: f.verdict, severity: f.severity, resultDigest },
        ],
        blocksTasks: [...new Set(dependents)],
      });
    }
  }
  return out;
}

// ---- panels ----------------------------------------------------------------------------------------

interface PanelState {
  participants: string[];
  maxRounds: number;
  costBudgetUnits: number;
  contextBudgetBytes: number;
  rounds: number;
  costUnits: number;
}

/** A panel as declared this generation, with the rounds and cost it has used. Declared once only (`declarePanel`). */
export function panelState(events: readonly WorkforceEvent[], generation: number, panelId: string): PanelState | null {
  let panel: PanelState | null = null;
  for (const e of events) {
    if (e.generation !== generation) continue;
    if (e.type === 'panel-declared') {
      const d = e.payload['panel'] as Record<string, unknown>;
      if (s(d['panelId']) === panelId && panel === null) {
        panel = {
          participants: arr(d['participants']).map(s),
          maxRounds: Number(d['maxRounds']),
          costBudgetUnits: Number(d['costBudgetUnits']),
          contextBudgetBytes: Number(d['contextBudgetBytes']),
          rounds: 0,
          costUnits: 0,
        };
      }
    } else if (e.type === 'task-dispatched' && e.payload['panelId'] === panelId && panel !== null) {
      panel.costUnits += Number(e.payload['costUnits'] ?? 0);
      if (e.payload['attempt'] === 1) panel.rounds += 1;
    }
  }
  return panel;
}

function effectiveRoleCost(rt: WorkforceRuntime, roleId: string): 'low' | 'standard' | 'high' {
  const entry = findEntry(rt.gov.registry, roleId);
  return entry === undefined ? 'high' : effectiveRole(entry, rt.gov.config).costClass;
}
