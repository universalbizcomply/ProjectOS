/**
 * THE HYBRID VERTICAL-SLICE WORLD, as a reusable harness.
 *
 * DERIVED, NOT REDESIGNED: this is the fixture section of `hybridVerticalSlice.test.ts`, exported so
 * PROJECTOS-HOST-REVIEW-PATH1A can drive the SAME governed world, the SAME production composition and
 * the SAME canonical loop with the production Host review client in place of that file's fake port.
 * The accepted suite is left byte for byte as it was, which is why this is a copy and not a refactor.
 */
import { expect, afterEach } from 'vitest';
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
import { runLoop } from '../../src/loop/runner.js';
import { composeGatekeeper } from '../../src/commands/run.js';
import { nodeInteractivePort } from '../../src/loop/gatekeeperHandoff.js';
import { nodeSystem, resolveBoundGit } from '../../src/system.js';
import { normaliseRemote } from '../../src/loop/observation.js';
import type { AdapterRegistry, WorkerAdapter } from '../../src/loop/workers.js';
import type { System } from '../../src/system.js';
import { reviewing, withReviewer } from './fakeReviewer.js';

export const GIT = resolveBoundGit(process.env) as string;
export const PHASE = 'HYBRID-VERTICAL-SLICE1A';
export const WORKER_KIND = 'test-worker';
export const OWNER = 'Murad';
export const DELEGATE = 'ChatGPT';
export const PROGRAMME = 'hybrid-programme';
export const BRANCH = 'work';
export const NOW = '2026-09-10T12:00:00Z';
export const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
export const INTERACTIVE_DIR = ['.projectops', 'gatekeeper-interactive'];
export const RATE = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, cachedInputMicroUsdPerMillion: 125_000, outputMicroUsdPerMillion: 10_000_000 };

export const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

export function fixedClock(): System {
  return { ...nodeSystem, now: () => NOW };
}

export type Mode = 'interactive' | 'unattended';

/** The ONLY difference between the two projects: what `.projectops/gatekeeper.json` commits. */
export function gatekeeperConfig(mode: Mode, root: string): Record<string, unknown> {
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
    budget: { initialCreditMicroUsd: 5_000_000, warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000, phaseHardStopAtMicroUsd: 5_000_000, dayHardStopAtMicroUsd: 5_000_000, autoRecharge: false },
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

export interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/** The same governed project for both modes: config, plan, phase, delegation, validator, origin. */
export function world(mode: Mode, over: { gatekeeper?: Record<string, unknown> | null } = {}): World {
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
    readFileSync(new URL('../../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
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
export function worker(root: string, sessionOf: () => string): AdapterRegistry {
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
export function fakeHost(allowedActions: readonly string[], opts: { unavailable?: boolean; verdict?: GatekeeperVerdict } = {}) {
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
export function sessionFor(sys: System, w: World, adapters: AdapterRegistry): string {
  const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
  return String((first as { sessionId?: string }).sessionId ?? '');
}

export function interactiveFiles(w: World): string[] {
  const dir = join(w.root, ...INTERACTIVE_DIR);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

/** The newest question that has no answer yet — the one a waiting run is holding open. */
export function pendingRequestId(w: World): string {
  const files = interactiveFiles(w);
  const pending = files
    .filter((f) => f.endsWith('.request.json'))
    .map((f) => f.slice(0, -'.request.json'.length))
    .filter((id) => !files.includes(`${id}.decision.json`));
  if (pending.length !== 1) throw new Error(`expected exactly one open question, found ${pending.length}`);
  return pending[0] as string;
}

/** The ChatGPT gatekeeper's answer, written where the handoff says, filled in as it instructs. */
export function answerInteractively(w: World, fill: Record<string, unknown>, requestId: string = pendingRequestId(w)): string {
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
export function runOnce(sys: System, w: World, adapters: AdapterRegistry, opts: { hostReview?: HostReviewPort; answer?: Record<string, unknown> } = {}) {
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

export function evidenceOf(w: World, requestId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(w.root, '.projectops', 'gatekeeper-decisions', `GKDEC-${requestId}.json`), 'utf8'));
}

export function decidedIds(w: World): string[] {
  return interactiveFiles(w).filter((f) => f.endsWith('.decision.json')).map((f) => f.slice(0, -'.decision.json'.length));
}

export function committedAndPushed(w: World): readonly string[] {
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  expect(head).not.toBe(w.head);
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(head);
  return git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort();
}

export function unchanged(w: World): void {
  expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
}

/**
 * PROJECTOS-HOST-REVIEW-PATH1B, UNIT L — the UNATTENDED route's invariant when a review did not approve.
 *
 * OLD (`unchanged`): HEAD is still the base. NEW (ratified technical-continuation amendment): the
 * candidate was recorded as ONE local commit on the base BEFORE the review was asked, and NOTHING was
 * published — origin still names the base. Returns that local candidate commit.
 */
export function recordedLocallyNotPublished(w: World): string {
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  expect(head).not.toBe(w.head);
  expect(git(w.root, 'rev-list', '--parents', '-n', '1', 'HEAD').trim()).toBe(`${head} ${w.head}`);
  expect(git(w.root, 'log', '-1', '--format=%B', 'HEAD')).toContain('ProjectOS-Local-Candidate:');
  expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
  return head;
}

export function started(sys: System, mode: Mode, over: { gatekeeper?: Record<string, unknown> | null } = {}) {
  const w = world(mode, over);
  let session = '';
  const adapters = worker(w.root, () => session);
  session = sessionFor(sys, w, adapters);
  return { w, adapters };
}
