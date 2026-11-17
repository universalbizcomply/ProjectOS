/**
 * Swapping which provider implements and which reviews is a committed-config change and nothing else.
 * PROJECTOS-WORKER-CODEX-IMPLEMENTER1A, FR-008 / SC-001.
 *
 * The two projects below differ ONLY in `execution` (the committed worker config). Both go through the same
 * loop functions (`resolveWorker`, `resolveReviewer`, `roleBindingProblems`) and the real built-in adapters,
 * and each adapter is driven with a fake spawn. This is the seam the Stage 4 exit proof crosses live; it is not
 * that proof: no real Claude or Codex runs here, and the whole `runLoop` is covered elsewhere.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { resolveReviewer, resolveWorker, type AuthorisedWorker } from '../src/loop/workers.js';
import { BUILT_IN_ADAPTERS, CLAUDE_CODE_CLI, contextPointerPathOf, correctionInstruction, pointerInstruction } from '../src/loop/adapters/claudeCodeCli.js';
import { CODEX_CLI } from '../src/loop/adapters/codexCli.js';
import { CODEX_IMPLEMENTER, codexImplementerAdapterWith } from '../src/loop/adapters/codexImplementer.js';
import { roleBindingProblems } from '../src/loop/reviewRoles.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { GovernedContext } from '../src/governedContext.js';
import type { ExecResult, System } from '../src/system.js';
import type { ProjectConfig } from '@projectos/core';
import { fakeScratchHost } from './support/fakeScratchHost.js';

const ROOT = 'C:/dev/candidate';
const CLAUDE = 'C:/Users/murad/.local/bin/claude.exe';
const CODEX = 'C:/tools/codex/codex.exe';
const RECORD_GRANTS = 'Write(.projectops/execution/*.findings.json),Edit(.projectops/execution/*.findings.json),Write(.projectops/execution/*.effects.json),Edit(.projectops/execution/*.effects.json)';

const claudeImplementer = { workerId: 'claude-local', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: ['--allowedTools', RECORD_GRANTS] };
const claudeReviewer = { workerId: 'claude-reviewer', kind: CLAUDE_CODE_CLI, command: CLAUDE, args: ['--allowedTools', 'Read,Grep,Glob'] };
const codexImplementer = { workerId: 'codex-local', kind: CODEX_IMPLEMENTER, command: CODEX, args: ['--allowedTools', RECORD_GRANTS] };
const codexReviewer = { workerId: 'codex-reviewer', kind: CODEX_CLI, command: CODEX, args: [] };

/** Claude implements and Codex reviews, or the other way round. Nothing else differs. */
const CLAUDE_IMPLEMENTS = { workers: [claudeImplementer, codexReviewer], defaultWorkerId: 'claude-local', reviewerWorkerId: 'codex-reviewer' };
const CODEX_IMPLEMENTS = { workers: [codexImplementer, claudeReviewer], defaultWorkerId: 'codex-local', reviewerWorkerId: 'claude-reviewer' };

function contextWith(execution: unknown): GovernedContext {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../../.projectops/project-config.json'), 'utf8')) as ProjectConfig & { execution?: unknown };
  config.execution = execution;
  const plan = JSON.parse(readFileSync(resolve(__dirname, '../../state/projectos-recovery.plan.json'), 'utf8')) as Record<string, unknown>;
  return { config, plan, projectId: config.projectId, planPath: 'projectos/state/projectos-recovery.plan.json', currentStatePath: null };
}

const BRIEF = {
  repository: { root: ROOT, head: 'a'.repeat(40) },
  records: { briefPath: `${ROOT}/b.json`, findingsPath: `${ROOT}/f.json`, effectsPath: `${ROOT}/e.json`, evidencePath: `${ROOT}/ev.json` },
} as unknown as WorkerBrief;

/** One scripted answer per provider; git answers an empty, clean checkout. */
function fakeSystem(spawned: string[]): System {
  const codexStream = [
    { type: 'thread.started', thread_id: 't' },
    { type: 'item.completed', item: { id: 'r', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
    { type: 'item.completed', item: { id: 'm', type: 'agent_message', text: 'ok' } },
    { type: 'turn.completed' },
  ].map((e) => JSON.stringify(e)).join('\n');
  return {
    cwd: () => ROOT,
    now: () => '2026-11-17T12:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: () => false,
    listDir: () => [],
    renameFile: () => true,
    createExclusive: () => true,
    removeFile: () => true,
    exec: (cmd, args): ExecResult => {
      if (cmd === CLAUDE) {
        spawned.push('claude');
        return { code: 0, stdout: JSON.stringify({ session_id: 's', result: 'ok', num_turns: 2, permission_denials: [] }), stderr: '' };
      }
      if (cmd === CODEX) {
        spawned.push(args.includes('read-only') ? 'codex-review' : 'codex-implement');
        return { code: 0, stdout: codexStream, stderr: '' };
      }
      // git, for the Codex implementer's scope snapshot: a clean checkout with no filter drivers.
      if (args.includes('--name-only')) return { code: 1, stdout: '', stderr: '' };
      if (args.includes('rev-parse')) return { code: 0, stdout: args.includes('--git-path') ? '.git/info/exclude\n' : `${'a'.repeat(40)}\n`, stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}

/**
 * The registry the loop resolves from. PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: the Codex implementer now runs in a scratch directory, and
 * the fake checkout here (`C:/dev/candidate`) has none, so its entry takes a scripted scratch host; every other entry, and the
 * kind's registration, are the real ones. The real scratch is proven in `scratchCheckout.test.ts` and `codexImplementerScratch.test.ts`.
 */
const ADAPTERS = {
  ...BUILT_IN_ADAPTERS,
  [CODEX_IMPLEMENTER]: codexImplementerAdapterWith({ pointerInstruction, correctionInstruction, contextPointerPathOf }, fakeScratchHost({ realRoot: ROOT }).host),
};

/** The loop's own steps, written once: resolve, bind the roles, start the implementer, review with the reviewer. */
function runRoles(execution: unknown) {
  const context = contextWith(execution);
  const implementer = resolveWorker(context, ADAPTERS);
  const reviewer = resolveReviewer(context, ADAPTERS);
  if (!implementer.ok || reviewer === null) throw new Error(`could not resolve: ${implementer.ok ? 'no reviewer' : implementer.problems.join('; ')}`);
  const spawned: string[] = [];
  const sys = fakeSystem(spawned);
  const bound = roleBindingProblems(implementer.worker as AuthorisedWorker, reviewer.worker);
  const started = implementer.adapter.start(sys, implementer.worker, BRIEF, BRIEF.records.briefPath);
  const reviewed = reviewer.adapter.review?.(sys, reviewer.worker, BRIEF, 'review it') ?? null;
  return { implementer, reviewer, bound, started, reviewed, spawned };
}

describe('swapping providers is a configuration change', () => {
  it('Claude implements and Codex reviews', () => {
    const r = runRoles(CLAUDE_IMPLEMENTS);
    expect(r.implementer.worker.kind).toBe(CLAUDE_CODE_CLI);
    expect(r.reviewer.worker.kind).toBe(CODEX_CLI);
    expect(r.bound).toEqual([]);
    expect(r.started).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(r.reviewed).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(r.spawned).toEqual(['claude', 'codex-review']);
  });

  it('Codex implements and Claude reviews, through the same loop functions and no source change', () => {
    const r = runRoles(CODEX_IMPLEMENTS);
    expect(r.implementer.worker.kind).toBe(CODEX_IMPLEMENTER);
    expect(r.reviewer.worker.kind).toBe(CLAUDE_CODE_CLI);
    expect(r.bound).toEqual([]);
    expect(r.started).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(r.reviewed).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(r.spawned).toEqual(['codex-implement', 'claude']);
  });

  it('the two projects differ only in the committed worker config', () => {
    const a = contextWith(CLAUDE_IMPLEMENTS);
    const b = contextWith(CODEX_IMPLEMENTS);
    const strip = (c: GovernedContext) => JSON.stringify({ ...c.config, execution: undefined });
    expect(strip(a)).toBe(strip(b));
    expect(a.plan).toEqual(b.plan);
  });

  it('a Codex implementer cannot be configured as the reviewer, and the Codex reviewer cannot be the implementer', () => {
    const asReviewer = { workers: [claudeImplementer, codexImplementer], defaultWorkerId: 'claude-local', reviewerWorkerId: 'codex-local' };
    const context = contextWith(asReviewer);
    const reviewer = resolveReviewer(context, BUILT_IN_ADAPTERS);
    expect(reviewer?.adapter.review).toBeUndefined();
    const asImplementer = { workers: [codexReviewer, claudeReviewer], defaultWorkerId: 'codex-reviewer', reviewerWorkerId: 'claude-reviewer' };
    const implementer = resolveWorker(contextWith(asImplementer), BUILT_IN_ADAPTERS);
    expect(implementer.ok).toBe(true);
    if (implementer.ok) {
      expect(implementer.adapter.start(fakeSystem([]), implementer.worker, BRIEF, BRIEF.records.briefPath)).toMatchObject({ kind: 'refused' });
    }
  });
});
