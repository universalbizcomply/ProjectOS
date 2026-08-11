/**
 * What file-writing authority a worker may hold — and, more importantly, what it may not.
 *
 * A RUN HAS TWO OWNERS. The worker owns what it ASSERTS: its findings and its effects attestation.
 * ProjectOS owns what it STATES and OBSERVES: the brief the worker is judged against, the session
 * record naming who owns the run, and the evidence collected about it. The first grant that made the
 * loop work at all was `.projectops/execution/**`, which handed the worker all six — so it could
 * have rewritten the contract it was measured by, or the evidence about its own run.
 *
 * The negative cases are the point of this file: every test below that asserts a REFUSAL is the
 * proof that the brief, the session and the evidence stay outside worker authority, and that a
 * future config cannot widen the boundary quietly.
 *
 * Narrowed by the PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A source review (HIGH).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  authorisedWorkers,
  toolGrantProblems,
  WORKER_OWNED_RECORD_GRANTS,
  PROJECTOS_OWNED_RECORD_SUFFIXES,
} from '../src/loop/workers.js';
import { CLAUDE_CODE_CLI } from '../src/loop/adapters/claudeCodeCli.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { ProjectConfig } from '@projectos/core';

const CLAUDE = 'C:/Users/murad/.local/bin/claude.exe';

function realConfig(): ProjectConfig & { execution?: unknown } {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8'),
  ) as ProjectConfig & { execution?: unknown };
}

function realPlan(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function contextWithArgs(args: readonly string[]): GovernedContext {
  const config = { ...realConfig() } as ProjectConfig & { execution?: unknown };
  config.execution = { workers: [{ workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args }] };
  return {
    config,
    plan: realPlan(),
    projectId: config.projectId,
    planPath: 'projectos/state/projectos-recovery.plan.json',
    currentStatePath: null,
  };
}

const NARROW = ['--allowedTools', WORKER_OWNED_RECORD_GRANTS.join(',')];

describe('toolGrantProblems', () => {
  it('accepts exactly the four worker-owned record grants', () => {
    expect(toolGrantProblems(NARROW)).toEqual([]);
  });

  it('accepts a worker with no tool grant at all', () => {
    expect(toolGrantProblems([])).toEqual([]);
  });

  /** The grant this correction removed. It handed the worker all six records. */
  it('REFUSES the directory-wide grant that covered ProjectOS-owned records', () => {
    const problems = toolGrantProblems(['--allowedTools', 'Write(.projectops/execution/**),Edit(.projectops/execution/**)']);
    expect(problems.length).toBe(2);
    expect(problems.join(' ')).toContain('beyond the records it owns');
  });

  it('REFUSES write authority over the brief, the session and the evidence, one by one', () => {
    for (const suffix of PROJECTOS_OWNED_RECORD_SUFFIXES) {
      for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
        const grant = `${tool}(.projectops/execution/*${suffix})`;
        const problems = toolGrantProblems(['--allowedTools', grant]);
        expect(problems.length, grant).toBe(1);
        expect(problems[0], grant).toContain(grant);
      }
    }
  });

  it('REFUSES a broad grant even when a permitted one sits beside it', () => {
    const problems = toolGrantProblems([
      '--allowedTools',
      `${WORKER_OWNED_RECORD_GRANTS[0]},Write(projectos/agent/src/**)`,
    ]);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('projectos/agent/src');
  });

  it('REFUSES write authority over source, the repository root, and anywhere at all', () => {
    for (const grant of ['Write(**)', 'Edit(**)', 'Write(.projectops/**)', 'Edit(projectos/**)', 'Write(../outside/**)']) {
      expect(toolGrantProblems(['--allowedTools', grant]).length, grant).toBe(1);
    }
  });

  it('leaves READ-shaped grants alone — reading widely is how a worker does its job', () => {
    expect(toolGrantProblems(['--allowedTools', 'Read(**),Glob(**),Grep(**),Bash(git diff:*)'])).toEqual([]);
  });

  it('honours the --allowed-tools spelling too', () => {
    expect(toolGrantProblems(['--allowed-tools', 'Write(.projectops/execution/**)']).length).toBe(1);
  });

  it('refuses --allowedTools with no value rather than ignoring it', () => {
    expect(toolGrantProblems(['--allowedTools']).join(' ')).toContain('no value');
  });
});

describe('the worker seam enforces the boundary when the config is read', () => {
  it('accepts the narrowed grant', () => {
    const r = authorisedWorkers(contextWithArgs(NARROW));
    expect(r.ok).toBe(true);
  });

  it('refuses to authorise a worker granted ProjectOS-owned records — before any spawn', () => {
    const r = authorisedWorkers(contextWithArgs(['--allowedTools', 'Write(.projectops/execution/**)']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(' ')).toContain('beyond the records it owns');
  });

  /**
   * The shipped config is the thing that actually runs. If a future edit widens it, this fails.
   */
  it('this repository’s own worker config grants nothing beyond the two worker-owned records', () => {
    const execution = realConfig().execution as { workers: { args?: string[] }[] };
    for (const w of execution.workers) {
      expect(toolGrantProblems(w.args ?? [])).toEqual([]);
    }
    const args = (execution.workers[0].args ?? []).join(' ');
    for (const suffix of PROJECTOS_OWNED_RECORD_SUFFIXES) {
      expect(args, suffix).not.toContain(suffix);
    }
    expect(args).not.toContain('execution/**');
  });
});
