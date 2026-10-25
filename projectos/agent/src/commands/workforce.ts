/**
 * `projectos workforce <roster|team|check-update|acquire|evaluate>` — PROJECTOS-AGENT-WORKFORCE1A.
 *
 * Normal operation never needs this command: selection happens automatically when `projectos run`
 * advances an objective's phase. This is how the roster stays inspectable on request, how the owner
 * runs the one-time catalogue acquisition in his own terminal, and how a new upstream commit is
 * detected and reported (never imported).
 */
import type { CommandContext, CommandResult } from '../context.js';
import { fail, ok } from '../context.js';
import type { Flags } from '../flags.js';
import { loadGovernedContext, refusalLines } from '../governedContext.js';
import { acquireCatalogue, approvedCacheRoot, cachedInstructionSource } from '../workforce/acquisition.js';
import { sha256Hex } from '../workforce/canonical.js';
import { fixtureSpecialist } from '../workforce/engines.js';
import { evaluateRole } from '../workforce/evaluation.js';
import { WorkforceRefusal, WorkforceStore } from '../workforce/eventStore.js';
import { inspectGovernanceAtHead, loadWorkforceGovernance } from '../workforce/governance.js';
import { workforceStateRoot } from '../workforce/orchestrator.js';
import { projectLedger } from '../workforce/projection.js';
import { detectCatalogueChange, effectiveRole, findEntry, registryFiles } from '../workforce/registry.js';

const USAGE =
  'Use: workforce roster [--role <id>] [--candidate] | team | check-update --manifest <path> | acquire --source <path> [--cache <dir>] | evaluate --role <id> [--model <ref>] [--candidate]';

function str(flags: Flags, key: string): string {
  const v = flags[key];
  return typeof v === 'string' ? v : '';
}

export function workforce(ctx: CommandContext, flags: Flags, positionals: readonly string[]): CommandResult {
  switch (positionals[0]) {
    case 'roster':
      return roster(ctx, flags);
    case 'team':
      return team(ctx);
    case 'check-update':
      return checkUpdate(ctx, flags);
    case 'acquire':
      return acquire(ctx, flags);
    case 'evaluate':
      return evaluate(ctx, flags);
    default:
      return fail(1, [USAGE]);
  }
}

function governance(ctx: CommandContext, candidate: boolean) {
  return candidate ? inspectGovernanceAtHead(ctx.sys, ctx.root) : loadWorkforceGovernance(ctx.sys, ctx.root);
}

function roster(ctx: CommandContext, flags: Flags): CommandResult {
  const candidate = flags['candidate'] === true;
  const gov = governance(ctx, candidate);
  if (!gov.ok) return fail(2, ['REFUSED (WORKFORCE_GOVERNANCE):', ...gov.problems.map((p) => `  - ${p}`)]);
  const g = gov.value;
  const label = candidate ? 'AT HEAD — NOT OWNER-ACCEPTED, DISPLAY ONLY' : `owner-accepted at ${g.acceptedCommit.slice(0, 12)}`;
  const roleId = str(flags, 'role');
  if (roleId !== '') {
    const entry = findEntry(g.registry, roleId);
    if (entry === undefined) return fail(1, [`'${roleId}' is not registered`]);
    return ok([`Role ${roleId} (${label})`, JSON.stringify(effectiveRole(entry, g.config), (k, v) => (k === 'entry' ? undefined : v), 2)]);
  }
  const counts = new Map<string, number>();
  for (const e of g.registry.entries) counts.set(e.eligibility.status, (counts.get(e.eligibility.status) ?? 0) + 1);
  return ok([
    `Workforce roster (${label})`,
    `  catalogue: ${g.registry.catalogue.repository} @ ${g.registry.catalogue.commit.slice(0, 12)}, licence ${g.registry.catalogue.licence.spdx}`,
    `  registered: ${g.registry.entries.length} agents in ${g.registry.catalogue.divisionCount} divisions (catalogue ${g.registry.catalogue.catalogueDigest.slice(0, 16)}…)`,
    `  eligibility: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  configured roles: ${Object.keys(g.config.roles).length}; all others hold no tools, no scopes and no model`,
    `  selection policy ${g.selectionPolicy.policyVersion}, model policy ${g.modelPolicy.policyVersion} (live execution activated: ${String(g.modelPolicy.liveExecutionActivated)})`,
  ]);
}

function team(ctx: CommandContext): CommandResult {
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  if (!gc.ok) return fail(2, refusalLines(gc));
  const gov = loadWorkforceGovernance(ctx.sys, ctx.root);
  if (!gov.ok) return fail(2, ['REFUSED (WORKFORCE_GOVERNANCE):', ...gov.problems.map((p) => `  - ${p}`)]);
  const stateRoot = workforceStateRoot(ctx.sys, ctx.root);
  if (stateRoot === null) return fail(2, ['REFUSED: no installation state location outside the checkout is available on this machine']);
  try {
    const store = new WorkforceStore(ctx.sys, stateRoot, gov.value.projectId, gov.value.config.projection.maxEvents);
    const ledger = projectLedger(store.projectId, store.readVerified());
    if (ledger.leader === null) return ok([`No project leader exists for '${store.projectId}' yet.`]);
    return ok([
      `Project leader: ${ledger.leader.leaderId} generation ${ledger.leader.generation} (model ${ledger.leader.modelRef})`,
      `Objective: ${ledger.objective === null ? '-' : JSON.stringify(ledger.objective.slice(0, 200))}`,
      `Phase: ${ledger.currentPhase ?? '-'}   Candidate: ${ledger.candidate ?? '-'}`,
      `Active team (${ledger.activeSpecialists.length}):`,
      ...ledger.activeSpecialists.map((m) => `  - ${m.roleId} (${m.assignment}): ${m.reasons.join('; ')}`),
      `Completed assignments: ${ledger.completedAssignments.map((a) => `${a.roleId}/${a.taskId}`).join(', ') || '-'}`,
      `Open contradictions: ${ledger.openContradictions.map((c) => c.contradictionId).join(', ') || '-'}`,
      `Owner decisions required: ${ledger.ownerDecisionsRequired.length}`,
      `Next action: ${ledger.nextAction}`,
      `Ledger: ${ledger.eventCount} events, head ${ledger.headDigest ?? '-'}`,
    ]);
  } catch (e) {
    if (e instanceof WorkforceRefusal) return fail(2, [`REFUSED (${e.code}): ${e.reason}`]);
    throw e;
  }
}

function checkUpdate(ctx: CommandContext, flags: Flags): CommandResult {
  const path = str(flags, 'manifest');
  if (path === '') return fail(1, ['`workforce check-update` requires --manifest <path to a catalogue manifest: {commit, files:{path:sha256}}>']);
  const gov = loadWorkforceGovernance(ctx.sys, ctx.root);
  if (!gov.ok) return fail(2, ['REFUSED (WORKFORCE_GOVERNANCE):', ...gov.problems.map((p) => `  - ${p}`)]);
  let candidate: { commit?: unknown; files?: unknown };
  try {
    candidate = JSON.parse(ctx.sys.readText(path) ?? 'null') as { commit?: unknown; files?: unknown };
  } catch {
    return fail(1, [`${path} is not JSON`]);
  }
  if (candidate === null || typeof candidate.commit !== 'string' || typeof candidate.files !== 'object' || candidate.files === null || Array.isArray(candidate.files)) {
    return fail(1, [`${path} is not a catalogue manifest {commit, files}`]);
  }
  // Untrusted input, checked before anything is compared or printed.
  const entries = Object.entries(candidate.files as Record<string, unknown>);
  const malformed = entries.filter(([k, v]) => !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(k) || k.length > 300 || typeof v !== 'string' || !/^[0-9a-f]{64}$/.test(v));
  if (!/^[0-9a-f]{40}$/.test(candidate.commit) || entries.length > 10000 || malformed.length > 0) {
    return fail(1, [`${path} is not a catalogue manifest: the commit must be 40 hex, every file a plain relative path mapped to a sha256 (${malformed.length} malformed)`]);
  }
  const reg = gov.value.registry;
  const change = detectCatalogueChange({ commit: reg.catalogue.commit, files: registryFiles(reg.entries) }, { commit: candidate.commit, files: candidate.files as Record<string, string> });
  const list = (xs: readonly string[]): string => xs.map((x) => JSON.stringify(x)).join(', ') || '-';
  return ok([
    `Catalogue change ${change.fromCommit.slice(0, 12)} -> ${change.toCommit.slice(0, 12)} (DETECTED AND REPORTED ONLY — nothing reaches the registry)`,
    `  added ${change.added.length}: ${list(change.added)}`,
    `  changed ${change.changed.length}: ${list(change.changed)}`,
    `  removed ${change.removed.length}: ${list(change.removed)}`,
    `  unchanged ${change.unchanged}`,
    `  before any of it can be imported: ${change.requiredBeforeImport.join(' -> ')}`,
  ]);
}

function acquire(ctx: CommandContext, flags: Flags): CommandResult {
  const source = str(flags, 'source');
  if (source === '') return fail(1, ['`workforce acquire` requires --source <absolute path to the local pinned catalogue checkout>']);
  const gov = loadWorkforceGovernance(ctx.sys, ctx.root);
  if (!gov.ok) return fail(2, ['REFUSED (WORKFORCE_GOVERNANCE): the pin and registry must be owner-accepted first', ...gov.problems.map((p) => `  - ${p}`)]);
  const cacheRoot = str(flags, 'cache') || approvedCacheRoot(gov.value.config.catalogue);
  if (cacheRoot === null || cacheRoot === '') return fail(2, ['REFUSED: the approved cache location cannot be formed on this machine']);
  const norm = (x: string): string => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (norm(cacheRoot) === norm(ctx.root) || norm(cacheRoot).startsWith(`${norm(ctx.root)}/`)) {
    return fail(2, ['REFUSED: the quarantined cache must sit outside every repository write scope, never inside the governed checkout']);
  }
  const out = acquireCatalogue({ sys: ctx.sys, source, cacheRoot, pin: gov.value.config.catalogue, registry: gov.value.registry, now: ctx.sys.now() });
  if (!out.ok) return fail(2, ['REFUSED (ACQUISITION): nothing was written', ...out.problems.map((p) => `  - ${p}`)]);
  return ok([
    `Acquired ${out.provenance.agentCount} agents in ${out.provenance.divisionCount} divisions at ${out.provenance.commit}`,
    `  snapshot (read-only): ${out.snapshotDir}`,
    `  catalogue digest ${out.provenance.catalogueDigest}`,
    `  licence ${out.provenance.licence.spdx} preserved at ${out.provenance.licence.file}`,
  ]);
}

function evaluate(ctx: CommandContext, flags: Flags): CommandResult {
  const roleId = str(flags, 'role');
  if (roleId === '') return fail(1, ['`workforce evaluate` requires --role <id>']);
  const candidate = flags['candidate'] === true;
  const gov = governance(ctx, candidate);
  if (!gov.ok) return fail(2, ['REFUSED (WORKFORCE_GOVERNANCE):', ...gov.problems.map((p) => `  - ${p}`)]);
  const entry = findEntry(gov.value.registry, roleId);
  if (entry === undefined) return fail(1, [`'${roleId}' is not registered`]);
  const modelRef = str(flags, 'model') || gov.value.modelPolicy.models[0]?.ref || '';
  const root = approvedCacheRoot(gov.value.config.catalogue);
  const cached = root === null ? null : cachedInstructionSource(`${root}/${gov.value.config.catalogue.commit}`).read(entry);
  // HASH BEFORE USE, here as in dispatch: cached bytes that are not the registered bytes never reach an engine.
  if (cached !== null && cached.ok && sha256Hex(cached.bytes) !== entry.source.digest) {
    return fail(2, [`REFUSED (INSTRUCTION_INTEGRITY): the cached text for '${roleId}' is not its registered digest; it is not evaluated`]);
  }
  const text = cached !== null && cached.ok ? Buffer.from(cached.bytes).toString('utf8') : '(instruction text not acquired; the fixture pipeline does not depend on it)';
  const report = evaluateRole(effectiveRole(entry, gov.value.config), fixtureSpecialist(modelRef), text, gov.value.config);
  return ok([
    `Evaluation of ${roleId} on ${modelRef} (risk tier ${report.riskTier}) — FIXTURE ELIGIBILITY ONLY; a PROPOSAL, applied only through the owner's commit gate`,
    `  governance: ${candidate ? 'AT HEAD — NOT OWNER-ACCEPTED, DISPLAY ONLY' : `owner-accepted at ${gov.value.acceptedCommit.slice(0, 12)}`}`,
    ...report.checks.map((c) => `  ${c.passed ? 'PASS' : 'FAIL'} ${c.name} (${c.probes} probe(s)): ${c.detail}`),
    `  => ${report.status}${report.failedAt === null ? '' : ` (stopped at ${report.failedAt})`}`,
  ]);
}
