/**
 * The whole B6 chain, through the canonical loop, against a real repository.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM THE OTHERS. `technicalContinuation.test.ts` proves the
 * executor and `conditionalTechnicalFloor.test.ts` proves the authority split, both by calling those
 * pieces directly. Neither proves the thing that was actually missing: that a finished run REACHES
 * them. For the whole of this phase it did not — `decideContinuation` returned `proceed`, the loop
 * ended having asked nobody anything, and the executor could not have been invoked by any real run.
 *
 * So this exercises `runLoop` itself, with a real git worktree and a real local bare remote, and a
 * fixture only where a fixture is honest: the worker (a process we do not want to spawn) and the
 * gatekeeper's HTTP reply (a paid call we must not make). Everything between them — the stop, the
 * routing, the request, the decision check, the delegation read from the committed record, the
 * candidate identity, the executor and git itself — is the real thing.
 *
 * THREE PROOFS, AND NO MORE. One positive, one drift refusal, one protected-action refusal. Each is
 * asserted against the repository afterwards rather than against the loop's own account of itself.
 *
 * Created in PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runLoop } from '../src/loop/runner.js';
import { performableTechnicalActions } from '../src/loop/technicalContinuation.js';
import { inMemoryResolverForTests } from '../src/loop/credentialResolver.js';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import { APPROVED_PILOT_POLICY, GATEKEEPER_DECISION_SCHEMA_VERSION } from '@projectos/core';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import { TECHNICAL_ACTIONS } from '@projectos/core';
import type { System } from '../src/system.js';
import { run as runCommand, continueCommand, foldRunRecords } from '../src/commands/run.js';
import { closurePrepare } from '../src/commands/closure.js';
import { evaluateG4 } from '../src/closureGate.js';
import { continueProgramme, phaseAttemptOf } from '../src/loop/programmeContinuation.js';
import { createLifecycleRecorder } from '../src/phaseProgress.js';
import { loadGovernedContext } from '../src/governedContext.js';

const GIT = resolveBoundGit(process.env) as string;
const REF = 'PROJECTOS_GATEKEEPER_OPENAI_KEY';
const PHASE = 'E2E-TECHNICAL-CONTINUATION1A';
const WORKER_KIND = 'test-worker';
const OWNER = 'Murad';
const DELEGATE = 'ChatGPT';
const PROGRAMME = 'e2e-programme';
const BRANCH = 'work';
const NOW = '2026-09-01T22:00:00Z';

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

/** A `System` that is real in every way except the clock, which is fixed so ids are derivable. */
function fixedClock(): System {
  return { ...nodeSystem, now: () => NOW };
}

interface World {
  readonly root: string;
  readonly origin: string;
  readonly head: string;
}

/**
 * A governed project on disk: committed config, plan, phase record and delegation, plus an origin.
 *
 * Everything the runtime reads through git — the config, the delegation — is COMMITTED, because that
 * is the only form in which either counts.
 */
function world(
  over: {
    ownerGates?: readonly string[];
    /** The phase record's status at the start, for the selection-stop proofs. */
    phaseStatus?: string;
    /** Record the phase as complete in the declared current state. */
    completed?: boolean;
    /** Keep a plan-level closure delegation, so `closure request` gets as far as G4. */
    closureDelegation?: boolean;
    /** The phase's approved scope prose; empty by default. It grants nothing. */
    scope?: string;
    /** The phase's approved writePaths — the write grant; absent by default. */
    writePaths?: readonly string[];
    /** A committed `.gitignore`. */
    gitignore?: string;
  } = {},
): World {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-e2e-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-e2e-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS E2E');

  const config = {
    schemaVersion: '1.0.0',
    projectId: 'e2e',
    projectName: 'E2E',
    // The identity of the repository this fixture ACTUALLY has, normalised the same way the runtime
    // normalises it. Declaring a plausible-looking GitHub path instead would fail the context check
    // for a reason that has nothing to do with what is being proven.
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
    execution: { workers: [{ workerId: 'test', kind: WORKER_KIND, command: '/usr/local/bin/test-worker' }] },
  };
  // DERIVED FROM THE REAL PLAN, NOT HAND-BUILT.
  //
  // The readiness evaluator checks a great deal more than the schema — that phases map validators,
  // that governance forbids a specific set of actions, that environments and providers agree. Hand
  // authoring a fixture that satisfies all of it means encoding the evaluator's rules a second time
  // in a test, where they rot silently. Taking the project's own PLAN READY record and overriding
  // only what must differ keeps this fixture honest as those rules change.
  const realPlan = JSON.parse(
    readFileSync(new URL('../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const plan = {
    ...realPlan,
    projectId: 'e2e',
    projectName: 'E2E',
    programmeId: PROGRAMME,
    planId: 'plan-e2e',
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
        description: 'prove the technical continuation reaches the executor',
        scope: over.scope ?? '',
        ...(over.writePaths === undefined ? {} : { writePaths: over.writePaths }),
        dependsOn: [],
        requiredReviews: [],
        requiredBrowserProof: false,
        // Standing protections by default — never a continuation action, so nothing is pending.
        requiredOwnerGates: over.ownerGates ?? ['secrets-handling', 'payment-or-live-charge'],
      },
    ],
    governance: {
      ...(realPlan['governance'] as Record<string, unknown>),
      owner: OWNER,
      gatekeeper: DELEGATE,
      closureAuthority: DELEGATE,
      // The fixture's delegation is programme-scoped to this fixture, so the plan must not carry the
      // real project's closure delegation into it.
      closureDelegation: undefined,
    },
  } as Record<string, unknown>;
  delete (plan as { governance?: Record<string, unknown> }).governance?.['closureDelegation'];
  if (over.closureDelegation === true) {
    (plan['governance'] as Record<string, unknown>)['closureDelegation'] = {
      delegatedBy: OWNER,
      delegatedTo: DELEGATE,
      delegationDate: '2026-09-01',
      delegatedScope: ['phase-closure', 'programme-closure'],
      projectScope: 'e2e',
      excludesProtectedActions: true,
    };
  }

  const delegation = {
    schemaVersion: '1.0.0',
    delegationId: 'E2E-DELEGATION1A',
    projectId: 'e2e',
    programmeScope: PROGRAMME,
    delegatedBy: OWNER,
    delegatedTo: DELEGATE,
    delegatedScope: ['phase-closure', 'programme-closure', 'gatekeeper-review-decisions', 'technical-continuation'],
    delegationDate: '2026-09-01',
    excludesProtectedActions: true,
  };

  // THE VALIDATOR THE PLAN REQUIRES, present and passing. The phase inherits `requiredValidators`
  // from the real plan, and a check that cannot run is a failing check — which stops the loop long
  // before the thing this file exists to prove.
  mkdirSync(join(root, 'projectos', 'validators'), { recursive: true });
  writeFileSync(
    join(root, 'projectos', 'validators', 'validate-all.cjs'),
    'console.log("validate-all: fixture PASS");',
  );
  mkdirSync(join(root, '.projectops', 'authority'), { recursive: true });
  mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.projectops', 'authority', 'closure-delegation.json'), JSON.stringify(delegation, null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(
    join(root, 'state', 'current.json'),
    JSON.stringify(
      over.completed === true ? { completedPhases: [PHASE], activePhase: null } : { completedPhases: [], activePhase: PHASE },
      null,
      2,
    ),
  );
  writeFileSync(
    join(root, '.projectops', 'phases', `${PHASE}.json`),
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        phaseId: PHASE,
        // A READABLE record only when a status is asked for: the default fixture has always been an
        // unreadable record the loop starts afresh, and the proofs above depend on that.
        ...(over.phaseStatus === undefined ? {} : { project: 'e2e' }),
        status: over.phaseStatus ?? 'implementing',
        objective: 'prove the chain',
        history: [],
      },
      null,
      2,
    ),
  );

  if (over.gitignore !== undefined) writeFileSync(join(root, '.gitignore'), over.gitignore);
  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
  // `expectedRemote` is compared by name, so the origin URL must parse to `acme/e2e`.
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim(), ...({} as object) } as World;
}

/**
 * A worker that leaves a real candidate and a truthful attestation, and spawns nothing.
 *
 * `write` is what the "work" actually is — the bytes a continuation would commit.
 */
function adapterWriting(root: string, sessionOf: () => string, write: () => void): AdapterRegistry {
  const adapter: WorkerAdapter = {
    kind: WORKER_KIND,
    start: () => {
      write();
      const session = sessionOf();
      mkdirSync(join(root, '.projectops', 'execution'), { recursive: true });
      writeFileSync(
        join(root, '.projectops', 'execution', `${session}.findings.json`),
        JSON.stringify({ reviews: [], findings: [] }),
      );
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
    },
    // NEVER REACHED HERE, AND LOUD IF IT EVER IS. Every proof below is a first attempt: the work is
    // written once and reviewed once. A rejoin would mean the loop took a correction path these
    // tests do not exercise, so it refuses rather than silently writing the candidate a second time.
    rejoin: () => ({ kind: 'refused', detail: 'this proof never rejoins a worker' }),
  };
  return { [WORKER_KIND]: adapter } as unknown as AdapterRegistry;
}

/** The reviewer's reply. A fixture because the alternative is a paid call. */
function decisionBody(allowedActions: readonly string[]): string {
  return JSON.stringify({
    id: 'resp_e2e',
    created_at: NOW,
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
              decision: 'APPROVED_TO_PROCEED',
              reason: 'checks pass, reviews recorded, candidate reviewed',
              nextClaudeInstruction: 'carry out the approved technical continuation',
              allowedActions: [...allowedActions],
              forbiddenActions: ['production-deploy'],
              ownerApprovalRequired: false,
              risks: [],
              carryForward: [],
            }),
          },
        ],
      },
    ],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100 },
  });
}

function gatekeeperDeps(root: string, allowedActions: readonly string[], sent: string[] = []) {
  return {
    transport: {
      transportId: 'openai-primary',
      kind: 'openai-responses' as const,
      model: 'gpt-5.6-terra',
      capabilities: ['submit-request', 'receive-decision'],
      credentialRef: REF,
      commercialApproval: true,
    },
    availability: { reachable: true },
    resolver: inMemoryResolverForTests(REF, 'sk-test-000000000000000000'),
    http: {
      post(req: { body: string }) {
        sent.push(req.body);
        return { kind: 'response', status: 200, body: decisionBody(allowedActions) } as const;
      },
    },
    modelPolicy: APPROVED_PILOT_POLICY,
    rateCards: { 'gpt-5.6-terra': RATE, 'gpt-5.6-luna': RATE },
    budget: { warnAtMicroUsd: 2_000_000, hardStopAtMicroUsd: 5_000_000 },
    ledger: [],
    threadBinding: {
      schemaVersion: '1.0.0',
      projectId: 'e2e',
      repositoryRoot: root,
      providerThreadId: 'resp_7f3a9c2e5b81d40a',
      transportId: 'openai-primary',
      createdAt: '2026-09-01T21:00:00Z',
    },
    transportDecider: DELEGATE,
    consumedDecisionIds: [],
  };
}

/** The stop the loop actually reached, from its own reported outcome. */
function run(
  sys: System,
  w: World,
  adapters: AdapterRegistry,
  allowedActions: readonly string[],
  sent: string[] = [],
  states: string[] = [],
) {
  return runLoop(sys, w.root, {
    adapters,
    expectedDecider: DELEGATE,
    gatekeeper: gatekeeperDeps(w.root, allowedActions, sent) as never,
    onWorkState: (p: { state: string }) => {
      states.push(p.state);
    },
    invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
  });
}

/** The LAST durable work state a run reported — what an operator and B8 would later read. */
function finalState(states: readonly string[]): string {
  return states.length === 0 ? '(none)' : String(states[states.length - 1]);
}

describe('the governed chain, end to end', () => {
  it('POSITIVE: finished work is reviewed, then committed and pushed by the loop itself', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
    });
    // The session id is derived by the loop; the worker needs it to name its records. Deriving it the
    // same way the loop does would duplicate that logic here, so the adapter is handed a late-bound
    // getter and the loop's own first line supplies it.
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    expect(first.ok).toBe(true);
    session = String((first as { sessionId?: string }).sessionId ?? '');
    expect(session).not.toBe('');

    const states: string[] = [];
    const r = run(sys, w, adapters, ['commit', 'push'], sent, states);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // A CONTINUATION THAT HAPPENED IS COMPLETE, and the durable record says so.
    expect(r.stop).toBeNull();
    expect(finalState(states)).toBe('COMPLETE');

    // THE REVIEWER WAS ASKED, and asked about the success stop rather than a failure.
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.join('\n')).toContain('CONTINUATION_READY');
    // AND THE CANDIDATE WAS IN WHAT IT WAS SHOWN — the binding this phase exists for.
    expect(sent.join('\n')).toContain('delivered.txt');
    // AND THE REVIEWER WAS TOLD THE ONLY WORDS THAT AUTHORISE ANYTHING. The first live B9 approval
    // named "perform-the-bounded-technical-continuation" and put commit and push under forbidden -
    // an approval of nothing ProjectOS performs - because nothing had told it the dispatcher's
    // closed vocabulary. Every performable action must be named, by its exact string, in the
    // evidence the decision is bound to.
    const shown = sent.join(String.fromCharCode(10));
    // The evidence JSON travels as a STRING inside the request body, so its quotes arrive escaped;
    // matching the escaped form is what proves the exact action name, not a word in prose.
    // EVERY ACTION THIS RUNTIME CAN PERFORM, AND NOT ONE IT CANNOT.
    //
    // The list is what the runtime can do HERE, not the whole vocabulary: this fixture configures no
    // integration target, so `ff-only-integration` could only ever have been refused by the executor.
    // Offering it made the question unanswerable, and a live reviewer said so - it declined to
    // authorise anything until the requested scope was reconciled with the plan's own constraint.
    for (const action of performableTechnicalActions(null)) {
      expect(shown, `evidence must name '${action}'`).toContain(`\\"${action}\\"`);
    }
    expect(shown, 'an action the runtime cannot perform must not be offered').not.toContain('\\"ff-only-integration\\"');
    expect(shown).toContain('performableActions');
    // AND WHAT THE OWNER HAS ALREADY ESTABLISHED. A reviewer that cannot see whether a mandatory
    // prerequisite is in place refuses and refers to the owner - which is what happened live.
    // The grant is now the approved writePaths' (PROJECTOS-FINISH-WRITEPATHS1A); the retired record is not named.
    expect(shown).toContain('workerScopeWriteGrant');
    expect(shown).not.toContain('workerSourceWriteGrant');
    // AND WHICH VERDICT CARRIES IT. Attempt 4 answered APPROVED_TO_PUSH - an owner-gated verdict the
    // contract refuses without ownerApprovalRequired - because nothing said a delegated continuation
    // travels as APPROVED_TO_PROCEED.
    // The evidence is pretty-printed before it is embedded, so the key/value pair carries a space.
    expect(shown).toContain(`\\"verdictToUse\\": \\"APPROVED_TO_PROCEED\\"`);

    // THE REPOSITORY IS THE PROOF, not the loop's account of itself.
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
    const head = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(head).not.toBe(w.head);
    expect(git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/)).toContain('delivered.txt');
    // Pushed, and origin agrees. 0/0 both ways.
    expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(head);
    expect(git(w.root, 'rev-list', '--count', `origin/${BRANCH}..HEAD`).trim()).toBe('0');
    expect(git(w.root, 'rev-list', '--count', `HEAD..origin/${BRANCH}`).trim()).toBe('0');
  });

  // PROJECTOS-BOOT-CONTINUE1A. A plan that reserves commit and push in PROSE must get the same
  // protection as one that names the tokens: the delegation and an approving reviewer are both in
  // place, and still nothing is committed or pushed.
  for (const [label, prose] of [
    ['named actions', 'Commit, push, merge and phase closure remain owner-gated.'],
    ['an unclassifiable reservation', 'Implementation stays inside a clean worktree, never the primary checkout.'],
  ] as const) {
    it(`NEGATIVE (prose owner gate: ${label}): no commit and no push under the delegation`, () => {
      const sys = fixedClock();
      const w = world({ ownerGates: [prose] });
      let session = '';
      const adapters = adapterWriting(w.root, () => session, () => {
        writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
      });
      const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
      expect(first.ok).toBe(true);
      session = String((first as { sessionId?: string }).sessionId ?? '');

      const r = run(sys, w, adapters, ['commit', 'push']);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('unreachable');
      // Stopped for the owner, not completed.
      expect(r.stop).not.toBeNull();

      // THE REPOSITORY IS THE PROOF: nothing committed, nothing pushed.
      expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
      expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
      expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
    });
  }

  it('NEGATIVE (drift): a candidate changed after the decision commits nothing', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');

    // The reviewer answers, and the candidate changes underneath before the executor acts. The HTTP
    // fixture is the seam where that can happen at exactly the right moment.
    const deps = gatekeeperDeps(w.root, ['commit', 'push'], sent);
    const drifting = {
      ...deps,
      http: {
        post(req: { body: string }) {
          sent.push(req.body);
          writeFileSync(join(w.root, 'delivered.txt'), 'the work, altered\n');
          return { kind: 'response', status: 200, body: decisionBody(['commit', 'push']) } as const;
        },
      },
    };
    const states: string[] = [];
    const r = runLoop(sys, w.root, {
      adapters,
      expectedDecider: DELEGATE,
      gatekeeper: drifting as never,
      onWorkState: (p: { state: string }) => {
        states.push(p.state);
      },
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // THE HIGH FINDING. A refused continuation used to leave `stop` null, so the durable state was
    // written COMPLETE for a phase whose commit had just been refused. The refusal is now a standing
    // stop, and it carries its reason rather than merely its existence.
    expect(finalState(states)).toBe('BLOCKED');
    expect(r.stop?.code).toBe('CONTINUATION_READY');
    expect(String(r.stop?.detail)).toContain('refused');

    // NOTHING WAS COMMITTED, and the run says why.
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
    expect(r.lines.join('\n')).toContain('the candidate changed after the gatekeeper reviewed it');
  });

  it('NEGATIVE (remote moved): a push that cannot land leaves the run BLOCKED, not COMPLETE', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    const states: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');

    // SOMEBODY ELSE MOVES ORIGIN while the reviewer is answering. The executor reconciles with the
    // remote before acting and refuses, safely — and the point of this test is what the RECORD then
    // says. Before the correction it said COMPLETE.
    const other = mkdtempSync(join(tmpdir(), 'projectos-e2e-other-'));
    made.push(other);
    const deps = gatekeeperDeps(w.root, ['commit', 'push'], sent);
    const moving = {
      ...deps,
      http: {
        post(req: { body: string }) {
          sent.push(req.body);
          execFileSync(GIT, ['clone', '--quiet', w.origin, other], { stdio: 'pipe' });
          git(other, 'config', 'user.email', 'other@example.invalid');
          git(other, 'config', 'user.name', 'Other');
          writeFileSync(join(other, 'theirs.txt'), 'theirs');
          git(other, 'add', '--', 'theirs.txt');
          git(other, 'commit', '--quiet', '-m', 'theirs');
          git(other, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
          return { kind: 'response', status: 200, body: decisionBody(['commit', 'push']) } as const;
        },
      },
    };
    const r = runLoop(sys, w.root, {
      adapters,
      expectedDecider: DELEGATE,
      gatekeeper: moving as never,
      onWorkState: (p: { state: string }) => {
        states.push(p.state);
      },
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(finalState(states)).toBe('BLOCKED');
    expect(r.stop?.code).toBe('CONTINUATION_READY');
    expect(r.lines.join('\n')).toContain('has moved on by');
    // Nothing was committed, and the work is still sitting there.
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
  });

  it('NEGATIVE (protected): an approved protected action never reaches the executor', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');

    // THE FIRST BARRIER. The reviewer approves a protected action, and the decision is refused one
    // layer EARLIER than the executor: `checkGatekeeperDecision` rejects the whole record, because a
    // decision granting an owner-only action is not a usable decision at all. No verdict is applied,
    // so the continuation is never reached.
    const states: string[] = [];
    const r = run(sys, w, adapters, ['production-deploy', 'payment-or-live-charge'], sent, states);
    expect(r.ok).toBe(true);
    expect(finalState(states)).toBe('BLOCKED');
    const trace = r.lines.join('\n');
    expect(trace).toContain('the gatekeeper decision did not pass its own checks, so no verdict was applied');
    expect(trace).toContain("decision grants 'payment-or-live-charge', which is an owner-only action");
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
  });

  it('NEGATIVE (protected): a deployment the checker accepts still cannot be executed', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');

    // THE SECOND BARRIER, ON ITS OWN. `production-deploy` is not owner-only for this phase, so the
    // decision is well formed and the verdict IS applied — and the continuation still refuses it,
    // because it is not one of the three actions ProjectOS can perform. Proving this separately
    // matters: otherwise the protected-action guarantee would rest on the first barrier alone.
    const states: string[] = [];
    const r = run(sys, w, adapters, ['production-deploy'], sent, states);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // APPROVED TO PROCEED, AND NOTHING PERFORMED. That is not a finished phase either.
    expect(finalState(states)).toBe('BLOCKED');
    expect(r.stop?.code).toBe('CONTINUATION_READY');
    expect(r.lines.join('\n')).toContain('no technical action ProjectOS performs');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).not.toBe('');
  });
});

/**
 * THE REVIEW BOUNDARY: every candidate-producing write finishes BEFORE the candidate is frozen.
 *
 * THE DEFECT. `AWAITING_GATE` was reported inside `consultGatekeeper`, one step AFTER `evidenceFor`
 * had already sealed the candidate. The lifecycle recorder listens to that report, so it walked the
 * phase record from `validating` to `awaiting_review` and rewrote both
 * `.projectops/phases/<id>.json` and the declared current-state 250ms after the seal. Both are
 * DELIBERATELY inside the reviewed subject, so every continuation then refused -- correctly --
 * with "the candidate changed after the gatekeeper reviewed it". Proven from write timestamps:
 * evidence at T, phase record at T+250ms, current-state at T+425ms, provider decision at T+11.4s.
 *
 * The fix moves the report ahead of the freeze. It does NOT exclude those records from the
 * candidate, does not relax the digest comparison, and does not accept a stale review: drift stays
 * fail-closed, which is what the second test here pins.
 */
describe('the review boundary holds in both directions', () => {
  it('A+C: lifecycle writes land before the freeze, so an unchanged candidate proceeds', () => {
    const sys = fixedClock();
    const w = world();
    const sent: string[] = [];
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work' + String.fromCharCode(10));
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const states: string[] = [];
    const r = run(sys, w, adapters, ['commit'], sent, states);

    // The gate was announced, and the run reached its end without a drift refusal.
    expect(states).toContain('AWAITING_GATE');
    expect(JSON.stringify(r)).not.toContain('candidate changed after the gatekeeper reviewed it');
  });

  it('B+E: covered by the pre-existing NEGATIVE (drift) test, not duplicated here', () => {
    // An honest cross-reference instead of a second, weaker copy. The drift case is already proven
    // above by 'NEGATIVE (drift): a candidate changed after the decision commits nothing', which
    // writes to the tree from INSIDE the http.post handler -- genuinely after `evidenceFor` has
    // sealed the candidate -- and asserts the refusal unconditionally.
    //
    // The first draft of THIS test mutated the tree from the worker adapter, which runs BEFORE any
    // freeze. It could never produce drift, so it passed whether the protection worked, was
    // weakened, or was deleted. Review caught that it was vacuous for the exact property it was
    // named for. Deleting it and naming the test that does the work is more truthful than keeping
    // a green assertion that proves nothing.
    expect(true).toBe(true);
  });

  it('B: a run with NO reviewer configured never claims a gate it will not ask for', () => {
    // THE REGRESSION THE ORDERING FIX ALMOST SHIPPED, found by review. `AWAITING_GATE` used to sit
    // inside `consultGatekeeper`, after its `deps === undefined` early return. Moving it into
    // `evidenceFor` lost that guard: `onWorkState` is wired unconditionally while `gatekeeper` is
    // only present when configured, so a gatekeeper-less run -- the documented default build --
    // would have recorded `awaiting_review` for a phase no reviewer would ever see. `BLOCKED` maps
    // to no transition, so nothing would ever have moved it back.
    const sys = fixedClock();
    const w = world();
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work' + String.fromCharCode(10));
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const states: string[] = [];
    runLoop(sys, w.root, {
      adapters,
      onWorkState: (p: { state: string }) => { states.push(p.state); },
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    expect(states.length).toBeGreaterThan(0);
    expect(states).not.toContain('AWAITING_GATE');
  });
});

/**
 * CROSS-PHASE CONTINUATION ENDS ON SELECTION'S ANSWER, NOT A REFUSAL — PROJECTOS-BOOT-CONTINUE1A (G1).
 *
 * THE DEFECT. A phase that `run --continue` carried to completion moved to `awaiting_closure`, and
 * the very next pass asked selection, got OWNER_DECISION_REQUIRED, and `mayContinueAfter` read the
 * runner's `ok: false` as "the run refused to start" — so the SUCCESS case ended REFUSED, exit 1, and
 * the programme was handed back as though the environment were broken. These go through the real
 * loop and the real `run` command, not a fake `runPhase`.
 */
describe('cross-phase continuation carries selection stops as results', () => {
  it('REAL LOOP, TWO PASSES: a completed phase ends AWAITING_CLOSURE, never REFUSED', () => {
    const sys = fixedClock();
    const w = world();
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');

    // THE LIFECYCLE RECORDER `run` WIRES, wired the same way — it is what moves the phase record to
    // awaiting_closure, and without it the second pass would not see the state it must answer to.
    const gc = loadGovernedContext(sys, w.root);
    if (!gc.ok) throw new Error('fixture has no governed context');
    const recorder = createLifecycleRecorder(sys, w.root, gc.context, 'e2e');
    const states: string[] = [];
    const runPhase = () =>
      phaseAttemptOf(
        runLoop(sys, w.root, {
          adapters,
          expectedDecider: DELEGATE,
          gatekeeper: gatekeeperDeps(w.root, ['commit', 'push']) as never,
          onWorkState: (p) => {
            states.push(p.state);
            recorder.record(p);
          },
          invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute', '--continue'], cwd: w.root },
        }),
      );
    const r = continueProgramme({ runPhase });

    expect(states).toContain('COMPLETE');
    expect(r.phasesRun).toEqual([PHASE]);
    expect(r.end).toBe('AWAITING_CLOSURE');
    expect(r.closurePhaseId).toBe(PHASE);
    // Nothing here closed it: the record says awaiting_closure, and the owner-only floor still holds.
    const record = JSON.parse(readFileSync(join(w.root, '.projectops', 'phases', `${PHASE}.json`), 'utf8')) as { status: string };
    expect(record.status).toBe('awaiting_closure');
  });

  it('run --execute --continue at awaiting_closure HANDS OFF to the existing closure route, which decides', () => {
    const w = world({ phaseStatus: 'awaiting_closure' });
    const r = runCommand({ sys: fixedClock(), root: w.root }, { execute: true, continue: true, 'gate-wait-minutes': '0' });
    const text = r.lines.join('\n');
    expect(text).toContain('Programme continuation ended: AWAITING_CLOSURE');
    expect(text).not.toContain('Programme continuation ended: REFUSED');
    // THE SAME ROUTING `projectos continue` uses: nothing is prepared yet, so the first step is prepare.
    expect(text).toContain(`handing phase ${PHASE} to the existing closure route (projectos closure prepare --id ${PHASE})`);
    // THE EXISTING STEP ANSWERED, in its own words: this fixture's head has no upstream, so it is not
    // yet the subject a closure judges.
    expect(text).toContain('SUBJECT_NOT_PUSHED');
    expect(r.code).toBe(2);
    // AND CLOSED NOTHING, WROTE NOTHING.
    const record = JSON.parse(readFileSync(join(w.root, '.projectops', 'phases', `${PHASE}.json`), 'utf8')) as { status: string };
    expect(record.status).toBe('awaiting_closure');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
  });

  it('once the closure records are generated and committed, the hand-off reaches G4, which refuses unready work and asks nobody', () => {
    const w = world({ phaseStatus: 'awaiting_closure', closureDelegation: true });
    mkdirSync(join(w.root, '.projectops', 'closure'), { recursive: true });
    mkdirSync(join(w.root, '.projectops', 'validation'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'closure', `${PHASE}.json`),
      JSON.stringify({ phaseId: PHASE, evidenceSubjectHead: w.head, validatorsPass: true, checksPass: true }),
    );
    writeFileSync(join(w.root, '.projectops', 'validation', `${w.head}.json`), JSON.stringify({ schemaVersion: '1.1.0', subjectHead: w.head }));
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'closure records');
    const r = runCommand({ sys: fixedClock(), root: w.root }, { execute: true, continue: true, 'gate-wait-minutes': '0' });
    const text = r.lines.join('\n');
    expect(text).toContain(`handing phase ${PHASE} to the existing closure route (projectos closure request --id ${PHASE} --execute)`);
    expect(text).toContain('The closure authority is not asked about work that is not yet closable');
    expect(r.code).toBe(2);
  });

  it('FAILING closure records route back to closure prepare, never to a request G4 would refuse for ever', () => {
    const w = world({ phaseStatus: 'awaiting_closure', closureDelegation: true });
    mkdirSync(join(w.root, '.projectops', 'closure'), { recursive: true });
    mkdirSync(join(w.root, '.projectops', 'validation'), { recursive: true });
    writeFileSync(
      join(w.root, '.projectops', 'closure', `${PHASE}.json`),
      JSON.stringify({ phaseId: PHASE, evidenceSubjectHead: w.head, validatorsPass: false, checksPass: true }),
    );
    writeFileSync(join(w.root, '.projectops', 'validation', `${w.head}.json`), JSON.stringify({ schemaVersion: '1.1.0', subjectHead: w.head }));
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'closure records, recorded truthfully as failing');
    const r = runCommand({ sys: fixedClock(), root: w.root }, { 'dry-run': true, continue: true });
    expect(r.lines.join('\n')).toContain(`projectos closure prepare --id ${PHASE}`);
    expect(r.lines.join('\n')).not.toContain('projectos closure request');
  });

  it('a dry run names the next closure step and runs nothing', () => {
    const w = world({ phaseStatus: 'awaiting_closure' });
    const r = runCommand({ sys: fixedClock(), root: w.root }, { 'dry-run': true, continue: true });
    const text = r.lines.join('\n');
    expect(r.code).toBe(0);
    expect(text).toContain(`projectos closure prepare --id ${PHASE}`);
    expect(text).not.toContain('SUBJECT_NOT_PUSHED');
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
  });

  it('a finished plan ends PROGRAMME_COMPLETE, exit 0', () => {
    const w = world({ phaseStatus: 'closed', completed: true });
    const r = runCommand({ sys: fixedClock(), root: w.root }, { execute: true, continue: true });
    expect(r.lines.join('\n')).toContain('Programme continuation ended: PROGRAMME_COMPLETE');
    expect(r.code).toBe(0);
  });

  it('rolled_back is the owner\'s: STOPPED with its true reason, and NOT handed to closure', () => {
    const w = world({ phaseStatus: 'rolled_back' });
    const r = runCommand({ sys: fixedClock(), root: w.root }, { execute: true, continue: true });
    const text = r.lines.join('\n');
    expect(text).toContain('Programme continuation ended: STOPPED');
    expect(text).toContain('OWNER_DECISION_REQUIRED');
    expect(text).not.toContain('closure route');
    expect(r.code).toBe(0);
  });

  it('projectos continue exits NON-ZERO on a defect stop, and 0 on an owner stop (ECC CODE round 2 MED-7)', () => {
    // `closed` without being recorded complete is a record that disagrees with the plan: a defect.
    const defect = world({ phaseStatus: 'closed' });
    const d = continueCommand({ sys: fixedClock(), root: defect.root }, { execute: true });
    expect(d.lines.join('\n')).toContain('RECORD_DISAGREES_WITH_PLAN');
    expect(d.code).toBe(1);
    const owners = world({ phaseStatus: 'rolled_back' });
    expect(continueCommand({ sys: fixedClock(), root: owners.root }, { execute: true }).code).toBe(0);
  });

  it('a phase closed as blocked is STOPPED as PHASE_BLOCKED, not stepped over', () => {
    const w = world({ phaseStatus: 'closed_as_blocked' });
    const r = runCommand({ sys: fixedClock(), root: w.root }, { execute: true, continue: true });
    const text = r.lines.join('\n');
    expect(text).toContain('Programme continuation ended: STOPPED');
    expect(text).toContain('PHASE_BLOCKED');
  });
});

/**
 * CLOSURE EVIDENCE IS GENERATED FROM THE RUN'S OWN RECORDS — PROJECTOS-BOOT-CONTINUE1A (continuation three).
 *
 * A real loop run carries the phase to `awaiting_closure`; `closure prepare` then re-runs the phase's
 * checks at the clean, pushed subject and writes the three closure-tail records. G4 is asked of the
 * repository afterwards, not of the preparation's account of itself.
 */
describe('closure prepare generates the closure records from the run', () => {
  function runToAwaitingClosure(
    w: World,
    sys: System,
    deliver: readonly string[] = ['delivered.txt'],
    content: Readonly<Record<string, string>> = {},
  ): void {
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      for (const rel of deliver) {
        mkdirSync(join(w.root, ...rel.split('/').slice(0, -1)), { recursive: true });
        writeFileSync(join(w.root, ...rel.split('/')), content[rel] ?? 'the work\n');
      }
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const gc = loadGovernedContext(sys, w.root);
    if (!gc.ok) throw new Error('fixture has no governed context');
    const recorder = createLifecycleRecorder(sys, w.root, gc.context, 'e2e');
    runLoop(sys, w.root, {
      adapters,
      expectedDecider: DELEGATE,
      gatekeeper: gatekeeperDeps(w.root, ['commit', 'push']) as never,
      onWorkState: (p) => recorder.record(p),
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    git(w.root, 'branch', `--set-upstream-to=origin/${BRANCH}`);
  }
  function ownerCommitsAll(w: World, message: string): void {
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', message);
    git(w.root, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
  }

  it('while the run\'s own records are uncommitted it WAITS ON THE OWNER (exit 0), naming exactly them, and writes nothing', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    const before = git(w.root, 'status', '--porcelain', '--untracked-files=all');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('WAITING_OWNER_COMMIT (RUN_RECORDS_UNCOMMITTED)');
    expect(r.lines.join('\n')).toContain(`.projectops/phases/${PHASE}.json`);
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all')).toBe(before);
  });

  it('a committed but unpushed head WAITS for the owner\'s push (exit 0)', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'owner: lifecycle, not pushed');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('WAITING_OWNER_PUSH');
  });

  it('generates evidence, validation record and report, ProjectOS commits and pushes EXACTLY those three, and G4 accepts', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: commit the lifecycle records');
    const subject = git(w.root, 'rev-parse', 'HEAD').trim();

    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    const evidence = JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`), 'utf8')) as Record<string, unknown>;
    expect(evidence['evidenceSubjectHead']).toBe(subject);
    expect(evidence['validatorsPass']).toBe(true);
    expect(evidence['unresolvedCriticalOrHigh']).toBe(0);
    const validation = JSON.parse(readFileSync(join(w.root, '.projectops', 'validation', `${subject}.json`), 'utf8')) as Record<string, unknown>;
    expect(validation['subjectHead']).toBe(subject);
    expect(validation['workingTreeCleanAtRunStart']).toBe(true);
    expect(readFileSync(join(w.root, 'knowledge', 'reports', `${PHASE}-closure-evidence.md`), 'utf8')).toContain(subject);
    // COMMITTED AND PUSHED BY PROJECTOS, EXACTLY THESE THREE, as one commit on the subject
    // (PROJECTOS-FINISH-MULTIPROJECT1A): the phase leaves commit and push delegated.
    const three = [`.projectops/closure/${PHASE}.json`, `.projectops/validation/${subject}.json`, `knowledge/reports/${PHASE}-closure-evidence.md`].sort();
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim()).toBe('');
    expect(git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/).sort()).toEqual(three);
    expect(git(w.root, 'rev-parse', 'HEAD~1').trim()).toBe(subject);
    expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(git(w.root, 'rev-parse', 'HEAD').trim());
    expect(r.lines.join('\n')).toContain('committed and pushed 3 closure record(s)');
    const gc = loadGovernedContext(sys, w.root);
    if (!gc.ok) throw new Error('no context');
    const g4 = evaluateG4(sys, w.root, gc.context, PHASE, 'awaiting_closure', { ready: true, reasons: [] }, true, false);
    expect(g4.facts.validationRecordProblems).toEqual([]);
    expect(g4.facts.passingValidatorNames).toContain('validate-all');
    expect(g4.facts.evidenceReportPresent).toBe(true);
    expect(g4.facts.protectedEffectOccurred).toBe(false);
    expect(g4.facts.substantiveChangesSinceSubject).toEqual([]);
    // EVERY PREDICATE IS MET BY THE GENERATED RECORDS, for a project whose id is NOT 'projectos'
    // (PROJECTOS-FINISH-MULTIPROJECT1A): G4-1 now judges the governed project by its own id.
    expect(g4.verdict.unmet.map((u) => u.code)).toEqual([]);
    expect(g4.verdict.eligible).toBe(true);
  });

  it('work written into a NEW directory is the run\'s own: prepare binds it file by file, never as a collapsed dir/', () => {
    // FOUND LIVE: the run recorded `notes/` for a new untracked directory, and the subject binding then
    // refused `notes/phase-one.md` as a change the run did not make.
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys, ['notes/phase-one.md']);
    ownerCommitsAll(w, 'owner: lifecycle records');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.lines.join('\n')).not.toContain('SUBJECT_NOT_FROM_RUN');
    expect(r.code).toBe(0);
    const exec = join(w.root, '.projectops', 'execution');
    const ev = JSON.parse(readFileSync(join(exec, readdirSync(exec).find((f) => f.endsWith('.evidence.json')) as string), 'utf8')) as { changedFiles: string[] };
    expect(ev.changedFiles).toContain('notes/phase-one.md');
    expect(ev.changedFiles.some((f) => f.endsWith('/'))).toBe(false);
  });

  /**
   * PROJECTOS-FINISH-WRITEPATHS1A: the run rewrote its own required validator (here into text that is not
   * even JavaScript). The run judged with the BASE commit's validator, and closure preparation must judge
   * the subject with that same validator — not the one the phase itself wrote.
   */
  it("closure prepare judges with the run's BASE-COMMIT validator, never the copy the run itself rewrote", () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys, ['delivered.txt', 'projectos/validators/validate-all.cjs']);
    ownerCommitsAll(w, 'owner: lifecycle records');
    // The subject's validator is broken: run as the working tree has it, it cannot pass.
    expect(spawnSync(process.execPath, [join(w.root, 'projectos', 'validators', 'validate-all.cjs')], { cwd: w.root }).status).not.toBe(0);
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).not.toContain('FAIL validator validate-all');
    const evidence = JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`), 'utf8')) as Record<string, unknown>;
    expect(evidence['validatorsPass']).toBe(true);
  });

  it('without a proven technical delegation, closure prepare only GENERATES the three records and the owner commits them', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle');
    const subject = git(w.root, 'rev-parse', 'HEAD').trim();
    // THE COMMITTED DELEGATION, AS PREPARE READS IT, CARRIES NO TECHNICAL SCOPE. Changing the file itself
    // would put a change the run did not make on the subject (SUBJECT_NOT_FROM_RUN), so only the read
    // of the committed record is answered differently.
    const withoutTechnical: System = {
      ...sys,
      exec: (cmd, args, options) => {
        const shown = sys.exec(cmd, args, options);
        if (!args.includes('show') || !args.some((a) => a.includes('closure-delegation.json')) || shown.code !== 0) return shown;
        const d = JSON.parse(shown.stdout) as { delegatedScope: string[] };
        return { ...shown, stdout: JSON.stringify({ ...d, delegatedScope: d.delegatedScope.filter((s) => s !== 'technical-continuation') }) };
      },
    };
    const r = closurePrepare({ sys: withoutTechnical, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('left for the owner to commit and push');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(subject);
    const dirty = git(w.root, 'status', '--porcelain', '--untracked-files=all').trim().split(/\r?\n/).map((l) => l.slice(3).trim());
    expect(dirty.sort()).toEqual(
      [`.projectops/closure/${PHASE}.json`, `.projectops/validation/${subject}.json`, `knowledge/reports/${PHASE}-closure-evidence.md`].sort(),
    );
  });

  it("after an approved technical continuation the run's own records are committed and pushed, and the tree holds none", () => {
    const sys = fixedClock();
    const w = world();
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => writeFileSync(join(w.root, 'delivered.txt'), 'the work\n'));
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const gc = loadGovernedContext(sys, w.root);
    if (!gc.ok) throw new Error('fixture has no governed context');
    const recorder = createLifecycleRecorder(sys, w.root, gc.context, 'e2e');
    const result = runLoop(sys, w.root, {
      adapters,
      expectedDecider: DELEGATE,
      gatekeeper: gatekeeperDeps(w.root, ['commit', 'push']) as never,
      onWorkState: (p) => recorder.record(p),
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    git(w.root, 'branch', `--set-upstream-to=origin/${BRANCH}`);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const continuation = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim()).not.toBe('');
    // THE SAME STEP `run` TAKES after the loop (see runOnePhase), on the loop's own result.
    const folded = foldRunRecords({ sys, root: w.root }, result);
    expect(folded.lines.join('\n')).toContain('run record(s)');
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim()).toBe('');
    expect(git(w.root, 'rev-parse', 'HEAD~1').trim()).toBe(continuation);
    const committed = git(w.root, 'show', '--name-only', '--format=', 'HEAD').trim().split(/\r?\n/);
    expect(committed).toContain(`.projectops/phases/${PHASE}.json`);
    expect(committed.every((p) => p.startsWith('.projectops/'))).toBe(true);
    expect(committed.some((p) => p.startsWith('.projectops/closure/decisions/'))).toBe(false);
    expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(git(w.root, 'rev-parse', 'HEAD').trim());
    // And the next step is closure preparation on a clean, pushed tree — no owner commit in between.
    expect(closurePrepare({ sys, root: w.root }, { id: PHASE }).lines.join('\n')).toContain(`closure prepared for ${PHASE}`);
  });

  it('a validator that fails at the subject is recorded as failing, and G4 refuses on it', () => {
    const sys = fixedClock();
    const w = world();
    // A validator whose answer depends on an IGNORED file: it passes during the run and fails at the
    // subject, with no committed change between the two — the honest shape of "fails at the subject".
    writeFileSync(join(w.root, 'projectos', 'validators', 'validate-all.cjs'), 'if (require("fs").existsSync(".flaky")) process.exit(1); console.log("PASS");');
    writeFileSync(join(w.root, '.gitignore'), '.flaky\n');
    ownerCommitsAll(w, 'owner: a validator with an environmental dependency');
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle records');
    writeFileSync(join(w.root, '.flaky'), '');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('FAIL validator validate-all');
    const evidence = JSON.parse(readFileSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`), 'utf8')) as Record<string, unknown>;
    expect(evidence['validatorsPass']).toBe(false);
    // A FAILING RECORD IS NOT COMMITTED BY PROJECTOS (MULTIPROJECT1A fix round): it is left for the owner.
    expect(r.lines.join('\n')).not.toContain('committed and pushed');
    expect(git(w.root, 'status', '--porcelain', '--untracked-files=all').trim().split(/\r?\n/)).toHaveLength(3);
    const gc = loadGovernedContext(sys, w.root);
    if (!gc.ok) throw new Error('no context');
    expect(evaluateG4(sys, w.root, gc.context, PHASE, 'awaiting_closure', { ready: true, reasons: [] }, true, false).verdict.eligible).toBe(false);
  });

  it('REFUSES a subject carrying changes the run did not make — a check config or validator edited after the run', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    // ECC CODE HIGH-1: a committed config edit after the run that would drop a check, or a validator
    // weakened after it, must not ride on the run's review.
    writeFileSync(join(w.root, 'projectos', 'validators', 'validate-all.cjs'), 'console.log("weakened PASS");');
    ownerCommitsAll(w, 'owner: lifecycle records, and a validator changed outside the run');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('SUBJECT_NOT_FROM_RUN');
    expect(r.lines.join('\n')).toContain('projectos/validators/validate-all.cjs');
    expect(existsSync(join(w.root, '.projectops', 'closure', `${PHASE}.json`))).toBe(false);
  });

  it('REFUSES findings edited after the run was judged (a HIGH marked resolved, a review claimed)', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    const exec = join(w.root, '.projectops', 'execution');
    const findings = readdirSync(exec).find((f) => f.endsWith('.findings.json')) as string;
    writeFileSync(join(exec, findings), JSON.stringify({ reviews: ['ECC SECURITY review'], findings: [] }));
    ownerCommitsAll(w, 'owner: lifecycle records, with findings rewritten after the run');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('FINDINGS_NOT_BOUND');
  });

  it('says at prepare time that an unattested earlier run makes G4-11 refuse, and names it (ECC round 2 N4)', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    // An earlier run of the same phase that ended without an attestation (a timed-out worker).
    const exec = join(w.root, '.projectops', 'execution');
    writeFileSync(join(exec, 'aborted-run.session.json'), JSON.stringify({ sessionId: 'aborted-run', phaseId: PHASE }));
    writeFileSync(
      join(exec, 'aborted-run.evidence.json'),
      JSON.stringify({ sessionId: 'aborted-run', phaseId: PHASE, collectedAt: '2000-01-01T00:00:00Z', effectsSha256: null }),
    );
    ownerCommitsAll(w, 'owner: lifecycle records');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(0);
    const text = r.lines.join('\n');
    expect(text).toContain('G4-11 NOT ESTABLISHED');
    expect(text).toContain('aborted-run');
    expect(text).toContain('owner closure route');
  });

  it('refuses over uncommitted work that is not a closure record', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle');
    writeFileSync(join(w.root, 'unreviewed.txt'), 'x\n');
    const r = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('TREE_NOT_CLEAN');
    expect(r.lines.join('\n')).toContain('unreviewed.txt');
  });

  it('refuses a phase that is not awaiting closure, and writes nothing', () => {
    const w = world();
    const r = closurePrepare({ sys: fixedClock(), root: w.root }, { id: PHASE });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('REFUSED');
    expect(git(w.root, 'status', '--porcelain').trim()).toBe('');
  });

  it('projectos continue routes a finished, unprepared phase to closure prepare, then to the request', () => {
    const sys = fixedClock();
    const w = world();
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle');
    const r = continueCommand({ sys, root: w.root }, { execute: true });
    const text = r.lines.join('\n');
    expect(text).toContain(`closure-prepare → projectos closure prepare --id ${PHASE}`);
    expect(text).toContain(`closure prepared for ${PHASE}`);
    const next = continueCommand({ sys, root: w.root }, { 'dry-run': true });
    expect(next.lines.join('\n')).toContain(`closure-request → projectos closure request --id ${PHASE} --execute`);
  });
  // PROJECTOS-FINISH-CONTINUE-INTEGRITY1A (EXTERNAL-PROOF2A D7): one continue carries a phase through a
  // preparation that committed its records into the closure question, instead of stopping there.
  it('one continue carries on from a preparation that committed its records into the closure request', () => {
    const sys = fixedClock();
    const w = world({ closureDelegation: true });
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle');
    // The fixture has no gatekeeper configuration, so the request is interactive; it must not hold the gate.
    const r = continueCommand({ sys, root: w.root }, { execute: true, 'gate-wait-minutes': '0' });
    const text = r.lines.join('\n');
    expect(text).toContain(`closure prepared for ${PHASE}`);
    expect(text).toContain('committed and pushed 3 closure record(s)');
    expect(text).toContain(`carrying on: projectos closure request --id ${PHASE} --execute`);
    // AND THE REQUEST ACTUALLY RAN: the closure question was formed and put to the (interactive) authority.
    expect(text).toContain(`interactive closure request`);
    expect(text).toContain(`for ${PHASE}`);
  });

  it('a preparation that only GENERATES its records (no technical delegation) stops there, as before', () => {
    const sys = fixedClock();
    const w = world({ closureDelegation: true });
    runToAwaitingClosure(w, sys);
    ownerCommitsAll(w, 'owner: lifecycle');
    // The committed delegation, as prepare reads it, carries no technical scope; see the test above that
    // proves prepare then only generates.
    const withoutTechnical: System = {
      ...sys,
      exec: (cmd, args, options) => {
        const shown = sys.exec(cmd, args, options);
        if (!args.includes('show') || !args.some((a) => a.includes('closure-delegation.json')) || shown.code !== 0) return shown;
        const d = JSON.parse(shown.stdout) as { delegatedScope: string[] };
        return { ...shown, stdout: JSON.stringify({ ...d, delegatedScope: d.delegatedScope.filter((s) => s !== 'technical-continuation') }) };
      },
    };
    const r = continueCommand({ sys: withoutTechnical, root: w.root }, { execute: true, 'gate-wait-minutes': '0' });
    const text = r.lines.join('\n');
    expect(text).toContain(`closure prepared for ${PHASE}`);
    expect(text).not.toContain('carrying on:');
  });

  // PROJECTOS-FINISH-CONTINUE-INTEGRITY1A (EXTERNAL-PROOF2A D8): a phase granted its own required validator
  // is judged by its new copy as well as the base copy.
  it('a phase granted its own required validator that BREAKS it fails on the phase copy, though the base copy passes', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['./delivered.txt', 'projectos/validators/validate-all.cjs'] });
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      writeFileSync(join(w.root, 'delivered.txt'), 'the work\n');
      writeFileSync(join(w.root, 'projectos', 'validators', 'validate-all.cjs'), 'process.exit(3);\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const r = runLoop(sys, w.root, {
      adapters,
      expectedDecider: DELEGATE,
      gatekeeper: gatekeeperDeps(w.root, ['commit', 'push']) as never,
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    const text = r.lines.join('\n');
    expect(text).toContain('PASS validator validate-all');
    expect(text).toContain('FAIL validator validate-all@phase-copy');
    // NOTHING WAS COMMITTED: the run stopped on the failing check, with HEAD where it started.
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.stop).not.toBeNull();
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  });

  it('a phase granted its own required validator that CHANGES it and keeps it passing runs BOTH copies, in the run and in closure preparation', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['./delivered.txt', 'projectos/validators/validate-all.cjs'] });
    runToAwaitingClosure(w, sys, ['delivered.txt', 'projectos/validators/validate-all.cjs'], {
      'projectos/validators/validate-all.cjs': 'console.log("validate-all: the phase\'s hardened copy PASS");\n',
    });
    const exec = join(w.root, '.projectops', 'execution');
    const ev = JSON.parse(readFileSync(join(exec, readdirSync(exec).find((f) => f.endsWith('.evidence.json')) as string), 'utf8')) as { checks: { id: string; passed: boolean }[] };
    // The phase changed its validator: both the base copy and the phase's own copy ran, and both passed.
    expect(ev.checks.map((c) => `${c.id}:${c.passed}`).sort()).toEqual(['validate-all:true', 'validate-all@phase-copy:true']);
    expect(readFileSync(join(w.root, 'projectos', 'validators', 'validate-all.cjs'), 'utf8')).toContain('hardened copy');
    ownerCommitsAll(w, 'owner: lifecycle');
    const prepared = closurePrepare({ sys, root: w.root }, { id: PHASE });
    expect(prepared.code, prepared.lines.join('\n')).toBe(0);
    expect(prepared.lines.join('\n')).toContain('PASS validator validate-all@phase-copy');
  });
});

/**
 * THE IMPLEMENTER WRITES EXACTLY THE APPROVED SCOPE — through the real loop (continuation five).
 */
describe('the worker write grant comes from the approved writePaths, at dispatch', () => {
  /** An adapter that records the argv it was started with, and writes the run's two records. */
  function recordingAdapter(root: string, sessionOf: () => string, seen: string[][]): AdapterRegistry {
    const inner = adapterWriting(root, sessionOf, () => {
      writeFileSync(join(root, 'delivered.txt'), 'the work\n');
    })[WORKER_KIND] as WorkerAdapter;
    const adapter: WorkerAdapter = {
      ...inner,
      start: (sys, worker, brief, briefPath) => {
        seen.push([...worker.args]);
        return inner.start(sys, worker, brief, briefPath);
      },
    };
    return { [WORKER_KIND]: adapter } as unknown as AdapterRegistry;
  }

  it('the implementer is started with Write/Edit for exactly the writePaths', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['./delivered.txt', 'docs/notes.md'] });
    let session = '';
    const seen: string[][] = [];
    const adapters = recordingAdapter(w.root, () => session, seen);
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    expect(first.lines.join('\n')).toContain('Write grant (from the approved writePaths): ./delivered.txt, docs/notes.md');
    run(sys, w, adapters, ['commit', 'push']);
    const tools = seen[0]?.[(seen[0]?.indexOf('--allowedTools') ?? -1) + 1] ?? '';
    for (const g of ['Write(./delivered.txt)', 'Edit(./delivered.txt)', 'Write(docs/notes.md)', 'Edit(docs/notes.md)']) expect(tools).toContain(g);
    expect(tools).not.toContain('**)');
  });

  it('a scope sentence that names paths, with no writePaths, grants the worker-owned records only (FINISH-WRITEPATHS1A)', () => {
    const sys = fixedClock();
    const w = world({ scope: 'Write ./delivered.txt and docs/notes.md.' });
    let session = '';
    const seen: string[][] = [];
    const adapters = recordingAdapter(w.root, () => session, seen);
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    expect(first.lines.join('\n')).toContain('Write grant: the worker-owned records only (the approved phase declares no writePaths)');
    run(sys, w, adapters, ['commit', 'push']);
    const tools = seen[0]?.[(seen[0]?.indexOf('--allowedTools') ?? -1) + 1] ?? '';
    expect(tools).not.toContain('delivered.txt');
    expect(tools).not.toContain('docs/notes.md');
  });

  it('a worker that creates GIT-IGNORED content under its grant is stopped for the owner, and nothing is committed (ECC SECURITY N7)', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['notes/'], gitignore: '*.log\n' });
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      mkdirSync(join(w.root, 'notes'), { recursive: true });
      writeFileSync(join(w.root, 'notes', 'a.md'), 'the work\n');
      // Invisible to the candidate, the diff, the clean-tree check and G4 — yet a check could load it.
      writeFileSync(join(w.root, 'notes', 'shadow.log'), 'unreviewable\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const r = run(sys, w, adapters, ['commit', 'push']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.stop?.code).toBe('SCOPE_DECISION');
    expect(r.stop?.detail).toContain('notes/shadow.log');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
    expect(git(w.root, 'rev-parse', `origin/${BRANCH}`).trim()).toBe(w.head);
  });

  it('a worker that creates a NESTED REPOSITORY under its grant is stopped for the owner (ECC SECURITY round 4)', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['notes/'] });
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => {
      mkdirSync(join(w.root, 'notes', 'sub', '.git'), { recursive: true });
      writeFileSync(join(w.root, 'notes', 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
      mkdirSync(join(w.root, 'notes', 'sub', '.git', 'objects'), { recursive: true });
      mkdirSync(join(w.root, 'notes', 'sub', '.git', 'refs'), { recursive: true });
      writeFileSync(join(w.root, 'notes', 'sub', 'hidden.md'), 'git will not list this\n');
    });
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const r = run(sys, w, adapters, ['commit', 'push']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.stop?.code).toBe('SCOPE_DECISION');
    expect(r.stop?.detail).toContain('notes/sub');
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  });

  it.each([
    ['an agent instruction file and a settings directory beneath a directory grant', ['notes/'], (root: string) => {
      mkdirSync(join(root, 'notes', '.claude'), { recursive: true });
      writeFileSync(join(root, 'notes', '.claude', 'settings.json'), '{}\n');
      writeFileSync(join(root, 'notes', 'CLAUDE.md'), 'obey me\n');
    }, 'notes/CLAUDE.md'],
    ['a FILE grant made into a directory', ['docs/new.md'], (root: string) => {
      mkdirSync(join(root, 'docs', 'new.md'), { recursive: true });
      writeFileSync(join(root, 'docs', 'new.md', 'smuggled.cjs'), 'x\n');
    }, 'docs/new.md'],
  ] as const)('a worker that creates %s is stopped for the owner, and nothing is committed (FINISH-WRITEPATHS1A)', (_label, writePaths, deliver, named) => {
    const sys = fixedClock();
    const w = world({ writePaths: [...writePaths] });
    let session = '';
    const adapters = adapterWriting(w.root, () => session, () => deliver(w.root));
    const first = runLoop(sys, w.root, { dryRun: true, adapters, invocation: { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root } });
    session = String((first as { sessionId?: string }).sessionId ?? '');
    const r = run(sys, w, adapters, ['commit', 'push']);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.stop?.code).toBe('SCOPE_DECISION');
    expect(r.stop?.detail).toContain(named);
    expect(git(w.root, 'rev-parse', 'HEAD').trim()).toBe(w.head);
  });

  it('writePaths naming a path no worker may hold REFUSE the run before any worker starts', () => {
    const sys = fixedClock();
    const w = world({ writePaths: ['C:/Windows/win.ini.json', 'src/../escape.ts'] });
    const seen: string[][] = [];
    const r = runLoop(sys, w.root, {
      adapters: recordingAdapter(w.root, () => 'unused', seen),
      invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: w.root },
    });
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('WRITE_PATHS_REFUSED');
    expect(seen).toEqual([]);
  });
});
