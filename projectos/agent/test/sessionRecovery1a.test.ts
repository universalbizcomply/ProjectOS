/**
 * Recovering truthfully from an interrupted run.
 *
 * WHAT WAS ACTUALLY WRONG. `--resume` already refused a session it could not read, a session that did
 * not exist, and a session belonging to another worker. It did not compare the phase the session was
 * created for, or the brief it was created from — and the record written afterwards then OVERWROTE
 * both with the current run's values. So a session made for one phase, or for the same phase at a
 * head the repository has since left, could have its provider handle adopted, rebound and reported
 * as "rejoined". Nothing was forged and no authority was crossed; the account of what happened was
 * simply untrue, which is the whole of what this phase exists to fix.
 *
 * AND THE BRIEF WAS PERSISTED BEFORE ANY OF IT WAS CHECKED, so a resume that was about to be refused
 * had already damaged the record of the run it was failing to recover.
 *
 * REAL REPOSITORIES AND REAL GIT, because a session's identity is `phaseId@head` and a moved head is
 * the case that matters most.
 *
 * Created in PROJECTOS-SESSION-RECOVERY1A.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nodeSystem, resolveBoundGit, type System } from '../src/system.js';
import { normaliseRemote } from '../src/loop/observation.js';
import { runLoop } from '../src/loop/runner.js';
import * as store from '../src/loop/session.js';
import { markOwnerReceiptConsumed } from '../src/loop/ownerGateReceipts.js';
import type { AdapterRegistry, WorkerAdapter } from '../src/loop/adapters/contract.js';
import type { WorkerSession } from '../src/loop/workers.js';

const GIT = resolveBoundGit(process.env) as string;
const PHASE = 'E2E-SESSION-RECOVERY1A';
const OTHER_PHASE = 'E2E-SOME-OTHER-PHASE1A';
const OWNER = 'Murad';
const BRANCH = 'work';
const WORKER_KIND = 'test-worker';
const NOW = '2026-09-02T19:00:00Z';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync(GIT, ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** A governed project whose phase reserves nothing technical, so the loop reaches the worker. */
function governed(): { root: string; origin: string; head: string } {
  const origin = mkdtempSync(join(tmpdir(), 'projectos-b8-origin-'));
  const root = mkdtempSync(join(tmpdir(), 'projectos-b8-work-'));
  made.push(origin, root);
  execFileSync(GIT, ['init', '--quiet', '--bare', `--initial-branch=${BRANCH}`, origin], { stdio: 'pipe' });
  git(root, 'init', '--quiet', `--initial-branch=${BRANCH}`);
  git(root, 'config', 'user.email', 'e2e@example.invalid');
  git(root, 'config', 'user.name', 'ProjectOS E2E');

  const config = {
    schemaVersion: '1.0.0',
    projectId: 'e2e',
    projectName: 'E2E',
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
  const realPlan = JSON.parse(
    readFileSync(new URL('../../../.projectops/plan-98675c78dc8b3175-786d909d1ccb.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
  const template = (realPlan['phases'] as Record<string, unknown>[])[0] as Record<string, unknown>;
  const phase = (id: string) => ({
    ...template,
    phaseId: id,
    description: 'prove truthful session recovery',
    scope: '',
    dependsOn: [],
    requiredReviews: [],
    requiredBrowserProof: false,
    requiredOwnerGates: ['secrets-handling', 'payment-or-live-charge'],
  });
  const plan = {
    ...realPlan,
    projectId: 'e2e',
    projectName: 'E2E',
    programmeId: 'e2e-programme',
    planId: 'plan-e2e',
    repository: {
      ...(realPlan['repository'] as Record<string, unknown>),
      repositoryPath: root,
      expectedRemote: normaliseRemote(origin),
      protectedBranches: ['main'],
      planSourceBranch: BRANCH,
    },
    phases: [phase(PHASE)],
    governance: {
      ...(realPlan['governance'] as Record<string, unknown>),
      owner: OWNER,
      gatekeeper: 'ChatGPT',
      closureAuthority: 'ChatGPT',
    },
  } as Record<string, unknown>;
  delete (plan as { governance?: Record<string, unknown> }).governance?.['closureDelegation'];

  mkdirSync(join(root, 'projectos', 'validators'), { recursive: true });
  writeFileSync(join(root, 'projectos', 'validators', 'validate-all.cjs'), 'console.log("validate-all: fixture PASS");');
  mkdirSync(join(root, '.projectops', 'phases'), { recursive: true });
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, '.projectops', 'project-config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, 'state', 'plan.json'), JSON.stringify(plan, null, 2));
  writeFileSync(join(root, 'state', 'current.json'), JSON.stringify({ completedPhases: [], activePhase: PHASE }, null, 2));
  writeFileSync(
    join(root, '.projectops', 'phases', `${PHASE}.json`),
    JSON.stringify({ schemaVersion: '1.0.0', phaseId: PHASE, status: 'implementing', objective: 'prove', history: [] }, null, 2),
  );

  git(root, 'add', '--all');
  git(root, 'commit', '--quiet', '-m', 'governed fixture');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', 'origin', `${BRANCH}:${BRANCH}`);
  return { root, origin, head: git(root, 'rev-parse', 'HEAD').trim() };
}

/** An adapter that RECORDS whether it was asked to start or to rejoin. */
function recordingAdapter(calls: string[]): AdapterRegistry {
  const a = {
    kind: WORKER_KIND,
    start: () => {
      calls.push('start');
      return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-new' };
    },
    rejoin: () => {
      calls.push('rejoin');
      return { kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: 'ref-old' };
    },
  } as unknown as WorkerAdapter;
  return { [WORKER_KIND]: a } as unknown as AdapterRegistry;
}

const SESSION_ID = 'e2e-recovery-session1a';

/** A session on disk, as an interrupted run would have left one. */
function plantSession(root: string, over: Partial<WorkerSession> = {}): WorkerSession {
  const head = git(root, 'rev-parse', 'HEAD').trim();
  const session: WorkerSession = {
    invocationId: 'inv-1',
    sessionId: SESSION_ID,
    workerId: 'test',
    kind: WORKER_KIND,
    phaseId: PHASE,
    briefId: `${PHASE}@${head}`,
    briefPath: store.briefPath(root, SESSION_ID),
    startedAt: NOW,
    providerRef: 'ref-old',
    state: 'started',
    exitCode: null,
    corrections: 0,
    ...over,
  } as WorkerSession;
  store.writeSession(nodeSystem, root, session);
  // A brief beside it, whose bytes a refused resume must not touch.
  writeFileSync(session.briefPath, `${JSON.stringify({ briefId: session.briefId, marker: 'ORIGINAL' }, null, 2)}\n`);
  return session;
}

function resume(root: string, calls: string[]) {
  const sys: System = { ...nodeSystem, now: () => NOW };
  return runLoop(sys, root, {
    adapters: recordingAdapter(calls),
    resume: true,
    resumeSessionId: SESSION_ID,
    invocation: { pid: 4242, ppid: 1717, argv: ['node', 'projectos.js', 'run', '--execute'], cwd: root },
  });
}

function briefMarker(root: string): unknown {
  return (JSON.parse(readFileSync(store.briefPath(root, SESSION_ID), 'utf8')) as Record<string, unknown>)['marker'];
}

/* ------------------------------------------------------------------------------------------------
 * PROOF A — a session created for another phase is never adopted.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF A — a resume never crosses phases', () => {
  it('refuses a session belonging to another phase, and rejoins nothing', () => {
    const w = governed();
    plantSession(w.root, { phaseId: OTHER_PHASE, briefId: `${OTHER_PHASE}@${w.head}` });
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).toContain('SESSION_CONTEXT_MISMATCH');
    expect(r.lines.join('\n')).toContain(OTHER_PHASE);
    // NOTHING WAS REJOINED, and no fresh worker was quietly substituted for the refusal either.
    expect(calls).toEqual([]);
    // AND THE HISTORICAL RECORD IS INTACT.
    expect(briefMarker(w.root)).toBe('ORIGINAL');
    expect(store.readSession(nodeSystem, w.root, SESSION_ID).value?.phaseId).toBe(OTHER_PHASE);
  });

  // THE PHASE CHECK, ON ITS OWN. `briefId` is `phaseId@head`, so an honest record for another phase
  // is caught by the brief comparison too — and a proof that cannot tell the two guards apart proves
  // neither. Here the brief is made to look correct while the record's phase is foreign, which is
  // what a hand-edited or laundered record looks like, and only the phase comparison refuses it.
  it('refuses a foreign phase even when the brief identity looks right', () => {
    const w = governed();
    plantSession(w.root, { phaseId: OTHER_PHASE, briefId: `${PHASE}@${w.head}` });
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).toContain('SESSION_CONTEXT_MISMATCH');
    expect(r.lines.join('\n')).toContain(`it belongs to phase '${OTHER_PHASE}'`);
    expect(calls).toEqual([]);
    expect(briefMarker(w.root)).toBe('ORIGINAL');
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF B — the same phase at a moved head is a different piece of work.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF B — a resume never crosses a moved repository', () => {
  it('refuses when the phase still matches but the head has moved', () => {
    const w = governed();
    plantSession(w.root);
    // The repository moves on. The phase is unchanged; the work is not.
    writeFileSync(join(w.root, 'later.txt'), 'work done after the session was created\n');
    git(w.root, 'add', '--all');
    git(w.root, 'commit', '--quiet', '-m', 'later work');
    const moved = git(w.root, 'rev-parse', 'HEAD').trim();
    expect(moved).not.toBe(w.head);

    const calls: string[] = [];
    const r = resume(w.root, calls);
    // A phaseId-only guard would have accepted this. The brief identity is what refuses it.
    expect(r.lines.join('\n')).toContain('SESSION_CONTEXT_MISMATCH');
    expect(r.lines.join('\n')).toContain('the repository has moved');
    expect(calls).toEqual([]);
    expect(briefMarker(w.root)).toBe('ORIGINAL');
    expect(store.readSession(nodeSystem, w.root, SESSION_ID).value?.briefId).toBe(`${PHASE}@${w.head}`);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF C — a resume that genuinely describes this run continues it.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF C — a matching session is rejoined, not restarted', () => {
  it('rejoins the same worker when phase, worker, kind and brief all agree', () => {
    const w = governed();
    plantSession(w.root);
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).not.toContain('SESSION_CONTEXT_MISMATCH');
    // THE POINT OF A RESUME: the earlier worker is continued, not silently replaced.
    expect(calls).toContain('rejoin');
    expect(calls).not.toContain('start');
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF D — worker identity, which was the one guard that already existed.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF D — a resume never crosses workers', () => {
  it('still refuses a session belonging to another workerId', () => {
    const w = governed();
    plantSession(w.root, { workerId: 'someone-else' });
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).toContain('SESSION_WORKER_MISMATCH');
    expect(calls).toEqual([]);
    expect(briefMarker(w.root)).toBe('ORIGINAL');
  });

  it('refuses a session recorded under a different worker KIND', () => {
    const w = governed();
    plantSession(w.root, { kind: 'some-other-kind' });
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).toContain('SESSION_CONTEXT_MISMATCH');
    expect(r.lines.join('\n')).toContain('some-other-kind');
    expect(calls).toEqual([]);
  });

  // A RECORD CANNOT BE PLANTED THIS WAY BY THE STORE. `writeSession` derives the filename from the
  // record's own sessionId, so the two can never disagree through the normal path — the file has to
  // be written directly, which is what a tampered or hand-edited checkout looks like.
  it('refuses a record whose own sessionId disagrees with where it was found', () => {
    const w = governed();
    const planted = plantSession(w.root);
    writeFileSync(
      store.sessionPath(w.root, SESSION_ID),
      `${JSON.stringify({ ...planted, sessionId: 'a-different-id1a' }, null, 2)}\n`,
    );
    const calls: string[] = [];

    const r = resume(w.root, calls);
    expect(r.lines.join('\n')).toContain('SESSION_CONTEXT_MISMATCH');
    expect(r.lines.join('\n')).toContain('a-different-id1a');
    expect(calls).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOFS E and F — the lock says which of its two failures happened.
 *
 * The convention is deliberate and unchanged: no timeout, no PID, no automatic deletion. Its only
 * remedy is an operator removing the file, so a refusal that does not name the file makes the remedy
 * unreachable — and `createExclusive` swallows every error, so "held" and "cannot be written here"
 * arrive identically and need different answers.
 * --------------------------------------------------------------------------------------------- */

describe('PROOFS E/F — a refused spend says which failure it was', () => {
  function receiptRepo(): { root: string; head: string } {
    const root = mkdtempSync(join(tmpdir(), 'projectos-b8-lock-'));
    made.push(root);
    git(root, 'init', '--quiet', '--initial-branch=work');
    git(root, 'config', 'user.email', 'e2e@example.invalid');
    git(root, 'config', 'user.name', 'ProjectOS E2E');
    mkdirSync(join(root, '.projectops', 'gates'), { recursive: true });
    writeFileSync(join(root, '.projectops', 'gates', `${PHASE}.commit.json`), '{"ownerChoice":"APPROVE"}\n');
    writeFileSync(join(root, 'base.txt'), 'base\n');
    git(root, 'add', '--all');
    git(root, 'commit', '--quiet', '-m', 'base');
    return { root, head: git(root, 'rev-parse', 'HEAD').trim() };
  }

  // PROOF E — the lock is there. Name it, so it can be cleared.
  it('names the exact lock file when one is already held', () => {
    const w = receiptRepo();
    const lock = join(w.root, '.projectops', 'gates', `${PHASE}.commit.json.lock`);
    writeFileSync(lock, 'held by another run\n');

    const said = markOwnerReceiptConsumed(nodeSystem, w.root, PHASE, 'commit', NOW);
    expect(said.ok).toBe(false);
    expect(said.detail).toContain('already being spent by another process');
    expect(said.detail).toContain(lock);
    expect(said.detail).toContain('must be removed');
    // FAIL-CLOSED IS UNCHANGED: the receipt is untouched and the gate still stands.
    expect(readFileSync(join(w.root, '.projectops', 'gates', `${PHASE}.commit.json`), 'utf8')).not.toContain('consumedAt');
  });

  // PROOF F — the lock is NOT there, so blaming another process would send an operator nowhere.
  it('says the location cannot be written when the lock could not be created', () => {
    const w = receiptRepo();
    const refusing: System = { ...nodeSystem, createExclusive: () => false };

    const said = markOwnerReceiptConsumed(refusing, w.root, PHASE, 'commit', NOW);
    expect(said.ok).toBe(false);
    expect(said.detail).toContain('could not be written');
    // IT MUST NOT CLAIM SOMEONE ELSE HOLDS IT.
    expect(said.detail).not.toContain('another process');
    expect(existsSync(join(w.root, '.projectops', 'gates', `${PHASE}.commit.json.lock`))).toBe(false);
    expect(readFileSync(join(w.root, '.projectops', 'gates', `${PHASE}.commit.json`), 'utf8')).not.toContain('consumedAt');
  });
});

/* ------------------------------------------------------------------------------------------------
 * PROOF G — what the last run left behind is reported, and decides nothing.
 * --------------------------------------------------------------------------------------------- */

describe('PROOF G — prior work is reported, never obeyed', () => {
  it('reports a previous record without letting it change what happens', () => {
    const w = governed();
    const calls: string[] = [];
    // A record carrying every authority-shaped value a checkpoint could offer.
    writeFileSync(
      join(w.root, '.projectops', 'work.v1.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.0.0',
          projectId: 'e2e',
          phaseId: PHASE,
          state: 'GATE_APPROVED',
          sessionId: 'an-earlier-session1a',
          attempt: 1,
          subjectCommit: w.head,
          lastCompletedStep: null,
          lastStopCode: 'OWNER_GATE',
          lastStopDetail: null,
          evidenceSessionId: null,
          gateDecisionId: 'GKDEC-forged',
          nextCandidateAction: 'commit',
          ownerRequired: true,
          updatedAt: NOW,
        },
        null,
        2,
      )}\n`,
    );

    plantSession(w.root);
    const r = resume(w.root, calls);
    const out = r.lines.join('\n');
    // REPORTED, with the facts an operator needs to find the interrupted run.
    expect(out).toContain('Prior work:');
    expect(out).toContain(PHASE);
    expect(out).toContain('an-earlier-session1a');
    expect(out).toContain('OWNER_GATE');
    // AND OBEYED IN NO WAY. The forged approval bought nothing: the run still rejoined and ran.
    expect(calls).toContain('rejoin');
    expect(out).not.toContain('GKDEC-forged');
  });

  it('reports a malformed record as malformed rather than as an absence', () => {
    const w = governed();
    writeFileSync(join(w.root, '.projectops', 'work.v1.json'), 'this is not JSON\n');
    plantSession(w.root);
    const calls: string[] = [];

    const out = resume(w.root, calls).lines.join('\n');
    expect(out).toContain('the durable record could not be read');
    expect(out).not.toContain('Prior work: none recorded');
    // An unreadable checkpoint is not permission to skip anything, and not a clean slate either.
    expect(calls).toContain('rejoin');
  });

  it('says so plainly when there is no previous record at all', () => {
    const w = governed();
    plantSession(w.root);
    expect(resume(w.root, []).lines.join('\n')).toContain('Prior work: none recorded.');
  });
});
