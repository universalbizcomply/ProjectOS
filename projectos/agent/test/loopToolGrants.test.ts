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
  committedSourceGrants,
  WORKER_OWNED_RECORD_GRANTS,
  WORKER_SOURCE_GRANTS,
  WORKER_SOURCE_GRANT_REL,
  PROJECTOS_OWNED_RECORD_SUFFIXES,
} from '../src/loop/workers.js';
import { nodeSystem } from '../src/system.js';
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

  /**
   * A shell grant is a write grant wearing a different name. Policing `Write` while waving `Bash(*)`
   * through would be theatre. Missed by the governed worker's own review of this boundary; found
   * when reading its findings.
   */
  it('REFUSES a shell or dispatch grant, which can write by another route', () => {
    for (const grant of ['Bash(*)', 'Bash(rm -rf:*)', 'Task(*)', 'Agent(*)', 'bash(echo:*)']) {
      const problems = toolGrantProblems(['--allowedTools', grant]);
      expect(problems.length, grant).toBe(1);
      expect(problems[0], grant).toContain(grant);
    }
  });

  it('leaves READ-shaped grants alone — reading widely is how a worker does its job', () => {
    expect(toolGrantProblems(['--allowedTools', 'Read(**),Glob(**),Grep(**),WebFetch(*)'])).toEqual([]);
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
   * The shipped config is the thing that actually runs. If a future edit widens it beyond what the
   * owner COMMITTED, this fails. Since 2026-09-04 the owner's committed source grant
   * (`.projectops/authority/worker-source-grant.json`) is part of what "permitted" means.
   */
  it('this repository’s own worker config grants nothing beyond the worker-owned records and the committed source grant', () => {
    const root = resolve(__dirname, '../../..');
    const granted = committedSourceGrants({ sys: nodeSystem, root }, 'projectos', 'claude-local');
    const execution = realConfig().execution as { workers: { args?: string[] }[] };
    for (const w of execution.workers) {
      expect(toolGrantProblems(w.args ?? [], granted)).toEqual([]);
    }
    const args = (execution.workers[0].args ?? []).join(' ');
    for (const suffix of PROJECTOS_OWNED_RECORD_SUFFIXES) {
      expect(args, suffix).not.toContain(suffix);
    }
    expect(args).not.toContain('execution/**');
  });
});

describe('the owner\'s committed source grant - a second closed list, honoured only when committed', () => {
  const SOURCE = ['--allowedTools', WORKER_SOURCE_GRANTS.slice(0, 4).join(',')];

  it('without a committed grant, a source grant is REFUSED and the refusal names the record it needs', () => {
    const problems = toolGrantProblems(SOURCE);
    expect(problems.length).toBe(4);
    for (const p of problems) expect(p).toContain(WORKER_SOURCE_GRANT_REL);
  });

  it('with the grant, exactly the granted entries are accepted and nothing else', () => {
    expect(toolGrantProblems(SOURCE, WORKER_SOURCE_GRANTS.slice(0, 4))).toEqual([]);
    // A grant for some entries does not cover the others.
    expect(toolGrantProblems(SOURCE, WORKER_SOURCE_GRANTS.slice(0, 2)).length).toBe(2);
  });

  it('a record cannot smuggle a grant the closed list does not know', () => {
    for (const forbidden of [
      'Write(.projectops/**)',
      'Write(.projectops/authority/**)',
      'Write(projectos/security/**)',
      'Write(projectos/host/**)',
      'Write(projectos/credentials/**)',
      'Write(projectos/forge/**)',
      'Write(projectos/control-center/src-tauri/**)',
      'Write(projectos/**)',
      'Write(projectos/validators/**)',
      'Write(projectos/validators/validate-all.cjs)',
      'Write(projectos/validators/val-projectos-trust-boundary1a.cjs)',
      'Write(projectos/agent/**)',
      'Write(projectos/agent/src/loop/workers.ts)',
      'Write(projectos/agent/test/**)',
      'Write(projectos/core/**)',
      'Write(projectos/control-center/src/**)',
      'Write(projectos/scripts/**)',
      'Write(docs/**)',
      'Write(**)',
      'Bash(*)',
    ]) {
      expect(toolGrantProblems(['--allowedTools', forbidden], [forbidden]).length, forbidden).toBe(1);
    }
  });

  it('the committed record in THIS repository names only entries of the closed list, for this project and worker', () => {
    const root = resolve(__dirname, '../../..');
    const sys = nodeSystem;
    const granted = committedSourceGrants({ sys, root }, 'projectos', 'claude-local');
    for (const g of granted) expect(WORKER_SOURCE_GRANTS).toContain(g);
    // Another project or another worker gets nothing from it.
    expect(committedSourceGrants({ sys, root }, 'polygo', 'claude-local')).toEqual([]);
    expect(committedSourceGrants({ sys, root }, 'projectos', 'someone-else')).toEqual([]);
  });

  it('the shipped config with the grant read from HEAD is accepted by the seam; without a repository it is refused', () => {
    const root = resolve(__dirname, '../../..');
    const cfg = realConfig();
    const ctx: GovernedContext = { config: cfg, plan: realPlan(), projectId: cfg.projectId, planPath: 'p', currentStatePath: null };
    const withRepo = authorisedWorkers(ctx, { sys: nodeSystem, root });
    const granted = committedSourceGrants({ sys: nodeSystem, root }, 'projectos', 'claude-local');
    if (granted.length > 0) {
      expect(withRepo.ok).toBe(true);
      const without = authorisedWorkers(ctx);
      expect(without.ok).toBe(false);
    } else {
      // Before the grant is committed the seam refuses the widened config - fail closed.
      expect(withRepo.ok).toBe(false);
    }
  });
});

describe('the committed grant record is scoped, and a missing scope grants nothing', () => {
  /** A repository whose HEAD holds exactly one version of the grant record. */
  const repoWith = (record: unknown) =>
    ({
      sys: {
        ...nodeSystem,
        exec: (cmd: string, args: readonly string[]) =>
          cmd === 'git' && args.includes('show')
            ? { code: 0, stdout: JSON.stringify(record), stderr: '' }
            : { code: 1, stdout: '', stderr: 'not this test' },
      } as typeof nodeSystem,
      root: 'C:/fake',
    });
  const base = { schemaVersion: '1.0.0', capability: 'worker-source-write', projectId: 'projectos', workerId: 'claude-local', grants: WORKER_SOURCE_GRANTS.slice(0, 2) };

  it('a matching record grants exactly its listed entries', () => {
    expect(committedSourceGrants(repoWith(base), 'projectos', 'claude-local')).toEqual(WORKER_SOURCE_GRANTS.slice(0, 2));
  });

  it('a record with NO workerId grants nothing to anyone', () => {
    const { workerId, ...noWorker } = base;
    void workerId;
    expect(committedSourceGrants(repoWith(noWorker), 'projectos', 'claude-local')).toEqual([]);
  });

  it('a record for another worker, another project, or another capability grants nothing', () => {
    expect(committedSourceGrants(repoWith({ ...base, workerId: 'other' }), 'projectos', 'claude-local')).toEqual([]);
    expect(committedSourceGrants(repoWith({ ...base, projectId: 'polygo' }), 'projectos', 'claude-local')).toEqual([]);
    expect(committedSourceGrants(repoWith({ ...base, capability: 'plan-authoring' }), 'projectos', 'claude-local')).toEqual([]);
  });

  it('entries outside the closed list are dropped even when the record names them', () => {
    const r = repoWith({ ...base, grants: ['Write(.projectops/**)', 'Write(projectos/security/**)', ...WORKER_SOURCE_GRANTS.slice(0, 1)] });
    expect(committedSourceGrants(r, 'projectos', 'claude-local')).toEqual(WORKER_SOURCE_GRANTS.slice(0, 1));
  });

  it('an uncommitted or unreadable record is no grant', () => {
    const none = { sys: { ...nodeSystem, exec: () => ({ code: 128, stdout: '', stderr: 'fatal: path not in HEAD' }) } as typeof nodeSystem, root: 'C:/fake' };
    expect(committedSourceGrants(none, 'projectos', 'claude-local')).toEqual([]);
    const garbage = { sys: { ...nodeSystem, exec: () => ({ code: 0, stdout: '{not json', stderr: '' }) } as typeof nodeSystem, root: 'C:/fake' };
    expect(committedSourceGrants(garbage, 'projectos', 'claude-local')).toEqual([]);
  });
});
