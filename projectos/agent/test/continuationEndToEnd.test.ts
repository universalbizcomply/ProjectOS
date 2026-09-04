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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runLoop } from '../src/loop/runner.js';
import { performableTechnicalActions } from '../src/loop/technicalContinuation.js';
import { inMemoryResolverForTests } from '../src/loop/credentialResolver.js';
import { nodeSystem, resolveBoundGit } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import { APPROVED_PILOT_POLICY, GATEKEEPER_DECISION_SCHEMA_VERSION } from '@projectos/core';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/workers.js';
import { TECHNICAL_ACTIONS } from '@projectos/core';
import type { System } from '../src/system.js';

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
function world(over: { ownerGates?: readonly string[] } = {}): World {
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
        scope: '',
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
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: PHASE }, null, 2));
  writeFileSync(
    join(root, '.projectops', 'phases', `${PHASE}.json`),
    JSON.stringify({ schemaVersion: '1.0.0', phaseId: PHASE, status: 'implementing', objective: 'prove the chain', history: [] }, null, 2),
  );

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
    expect(shown).toContain('workerSourceWriteGrant');
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
