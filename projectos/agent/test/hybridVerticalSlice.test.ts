/**
 * HYBRID GATEKEEPER ROUTING — THE WORKING VERTICAL SLICE.
 *
 * One representative disposable project and phase, run through BOTH gatekeeper modes by the
 * production composition (`composeGatekeeper`, the function `projectos run` calls) and the canonical
 * loop (`runLoop`), against a real git worktree and a real local bare remote.
 *
 * WHAT IS REAL: the committed configuration that selects the mode, mode resolution, the loop, the stop,
 * the routing, the request and its id, the interactive port on disk and its bounded wait, the decision
 * contract, the committed delegation, the owner-only floor, the candidate identity, the evidence
 * record, the technical-continuation executor, and git.
 *
 * WHAT IS A FIXTURE, AND WHY: the worker (a process we do not spawn); the ChatGPT gatekeeper's answer in
 * interactive mode (written to the decision path, filled in as the handoff instructs, WHILE the run
 * holds the gate open — the port's own sleep hook is where that moment is); and ProjectOSHost + its
 * provider in unattended mode (a deterministic fake behind `HostReviewPort`). No provider is called, no
 * Host is started, nothing is spent.
 *
 * Created in PROJECTOS-HYBRID-GATEKEEPER-ROUTING1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  APPROVED_PILOT_POLICY,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  HOST_VERDICT_FOR,
  hostCorrelationFor,
  type GatekeeperVerdict,
  type HostReviewCall,
  type HostReviewOutcome,
  type HostReviewPort,
} from '@projectos/core';
import { runLoop } from '../src/loop/runner.js';
import { composeGatekeeper } from '../src/commands/run.js';
import { nodeInteractivePort } from '../src/loop/gatekeeperHandoff.js';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import { reviewing, withReviewer } from './support/fakeReviewer.js';
import type { System } from '../src/system.js';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'HYBRID-VERTICAL-SLICE1A';
const WORKER_KIND = 'test-worker';
const OWNER = 'Murad';
const DELEGATE = 'ChatGPT';
const PROGRAMME = 'hybrid-programme';
const BRANCH = 'work';
const NOW = '2026-09-10T12:00:00Z';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const INTERACTIVE_DIR = ['.projectops', 'gatekeeper-interactive'];
const RATE = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, cachedInputMicroUsdPerMillion: 125_000, outputMicroUsdPerMillion: 10_000_000 };

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function fixedClock(): System {
  return { ...nodeSystem, now: () => NOW };
}

type Mode = 'interactive' | 'unattended';

/** The ONLY difference between the two projects: what `.projectops/gatekeeper.json` commits. */
function gatekeeperConfig(mode: Mode, root: string): Record<string, unknown> {
  if (mode === 'interactive') return { schemaVersion: '1.0.0', mode: 'interactive' };
  return {
    schemaVersion: '1.0.0',
    enabled: true,
    mode: 'unattended',
    transport: {
      transportId: 'openai-primary',
      kind: 'openai-responses',
      model: 'gpt-5.6-terra',
      capabilities: ['submit-request', 'receive-decision'],
      credentialRef: REF,
      commercialApproval: true,
      decidedBy: DELEGATE,
    },
    modelPolicy: APPROVED_PILOT_POLICY,
    rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': { ...RATE, model: 'gpt-5.6-luna' } },
    budget: { initialCreditMicroUsd: 5_000_000, warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000, autoRecharge: false },
    budgetRaiseAuthorities: [],
    threadBinding: {
      schemaVersion: '1.0.0',
      projectId: 'hybrid',
      repositoryRoot: root,
      providerThreadId: 'resp_7f3a9c2e5b81d40a',
      transportId: 'openai-primary',
      createdAt: '2026-09-01T21:00:00Z',
    },
    programmeId: PROGRAMME,
  };
}

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/** The same governed project for both modes: config, plan, phase, delegation, validator, origin. */
function world(mode: Mode, over: { gatekeeper?: Record<string, unknown> | null } = {}): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-hybrid-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-hybrid-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'hybrid@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS Hybrid');

  const config = {
    schemaVersion: '1.0.0',
    projectId: 'hybrid',
    projectName: 'Hybrid',
    repo: normaliseRemote(origin),
    localPath: root,
    projectType: 'tooling',
    owner: OWNER,
    protectedBranches: ['main'],
    productionFreeze: true,
    installStatus: 'not-installed',
    approvalGates: ['owner-review'],
    validators: ['validate-all'],
    evidenceRequirements: ['evidence-pack'],
    planMemory: { planPath: 'state/plan.json', currentStatePath: 'state/current.json' },
    planSources: ['state/plan.json'],
    allowedActions: ['inspect-repository', 'create-local-files', 'run-local-validation'],
    forbiddenActions: ['production-deploy'],
    secretsPolicy: { allowSecretsInRepo: false, redactionRequired: true },
    execution: withReviewer({ workers: [{ workerId: 'test', kind: WORKER_KIND, command: '/usr/local/bin/test-worker' }] }, WORKER_KIND),
  };
  const realPlan = JSON.parse(
    readFileSync(new URL('../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const plan = {
    ...realPlan,
    projectId: 'hybrid',
    projectName: 'Hybrid',
    programmeId: PROGRAMME,
    planId: 'plan-hybrid',
    repository: {
      ...(realPlan['repository'] as Record<string, unknown>),
      repositoryPath: root,
      expectedRemote: normaliseRemote(origin),
      protectedBranches: ['main'],
      planSourceBranch: BRANCH,
    },
    phases: [
      {
        ...((realPlan['phases'] as Record<string, unknown>[])[0] as Record<string, unknown>),
        phaseId: PHASE,
        description: 'one representative phase, run through both gatekeeper modes',
        scope: '',
        dependsOn: [],
        requiredReviews: ['independent review'],
        requiredBrowserProof: false,
        requiredOwnerGates: ['secrets-handling', 'payment-or-live-charge'],
      },
    ],
    governance: { ...(realPlan['governance'] as Record<string, unknown>), owner: OWNER, gatekeeper: DELEGATE, closureAuthority: DELEGATE },
  } as Record<string, unknown>;
  delete (plan as { governance?: Record<string, unknown> }).governance?.['closureDelegation'];

  const delegation = {
    schemaVersion: '1.0.0',
    delegationId: 'HYBRID-DELEGATION1A',
    projectId: 'hybrid',
    programmeScope: PROGRAMME,
    delegatedBy: OWNER,
    delegatedTo: DELEGATE,
    delegatedScope: ['phase-closure', 'programme-closure', 'gatekeeper-review-decisions', 'technical-continuation'],
    delegationDate: '2026-09-10',
    excludesProtectedActions: true,
  };

  mkdirSync(join(root, 'projectos', 'validators'), { recursive: true });
  writeFileSync(join(root, 'projectos', 'validators', 'validate-all.cjs'), 'console.log("validate-all: fixture PASS");');
  mkdirSync(join(root, '.projectops', 'authority'), { recursive: true });
  mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.projectops', 'authority', 'closure-delegation.json'), JSON.stringify(delegation, null, 2));
  const gk = over.gatekeeper === undefined ? gatekeeperConfig(mode, root) : over.gatekeeper;
  if (gk !== null) writeFileSync(join(root, '.projectops', 'gatekeeper.json'), JSON.stringify(gk, null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: PHASE }, null, 2));
  writeFileSync(
    join(root, '.projectops', 'phases', `${PHASE}.json`),
    JSON.stringify({ schemaVersion: '1.0.0', phaseId: PHASE, status: 'implementing', objective: 'prove both modes', history: [] }, null, 2),
  );

  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim() };
}

/**
 * A worker that leaves the same candidate every time it runs, and spawns nothing. A second
 * `--execute` at the same commit REJOINS the session it already has; a worker whose work is done
 * leaves the same bytes.
 */
function worker(root: string, sessionOf: () => string): AdapterRegistry {
  const work = (): { kind: 'completed'; exitCode: number; stdout: string; stderr: string; providerRef: string } => {
    writeFileSync(join(root, 'delivered.txt'), 'the work\n');
    const session = sessionOf();
    mkdirSync(join(root, '.projectops', 'execution'), { recursive: true });
    writeFileSync(join(root, '.projectops', 'execution', `${session}.findings.json`), JSON.stringify({ reviews: [], findings: [] }));
    writeFileSync(
      join(root, '.projectops', 'execution', `${session}.effects.json`),
      JSON.stringify({
        productionTouched: false,
        deploymentOccurred: false,
        databaseMutationOccurred: false,
        externalSendOccurred: false,
        paymentOccurred: false,
        rawSecretStored: false,
      }),
    );
    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-1' };
  };
  const adapter: WorkerAdapter = { kind: WORKER_KIND, ...reviewing(), start: work, rejoin: work };
  return { [WORKER_KIND]: adapter } as unknown as AdapterRegistry;
}

/** ProjectOSHost and its independent provider, as a deterministic fake behind the real port. */
function fakeHost(allowedActions: readonly string[], opts: { unavailable?: boolean; verdict?: GatekeeperVerdict } = {}) {
  const calls: HostReviewCall[] = [];
  const port: HostReviewPort & { calls: HostReviewCall[] } = {
    calls,
    review(call): HostReviewOutcome {
      calls.push(call);
      if (opts.unavailable === true) {
        return { kind: 'unavailable', cause: 'PROVIDER_UNAVAILABLE', reasons: ['the independent provider did not answer'] };
      }
      const verdict = opts.verdict ?? 'APPROVED_TO_PROCEED';
      return {
        kind: 'attested',
        record: {
          schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
          decisionId: `GKDEC-${call.request.requestId}`,
          projectId: call.request.projectId,
          phaseId: call.request.phaseId,
          subjectCommit: call.request.subjectCommit,
          requestDigest: call.requestDigest,
          decision: verdict,
          reason: 'independently reviewed: checks pass, candidate reviewed',
          nextClaudeInstruction: 'carry out the approved technical continuation',
          allowedActions: [...allowedActions],
          forbiddenActions: ['production-deploy'],
          ownerApprovalRequired: false,
          decidedBy: DELEGATE,
          decidedAt: NOW,
        },
        attestation: {
          schemaVersion: 1,
          attestationId: 'e'.repeat(64),
          requestCorrelation: call.correlation,
          providerResponseId: 'resp_host_slice',
          provider: 'fake-independent-provider',
          model: 'fake-model',
          verdict: HOST_VERDICT_FOR[verdict],
          allowedActions: [...allowedActions],
          ownerApprovalRequired: false,
          costMicroUsd: 2500,
          attestedAtEpochS: 1_788_000_000,
        },
        usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100 },
      };
    },
  };
  return port;
}

/** The session id the loop derives, from its own dry run — so the worker names its records correctly. */
function sessionFor(sys: System, w: World, adapters: AdapterRegistry): string {
  const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
  return String((first as { sessionId?: string }).sessionId ?? '');
}

function interactiveFiles(w: World): string[] {
  const dir = join(w.root, ...INTERACTIVE_DIR);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** The newest question that has no answer yet — the one a waiting run is holding open. */
function pendingRequestId(w: World): string {
  const files = interactiveFiles(w);
  const pending = files
    .filter((f) => f.endsWith('.request.json'))
    .map((f) => f.slice(0, -'.request.json'.length))
    .filter((id) => !files.includes(`${id}.decision.json`));
  if (pending.length !== 1) throw new Error(`expected exactly one open question, found ${pending.length}`);
  return pending[0] as string;
}

/** The ChatGPT gatekeeper's answer, written where the handoff says, filled in as it instructs. */
function answerInteractively(w: World, fill: Record<string, unknown>, requestId: string = pendingRequestId(w)): string {
  const handoff = JSON.parse(readFileSync(join(w.root, ...INTERACTIVE_DIR, `${requestId}.request.json`), 'utf8')) as {
    decisionTemplate: Record<string, unknown>;
  };
  const decision = {
    ...handoff.decisionTemplate,
    decision: 'APPROVED_TO_PROCEED',
    reason: 'reviewed with the owner: checks pass, candidate reviewed',
    nextClaudeInstruction: 'carry out the approved technical continuation',
    allowedActions: ['commit', 'push'],
    forbiddenActions: ['production-deploy'],
    ownerApprovalRequired: false,
    decidedAt: NOW,
    ...fill,
  };
  writeFileSync(join(w.root, ...INTERACTIVE_DIR, `${requestId}.decision.json`), `${JSON.stringify(decision, null, 2)}\n`);
  return requestId;
}

/**
 * One `projectos run --execute`, composed exactly as the command composes it.
 *
 * `answer`, in interactive mode, is the ChatGPT gatekeeper answering WHILE the gate is held open: the
 * composed port is replaced by the same production port with the same wait, whose sleep hook is the
 * moment the owner saves the decision. Omitted, the gate is not held (`--gate-wait-minutes 0`).
 */
function runOnce(sys: System, w: World, adapters: AdapterRegistry, opts: { hostReview?: HostReviewPort; answer?: Record<string, unknown> } = {}) {
  const composed = composeGatekeeper({ sys, root: w.root }, { gateWaitMinutes: 0, ...(opts.hostReview === undefined ? {} : { hostReview: opts.hostReview }) });
  if (!composed.ok) throw new Error(`composition refused: ${composed.lines.join(' / ')}`);
  let answeredDuringWait = 0;
  let gatekeeper = composed.gatekeeper;
  if (gatekeeper !== undefined && gatekeeper.mode === 'interactive' && opts.answer !== undefined) {
    const fill = opts.answer;
    gatekeeper = {
      ...gatekeeper,
      interactive: nodeInteractivePort(sys, w.root, {
        waitMs: 60_000,
        pollMs: 1_000,
        sleep: () => {
          answeredDuringWait += 1;
          answerInteractively(w, fill);
        },
      }),
    };
  }
  const states: string[] = [];
  const r = runLoop(sys, w.root, {
    adapters,
    expectedDecider: composed.expectedDecider,
    ...(gatekeeper === undefined ? {} : { gatekeeper }),
    onWorkState: (p: { state: string }) => {
      states.push(p.state);
    },
    invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
  });
  if (!r.ok) throw new Error(`run refused: ${JSON.stringify(r)}`);
  return { composed, r, states, answeredDuringWait, finalState: states[states.length - 1] ?? '(none)', trace: r.lines.join('\n') };
}

function evidenceOf(w: World, requestId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(w.root, '.projectops', 'gatekeeper-decisions', `GKDEC-${requestId}.json`), 'utf8'));
}

function decidedIds(w: World): string[] {
  return interactiveFiles(w).filter((f) => f.endsWith('.decision.json')).map((f) => f.slice(0, -'.decision.json'.length));
}

function committedAndPushed(w: World): readonly string[] {
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  expect(head).not.toBe(w.head);
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(head);
  return git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort();
}

function unchanged(w: World): void {
  expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
}

/**
 * PROJECTOS-HOST-REVIEW-PATH1B, UNIT L — DECLARED AMENDMENT of this suite, UNATTENDED ROUTE ONLY.
 *
 * OLD (`unchanged`, used by both modes): a run whose review did not approve leaves HEAD at the base.
 * NEW (ratified technical-continuation amendment): on the unattended route a bounded local candidate
 * commit PRECEDES the independent review, so HEAD is that one local commit on the base - and still
 * NOTHING is published: origin names the base. The interactive route keeps the old invariant and every
 * interactive assertion here is unchanged.
 */
function recordedLocallyNotPublished(w: World): void {
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  expect(head).not.toBe(w.head);
  expect(git(w.root, 'rev-list', '--parents', '-n', '1', 'HEAD').trim()).toBe(`${head} ${w.head}`);
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
}

function started(sys: System, mode: Mode, over: { gatekeeper?: Record<string, unknown> | null } = {}) {
  const w = world(mode, over);
  let session = '';
  const adapters = worker(w.root, () => session);
  session = sessionFor(sys, w, adapters);
  return { w, adapters };
}

// -------------------------------------------------------------------------------------------------

describe('one project, one phase, both gatekeeper modes', () => {
  it('INTERACTIVE and UNATTENDED reach the same next state through the same machinery; only acquisition and provenance differ', () => {
    const sys = fixedClock();

    // --- INTERACTIVE: the gate is held open, the ChatGPT gatekeeper answers through the owner --------
    const { w: wi, adapters: ai } = started(sys, 'interactive');
    const interactive = runOnce(sys, wi, ai, { answer: {} });
    expect(interactive.composed.ok && interactive.composed.mode).toBe('interactive');
    // The wait was real: the question was on disk and unanswered when the run started waiting.
    expect(interactive.answeredDuringWait).toBe(1);
    expect(interactive.states).toContain('AWAITING_GATE');
    expect(interactive.finalState).toBe('COMPLETE');
    expect(interactive.r.stop).toBeNull();
    expect(interactive.trace).toContain('gatekeeper decision provenance: InteractiveGatekeeperDecision');
    const interactiveCommit = committedAndPushed(wi);
    expect(interactiveCommit).toContain('delivered.txt');
    const [requestId] = decidedIds(wi);
    const ie = evidenceOf(wi, String(requestId));
    expect(ie['provenance']).toBe('InteractiveGatekeeperDecision');
    expect(ie['hostAttestationId']).toBeUndefined();
    // Single use: the decision is spent.
    expect(interactiveFiles(wi)).toContain(`${requestId}.consumed.json`);

    // --- UNATTENDED: ProjectOSHost asks the independent provider and attests the answer --------------
    const { w: wu, adapters: au } = started(sys, 'unattended');
    const host = fakeHost(['commit', 'push']);
    const unattended = runOnce(sys, wu, au, { hostReview: host });
    expect(unattended.composed.ok && unattended.composed.mode).toBe('unattended');
    expect(unattended.states).toContain('AWAITING_GATE');
    expect(unattended.finalState).toBe('COMPLETE');
    expect(unattended.r.stop).toBeNull();
    expect(unattended.trace).toContain('gatekeeper decision provenance: HostIndependentProviderAttestation');
    const unattendedCommit = committedAndPushed(wu);
    expect(host.calls.length).toBe(1);
    const call = host.calls[0] as HostReviewCall;
    expect(call.correlation).toBe(hostCorrelationFor(call.request.requestId));
    const ue = evidenceOf(wu, call.request.requestId);
    expect(ue['provenance']).toBe('HostIndependentProviderAttestation');
    expect(ue['hostAttestationId']).toBe('e'.repeat(64));
    // No interactive question was ever written: there is no fallback between modes.
    expect(interactiveFiles(wu)).toEqual([]);

    // --- THE SAME PRODUCT -------------------------------------------------------------------------
    // Same phase, same next state, same committed boundary, same evidence schema: only the acquisition
    // path and the provenance stamp differ.
    expect(interactive.finalState).toBe(unattended.finalState);
    // Each project has its own commit and therefore its own derived session id; the SHAPE of what was
    // committed is what must match.
    const shape = (paths: readonly string[]) =>
      paths.map((p) => p.replace(/^(\.projectops\/execution\/).+?(\.[a-z]+\.json)$/, '$1<session>$2')).sort();
    expect(shape(interactiveCommit)).toEqual(shape(unattendedCommit));
    expect(call.request.phaseId).toBe(PHASE);
    expect(call.request.ask).toBe('evidence-review');
    const shared = (e: Record<string, unknown>) => Object.keys(e).filter((k) => k !== 'hostAttestationId').sort();
    expect(shared(ie)).toEqual(shared(ue));
    expect(ie['recordKind']).toBe(ue['recordKind']);
    expect(ie['phaseId']).toBe(ue['phaseId']);
  });
});

describe('the interactive records left outside the candidate are never committed', () => {
  it('a request-shaped file planted by the worker is neither reviewed nor carried into the autonomous commit', () => {
    const sys = fixedClock();
    const w = world('interactive');
    let session = '';
    const base = worker(w.root, () => session);
    // The worker also plants a file shaped exactly like an interactive record, with arbitrary content.
    // Shaped as a record for a request nobody asked, so the fixture's own "open question" lookup is not
    // confused by it.
    const planted = 'GKREQ-aaaaaaaaaaaaaaaaaaaaaaaa.consumed.json';
    const planting = (...args: Parameters<WorkerAdapter['start']>): ReturnType<WorkerAdapter['start']> => {
      mkdirSync(join(w.root, ...INTERACTIVE_DIR), { recursive: true });
      writeFileSync(join(w.root, ...INTERACTIVE_DIR, planted), '{"payload":"unreviewed bytes"}');
      const adapter = (base as unknown as Record<string, WorkerAdapter>)[WORKER_KIND] as WorkerAdapter;
      return adapter.start(...args);
    };
    const adapters = { [WORKER_KIND]: { kind: WORKER_KIND, ...reviewing(), start: planting, rejoin: planting } } as unknown as AdapterRegistry;
    session = sessionFor(sys, w, adapters);
    const run = runOnce(sys, w, adapters, { answer: {} });
    expect(run.finalState).toBe('COMPLETE');
    // The executor stages exactly the candidate's own path list, so an excluded path is never staged:
    // hidden from the digest AND from the commit, not carried past review.
    const committed = committedAndPushed(w);
    expect(committed).toContain('delivered.txt');
    expect(committed.some((p) => p.includes('gatekeeper-interactive'))).toBe(false);
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all')).toContain(planted);
  });
});

describe('fail-safe: nothing is decided that the mode cannot legitimately obtain', () => {
  it('UNATTENDED with no Host route (the production build today) WAITS — no provider call, no spend, no interactive fallback', () => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, 'unattended');
    const run = runOnce(sys, w, adapters);
    expect(run.states).toContain('WAITING_OWNER');
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain('no Host review route is composed');
    unchanged(w);
    expect(existsSync(join(w.root, '.projectops', 'gatekeeper-ledger.json'))).toBe(false);
    expect(interactiveFiles(w)).toEqual([]);
  });

  it('UNATTENDED with the provider unavailable WAITS, and never falls back to an interactive question', () => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, 'unattended');
    const host = fakeHost(['commit', 'push'], { unavailable: true });
    const run = runOnce(sys, w, adapters, { hostReview: host });
    expect(host.calls.length).toBe(1);
    expect(run.states).toContain('WAITING_OWNER');
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain('the gatekeeper could not be reached');
    recordedLocallyNotPublished(w); // PATH1B unit L: was `unchanged(w)` - see the helper.
    expect(interactiveFiles(w)).toEqual([]);
  });

  it('INTERACTIVE with no decision supplied WAITS and commits nothing; a late answer to that question never applies to a later run', () => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, 'interactive');
    const first = runOnce(sys, w, adapters);
    expect(first.states).toContain('WAITING_OWNER');
    expect(first.finalState).toBe('BLOCKED');
    expect(first.trace).toContain('WAITING FOR THE INTERACTIVE GATEKEEPER');
    unchanged(w);

    // The answer arrives after the asking run has ended. The next run is a new attempt with its own
    // evidence, so it asks a NEW question — and the stale answer, bound to the old one, is inert.
    const stale = answerInteractively(w, {});
    const second = runOnce(sys, w, adapters);
    expect(second.finalState).toBe('BLOCKED');
    expect(interactiveFiles(w).filter((f) => f.endsWith('.request.json')).length).toBe(2);
    expect(interactiveFiles(w)).not.toContain(`${stale}.consumed.json`);
    expect(existsSync(join(w.root, '.projectops', 'gatekeeper-decisions', `GKDEC-${stale}.json`))).toBe(false);
    unchanged(w);
  });

  it('the implementer cannot approve its own work in INTERACTIVE mode', () => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, 'interactive');
    const run = runOnce(sys, w, adapters, { answer: { decidedBy: 'Claude' } });
    expect(run.answeredDuringWait).toBe(1);
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain('who is not the recorded gatekeeper');
    expect(interactiveFiles(w).some((f) => f.endsWith('.consumed.json'))).toBe(false);
    unchanged(w);
  });

  it('an interactive decision cannot be relabelled as Host-attested evidence', () => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, 'interactive');
    const run = runOnce(sys, w, adapters, {
      answer: { hostAttestation: { attestationId: 'e'.repeat(64) }, provenance: 'HostIndependentProviderAttestation' },
    });
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain("carries 'provenance'");
    expect(run.trace).toContain("carries 'hostAttestation'");
    expect(existsSync(join(w.root, '.projectops', 'gatekeeper-decisions'))).toBe(false);
    unchanged(w);
  });

  it.each(['interactive', 'unattended'] as const)('an owner-protected action still stops for the owner in %s mode', (mode) => {
    const sys = fixedClock();
    const { w, adapters } = started(sys, mode);
    const grant = ['commit', 'push', 'payment-or-live-charge'];
    const run = mode === 'interactive' ? runOnce(sys, w, adapters, { answer: { allowedActions: grant } }) : runOnce(sys, w, adapters, { hostReview: fakeHost(grant) });
    expect(run.finalState).toBe('BLOCKED');
    expect(run.trace).toContain("decision grants 'payment-or-live-charge', which is an owner-only action");
    // PATH1B unit L: was `unchanged(w)` for both modes - see `recordedLocallyNotPublished`.
    if (mode === 'interactive') unchanged(w);
    else recordedLocallyNotPublished(w);
  });

  it('a configured gatekeeper that declares no mode is refused before anything starts — no silent choice', () => {
    const w = world('unattended', { gatekeeper: { schemaVersion: '1.0.0', enabled: true } });
    const composed = composeGatekeeper({ sys: fixedClock(), root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok).toBe(false);
    expect(JSON.stringify(composed)).toContain('GATEKEEPER_MODE_UNRESOLVED');
  });

  it('a project with no gatekeeper configuration is interactive by default', () => {
    const w = world('interactive', { gatekeeper: null });
    const composed = composeGatekeeper({ sys: fixedClock(), root: w.root }, { gateWaitMinutes: 0 });
    expect(composed.ok && composed.mode).toBe('interactive');
    expect(composed.ok && composed.gatekeeper?.mode).toBe('interactive');
  });
});
