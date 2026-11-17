/**
 * The Codex IMPLEMENTER adapter. PROJECTOS-WORKER-CODEX-IMPLEMENTER1A (plan 4.1a).
 *
 * Fakes only: every spawn is recorded and answered by a scripted fake System. Codex is never run, never
 * logged into, and no network is touched. The fake also plays git for the scope check: it keeps a map of
 * file contents and answers `status`, `hash-object` and `ls-files` from it, so "Codex wrote a file" is a
 * change to that map made inside the scripted `codex exec` call.
 *
 * What is proven: the exact command line (workspace-write sandbox the adapter sets, checkout, no credential,
 * grants consumed and never forwarded); that nothing can widen the sandbox; that scope is judged on the
 * candidate before and after the run and an out-of-scope write refuses the run by name; that a steered,
 * failed or credential-bearing run is refused; and that the kind implements and never reviews.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CODEX_IMPLEMENTER,
  codexImplementerAdapterWith,
  codexImplementerArgProblems,
  codexImplementerArgv,
  implementerSandboxProblem,
  readImplementerEvents,
} from '../src/loop/adapters/codexImplementer.js';
import { INDEX_FLAG_PREFIX, REPOSITORY_CONFIGURATION, REPOSITORY_EXCLUDES, REPOSITORY_HEAD, pathInGrants } from '../src/loop/writeScope.js';
import { BUILT_IN_ADAPTERS, CONTEXT_POINTABLE_KINDS, contextPointerPathOf, correctionInstruction, pointerInstruction } from '../src/loop/adapters/claudeCodeCli.js';
import { CODEX_CLI } from '../src/loop/adapters/codexCli.js';
import { roleBindingProblems } from '../src/loop/reviewRoles.js';
import type { AuthorisedWorker, WorkerSession } from '../src/loop/workers.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { ExecOptions, ExecResult, System } from '../src/system.js';
import { fakeScratchHost, FAKE_SCRATCH_ROOT, type FakeScratchScript } from './support/fakeScratchHost.js';

const ROOT = 'C:/dev/candidate';
const CODEX = 'C:/tools/codex/codex.exe';
const BRIEF_PATH = `${ROOT}/.projectops/execution/s1.brief.json`;
const EVIDENCE_PATH = `${ROOT}/.projectops/execution/s1.evidence.json`;
const RECORD_GRANTS = 'Write(.projectops/execution/*.findings.json),Edit(.projectops/execution/*.findings.json),Write(.projectops/execution/*.effects.json),Edit(.projectops/execution/*.effects.json)';
const SCOPE_GRANT = 'Edit(src/feature.ts),Write(src/feature.ts)';

const INSTRUCTIONS = { pointerInstruction, correctionInstruction, contextPointerPathOf };
/**
 * PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: the worker now runs in a scratch checkout, and a scratch needs a real directory. These tests
 * drive the adapter with a scripted scratch (no disk); the real scratch is `scratchCheckout.test.ts` and `codexImplementerScratch.test.ts`.
 * Every assertion below that used to name the real checkout as the worker's root and brief now names the scratch.
 */
const adapter = codexImplementerAdapterWith(INSTRUCTIONS, fakeScratchHost({ realRoot: ROOT }).host);
const SCRATCH_BRIEF_PATH = `${FAKE_SCRATCH_ROOT}/.projectops/execution/s1.brief.json`;

const worker = (args: readonly string[] = ['--allowedTools', RECORD_GRANTS], over: Partial<AuthorisedWorker> = {}): AuthorisedWorker => ({
  workerId: 'codex-local',
  kind: CODEX_IMPLEMENTER,
  command: CODEX,
  args,
  timeoutMs: 600_000,
  ...over,
});

const briefOf = (over: { contextPath?: string; head?: string | null } = {}): WorkerBrief =>
  ({
    repository: { root: ROOT, head: over.head === undefined ? 'a'.repeat(40) : over.head },
    records: {
      briefPath: BRIEF_PATH,
      findingsPath: `${ROOT}/.projectops/execution/s1.findings.json`,
      effectsPath: `${ROOT}/.projectops/execution/s1.effects.json`,
      evidencePath: EVIDENCE_PATH,
      ...(over.contextPath === undefined ? {} : { contextPath: over.contextPath }),
    },
  }) as unknown as WorkerBrief;

const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';
const CLEAN = jsonl(
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'i0', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'i1', type: 'file_change', changes: [{ path: 'src/feature.ts', kind: 'update' }], status: 'completed' } },
  { type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'Done.' } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
);
const ok = (stdout: string, over: Partial<ExecResult> = {}): ExecResult => ({ code: 0, stdout, stderr: '', ...over });

interface Call { readonly cmd: string; readonly args: readonly string[]; readonly options: ExecOptions | undefined }

/**
 * A fake System. `files` is the checkout: path -> content. `baseline` lists the paths git calls dirty at the
 * start. `codex` runs when the codex binary is called and may change `files`; its reply is what `exec` returns.
 */
interface World {
  /** Ignored entries as git lists them at its collapsed level. */
  ignored: string[];
  /** The repository's own configuration, as `git config --local --list` prints it. */
  config: string;
  /** Filter drivers the configuration defines. */
  filters: string[];
  /** Contents of ignored files (path -> content); a path here exists on disk. */
  ignoredContent: Record<string, string>;
  head: string;
  /** The text of the repository's info/exclude file. */
  exclude: string;
  /** `git ls-files -v` tags that are not the ordinary `H`, as `tag path`. */
  indexFlags: string[];
  /** Raw extra status tokens, for a rename. */
  statusExtra: string;
}

function fakeWorld(opts: {
  files?: Record<string, string>;
  ignored?: string[];
  filters?: string[];
  codex?: (files: Record<string, string>, world: World) => ExecResult;
  gitFailsOnCall?: number;
  evidenceExists?: boolean;
}) {
  const files: Record<string, string> = { ...(opts.files ?? {}) };
  const world: World = { ignored: [...(opts.ignored ?? [])], config: 'core.bare=false', filters: [...(opts.filters ?? [])], ignoredContent: {}, head: 'a'.repeat(40), exclude: '', indexFlags: [], statusExtra: '' };
  const calls: Call[] = [];
  let gitCalls = 0;
  const sys: System = {
    cwd: () => ROOT,
    now: () => '2026-11-17T12:00:00Z',
    readText: (p) => (p === `${ROOT}/.git/info/exclude` ? world.exclude : null),
    writeText: () => undefined,
    exists: (p) => (p === EVIDENCE_PATH ? opts.evidenceExists === true : [...Object.keys(files), ...Object.keys(world.ignoredContent)].some((f) => `${ROOT}/${f}` === p)),
    listDir: () => [],
    renameFile: () => true,
    createExclusive: () => true,
    removeFile: () => true,
    exec: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      if (cmd === CODEX) return (opts.codex ?? (() => ok(CLEAN)))(files, world);
      // git, as the scope snapshot asks it: configuration, filters, status (-z), hash-object, ignored status
      const verb = args.find((a) => a === 'status' || a === 'hash-object' || a === 'config' || a === 'rev-parse' || a === 'ls-files');
      if (verb === 'rev-parse') return ok(args.includes('--git-path') ? '.git/info/exclude\n' : `${world.head}\n`);
      if (verb === 'ls-files') return ok(world.indexFlags.map((f) => `${f}\0`).join(''));
      if (verb === 'config') {
        if (args.includes('--name-only')) {
          return world.filters.length === 0 ? { code: 1, stdout: '', stderr: '' } : ok(world.filters.map((f) => `filter.${f}.clean`).join('\n') + '\n');
        }
        return ok(world.config);
      }
      if (verb === 'status') {
        gitCalls += 1;
        if (opts.gitFailsOnCall === gitCalls) return { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
        if (args.includes('.projectops')) return ok(Object.keys(world.ignoredContent).filter((p) => p.startsWith('.projectops/')).map((p) => `!! ${p}\0`).join(''));
        if (args.includes('--ignored')) return ok(world.ignored.map((p) => `!! ${p}\0`).join(''));
        return ok(Object.keys(files).sort().map((f) => ` M ${f}\0`).join('') + world.statusExtra);
      }
      if (verb === 'hash-object') {
        const paths = args.slice(args.indexOf('--') + 1);
        return ok(paths.map((p) => `blob:${files[p] ?? world.ignoredContent[p] ?? ''}`).join('\n') + '\n');
      }
      return ok('');
    },
  };
  return { sys, calls, files, world };
}

const codexCalls = (calls: readonly Call[]) => calls.filter((c) => c.cmd === CODEX);

describe('the Codex implementer command line', () => {
  it('runs codex exec in the workspace-write sandbox, in the checkout, with the pointer sentence as the prompt', () => {
    const { sys, calls } = fakeWorld({});
    const out = adapter.start(sys, worker(['--allowedTools', RECORD_GRANTS, '-m', 'gpt-5-codex']), briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('completed');
    const call = codexCalls(calls)[0];
    expect(call?.cmd).toBe(CODEX);
    expect(call?.args).toEqual([
      'exec', '-m', 'gpt-5-codex',
      '--sandbox', 'workspace-write',
      '-c', 'windows.sandbox="elevated"',
      '--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--ephemeral',
      '--cd', FAKE_SCRATCH_ROOT,
      pointerInstruction(SCRATCH_BRIEF_PATH),
    ]);
    expect(call?.options?.cwd).toBe(FAKE_SCRATCH_ROOT);
  });

  it('is bounded, scrubs credential-shaped environment variables and passes no environment of its own', () => {
    const { sys, calls } = fakeWorld({});
    adapter.start(sys, worker(), briefOf(), BRIEF_PATH);
    const options = codexCalls(calls)[0]?.options;
    expect(options?.timeoutMs).toBe(600_000);
    expect(options?.maxOutputBytes).toBeGreaterThan(0);
    expect(options?.scrubCredentials).toBe(true);
    expect(options?.ensureSystemPath).toBe(true);
    expect(options).not.toHaveProperty('env');
  });

  it('never forwards the grants to Codex: they are the adapter\'s own scope, not a Codex flag', () => {
    const { sys, calls } = fakeWorld({});
    adapter.start(sys, worker(['--allowedTools', `${RECORD_GRANTS},${SCOPE_GRANT}`]), briefOf(), BRIEF_PATH);
    const argv = codexCalls(calls)[0]?.args ?? [];
    expect(argv.join(' ')).not.toMatch(/allowedTools|allowed-tools|Edit\(|Write\(/);
  });

  it('uses the correction sentence once the loop has written the evidence record, and the start sentence before', () => {
    const first = fakeWorld({});
    adapter.start(first.sys, worker(), briefOf(), BRIEF_PATH);
    expect(codexCalls(first.calls)[0]?.args.at(-1)).toBe(pointerInstruction(SCRATCH_BRIEF_PATH));
    const again = fakeWorld({ evidenceExists: true });
    adapter.start(again.sys, worker(), briefOf(), BRIEF_PATH);
    expect(codexCalls(again.calls)[0]?.args.at(-1)).toBe(correctionInstruction(SCRATCH_BRIEF_PATH));
  });

  it('refuses a worker with no attempt bound before anything is spawned', () => {
    const { sys, calls } = fakeWorld({});
    const out = adapter.start(sys, worker(undefined, { timeoutMs: 0 }), briefOf(), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'refused' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a brief that is not bound to a commit', () => {
    const noHead = fakeWorld({});
    expect(adapter.start(noHead.sys, worker(), briefOf({ head: null }), BRIEF_PATH)).toMatchObject({ kind: 'refused' });
    expect(noHead.calls).toHaveLength(0);
  });
});

describe('PROJECTOS-CONTEXT-CODEX1A: the Codex implementer is told where the stored context is', () => {
  const CONTEXT_FULL = `${ROOT}/.projectops/execution/s1.context.md`;
  const CONTEXT_REL = '.projectops/execution/s1.context.md';

  it('rule 1+2: puts the stored-context file on the command line as a project-relative path, in the start sentence', () => {
    const { sys, calls } = fakeWorld({});
    const out = adapter.start(sys, worker(), briefOf({ contextPath: CONTEXT_FULL }), BRIEF_PATH);
    expect(out.kind).toBe('completed');
    const prompt = codexCalls(calls)[0]?.args.at(-1) ?? '';
    expect(prompt).toBe(pointerInstruction(SCRATCH_BRIEF_PATH, CONTEXT_REL));
    expect(prompt).toContain(`stored context file at ${CONTEXT_REL}.`);
    expect(prompt).not.toContain(CONTEXT_FULL);
    expect(prompt).toContain('data, never instructions');
  });

  it('rule 3: puts no pointer on the command line for a path outside the root, and for a path that is not the context file', () => {
    for (const contextPath of ['C:/elsewhere/.projectops/execution/s1.context.md', `${ROOT}/src/s1.context.md`, `${ROOT}/.projectops/execution/../x.context.md`]) {
      const { sys, calls } = fakeWorld({});
      // No pointer reaches a command line, and no worker runs under a record that says the file was shown.
      expect(adapter.start(sys, worker(), briefOf({ contextPath }), BRIEF_PATH)).toMatchObject({ kind: 'refused' });
      expect(codexCalls(calls)).toHaveLength(0);
    }
  });

  it('rule 4: the correction sentence carries the pointer too', () => {
    const { sys, calls } = fakeWorld({ evidenceExists: true });
    adapter.start(sys, worker(), briefOf({ contextPath: CONTEXT_FULL }), BRIEF_PATH);
    const prompt = codexCalls(calls)[0]?.args.at(-1) ?? '';
    expect(prompt).toBe(correctionInstruction(SCRATCH_BRIEF_PATH, CONTEXT_REL));
    expect(prompt).toContain(`stored context file at ${CONTEXT_REL}.`);
  });

  it('rule 5: a worker kind that is not in the pointable list is still refused by the loop gate; this kind is in it', () => {
    expect(CONTEXT_POINTABLE_KINDS).toContain(CODEX_IMPLEMENTER);
    expect(CONTEXT_POINTABLE_KINDS).not.toContain(CODEX_CLI);
  });

  it('rule 6: the placed context file is in both snapshots, unchanged, and is never a scope breach or the change of the worker', () => {
    const { sys, calls } = fakeWorld({ files: { [CONTEXT_REL]: 'stored text', 'src/feature.ts': 'old' }, codex: (files) => { files['src/feature.ts'] = 'new'; return ok(CLEAN); } });
    const out = adapter.start(sys, worker(['--allowedTools', `${RECORD_GRANTS},${SCOPE_GRANT}`]), briefOf({ contextPath: CONTEXT_FULL }), BRIEF_PATH);
    expect(out.kind).toBe('completed');
    const hashed = calls.filter((c) => c.args.includes('hash-object')).map((c) => c.args.slice(c.args.indexOf('--') + 1));
    expect(hashed.length).toBeGreaterThanOrEqual(2);
    for (const paths of hashed) expect(paths).toContain(CONTEXT_REL);
  });

  it('rule 6: a worker that rewrites or deletes the placed context file is still a breach, named, so the scope check is not weakened', () => {
    const rewrite = fakeWorld({ files: { [CONTEXT_REL]: 'stored text' }, codex: (files) => { files[CONTEXT_REL] = 'changed by the worker'; return ok(CLEAN); } });
    const out = adapter.start(rewrite.sys, worker(), briefOf({ contextPath: CONTEXT_FULL }), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'refused' });
    expect(out.kind === 'refused' ? out.detail : '').toContain(CONTEXT_REL);
    const removal = fakeWorld({ files: { [CONTEXT_REL]: 'stored text' }, codex: (files) => { delete files[CONTEXT_REL]; return ok(CLEAN); } });
    expect(adapter.start(removal.sys, worker(), briefOf({ contextPath: CONTEXT_FULL }), BRIEF_PATH)).toMatchObject({ kind: 'refused' });
  });

  it('rule 7: the adapter file imports nothing from the Claude adapter', () => {
    const source = readFileSync(resolve(__dirname, '../src/loop/adapters/codexImplementer.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]\.\/claudeCodeCli(?:\.js)?['"]/);
  });
});

describe('what can never reach the Codex command line', () => {
  it.each([
    ['--dangerously-bypass-approvals-and-sandbox'],
    ['--full-auto'],
    ['danger-full-access'],
    ['--add-dir'],
    ['-s'],
    ['--sandbox'],
    ['-c'],
    ['--config'],
    ['-p'],
    ['--profile'],
    ['--enable'],
    ['--worktree'],
  ])('refuses the configured argument %s', (arg) => {
    expect(codexImplementerArgProblems([arg]).length).toBeGreaterThan(0);
    const { sys, calls } = fakeWorld({});
    const out = adapter.start(sys, worker(['--allowedTools', RECORD_GRANTS, arg]), briefOf(), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'refused' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a model value that is a sandbox token or a credential', () => {
    expect(codexImplementerArgProblems(['-m', 'danger-full-access']).length).toBeGreaterThan(0);
    expect(codexImplementerArgProblems(['-m', 'my-api-key']).length).toBeGreaterThan(0);
  });

  it('refuses grants that are not file writes or reads, a joined --allowedTools=, and a grant with unbalanced parentheses', () => {
    expect(codexImplementerArgProblems(['--allowedTools', 'Bash(rm -rf:*)']).length).toBeGreaterThan(0);
    expect(codexImplementerArgProblems([`--allowedTools=${RECORD_GRANTS}`]).length).toBeGreaterThan(0);
    expect(codexImplementerArgProblems(['--allowedTools', 'Edit((x)']).length).toBeGreaterThan(0);
    expect(codexImplementerArgProblems(['--allowedTools']).length).toBeGreaterThan(0);
  });

  it('accepts model selection, the three reviewer switches and read and write grants', () => {
    expect(codexImplementerArgProblems(['-m', 'gpt-5-codex', '--skip-git-repo-check', '--allowedTools', `Read,${RECORD_GRANTS}`])).toEqual([]);
  });

  it('builds exactly one workspace-write sandbox and the final gate refuses any other shape', () => {
    const built = codexImplementerArgv(worker(), ROOT, 'do the phase');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(implementerSandboxProblem(built.argv)).toBeNull();
    const widened = [...built.argv.slice(0, -1).map((a) => (a === 'workspace-write' ? 'danger-full-access' : a)), 'x'];
    expect(implementerSandboxProblem(widened)).not.toBeNull();
    expect(implementerSandboxProblem(['exec', '--json', 'x'])).not.toBeNull();
    expect(implementerSandboxProblem(['exec', '--sandbox', 'workspace-write', '--sandbox', 'workspace-write', 'x'])).not.toBeNull();
    expect(implementerSandboxProblem(['exec', '--sandbox', 'workspace-write', '--add-dir', 'C:/x', 'x'])).not.toBeNull();
    expect(implementerSandboxProblem(['exec', '--sandbox', 'workspace-write', '-c', 'sandbox_mode="danger-full-access"', 'x'])).not.toBeNull();
  });

  it('refuses a prompt that would be read as a flag', () => {
    expect(codexImplementerArgv(worker(), ROOT, '--full-auto').ok).toBe(false);
    expect(codexImplementerArgv(worker(), ROOT, '   ').ok).toBe(false);
  });
});

describe('write scope is judged on the candidate, not on Codex\'s sandbox', () => {
  const scoped = worker(['--allowedTools', `${RECORD_GRANTS},${SCOPE_GRANT}`]);

  it('accepts a write inside the grants, including a worker-owned record matched by its glob', () => {
    const { sys } = fakeWorld({
      files: { 'src/feature.ts': 'old' },
      codex: (files) => {
        files['src/feature.ts'] = 'new';
        files['.projectops/execution/s1.findings.json'] = '{}';
        return ok(CLEAN);
      },
    });
    expect(adapter.start(sys, scoped, briefOf(), BRIEF_PATH)).toMatchObject({ kind: 'completed', exitCode: 0 });
  });

  it('refuses a write outside the grants and names the path', () => {
    const { sys } = fakeWorld({
      codex: (files) => {
        files['src/feature.ts'] = 'new';
        files['.projectops/authority/closure-delegation.json'] = '{"scopes":["all"]}';
        return ok(CLEAN);
      },
    });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.detail).toContain('.projectops/authority/closure-delegation.json');
      expect(out.detail).not.toContain('src/feature.ts');
    }
  });

  it('refuses a path that only shares a prefix with a granted directory or file', () => {
    const dirGrant = worker(['--allowedTools', 'Edit(src/lib),Write(src/lib)']);
    const { sys } = fakeWorld({ codex: (files) => { files['src/library/x.ts'] = 'x'; return ok(CLEAN); } });
    expect(adapter.start(sys, dirGrant, briefOf(), BRIEF_PATH).kind).toBe('refused');
    expect(pathInGrants('src/lib/x.ts', ['src/lib'])).toBe(true);
    expect(pathInGrants('src/library/x.ts', ['src/lib'])).toBe(false);
    expect(pathInGrants('src/feature.ts', ['src/feature.ts'])).toBe(true);
    expect(pathInGrants('src/feature.tsx', ['src/feature.ts'])).toBe(false);
  });

  it('a glob grant matches one path segment only', () => {
    const g = ['.projectops/execution/*.findings.json'];
    expect(pathInGrants('.projectops/execution/s1.findings.json', g)).toBe(true);
    expect(pathInGrants('.projectops/execution/a/b.findings.json', g)).toBe(false);
    expect(pathInGrants('.projectops/execution/s1.findings.json.bak', g)).toBe(false);
    expect(pathInGrants('.projectops/execution/s1.evidence.json', g)).toBe(false);
  });

  it('judges a path that was dirty before the run only by whether Codex changed it', () => {
    const touched = fakeWorld({ files: { 'docs/notes.md': 'before' }, codex: (files) => { files['docs/notes.md'] = 'after'; return ok(CLEAN); } });
    expect(adapter.start(touched.sys, scoped, briefOf(), BRIEF_PATH).kind).toBe('refused');
    const untouched = fakeWorld({ files: { 'docs/notes.md': 'before' }, codex: () => ok(CLEAN) });
    expect(adapter.start(untouched.sys, scoped, briefOf(), BRIEF_PATH).kind).toBe('completed');
  });

  it('counts a deletion, and the reverting of a path that was dirty, as a change', () => {
    const deleted = fakeWorld({ files: { 'docs/notes.md': 'before' }, codex: (files) => { delete files['docs/notes.md']; return ok(CLEAN); } });
    const out = adapter.start(deleted.sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain('docs/notes.md');
  });

  it('refuses when the candidate cannot be read before the run, and spawns nothing', () => {
    const { sys, calls } = fakeWorld({ gitFailsOnCall: 1 });
    expect(adapter.start(sys, scoped, briefOf(), BRIEF_PATH).kind).toBe('refused');
    expect(codexCalls(calls)).toHaveLength(0);
  });

  it('refuses when the candidate cannot be read after the run: a blind check is not a check', () => {
    const { sys } = fakeWorld({ gitFailsOnCall: 4 });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
  });

  it('reads git under the isolated environment with the config-driven programs switched off', () => {
    const { sys, calls } = fakeWorld({});
    adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    const gitCalls = calls.filter((c) => c.cmd === 'git');
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const c of gitCalls) {
      expect(c.options?.isolatedGit).toBeDefined();
      expect(c.args).toContain('core.fsmonitor=false');
    }
  });

  it('refuses a new git-ignored entry outside the grants (node_modules, .env, dist), which the candidate never lists', () => {
    const { sys } = fakeWorld({ ignored: ['dist/'], codex: (_f, w) => { w.ignored.push('node_modules/', '.env'); return ok(CLEAN); } });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.detail).toContain('node_modules/');
      expect(out.detail).toContain('.env');
      expect(out.detail).not.toContain('dist/');
    }
  });

  it('sees the loop\'s own gatekeeper asking records, which the candidate leaves out', () => {
    const record = '.projectops/gatekeeper-interactive/GKREQ-aaaaaaaaaaaaaaaaaaaaaaaa.decision.json';
    const { sys } = fakeWorld({ codex: (files) => { files[record] = '{"verdict":"APPROVE"}'; return ok(CLEAN); } });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain(record);
  });

  it('refuses a change to the repository configuration, which would make the next git call run the worker\'s program', () => {
    const { sys } = fakeWorld({ codex: (_f, w) => { w.config += '\0filter.x.clean=calc.exe'; return ok(CLEAN); } });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain(REPOSITORY_CONFIGURATION);
  });

  it('switches off every filter driver the configuration defines at that moment, including one the worker added', () => {
    const { sys, calls } = fakeWorld({ filters: ['lfs'], codex: (_f, w) => { w.filters.push('evil'); return ok(CLEAN); } });
    adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    const gitCalls = calls.filter((c) => c.cmd === 'git');
    const codexAt = calls.findIndex((c) => c.cmd === CODEX);
    const before = calls.slice(0, codexAt).filter((c) => c.cmd === 'git' && c.args.includes('hash-object') === false && c.args.includes('status'));
    const after = calls.slice(codexAt + 1).filter((c) => c.cmd === 'git' && c.args.includes('status'));
    expect(gitCalls.length).toBeGreaterThan(0);
    expect(before.every((c) => c.args.includes('filter.lfs.clean=') && !c.args.includes('filter.evil.clean='))).toBe(true);
    expect(after.every((c) => c.args.includes('filter.lfs.clean=') && c.args.includes('filter.evil.clean='))).toBe(true);
    expect(calls.filter((c) => c.args.includes('hash-object')).every((c) => c.args.includes('--no-filters'))).toBe(true);
  });

  it('refuses when the filter drivers cannot be listed, and spawns nothing', () => {
    const { sys, calls } = fakeWorld({});
    const broken: System = { ...sys, exec: (cmd, args, o) => (args.includes('--name-only') ? { code: 128, stdout: '', stderr: 'bad' } : sys.exec(cmd, args, o)) };
    expect(adapter.start(broken, scoped, briefOf(), BRIEF_PATH).kind).toBe('refused');
    expect(codexCalls(calls)).toHaveLength(0);
  });

  it.each([
    ['docs/.codex/config.toml'],
    ['docs/AGENTS.override.md'],
    ['docs/.agents/skill.md'],
    ['docs/.claude/settings.json'],
    ['docs/.gitattributes'],
  ])('treats %s as out of scope even beneath a directory grant', (rel) => {
    const dir = worker(['--allowedTools', 'Edit(docs),Write(docs)']);
    const { sys } = fakeWorld({ codex: (files) => { files[rel] = 'x'; files['docs/ok.md'] = 'fine'; return ok(CLEAN); } });
    const out = adapter.start(sys, dir, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') {
      expect(out.detail).toContain(rel);
      expect(out.detail).not.toContain('docs/ok.md');
    }
  });

  it('compares an ignored file by content, so an edit to an existing .env or owner control is seen', () => {
    for (const path of ['.env', '.projectops/continuity/owner-control.json']) {
      const w = fakeWorld({
        ignored: path.startsWith('.projectops/') ? [] : [path],
        codex: (_f, world) => { world.ignoredContent[path] = 'changed'; return ok(CLEAN); },
      });
      w.world.ignoredContent[path] = 'original';
      const out = adapter.start(w.sys, scoped, briefOf(), BRIEF_PATH);
      expect(out.kind).toBe('refused');
      if (out.kind === 'refused') expect(out.detail).toContain(path);
    }
  });

  it('refuses a commit, an index flag and an exclude pattern, each of which would hide a change from status', () => {
    const cases: [string, (w: World) => void][] = [
      [REPOSITORY_HEAD, (w) => { w.head = 'b'.repeat(40); }],
      [`${INDEX_FLAG_PREFIX}src/hidden.ts`, (w) => { w.indexFlags.push('S src/hidden.ts'); }],
      [REPOSITORY_EXCLUDES, (w) => { w.exclude = 'secret-*'; }],
    ];
    for (const [named, change] of cases) {
      const { sys } = fakeWorld({ codex: (_f, w) => { change(w); return ok(CLEAN); } });
      const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
      expect(out.kind).toBe('refused');
      if (out.kind === 'refused') expect(out.detail).toContain(named);
    }
  });

  it('counts the origin of a rename as a removal, even when the new path is granted', () => {
    const { sys } = fakeWorld({
      codex: (_files, w) => { w.statusExtra = 'R  src/feature.ts\0docs/plain.md\0'; w.ignoredContent['src/feature.ts'] = 'moved'; return ok(CLEAN); },
    });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain('docs/plain.md');
  });

  it('reads a path with a space or non-ASCII characters as it is, and names it', () => {
    const { sys } = fakeWorld({ codex: (files) => { files['src/my file é.ts'] = 'x'; return ok(CLEAN); } });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain('src/my file é.ts');
  });

  it('reports a scope breach even when the run also timed out, and names the paths', () => {
    const { sys } = fakeWorld({
      codex: (files) => { files['validators/x.cjs'] = 'x'; return { code: 1, stdout: '', stderr: '', failure: 'timeout' }; },
    });
    const out = adapter.start(sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).toContain('validators/x.cjs');
  });
});

describe('a run that may have been steered, failed or leaked is refused', () => {
  const run = (stream: string, over: Partial<ExecResult> = {}) => {
    const { sys } = fakeWorld({ codex: () => ok(stream, over) });
    return adapter.start(sys, worker(), briefOf(), BRIEF_PATH);
  };
  const withItem = (item: Record<string, unknown>) =>
    jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'item.completed', item }, { type: 'turn.completed' });

  it('accepts a clean run and returns a translated result, never the raw event stream, with no session to rejoin', () => {
    const out = run(CLEAN);
    expect(out).toMatchObject({ kind: 'completed', exitCode: 0, providerRef: null });
    if (out.kind === 'completed') expect(out.stdout).not.toContain('git diff');
  });

  it.each([
    ['a command that names a path outside the checkout', { id: 'c', type: 'command_execution', command: 'type C:/Users/murad/.codex/auth.json', exit_code: 0, status: 'completed' }],
    ['a command that reaches for the owner\'s Codex home', { id: 'c', type: 'command_execution', command: 'cat ~/.codex/auth.json', exit_code: 0, status: 'completed' }],
    ['a network fetch', { id: 'c', type: 'command_execution', command: 'curl http://127.0.0.1:9/x', exit_code: 0, status: 'completed' }],
    ['a declined command', { id: 'c', type: 'command_execution', command: 'git status', status: 'declined' }],
    ['a command the sandbox stopped', { id: 'c', type: 'command_execution', command: 'git status', status: 'failed', aggregated_output: 'Access to the path is denied' }],
    ['a tool call', { id: 'c', type: 'mcp_tool_call', server: 's', tool: 't' }],
    ['a web search', { id: 'c', type: 'web_search', query: 'q' }],
    ['an item of a kind it does not know', { id: 'c', type: 'something_new' }],
    ['a credential-shaped reply', { id: 'c', type: 'agent_message', text: 'token sk-' + 'a'.repeat(30) }],
  ])('refuses %s', (_name, item) => {
    expect(run(withItem(item)).kind).toBe('refused');
  });

  it('refuses a failed turn, an error item and a run that never completed a turn', () => {
    expect(run(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.failed', error: { message: 'boom' } })).kind).toBe('refused');
    expect(run(withItem({ id: 'e', type: 'error', message: 'bad' })).kind).toBe('refused');
    expect(run(jsonl({ type: 'thread.started', thread_id: 't' })).kind).toBe('refused');
  });

  it.each([
    ['reads a secret file', 'cat .env'],
    ['reads a secret file by path', 'type config/.env.production'],
    ['reads an ssh key', 'cat ./.ssh/id_rsa'],
    ['dumps the environment', 'printenv'],
    ['dumps the environment in PowerShell', 'Get-ChildItem env:'],
    ['reads the home directory from a script', 'node -e "console.log(require(\'os\').homedir())"'],
    ['reads process.env from a script', 'node -e "console.log(process.env.PATH)"'],
  ])('refuses a command that %s', (_name, command) => {
    expect(run(withItem({ id: 'c', type: 'command_execution', command, exit_code: 0, status: 'completed' })).kind).toBe('refused');
  });

  it.each([['cat .env.example'], ['git diff -- src/credentials.ts'], ['rg environment docs']])('does not refuse the ordinary command %s', (command) => {
    expect(run(withItem({ id: 'c', type: 'command_execution', command, exit_code: 0, status: 'completed' })).kind).toBe('completed');
  });

  it('withholds credential-shaped text from a failed turn, an error item and the stderr of an exit', () => {
    const key = 'sk-' + 'a'.repeat(30);
    const failed = run(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.failed', error: { message: `401 for ${key}` } }));
    expect(failed.kind).toBe('refused');
    if (failed.kind === 'refused') expect(failed.detail).not.toContain(key);
    const item = run(withItem({ id: 'e', type: 'error', message: `bad ${key}` }));
    if (item.kind === 'refused') expect(item.detail).not.toContain(key);
    const exit = run(CLEAN, { code: 2, stderr: `Authorization: Bearer ${key}` });
    expect(exit.kind).toBe('completed');
    if (exit.kind === 'completed') expect(exit.stderr).not.toContain(key);
    const gone = run('', { code: 1, failure: 'not-started', stderr: `cannot start ${key}` });
    if (gone.kind === 'refused') expect(gone.detail).not.toContain(key);
  });

  it('judges failure text whole, so a key straddling the length cut leaks no prefix', () => {
    const key = 'sk-' + 'b'.repeat(40);
    const out = run(jsonl({ type: 'thread.started', thread_id: 't' }, { type: 'turn.failed', error: { message: `${'x'.repeat(285)} ${key}` } }));
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).not.toContain('sk-b');
  });

  it('names the denial in the refusal without echoing the text that tripped it', () => {
    const out = run(withItem({ id: 'c', type: 'agent_message', text: 'token sk-' + 'a'.repeat(30) }));
    expect(out.kind).toBe('refused');
    if (out.kind === 'refused') expect(out.detail).not.toContain('sk-');
  });

  it('reports a non-zero exit as one, a timeout as a timeout and a missing executable as not started', () => {
    expect(run(CLEAN, { code: 3 })).toMatchObject({ kind: 'completed', exitCode: 3 });
    expect(run('', { code: 1, failure: 'timeout' })).toMatchObject({ kind: 'timedOut', afterMs: 600_000 });
    const gone = run('', { code: 1, failure: 'not-started', stderr: 'ENOENT' });
    expect(gone.kind).toBe('refused');
    if (gone.kind === 'refused') expect(gone.detail).toContain('could not be started');
    expect(run('', { code: 1, failure: 'output-overflow' }).kind).toBe('refused');
  });

  it('reads the events: file changes are neutral, unparseable lines contribute nothing', () => {
    const r = readImplementerEvents('not json\n' + CLEAN, { root: ROOT, instruction: 'x' });
    expect(r.turnCompleted).toBe(true);
    expect(r.denials).toEqual([]);
    expect(r.failure).toBeNull();
  });
});

describe('roles: this kind implements and never reviews; the reviewer kind never implements', () => {
  it('has no review, and rejoin refuses without spawning, even with a handle', () => {
    expect(adapter.kind).toBe(CODEX_IMPLEMENTER);
    expect(adapter.review).toBeUndefined();
    const { sys, calls } = fakeWorld({});
    const session = { sessionId: 's1', workerId: 'codex-local', kind: CODEX_IMPLEMENTER, providerRef: 'thread-1' } as unknown as WorkerSession;
    const out = adapter.rejoin(sys, worker(), session, briefOf());
    expect(out).toMatchObject({ kind: 'refused' });
    if (out.kind === 'refused') expect(out.detail).toMatch(/fresh worker/);
    expect(calls).toHaveLength(0);
  });

  it('is registered next to the reviewer kind and the Claude kind, and the registered one is the real adapter', () => {
    expect(Object.keys(BUILT_IN_ADAPTERS).sort()).toEqual([CODEX_CLI, CODEX_IMPLEMENTER, 'claude-code-cli'].sort());
    expect(BUILT_IN_ADAPTERS[CODEX_IMPLEMENTER]?.review).toBeUndefined();
    expect(BUILT_IN_ADAPTERS[CODEX_CLI]?.start({} as System, worker(), briefOf(), BRIEF_PATH)).toMatchObject({ kind: 'refused' });
  });
});

describe('PROJECTOS-WORKER-SCRATCH-CHECKOUT1A: the worker runs in a scratch checkout and only granted paths come back', () => {
  const scoped = worker(['--allowedTools', `${RECORD_GRANTS},${SCOPE_GRANT}`]);
  const FINDINGS = `${ROOT}/.projectops/execution/s1.findings.json`;
  const withScratch = (script: Partial<FakeScratchScript> = {}) => {
    const fake = fakeScratchHost({ realRoot: ROOT, ...script });
    return { fake, adapter: codexImplementerAdapterWith(INSTRUCTIONS, fake.host) };
  };
  const detailOf = (out: { kind: string; detail?: string }) => (out.kind === 'refused' ? (out.detail ?? '') : '');

  it('runs Codex in the scratch, never in the real checkout: --cd, cwd and the sentence name the scratch, and the real root is nowhere on the command line', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({});
    a.start(w.sys, scoped, briefOf(), BRIEF_PATH);
    const call = codexCalls(w.calls)[0];
    expect(call?.args[(call?.args.indexOf('--cd') ?? 0) + 1]).toBe(FAKE_SCRATCH_ROOT);
    expect(call?.options?.cwd).toBe(FAKE_SCRATCH_ROOT);
    expect(call?.args.join('\n')).not.toContain(ROOT);
    expect(call?.args.at(-1)).toContain(SCRATCH_BRIEF_PATH);
    expect(fake.events[0]).toBe('open');
  });

  it('writes a copy of the brief whose root and record paths point into the scratch, and changes nothing else in it', () => {
    const { fake, adapter: a } = withScratch();
    a.start(fakeWorld({}).sys, scoped, briefOf({ contextPath: `${ROOT}/.projectops/execution/s1.context.md` }), BRIEF_PATH);
    const written = JSON.parse(fake.texts[BRIEF_PATH] ?? '{}') as ReturnType<typeof briefOf>;
    expect(written.repository.root).toBe(FAKE_SCRATCH_ROOT);
    expect(written.records.briefPath).toBe(SCRATCH_BRIEF_PATH);
    expect(written.records.findingsPath).toBe(`${FAKE_SCRATCH_ROOT}/.projectops/execution/s1.findings.json`);
    expect(written.records.effectsPath).toBe(`${FAKE_SCRATCH_ROOT}/.projectops/execution/s1.effects.json`);
    expect(written.records.evidencePath).toBe(`${FAKE_SCRATCH_ROOT}/.projectops/execution/s1.evidence.json`);
    expect(written.records.contextPath).toBe(`${FAKE_SCRATCH_ROOT}/.projectops/execution/s1.context.md`);
    expect(written.repository.head).toBe('a'.repeat(40));
    expect(JSON.stringify(written)).not.toContain(ROOT);
  });

  it('places the evidence, findings, effects and stored-context files that exist in the real checkout, and only those', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({ evidenceExists: true, files: { '.projectops/execution/s1.findings.json': '{}', '.projectops/execution/s1.context.md': 'stored' } });
    a.start(w.sys, scoped, briefOf({ contextPath: `${ROOT}/.projectops/execution/s1.context.md` }), BRIEF_PATH);
    expect([...fake.placedFiles].sort()).toEqual([EVIDENCE_PATH, FINDINGS, `${ROOT}/.projectops/execution/s1.context.md`].sort());
  });

  it('runs in order: open, place, record the baseline, run, judge, copy back, remove', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({ codex: () => { fake.events.push('codex'); return ok(CLEAN); } });
    expect(a.start(w.sys, scoped, briefOf(), BRIEF_PATH)).toMatchObject({ kind: 'completed', exitCode: 0 });
    expect(fake.events).toEqual(['open', 'placeText', 'baseline', 'codex', 'inspect', 'copyBack', 'dispose']);
  });

  it('rule 3: a judgement that refuses the copy-back refuses the run, names the paths, copies nothing and still removes the scratch', () => {
    const inspection = { kind: 'refused', refusals: [{ path: 'src/other.ts', why: 'lies outside the write grants' }, { path: 'docs/.claude/x.json', why: 'lies under an agent control path' }] } as const;
    const { fake, adapter: a } = withScratch({ inspection });
    const out = a.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    expect(detailOf(out)).toContain('src/other.ts');
    expect(detailOf(out)).toContain('docs/.claude/x.json');
    expect(detailOf(out)).toMatch(/nothing was copied back/);
    expect(fake.events).not.toContain('copyBack');
    expect(fake.events.at(-1)).toBe('dispose');
  });

  it('a scratch that cannot be judged after the run refuses it: a blind check is not a check', () => {
    const { fake, adapter: a } = withScratch({ inspection: { kind: 'unreadable', reason: 'reading the scratch failed (EIO)' } });
    const out = a.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    expect(detailOf(out)).toContain('EIO');
    expect(fake.events).not.toContain('copyBack');
  });

  it('rule 10: a steered or failed run copies nothing back, even when its changes were all inside the grants', () => {
    const streams = [jsonl({ type: 'turn.failed', error: { message: 'boom' } }), jsonl({ type: 'item.completed', item: { id: 'c', type: 'mcp_tool_call', server: 's', tool: 't' } }, { type: 'turn.completed' })];
    for (const stream of streams) {
      const { fake, adapter: a } = withScratch();
      const out = a.start(fakeWorld({ codex: () => ok(stream) }).sys, scoped, briefOf(), BRIEF_PATH);
      expect(out.kind).toBe('refused');
      expect(fake.events).toContain('inspect');
      expect(fake.events).not.toContain('copyBack');
    }
  });

  it('copies back after a timeout too (the granted part of a cut-off run is kept for the next worker), and reports the timeout', () => {
    const { fake, adapter: a } = withScratch();
    const out = a.start(fakeWorld({ codex: () => ({ code: 1, stdout: '', stderr: '', failure: 'timeout' }) }).sys, scoped, briefOf(), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'timedOut', afterMs: 600_000 });
    expect(fake.events).toEqual(['open', 'placeText', 'baseline', 'inspect', 'copyBack', 'dispose']);
  });

  it('a run that never started judges nothing and copies nothing, and the scratch is still removed', () => {
    const { fake, adapter: a } = withScratch();
    const out = a.start(fakeWorld({ codex: () => ({ code: 1, stdout: '', stderr: 'ENOENT', failure: 'not-started' }) }).sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    expect(fake.events).toEqual(['open', 'placeText', 'baseline', 'dispose']);
  });

  it('rule 12: the scratch is removed when the spawn throws, and the error is not swallowed', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({ codex: () => { throw new Error('spawn exploded'); } });
    expect(() => a.start(w.sys, scoped, briefOf(), BRIEF_PATH)).toThrow('spawn exploded');
    expect(fake.events.at(-1)).toBe('dispose');
  });

  it('rule 12: a failed cleanup is reported with the outcome, never swallowed', () => {
    const done = withScratch({ disposeProblem: 'removing the scratch failed (EBUSY)' });
    const completed = done.adapter.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH);
    expect(completed.kind).toBe('completed');
    if (completed.kind === 'completed') expect(completed.stderr).toContain('EBUSY');
    const stuck = withScratch({ disposeProblem: 'removing the scratch failed (EBUSY)', inspection: { kind: 'refused', refusals: [{ path: 'x', why: 'lies outside the write grants' }] } });
    const refused = stuck.adapter.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH);
    expect(detailOf(refused)).toContain('EBUSY');
    expect(detailOf(refused)).toContain('x');
  });

  it('a scratch that cannot be made, placed or recorded starts no worker, and what was made is removed', () => {
    const none = withScratch({ openFails: 'the checkout is over the scratch bound' });
    const w = fakeWorld({});
    const out = none.adapter.start(w.sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    expect(detailOf(out)).toContain('over the scratch bound');
    expect(codexCalls(w.calls)).toHaveLength(0);
    for (const script of [{ placeProblem: 'placing a record failed (EACCES)' }, { baselineProblem: 'reading the scratch failed (EIO)' }]) {
      const { fake, adapter: a } = withScratch(script);
      const run = fakeWorld({});
      expect(a.start(run.sys, scoped, briefOf(), BRIEF_PATH).kind).toBe('refused');
      expect(codexCalls(run.calls)).toHaveLength(0);
      expect(fake.events.at(-1)).toBe('dispose');
    }
  });

  it('a brief whose record paths are not inside the checkout starts no worker', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({});
    const brief = briefOf();
    const outside = { ...brief, records: { ...brief.records, findingsPath: 'C:/elsewhere/s1.findings.json' } } as WorkerBrief;
    expect(a.start(w.sys, scoped, outside, BRIEF_PATH).kind).toBe('refused');
    expect(codexCalls(w.calls)).toHaveLength(0);
    expect(fake.events.at(-1)).toBe('dispose');
  });

  it('a copy-back that fails is refused, and says whether the checkout was restored', () => {
    for (const [rolledBack, words] of [[true, /restored/], [false, /may hold part of the copy/i]] as const) {
      const { adapter: a } = withScratch({ copy: { kind: 'failed', reason: 'copying src/feature.ts failed (EIO)', rolledBack } });
      const out = a.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH);
      expect(out.kind).toBe('refused');
      expect(detailOf(out)).toContain('EIO');
      expect(detailOf(out)).toMatch(words);
    }
  });

  it('keeps the real-root snapshot as the backstop: a write that reaches the real checkout is refused even when the scratch is clean', () => {
    const { fake, adapter: a } = withScratch();
    const w = fakeWorld({ codex: (files) => { files['validators/escaped.cjs'] = 'x'; return ok(CLEAN); } });
    const out = a.start(w.sys, scoped, briefOf(), BRIEF_PATH);
    expect(out.kind).toBe('refused');
    expect(detailOf(out)).toContain('validators/escaped.cjs');
    expect(fake.events).not.toContain('copyBack');
    expect(fake.events.at(-1)).toBe('dispose');
  });

  it('names at most twenty paths of a refusal, each without control characters', () => {
    const refusals = Array.from({ length: 30 }, (_v, i) => ({ path: `src/f${i}\u0007.ts`, why: 'lies outside the write grants' }));
    const { adapter: a } = withScratch({ inspection: { kind: 'refused', refusals } });
    const detail = detailOf(a.start(fakeWorld({}).sys, scoped, briefOf(), BRIEF_PATH));
    expect(detail).toContain('src/f19');
    expect(detail).not.toContain('src/f20');
    expect(detail).toContain('30 path(s)');
    expect(detail).not.toMatch(/[\u0000-\u001f]/);
  });

  it('the adapter file imports no file system and runs no git of its own (the scratch module does)', () => {
    const source = readFileSync(resolve(__dirname, '../src/loop/adapters/codexImplementer.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:(?:fs|child_process)['"]/);
    expect(source).not.toMatch(/exec\(\s*'git'/);
  });
});
