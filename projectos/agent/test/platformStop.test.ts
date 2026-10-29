/**
 * THE PLATFORM-WIDE EMERGENCY STOP — PROJECTOS-KERNEL-PLATFORM-STOP1A.
 *
 * Most of these assert what did NOT happen: no write, no git, no commit, no push, no worker, no paid
 * call. A stop that refused after acting would be a report, not a stop, so "nothing was touched" is the
 * property and every fake here counts what it was asked to do.
 *
 * HERMETIC. Every stop engaged here lives in a temporary or in-memory state directory named on the
 * context (`platformStopStateDir`); nothing reads or writes the owner's real LOCALAPPDATA record.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ExecResult, System } from '../src/system.js';
import { nodeSystem } from '../src/system.js';
import { run as cli, readOnlyUnderPlatformStop, parseArgs } from '../src/cli.js';
import {
  PLATFORM_STOP_FILENAME,
  PLATFORM_STOP_SCHEMA_VERSION,
  PLATFORM_STOP_STATEMENT,
  STOP_TEXT_MAX,
  controlCenterVerbRefusal,
  engagePlatformStop,
  defaultPlatformStopStateDir,
  osInstallationStateDir,
  platformStopStatusLines,
  terminalStopLiftConfirm,
  platformStopDirOf,
  platformStopRefusal,
  readPlatformStop,
  recordPlatformStopLift,
  stopLiftRelPath,
} from '../src/loop/platformStop.js';
import { stop } from '../src/commands/stop.js';
import type { StopLiftConfirm } from '../src/loop/platformStop.js';
import { run as runCommand, continueCommand, isFoldableRunRecord } from '../src/commands/run.js';
import { closurePrepare, closureRequest, closureResume } from '../src/commands/closure.js';
import { reconcile } from '../src/commands/reconcile.js';
import { phase } from '../src/commands/phase.js';
import { plan } from '../src/commands/plan.js';
import { runLoop } from '../src/loop/runner.js';
import {
  admitGatekeeperSpend,
  resolveClosureCommitDelegation,
  resolveDelegatedDecider,
  resolveTechnicalDelegation,
} from '../src/loop/gatekeeperConfig.js';
import { commitOwnRecords, commitOwnRecordsFor, runTechnicalContinuation } from '../src/loop/technicalContinuation.js';
import { loadGovernedContext } from '../src/governedContext.js';
import { OWNER, PHASE, PROGRAMME, fixedClock, git, made, unchanged, world, worker } from './support/verticalSliceWorld.js';

const STATE = '/installation-state';
const STOP_FILE = `${STATE}/${PLATFORM_STOP_FILENAME}`;

/** An in-memory System that counts every write and every exec, and whose exec never succeeds. */
function spySystem(files: Record<string, string> = {}) {
  const writes: string[] = [];
  const execs: string[] = [];
  const sys: System = {
    cwd: () => '/proj',
    now: () => '2026-10-29T10:00:00Z',
    readText: (p) => files[p] ?? null,
    writeText: (p, c) => {
      writes.push(p);
      files[p] = c;
    },
    exists: (p) => p in files,
    listDir: () => [],
    renameFile: (from, to) => {
      writes.push(`${from} -> ${to}`);
      if (!(from in files)) return false;
      files[to] = files[from] as string;
      delete files[from];
      return true;
    },
    createExclusive: (p, c) => {
      writes.push(p);
      if (p in files) return false;
      files[p] = c;
      return true;
    },
    removeFile: (p) => {
      writes.push(`rm ${p}`);
      delete files[p];
      return true;
    },
    exec: (cmd, args): ExecResult => {
      execs.push(`${cmd} ${args.join(' ')}`);
      return { code: 1, stdout: '', stderr: 'the spy system runs nothing' };
    },
  };
  return { sys, files, writes, execs };
}

/** A System whose exec THROWS: the reader must never reach it. */
function noExecSystem(files: Record<string, string> = {}): System {
  return {
    ...spySystem(files).sys,
    exec: () => {
      throw new Error('the platform stop check ran a command');
    },
  };
}

function engagedFiles(): Record<string, string> {
  const s = spySystem();
  engagePlatformStop(s.sys, STATE, { reason: 'test', engagedBy: 'tester' }, () => 'STOP-20261029T100000Z-0123456789ab');
  return { [STOP_FILE]: s.files[STOP_FILE] as string };
}

function tempStateDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'projectos-platform-stop-'));
  made.push(d);
  return d.split(String.fromCharCode(92)).join('/');
}

describe('the reader', () => {
  it('reads an ABSENT record as running, and never runs a command', () => {
    expect(platformStopRefusal(noExecSystem(), STATE)).toBeNull();
  });

  it('reads an ENGAGED record as a refusal carrying the stop id and the honest statement', () => {
    const refusal = platformStopRefusal(noExecSystem(engagedFiles()), STATE);
    expect(refusal).not.toBeNull();
    const text = (refusal ?? []).join('\n');
    expect(text).toContain('REFUSED (PLATFORM_STOP)');
    expect(text).toContain('STOP-20261029T100000Z-0123456789ab');
    expect(text).toContain(PLATFORM_STOP_STATEMENT);
    expect(text).toContain('unauthenticated claim');
  });

  it('reads a MALFORMED record as stopped — invalid JSON, a wrong schema, or a lift with no commit', () => {
    const lifted = JSON.parse(engagedFiles()[STOP_FILE] as string) as Record<string, unknown>;
    for (const bytes of [
      '{ not json',
      'null',
      '[]',
      JSON.stringify({ ...lifted, schemaVersion: '9.9.9' }),
      JSON.stringify({ ...lifted, state: 'paused' }),
      JSON.stringify({ ...lifted, engagedBy: { claim: 'x', authenticated: true } }),
      JSON.stringify({ ...lifted, state: 'lifted', liftedStopId: lifted['stopId'] }),
      JSON.stringify({ ...lifted, state: 'lifted', liftedStopId: 'STOP-20260101T000000Z-aaaaaaaaaaaa', liftCommit: 'a'.repeat(40) }),
    ]) {
      const refusal = platformStopRefusal(noExecSystem({ [STOP_FILE]: bytes }), STATE);
      expect(refusal?.join('\n')).toContain('REFUSED (PLATFORM_STOP_UNREADABLE)');
      expect(refusal?.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    }
  });

  it('reads a record that EXISTS but cannot be read as stopped, never as absent', () => {
    const sys: System = { ...noExecSystem(), readText: () => null, exists: (p) => p === STOP_FILE };
    expect(platformStopRefusal(sys, STATE)?.join('\n')).toContain('PLATFORM_STOP_UNREADABLE');
  });

  it('reads a validly LIFTED record as running', () => {
    const files = engagedFiles();
    const s = spySystem(files);
    expect(recordPlatformStopLift(s.sys, STATE, 'STOP-20261029T100000Z-0123456789ab', 'b'.repeat(40))).toEqual({ written: true });
    expect(platformStopRefusal(noExecSystem(files), STATE)).toBeNull();
  });

  it('reads a NULL or blank state directory as stopped', () => {
    for (const dir of [null, '', '   ']) {
      const refusal = platformStopRefusal(noExecSystem(), dir);
      expect(refusal?.join('\n')).toContain('REFUSED (PLATFORM_STOP_UNVERIFIABLE)');
      expect(refusal?.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    }
  });

  it('takes its directory from the context only when a test names one, and reads explicit null as unresolvable', () => {
    expect(platformStopDirOf({ sys: nodeSystem, root: '/x' })).toBe(defaultPlatformStopStateDir());
    expect(platformStopDirOf({ platformStopStateDir: '/somewhere' })).toBe('/somewhere');
    expect(platformStopDirOf({ platformStopStateDir: null })).toBeNull();
    expect(platformStopDirOf({ platformStopStateDir: undefined })).toBeNull();
  });
});

describe('engaging', () => {
  it('writes atomically to the state directory, reads back, and needs no authority and no git', () => {
    const dir = tempStateDir();
    const sys: System = { ...nodeSystem, exec: () => { throw new Error('engaging ran a command'); } };
    const out = engagePlatformStop(sys, dir, { reason: 'halt everything', engagedBy: 'Murad' });
    expect(out.kind).toBe('ENGAGED');
    expect(out.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    expect(existsSync(join(dir, `${PLATFORM_STOP_FILENAME}.tmp`))).toBe(false);
    const record = JSON.parse(readFileSync(join(dir, PLATFORM_STOP_FILENAME), 'utf8')) as Record<string, unknown>;
    expect(record['state']).toBe('engaged');
    expect(record['schemaVersion']).toBe(PLATFORM_STOP_SCHEMA_VERSION);
    expect(record['engagedBy']).toEqual({ claim: 'Murad', authenticated: false });
  });

  it('does not re-engage an engaged stop: the stop id a lift is in motion for stays the same', () => {
    const s = spySystem(engagedFiles());
    const again = engagePlatformStop(s.sys, STATE, { reason: 'again', engagedBy: 'x' });
    expect(again.kind).toBe('ALREADY_ENGAGED');
    expect(again.kind === 'ALREADY_ENGAGED' ? again.stopId : '').toBe('STOP-20261029T100000Z-0123456789ab');
  });

  it('after a lift, a new engagement gets a NEW stop id and the history is kept, never deleted', () => {
    const s = spySystem(engagedFiles());
    recordPlatformStopLift(s.sys, STATE, 'STOP-20261029T100000Z-0123456789ab', 'c'.repeat(40));
    const next = engagePlatformStop(s.sys, STATE, { reason: 'second', engagedBy: 'x' });
    expect(next.kind).toBe('ENGAGED');
    const read = readPlatformStop(s.sys, STATE);
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    expect(read.record.stopId).not.toBe('STOP-20261029T100000Z-0123456789ab');
    expect(read.record.history.map((e) => e.event)).toEqual(['engaged', 'lifted', 'engaged']);
  });

  it('moves an unreadable record aside rather than overwriting it, then engages a fresh stop', () => {
    const s = spySystem({ [STOP_FILE]: '{ damaged' });
    const out = engagePlatformStop(s.sys, STATE, { reason: 'r', engagedBy: 'b' }, () => 'STOP-20261029T100000Z-aaaaaaaaaaaa');
    expect(out.kind).toBe('ENGAGED');
    expect(s.files[`${STOP_FILE}.unreadable-STOP-20261029T100000Z-aaaaaaaaaaaa`]).toBe('{ damaged');
  });

  it('keeps the reason inert and bounded: no control characters, never longer than the cap', () => {
    const s = spySystem();
    engagePlatformStop(s.sys, STATE, { reason: `line one\nREFUSED (FORGED)\n${'x'.repeat(500)}`, engagedBy: 'b' });
    const read = readPlatformStop(s.sys, STATE);
    if (read.kind !== 'ok') throw new Error('not engaged');
    expect(read.record.reason).not.toMatch(/[\n\r]/);
    expect(read.record.reason.length).toBeLessThanOrEqual(STOP_TEXT_MAX);
  });

  it('reports a stop it could not record as NOT recorded', () => {
    expect(engagePlatformStop(spySystem().sys, null, { reason: '', engagedBy: '' }).kind).toBe('FAILED');
    const s = spySystem();
    const failing: System = { ...s.sys, renameFile: () => false };
    const out = engagePlatformStop(failing, STATE, { reason: '', engagedBy: '' });
    expect(out.kind).toBe('FAILED');
    expect(out.lines.join('\n')).toContain('NOT RECORDED');
  });
});

/* ----------------------------------------------------------------------------------------------
 * THE CLI GATE — every `case` in cli.ts, classified. A command added without a row here fails the
 * classification test; a mutating one is refused with the statement and ZERO writes and execs.
 * ------------------------------------------------------------------------------------------- */

const REFUSED_UNDER_STOP: readonly (readonly string[])[] = [
  ['run', '--execute'],
  ['run', '--dry-run'],
  ['continue', '--execute'],
  ['continue', '--dry-run'],
  ['reconcile', '--grant', 'G', '--work', 'W', '--execute'],
  ['reconcile', '--grant', 'G', '--work', 'W', '--dry-run'],
  ['init', '--id', 'x'],
  ['install', '--target', '/t', '--id', 'x'],
  ['close', '--phase', 'P'],
  ['closure', 'prepare', '--id', 'P'],
  ['closure', 'request', '--id', 'P', '--execute'],
  ['closure', 'resume', '--id', 'P'],
  ['phase', 'new', '--id', 'P'],
  ['phase', 'advance', '--id', 'P', '--to', 'closed', '--as', 'owner'],
  ['phase', 'sync-state'],
  ['phase', 'reconcile-objective', '--id', 'P'],
  ['phase', 'closure-eligibility', '--id', 'P'],
  ['approve', 'request', '--id', 'A'],
  ['approve', 'decide', '--id', 'A', '--decision', 'approve', '--as', 'owner'],
  ['plan', 'draft', '--objective', 'x', '--authored', 'true'],
  ['plan', 'decide', '--id', 'D', '--decision', 'approve'],
  ['plan', 'approve', '--id', 'D', '--decision', 'X'],
  ['plan', 'activate', '--id', 'D', '--decision', 'X'],
  ['report', '--phase', 'P'],
  ['workforce', 'acquire'],
  ['workforce', 'evaluate'],
  ['workforce'],
  ['mcp', 'token', '--create'],
  ['an-unknown-command'],
];

const READ_ONLY_UNDER_STOP: readonly (readonly string[])[] = [
  ['stop'],
  ['stop', 'status'],
  ['stop', 'lift', '--stop', 'STOP-20261029T100000Z-0123456789ab'],
  ['help'],
  ['--help'],
  ['version'],
  ['--version'],
  ['doctor'],
  ['status'],
  ['plugins'],
  ['validate'],
  ['prompt', '--phase', 'P'],
  ['closure'],
  ['closure', 'status', '--id', 'P'],
  ['phase'],
  ['phase', 'show', '--id', 'P'],
  ['phase', 'list'],
  ['approve'],
  ['approve', 'show', '--id', 'A'],
  ['approve', 'list'],
  ['plan'],
  ['plan', 'show'],
  ['plan', 'drafts'],
  ['workforce', 'roster'],
  ['workforce', 'team'],
  ['workforce', 'check-update'],
  ['mcp'],
  ['mcp', 'status'],
  ['report'],
];

describe('the CLI gate', () => {
  it('classifies every command cli.ts dispatches — a new command without a row here fails', () => {
    const source = readFileSync(resolve(__dirname, '../src/cli.ts'), 'utf8');
    const body = source.slice(source.indexOf('export function run('));
    const cases = [...body.matchAll(/case '([^']+)':/g)].map((m) => m[1] as string);
    expect(cases.length).toBeGreaterThan(20);
    const classified = new Set([...REFUSED_UNDER_STOP, ...READ_ONLY_UNDER_STOP].map((argv) => argv[0]));
    for (const command of cases) expect(classified.has(command), `cli.ts dispatches '${command}' with no classification`).toBe(true);
  });

  it.each(REFUSED_UNDER_STOP.map((argv) => [argv.join(' '), argv] as const))(
    'refuses `%s` while engaged, with the statement, zero writes and zero execs',
    (_name, argv) => {
      const s = spySystem(engagedFiles());
      const r = cli({ sys: s.sys, root: '/proj', platformStopStateDir: STATE } as Parameters<typeof cli>[0], argv);
      expect(r.code).toBe(2);
      expect(r.lines.join('\n')).toContain('REFUSED (PLATFORM_STOP)');
      expect(r.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
      expect(s.writes).toEqual([]);
      expect(s.execs).toEqual([]);
    },
  );

  it.each(READ_ONLY_UNDER_STOP.map((argv) => [argv.join(' '), argv] as const))('lets the read-only `%s` through', (_name, argv) => {
    const { command, positionals, flags } = parseArgs(argv);
    expect(readOnlyUnderPlatformStop(command, positionals, flags)).toBe(true);
  });

  it('a read-only command really runs while engaged, and `stop status` shows the record and the statement', () => {
    const s = spySystem(engagedFiles());
    const ctx = { sys: s.sys, root: '/proj', platformStopStateDir: STATE } as Parameters<typeof cli>[0];
    expect(cli(ctx, ['version']).code).toBe(0);
    const status = cli(ctx, ['stop', 'status']);
    expect(status.code).toBe(0);
    expect(status.lines.join('\n')).toContain('ENGAGED');
    expect(status.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    expect(s.writes).toEqual([]);
  });

  it('refuses everything that can act when the state directory cannot be resolved', () => {
    const s = spySystem();
    const r = cli({ sys: s.sys, root: '/proj', platformStopStateDir: null } as Parameters<typeof cli>[0], ['run', '--execute']);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('PLATFORM_STOP_UNVERIFIABLE');
    expect(s.execs).toEqual([]);
  });

  it('`projectos stop` engages with no authority and writes only the stop record in the state directory', () => {
    const s = spySystem();
    const r = cli({ sys: s.sys, root: '/proj', platformStopStateDir: STATE } as Parameters<typeof cli>[0], ['stop', '--reason', 'enough']);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('EMERGENCY STOP ENGAGED');
    expect(r.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    expect(s.writes.every((w) => w.startsWith(`${STATE}/`))).toBe(true);
    expect(s.execs).toEqual([]);
  });
});

/* ----------------------------------------------------------------------------------------------
 * REAL GIT — the commands refuse before they touch the repository, and only the owner can lift.
 * ------------------------------------------------------------------------------------------- */

/** A person at a terminal who retypes exactly what they are asked to. */
const typesTheId: StopLiftConfirm = (stopId) => ({ kind: 'typed', text: stopId });

/** A governed world with a stop engaged FROM it — so the stop is bound to this project — and a terminal. */
function stoppedWorld(confirm: StopLiftConfirm = typesTheId) {
  const w = world('interactive');
  const dir = tempStateDir();
  const ctx = { sys: fixedClock(), root: w.root, platformStopStateDir: dir, platformStopConfirm: confirm };
  const engaged = stop(ctx, { reason: 'test stop', by: 'tester' }, ['engage']);
  if (engaged.code !== 0) throw new Error('could not engage');
  const read = readPlatformStop(nodeSystem, dir);
  if (read.kind !== 'ok') throw new Error('not engaged');
  return { w, dir, stopId: read.record.stopId, ctx };
}

function clean(root: string): void {
  expect(git(root, 'status', '--porcelain').trim()).toBe('');
}

describe('with the stop engaged, the governed commands refuse before any commit or push (real git)', () => {
  it('run, continue, closure prepare/request/resume, reconcile, plan draft and phase advance/new all refuse; origin unchanged', () => {
    const { w, ctx } = stoppedWorld();
    const answers = [
      runCommand(ctx, { execute: true }),
      runCommand(ctx, { 'dry-run': true }),
      continueCommand(ctx, { execute: true }),
      closurePrepare(ctx, { id: PHASE }),
      closureRequest(ctx, { id: PHASE, execute: true }),
      closureResume(ctx, { id: PHASE }),
      reconcile(ctx, { grant: 'G', work: 'W', execute: true }),
      plan(ctx, { objective: 'do more', authored: 'true' }, ['draft']),
      plan(ctx, { id: 'D', decision: 'approve' }, ['decide']),
      phase(ctx, { id: PHASE, to: 'validating', as: 'owner' }, ['advance']),
      phase(ctx, { id: 'NEW-PHASE1A' }, ['new']),
    ];
    for (const a of answers) {
      expect(a.code).toBe(2);
      expect(a.lines.join('\n')).toContain('REFUSED (PLATFORM_STOP)');
      expect(a.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    }
    unchanged(w);
    clean(w.root);
  });

  it('runLoop starts nothing and writes nothing under a stop, and runs again once the stop is lifted', () => {
    const { w, dir, stopId } = stoppedWorld();
    const adapters = worker(w.root, () => '');
    const invocation = { pid: 4242, ppid: 1717, argv: ['node'], cwd: w.root };
    const refusedRun = runLoop(fixedClock(), w.root, { dryRun: true, adapters, invocation, platformStopStateDir: dir });
    expect(refusedRun.ok).toBe(false);
    clean(w.root);
    expect(recordPlatformStopLift(nodeSystem, dir, stopId, 'd'.repeat(40))).toEqual({ written: true });
    expect(runLoop(fixedClock(), w.root, { dryRun: true, adapters, invocation, platformStopStateDir: dir }).ok).toBe(true);
  });

  it('the technical continuation and the records commit refuse before git is asked anything', () => {
    const { w, dir } = stoppedWorld();
    const s = spySystem(engagedFiles());
    const outcome = runTechnicalContinuation(s.sys, {
      action: 'commit',
      context: { root: w.root, projectId: 'hybrid', phaseId: PHASE, programmeId: PROGRAMME, expectedBranch: 'work', expectedRemote: 'origin', integrationTargetBranch: null },
      decision: {} as never,
      delegation: { problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT' },
      phaseOwnerGates: [],
      at: '2026-10-29T10:00:00Z',
      platformStopStateDir: STATE,
    });
    expect(outcome.kind).toBe('REFUSED');
    expect(outcome.kind === 'REFUSED' && outcome.nothingAttempted).toBe(true);
    expect(s.execs).toEqual([]);
    const gc = loadGovernedContext(nodeSystem, w.root);
    if (!gc.ok) throw new Error('no governed context');
    const records = commitOwnRecordsFor(nodeSystem, w.root, gc.context, PHASE, 'run-records', () => true, dir);
    expect(records.kind).toBe('REFUSED');
    unchanged(w);
  });
});

describe('delegations are suspended while engaged, without editing any record', () => {
  it('the technical and closure-commit delegations report problems while engaged and resolve again after the lift', () => {
    const w = world('interactive');
    // GRANT closure-decision-commit, committed by the OWNER, so the closure-commit delegation resolves.
    const rel = join(w.root, '.projectops', 'authority', 'closure-delegation.json');
    const delegation = JSON.parse(readFileSync(rel, 'utf8')) as Record<string, unknown>;
    writeFileSync(rel, JSON.stringify({ ...delegation, delegatedScope: [...(delegation['delegatedScope'] as string[]), 'closure-decision-commit'] }, null, 2));
    git(w.root, 'add', '--all');
    git(w.root, '-c', `user.name=${OWNER}`, '-c', 'user.email=owner@example.invalid', 'commit', '-q', '-m', 'grant');
    const before = git(w.root, 'show', 'HEAD:.projectops/authority/closure-delegation.json');
    const dir = tempStateDir();
    const sys = fixedClock();

    expect(resolveTechnicalDelegation(sys, w.root, PROGRAMME, dir).problems).toEqual([]);
    expect(resolveClosureCommitDelegation(sys, w.root, PROGRAMME, dir).granted).toBe(true);

    const engaged = engagePlatformStop(nodeSystem, dir, { reason: 'r', engagedBy: 'b' });
    if (engaged.kind !== 'ENGAGED') throw new Error('not engaged');
    const technical = resolveTechnicalDelegation(sys, w.root, PROGRAMME, dir);
    expect(technical.problems.join('\n')).toContain('every delegation is suspended while the platform stop is engaged');
    expect(technical.delegatedTo).toBe('');
    const closureCommit = resolveClosureCommitDelegation(sys, w.root, PROGRAMME, dir);
    expect(closureCommit.granted).toBe(false);
    expect(closureCommit.problems.join('\n')).toContain('suspended');
    const review = resolveDelegatedDecider(sys, w.root, PROGRAMME, undefined, dir);
    expect(review.ok).toBe(false);
    // NOTHING WAS EDITED: the committed delegation is byte for byte what it was.
    expect(git(w.root, 'show', 'HEAD:.projectops/authority/closure-delegation.json')).toBe(before);
    clean(w.root);

    expect(recordPlatformStopLift(nodeSystem, dir, engaged.stopId, 'e'.repeat(40))).toEqual({ written: true });
    expect(resolveTechnicalDelegation(sys, w.root, PROGRAMME, dir).problems).toEqual([]);
    expect(resolveClosureCommitDelegation(sys, w.root, PROGRAMME, dir).granted).toBe(true);
    expect(resolveDelegatedDecider(sys, w.root, PROGRAMME, undefined, dir).ok).toBe(true);
  });
});

describe('no paid call is admitted while engaged', () => {
  it('admitGatekeeperSpend refuses before the lock or the ledger is touched', () => {
    const s = spySystem(engagedFiles());
    const admitted = admitGatekeeperSpend(
      s.sys,
      '/proj',
      { requestId: 'GKREQ-1', projectId: 'p', phaseId: 'P', model: 'm', estimateMicroUsd: 1, at: '2026-10-29T10:00:00Z' },
      { warnAtMicroUsd: 1, hardStopAtMicroUsd: 10, phaseHardStopAtMicroUsd: 10, dayHardStopAtMicroUsd: 10 },
      () => 'not-answered',
      STATE,
    );
    expect(admitted.allowed).toBe(false);
    expect(admitted.reasons.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    expect(s.writes).toEqual([]);
    expect(s.execs).toEqual([]);
  });
});

describe('only the owner lifts the stop, by an owner-authored commit (real git)', () => {
  const lift = (ctx: ReturnType<typeof stoppedWorld>['ctx'], stopId: string, extra: Record<string, string | boolean> = {}) =>
    stop(ctx, { stop: stopId, ...extra }, ['lift']);
  const stillEngaged = (dir: string) => expect(platformStopRefusal(nodeSystem, dir)?.join('\n')).toContain('REFUSED (PLATFORM_STOP)');

  function commitLift(root: string, stopId: string, identity: readonly string[]): void {
    git(root, 'add', '--', stopLiftRelPath(stopId) as string);
    git(root, ...identity, 'commit', '-q', '-m', `lift ${stopId}`);
  }

  it('refused with no lift record: the first call only writes the request, uncommitted', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    const first = lift(ctx, stopId);
    expect(first.lines.join('\n')).toContain('UNCOMMITTED');
    expect(existsSync(join(w.root, stopLiftRelPath(stopId) as string))).toBe(true);
    stillEngaged(dir);
  });

  it('refused while the lift record is uncommitted', () => {
    const { dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    const second = lift(ctx, stopId);
    expect(second.code).toBe(2);
    expect(second.lines.join('\n')).toContain('AWAITING_OWNER_COMMIT');
    stillEngaged(dir);
  });

  it('refused when the committed lift record has been changed since (dirty)', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    commitLift(w.root, stopId, ['-c', `user.name=${OWNER}`, '-c', 'user.email=owner@example.invalid']);
    writeFileSync(join(w.root, stopLiftRelPath(stopId) as string), '{"edited":true}\n');
    const r = lift(ctx, stopId);
    expect(r.lines.join('\n')).toContain('LIFT_RECORD_DIRTY');
    stillEngaged(dir);
  });

  it('refused when committed by the ProjectOS implementer identity', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    commitLift(w.root, stopId, ['-c', 'user.name=ProjectOS implementer', '-c', 'user.email=projectos-implementer@projectos.invalid']);
    const r = lift(ctx, stopId);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('LIFT_NOT_OWNER_COMMIT');
    stillEngaged(dir);
  });

  it('refused when committed by a name the approved plan does not record as owner', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    commitLift(w.root, stopId, ['-c', 'user.name=Mallory', '-c', 'user.email=mallory@example.invalid']);
    const r = lift(ctx, stopId);
    expect(r.lines.join('\n')).toContain('LIFT_NOT_OWNER_COMMIT');
    stillEngaged(dir);
  });

  it('refused when only `--as owner` is given: a flag is not the owner', () => {
    const { dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId, { as: 'owner' });
    const r = lift(ctx, stopId, { as: 'owner' });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('was ignored');
    stillEngaged(dir);
  });

  it('refused when the stop id does not match the engaged stop', () => {
    const { w, dir, ctx } = stoppedWorld();
    const other = 'STOP-20260101T000000Z-ffffffffffff';
    const r = lift(ctx, other);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('STOP_MISMATCH');
    expect(existsSync(join(w.root, stopLiftRelPath(other) as string))).toBe(false);
    stillEngaged(dir);
  });

  it('accepted for an owner-identity commit, after which runLoop proceeds', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    commitLift(w.root, stopId, ['-c', `user.name=${OWNER}`, '-c', 'user.email=owner@example.invalid']);
    const r = lift(ctx, stopId);
    expect(r.code).toBe(0);
    expect(r.lines.join('\n')).toContain('EMERGENCY STOP LIFTED');
    expect(r.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    expect(platformStopRefusal(nodeSystem, dir)).toBeNull();
    const read = readPlatformStop(nodeSystem, dir);
    expect(read.kind === 'ok' && read.record.liftCommit).toBe(git(w.root, 'rev-parse', 'HEAD').trim());
    const adapters = worker(w.root, () => '');
    const after = runLoop(fixedClock(), w.root, { dryRun: true, adapters, invocation: { pid: 1, ppid: 1, argv: ['node'], cwd: w.root }, platformStopStateDir: dir });
    expect(after.ok).toBe(true);
  });

  it('the run never folds a lift record into its own records commit', () => {
    expect(isFoldableRunRecord('.projectops/stop-lifts/STOP-20261029T100000Z-0123456789ab.json', PHASE, [])).toBe(false);
  });

  it('writes the lift record only at the stop-lifts path, never at a name `.gitignore` hides', () => {
    const { w, stopId, ctx } = stoppedWorld();
    lift(ctx, stopId);
    const status = git(w.root, 'status', '--porcelain', '--untracked-files=all').trim().split(/\r?\n/);
    expect(status).toEqual([`?? ${stopLiftRelPath(stopId)}`]);
  });
});

/* ----------------------------------------------------------------------------------------------
 * FIX ROUND — owner-intent lift, never dropping a stop, OS-derived directory, honest refusals.
 * ------------------------------------------------------------------------------------------- */

describe('the lift is an owner-intent check: one-file commit, same project, retyped in a terminal (real git)', () => {
  const ownerIdentity = ['-c', `user.name=${OWNER}`, '-c', 'user.email=owner@example.invalid'];
  const stillEngaged = (dir: string) => expect(platformStopRefusal(nodeSystem, dir)?.join('\n')).toContain('REFUSED (PLATFORM_STOP)');

  it('refuses a SWEEP commit: the lift record committed together with any other file lifts nothing', () => {
    const { w, dir, stopId, ctx } = stoppedWorld();
    stop(ctx, { stop: stopId }, ['lift']);
    writeFileSync(join(w.root, 'unrelated.txt'), 'swept up\n');
    git(w.root, 'add', '--all');
    git(w.root, ...ownerIdentity, 'commit', '-q', '-m', 'everything');
    const r = stop(ctx, { stop: stopId }, ['lift']);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('LIFT_COMMIT_NOT_ALONE');
    expect(r.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    stillEngaged(dir);
  });

  it('refuses a lift from a FOREIGN repository, even one with its own approved plan and owner', () => {
    const { dir, stopId } = stoppedWorld();
    const other = world('interactive');
    const foreign = { sys: fixedClock(), root: other.root, platformStopStateDir: dir, platformStopConfirm: typesTheId };
    const first = stop(foreign, { stop: stopId }, ['lift']);
    expect(first.code).toBe(2);
    expect(first.lines.join('\n')).toContain('LIFT_WRONG_PROJECT');
    expect(existsSync(join(other.root, stopLiftRelPath(stopId) as string))).toBe(false);
    stillEngaged(dir);
  });

  it('a stop engaged outside any project is lifted only from the installation root', () => {
    const w = world('interactive');
    const dir = tempStateDir();
    const engaged = engagePlatformStop(nodeSystem, dir, { reason: 'no project', engagedBy: 'b', project: null });
    if (engaged.kind !== 'ENGAGED') throw new Error('not engaged');
    const elsewhere = { sys: fixedClock(), root: w.root, platformStopStateDir: dir, platformStopConfirm: typesTheId, platformStopInstallRoot: tempStateDir() };
    expect(stop(elsewhere, { stop: engaged.stopId }, ['lift']).lines.join('\n')).toContain('LIFT_WRONG_PROJECT');
    const atInstall = { ...elsewhere, platformStopInstallRoot: w.root };
    stop(atInstall, { stop: engaged.stopId }, ['lift']);
    git(w.root, 'add', '--', stopLiftRelPath(engaged.stopId) as string);
    git(w.root, ...ownerIdentity, 'commit', '-q', '-m', 'lift');
    expect(stop(atInstall, { stop: engaged.stopId }, ['lift']).code).toBe(0);
    expect(platformStopRefusal(nodeSystem, dir)).toBeNull();
  });

  it('refuses with NO TERMINAL: the production confirmation answers no-terminal when stdin or stdout is not a TTY', () => {
    const noTty = terminalStopLiftConfirm(() => ({ stdinIsTTY: false, stdoutIsTTY: true, ask: () => { throw new Error('asked without a terminal'); } }));
    const { w, dir, stopId, ctx } = stoppedWorld(noTty);
    stop(ctx, { stop: stopId }, ['lift']);
    git(w.root, 'add', '--', stopLiftRelPath(stopId) as string);
    git(w.root, ...ownerIdentity, 'commit', '-q', '-m', 'lift');
    const r = stop(ctx, { stop: stopId }, ['lift']);
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('LIFT_NEEDS_A_TERMINAL');
    expect(r.lines.join('\n')).toContain('a person must lift this stop in an interactive terminal');
    expect(terminalStopLiftConfirm(() => ({ stdinIsTTY: true, stdoutIsTTY: false, ask: () => 'x' }))('S').kind).toBe('no-terminal');
    stillEngaged(dir);
  });

  it('refuses a WRONG typed id — near misses included', () => {
    for (const typed of ['', 'STOP', 'wrong']) {
      const { w, dir, stopId, ctx } = stoppedWorld(() => ({ kind: 'typed', text: typed }));
      stop(ctx, { stop: stopId }, ['lift']);
      git(w.root, 'add', '--', stopLiftRelPath(stopId) as string);
      git(w.root, ...ownerIdentity, 'commit', '-q', '-m', 'lift');
      const r = stop(ctx, { stop: stopId }, ['lift']);
      expect(r.lines.join('\n')).toContain('LIFT_CONFIRMATION_MISMATCH');
      stillEngaged(dir);
    }
    const spaced = stoppedWorld((id) => ({ kind: 'typed', text: ` ${id.toLowerCase()} ` }));
    stop(spaced.ctx, { stop: spaced.stopId }, ['lift']);
    git(spaced.w.root, 'add', '--', stopLiftRelPath(spaced.stopId) as string);
    git(spaced.w.root, ...ownerIdentity, 'commit', '-q', '-m', 'lift');
    expect(stop(spaced.ctx, { stop: spaced.stopId }, ['lift']).lines.join('\n')).toContain('LIFT_CONFIRMATION_MISMATCH');
  });

  it('every `stop lift` answer, refusals included, carries the honest statement and no copy-paste lift command', () => {
    const { stopId, ctx } = stoppedWorld();
    const answers = [
      stop(ctx, {}, ['lift']),
      stop(ctx, { stop: 'STOP-20260101T000000Z-ffffffffffff' }, ['lift']),
      stop(ctx, { stop: stopId }, ['lift']),
      stop(ctx, { stop: stopId, as: 'owner' }, ['lift']),
      stop({ ...ctx, platformStopStateDir: null } as Parameters<typeof stop>[0], { stop: stopId }, ['lift']),
    ];
    for (const a of answers) {
      expect(a.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
      expect(a.lines.join('\n')).not.toMatch(/projectos stop lift --stop|git add |git commit/);
    }
  });

  it('the lift is a compare-and-swap: a stop re-engaged between the read and the write is not lifted', () => {
    const files = engagedFiles();
    const s = spySystem(files);
    const racing: System = {
      ...s.sys,
      writeText: (p, c) => {
        s.sys.writeText(p, c);
        // ANOTHER PROCESS WINS THE RACE: by the time the lift moves its record in, a NEW stop stands.
        files[STOP_FILE] = (files[STOP_FILE] as string).replace(/STOP-20261029T100000Z-0123456789ab/g, 'STOP-20261029T100500Z-bbbbbbbbbbbb');
      },
    };
    const out = recordPlatformStopLift(racing, STATE, 'STOP-20261029T100000Z-0123456789ab', 'a'.repeat(40));
    expect(out.written).toBe(false);
    const read = readPlatformStop(s.sys, STATE);
    expect(read.kind === 'ok' && read.record.state).toBe('engaged');
    expect(read.kind === 'ok' && read.record.stopId).toBe('STOP-20261029T100500Z-bbbbbbbbbbbb');
  });
});

describe('a standing stop is never dropped (H2)', () => {
  it('a FAILING WRITE leaves the damaged record exactly where it was, still refusing', () => {
    const s = spySystem({ [STOP_FILE]: '{ damaged' });
    const failing: System = { ...s.sys, writeText: () => { throw new Error('disk full'); } };
    const out = engagePlatformStop(failing, STATE, { reason: 'r', engagedBy: 'b' });
    expect(out.kind).toBe('FAILED');
    expect(s.files[STOP_FILE]).toBe('{ damaged');
    expect(platformStopRefusal(s.sys, STATE)?.join('\n')).toContain('PLATFORM_STOP_UNREADABLE');
  });

  it('a failing move INTO place restores the damaged record, so a reader never finds nothing', () => {
    const s = spySystem({ [STOP_FILE]: '{ damaged' });
    const failing: System = {
      ...s.sys,
      renameFile: (from, to) => (from.endsWith('.tmp') ? false : s.sys.renameFile(from, to)),
    };
    const out = engagePlatformStop(failing, STATE, { reason: 'r', engagedBy: 'b' });
    expect(out.kind).toBe('FAILED');
    expect(s.files[STOP_FILE]).toBe('{ damaged');
    expect(platformStopRefusal(s.sys, STATE)).not.toBeNull();
  });

  it('a new record that does not read back from its temporary file never displaces the damaged one', () => {
    const s = spySystem({ [STOP_FILE]: '{ damaged' });
    const garbling: System = { ...s.sys, writeText: (p) => s.sys.writeText(p, 'garbled') };
    expect(engagePlatformStop(garbling, STATE, { reason: 'r', engagedBy: 'b' }).kind).toBe('FAILED');
    expect(s.files[STOP_FILE]).toBe('{ damaged');
  });
});

describe('the directory comes from the operating system, and the environment can only stop (M1)', () => {
  it('agrees with the installation state directory in the suite, and is unverifiable — stopped — when the environment disagrees', () => {
    expect(defaultPlatformStopStateDir()).not.toBeNull();
    expect(defaultPlatformStopStateDir()).toBe(osInstallationStateDir());
    const prior = process.env['LOCALAPPDATA'];
    try {
      process.env['LOCALAPPDATA'] = tempStateDir();
      expect(defaultPlatformStopStateDir()).toBeNull();
      expect(platformStopRefusal(noExecSystem())?.join('\n')).toContain('PLATFORM_STOP_UNVERIFIABLE');
    } finally {
      process.env['LOCALAPPDATA'] = prior;
    }
    expect(platformStopRefusal(noExecSystem())).toBeNull();
  });
});

describe('the record is validated whole (LOW)', () => {
  it('strips C1 controls, line separators and bidirectional overrides from the reason and the claim', () => {
    const s = spySystem();
    const hostile = ['ok', String.fromCharCode(0x85), String.fromCharCode(0x2028), String.fromCharCode(0x202e), String.fromCharCode(0x2066), 'end'].join('');
    engagePlatformStop(s.sys, STATE, { reason: hostile, engagedBy: hostile });
    const read = readPlatformStop(s.sys, STATE);
    if (read.kind !== 'ok') throw new Error('not engaged');
    for (const value of [read.record.reason, read.record.engagedBy.claim]) {
      expect([...value].every((c) => { const n = c.charCodeAt(0); return n >= 0x20 && !(n >= 0x7f && n <= 0x9f) && n !== 0x2028 && n !== 0x202e && n !== 0x2066; })).toBe(true);
    }
  });

  it('a history with a null element is a damaged record — stopped — and `stop status` does not throw on it', () => {
    const record = JSON.parse(engagedFiles()[STOP_FILE] as string) as Record<string, unknown>;
    const files = { [STOP_FILE]: JSON.stringify({ ...record, history: [null] }) };
    expect(platformStopRefusal(noExecSystem(files), STATE)?.join('\n')).toContain('PLATFORM_STOP_UNREADABLE');
    expect(() => platformStopStatusLines(noExecSystem(files), STATE)).not.toThrow();
  });

  it('an unreachable record (a parent that is a FILE, ENOTDIR) is unreadable — stopped — never absent', () => {
    const dir = tempStateDir();
    writeFileSync(join(dir, 'not-a-directory'), 'x');
    const refusal = platformStopRefusal(nodeSystem, `${dir}/not-a-directory/state`);
    expect(refusal?.join('\n')).toContain('PLATFORM_STOP_UNREADABLE');
  });
});

describe('the Control Center gate (M6)', () => {
  const verbs = (): string[] => {
    const source = readFileSync(resolve(__dirname, '../../control-center/src/governed/governedCommands.ts'), 'utf8');
    const block = source.slice(source.indexOf('export const GOVERNED_VERBS = ['), source.indexOf('] as const;'));
    return [...block.matchAll(/^\s*'([a-z]+\.?[a-z]*)',/gm)].map((m) => m[1] as string);
  };

  it('refuses every verb that can act while engaged, and lets only refresh, project.select and run.stop through', () => {
    const all = verbs();
    expect(all.length).toBeGreaterThan(10);
    const s = spySystem(engagedFiles());
    for (const verb of all) {
      const refusal = controlCenterVerbRefusal(s.sys, verb, STATE);
      if (['refresh', 'project.select', 'run.stop'].includes(verb)) expect(refusal, verb).toBeNull();
      else expect(refusal?.join('\n'), verb).toContain(PLATFORM_STOP_STATEMENT);
    }
    expect(s.writes).toEqual([]);
    for (const verb of all) expect(controlCenterVerbRefusal(spySystem().sys, verb, STATE), verb).toBeNull();
  });

  it('the sidecar asks this gate before any in-process dispatch, run start or off-loop worker', () => {
    const host = readFileSync(resolve(__dirname, '../../control-center/sidecar/host.mjs'), 'utf8');
    const gate = host.indexOf('const halted = controlCenterVerbRefusal(agentSystem, check.request.verb);');
    const handler = host.indexOf('function handleGovernedCommand(');
    expect(gate).toBeGreaterThan(handler);
    for (const act of ['startGovernedRun(root,', 'startOffLoopCommand({', 'const COMMANDS = {']) {
      expect(host.indexOf(act, handler)).toBeGreaterThan(gate);
    }
  });
});

describe('in-process plan approve and plan activate refuse (M6)', () => {
  it('refuses both with the statement and writes nothing', () => {
    const s = spySystem(engagedFiles());
    const ctx = { sys: s.sys, root: '/proj', platformStopStateDir: STATE } as Parameters<typeof plan>[0];
    for (const sub of ['approve', 'activate']) {
      const r = plan(ctx, { id: 'D', decision: 'X' }, [sub]);
      expect(r.code).toBe(2);
      expect(r.lines.join('\n')).toContain(PLATFORM_STOP_STATEMENT);
    }
    expect(s.writes).toEqual([]);
    expect(s.execs).toEqual([]);
  });
});

describe('the records commit asks the stop itself (M2)', () => {
  it('commitOwnRecords refuses before git is asked anything', () => {
    const s = spySystem(engagedFiles());
    const out = commitOwnRecords(s.sys, {
      root: '/proj',
      phaseId: PHASE,
      kind: 'run-records',
      expectedBranch: 'work',
      expectedRemote: 'origin',
      isOwnRecord: () => true,
      delegation: { problems: [], carriesTechnicalScope: true, delegatedTo: 'ChatGPT' },
      phaseOwnerGates: [],
      platformStopStateDir: STATE,
    });
    expect(out.kind).toBe('REFUSED');
    expect(s.execs).toEqual([]);
  });
});
