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
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  authorisedWorkers,
  toolGrantProblems,
  writePathGrants,
  phaseWritePaths,
  gitDirectoryInspector,
  gitIgnoredUnder,
  fileGrantsNotFiles,
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
   * RETIRED (PROJECTOS-BOOT-CONTINUE1A): a phase's source grant now comes only from its approved writePaths.
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
      expect(problems[0], grant).toContain('approved writePaths');
    }
  });

  it('the committed owner record that released it is gone from this repository', () => {
    expect(existsSync(resolve(__dirname, '../../../.projectops/authority/worker-source-grant.json'))).toBe(false);
  });
});

/**
 * THE IMPLEMENTER'S GRANT IS EXACTLY THE APPROVED writePaths — PROJECTOS-BOOT-CONTINUE1A (continuation
 * five), made structured by PROJECTOS-FINISH-WRITEPATHS1A. Judged against a REAL checkout, because links
 * and case only exist on a real filesystem.
 */
describe('writePathGrants', () => {
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

  it('grants exactly the listed files and directories, two tools each, and nothing else', () => {
    const root = checkout();
    const g = writePathGrants(root, ['src/app.ts', 'docs/notes', './README.md', 'src/new.ts', 'src/newdir/'], CLEAN_DIR);
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

  it('an empty list grants nothing', () => {
    expect(writePathGrants(checkout(), [])).toEqual({ grants: [], paths: [], problems: [] });
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
    // FINISH-WRITEPATHS1A: an entry is ONE path, never a sentence to search for paths.
    ['a space inside an entry', 'src/a.ts src/b.ts'],
    ['a sentence as an entry', 'Edit src/a.ts'],
    ['a trailing space', 'src/app.ts '],
    // ECC SECURITY M3: a bare filename may match the same name at any depth.
    ['a bare filename', 'project-config.json'],
    ['a bare word', 'projectos'],
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
    // FINISH-WRITEPATHS1A (ECC SECURITY M3): agent instruction files a later agent would obey.
    ['an agent instruction file', 'docs/CLAUDE.md'],
    ['a root agent instruction file', './AGENTS.md'],
    ['a local agent instruction file', 'src/CLAUDE.local.md'],
  ])('REFUSES %s (%s)', (_label, path) => {
    const g = writePathGrants(checkout(), [path], CLEAN_DIR);
    expect(g.problems.length, path).toBeGreaterThan(0);
    // Refused by a RULE, not merely because git could not be asked: the inspector here is clean.
    expect(g.problems.every((p) => !p.includes("could not be checked")), path).toBe(true);
    expect(g.grants, path).toEqual([]);
  });

  it('REFUSES an entry that is not a non-empty path string, rather than skipping it', () => {
    for (const bad of [42, null, '', ['src/a.ts'], { path: 'src/a.ts' }]) {
      const g = writePathGrants(checkout(), ['src/app.ts', bad as unknown], CLEAN_DIR);
      expect(g.problems.join(' '), JSON.stringify(bad)).toContain('writePaths[1] is not a non-empty path string');
    }
  });

  it('REFUSES a case variant of an existing path — the same file under a name no review compared', () => {
    const g = writePathGrants(checkout(), ['mixed/x.ts'], CLEAN_DIR);
    expect(g.problems.join(' ')).toContain("differs in case from 'Mixed'");
    expect(writePathGrants(checkout(), ['SRC/app.ts'], CLEAN_DIR).problems.length).toBe(1);
  });

  it('REFUSES a path through a link or junction', () => {
    const root = checkout();
    const elsewhere = mkdtempSync(join(tmpdir(), 'projectos-scope-target-'));
    made.push(elsewhere);
    symlinkSync(elsewhere, join(root, 'linked'), 'junction');
    const g = writePathGrants(root, ['linked/escape.ts'], CLEAN_DIR);
    expect(g.problems.join(' ')).toContain('passes through a link');
    expect(g.grants).toEqual([]);
  });

  it('REFUSES a directory that would grant governance or validator files as a side effect', () => {
    const g = writePathGrants(checkout(), ['projectos/agent', 'projectos/'], CLEAN_DIR);
    expect(g.problems.some((p) => p.includes("'projectos/'") && p.includes('governance, validator or workflow'))).toBe(true);
    // A protected root named as a directory is refused too: those are writable file by file only.
    expect(writePathGrants(checkout(), ['projectos/validators/'], CLEAN_DIR).problems.length).toBe(1);
    // A case trick does not hide the protected root either.
    expect(writePathGrants(checkout(), ['Projectos/x.ts'], CLEAN_DIR).problems.length).toBe(1);
  });

  it('REFUSES a directory over git-ignored output or a package root, and one git cannot describe', () => {
    const root = checkout();
    expect(writePathGrants(root, ['src/'], () => ({ ignored: true, packageRoot: false })).problems.join(' ')).toContain('git-ignored');
    expect(writePathGrants(root, ['src/'], () => ({ ignored: false, packageRoot: true })).problems.join(' ')).toContain('package root');
    expect(writePathGrants(root, ['src/'], () => null).problems.join(' ')).toContain('could not be checked against git');
    // A FILE grant is inspected too (ECC SECURITY round 3 N7): an ignored file is invisible to every
    // review, and a file git cannot describe is refused rather than assumed tracked.
    expect(writePathGrants(root, ['src/app.ts'], () => null).problems.join(' ')).toContain('could not be checked');
    expect(writePathGrants(root, ['src/app.ts'], () => ({ ignored: true, packageRoot: false })).problems.join(' ')).toContain('git-ignored path');
    // A package root matters for a directory only: editing a package.json is a reviewable diff.
    expect(writePathGrants(root, ['src/app.ts'], () => ({ ignored: false, packageRoot: true })).problems).toEqual([]);
  });

  it("REFUSES the project's own governed files — plan, current state, configuration — wherever they live", () => {
    const root = checkout();
    const governed = ['state/plan.json', 'projectos/state/my-current.json', '.projectops/project-config.json'];
    for (const path of ['state/plan.json', 'projectos/state/my-current.json']) {
      const g = writePathGrants(root, [path], CLEAN_DIR, governed);
      expect(g.problems.join(' '), path).toContain("plan's own governed state");
    }
    // ECC SECURITY round 4 LOW-B: nor a directory that contains one.
    for (const dir of ['state/', 'projectos/state/', 'projectos/']) {
      const g = writePathGrants(root, [dir], CLEAN_DIR, governed);
      expect(g.grants, dir).toEqual([]);
      expect(g.problems.join(' '), dir).toMatch(/governed state|governance, validator/);
    }
  });

  it('REFUSES, against this real repository, a directory grant over a package whose build output is ignored', () => {
    const root = resolve(__dirname, '../../..');
    const g = writePathGrants(root, ['projectos/agent/'], gitDirectoryInspector(nodeSystem, root));
    expect(g.grants).toEqual([]);
    expect(g.problems.length).toBe(1);
    // And a FILE that is itself ignored build output — the loop's own built enforcement code — even
    // one that does not exist yet.
    const f = writePathGrants(root, ['projectos/agent/dist/cli.js', 'projectos/agent/node_modules/vitest/x.js'], gitDirectoryInspector(nodeSystem, root));
    expect(f.grants).toEqual([]);
    expect(f.problems.length).toBe(2);
  });

  it('governance and validator files ARE writable when the approved list names them itself', () => {
    const g = writePathGrants(checkout(), ['projectos/validators/val-new1a.cjs', '.projectops/proof/fixture.json'], CLEAN_DIR);
    expect(g.problems).toEqual([]);
    expect(g.paths).toEqual(['projectos/validators/val-new1a.cjs', '.projectops/proof/fixture.json']);
  });

  it("this phase's own approved writePaths become a grant with no refusal, and Every plan v1.9 phase carries writePaths", () => {
    const root = resolve(__dirname, '../../..');
    const plan = JSON.parse(readFileSync(resolve(root, 'docs/projectos-finish-phases.json'), 'utf8')) as Record<string, unknown>;
    const declared = phaseWritePaths(plan, 'PROJECTOS-FINISH-WRITEPATHS1A');
    expect(declared.problems).toEqual([]);
    const g = writePathGrants(root, declared.entries, gitDirectoryInspector(nodeSystem, root));
    expect(g.problems).toEqual([]);
    expect(g.paths).toContain('projectos/agent/src/loop/workers.ts');
    expect(g.paths).toContain('projectos/agent/test/**');
    expect(g.paths.some((p) => p.startsWith('.projectops'))).toBe(false);
    for (const phase of plan['phases'] as { phaseId: string; writePaths?: unknown }[]) {
      expect(Array.isArray(phase.writePaths), phase.phaseId).toBe(true);
      const each = writePathGrants(root, phaseWritePaths(plan, phase.phaseId).entries, gitDirectoryInspector(nodeSystem, root));
      expect(each.problems, phase.phaseId).toEqual([]);
      expect(each.paths.length, phase.phaseId).toBeGreaterThan(0);
    }
  });
});

/**
 * WHAT A DIRECTORY OR NEW-FILE GRANT MUST NOT BECOME — PROJECTOS-FINISH-WRITEPATHS1A (ECC SECURITY M3, M4).
 * The entry rules judge only the path the list names; these are the after-attempt checks for what a
 * worker creates beneath it.
 */
describe('the after-attempt scan of what a worker created under its grant', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function repo(): string {
    const root = mkdtempSync(join(tmpdir(), 'projectos-scan-'));
    made.push(root);
    execFileSync('git', ['-C', root, 'init', '--quiet']);
    mkdirSync(join(root, 'notes'), { recursive: true });
    return root;
  }

  it('flags a hook or settings directory and an agent instruction file created beneath a directory grant', () => {
    const root = repo();
    mkdirSync(join(root, 'notes', '.claude', 'skills'), { recursive: true });
    writeFileSync(join(root, 'notes', '.claude', 'skills', 'x.md'), 'obey me\n');
    writeFileSync(join(root, 'notes', 'CLAUDE.md'), 'obey me\n');
    writeFileSync(join(root, 'notes', 'AGENTS.md'), 'obey me\n');
    writeFileSync(join(root, 'notes', 'plain.md'), 'work\n');
    const found = gitIgnoredUnder(nodeSystem, root, ['notes']) ?? [];
    expect(found).toEqual(['notes/.claude/skills/x.md', 'notes/AGENTS.md', 'notes/CLAUDE.md']);
  });

  it('flags a FILE grant the worker made into a directory, and nothing for a file or an absent path', () => {
    const root = repo();
    const grants = ['Write(notes/new.md)', 'Edit(notes/new.md)', 'Write(notes/real.md)', 'Write(notes/absent.md)', 'Write(notes/dir/**)', 'Write(.projectops/execution/*.findings.json)'];
    mkdirSync(join(root, 'notes', 'new.md'), { recursive: true });
    writeFileSync(join(root, 'notes', 'new.md', 'smuggled.cjs'), 'x\n');
    writeFileSync(join(root, 'notes', 'real.md'), 'work\n');
    mkdirSync(join(root, 'notes', 'dir'), { recursive: true });
    expect(fileGrantsNotFiles(root, grants)).toEqual(['notes/new.md']);
  });
});

/**
 * THE SCOPE SENTENCE GRANTS NOTHING — PROJECTOS-FINISH-WRITEPATHS1A. The grant used to be read out of the
 * scope prose against a list of negation words; a plan now states its grant as data, and only that.
 */
describe('phaseWritePaths', () => {
  const plan = (phase: Record<string, unknown>) => ({ phases: [{ phaseId: 'P1A', ...phase }] });

  it('a phase whose scope names paths but declares no writePaths grants only the worker-owned records', () => {
    const declared = phaseWritePaths(plan({ scope: 'Edit src/app.ts and projectos/agent/src/loop/workers.ts.' }), 'P1A');
    expect(declared).toEqual({ entries: [], problems: [] });
  });

  it('exclusion wording in the scope is irrelevant: the list alone decides', () => {
    const declared = phaseWritePaths(plan({ scope: 'Do not touch projectos/core/. Never src/secret.ts.', writePaths: ['src/app.ts'] }), 'P1A');
    expect(declared).toEqual({ entries: ['src/app.ts'], problems: [] });
  });

  it('REFUSES writePaths that is not a list, rather than reading it as no paths', () => {
    for (const bad of ['src/app.ts', 7, null, { a: 1 }]) {
      expect(phaseWritePaths(plan({ writePaths: bad }), 'P1A').problems.join(' '), JSON.stringify(bad)).toContain('not a list');
    }
  });

  it('a phase the plan does not contain grants nothing', () => {
    expect(phaseWritePaths(plan({ writePaths: ['src/app.ts'] }), 'OTHER1A')).toEqual({ entries: [], problems: [] });
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
