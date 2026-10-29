/**
 * THE HYBRID CLOSURE AND RECONCILE WORLDS, as a reusable harness.
 *
 * DERIVED, NOT REDESIGNED: the fixture sections of `hybridClosureReconcile.test.ts`, exported so
 * PROJECTOS-HOST-REVIEW-PATH1A can drive the SAME governed worlds through the production closure and
 * reconcile commands with the production Host review client. The accepted suite is untouched.
 */
import { expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  APPROVED_PILOT_POLICY,
  CLOSURE_DECISION_SCHEMA_VERSION,
  DEGRADED_MODE_CHOICE,
  DEGRADED_MODE_SCHEMA_VERSION,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  HOST_VERDICT_FOR,
  HOST_VERDICT_FOR_CLOSURE,
  PHASE_CLOSURE_SCOPE,
  type HostClosureReviewCall,
  type HostClosureReviewOutcome,
  type HostClosureReviewPort,
  type HostReviewCall,
  type HostReviewOutcome,
  type HostReviewPort,
} from '@projectos/core';
import { closure, closureRequest, type MakeClosureDeps } from '../../src/commands/closure.js';
import { phase as phaseCommand } from '../../src/commands/phase.js';
import { reconcile } from '../../src/commands/reconcile.js';
import { CLOSURE_INTERACTIVE_REL, GATEKEEPER_INTERACTIVE_REL, nodeInteractivePort } from '../../src/loop/gatekeeperHandoff.js';
import { readClosureWait } from '../../src/closureWait.js';
import { degradedGrantRelPath } from '../../src/loop/degradedModeGrants.js';
import { degradedStoreRelPath } from '../../src/loop/degradedMode.js';
import { canonicalRepositoryIdentity } from '../../src/installation/projectAllowlist.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../../src/nodeRuntimeRoot.js';
import { unprovisionedResolver } from '../../src/loop/credentialResolver.js';
import { nodeSystem, resolveBoundGit } from '../../src/system.js';
import { normaliseRemote } from '../../src/loop/observation.js';
import type { CommandContext } from '../../src/context.js';
import type { System } from '../../src/system.js';
import { writeCleanRunEvidence } from './runEvidence.js';

export const GIT = resolveBoundGit(process.env) as string;
export const PHASE = 'HYBRID-CLOSURE-RECONCILE1A';
// The fixture keeps the 'projectos' id (see closureEndToEnd); G4-1 accepts any governed project.
export const PROJECT = 'projectos';
export const OWNER = 'Murad';
export const DELEGATE = 'ChatGPT';
export const PROGRAMME = 'hybrid-closure-programme';
export const BRANCH = 'work';
export const NOW = '2026-09-10T20:00:00Z';
export const ORIGIN_URL = 'https://github.com/acme/hybrid-closure.git';
export const PUSH_REMOTE = 'local';
export const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
export const GRANT = 'DEGRADED-HYBRID-FIXTURE1A';
export const WORK = 'GKWORK-000000000000aaaa';
export const OUTAGE = 'GKOUT-c1869b6abf8e873aa88abb8c';
export const RATE = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, cachedInputMicroUsdPerMillion: 125_000, outputMicroUsdPerMillion: 10_000_000 };

export type Mode = 'interactive' | 'unattended';

export const made: string[] = [];
export let savedLocalAppData: string | undefined;
beforeEach(() => {
  // THE INSTALLATION STATE LIVES IN A DISPOSABLE DIRECTORY. `nodeInstallationStateDir` has no override
  // by design; pointing its base at a temporary directory is how a test keeps off real machine state.
  savedLocalAppData = process.env['LOCALAPPDATA'];
  const base = mkdtempSync(join(tmpdir(), 'projectos-hcr-state-'));
  made.push(base);
  process.env['LOCALAPPDATA'] = base;
});
afterEach(() => {
  if (savedLocalAppData === undefined) delete process.env['LOCALAPPDATA'];
  else process.env['LOCALAPPDATA'] = savedLocalAppData;
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

export function fixedClock(): System {
  return { ...nodeSystem, now: () => NOW };
}

export interface World {
  readonly root: string;
  readonly ctx: CommandContext;
}

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
      projectId: PROJECT,
      repositoryRoot: root,
      providerThreadId: 'resp_7f3a9c2e5b81d40a',
      transportId: 'openai-primary',
      createdAt: '2026-09-10T18:00:00Z',
    },
    programmeId: PROGRAMME,
  };
}

/** A governed project whose approved plan contains PHASE — and which has NO record of it yet. */
export function world(mode: Mode): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-hcr-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-hcr-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'owner@example.invalid');
  git(root, 'config', 'user.name', OWNER);
  git(root, 'config', 'commit.gpgsign', 'false');

  const config = {
    schemaVersion: '1.0.0',
    projectId: PROJECT,
    projectName: 'Hybrid Closure',
    repo: normaliseRemote(ORIGIN_URL),
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
  };
  const realPlan = JSON.parse(
    readFileSync(new URL('../../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const plan = {
    ...realPlan,
    projectId: PROJECT,
    projectName: 'Hybrid Closure',
    programmeId: PROGRAMME,
    planId: 'plan-hybrid-closure',
    repository: {
      ...(realPlan['repository'] as Record<string, unknown>),
      repositoryPath: root,
      expectedRemote: normaliseRemote(ORIGIN_URL),
      protectedBranches: ['main'],
      planSourceBranch: BRANCH,
    },
    phases: [
      {
        ...((realPlan['phases'] as Record<string, unknown>[])[0] as Record<string, unknown>),
        phaseId: PHASE,
        description: 'prove hybrid closure and reconcile routing',
        scope: '',
        dependsOn: [],
        requiredReviews: [],
        requiredBrowserProof: false,
        requiredValidators: ['validate-all'],
        requiredOwnerGates: ['secrets-handling', 'payment-or-live-charge'],
      },
    ],
    governance: {
      ...(realPlan['governance'] as Record<string, unknown>),
      owner: OWNER,
      gatekeeper: DELEGATE,
      closureAuthority: DELEGATE,
      closureDelegation: {
        delegatedBy: OWNER,
        delegatedTo: DELEGATE,
        delegationDate: '2026-09-10',
        delegatedScope: ['phase-closure'],
        projectScope: PROJECT,
        excludesProtectedActions: true,
      },
    },
  } as Record<string, unknown>;
  // The committed delegation the interactive composition and the unattended decider both resolve.
  const delegation = {
    schemaVersion: '1.0.0',
    delegationId: 'HYBRID-CLOSURE-DELEGATION1A',
    projectId: PROJECT,
    programmeScope: PROGRAMME,
    delegatedBy: OWNER,
    delegatedTo: DELEGATE,
    delegatedScope: ['phase-closure', 'programme-closure', 'gatekeeper-review-decisions'],
    delegationDate: '2026-09-10',
    excludesProtectedActions: true,
  };

  for (const dir of [['.projectops', 'authority'], ['.projectops', 'closure'], ['.projectops', 'validation'], ['state'], ['knowledge', 'reports']]) {
    mkdirSync(join(root, ...dir), { recursive: true });
  }
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.projectops', 'authority', 'closure-delegation.json'), JSON.stringify(delegation, null, 2));
  writeFileSync(join(root, '.projectops', 'gatekeeper.json'), JSON.stringify(gatekeeperConfig(mode, root), null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: PHASE }, null, 2));
  writeFileSync(join(root, 'knowledge', 'reports', `2026-09-10_${PHASE}_CLOSURE-EVIDENCE.md`), '# closure evidence\n');
  writeCleanRunEvidence(root, PHASE);
  // The real project ignores the closure wait directory for G4-13's reason; so does the fixture.
  writeFileSync(join(root, '.gitignore'), '.projectops/closure/waits/\n');

  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', ORIGIN_URL);
  git(root, 'remote', 'add', PUSH_REMOTE, origin);
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
  git(root, 'branch', `--set-upstream-to=${PUSH_REMOTE}/${BRANCH}`, BRANCH);
  return { root, ctx: { sys: fixedClock(), root } as CommandContext };
}

export function commitAndPush(root: string, message: string): void {
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', message);
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
}

/** The phase begins through the GOVERNED lifecycle, and the implementer walks it to awaiting_closure. */
export function startAndDeliverPhase(w: World): void {
  const created = phaseCommand(w.ctx, { id: PHASE, objective: 'prove hybrid closure reaches CLOSED' }, ['new']);
  expect(created.code, created.lines.join('\n')).toBe(0);
  for (const to of ['prompted', 'implementing', 'validating', 'evidence', 'awaiting_review', 'awaiting_closure']) {
    const r = phaseCommand(w.ctx, { id: PHASE, to, note: `fixture: ${to}` }, ['advance']);
    expect(r.code, r.lines.join('\n')).toBe(0);
  }
  commitAndPush(w.root, 'implementer: phase lifecycle');
  const head = git(w.root, 'rev-parse', 'HEAD').trim();
  writeFileSync(
    join(w.root, '.projectops', 'closure', `${PHASE}.json`),
    JSON.stringify(
      {
        phaseId: PHASE,
        evidenceSubjectHead: head,
        validatorsPass: true,
        checksPass: true,
        reviewsComplete: true,
        unresolvedCriticalOrHigh: 0,
        unresolvedCritical: 0,
        unresolvedHighIds: [],
        headedProofPass: null,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(w.root, '.projectops', 'validation', `${head}.json`),
    JSON.stringify(
      {
        schemaVersion: '1.1.0',
        subjectHead: head,
        workingTreeCleanAtRunStart: true,
        registeredModuleCount: 1,
        results: [{ name: 'validate-fixture', passed: true, errorCount: 0 }],
        aggregate: { name: 'validate-all', passed: true },
        aggregatePassed: true,
      },
      null,
      2,
    ),
  );
  commitAndPush(w.root, 'closure evidence and validator run');
}

/** The owner's action, and only the owner's action: commit what the ask names, and push it. */
export function ownerCommits(root: string): void {
  git(root, 'add', '--', '.projectops');
  git(root, 'commit', '--quiet', '-m', 'owner: commit the closure decision');
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
}

export function phaseRecord(root: string): { status: string; history: { to: string; by: string; note?: string }[] } {
  return JSON.parse(readFileSync(join(root, '.projectops', 'phases', `${PHASE}.json`), 'utf8'));
}

export function filesIn(root: string, rel: string): string[] {
  const dir = join(root, ...rel.split('/'));
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export function pendingQuestion(root: string, rel: string): string {
  const files = filesIn(root, rel);
  const open = files
    .filter((f) => f.endsWith('.request.json'))
    .map((f) => f.slice(0, -'.request.json'.length))
    .filter((id) => !files.includes(`${id}.decision.json`));
  if (open.length !== 1) throw new Error(`expected exactly one open question in ${rel}, found ${open.length}`);
  return open[0] as string;
}

/** The ChatGPT closure authority's answer, written where the question says, filled in as it instructs. */
export function answerClosure(root: string, fill: Record<string, unknown>): void {
  const id = pendingQuestion(root, CLOSURE_INTERACTIVE_REL);
  const dir = join(root, ...CLOSURE_INTERACTIVE_REL.split('/'));
  const handoff = JSON.parse(readFileSync(join(dir, `${id}.request.json`), 'utf8')) as { decisionTemplate: Record<string, unknown> };
  const answer = {
    ...handoff.decisionTemplate,
    decision: 'close',
    note: 'accepted for closure on the recorded evidence',
    decidedAt: '2026-09-10T21:01:00+01:00',
    ...fill,
  };
  writeFileSync(join(dir, `${id}.decision.json`), `${JSON.stringify(answer, null, 2)}\n`);
}

/**
 * The interactive composition, exactly as production builds it, except that the port's sleep hook is
 * the moment the owner saves ChatGPT's answer — WHILE `closure request` holds the gate open.
 */
export function answeringClosureDeps(fill: Record<string, unknown>, answered: { n: number }): MakeClosureDeps {
  return (args) => {
    if (args.mode !== 'interactive') throw new Error('this fixture project is in interactive mode');
    return {
      mode: 'interactive',
      consumedDecisionIds: args.consumedDecisionIds,
      interactive: nodeInteractivePort(args.sys, args.root, {
        dir: CLOSURE_INTERACTIVE_REL,
        waitMs: 60_000,
        pollMs: 1_000,
        sleep: () => {
          answered.n += 1;
          answerClosure(args.root, fill);
        },
      }),
    };
  };
}

/** ProjectOSHost and its independent provider, as a deterministic fake behind the real port. */
export function fakeHost(opts: { unavailable?: boolean; closureVerdict?: string } = {}) {
  const closureCalls: HostClosureReviewCall[] = [];
  const reviewCalls: HostReviewCall[] = [];
  const attestation = (correlation: string, verdict: string, allowedActions: readonly string[], ownerApprovalRequired: boolean) => ({
    schemaVersion: 1,
    attestationId: 'd'.repeat(64),
    requestCorrelation: correlation,
    providerResponseId: 'resp_host_fixture',
    provider: 'fake-independent-provider',
    model: 'fake-model',
    verdict,
    allowedActions: [...allowedActions],
    ownerApprovalRequired,
    costMicroUsd: 3_000,
    attestedAtEpochS: 1_788_000_000,
  });
  // One Host client answers both questions, through the two ports.
  const port: HostReviewPort & HostClosureReviewPort & { closureCalls: HostClosureReviewCall[]; reviewCalls: HostReviewCall[] } = {
    closureCalls,
    reviewCalls,
    reviewClosure(call): HostClosureReviewOutcome {
      closureCalls.push(call);
      if (opts.unavailable === true) return { kind: 'unavailable', cause: 'PROVIDER_UNAVAILABLE', reasons: ['the independent provider did not answer'] };
      return {
        kind: 'attested',
        record: {
          schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
          decisionId: `${PHASE}-HOST-DECISION1A`,
          decision: 'close',
          projectId: call.request.projectId,
          phaseId: call.request.phaseId,
          scope: PHASE_CLOSURE_SCOPE,
          decidedBy: DELEGATE,
          decidedAt: '2026-09-10T21:02:00+01:00',
          evidenceSubjectHead: call.request.subjectHead,
          requestDigest: call.requestDigest,
          note: 'independently reviewed: closable',
          ownerAcceptedFindings: [],
        },
        attestation: attestation(call.correlation, opts.closureVerdict ?? HOST_VERDICT_FOR_CLOSURE.close, [], true),
        usage: { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 },
      };
    },
    review(call): HostReviewOutcome {
      reviewCalls.push(call);
      if (opts.unavailable === true) return { kind: 'unavailable', cause: 'PROVIDER_UNAVAILABLE', reasons: ['the independent provider did not answer'] };
      return {
        kind: 'attested',
        record: {
          schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
          decisionId: `GKDEC-${call.request.requestId}`,
          projectId: call.request.projectId,
          phaseId: call.request.phaseId,
          subjectCommit: call.request.subjectCommit,
          requestDigest: call.requestDigest,
          decision: 'APPROVED_TO_PROCEED',
          reason: 'independently reviewed: the degraded work matches the grant',
          nextClaudeInstruction: 'the debt is discharged; resume normal service',
          allowedActions: [],
          forbiddenActions: [],
          ownerApprovalRequired: false,
          decidedBy: DELEGATE,
          decidedAt: NOW,
        },
        attestation: attestation(call.correlation, HOST_VERDICT_FOR.APPROVED_TO_PROCEED, [], false),
        usage: { inputTokens: 1_000, cachedInputTokens: 0, outputTokens: 100 },
      };
    },
  };
  return port;
}

/** The unattended composition with a Host route plugged in — the one thing this build cannot compose. */
export function hostClosureDeps(host: HostClosureReviewPort): MakeClosureDeps {
  return (args) => {
    if (args.mode !== 'unattended') throw new Error('this fixture project is in unattended mode');
    const { config } = args;
    return {
      mode: 'unattended',
      hostReview: host,
      transport: config.transport,
      availability: { reachable: true },
      resolver: unprovisionedResolver('the fixture holds no credential'),
      http: {
        post() {
          throw new Error('the in-process provider route must never be reached in unattended mode');
        },
      },
      modelPolicy: config.modelPolicy,
      rateCards: config.rateCards,
      budget: config.budget,
      ledger: [],
      threadBinding: config.threadBinding,
      consumedDecisionIds: args.consumedDecisionIds,
    };
  };
}

export const text = (lines: readonly string[]): string => lines.join('\n');
export const LEDGER = ['.projectops', 'gatekeeper-ledger.json'];

// RECONCILE

/** A degraded-mode aftermath: a committed grant-only authority commit, the mirror, the installation record. */
export function reconcileWorld(mode: Mode): World {
  const w = world(mode);
  const grantRel = degradedGrantRelPath(PHASE, GRANT) as string;
  mkdirSync(join(w.root, ...grantRel.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(
    join(w.root, ...grantRel.split('/')),
    `${JSON.stringify(
      {
        schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
        grantId: GRANT,
        projectId: PROJECT,
        phaseId: PHASE,
        unavailabilityId: OUTAGE,
        ownerChoice: DEGRADED_MODE_CHOICE,
        grantedBy: OWNER,
        grantedAt: '2026-09-10T15:00:00.000Z',
        reason: 'fixture',
        grantedScope: ['implement'],
        maxWorkItems: 1,
      },
      null,
      2,
    )}\n`,
  );
  git(w.root, 'add', '--', grantRel);
  git(w.root, 'commit', '--quiet', '-m', 'authority: degraded grant');
  const subject = git(w.root, 'rev-parse', 'HEAD~1').trim();

  const workItem = { workId: WORK, grantId: GRANT, phaseId: PHASE, summary: 'implement', at: '2026-09-10T15:18:56.178Z' };
  const storeRel = degradedStoreRelPath(GRANT) as string;
  mkdirSync(join(w.root, ...storeRel.split('/').slice(0, -1)), { recursive: true });
  writeFileSync(
    join(w.root, ...storeRel.split('/')),
    `${JSON.stringify(
      { schemaVersion: '1.0.0', grantId: GRANT, unavailabilityId: OUTAGE, projectId: PROJECT, phaseId: PHASE, consumedAt: workItem.at, maxWorkItems: 1, workItems: [workItem], reconciliations: [] },
      null,
      2,
    )}\n`,
  );

  const stateDir = nodeInstallationStateDir() as string;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    join(stateDir, 'degraded-consumption.json'),
    `${JSON.stringify(
      {
        schemaVersion: '1.0.0',
        consumptions: [
          {
            schemaVersion: '1.0.0',
            installRoot: nodeProjectosRuntime().installRoot,
            projectId: PROJECT,
            repository: canonicalRepositoryIdentity(nodeSystem, w.root),
            phaseId: PHASE,
            grantId: GRANT,
            subjectCommit: subject,
            unavailabilityId: OUTAGE,
            workId: WORK,
            summary: 'implement',
            consumedAt: workItem.at,
          },
        ],
        reconciliations: [],
      },
      null,
      2,
    )}\n`,
  );
  return w;
}

export function durableReconciliations(): unknown[] {
  const ledger = JSON.parse(readFileSync(join(nodeInstallationStateDir() as string, 'degraded-consumption.json'), 'utf8')) as { reconciliations: unknown[] };
  return ledger.reconciliations;
}

export function answerReconciliation(root: string, fill: Record<string, unknown> = {}): void {
  const id = pendingQuestion(root, GATEKEEPER_INTERACTIVE_REL);
  const dir = join(root, ...GATEKEEPER_INTERACTIVE_REL.split('/'));
  const handoff = JSON.parse(readFileSync(join(dir, `${id}.request.json`), 'utf8')) as { decisionTemplate: Record<string, unknown> };
  const answer = {
    ...handoff.decisionTemplate,
    decision: 'APPROVED_TO_PROCEED',
    reason: 'reviewed with the owner: the degraded work matches the grant',
    nextClaudeInstruction: 'the debt is discharged; resume normal service at the next gate',
    allowedActions: [],
    forbiddenActions: [],
    ownerApprovalRequired: false,
    decidedAt: NOW,
    ...fill,
  };
  writeFileSync(join(dir, `${id}.decision.json`), `${JSON.stringify(answer, null, 2)}\n`);
}

export function decisionEvidence(root: string): Record<string, unknown>[] {
  return filesIn(root, '.projectops/gatekeeper-decisions').map((f) =>
    JSON.parse(readFileSync(join(root, '.projectops', 'gatekeeper-decisions', f), 'utf8')),
  );
}

export const RECONCILE = { grant: GRANT, work: WORK, phase: PHASE, execute: true } as const;
