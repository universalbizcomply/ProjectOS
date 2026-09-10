/**
 * THE WHOLE ROUTE-A CHAIN, against a real repository.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `closureTurn.test.ts` proves the turn and
 * `closureOwnerCommit.test.ts` proves the byte-identity rule, both by calling those pieces directly.
 * Neither proves that a governed phase REACHES them, nor that after Murad's commit the closure
 * actually completes through the existing G4 / delegation / consumption path. That reachability gap
 * is the exact state B6's executor was found in — proven pieces, unreachable chain — so it is proven
 * here instead of assumed.
 *
 * WHAT IS REAL AND WHAT IS A FIXTURE. Real: a git worktree, a bare origin, the committed config,
 * plan, delegation, phase record, closure evidence, validator-run record and evidence report; the
 * eligibility gate; the decision write; the wait record; the OWNER'S COMMIT, made with real git; the
 * observation of it; and the whole of `phase advance --to closed --delegated`, including
 * `checkClosureDecision`, `authoriseClosure` and the consumption marker. Fixture: exactly one thing —
 * ProjectOSHost's attested closure answer behind `HostReviewPort`, because this project is in UNATTENDED
 * mode and the alternative is a real Host and a paid provider call. The in-process HTTP port throws if
 * it is ever called: unattended closure has no route to it.
 *
 * NO PROVIDER REQUEST IS MADE AND NOTHING IS SPENT.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { closure, closureRequest, type MakeClosureDeps } from '../src/commands/closure.js';
import { phase as phaseCommand } from '../src/commands/phase.js';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import { unprovisionedResolver } from '../src/loop/credentialResolver.js';
import { readClosureWait, closureDecisionSha256 } from '../src/closureWait.js';
import {
  APPROVED_PILOT_POLICY,
  CLOSURE_DECISION_SCHEMA_VERSION,
  HOST_VERDICT_FOR_CLOSURE,
  PHASE_CLOSURE_SCOPE,
  type HostClosureReviewCall,
  closureEvidenceDigest,
  closureRequestDigest,
  deriveClosureRequestId,
  CLOSURE_REQUEST_SCHEMA_VERSION,
} from '@projectos/core';
import type { CommandContext } from '../src/context.js';
import type { System } from '../src/system.js';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'E2E-CLOSURE-TRANSPORT1A';
// G4-1 hardcodes the governed project id this gate applies to, so the fixture must BE that project.
// Renaming it would prove a different repository's closure, not this one's.
const PROJECT = 'projectos';
const OWNER = 'Murad';
const DELEGATE = 'ChatGPT';
const PROGRAMME = 'e2e-closure-programme';
const BRANCH = 'work';
const NOW = '2026-09-02T22:00:00Z';
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
/**
 * `origin` is a URL and the pushable remote is a second one, on purpose.
 *
 * `canonicalRepositoryIdentity` — which `phase advance` uses to scope the installation's degraded-debt
 * record — parses `origin` as an ssh or https URL and returns null for a local path. A null there
 * refuses the closure for a reason that has nothing to do with closure. Two remotes gives the fixture
 * a parseable identity AND a real place to push, and the identity is deliberately not this
 * repository's, so the test reads no real machine state.
 */
const ORIGIN_URL = 'https://github.com/acme/e2e-closure.git';
const PUSH_REMOTE = 'local';

const RATE = {
  model: 'gpt-5.6-terra',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

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

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
  readonly ctx: CommandContext;
}

/**
 * A governed project whose phase is genuinely closable: pushed, reconciled, validated, reviewed,
 * clean, and awaiting closure.
 *
 * The plan is DERIVED from this repository's own PLAN READY record rather than hand-built, for the
 * reason `continuationEndToEnd.test.ts` records: the readiness evaluator checks far more than the
 * schema, and re-encoding its rules in a fixture is how a fixture rots.
 */
function world(): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-clos-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-clos-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  // THE CHECKOUT'S GIT IDENTITY IS THE PLAN'S OWNER. `observeOwnerCommit` now refuses a decision
  // commit made under any other identity, so a fixture with an arbitrary name would prove the
  // refusal and never the acceptance.
  git(root, 'config', 'user.name', OWNER);

  const config = {
    schemaVersion: '1.0.0',
    projectId: PROJECT,
    projectName: 'E2E Closure',
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
    projectName: 'E2E Closure',
    programmeId: PROGRAMME,
    planId: 'plan-e2e-closure',
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
        description: 'prove the closure transport reaches CLOSED',
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
        delegationDate: '2026-09-02',
        delegatedScope: ['phase-closure'],
        projectScope: PROJECT,
        excludesProtectedActions: true,
      },
    },
  } as Record<string, unknown>;

  const gatekeeper = {
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
      createdAt: '2026-09-02T20:00:00+01:00',
    },
    programmeId: PROGRAMME,
  };

  for (const dir of [
    ['.projectops'],
    ['.projectops', 'phases'],
    ['.projectops', 'closure'],
    ['.projectops', 'validation'],
    ['state'],
    ['knowledge', 'reports'],
  ]) {
    mkdirSync(join(root, ...dir), { recursive: true });
  }
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.projectops', 'gatekeeper.json'), JSON.stringify(gatekeeper, null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: PHASE }, null, 2));
  writeFileSync(
    join(root, '.projectops', 'phases', `${PHASE}.json`),
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        phaseId: PHASE,
        project: PROJECT,
        status: 'awaiting_closure',
        objective: 'prove the closure transport reaches CLOSED',
        history: [],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, 'knowledge', 'reports', `2026-09-02_${PHASE}_CLOSURE-EVIDENCE.md`), '# closure evidence\n');
  // ONLY the wait record is ignored — see .gitignore in the real project, and G4-13. The LEDGER is
  // deliberately tracked here, because whether the paid call's cost lands in the tree (and therefore
  // in the owner's ask) is one of the things this file exists to prove.
  writeFileSync(join(root, '.gitignore'), '.projectops/closure/waits/\n');

  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', ORIGIN_URL);
  git(root, 'remote', 'add', PUSH_REMOTE, origin);
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
  git(root, 'branch', `--set-upstream-to=${PUSH_REMOTE}/${BRANCH}`, BRANCH);

  // THE EVIDENCE IS BOUND TO THE PUSHED SUBJECT, which is what "post-push phase state" means.
  const head = git(root, 'rev-parse', 'HEAD').trim();
  writeFileSync(
    join(root, '.projectops', 'closure', `${PHASE}.json`),
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
    join(root, '.projectops', 'validation', `${head}.json`),
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
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'closure evidence and validator run');
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);

  return { root, origin, head, ctx: { sys: fixedClock(), root } as CommandContext };
}

/** The closure authority's reply. A fixture because the alternative is a paid call. */
function replyFor(root: string, over: Record<string, unknown> = {}): string {
  const subject = git(root, 'rev-parse', 'HEAD').trim();
  // The evidence subject is the commit the evidence record names, which is the FIRST commit — the
  // tail commit that carries the evidence itself is a descendant and is not the subject.
  const evidence = JSON.parse(
    readFileSync(join(root, '.projectops', 'closure', `${PHASE}.json`), 'utf8'),
  ) as { evidenceSubjectHead: string };
  void subject;
  return JSON.stringify({
    schemaVersion: CLOSURE_DECISION_SCHEMA_VERSION,
    decisionId: `${PHASE}-CLOSURE-DECISION1A`,
    decision: 'close',
    projectId: PROJECT,
    phaseId: PHASE,
    scope: PHASE_CLOSURE_SCOPE,
    decidedBy: DELEGATE,
    decidedAt: '2026-09-02T22:01:00+01:00',
    evidenceSubjectHead: evidence.evidenceSubjectHead,
    requestDigest: '<filled by the caller>',
    note: 'accepted for closure on the fixture evidence',
    ownerAcceptedFindings: [],
    ...over,
  });
}

/**
 * Ports for the request: everything real except ProjectOSHost's attested answer.
 *
 * THE REQUEST DIGEST IS THE ONE THE RUNTIME ACTUALLY SENT, taken from the call the fake Host received.
 * Hard-coding it would prove nothing — the point of the field is that the authority answers the
 * question that was asked. `sent` records the provider body the Host was handed.
 */
function fixtureDeps(sent: string[], mutate: (answer: Record<string, unknown>) => Record<string, unknown> = (a) => a): MakeClosureDeps {
  return (args) => {
    if (args.mode !== 'unattended') throw new Error('this fixture project is in unattended mode');
    const { root, config, consumedDecisionIds } = args;
    return {
    mode: 'unattended',
    hostReview: {
      reviewClosure(call: HostClosureReviewCall) {
        sent.push(call.body);
        const answer = mutate({ ...(JSON.parse(replyFor(root)) as Record<string, unknown>), requestDigest: call.requestDigest });
        const decision = String(answer['decision']);
        return {
          kind: 'attested' as const,
          record: answer,
          attestation: {
            schemaVersion: 1,
            attestationId: 'c'.repeat(64),
            requestCorrelation: call.correlation,
            providerResponseId: 'resp_closure_e2e',
            provider: 'fake-independent-provider',
            model: 'fake-model',
            verdict: decision in HOST_VERDICT_FOR_CLOSURE ? HOST_VERDICT_FOR_CLOSURE[decision as 'close'] : 'ChangesRequired',
            allowedActions: [],
            ownerApprovalRequired: true,
            costMicroUsd: 9_250,
            attestedAtEpochS: 1_788_000_000,
          },
          usage: { inputTokens: 5_000, cachedInputTokens: 0, outputTokens: 300 },
        };
      },
    },
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
    // The fixture forwards what the command derived, so the transport-layer replay refusal is
    // exercised by the same path production uses rather than by a hardcoded empty list.
    consumedDecisionIds,
    };
  };
}

describe('the synthetic Route-A chain', () => {
  it('reaches WAITING_OWNER automatically, and closes nothing on its own', () => {
    const w = world();
    const sent: string[] = [];
    const result = closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent));

    expect(result.code).toBe(0);
    expect(result.lines.join('\n')).toContain('WAITING_OWNER');
    expect(sent).toHaveLength(1);

    // The decision exists on disk and is NOT committed, so nothing about it is authority yet.
    const decisionPath = join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`);
    expect(existsSync(decisionPath)).toBe(true);
    // AND NOTHING ELSE IS DIRTY. The owner is asked to commit one file, so exactly one file may be
    // waiting to be committed — no ledger, no thread pointer, no work record.
    // AND NOTHING BEYOND WHAT THE ASK NAMES. Two paths may be waiting: the decision, and the ledger
    // entry the paid call produced — which the ask lists explicitly. No work record, no thread
    // pointer, no wait record (that one is ignored, by design), and nothing outside `.projectops`.
    const dirty = git(w.root, 'status', '--porcelain')
      .split(String.fromCharCode(10))
      .map((l) => l.trim())
      .filter((l) => l !== '');
    expect(dirty.every((l) => l.includes('.projectops/'))).toBe(true);
    expect(dirty.some((l) => l.includes('.projectops/closure/decisions'))).toBe(true);
    expect(dirty.some((l) => l.includes('gatekeeper-ledger'))).toBe(true);
    expect(dirty).toHaveLength(2);
    // The ask tells the owner about the second one rather than letting G4-13 surprise them later.
    expect(result.lines.join(String.fromCharCode(10))).toContain('gatekeeper-ledger.json');

    // The wait remembers the exact bytes.
    const read = readClosureWait(w.ctx.sys, w.root, PHASE);
    expect(read.ok && read.value?.state).toBe('WAITING_OWNER');
    expect(read.ok && read.value?.decisionSha256).toBe(closureDecisionSha256(readFileSync(decisionPath, 'utf8')));

    // AN UNCOMMITTED DECISION CANNOT CLOSE. This is the whole property, asserted against the real
    // closure path rather than against this route's own account of itself.
    const early = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(early.code).not.toBe(0);
    expect(early.lines.join('\n')).toContain('AWAITING_OWNER_COMMIT');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('resumes through the existing G4 path and reaches CLOSED after the owner commits', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    ownerCommits(w.root);
    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);

    expect(resumed.code).toBe(0);
    expect(resumed.lines.join('\n')).toContain('the owner committed');
    expect(phaseStatus(w.root)).toBe('closed');

    // Closed BY THE DELEGATE, on the committed decision, with the decision named on the history and
    // spent in the decision itself.
    const phase = JSON.parse(readFileSync(join(w.root, '.projectops', 'phases', `${PHASE}.json`), 'utf8')) as {
      history: { to: string; by: string; note: string }[];
    };
    const last = phase.history[phase.history.length - 1] as { to: string; by: string; note: string };
    expect(last.to).toBe('closed');
    expect(last.by).toBe('advisor');
    expect(last.note).toContain(`decision ${PHASE}-CLOSURE-DECISION1A`);
    const decision = JSON.parse(
      readFileSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`), 'utf8'),
    ) as { consumedAt?: string };
    expect(typeof decision.consumedAt).toBe('string');

    // And the wait is resolved, so it cannot describe an outstanding one.
    const read = readClosureWait(w.ctx.sys, w.root, PHASE);
    expect(read.ok && read.value?.state).toBe('CLOSED');
  });

  it('refuses when the owner commits a DIFFERENT decision from the one presented', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // One character changed before the commit — the owner commits bytes they were never shown.
    const path = join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`);
    writeFileSync(path, readFileSync(path, 'utf8').replace('accepted for closure', 'ACCEPTED FOR CLOSURE'));
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join('\n')).toContain('NOT the file that was presented');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses when a committed decision is edited afterwards in the working tree', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));
    ownerCommits(w.root);

    const path = join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`);
    writeFileSync(path, readFileSync(path, 'utf8').replace('accepted', 'laundered'));

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join('\n')).toContain('DECISION_DIRTY');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses a consumed decision a second time — a closure cannot be replayed', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));
    ownerCommits(w.root);
    expect(closure(w.ctx, { id: PHASE }, ['resume']).code).toBe(0);

    const again = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(again.code).not.toBe(0);
    expect(phaseStatus(w.root)).toBe('closed');
  });

  it('asks nobody a second time while a wait is outstanding', () => {
    const w = world();
    const sent: string[] = [];
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent));
    const second = closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent));
    expect(second.code).toBe(0);
    expect(second.lines.join('\n')).toContain('was NOT asked again');
    expect(sent).toHaveLength(1);
  });

  it('never asks, and never writes, when the phase is not eligible', () => {
    const w = world();
    // Dirty the tree: G4-13 now fails, and the closure authority must not be asked about work that
    // is not closable.
    writeFileSync(join(w.root, 'residue.txt'), 'unexplained');
    const sent: string[] = [];
    const result = closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('G4-13');
    expect(sent).toHaveLength(0);
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
  });

  it('refuses to spend without --execute, so a paid call cannot happen by typo', () => {
    const w = world();
    const sent: string[] = [];
    const result = closureRequest(w.ctx, { id: PHASE }, fixtureDeps(sent));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('Nothing was asked and nothing was spent');
    expect(sent).toHaveLength(0);
  });

  it('writes nothing when the authority declines to close', () => {
    const w = world();
    const sent: string[] = [];
    const result = closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent, (a) => ({ ...a, decision: 'do-not-close' })));
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('DECIDED_NOT_CLOSE');
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
    expect(readClosureWait(w.ctx.sys, w.root, PHASE).ok).toBe(true);
    expect((readClosureWait(w.ctx.sys, w.root, PHASE) as { value: unknown }).value).toBeNull();
  });

  it('writes nothing when the answer is a technical verdict wearing a closure record\'s shape', () => {
    const w = world();
    const sent: string[] = [];
    const result = closureRequest(
      w.ctx,
      { id: PHASE, execute: true },
      fixtureDeps(sent, (a) => ({ ...a, decision: 'APPROVED_FOR_CLOSURE' })),
    );
    expect(result.code).not.toBe(0);
    expect(result.lines.join('\n')).toContain('ANSWER_REFUSED');
    expect(existsSync(join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`))).toBe(false);
  });

  it('refuses a resume with no wait, so a hand-written committed decision cannot ride this route', () => {
    const w = world();
    // A decision appears and is committed, but this run never presented it.
    mkdirSync(join(w.root, '.projectops', 'closure', 'decisions'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json`),
      JSON.stringify({ schemaVersion: '1.0.0', decisionId: 'HAND-WRITTEN-DECISION1A', phaseId: PHASE }, null, 2) + '\n',
    );
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join('\n')).toContain('NO_CLOSURE_WAIT');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('leaves the existing manual closure path working — the same decision closes it by hand', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));
    ownerCommits(w.root);
    // Deleting the wait removes only THIS route's extra check; the pre-existing path is untouched.
    rmSync(join(w.root, '.projectops', 'closure', 'waits', `${PHASE}.json`), { force: true });

    const advanced = phaseCommand(w.ctx, { id: PHASE, to: 'closed', delegated: true }, ['advance']);
    expect(advanced.code).toBe(0);
    expect(phaseStatus(w.root)).toBe('closed');
  });
});

describe('only the owner-committed decision can close the phase', () => {
  it('refuses an owner ACKNOWLEDGEMENT that is not a commitment of the decision', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // The owner commits a receipt APPROVING closure — genuine owner authority, in the form the
    // rest of this programme uses for owner gates — and does NOT commit the decision.
    mkdirSync(join(w.root, '.projectops', 'gates'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'gates', `${PHASE}.phase-closure.json`),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          decisionId: 'OWNER-ACK-1A',
          projectId: PROJECT,
          phaseId: PHASE,
          gateName: 'phase-closure',
          ownerChoice: 'APPROVE',
          decidedBy: OWNER,
          evidenceSubjectHead: 'irrelevant',
        },
        null,
        2,
      ),
    );
    git(w.root, 'add', '--', '.projectops/gates');
    git(w.root, 'commit', '--quiet', '-m', 'owner: acknowledge closure');
    git(w.root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('AWAITING_OWNER_COMMIT');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses when a work record, findings and effects all claim the work is done', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // Everything an implementer CAN write, committed, claiming the phase is finished and approved.
    writeFileSync(
      join(w.root, '.projectops', 'work.v1.json'),
      JSON.stringify(
        {
          schemaVersion: '1.0.0',
          projectId: PROJECT,
          phaseId: PHASE,
          state: 'GATE_APPROVED',
          sessionId: null,
          attempt: null,
          subjectCommit: null,
          lastCompletedStep: 'everything',
          lastStopCode: null,
          lastStopDetail: null,
          evidenceSessionId: null,
          gateDecisionId: 'MADE-UP-DECISION1A',
          nextCandidateAction: 'phase-closure',
          ownerRequired: false,
          updatedAt: NOW,
        },
        null,
        2,
      ),
    );
    mkdirSync(join(w.root, '.projectops', 'execution'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'execution', 'claimed.findings.json'),
      JSON.stringify({ reviews: ['code', 'security'], findings: [] }),
    );
    writeFileSync(
      join(w.root, '.projectops', 'execution', 'claimed.effects.json'),
      JSON.stringify({ productionTouched: false, deploymentOccurred: false, databaseMutationOccurred: false, externalSendOccurred: false, paymentOccurred: false, rawSecretStored: false }),
    );
    git(w.root, 'add', '--', '.projectops/work.v1.json', '.projectops/execution');
    git(w.root, 'commit', '--quiet', '-m', 'implementer: claim the work is finished');
    git(w.root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('AWAITING_OWNER_COMMIT');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });
});


describe('the whole owner-commit bundle is byte-bound', () => {
  const LEDGER = '.projectops/gatekeeper-ledger.json';

  /** The ledger as it stands right now, so a test can mutate exactly what was presented. */
  const ledgerPath = (root: string): string => join(root, '.projectops', 'gatekeeper-ledger.json');

  it('presents BOTH files with their digests, and the wait records both', () => {
    const w = world();
    const result = closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));
    expect(result.code).toBe(0);

    const read = readClosureWait(w.ctx.sys, w.root, PHASE);
    const wait = read.ok ? read.value : null;
    expect(wait).not.toBeNull();
    const paths = (wait?.bundle ?? []).map((b) => b.path);
    expect(paths).toContain(`.projectops/closure/decisions/${PHASE}.json`);
    expect(paths).toContain(LEDGER);
    // The decision is first, and each entry carries the digest of the bytes now on disk.
    expect(paths[0]).toBe(`.projectops/closure/decisions/${PHASE}.json`);
    for (const entry of wait?.bundle ?? []) {
      expect(entry.sha256).toBe(closureDecisionSha256(readFileSync(join(w.root, ...entry.path.split('/')), 'utf8')));
      expect(result.lines.join(String.fromCharCode(10))).toContain(entry.sha256);
    }
  });

  it('REFUSES a one-byte LEDGER mutation made before the owner commits', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    const before = readFileSync(ledgerPath(w.root), 'utf8');
    const after = before.replace(/"costMicroUsd": (\d)/, (_m, d: string) => `"costMicroUsd": ${Number(d) + 1}`);
    expect(after).not.toBe(before);
    writeFileSync(ledgerPath(w.root), after);
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain(LEDGER);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('NOT the file that was presented');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses an EXTRA ledger entry added after WAITING_OWNER', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    const ledger = JSON.parse(readFileSync(ledgerPath(w.root), 'utf8')) as Record<string, unknown>;
    const entries = Array.isArray(ledger['entries']) ? (ledger['entries'] as unknown[]) : [];
    ledger['entries'] = [...entries, { requestId: 'CLREQ-smuggled', costMicroUsd: 1 }];
    writeFileSync(ledgerPath(w.root), JSON.stringify(ledger, null, 2) + String.fromCharCode(10));
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('NOT the file that was presented');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses OLDER ledger bytes than the ones presented', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    writeFileSync(ledgerPath(w.root), JSON.stringify({ schemaVersion: '1.0.0', entries: [] }, null, 2) + String.fromCharCode(10));
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses a correct decision committed WITHOUT the ledger', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // Only the decision is staged. The ledger stays out of the commit entirely.
    git(w.root, 'add', '--', '.projectops/closure/decisions');
    git(w.root, 'commit', '--quiet', '-m', 'owner: commit only the decision');
    git(w.root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('is not in a commit');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('a WORKING-TREE correction cannot substitute for a wrong committed blob', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    const presented = readFileSync(ledgerPath(w.root), 'utf8');
    writeFileSync(ledgerPath(w.root), presented.replace('"costMicroUsd"', '"costMicroUSD"'));
    ownerCommits(w.root);
    // Now put the RIGHT bytes back on disk. The blob in HEAD is still wrong.
    writeFileSync(ledgerPath(w.root), presented);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('NOT the file that was presented');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('an unrelated AUTHORITY path cannot ride inside the accepted bundle', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // The bundle is committed correctly — and a governance record is smuggled into the same commit.
    mkdirSync(join(w.root, '.projectops', 'authority'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'authority', 'closure-delegation.json'),
      JSON.stringify({ delegatedTo: 'Somebody', delegatedScope: ['phase-closure'] }, null, 2),
    );
    git(w.root, 'add', '--', '.projectops');
    git(w.root, 'commit', '--quiet', '-m', 'owner: closure bundle plus one more thing');
    git(w.root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    // THE BUNDLE ITSELF IS INTACT, and it is the BOUNDING check that refuses — named exactly, because
    // an earlier version of this assertion looked for "G4-12" and was satisfied by the words "G4-12"
    // inside the re-printed owner ask rather than by any refusal at all.
    expect(resumed.lines.join(String.fromCharCode(10))).toContain(
      "the owner's commit introduced 1 path(s) that were not in the bundle they were shown",
    );
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('.projectops/authority/closure-delegation.json');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('a file dropped into a CLOSURE-TAIL path during the wait cannot ride in either', () => {
    // THE GAP THE ECC SECURITY REVIEW FOUND, in its exact shape. `.projectops/closure/` is a
    // closure-tail path, so G4-12 waves it through as non-substantive; and it appeared AFTER the
    // bundle snapshot, so the bundle never named it. Before the bounding check, this rode into the
    // owner's commit completely unexamined — and the owner's own broad `git add` is how it happens.
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    writeFileSync(
      join(w.root, '.projectops', 'closure', 'SMUGGLED-EVIDENCE1A.json'),
      JSON.stringify({ phaseId: 'SMUGGLED-EVIDENCE1A', validatorsPass: true, reviewsComplete: true }, null, 2),
    );
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('were not in the bundle they were shown');
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('SMUGGLED-EVIDENCE1A.json');
    // And the bundle's own two files were fine — this is a refusal the byte check could never make.
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('ok   .projectops/gatekeeper-ledger.json');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses a decoy whose name differs from the decision only by an invisible character', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // Real git, real file: the decision's own path plus a non-breaking space. An earlier parser
    // trimmed it and compared it equal to the decision, so it was never digested and never named.
    const decoy = join(w.root, '.projectops', 'closure', 'decisions', `${PHASE}.json\u00a0`);
    writeFileSync(decoy, JSON.stringify({ decision: 'close', note: 'not the answer you were shown' }));
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('were not in the bundle they were shown');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('G4 still sees only the explicitly allowed closure-tail state on the accepted path', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));
    ownerCommits(w.root);

    const subject = (
      JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`), 'utf8')) as {
        evidenceSubjectHead: string;
      }
    ).evidenceSubjectHead;
    const changed = git(w.root, 'diff', '--name-only', `${subject}..HEAD`)
      .split(String.fromCharCode(10))
      .map((l) => l.trim())
      .filter((l) => l !== '');
    // Everything that moved since the evidence subject is closure-tail state, and the bundle is in it.
    for (const path of changed) {
      expect(
        path.startsWith('.projectops/closure/') ||
          path.startsWith('.projectops/phases/') ||
          path.startsWith('.projectops/validation/') ||
          path === '.projectops/gatekeeper-ledger.json',
      ).toBe(true);
    }
    expect(changed).toContain('.projectops/gatekeeper-ledger.json');
    expect(closure(w.ctx, { id: PHASE }, ['resume']).code).toBe(0);
    expect(phaseStatus(w.root)).toBe('closed');
  });
});

describe('the identity that made the commit', () => {
  it('REFUSES a decision commit made by the implementer, not just an unrelated one', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    // The implementer's ordinary `git add -A && git commit` sweep picks the decision up.
    git(w.root, 'config', 'user.name', 'Claude');
    git(w.root, 'config', 'user.email', 'claude@anthropic.invalid');
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('the implementer can never satisfy the owner');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });

  it('refuses a commit made under an identity the plan does not record as owner', () => {
    const w = world();
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps([]));

    git(w.root, 'config', 'user.name', 'Someone Else');
    ownerCommits(w.root);

    const resumed = closure(w.ctx, { id: PHASE }, ['resume']);
    expect(resumed.code).not.toBe(0);
    expect(resumed.lines.join(String.fromCharCode(10))).toContain('Someone Else');
    expect(phaseStatus(w.root)).toBe('awaiting_closure');
  });
});

describe('the request the authority actually receives', () => {
  it('is derived deterministically from the evidence it carries, and asks the closure question', () => {
    const w = world();
    const sent: string[] = [];
    closureRequest(w.ctx, { id: PHASE, execute: true }, fixtureDeps(sent));
    const body = JSON.parse(sent[0] as string) as { instructions: string; input: { content: { text: string }[] }[] };
    const text = body.input[0]?.content[0]?.text ?? '';
    const lines = text.split(String.fromCharCode(10));

    // THE HEADER STATES THE THREE IDENTITIES, each at its own position.
    const statedEvidenceDigest = (lines[2] ?? '').replace('evidenceDigest: ', '');
    const evidenceText = lines.slice(4).join(String.fromCharCode(10));
    // The digest the request states IS the digest of the evidence it actually carried.
    expect(statedEvidenceDigest).toBe(closureEvidenceDigest(evidenceText));

    const subjectHead = (
      JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`), 'utf8')) as {
        evidenceSubjectHead: string;
      }
    ).evidenceSubjectHead;
    const expectedId = deriveClosureRequestId({
      projectId: PROJECT,
      phaseId: PHASE,
      subjectHead,
      evidenceDigest: statedEvidenceDigest,
    });
    expect(lines[0]).toBe(`requestId: ${expectedId}`);
    expect(lines[1]).toBe(
      `requestDigest: ${closureRequestDigest({
        schemaVersion: CLOSURE_REQUEST_SCHEMA_VERSION,
        requestId: expectedId,
        projectId: PROJECT,
        phaseId: PHASE,
        subjectHead,
        evidenceDigest: statedEvidenceDigest,
        expectedDecider: DELEGATE,
        scope: PHASE_CLOSURE_SCOPE,
      })}`,
    );

    // AND IT IS THE CLOSURE QUESTION, not a technical review.
    expect(body.instructions).toContain('  ask: closure-review');
    expect(body.instructions).toContain('CLOSURE AUTHORITY');
    expect(body.instructions).toContain(`  subject: ${subjectHead}`);
  });
});

/** The owner's action, and only the owner's action: commit the decision, and push it. */
function ownerCommits(root: string): void {
  // EVERYTHING THE ASK NAMES: the decision, and the accounting the call left beside it.
  git(root, 'add', '--', '.projectops');
  git(root, 'commit', '--quiet', '-m', 'owner: commit the closure decision');
  git(root, 'push', '--quiet', PUSH_REMOTE, `${BRANCH}:${BRANCH}`);
}

function phaseStatus(root: string): string {
  return (JSON.parse(readFileSync(join(root, '.projectops', 'phases', `${PHASE}.json`), 'utf8')) as { status: string }).status;
}
