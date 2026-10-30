/**
 * The worker seam.
 *
 * These tests are about two things the loop cannot be allowed to get wrong: WHICH executable becomes
 * a worker, and WHAT crosses into it. A bare command name is a real Windows attack — an unqualified
 * name resolves against the spawning process's current directory, and the loop's is the governed
 * checkout — so it is refused when the config is read, before anything can spawn.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { authorisedWorkers, resolveWorker, type AdapterRegistry, type WorkerAdapter, type WorkerSession } from '../src/loop/workers.js';
import {
  claudeCodeCliAdapter,
  BUILT_IN_ADAPTERS,
  CLAUDE_CODE_CLI,
  correctionInstruction,
  pointerInstruction,
} from '../src/loop/adapters/claudeCodeCli.js';
import { buildWorkerBrief } from '../src/loop/brief.js';
import { PROTECTED_EFFECT_FIELDS } from '../src/loop/outcome.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { RepositoryObservation } from '../src/loop/observation.js';
import type { System, ExecResult } from '../src/system.js';
import type { ProjectConfig } from '@projectos/core';

const PHASE = 'PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A';
const CLAUDE = 'C:/Users/murad/AppData/Roaming/npm/claude.cmd';

function realConfig(): ProjectConfig {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'),
  ) as ProjectConfig;
}

function realPlan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'),
  ) as Record<string, unknown>;
}

/**
 * `execution: undefined` means "a project that authorises no worker" — and it must DELETE the block,
 * because this repository's own config now carries one. A test that silently inherited it would stop
 * testing the refusal it is named for.
 */
function context(execution?: unknown): GovernedContext {
  const config = { ...realConfig() } as ProjectConfig & { execution?: unknown };
  if (execution === undefined) delete config.execution;
  else config.execution = execution;
  return {
    config,
    plan: realPlan(),
    projectId: config.projectId,
    planPath: 'projectos/state/projectos-recovery.plan.json',
    currentStatePath: null,
  };
}

const OBSERVED: RepositoryObservation = {
  root: 'C:/dev/ProjectOS',
  branch: 'projectos-recovery-phase4-prep',
  head: 'c'.repeat(40),
  remote: 'universalbizcomply/ProjectOS',
  clean: true,
  dirtyPaths: [],
};

/** A System that records every exec instead of running one. */
function recordingSystem() {
  const calls: { cmd: string; args: readonly string[] }[] = [];
  const sys: System & { calls: typeof calls } = {
    calls,
    cwd: () => 'C:/dev/ProjectOS',
    now: () => '2026-08-11T18:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: () => false,
    listDir: () => [],
    createExclusive: () => true,
    removeFile: () => true,
    renameFile: () => true,
    exec: (cmd, args): ExecResult => {
      calls.push({ cmd, args });
      return { code: 0, stdout: 'done', stderr: '' };
    },
  };
  return sys;
}

const ONE_WORKER = { workers: [{ workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE }] };

describe('authorisedWorkers', () => {
  it('refuses when the project authorises no worker at all', () => {
    const r = authorisedWorkers(context());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('authorises no execution worker');
  });

  it('accepts an absolute command', () => {
    const r = authorisedWorkers(context(ONE_WORKER));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workers[0].command).toBe(CLAUDE);
  });

  it('refuses a bare command name — it would resolve against the governed checkout first', () => {
    const r = authorisedWorkers(context({ workers: [{ workerId: 'w', kind: CLAUDE_CODE_CLI, command: 'claude' }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('not an absolute path');
  });

  it('refuses a relative command path', () => {
    const r = authorisedWorkers(context({ workers: [{ workerId: 'w', kind: CLAUDE_CODE_CLI, command: './tools/claude.exe' }] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('not an absolute path');
  });

  it('refuses a credential-shaped argument rather than passing it to a worker', () => {
    const r = authorisedWorkers(
      context({ workers: [{ workerId: 'w', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: ['--api-key=sk-live-x'] }] }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('credential');
  });

  /**
   * `authorisedWorkers` promises it never throws. Reaching into a null entry broke that promise and
   * the CLI printed a Node stack trace where every other refusal prints a governed reason. Code
   * review, HIGH.
   */
  it('refuses a malformed worker entry instead of crashing on it', () => {
    for (const bad of [null, 'a string', 42, ['an array']]) {
      const r = authorisedWorkers(context({ workers: [bad] }));
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.problems.join(' ')).toContain('is not an object');
    }
  });

  it('refuses duplicate worker ids', () => {
    const r = authorisedWorkers(
      context({
        workers: [
          { workerId: 'w', kind: CLAUDE_CODE_CLI, command: CLAUDE },
          { workerId: 'w', kind: CLAUDE_CODE_CLI, command: CLAUDE },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('more than once');
  });

  it('refuses a default that names a worker the project does not authorise', () => {
    const r = authorisedWorkers(context({ ...ONE_WORKER, defaultWorkerId: 'somebody-else' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('not one of the authorised workers');
  });
});

describe('resolveWorker', () => {
  it('takes the only authorised worker when none is named', () => {
    const r = resolveWorker(context(ONE_WORKER), BUILT_IN_ADAPTERS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worker.workerId).toBe('claude-local');
    expect(r.adapter.kind).toBe(CLAUDE_CODE_CLI);
  });

  it('refuses to choose between two workers when no default is configured', () => {
    const r = resolveWorker(
      context({
        workers: [
          { workerId: 'a', kind: CLAUDE_CODE_CLI, command: CLAUDE },
          { workerId: 'b', kind: CLAUDE_CODE_CLI, command: CLAUDE },
        ],
      }),
      BUILT_IN_ADAPTERS,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('none is the default');
  });

  it('honours an explicitly named worker', () => {
    const r = resolveWorker(
      context({
        defaultWorkerId: 'a',
        workers: [
          { workerId: 'a', kind: CLAUDE_CODE_CLI, command: CLAUDE },
          { workerId: 'b', kind: CLAUDE_CODE_CLI, command: `${CLAUDE}.b` },
        ],
      }),
      BUILT_IN_ADAPTERS,
      'b',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.worker.workerId).toBe('b');
  });

  it('refuses a worker the project does not authorise', () => {
    const r = resolveWorker(context(ONE_WORKER), BUILT_IN_ADAPTERS, 'not-mine');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('not authorised');
  });

  /**
   * The seam's whole claim: a SECOND worker is configuration plus an adapter for its kind, with no
   * change to selection, briefing or the loop. This registers a foreign adapter and resolves it.
   */
  it('accepts a second worker kind through the adapter registry alone', () => {
    const other: WorkerAdapter = {
      kind: 'some-other-worker',
      start: () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: null }),
      rejoin: () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '', providerRef: null }),
    };
    const registry: AdapterRegistry = { ...BUILT_IN_ADAPTERS, [other.kind]: other };
    const r = resolveWorker(
      context({ workers: [{ workerId: 'other', kind: 'some-other-worker', command: '/usr/local/bin/other' }] }),
      registry,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adapter.kind).toBe('some-other-worker');
  });

  it('refuses a configured kind that has no adapter, naming what is available', () => {
    const r = resolveWorker(
      context({ workers: [{ workerId: 'x', kind: 'imaginary', command: '/usr/local/bin/x' }] }),
      BUILT_IN_ADAPTERS,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain(CLAUDE_CODE_CLI);
  });
});

describe('the Claude Code CLI adapter', () => {
  const briefPath = 'C:/dev/ProjectOS/.projectops/execution/s1.brief.json';

  function brief() {
    const r = buildWorkerBrief(context(ONE_WORKER), PHASE, OBSERVED, '2026-08-11T18:00:00Z', {
      briefPath,
      findingsPath: 'C:/dev/ProjectOS/.projectops/execution/s1.findings.json',
      effectsPath: 'C:/dev/ProjectOS/.projectops/execution/s1.effects.json',
      evidencePath: 'C:/dev/ProjectOS/.projectops/execution/s1.evidence.json',
    });
    if (!r.ok) throw new Error(r.problems.join('; '));
    return r.brief;
  }

  it('puts a path and a fixed pointer on the command line, and no phase content', () => {
    const sys = recordingSystem();
    const worker = { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [], timeoutMs: 60_000 };
    const out = claudeCodeCliAdapter.start(sys, worker, brief(), briefPath);
    expect(out.kind).toBe('completed');
    expect(sys.calls).toHaveLength(1);
    expect(sys.calls[0].cmd).toBe(CLAUDE);

    const line = sys.calls[0].args.join(' ');
    expect(line).toContain(briefPath);
    // Nothing about WHAT the phase is may travel this way — that is the brief's job.
    const b = brief();
    expect(line).not.toContain(b.phase.description);
    for (const c of b.phase.acceptanceCriteria) expect(line).not.toContain(c);
    expect(line).not.toContain(b.phase.phaseId);
  });

  it('is deterministic — the same brief path always produces the same command line', () => {
    const sys = recordingSystem();
    const worker = { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [], timeoutMs: 60_000 };
    claudeCodeCliAdapter.start(sys, worker, brief(), briefPath);
    claudeCodeCliAdapter.start(sys, worker, brief(), briefPath);
    expect(sys.calls[0].args).toEqual(sys.calls[1].args);
    expect(sys.calls[0].args).toContain(pointerInstruction(briefPath));
  });

  it('prepends the worker’s configured arguments', () => {
    const sys = recordingSystem();
    const worker = { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: ['--permission-mode', 'plan'], timeoutMs: 60_000 };
    claudeCodeCliAdapter.start(sys, worker, brief(), briefPath);
    expect(sys.calls[0].args.slice(0, 2)).toEqual(['--permission-mode', 'plan']);
  });

  it('refuses to rejoin a session that never recorded a worker run', () => {
    const sys = recordingSystem();
    const session: WorkerSession = {
      sessionId: 's1',
      workerId: 'claude-local',
      kind: CLAUDE_CODE_CLI,
      phaseId: PHASE,
      briefId: `${PHASE}@${'c'.repeat(40)}`,
      briefPath,
      startedAt: '2026-08-11T18:00:00Z',
      providerRef: null,
      state: 'started',
      exitCode: null,
      corrections: 0,
    };
    const out = claudeCodeCliAdapter.rejoin(sys, { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [], timeoutMs: 60_000 }, session, brief());
    expect(out.kind).toBe('refused');
    expect(sys.calls).toHaveLength(0);
  });

  it('rejoins by the recorded reference rather than starting a fresh run', () => {
    const sys = recordingSystem();
    const session: WorkerSession = {
      sessionId: 's1',
      workerId: 'claude-local',
      kind: CLAUDE_CODE_CLI,
      phaseId: PHASE,
      briefId: `${PHASE}@${'c'.repeat(40)}`,
      briefPath,
      startedAt: '2026-08-11T18:00:00Z',
      providerRef: 'abc-123',
      state: 'started',
      exitCode: null,
      corrections: 0,
    };
    claudeCodeCliAdapter.rejoin(sys, { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [], timeoutMs: 60_000 }, session, brief());
    expect(sys.calls[0].args).toContain('--resume');
    expect(sys.calls[0].args).toContain('abc-123');
  });

  /**
   * A resume must say WHY. A worker handed the same brief twice has no way to know the loop is
   * asking it to fix something rather than to start again — but WHAT is wrong stays in the evidence
   * and findings records, whose paths are already in the brief. Source review, MEDIUM.
   */
  it('tells a rejoined worker to correct what the records say, in a fixed sentence', () => {
    const sys = recordingSystem();
    const session: WorkerSession = {
      sessionId: 's1',
      workerId: 'claude-local',
      kind: CLAUDE_CODE_CLI,
      phaseId: PHASE,
      briefId: `${PHASE}@${'c'.repeat(40)}`,
      briefPath,
      startedAt: '2026-08-11T18:00:00Z',
      providerRef: 'abc-123',
      state: 'started',
      exitCode: null,
      corrections: 1,
    };
    claudeCodeCliAdapter.rejoin(sys, { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: [], timeoutMs: 60_000 }, session, brief());
    const line = sys.calls[0].args.join(' ');
    expect(line).toContain(correctionInstruction(briefPath));
    expect(line).toContain(briefPath);
    // It is a CORRECTION instruction, not the start instruction repeated.
    expect(line).not.toContain(pointerInstruction(briefPath));
    expect(correctionInstruction(briefPath)).not.toBe(pointerInstruction(briefPath));
  });

  it("the correction points at the independent reviewer's record too, so a rejection can be fixed (owner: Claude fixes, re-review)", () => {
    const line = correctionInstruction(briefPath);
    expect(line).toContain("the independent reviewer's record beside the evidence record (the same name ending .reviewer.json)");
    expect(line).toContain('correct every finding it lists, whatever its severity');
  });

  it('the correction sentence carries no finding content — only where to read it', () => {
    const b = brief();
    const line = correctionInstruction(briefPath);
    expect(line).not.toContain(b.phase.description);
    for (const c of b.phase.acceptanceCriteria) expect(line).not.toContain(c);
    expect(line).not.toContain(b.phase.phaseId);
  });

  /**
   * THE FIRST LIVE RUN ENDED HERE. The loop refused to certify the run because no effects
   * attestation existed — and nothing had ever asked the worker to write one. The worker read the
   * brief, inferred what was wanted, and finished by asking a human for approval it could not
   * receive, because a `-p` worker is not interactive. Demanding a record you never requested is a
   * dead end, not a gate.
   */
  it('asks for the records the loop will refuse to proceed without — on BOTH paths', () => {
    for (const line of [pointerInstruction(briefPath), correctionInstruction(briefPath)]) {
      expect(line).toContain('records');
      expect(line).toContain('findings');
      // Every field the attestation reader requires must be named, or the worker guesses the shape.
      for (const f of [
        'productionTouched',
        'deploymentOccurred',
        'databaseMutationOccurred',
        'externalSendOccurred',
        'paymentOccurred',
        'rawSecretStored',
      ]) {
        expect(line, f).toContain(f);
      }
    }
  });

  it('the fields it names are exactly the fields the attestation reader requires', () => {
    const line = pointerInstruction(briefPath);
    for (const f of PROTECTED_EFFECT_FIELDS) expect(line, f).toContain(f);
  });

  it('naming the records adds no phase content to the command line', () => {
    const b = brief();
    for (const line of [pointerInstruction(briefPath), correctionInstruction(briefPath)]) {
      expect(line).not.toContain(b.phase.description);
      for (const c of b.phase.acceptanceCriteria) expect(line).not.toContain(c);
      expect(line).not.toContain(b.phase.phaseId);
    }
  });

  it('both instructions are constants — the same path always yields the same sentence', () => {
    expect(correctionInstruction(briefPath)).toBe(correctionInstruction(briefPath));
    expect(pointerInstruction(briefPath)).toBe(pointerInstruction(briefPath));
  });
});
