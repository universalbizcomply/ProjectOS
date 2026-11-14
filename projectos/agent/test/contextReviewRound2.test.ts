/**
 * PROJECTOS-CONTEXT-MANAGER1A, review round 2 (the ECC security-reviewer's recheck): the last bounded round. Items are numbered as the
 * consolidated list numbered them. Item 5 and item 7 (the runner) are also proved in `loopContext.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendContextLedger, type ContextLedgerFiles } from '../src/context/contextLedger.js';
import { assembleRunContext, type RunContextRequest } from '../src/context/contextManager.js';
import { contextLedgerDirectoryOf, prepareRunContext, type ContextRunSystem, type PrepareRunContextInput } from '../src/context/contextRun.js';
import { STORED_TEXT_SCREENS, storedTextSecretScreen } from '../src/context/contextScreen.js';
import { contextPointerPathOf } from '../src/loop/adapters/claudeCodeCli.js';
import { contextPathOf } from '../src/context/contextRun.js';
import { nodeEntryProbe } from '../src/search/nodeHost.js';
import { nodeSystem } from '../src/system.js';
import { ENVELOPE_NOW, MEMORY_FILE, ROOT, admittedRun, memoryFs, storeOf, storeText, worldPorts, type WorldOptions } from './support/contextWorld.js';

const SESSION = 'PHASE-abcdef012345-1a2b3c4d';
const decisionPath = (id: string): string => `.projectops/closure/decisions/${id}.json`;

const request = (over: Partial<RunContextRequest> = {}): RunContextRequest => ({
  envelope: admittedRun(),
  sessionId: SESSION,
  root: ROOT,
  query: 'booking panel',
  dependsOn: [],
  planMemoryPaths: [],
  nowIso: ENVELOPE_NOW,
  ...over,
});
const assemble = (options: WorldOptions = {}, over: Partial<RunContextRequest> = {}) => assembleRunContext(worldPorts(options).ports, request(over));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'projectos-review2-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('item 1: a file a killed run left is swept, and nothing else is', () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf8' });

  function realRepo() {
    const repo = join(dir, 'repo');
    mkdirSync(join(repo, '.projectops', 'execution'), { recursive: true });
    git(repo, 'init', '-q');
    writeFileSync(join(repo, 'a.txt'), 'a');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    const decision = '{"decision":"closed after review"}';
    const memory = memoryFs({ [`${repo}/${decisionPath('PHASE-A')}`]: decision });
    const ports = {
      ...worldPorts({ tree: { [decisionPath('PHASE-A')]: decision } }).ports,
      // The committed reads come from the memory world; every other path is looked at as git and the disk see it (an lstat).
      fs: { ...memory, stat: (path: string) => (path.includes('/.projectops/execution') ? nodeEntryProbe(path) : memory.stat(path)) },
    };
    const sys: ContextRunSystem = { ...nodeSystem, now: () => ENVELOPE_NOW };
    const prepare = (sessionId: string, state: string) => {
      const input: PrepareRunContextInput = { envelope: admittedRun(), sessionId, query: 'q', dependsOn: ['PHASE-A'], planMemoryPaths: [], ports, ledgerRoot: state };
      const prepared = prepareRunContext(sys, repo, input);
      if (prepared.kind !== 'ready') throw new Error(JSON.stringify(prepared));
      return prepared.run;
    };
    return { repo, prepare, status: () => git(repo, 'status', '--porcelain', '--untracked-files=all') };
  }

  it('removes the context file of an earlier killed session when the next run records, so the records commit has nothing foreign to refuse', () => {
    const { repo, prepare, status } = realRepo();
    const state = join(dir, 'state');
    const killed = prepare('PHASE-aaaaaaaaaaaa-4', state);
    expect(killed.record()).toEqual({ ok: true });
    expect(killed.place(1)).toEqual({ ok: true });
    // The process is killed here: nothing retires the file.
    expect(status()).toContain('PHASE-aaaaaaaaaaaa-4.context.md');
    const next = prepare('PHASE-aaaaaaaaaaaa-5', state);
    expect(next.record()).toEqual({ ok: true });
    expect(existsSync(join(repo, '.projectops', 'execution', 'PHASE-aaaaaaaaaaaa-4.context.md'))).toBe(false);
    expect(next.place(1)).toEqual({ ok: true });
    expect(next.retire()).toEqual({ ok: true });
    expect(status()).toBe('');
  });

  it('touches no other name: a directory, a note, a backup and a name that is not a session id stay', () => {
    const { repo, prepare } = realRepo();
    const execution = join(repo, '.projectops', 'execution');
    mkdirSync(join(execution, 'a-directory.context.md'));
    writeFileSync(join(execution, 'notes.md'), 'n');
    writeFileSync(join(execution, 'x.context.md.bak'), 'b');
    writeFileSync(join(execution, '.context.md'), 'hidden');
    writeFileSync(join(execution, `${'z'.repeat(65)}.context.md`), 'too long to be a session id');
    writeFileSync(join(execution, 'PHASE-old-1.brief.json'), '{}');
    writeFileSync(join(execution, 'PHASE-old-1.context.md'), 'stale');
    const run = prepare('PHASE-aaaaaaaaaaaa-5', join(dir, 'state'));
    expect(run.record()).toEqual({ ok: true });
    for (const kept of ['a-directory.context.md', 'notes.md', 'x.context.md.bak', '.context.md', `${'z'.repeat(65)}.context.md`, 'PHASE-old-1.brief.json']) {
      expect(existsSync(join(execution, kept))).toBe(true);
    }
    expect(existsSync(join(execution, 'PHASE-old-1.context.md'))).toBe(false);
  });
});

describe('item 2: the credential near-variants, and prose that is not one', () => {
  const key40 = `${'wJalrXUtnFEMI/K7MDENG'}${'/bPxRfiCYEXAMPLEKEY'}`;
  const variants: readonly [string, string][] = [
    ['an upper-case environment name', 'DB_PASSWORD=abc123xyz9'],
    ['a prefixed name', 'user_password=correcthorse9'],
    ['a camel-case name', 'dbPassword: s3cretvalue'],
    ['a client secret', 'client_secret=Zx81QpLw93Kd'],
    ['a token', 'token=ghp1Ab2Cd3Ef4Gh5'],
    ['a short pass key', 'pass: hunter2hunter2'],
    ['a lower-case bearer', 'authorization: bearer abcdefghijklmnop0123456789'],
    ['an upper-case bearer', 'AUTHORIZATION: BEARER eyJhbGciOiJIUzI1NiJ9abcdef12'],
    ['the AWS CLI JSON', `{"SecretAccessKey":"${key40}"}`],
    ['a bare 40-character secret after a secret-looking key', `secret_key: ${key40}`],
    ['a password with no digit', 'password: Correct-Horse-Battery'],
    ['a password in mixed case with no digit', 'password=CorrectHorse'],
    ['a JSON password with an escaped quote', '{"password": "pa\\"ss-word-long"}'],
    ['a YAML password on the next line', 'db:\n  password:\n    hunter2hunter2\n'],
    ['a URL whose password holds an @', 'postgres://user:p@ss@host.internal/db'],
    ['a single-quoted value', "api_key = 'abcdefgh'"],
  ];
  it.each(variants)('refuses %s', (_name, text) => {
    expect(storedTextSecretScreen(text)).toBe(true);
  });

  it.each([
    'The build uses Node 24.',
    'the password policy is strict',
    'password: required',
    'Password: Required',
    'token budget is large; max_tokens=4096',
    'a secret garden',
    'Bearer of bad news',
    'we pass the token to the next function',
    'secret: none',
    'see https://example.com:8080/docs and mailto:a@b.c',
    'password: ${DB_PASSWORD}',
    'api_key: <redacted>',
  ])('passes ordinary text (%s)', (text) => {
    expect(storedTextSecretScreen(text)).toBe(false);
  });

  it('stays linear: every pattern on 262 KB of hostile text finishes well inside a tenth of a second', () => {
    const size = 262_144;
    const hostile = [
      'password'.repeat(size / 8),
      'password='.repeat(size / 9),
      `password:${' '.repeat(size)}`,
      `password="${'a'.repeat(size)}`,
      `password="${'\\'.repeat(size)}`,
      `token=${'a'.repeat(size)}`,
      `secret${'_key'.repeat(size / 4)}`,
      `SecretAccessKey${'/'.repeat(size)}`,
      `secret_access_key = ${'a'.repeat(39)} `.repeat(size / 60),
      `://${'a'.repeat(size)}`,
      `postgres://u:${'@'.repeat(size)}`,
      `postgres://${'u:'.repeat(size / 2)}`,
      `bearer ${'a'.repeat(size)}`,
      'bearer a '.repeat(size / 9),
      `${'a'.repeat(size)}`,
    ];
    const names = Object.keys(STORED_TEXT_SCREENS) as (keyof typeof STORED_TEXT_SCREENS)[];
    for (const text of hostile) {
      for (const name of names) {
        const started = performance.now();
        STORED_TEXT_SCREENS[name](text);
        expect(performance.now() - started, `${name} on ${text.slice(0, 24)}`).toBeLessThan(100);
      }
      const started = performance.now();
      storedTextSecretScreen(text);
      expect(performance.now() - started).toBeLessThan(150);
    }
  });
});

describe('item 3: a committed memory entry with no approval record is never silent', () => {
  it('names each in the withheld list by its own code, says the fix, and does not stop the run', () => {
    const entries = ['The build uses Node 24.', 'Bookings are never deleted, only cancelled.'];
    const result = assemble({ tree: { [MEMORY_FILE]: storeText(entries) }, stores: { memory: storeOf(entries.map((text) => ({ text, kind: null }))) } });
    if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.hasContent).toBe(false);
    expect(result.decisions).toEqual([]);
    expect(result.withheld.filter((item) => item.code === 'MEMORY_ENTRY_NO_PROVENANCE')).toHaveLength(2);
    expect(result.withheld.every((item) => !JSON.stringify(item).includes('Node 24'))).toBe(true);
    expect(result.advice.join(' ')).toMatch(/2 committed memory entries have no approval record[\s\S]*Fix: the owner approves/);
  });

  it('says nothing when every entry has its record', () => {
    const entries = ['The build uses Node 24.'];
    const result = assemble({ tree: { [MEMORY_FILE]: storeText(entries) }, stores: { memory: storeOf([{ text: entries[0] as string, kind: 'fact' }]) } });
    if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.advice).toEqual([]);
    expect(result.withheld).toEqual([]);
  });
});

describe('item 4: the cap counts what the kernel renders, so many short decisions degrade to placeholders', () => {
  const short = (count: number, chars: number): readonly string[] => Array.from({ length: count }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(chars - 2)}`);
  for (const [count, chars] of [[45, 40], [60, 25]] as const) {
    it(`holds ${count} decisions of ${chars} characters: some in full, the rest as named placeholders, and no refusal`, () => {
      const decisions = short(count, chars);
      const result = assemble({ tree: { [MEMORY_FILE]: storeText(decisions) }, stores: { memory: storeOf(decisions.map((text) => ({ text, kind: 'decision' as const }))) } });
      if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
      expect(result.decisions).toHaveLength(count);
      expect(result.withheld.filter((item) => item.code === 'CONTEXT_DECISIONS_OVER_CAP').length).toBeGreaterThan(0);
      expect(result.fileText).toContain('[WITHHELD: entry');
      expect(result.fileText).toContain(decisions[0] as string);
    });
  }
});

describe('item 5: a root the path derivation rewrites has no pointer, and no file is placed for it', () => {
  it('has no project-relative path for a root with a doubled slash, and one for a plain root', () => {
    expect(contextPointerPathOf(contextPathOf('C:/dev//x', 's1'), 'C:/dev//x')).toBeNull();
    expect(contextPointerPathOf(contextPathOf('C:/dev/x', 's1'), 'C:/dev/x')).toBe('.projectops/execution/s1.context.md');
  });
});

describe('item 6: a second writer fails instead of replacing the first', () => {
  const DIR = '/state/context-ledger/ledger-x';
  const HASH = `sha256:${'a'.repeat(64)}`;
  const body = (project: string) =>
    ({
      event: 'retrieved', sessionId: SESSION, tenant: 'polygonia', domain: 'develop', project, envelopeId: `ENV-${'1'.repeat(24)}`, headCommit: 'c'.repeat(40),
      at: '2026-11-14T10:00:00.000Z', attempt: null, shown: [], withheld: [], omitted: [], decisions: [], compactor: 'none', compactionId: null, estimatedTokens: 1, taintsRun: true, fileHash: HASH, refusal: null,
    }) as never;

  it('with a forced interleaving, the first writer keeps its own bytes and the second takes the next number', () => {
    const files: Record<string, string> = {};
    const plain: ContextLedgerFiles = {
      listDir: (path) => Object.keys(files).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1)),
      readText: (path) => files[path] ?? null,
      createExclusive: (path, content) => (path in files ? false : ((files[path] = content), true)),
      removeFile: (path) => (delete files[path], true),
    };
    let interleaved = false;
    // Writer A is stopped after its temporary file is made; writer B runs a whole append to the same number; then A goes on.
    const a: ContextLedgerFiles = {
      ...plain,
      readText: (path) => {
        const text = plain.readText(path);
        if (!interleaved && path.endsWith('.tmp')) {
          interleaved = true;
          expect(appendContextLedger(plain, DIR, body('writer-b'))).toMatchObject({ ok: true, entry: { seq: 1 } });
        }
        return text;
      },
    };
    const resultA = appendContextLedger(a, DIR, body('writer-a'));
    expect(resultA).toMatchObject({ ok: true, entry: { seq: 2 } });
    expect(JSON.parse(files[`${DIR}/000001.json`] as string)).toMatchObject({ project: 'writer-b', seq: 1 });
    expect(JSON.parse(files[`${DIR}/000002.json`] as string)).toMatchObject({ project: 'writer-a', seq: 2 });
    expect(Object.keys(files).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('never replaces a number that exists: a create that is refused is a lost race, not a swap', () => {
    const files: Record<string, string> = {};
    const port: ContextLedgerFiles = {
      listDir: (path) => Object.keys(files).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1)),
      readText: (path) => files[path] ?? null,
      createExclusive: (path, content) => (path in files || !path.endsWith('.tmp') ? false : ((files[path] = content), true)),
      removeFile: (path) => (delete files[path], true),
    };
    expect(appendContextLedger(port, DIR, body('a'))).toEqual({ ok: false, code: 'CONTEXT_LEDGER_WRITE_FAILED' });
    expect(Object.keys(files)).toEqual([]);
  });

  it('sweeps a temporary name left by a writer that died, once its number has an entry', () => {
    const files: Record<string, string> = { [`${DIR}/000001.json.0123456789ab.tmp`]: 'half' };
    const port: ContextLedgerFiles = {
      listDir: (path) => Object.keys(files).filter((p) => p.startsWith(`${path}/`)).map((p) => p.slice(path.length + 1)),
      readText: (path) => files[path] ?? null,
      createExclusive: (path, content) => (path in files ? false : ((files[path] = content), true)),
      removeFile: (path) => (delete files[path], true),
    };
    expect(appendContextLedger(port, DIR, body('a'))).toMatchObject({ ok: true });
    expect(appendContextLedger(port, DIR, body('a'))).toMatchObject({ ok: true });
    expect(Object.keys(files).sort()).toEqual([`${DIR}/000001.json`, `${DIR}/000002.json`]);
  });
});

describe('item 8: each cause has its own fix', () => {
  const run = (checkout: NonNullable<WorldOptions['checkout']>) => assemble({ checkout });
  const message = (result: ReturnType<typeof assemble>): string => (result as { message: string }).message;

  it('says something different when the project names no id, the registry cannot be read, the checkout is not registered, and the envelope is for another project', () => {
    const texts = [
      message(run(() => ({ cause: 'no-project-config' }))),
      message(run(() => ({ cause: 'registry-unreadable', code: 'TENANT_REGISTRY_INVALID' }))),
      message(run(() => ({ cause: 'not-registered', code: 'TENANT_UNKNOWN' }))),
      message(run(() => ({ tenant: 'someone-else', project: 'another-project' }))),
      message(run(() => null)),
    ];
    expect(new Set(texts).size).toBe(5);
    expect(texts[0]).toContain('project-config.json');
    expect(texts[1]).toMatch(/install[\s\S]*tenant-registry\.json/);
    expect(texts[2]).toMatch(/registered root|linked worktree/);
    expect(texts[3]).toContain('someone-else/another-project');
    for (const text of texts) expect(text).toMatch(/Fix: the owner/);
  });

  it('says shorten and recommit, not compare with HEAD, when a committed decision is too large to read', () => {
    const world = worldPorts({ tree: { [decisionPath('PHASE-A')]: '{"d":1}' } });
    const tooLarge = { ...world.ports, git: (args: readonly string[]) => (args[0] === 'cat-file' && args[1] === '-s' ? { code: 0, stdout: '999999999\n' } : world.ports.git(args)) };
    const result = assembleRunContext(tooLarge, request({ dependsOn: ['PHASE-A'] }));
    expect(result).toMatchObject({ kind: 'refused', code: 'CONTEXT_MANAGER_DECISION_UNREADABLE' });
    expect((result as { message: string }).message).toMatch(/COMMITTED_TOO_LARGE[\s\S]*shortens it[\s\S]*commits the shorter file/);
    expect((result as { message: string }).message).not.toMatch(/compares that file with HEAD/);
  });
});

describe('item 9: the omitted decisions are said to be authoritative, and a relative state root is refused', () => {
  it('tells the worker a committed decision named under "Items left out" is read from its path before acting', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `PHASE-${String(index).padStart(2, '0')}`);
    const tree = Object.fromEntries(ids.map((id) => [decisionPath(id), `{"note":"${`BODY-${id} closed after review. `.repeat(170)}"}`]));
    const result = assemble({ tree }, { dependsOn: ids });
    if (result.kind !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.compactor).toBe('deterministic-selection');
    expect(result.fileText).toMatch(/## Items left out for room\n\nA committed decision named below was left out[\s\S]*authoritative[\s\S]*read each one from its listed path before you act/);
  });

  it('refuses a ledger root that is not absolute, and does not create a directory under the working directory', () => {
    expect(() => contextLedgerDirectoryOf('state/relative', 'agency-one', 'alpha')).toThrow(/absolute/);
    const sys: ContextRunSystem = { ...nodeSystem, now: () => ENVELOPE_NOW };
    for (const ledgerRoot of ['relative/state', '', '.', null]) {
      const prepared = prepareRunContext(sys, join(dir, 'repo'), { envelope: admittedRun(), sessionId: SESSION, query: 'q', dependsOn: [], planMemoryPaths: [], ports: worldPorts().ports, ledgerRoot });
      expect(prepared).toMatchObject({ kind: 'refused' });
      expect((prepared as { lines: readonly string[] }).lines.join('\n')).toMatch(/CONTEXT_NOT_RECORDED/);
    }
    expect(existsSync(join(process.cwd(), 'relative'))).toBe(false);
  });
});
