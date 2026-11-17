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
import { describe, it, expect } from 'vitest';
import {
  CODEX_IMPLEMENTER,
  codexImplementerAdapterWith,
  codexImplementerArgProblems,
  codexImplementerArgv,
  implementerSandboxProblem,
  readImplementerEvents,
} from '../src/loop/adapters/codexImplementer.js';
import { pathInGrants } from '../src/loop/writeScope.js';
import { BUILT_IN_ADAPTERS, correctionInstruction, pointerInstruction } from '../src/loop/adapters/claudeCodeCli.js';
import { CODEX_CLI } from '../src/loop/adapters/codexCli.js';
import { roleBindingProblems } from '../src/loop/reviewRoles.js';
import type { AuthorisedWorker, WorkerSession } from '../src/loop/workers.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { ExecOptions, ExecResult, System } from '../src/system.js';

const ROOT = 'C:/dev/candidate';
const CODEX = 'C:/tools/codex/codex.exe';
const BRIEF_PATH = `${ROOT}/.projectops/execution/s1.brief.json`;
const EVIDENCE_PATH = `${ROOT}/.projectops/execution/s1.evidence.json`;
const RECORD_GRANTS = 'Write(.projectops/execution/*.findings.json),Edit(.projectops/execution/*.findings.json),Write(.projectops/execution/*.effects.json),Edit(.projectops/execution/*.effects.json)';
const SCOPE_GRANT = 'Edit(src/feature.ts),Write(src/feature.ts)';

const adapter = codexImplementerAdapterWith({ pointerInstruction, correctionInstruction });

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
function fakeWorld(opts: {
  files?: Record<string, string>;
  codex?: (files: Record<string, string>) => ExecResult;
  gitFailsOnCall?: number;
  evidenceExists?: boolean;
}) {
  const files: Record<string, string> = { ...(opts.files ?? {}) };
  const calls: Call[] = [];
  let gitCalls = 0;
  const sys: System = {
    cwd: () => ROOT,
    now: () => '2026-11-17T12:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: (p) => (p === EVIDENCE_PATH ? opts.evidenceExists === true : Object.keys(files).some((f) => `${ROOT}/${f}` === p)),
    listDir: () => [],
    renameFile: () => true,
    createExclusive: () => true,
    removeFile: () => true,
    exec: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      if (cmd === CODEX) return (opts.codex ?? (() => ok(CLEAN)))(files);
      // git, as the candidate computation asks it
      const verb = args.find((a) => a === 'status' || a === 'hash-object' || a === 'ls-files');
      if (verb === 'status') {
        gitCalls += 1;
        if (opts.gitFailsOnCall === gitCalls) return { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
        return ok(Object.keys(files).sort().map((f) => ` M ${f}`).join('\n') + '\n');
      }
      if (verb === 'hash-object') {
        const paths = args.slice(args.indexOf('--') + 1);
        return ok(paths.map((p) => `blob:${files[p] ?? ''}`).join('\n') + '\n');
      }
      return ok('');
    },
  };
  return { sys, calls, files };
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
      '--cd', ROOT,
      pointerInstruction(BRIEF_PATH),
    ]);
    expect(call?.options?.cwd).toBe(ROOT);
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
    expect(codexCalls(first.calls)[0]?.args.at(-1)).toBe(pointerInstruction(BRIEF_PATH));
    const again = fakeWorld({ evidenceExists: true });
    adapter.start(again.sys, worker(), briefOf(), BRIEF_PATH);
    expect(codexCalls(again.calls)[0]?.args.at(-1)).toBe(correctionInstruction(BRIEF_PATH));
  });

  it('refuses a worker with no attempt bound before anything is spawned', () => {
    const { sys, calls } = fakeWorld({});
    const out = adapter.start(sys, worker(undefined, { timeoutMs: 0 }), briefOf(), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'refused' });
    expect(calls).toHaveLength(0);
  });

  it('refuses a brief that is not bound to a commit, and a brief that names stored context the worker is not told of', () => {
    const noHead = fakeWorld({});
    expect(adapter.start(noHead.sys, worker(), briefOf({ head: null }), BRIEF_PATH)).toMatchObject({ kind: 'refused' });
    const withContext = fakeWorld({});
    const out = adapter.start(withContext.sys, worker(), briefOf({ contextPath: `${ROOT}/.projectops/execution/s1.context.md` }), BRIEF_PATH);
    expect(out).toMatchObject({ kind: 'refused' });
    expect(withContext.calls).toHaveLength(0);
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
    const { sys } = fakeWorld({ gitFailsOnCall: 2 });
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
