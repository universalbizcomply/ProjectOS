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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  authorisedWorkers,
  toolGrantProblems,
  scopeWriteGrants,
  gitDirectoryInspector,
  WORKER_OWNED_RECORD_GRANTS,
  PROJECTOS_OWNED_RECORD_SUFFIXES,
} from '../src/loop/workers.js';
import { CLAUDE_CODE_CLI } from '../src/loop/adapters/claudeCodeCli.js';
import { nodeSystem } from '../src/system.js';
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
   * The shipped config is the thing that actually runs. If a future edit widens it beyond the
   * worker-owned records, this fails. The Speed-programme source grant that once widened it is
   * RETIRED (PROJECTOS-BOOT-CONTINUE1A): a phase's source grant now comes only from its approved scope.
   */
  it('this repository’s own worker config grants nothing beyond the worker-owned records', () => {
    const execution = realConfig().execution as { workers: { args?: string[] }[] };
    for (const w of execution.workers) {
      expect(toolGrantProblems(w.args ?? [])).toEqual([]);
    }
    const args = (execution.workers[0].args ?? []).join(' ');
    for (const suffix of PROJECTOS_OWNED_RECORD_SUFFIXES) {
      expect(args, suffix).not.toContain(suffix);
    }
    expect(args).not.toContain('execution/**');
    expect(args).not.toContain('projectos/speed');
  });
});

describe('the retired source grant is no grant route at all', () => {
  it('a former Speed-programme grant in configuration is REFUSED like any other widening', () => {
    for (const grant of ['Write(projectos/speed/**)', 'Edit(docs/speed/**)', 'Write(projectos/validators/validate-speed-*.cjs)']) {
      const problems = toolGrantProblems(['--allowedTools', grant]);
      expect(problems.length, grant).toBe(1);
      expect(problems[0], grant).toContain('approved scope');
    }
  });

  it('the committed owner record that released it is gone from this repository', () => {
    expect(existsSync(resolve(__dirname, '../../../.projectops/authority/worker-source-grant.json'))).toBe(false);
  });
});

/**
 * THE IMPLEMENTER'S GRANT IS EXACTLY THE APPROVED SCOPE — PROJECTOS-BOOT-CONTINUE1A (continuation five).
 * Judged against a REAL checkout, because links and case only exist on a real filesystem.
 */
describe('scopeWriteGrants', () => {
  /** A directory git reports nothing ignored and no package root beneath. */
  const CLEAN_DIR = () => ({ ignored: false, packageRoot: false });
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function checkout(): string {
    const root = mkdtempSync(join(tmpdir(), 'projectos-scope-'));
    made.push(root);
    for (const d of ['src', 'docs/notes', '.projectops/proof', 'projectos/validators', 'projectos/agent', 'Mixed']) {
      mkdirSync(join(root, ...d.split('/')), { recursive: true });
    }
    writeFileSync(join(root, 'src', 'app.ts'), '');
    writeFileSync(join(root, 'README.md'), '');
    return root;
  }

  it('grants exactly the named files and directories, two tools each, and nothing else', () => {
    const root = checkout();
    const g = scopeWriteGrants(root, 'Change src/app.ts and the notes under docs/notes, plus ./README.md, src/new.ts and src/newdir/.', CLEAN_DIR);
    expect(g.problems).toEqual([]);
    expect(g.paths).toEqual(['src/app.ts', 'docs/notes/**', './README.md', 'src/new.ts', 'src/newdir/**']);
    expect(g.grants).toEqual([
      'Write(src/app.ts)', 'Edit(src/app.ts)',
      'Write(docs/notes/**)', 'Edit(docs/notes/**)',
      'Write(./README.md)', 'Edit(./README.md)',
      'Write(src/new.ts)', 'Edit(src/new.ts)',
      'Write(src/newdir/**)', 'Edit(src/newdir/**)',
    ]);
  });

  it('an empty scope grants nothing', () => {
    expect(scopeWriteGrants(checkout(), '')).toEqual({ grants: [], paths: [], problems: [] });
  });

  it.each([
    ['an absolute path', '/etc/passwd.json'],
    ['a drive letter', 'C:/Windows/system.ini.json'],
    ['a drive-relative path', 'C:src/app.ts'],
    ['a backslash absolute path', '\\\\server\\share\\x.ts'],
    ['a parent segment', 'src/../../outside.ts'],
    ['a dot segment', 'src/./app.ts'],
    ['an empty segment', 'src//app.ts'],
    ['an alternate data stream', 'src/app.ts:hidden'],
    ['an 8.3 short name', 'PROGRA~1/x.ts'],
    ['a trailing-dot segment', 'src./app.ts'],
    ['the repository database', '.git/config.json'],
    ["ProjectOS's own brief", '.projectops/execution/x.brief.json'],
    ["ProjectOS's own evidence", '.projectops/execution/x.evidence.json'],
    // ECC SECURITY H1 / ECC CODE HIGH-2: the runtime's own records, in every form.
    ['the execution records directory', '.projectops/execution/'],
    ['the execution records directory, unslashed', '.projectops/execution'],
    ['the whole governance tree', '.projectops/'],
    ['an invocation record', '.projectops/execution/x.invocation.json'],
    ['closure evidence', '.projectops/closure/PHASE1A.json'],
    ['a closure decision', '.projectops/closure/decisions/PHASE1A.json'],
    ['a validation record', '.projectops/validation/0123456789abcdef0123456789abcdef01234567.json'],
    ['a phase record', '.projectops/phases/PHASE1A.json'],
    ['the gatekeeper ledger', '.projectops/gatekeeper-ledger.json'],
    ['the work record', '.projectops/work.v1.json'],
    ["the worker's own settings", '.claude/settings.json'],
    ['git attributes', '.gitattributes/x.json'],
    // ECC SECURITY H2: a character outside the path alphabet refuses; it never widens to a directory.
    ['a star glob', 'projectos/agent/test/*.test.ts'],
    ['a glob on the worker records', '.projectops/execution/*.findings.json'],
    ['a bracket glob', 'docs/speed/[a-z]x.md'],
    ['a brace glob', 'src/{a,b}.ts'],
    ['a question-mark glob', 'src/a?.ts'],
    ['an at sign', 'src/@types/x.ts'],
    ['a lookalike letter', 'projectos/validators/\uff56al-new.cjs'],
    ['a URL', 'https://example.com/a.json'],
    // ECC SECURITY M3: a bare filename may match the same name at any depth.
    ['a bare filename', 'project-config.json'],
    // ECC SECURITY round 2 N2: the governance trust roots, and the closure records G4 ignores.
    ['the closure delegation', '.projectops/authority/closure-delegation.json'],
    ['the gatekeeper configuration', '.projectops/gatekeeper.json'],
    ['the project configuration', '.projectops/project-config.json'],
    ['the workforce policy', '.projectops/workforce/selection-policy.json'],
    ['a closure report', 'knowledge/reports/x.md'],
    ['the closure reports directory', 'knowledge/reports/'],
    // ECC SECURITY round 2 N5: hooks and settings at ANY depth, and device names.
    ['a nested repository database', 'tools/.git/hooks/pre-commit.sh'],
    ['husky hooks', '.husky/pre-commit.sh'],
    ['editor settings', '.vscode/settings.json'],
    ['a device name', 'docs/aux.md'],
  ])('REFUSES %s (%s)', (_label, path) => {
    const g = scopeWriteGrants(checkout(), `Touch ${path} only.`, CLEAN_DIR);
    expect(g.problems.length, path).toBeGreaterThan(0);
    // Refused by a RULE, not merely because git could not be asked: the inspector here is clean.
    expect(g.problems.every((p) => !p.includes("could not be checked")), path).toBe(true);
    expect(g.grants.some((x) => x.includes('outside') || x.includes('passwd') || x.includes('hidden'))).toBe(false);
  });

  it('REFUSES a case variant of an existing path — the same file under a name no review compared', () => {
    const g = scopeWriteGrants(checkout(), 'Edit mixed/x.ts.', CLEAN_DIR);
    expect(g.problems.join(' ')).toContain("differs in case from 'Mixed'");
    expect(scopeWriteGrants(checkout(), 'Edit SRC/app.ts.', CLEAN_DIR).problems.length).toBe(1);
  });

  it('REFUSES a path through a link or junction', () => {
    const root = checkout();
    const elsewhere = mkdtempSync(join(tmpdir(), 'projectos-scope-target-'));
    made.push(elsewhere);
    symlinkSync(elsewhere, join(root, 'linked'), 'junction');
    const g = scopeWriteGrants(root, 'Write linked/escape.ts.', CLEAN_DIR);
    expect(g.problems.join(' ')).toContain('passes through a link');
    expect(g.grants).toEqual([]);
  });

  it('REFUSES a directory that would grant governance or validator files as a side effect', () => {
    // A bare word is not read as a path at all (no grant, the safe direction); a path-shaped one is.
    expect(scopeWriteGrants(checkout(), 'Everything in projectos.', CLEAN_DIR).grants).toEqual([]);
    const g = scopeWriteGrants(checkout(), 'Everything under projectos/agent and projectos/.', CLEAN_DIR);
    expect(g.problems.some((p) => p.includes("'projectos/'") && p.includes('governance, validator or workflow'))).toBe(true);
    // A protected root named as a directory is refused too: those are writable file by file only.
    expect(scopeWriteGrants(checkout(), 'Under projectos/validators/ only', CLEAN_DIR).problems.length).toBe(1);
    // A case trick does not hide the protected root either.
    expect(scopeWriteGrants(checkout(), 'Under Projectos/x.ts', CLEAN_DIR).problems.length).toBe(1);
  });

  it('REFUSES the whole run when a sentence EXCLUDES a path, rather than granting what it excluded', () => {
    for (const prose of [
      'Do not touch projectos/core/ while editing src/a.ts.',
      'Edit src/a.ts. Never src/secret.ts.',
      'Out of scope: projectos/host/. In scope: src/a.ts.',
      'Everything in src/ except src/vendor/.',
      // ECC round 2: contractions, other phrasings, and a negation in an EARLIER sentence.
      "Don't touch projectos/core/. Edit src/a.ts.",
      'The worker cannot write projectos/core/ but may edit src/a.ts.',
      'Leave projectos/core/ unchanged; edit src/a.ts.',
      'Neither projectos/core/ nor projectos/host/ is writable.',
      'Avoid projectos/core/. Edit src/a.ts.',
      'projectos/core/ is read-only. Edit src/a.ts.',
      'Do not touch the following paths.\nprojectos/core/src/x.ts',
      // ECC round 3: the phrasings the round-2 vocabulary still missed.
      'Skip projectos/core/. Edit src/a.ts.',
      'projectos/core/ is read only; edit src/a.ts.',
      'Keep projectos/core/ frozen and edit src/a.ts.',
      'Hands off projectos/core/. Edit src/a.ts.',
      'Stay away from projectos/core/. Edit src/a.ts.',
      'Ignore projectos/core/ and edit src/a.ts.',
      'Edit src/a.ts; projectos/core/ as-is.',
      // ECC SECURITY round 4: the typographic apostrophe plan text and models actually write.
      'Don’t modify projectos/core/. Edit src/a.ts.',
    ]) {
      const g = scopeWriteGrants(checkout(), prose, CLEAN_DIR);
      expect(g.problems.length, prose).toBeGreaterThan(0);
      expect(g.problems.join(' '), prose).toContain('also excludes');
    }
  });

  it('REFUSES a directory over git-ignored output or a package root, and one git cannot describe', () => {
    const root = checkout();
    expect(scopeWriteGrants(root, 'Work in src/.', () => ({ ignored: true, packageRoot: false })).problems.join(' ')).toContain('git-ignored');
    expect(scopeWriteGrants(root, 'Work in src/.', () => ({ ignored: false, packageRoot: true })).problems.join(' ')).toContain('package root');
    expect(scopeWriteGrants(root, 'Work in src/.', () => null).problems.join(' ')).toContain('could not be checked against git');
    // A FILE grant is inspected too (ECC SECURITY round 3 N7): an ignored file is invisible to every
    // review, and a file git cannot describe is refused rather than assumed tracked.
    expect(scopeWriteGrants(root, 'Edit src/app.ts.', () => null).problems.join(' ')).toContain('could not be checked');
    expect(scopeWriteGrants(root, 'Edit src/app.ts.', () => ({ ignored: true, packageRoot: false })).problems.join(' ')).toContain('git-ignored path');
    // A package root matters for a directory only: editing a package.json is a reviewable diff.
    expect(scopeWriteGrants(root, 'Edit src/app.ts.', () => ({ ignored: false, packageRoot: true })).problems).toEqual([]);
  });

  it("REFUSES the project's own governed files — plan, current state, configuration — wherever they live", () => {
    const root = checkout();
    const governed = ['state/plan.json', 'projectos/state/my-current.json', '.projectops/project-config.json'];
    for (const path of ['state/plan.json', 'projectos/state/my-current.json']) {
      const g = scopeWriteGrants(root, `Edit ${path}.`, CLEAN_DIR, governed);
      expect(g.problems.join(' '), path).toContain("plan's own governed state");
    }
    // ECC SECURITY round 4 LOW-B: nor a directory that contains one.
    for (const dir of ['state/', 'projectos/state/', 'projectos/']) {
      const g = scopeWriteGrants(root, `Work in ${dir} now.`, CLEAN_DIR, governed);
      expect(g.grants, dir).toEqual([]);
      expect(g.problems.join(' '), dir).toMatch(/governed state|governance, validator/);
    }
  });

  it('REFUSES, against this real repository, a directory grant over a package whose build output is ignored', () => {
    const root = resolve(__dirname, '../../..');
    const g = scopeWriteGrants(root, 'Work in projectos/agent/ now.', gitDirectoryInspector(nodeSystem, root));
    expect(g.grants).toEqual([]);
    expect(g.problems.length).toBe(1);
    // And a FILE that is itself ignored build output, even one that does not exist yet.
    const f = scopeWriteGrants(root, 'Edit projectos/agent/dist/cli.js and projectos/agent/node_modules/vitest/x.js.', gitDirectoryInspector(nodeSystem, root));
    expect(f.grants).toEqual([]);
    expect(f.problems.length).toBe(2);
  });

  it('governance and validator files ARE writable when the approved scope names them itself', () => {
    const g = scopeWriteGrants(checkout(), 'Add projectos/validators/val-new1a.cjs and .projectops/proof/fixture.json.', CLEAN_DIR);
    expect(g.problems).toEqual([]);
    expect(g.paths).toEqual(['projectos/validators/val-new1a.cjs', '.projectops/proof/fixture.json']);
  });

  it("this phase's own approved scope becomes a grant with no refusal", () => {
    const root = resolve(__dirname, '../../..');
    const plan = JSON.parse(readFileSync(resolve(root, 'docs/projectos-autonomy-bootstrap-phases.json'), 'utf8')) as {
      phases: { phaseId: string; scope: string }[];
    };
    const scope = plan.phases.find((p) => p.phaseId === 'PROJECTOS-BOOT-CONTINUE1A')?.scope ?? '';
    const g = scopeWriteGrants(root, scope, gitDirectoryInspector(nodeSystem, root));
    expect(g.problems).toEqual([]);
    expect(g.paths).toContain('projectos/agent/src/loop/workers.ts');
    expect(g.paths).toContain('projectos/agent/test/**');
    expect(g.paths.some((p) => p.startsWith('.projectops'))).toBe(false);
  });
});

/**
 * A QUESTION MUST BE ANSWERABLE AS ASKED.
 *
 * The reviewer was offered `ff-only-integration` while no integration target is configured — the
 * executor could only ever have refused it, and the plan's own constraint prohibited merge. It
 * declined to authorise anything until the scope was reconciled, which was correct: ProjectOS had
 * asked permission to do something it cannot do.
 */
describe('performableTechnicalActions', () => {
  it('does not offer fast-forward integration when no target is configured', async () => {
    const { performableTechnicalActions } = await import('../src/loop/technicalContinuation.js');
    for (const none of [null, '', '   ']) {
      expect(performableTechnicalActions(none)).not.toContain('ff-only-integration');
    }
  });

  it('offers it when a target IS configured, and never invents an action', async () => {
    const { performableTechnicalActions } = await import('../src/loop/technicalContinuation.js');
    const core = await import('@projectos/core');
    expect(performableTechnicalActions('main')).toContain('ff-only-integration');
    for (const a of performableTechnicalActions('main')) {
      expect(core.TECHNICAL_ACTIONS as readonly string[]).toContain(a);
    }
    expect(performableTechnicalActions(null)).toContain('commit');
    expect(performableTechnicalActions(null)).toContain('push');
  });
});
