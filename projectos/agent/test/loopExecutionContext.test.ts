/**
 * WHERE a spawned process actually runs.
 *
 * The loop carried the governed root correctly and told the worker about it — but `spawnSync`
 * inherits the parent's ambient directory, so ProjectOS was DESCRIBING the governed repository
 * rather than placing the worker in it. A configured check had the same gap: `--prefix
 * projectos/core` resolved against wherever ProjectOS was started, so a check could report a pass
 * for a different checkout entirely.
 *
 * The cwd must come from the verified governed context — the current brief — and from nowhere else:
 * not `process.cwd()`, not the ambient System, and above all not the session record, which is a file
 * the spawned worker can write to.
 *
 * Found by the PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A source review (HIGH).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { claudeCodeCliAdapter, CLAUDE_CODE_CLI } from '../src/loop/adapters/claudeCodeCli.js';
import { buildWorkerBrief } from '../src/loop/brief.js';
import { requiredChecks, runChecks } from '../src/loop/verification.js';
import type { WorkerSession } from '../src/loop/workers.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { RepositoryObservation } from '../src/loop/observation.js';
import type { System, ExecOptions, ExecResult } from '../src/system.js';
import type { ProjectConfig } from '@projectos/core';

/** The governed root — deliberately NOT where the fake System says it is. */
const GOVERNED = 'C:/dev/ProjectOS-phase4';
/** Where ProjectOS happens to be running. Must never reach a spawn. */
const AMBIENT = 'C:/somewhere/else';
const CLAUDE = 'C:/Users/murad/.local/bin/claude.exe';
const PHASE = 'PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A';

function realConfig(): ProjectConfig {
  return JSON.parse(readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8')) as ProjectConfig;
}

function realPlan(): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8')) as Record<string, unknown>;
}

const OBSERVED: RepositoryObservation = {
  root: GOVERNED,
  branch: 'projectos-recovery-phase4-prep',
  head: 'a'.repeat(40),
  remote: 'universalbizcomply/ProjectOS',
  clean: true,
  dirtyPaths: [],
};

function context(): GovernedContext {
  const config = realConfig();
  return {
    config,
    plan: realPlan(),
    projectId: config.projectId,
    planPath: `${GOVERNED}/projectos/state/projectos-recovery.plan.json`,
    currentStatePath: null,
  };
}

const RECORDS = {
  briefPath: `${GOVERNED}/.projectops/execution/s1.brief.json`,
  findingsPath: `${GOVERNED}/.projectops/execution/s1.findings.json`,
  effectsPath: `${GOVERNED}/.projectops/execution/s1.effects.json`,
  evidencePath: `${GOVERNED}/.projectops/execution/s1.evidence.json`,
};

function brief() {
  const r = buildWorkerBrief(context(), PHASE, OBSERVED, '2026-08-11T20:00:00Z', RECORDS);
  if (!r.ok) throw new Error(r.problems.join('; '));
  return r.brief;
}

/** A System whose own cwd is the WRONG directory, so anything inheriting it is visible. */
function recordingSystem(files: readonly string[] = []) {
  const present = new Set(files);
  const calls: { cmd: string; args: readonly string[]; options?: ExecOptions }[] = [];
  const sys: System & { calls: typeof calls } = {
    calls,
    cwd: () => AMBIENT,
    now: () => '2026-08-11T20:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: (p) => present.has(p),
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd, args, options): ExecResult => {
      calls.push({ cmd, args, ...(options === undefined ? {} : { options }) });
      return { code: 0, stdout: '', stderr: '' };
    },
  };
  return sys;
}

const WORKER = { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [] };

/** A session record as a hostile worker might have rewritten it. */
function tamperedSession(): WorkerSession {
  return {
    sessionId: 's1',
    workerId: 'claude-local',
    kind: CLAUDE_CODE_CLI,
    phaseId: PHASE,
    briefId: 'SOMETHING-ELSE',
    briefPath: 'C:/attacker/chosen-brief.json',
    startedAt: '2026-08-11T18:00:00Z',
    providerRef: 'ref-1',
    state: 'started',
    exitCode: null,
    corrections: 1,
  };
}

describe('the worker is placed in the governed repository', () => {
  it('A — a start runs with the governed root as its working directory', () => {
    const sys = recordingSystem();
    claudeCodeCliAdapter.start(sys, WORKER, brief(), RECORDS.briefPath);
    expect(sys.calls[0].options?.cwd).toBe(GOVERNED);
  });

  it('B — a rejoin runs with the same governed root', () => {
    const sys = recordingSystem();
    claudeCodeCliAdapter.rejoin(sys, WORKER, tamperedSession(), brief());
    expect(sys.calls[0].options?.cwd).toBe(GOVERNED);
  });

  it('C — a tampered session record cannot redirect the worker or what it reads', () => {
    const sys = recordingSystem();
    claudeCodeCliAdapter.rejoin(sys, WORKER, tamperedSession(), brief());
    const line = sys.calls[0].args.join(' ');
    expect(sys.calls[0].options?.cwd).toBe(GOVERNED);
    expect(sys.calls[0].options?.cwd).not.toContain('attacker');
    expect(line).toContain(RECORDS.briefPath);
    expect(line).not.toContain('C:/attacker/chosen-brief.json');
    // The handle is the ONE thing the record still supplies — that is what makes it a rejoin.
    expect(line).toContain('ref-1');
  });

  it('E — the ambient System cwd never reaches a spawn', () => {
    const sys = recordingSystem();
    claudeCodeCliAdapter.start(sys, WORKER, brief(), RECORDS.briefPath);
    claudeCodeCliAdapter.rejoin(sys, WORKER, tamperedSession(), brief());
    for (const call of sys.calls) {
      expect(call.options?.cwd).toBe(GOVERNED);
      expect(call.options?.cwd).not.toBe(sys.cwd());
    }
  });

  it('F — credential scrubbing survives the change, on both paths', () => {
    const sys = recordingSystem();
    claudeCodeCliAdapter.start(sys, WORKER, brief(), RECORDS.briefPath);
    claudeCodeCliAdapter.rejoin(sys, WORKER, tamperedSession(), brief());
    for (const call of sys.calls) expect(call.options?.scrubCredentials).toBe(true);
  });
});

describe('checks run in the governed repository', () => {
  const validator = `${GOVERNED}/projectos/validators/validate-all.cjs`;

  it('D — a configured test and typecheck run with the governed root as cwd', () => {
    const sys = recordingSystem([validator]);
    const specs = requiredChecks(sys, GOVERNED, brief(), [
      {
        id: 'core-tests',
        kind: 'test',
        command: 'C:/Program Files/nodejs/node.exe',
        args: ['npm-cli.js', '--prefix', 'projectos/core', 'test'],
      },
      {
        id: 'agent-typecheck',
        kind: 'typecheck',
        command: 'C:/Program Files/nodejs/node.exe',
        args: ['npm-cli.js', '--prefix', 'projectos/agent', 'run', 'typecheck:all'],
      },
    ]);
    runChecks(sys, GOVERNED, specs);
    expect(sys.calls).toHaveLength(3);
    for (const call of sys.calls) expect(call.options?.cwd).toBe(GOVERNED);
  });

  it('D — the plan’s own validators run there too', () => {
    const sys = recordingSystem([validator]);
    runChecks(sys, GOVERNED, requiredChecks(sys, GOVERNED, brief()));
    expect(sys.calls[0].options?.cwd).toBe(GOVERNED);
  });

  it('E — a relative check argument is never left to the ambient directory', () => {
    const sys = recordingSystem();
    const specs = requiredChecks(sys, GOVERNED, brief(), [
      { id: 'core-tests', kind: 'test', command: 'C:/Program Files/nodejs/node.exe', args: ['--prefix', 'projectos/core', 'test'] },
    ]);
    runChecks(sys, GOVERNED, specs);
    const relative = sys.calls.find((c) => c.args.includes('projectos/core'));
    expect(relative?.options?.cwd).toBe(GOVERNED);
    expect(relative?.options?.cwd).not.toBe(AMBIENT);
  });

  it('F — checks still scrub credentials', () => {
    const sys = recordingSystem([validator]);
    runChecks(sys, GOVERNED, requiredChecks(sys, GOVERNED, brief()));
    expect(sys.calls[0].options?.scrubCredentials).toBe(true);
  });
});
