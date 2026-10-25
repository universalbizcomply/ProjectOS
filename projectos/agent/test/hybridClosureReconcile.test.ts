/**
 * HYBRID CLOSURE + RECONCILE ROUTING — both commands, both gatekeeper modes, against real git.
 *
 * One disposable governed project per test, with a real worktree and a real local bare remote. The
 * phase is started through the governed lifecycle (`phase new`, then `phase advance`), so the record
 * closure moves to CLOSED exists because the lifecycle wrote it — not because the fixture did.
 *
 * WHAT IS REAL: the committed configuration that selects the mode, mode resolution, the lifecycle, G4,
 * the closure contract, the interactive port on disk and its bounded wait, the decision write, the
 * bundle, the owner's commit, `phase advance --delegated`, the reconciliation contract, the committed
 * grant and git.
 *
 * WHAT IS A FIXTURE: the ChatGPT gatekeeper's answer in interactive mode (written where the question
 * says, WHILE the asking command holds the gate open — the port's sleep hook is that moment), and
 * ProjectOSHost + its provider in unattended mode (a deterministic fake behind `HostReviewPort`). The
 * installation state directory is a temporary one. No provider is called, no Host is started, nothing
 * is spent, and no real machine state is read or written.
 *
 * Created in PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { closure, closureRequest, type MakeClosureDeps } from '../src/commands/closure.js';
import { phase as phaseCommand } from '../src/commands/phase.js';
import { reconcile } from '../src/commands/reconcile.js';
import { CLOSURE_INTERACTIVE_REL, GATEKEEPER_INTERACTIVE_REL, nodeInteractivePort } from '../src/loop/gatekeeperHandoff.js';
import { readClosureWait } from '../src/closureWait.js';
import { degradedGrantRelPath } from '../src/loop/degradedModeGrants.js';
import { degradedStoreRelPath } from '../src/loop/degradedMode.js';
import { canonicalRepositoryIdentity } from '../src/installation/projectAllowlist.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../src/nodeRuntimeRoot.js';
import { unprovisionedResolver } from '../src/loop/credentialResolver.js';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import type { CommandContext } from '../src/context.js';
import type { System } from '../src/system.js';
import { writeCleanRunEvidence } from './support/runEvidence.js';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'HYBRID-CLOSURE-RECONCILE1A';
// The fixture keeps the 'projectos' id (see closureEndToEnd); G4-1 accepts any governed project.
const PROJECT = 'projectos';
const OWNER = 'Murad';
const DELEGATE = 'ChatGPT';
const PROGRAMME = 'hybrid-closure-programme';
const BRANCH = 'work';
const NOW = '2026-09-10T20:00:00Z';
const ORIGIN_URL = 'https://github.com/acme/hybrid-closure.git';
const PUSH_REMOTE = 'local';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const GRANT = 'DEGRADED-HYBRID-FIXTURE1A';
const WORK = 'GKWORK-000000000000aaaa';
const OUTAGE = 'GKOUT-c1869b6abf8e873aa88abb8c';
const RATE = { model: 'gpt-5.6-terra', inputMicroUsdPerMillion: 1_250_000, cachedInputMicroUsdPerMillion: 125_000, outputMicroUsdPerMillion: 10_000_000 };

type Mode = 'interactive' | 'unattended';

const made: string[] = [];
let savedLocalAppData: string | undefined;
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

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function fixedClock(): System {
  return { ...nodeSystem, now: () => NOW };
}

interface World {
  readonly root: string;
  readonly ctx: CommandContext;
}

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
function world(mode: Mode): World {
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
    readFileSync(new URL('../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
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

function commitAndPush(root: string, message: string): void {
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', message);
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
}

/** The phase begins through the GOVERNED lifecycle, and the implementer walks it to awaiting_closure. */
function startAndDeliverPhase(w: World): void {
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
function ownerCommits(root: string): void {
  git(root, 'add', '--', '.projectops');
  git(root, 'commit', '--quiet', '-m', 'owner: commit the closure decision');
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
}

function phaseRecord(root: string): { status: string; history: { to: string; by: string; note?: string }[] } {
  return JSON.parse(readFileSync(join(root, '.projectops', 'phases', `${PHASE}.json`), 'utf8'));
}

function filesIn(root: string, rel: string): string[] {
  const dir = join(root, ...rel.split('/'));
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function pendingQuestion(root: string, rel: string): string {
  const files = filesIn(root, rel);
  const open = files
    .filter((f) => f.endsWith('.request.json'))
    .map((f) => f.slice(0, -'.request.json'.length))
    .filter((id) => !files.includes(`${id}.decision.json`));
  if (open.length !== 1) throw new Error(`expected exactly one open question in ${rel}, found ${open.length}`);
  return open[0] as string;
}

/** The ChatGPT closure authority's answer, written where the question says, filled in as it instructs. */
function answerClosure(root: string, fill: Record<string, unknown>): void {
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
function answeringClosureDeps(fill: Record<string, unknown>, answered: { n: number }): MakeClosureDeps {
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
function fakeHost(opts: { unavailable?: boolean; closureVerdict?: string } = {}) {
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
function hostClosureDeps(host: HostClosureReviewPort): MakeClosureDeps {
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

const text = (lines: readonly string[]): string => lines.join('\n');
const LEDGER = ['.projectops', 'gatekeeper-ledger.json'];

// -------------------------------------------------------------------------------------------------

describe('closure moves a governed phase RECORD, and says plainly when there is none', () => {
  it('a phase outside the approved plan is refused with the real cause and the governed route', () => {
    const w = world('interactive');
    const r = closureRequest(w.ctx, { id: 'NOT-IN-THE-PLAN1A', execute: true });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('not a phase of the active approved plan');
    expect(text(r.lines)).toContain('the owner approves a plan amendment');
    expect(text(closure(w.ctx, { id: 'NOT-IN-THE-PLAN1A' }, ['status']).lines)).toContain('NO_PHASE_RECORD');
  });

  it('a planned phase that was never started is refused, and `phase new` is the route', () => {
    const w = world('interactive');
    const r = closureRequest(w.ctx, { id: PHASE, execute: true });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('was never started');
    expect(text(r.lines)).toContain(`projectos phase new --id ${PHASE}`);
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);
  });
});

describe('INTERACTIVE closure: the ChatGPT decision, relayed through the owner', () => {
  it('reaches CLOSED from `phase new` through the owner-committed interactive decision — no provider, no spend', () => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');

    const answered = { n: 0 };
    const asked = closureRequest(w.ctx, { id: PHASE, execute: true }, answeringClosureDeps({}, answered));
    expect(asked.code, text(asked.lines)).toBe(0);
    expect(answered.n).toBe(1);
    expect(text(asked.lines)).toContain('WAITING_OWNER');
    expect(text(asked.lines)).toContain('closure decision provenance: InteractiveGatekeeperDecision');
    // NOTHING WAS PRICED OR SPENT: no ledger exists, and the only dirty governed file is the decision.
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
    const dirty = git(w.root, 'status', '--porcelain', '-uall').trim().split(/\r?\n/);
    expect(dirty).toEqual([`?? .projectops/closure/decisions/${PHASE}.json`]);
    // The decision written for the owner is ChatGPT's answer, bound to this question.
    const decision = JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`), 'utf8'));
    expect(decision.decidedBy).toBe(DELEGATE);
    expect(decision.decisionId).toMatch(/^CLDEC-[0-9a-f]{24}$/);
    const wait = readClosureWait(w.ctx.sys, w.root, PHASE);
    expect(wait.ok && wait.value?.provenance).toBe('InteractiveGatekeeperDecision');
    expect(wait.ok && wait.value?.bundle.length).toBe(1);
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL).some((f) => f.endsWith('.consumed.json'))).toBe(true);
    // Asking closes nothing.
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');

    ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code, text(resumed.lines)).toBe(0);
    const record = phaseRecord(w.root);
    expect(record.status).toBe('closed');
    const last = record.history[record.history.length - 1] as { to: string; by: string; note: string };
    expect(last.by).toBe('advisor');
    expect(last.note).toContain('InteractiveGatekeeperDecision');
    expect(last.note).toContain(`decision ${decision.decisionId}`);
    // THE CLOSURE IS DURABLY RECORDED: the committed decision is spent, the wait resolved.
    const spent = JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`), 'utf8'));
    expect(typeof spent.consumedAt).toBe('string');
    const after = readClosureWait(w.ctx.sys, w.root, PHASE);
    expect(after.ok && after.value?.state).toBe('CLOSED');
  });

  it('the production composition asks through the owner: the question is written, and no answer means WAIT', () => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    const r = closureRequest(w.ctx, { id: PHASE, execute: true, 'gate-wait-minutes': '0' });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('AWAITING_GATEKEEPER');
    expect(text(r.lines)).toContain('WAITING FOR THE INTERACTIVE GATEKEEPER');
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL).filter((f) => f.endsWith('.request.json'))).toHaveLength(1);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
    // The question sits in the ignored wait directory, so it cannot refuse its own closure at G4-13.
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
  });

  it.each([
    ['the implementer as decider', { decidedBy: 'Claude' }, "who is not the plan's closure authority"],
    ['another question\'s decision id', { decisionId: 'CLDEC-000000000000000000000000' }, "but this question's decision is"],
    ['a provenance claim', { provenance: 'HostIndependentProviderAttestation' }, "carries 'provenance'"],
    ['an answer to a different question', { requestDigest: `sha256:${'0'.repeat(64)}` }, 'an answer to a different question'],
    ['a technical verdict', { decision: 'APPROVED_FOR_CLOSURE' }, 'is not one of'],
  ])('refuses %s, writes nothing and spends nothing', (_label, fill, expected) => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    const answered = { n: 0 };
    const r = closureRequest(w.ctx, { id: PHASE, execute: true }, answeringClosureDeps(fill, answered));
    expect(answered.n).toBe(1);
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('ANSWER_REFUSED');
    expect(text(r.lines)).toContain(expected);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL).some((f) => f.endsWith('.consumed.json'))).toBe(false);
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');
  });

  it('an answer planted before the question was asked is never accepted', () => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    // Learn the deterministic question id, then remove the question and plant an answer for it.
    closureRequest(w.ctx, { id: PHASE, execute: true, 'gate-wait-minutes': '0' });
    const id = pendingQuestion(w.root, CLOSURE_INTERACTIVE_REL);
    const dir = join(w.root, ...CLOSURE_INTERACTIVE_REL.split('/'));
    const template = (JSON.parse(readFileSync(join(dir, `${id}.request.json`), 'utf8')) as { decisionTemplate: Record<string, unknown> }).decisionTemplate;
    rmSync(join(dir, `${id}.request.json`));
    writeFileSync(join(dir, `${id}.decision.json`), JSON.stringify({ ...template, decision: 'close', note: 'planted', decidedAt: NOW }));

    const r = closureRequest(w.ctx, { id: PHASE, execute: true }, answeringClosureDeps({}, { n: 0 }));
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('cannot have been given in answer to it');
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
  });
});

describe('the implementer cannot manufacture closure authority; the owner floor stands', () => {
  it('an implementer-identity commit of the presented decision cannot close the phase', () => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    expect(closureRequest(w.ctx, { id: PHASE, execute: true }, answeringClosureDeps({}, { n: 0 })).code).toBe(0);
    git(w.root, 'config', 'user.name', 'Claude');
    git(w.root, 'config', 'user.email', 'claude@anthropic.invalid');
    ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(text(resumed.lines)).toContain('the implementer can never satisfy the owner');
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');
  });

  it('a hand-written committed decision that no question produced cannot ride the closure route', () => {
    const w = world('interactive');
    startAndDeliverPhase(w);
    mkdirSync(join(w.root, '.projectops', 'closure', 'decisions'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`),
      JSON.stringify({ schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION, decisionId: 'CLDEC-HANDWRITTEN1A', phaseId: PHASE, decision: 'close', decidedBy: DELEGATE }, null, 2),
    );
    ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(text(resumed.lines)).toContain('NO_CLOSURE_WAIT');
    // And the implementer cannot close it by role, either.
    const byRole = phaseCommand(w.ctx, { id: PHASE, to: 'closed', as: 'implementer' }, ['advance']);
    expect(byRole.code).not.toBe(0);
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');
  });
});

describe('UNATTENDED closure: Host-independent attestation, and nothing else', () => {
  it('consumes the Host attestation through HostReviewPort and reaches CLOSED with that provenance', () => {
    const w = world('unattended');
    startAndDeliverPhase(w);
    const host = fakeHost();
    const asked = closureRequest(w.ctx, { id: PHASE, execute: true }, hostClosureDeps(host));
    expect(asked.code, text(asked.lines)).toBe(0);
    expect(host.closureCalls).toHaveLength(1);
    expect(host.reviewCalls).toHaveLength(0);
    expect(text(asked.lines)).toContain('closure decision provenance: HostIndependentProviderAttestation');
    const wait = readClosureWait(w.ctx.sys, w.root, PHASE);
    expect(wait.ok && wait.value?.provenance).toBe('HostIndependentProviderAttestation');
    expect(wait.ok && wait.value?.hostAttestationId).toBe('d'.repeat(64));
    // No interactive question was ever written: there is no fallback between modes.
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);

    ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code, text(resumed.lines)).toBe(0);
    const record = phaseRecord(w.root);
    expect(record.status).toBe('closed');
    expect((record.history[record.history.length - 1] as { note: string }).note).toContain('HostIndependentProviderAttestation');
  });

  it('with no Host route composed (this build) it WAITS — no provider, no spend, no interactive fallback', () => {
    const w = world('unattended');
    startAndDeliverPhase(w);
    const r = closureRequest(w.ctx, { id: PHASE, execute: true });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('UNAVAILABLE');
    expect(text(r.lines)).toContain('no Host closure review route is composed');
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);
  });

  // PROJECTOS-FINISH-API-GATEKEEPER1A: on the committed broker opt-in the closure question goes to the
  // trusted broker — and a project this installation does not allowlist is refused BEFORE any request.
  it('on the broker opt-in, a project the installation does not allowlist is refused before the closure request: no spend, no decision', () => {
    const w = world('unattended');
    const path = join(w.root, '.projectops', 'gatekeeper.json');
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), route: 'installation-broker' }, null, 2));
    commitAndPush(w.root, 'owner opts in to the installation broker');
    startAndDeliverPhase(w);
    const r = closureRequest(w.ctx, { id: PHASE, execute: true });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('does not authorise the governed project to spend its credential, so no closure request was made');
    expect(text(r.lines)).not.toContain('no Host closure review route is composed');
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(filesIn(w.root, CLOSURE_INTERACTIVE_REL)).toEqual([]);
  });

  it('an unavailable Host fails closed', () => {
    const w = world('unattended');
    startAndDeliverPhase(w);
    const r = closureRequest(w.ctx, { id: PHASE, execute: true }, hostClosureDeps(fakeHost({ unavailable: true })));
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('UNAVAILABLE');
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(phaseRecord(w.root).status).toBe('awaiting_closure');
  });

  it('an attestation that vouches for a different answer is refused', () => {
    const w = world('unattended');
    startAndDeliverPhase(w);
    const r = closureRequest(w.ctx, { id: PHASE, execute: true }, hostClosureDeps(fakeHost({ closureVerdict: 'ChangesRequired' })));
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('ANSWER_REFUSED');
    expect(text(r.lines)).toContain('which does not match the decision');
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// RECONCILE

/** A degraded-mode aftermath: a committed grant-only authority commit, the mirror, the installation record. */
function reconcileWorld(mode: Mode): World {
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

function durableReconciliations(): unknown[] {
  const ledger = JSON.parse(readFileSync(join(nodeInstallationStateDir() as string, 'degraded-consumption.json'), 'utf8')) as { reconciliations: unknown[] };
  return ledger.reconciliations;
}

function answerReconciliation(root: string, fill: Record<string, unknown> = {}): void {
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

function decisionEvidence(root: string): Record<string, unknown>[] {
  return filesIn(root, '.projectops/gatekeeper-decisions').map((f) =>
    JSON.parse(readFileSync(join(root, '.projectops', 'gatekeeper-decisions', f), 'utf8')),
  );
}

const RECONCILE = { grant: GRANT, work: WORK, phase: PHASE, execute: true } as const;

describe('reconcile: the same hybrid acquisition, one debt at a time', () => {
  it('INTERACTIVE discharges the debt on the relayed ChatGPT decision — no provider, no spend', () => {
    const w = reconcileWorld('interactive');
    let answered = 0;
    const port = nodeInteractivePort(w.ctx.sys, w.root, {
      waitMs: 60_000,
      pollMs: 1_000,
      sleep: () => {
        answered += 1;
        answerReconciliation(w.root);
      },
    });
    const r = reconcile(w.ctx, RECONCILE, { interactive: port });
    expect(r.code, text(r.lines)).toBe(0);
    expect(answered).toBe(1);
    expect(text(r.lines)).toContain('mode interactive');
    expect(text(r.lines)).toContain(`RECONCILED ${WORK}`);
    expect(durableReconciliations()).toHaveLength(1);
    const [evidence] = decisionEvidence(w.root);
    expect(evidence?.['provenance']).toBe('InteractiveGatekeeperDecision');
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
  });

  it('INTERACTIVE with no answer WAITS and the debt stands; a dry run writes no question at all', () => {
    const w = reconcileWorld('interactive');
    const dry = reconcile(w.ctx, { grant: GRANT, work: WORK, phase: PHASE, 'dry-run': true });
    expect(dry.code, text(dry.lines)).toBe(0);
    expect(text(dry.lines)).toContain('interactive mode calls no provider');
    expect(filesIn(w.root, GATEKEEPER_INTERACTIVE_REL)).toEqual([]);

    const r = reconcile(w.ctx, { ...RECONCILE, 'gate-wait-minutes': '0' });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('AWAITING_GATEKEEPER');
    expect(filesIn(w.root, GATEKEEPER_INTERACTIVE_REL).filter((f) => f.endsWith('.request.json'))).toHaveLength(1);
    expect(durableReconciliations()).toEqual([]);
  });

  it('INTERACTIVE refuses a decision the implementer wrote for itself, and the debt stands', () => {
    const w = reconcileWorld('interactive');
    const port = nodeInteractivePort(w.ctx.sys, w.root, { waitMs: 60_000, pollMs: 1_000, sleep: () => answerReconciliation(w.root, { decidedBy: 'Claude' }) });
    const r = reconcile(w.ctx, RECONCILE, { interactive: port });
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('DECISION_REFUSED');
    expect(durableReconciliations()).toEqual([]);
  });

  it('UNATTENDED discharges the debt only on the Host attestation — never the in-process provider', () => {
    const w = reconcileWorld('unattended');
    const host = fakeHost();
    const r = reconcile(w.ctx, RECONCILE, { hostReview: host });
    expect(r.code, text(r.lines)).toBe(0);
    expect(host.reviewCalls).toHaveLength(1);
    expect(host.closureCalls).toHaveLength(0);
    expect(text(r.lines)).toContain('mode unattended');
    expect(durableReconciliations()).toHaveLength(1);
    const [evidence] = decisionEvidence(w.root);
    expect(evidence?.['provenance']).toBe('HostIndependentProviderAttestation');
    expect(evidence?.['hostAttestationId']).toBe('d'.repeat(64));
    expect(filesIn(w.root, GATEKEEPER_INTERACTIVE_REL)).toEqual([]);
  });

  it('UNATTENDED with no Host route composed (this build) WAITS — no provider, no spend, no interactive fallback', () => {
    const w = reconcileWorld('unattended');
    const r = reconcile(w.ctx, RECONCILE);
    expect(r.code).toBe(2);
    expect(text(r.lines)).toContain('UNAVAILABLE');
    expect(text(r.lines)).toContain('no Host review route is composed');
    expect(text(r.lines)).toContain('was never sent, so nothing was spent');
    expect(existsSync(join(w.root, ...LEDGER))).toBe(false);
    expect(filesIn(w.root, GATEKEEPER_INTERACTIVE_REL)).toEqual([]);
    expect(durableReconciliations()).toEqual([]);
  });
});

describe('no pre-hybrid direct paid route remains in the closure or reconcile commands', () => {
  const source = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
  it.each(['../src/commands/closure.ts', '../src/commands/reconcile.ts'])('%s composes no in-process provider route', (rel) => {
    expect(source(rel)).not.toMatch(/submitClosureRequest|submitToOpenAi/);
  });

  // PROJECTOS-FINISH-API-GATEKEEPER1A (owner decision of 2026-10-25): closure may compose the TRUSTED
  // INSTALLATION BROKER — a separate process that resolves the key in itself — when no Host route is
  // configured. The degraded-mode reconciliation still composes no paid route of any kind.
  it('closure composes the trusted broker only on the committed opt-in with no Host route; reconcile composes none', () => {
    expect(source('../src/commands/reconcile.ts')).not.toMatch(/nodeBrokeredTransport|installationAllowsProject|trustedBroker|brokerRouteOptedIn|\bbroker\b/);
    const closure = source('../src/commands/closure.ts');
    expect(closure).toMatch(/\.\.\.\(args\.hostReview === undefined && brokerRouteOptedIn\(sys, root\)\s*\?\s*\{ broker: trustedBroker\(sys, root, args\.projectId\) \}/);
    expect(closure).toContain("resolver: unprovisionedResolver('the closure authority credential is resolved on the Host side, never in the agent')");
  });

  it('the CLI passes no test seam to either command', () => {
    const cli = source('../src/cli.ts');
    expect(cli).toContain('return reconcile(ctx, flags);');
    expect(cli).toContain('return closure(ctx, flags, positionals);');
  });
});
