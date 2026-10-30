/**
 * The Codex CLI reviewer adapter. PROJECTOS-KERNEL-FOLLOWUP1A.
 *
 * Fakes only: every spawn is recorded by a fake System and answered with a scripted `codex exec --json`
 * event stream. Codex is never run, never logged into, and no network is touched.
 *
 * What is proven: the exact command line (read-only sandbox, candidate checkout, no credential); that
 * nothing can widen the sandbox; that the adapter never implements; and that its output is read by the
 * loop's ONE shared reviewer parser exactly as the Claude reviewer's is.
 */
import { describe, it, expect } from 'vitest';
import {
  CODEX_CLI,
  CODEX_NOT_AN_IMPLEMENTER,
  CODEX_REPLY_WITHHELD,
  codexArgProblems,
  codexCliAdapter,
  codexReviewArgv,
  commandLeavesCheckout,
  credentialShaped,
  innerCommand,
  readCodexEvents,
  sandboxProblem,
} from '../src/loop/adapters/codexCli.js';
import { BUILT_IN_ADAPTERS } from '../src/loop/adapters/claudeCodeCli.js';
import { parseReviewerVerdict, reviewerText, verdictMarker } from '../src/loop/reviewRoles.js';
import type { AuthorisedWorker, WorkerSession } from '../src/loop/workers.js';
import type { WorkerBrief } from '../src/loop/brief.js';
import type { ExecOptions, ExecResult, System } from '../src/system.js';

const ROOT = 'C:/dev/candidate';
const CODEX = 'C:/tools/codex/codex.exe';
const NONCE = 'cd'.repeat(16);
const INSTRUCTION = `You are the independent REVIEWER. End with ${verdictMarker(NONCE)}{...}`;

const worker = (args: string[] = [], over: Partial<AuthorisedWorker> = {}): AuthorisedWorker => ({
  workerId: 'codex-reviewer',
  kind: CODEX_CLI,
  command: CODEX,
  args,
  timeoutMs: 600_000,
  ...over,
});

/** Only `repository` is read by the adapter. */
const BRIEF = { repository: { root: ROOT, head: 'a'.repeat(40) } } as unknown as WorkerBrief;

/** A fake System that records every spawn and answers with one scripted result. */
function fakeSystem(reply: ExecResult) {
  const calls: { cmd: string; args: readonly string[]; options: ExecOptions | undefined }[] = [];
  const sys: System = {
    cwd: () => ROOT,
    now: () => '2026-10-29T12:00:00Z',
    readText: () => null,
    writeText: () => undefined,
    exists: () => false,
    listDir: () => [],
    renameFile: () => true,
    createExclusive: () => true,
    removeFile: () => true,
    exec: (cmd, args, options) => {
      calls.push({ cmd, args, options });
      return reply;
    },
  };
  return { sys, calls };
}

const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

const VERDICT_LINE = `${verdictMarker(NONCE)}{"verdict": "APPROVE", "reviews": ["code-review"], "findings": []}`;

/** A clean run: thread, two reads, the reply, a completed turn. */
const CLEAN_STREAM = jsonl(
  { type: 'thread.started', thread_id: 'thread-1' },
  { type: 'turn.started' },
  { type: 'item.started', item: { id: 'item_0', type: 'command_execution', command: 'git diff', status: 'in_progress' } },
  { type: 'item.completed', item: { id: 'item_0', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_1', type: 'reasoning', text: 'looking' } },
  { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'cat a.ts', exit_code: 0, status: 'completed' } },
  { type: 'item.completed', item: { id: 'item_3', type: 'agent_message', text: `Reviewed.\n${VERDICT_LINE}` } },
  { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
);

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });

describe('the Codex reviewer command line', () => {
  it('runs codex exec in the read-only sandbox, in the candidate checkout, with the instruction as the prompt', () => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    codexCliAdapter.review?.(sys, worker(['-m', 'gpt-5-codex']), BRIEF, INSTRUCTION);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.cmd).toBe(CODEX);
    expect(call?.args).toEqual([
      'exec', '-m', 'gpt-5-codex',
      '--sandbox', 'read-only',
      '-c', 'windows.sandbox="elevated"',
      '--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--ephemeral',
      '--cd', ROOT,
      INSTRUCTION,
    ]);
    expect(call?.options?.cwd).toBe(ROOT);
  });

  it('is bounded, scrubs credential-shaped environment variables, and passes no environment of its own', () => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
    const options = calls[0]?.options;
    expect(options?.timeoutMs).toBe(600_000);
    expect(options?.maxOutputBytes).toBeGreaterThan(0);
    expect(options?.scrubCredentials).toBe(true);
    // `ExecOptions` has no environment field, so "no env key" could never fail. What can: the spawn options
    // are EXACTLY these five, so nothing else, however typed or cast, rides along with the spawn.
    expect(Object.keys(options ?? {}).sort()).toEqual(['cwd', 'ensureSystemPath', 'maxOutputBytes', 'scrubCredentials', 'timeoutMs']);
    for (const a of calls[0]?.args.slice(0, -1) ?? []) expect(a).not.toMatch(/key|token|secret|password|auth/i);
  });

  it('refuses a worker that declares no attempt bound, before spawning', () => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    const r = codexCliAdapter.review?.(sys, worker([], { timeoutMs: 0 }), BRIEF, INSTRUCTION);
    expect(r?.kind).toBe('refused');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [['--dangerously-bypass-approvals-and-sandbox'], 'skips every approval and the sandbox'],
    [['--sandbox', 'workspace-write'], 'only this adapter may do'],
    [['-s', 'danger-full-access'], 'only this adapter may do'],
    [['--sandbox=workspace-write'], 'only this adapter may do'],
    [['--full-auto'], 'writable sandbox'],
    [['--approve-for-me'], 'workspace-write sandbox'],
    [['--add-dir', 'C:/elsewhere'], 'another directory writable'],
    [['-c', 'sandbox_mode="workspace-write"'], 'overrides configuration'],
    [['--profile', 'wide'], 'loads a profile'],
    [['--enable', 'web_search'], 'feature'],
    [['--worktree'], 'worktree'],
    [['--some-new-flag'], 'not an argument a Codex reviewer may be configured with'],
  ])('refuses configured args %j that could widen the sandbox, and spawns nothing', (args, why) => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    const r = codexCliAdapter.review?.(sys, worker(args), BRIEF, INSTRUCTION);
    expect(r?.kind).toBe('refused');
    if (r?.kind === 'refused') expect(r.detail).toContain(why);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [['--api-key', 'sk-x']], [['-m', 'model', 'OPENAI_API_KEY=sk-x']], [['--token=abc']], [['--auth', 'x']],
    // LOW 5: the VALUE of a permitted valued flag is tested too, in both spellings.
    [['-m', 'my-token']], [['--model', 'secret-model']], [['--model=my-token']], [['--local-provider', 'bearer-x']],
  ])(
    'refuses a credential-shaped argument %j and passes nothing',
    (args) => {
      const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
      const r = codexCliAdapter.review?.(sys, worker(args), BRIEF, INSTRUCTION);
      expect(r?.kind).toBe('refused');
      if (r?.kind === 'refused') expect(r.detail).toContain('credential');
      expect(calls).toHaveLength(0);
    },
  );

  it.each([
    [['-m', 'workspace-write'], 'is a writable sandbox'],
    [['--model', 'danger-full-access'], 'removes the sandbox'],
    [['--model=workspace-write'], 'is a writable sandbox'],
    [['--local-provider', '--full-auto'], 'no value'],
  ])('refuses a sandbox token %j given as the value of a permitted flag, and spawns nothing', (args, why) => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    const r = codexCliAdapter.review?.(sys, worker(args), BRIEF, INSTRUCTION);
    expect(r?.kind).toBe('refused');
    if (r?.kind === 'refused') expect(r.detail).toContain(why);
    expect(calls).toHaveLength(0);
  });

  it('refuses a valued argument with no value, and an instruction that would read as a flag', () => {
    expect(codexArgProblems(['-m']).join(' ')).toContain('no value');
    const r = codexReviewArgv(worker(), ROOT, '--sandbox danger-full-access');
    expect(r.ok).toBe(false);
  });

  it('accepts only the model-selection allowlist', () => {
    expect(codexArgProblems(['-m', 'o3', '--model=o4', '--oss', '--local-provider', 'ollama', '--skip-git-repo-check', '--strict-config'])).toEqual([]);
  });

  it('refuses when the finished command line does not carry exactly one read-only sandbox', () => {
    expect(sandboxProblem(['exec', '--json', 'prompt'])).toContain('could not be set');
    expect(sandboxProblem(['exec', '--sandbox', 'workspace-write', 'prompt'])).toContain('could not be set');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', '-s', 'read-only', 'prompt'])).toContain('could not be set');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', '--add-dir', 'x', 'prompt'])).toContain('widens');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', '--json', 'prompt'])).toBeNull();
    // The prompt is text, not a flag: a reviewer told about workspace-write is not given it.
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', 'workspace-write'])).toBeNull();
  });

  it("admits the adapter's own Windows sandbox mode as the one configuration override, once", () => {
    const mode = ['-c', 'windows.sandbox="elevated"'];
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', ...mode, '--json', 'prompt'])).toBeNull();
    // Any other override is still a widening, and so is the mode given twice or split.
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', '-c', 'sandbox_mode="danger-full-access"', 'prompt'])).toContain('widens');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', '-c', 'windows.sandbox="unelevated"', 'prompt'])).toContain('widens');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', ...mode, ...mode, 'prompt'])).toContain('more than once');
    expect(sandboxProblem(['exec', '--sandbox', 'read-only', ...mode, '-c', 'x=1', 'prompt'])).toContain('widens');
    // It cannot be configured: a worker that lists it is refused before any spawn.
    expect(codexArgProblems(mode).join(' ')).toContain('overrides configuration');
  });
});

describe('CODEX-LIVE1A: the command inside a known shell wrapper is judged', () => {
  // The exact forms the live probe recorded on the owner's host (Codex CLI 0.165.0).
  const PS = '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command';

  it('judges the command inside a known shell wrapper, exactly as the live probe reported it', () => {
    expect(innerCommand(`${PS} 'Get-Content -LiteralPath README.md'`)).toBe('Get-Content -LiteralPath README.md');
    expect(commandLeavesCheckout(`${PS} 'Get-Content -LiteralPath README.md'`, ROOT)).toBe(false);
    expect(commandLeavesCheckout(`${PS} "Get-Content -LiteralPath 'C:/dev/candidate/src/a.ts'"`, ROOT)).toBe(false);
    // The probe's profile read: the inner command still reaches outside the checkout.
    expect(commandLeavesCheckout(`${PS} "Test-Path -LiteralPath 'C:\\Users\\murad\\.codex\\x.txt'"`, ROOT)).toBe(true);
    expect(commandLeavesCheckout(`${PS} 'Get-Content C:\\Windows\\win.ini'`, ROOT)).toBe(true);
    expect(innerCommand('"C:\\Windows\\System32\\cmd.exe" /c type a.ts')).toBe('type a.ts');
    expect(innerCommand("bash -lc 'cat a.ts'")).toBe('cat a.ts');
  });

  it('leaves an unknown wrapper, or a wrapper inside a wrapper, whole so it fails closed', () => {
    const fake = '"C:\\Tools\\powershell.exe" -Command \'Get-Content a.ts\'';
    expect(innerCommand(fake)).toBe(fake);
    expect(commandLeavesCheckout(fake, ROOT)).toBe(true);
    const nested = `${PS} '${PS} Get-Content a.ts'`;
    expect(commandLeavesCheckout(nested, ROOT)).toBe(true);
    // Flags other than one -NoProfile, or -EncodedCommand / -File at the wrapper, are not unwrapped.
    for (const odd of ['-NonInteractive -Command', '-EncodedCommand', '-File']) {
      const cmd = `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" ${odd} 'x'`;
      expect(innerCommand(cmd)).toBe(cmd);
    }
  });

  it('unwraps -NoProfile, pwsh 7 and an upper-case cmd path', () => {
    expect(innerCommand('"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -Command \'type a.ts\'')).toBe('type a.ts');
    expect(innerCommand('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command \'type a.ts\'')).toBe('type a.ts');
    expect(innerCommand('"C:\\WINDOWS\\System32\\cmd.exe" /C type a.ts')).toBe('type a.ts');
  });

  it('a PowerShell-wrapped read inside the checkout is credited as a read, as the probe ran it', () => {
    const body = envelopeOf(streamWith({ id: 'p', type: 'command_execution', command: `${PS} 'Get-Content -LiteralPath README.md'`, aggregated_output: 'probe', exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([]);
    expect(body['num_turns']).toBe(3);
  });

  it.each([
    `${PS} 'Invoke-WebRequest -UseBasicParsing http://127.0.0.1:47911/x'`,
    `${PS} 'curl.exe -s http://127.0.0.1:47911/x'`,
    `${PS} "iex ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ZWNobyBoaQ==')))"`,
    `${PS} '(New-Object Net.WebClient).DownloadString(''http://127.0.0.1/x'')'`,
    'bash -lc \'wget -q http://127.0.0.1/x\'',
  ])('a network fetch or decode-and-run command is a denial: %s', (command) => {
    const body = envelopeOf(streamWith({ id: 'n', type: 'command_execution', command, aggregated_output: '', exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: a network fetch or decode-and-run command' }]);
  });

  it('the probe wording "rejected: blocked by policy" on a failed command is a denial', () => {
    const body = envelopeOf(streamWith({ id: 'b', type: 'command_execution', command: `${PS} 'Get-Content a.ts'`, aggregated_output: 'rejected: blocked by policy', exit_code: 1, status: 'failed' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: stopped by the sandbox or an approval' }]);
  });

  it('the final gate refuses attached short and joined long override forms', () => {
    for (const bad of ['-csandbox_mode="danger-full-access"', '-sdanger-full-access', '-pwide', '--config=x=1', '--sandbox=danger-full-access', '--profile=p']) {
      expect(sandboxProblem(['exec', '--sandbox', 'read-only', bad, 'prompt'])).not.toBeNull();
    }
  });
});

describe('the Codex reviewer never implements', () => {
  const session: WorkerSession = {
    sessionId: 's', workerId: 'codex-reviewer', kind: CODEX_CLI, phaseId: 'P', briefId: 'b', briefPath: 'p',
    startedAt: '2026-10-29T12:00:00Z', providerRef: 'thread-1', state: 'started', exitCode: null, corrections: 0,
  };

  it('start refuses with a clear reason and spawns nothing', () => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    const r = codexCliAdapter.start(sys, worker(), BRIEF, 'C:/dev/candidate/.projectops/execution/s.brief.json');
    expect(r).toEqual({ kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER });
    expect(r.kind === 'refused' && r.detail).toContain('reviewer only');
    expect(calls).toHaveLength(0);
  });

  it('rejoin refuses with the same reason and spawns nothing', () => {
    const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
    expect(codexCliAdapter.rejoin(sys, worker(), session, BRIEF)).toEqual({ kind: 'refused', detail: CODEX_NOT_AN_IMPLEMENTER });
    expect(calls).toHaveLength(0);
  });

  it('is wired into the built-in adapter registry under its own kind', () => {
    expect(BUILT_IN_ADAPTERS[CODEX_CLI]).toBe(codexCliAdapter);
    expect(codexCliAdapter.kind).toBe('codex-cli');
  });
});

describe('the Codex reply is read by the shared reviewer parser', () => {
  function reviewed(stdout: string) {
    const { sys } = fakeSystem(ok(stdout));
    return codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
  }

  it('a clean run parses to the verdict, with the reads as turns and no denials', () => {
    const r = reviewed(CLEAN_STREAM);
    expect(r?.kind).toBe('completed');
    if (r?.kind !== 'completed') return;
    expect(r.exitCode).toBe(0);
    expect(r.providerRef).toBe('thread-1');
    const body = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(body['num_turns']).toBe(3);
    expect(body['permission_denials']).toEqual([]);
    const parsed = parseReviewerVerdict(reviewerText(r.stdout), NONCE);
    expect(parsed).toEqual({ ok: true, verdict: 'APPROVE', reviews: ['code-review'], findings: [] });
  });

  // The loop's refusal of fewer than two turns is driven for real, with this envelope, in loopRunner.test.ts
  // ("[CX] a Codex reviewer that read nothing ..."). Here: the adapter reports the one turn it must.
  it('a reviewer that read nothing reports one turn (the loop refuses fewer than two)', () => {
    const r = reviewed(jsonl(
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: VERDICT_LINE } },
      { type: 'turn.completed' },
    ));
    expect(r?.kind === 'completed' && (JSON.parse(r.stdout) as Record<string, unknown>)['num_turns']).toBe(1);
  });

  it('an attempted write or tool call is a denial, counted once per item', () => {
    const r = reviewed(jsonl(
      { type: 'item.completed', item: { id: 'c', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
      { type: 'item.started', item: { id: 'f', type: 'file_change', status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'f', type: 'file_change', status: 'failed' } },
      { type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call', status: 'completed' } },
      { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: VERDICT_LINE } },
      { type: 'turn.completed' },
    ));
    expect(r?.kind).toBe('completed');
    if (r?.kind !== 'completed') return;
    expect((JSON.parse(r.stdout) as Record<string, unknown>)['permission_denials']).toEqual([{ tool_name: 'file_change' }, { tool_name: 'mcp_tool_call' }]);
  });

  it('the LAST agent message is the reply, and a quoted marker earlier does not count', () => {
    const run = readCodexEvents(jsonl(
      { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'first' } },
      { type: 'item.completed', item: { id: 'b', type: 'agent_message', text: 'second' } },
    ));
    expect(run.lastMessage).toBe('second');
  });

  it('a reply with no verdict line is not a verdict', () => {
    const r = reviewed(jsonl({ type: 'item.completed', item: { id: 'a', type: 'agent_message', text: 'looks fine' } }, { type: 'turn.completed' }));
    expect(r?.kind === 'completed' && parseReviewerVerdict(reviewerText(r.stdout), NONCE).ok).toBe(false);
  });

  it('non-JSON lines contribute nothing', () => {
    const run = readCodexEvents(`warning: something\n${CLEAN_STREAM}not json\n`);
    expect(run.reads).toBe(2);
    expect(run.turnCompleted).toBe(true);
  });
});

/** One command run to completion, the given items, then the clean reply. */
function streamWith(...items: unknown[]): string {
  return jsonl(
    { type: 'thread.started', thread_id: 't' },
    { type: 'item.completed', item: { id: 'r0', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
    ...items.map((item) => ({ type: 'item.completed', item })),
    { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: `Reviewed.\n${VERDICT_LINE}` } },
    { type: 'turn.completed' },
  );
}

function envelopeOf(stdout: string): Record<string, unknown> {
  const { sys } = fakeSystem(ok(stdout));
  const r = codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
  if (r?.kind !== 'completed') throw new Error(`expected a completed review, got ${JSON.stringify(r)}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

describe('HIGH 1(b): a command that names a path outside the checkout is a denial', () => {
  it.each([
    ['an absolute drive path elsewhere', 'type C:\\Users\\owner\\notes.txt'],
    ['a forward-slash drive path elsewhere', 'cat D:/other/repo/a.ts'],
    ['a sibling that only shares a prefix', 'cat C:/dev/candidate-other/a.ts'],
    ['a Git Bash drive mount', 'cat /c/Users/owner/.ssh/id_rsa'],
    ['a WSL drive mount', 'cat /mnt/c/Users/owner/x'],
    ['a POSIX home', 'cat /home/owner/x'],
    ['the home shorthand', 'cat ~/notes.txt'],
    ['$HOME', 'cat "$HOME/notes.txt"'],
    ['${HOME}', 'cat ${HOME}/notes.txt'],
    ['%USERPROFILE%', 'type %USERPROFILE%\\notes.txt'],
    ['the PowerShell profile drive', 'Get-Content $env:USERPROFILE\\notes.txt'],
    ['a parent escape', 'cat ../secrets.txt'],
    ['a parent escape inside a path', 'cat src/../../x'],
    ['a UNC path', 'type \\\\server\\share\\x'],
    ['a forward-slash UNC path', 'cat //server/share/x'],
    ['a long-path UNC prefix', 'type \\\\?\\UNC\\server\\share\\x'],
    ['a named pipe', 'type \\\\.\\pipe\\x'],
    ['a loopback admin share', 'Get-ChildItem "\\\\localhost\\c$\\Users"'],
    ['a UNC path with a doubled separator', 'Get-Content \\\\localhost\\\\c$\\x'],
    ['a forward-slash UNC path with a doubled separator', 'cat //localhost//c$/x'],
    ['a UNC path with mixed separators', 'Get-Content \\\\localhost\\/c$\\x'],
    ['a UNC host given as a PowerShell sub-expression', 'Get-ChildItem "\\\\$(hostname)\\c$\\x"'],
    ["the owner's Codex home", 'cat auth.json --dir .codex'],
    ['the Codex login file through the checkout', 'Get-Content C:/dev/candidate/../../Users/o/.codex/auth.json'],
  ])('%s: %s', (_label, command) => {
    expect(commandLeavesCheckout(command, ROOT)).toBe(true);
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command, exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: names a path outside the repository' }]);
    // Not counted as a read either: only the clean `git diff` is.
    expect(body['num_turns']).toBe(2);
  });

  it.each([
    'git diff',
    'git diff HEAD..main',
    'git log HEAD~1',
    'cat src/a.ts',
    'cat C:/dev/candidate/src/a.ts',
    'type C:\\dev\\candidate\\src\\a.ts',
    'cat /c/dev/candidate/src/a.ts',
    'rg -n "https://example.com" src',
    'cat projectos/agent/src/loop/adapters/codexCli.ts',
  ])('a command inside the checkout is not a denial: %s', (command) => {
    expect(commandLeavesCheckout(command, ROOT)).toBe(false);
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command, exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([]);
    expect(body['num_turns']).toBe(3);
  });

  // The exit proof's first run (2026-10-30): the reviewer piped this probe script into node, and its
  // string `"\\nExpires: …` was read as the UNC path `\\nExpires:`, refusing an innocent review.
  const EXIT_PROOF_PROBE =
    "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command \"@'\nconst fs=require('fs'),vm=require('vm'),path=require('path'),cp=require('child_process');\nconst filename=path.resolve('projectos/validators/validate-site.cjs');\nconst source=fs.readFileSync(filename,'utf8');\nfunction run(src, sec){let code=0;let logs=[];const fake=Object.create(fs);fake.readFileSync=(p,...a)=>String(p).endsWith(path.join('.well-known','security.txt'))&&sec\"'!==undefined?sec:fs.readFileSync(p,...a);vm.runInNewContext(src,{require:n=>n==='\"'fs'?fake:require(n),__dirname:path.dirname(filename),process:{argv:['node',filename],exit:n=>{code=n}},console:{log:s=>logs.push(s),error:s=>logs.push(s)}});return {code,logs};}\nconsole.log('candidate current site',JSON.stringify(run(source)));\nconst base=cp.execFileSync('git',['show','122654e97de23dce4e95f638c288aaaad823161e:projectos/validators/validate-site.cjs'],{encoding:'utf8'});\nconsole.log('base current site',JSON.stringify(run(base)));\nfor(const expires of ['October 29, 2027','2027-02-30T00:00:00.000Z','not-a-date']){console.log(expires,JSON.stringify(run(source,\"'`Contact: mailto:security@example.com'\"\\\\nExpires: \"'${expires}'\"\\\\n\"'`)));}\n'\"'@ | node\"";

  it.each([
    ["the exit proof reviewer's probe, exactly as reported", EXIT_PROOF_PROBE],
    ['a quoted escaped newline', 'node -e \'console.log("\\\\nExpires: x")\''],
    ['a quoted escaped tab at the end', "node -e \"console.log('a' + '\\\\t')\""],
    ['a quoted unicode escape', 'node -e \'console.log("\\\\u0041")\''],
    ['a quoted pair of escapes', 'node -e \'console.log("\\\\n\\\\t")\''],
    // A bare host names no file: listing shares or querying a service reads nothing from one.
    ['a bare host with no share', 'net view \\\\localhost'],
  ])('does not read a quoted escape in a probe script as a UNC path: %s', (_label, command) => {
    expect(commandLeavesCheckout(command, ROOT)).toBe(false);
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command, exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([]);
  });

  it('an outside path seen when the command STARTS is a denial too, counted once per item', () => {
    const cmd = 'cat ~/.codex/auth.json';
    const body = envelopeOf(jsonl(
      { type: 'item.started', item: { id: 'x', type: 'command_execution', command: cmd, status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'x', type: 'command_execution', command: cmd, exit_code: 0, status: 'completed' } },
      { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: VERDICT_LINE } },
      { type: 'turn.completed' },
    ));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: names a path outside the repository' }]);
  });

  it('a command whose text was not reported cannot be checked, so it is a denial', () => {
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', exit_code: 0, status: 'completed' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: the command was not reported' }]);
  });

  it('with no checkout known, every absolute path is outside one', () => {
    expect(commandLeavesCheckout('cat C:/dev/candidate/a.ts', null)).toBe(true);
    const run = readCodexEvents(streamWith({ id: 'x', type: 'command_execution', command: 'cat C:/dev/candidate/a.ts', exit_code: 0, status: 'completed' }));
    expect(run.beyondReading).toEqual(['command_execution: names a path outside the repository']);
  });
});

describe('HIGH 1(c): a reply carrying credential-shaped content is withheld', () => {
  const JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.sig';

  it.each([
    ['a JWT-like run', `Found: ${JWT}`],
    ['an sk- key', 'the key is sk-proj-abcdefghijklmnop0123'],
    ['an access_token', '{"access_token": "abc"}'],
    ['a refresh_token', 'refresh_token=rt_1'],
    ['an api_key', 'OPENAI api_key: x'],
    ['a bearer value', 'the header carried Bearer abcdefgh12345'],
    ['a long mixed base64 run', `blob ${'Ab9'.repeat(15)}`],
    ['a long hex run not in the instruction', `digest ${'0123456789abcdef'.repeat(4)}`],
  ])('%s, in the reply text and in a finding summary', (_label, leak) => {
    expect(credentialShaped(leak, INSTRUCTION)).toBe(true);
    const finding = { id: 'f', severity: 'LOW', category: 'x', summary: leak };
    const replies = [
      `${leak}\n${VERDICT_LINE}`,
      `${verdictMarker(NONCE)}${JSON.stringify({ verdict: 'APPROVE', reviews: ['code-review'], findings: [finding] })}`,
    ];
    for (const text of replies) {
      const stream = jsonl(
        { type: 'thread.started', thread_id: 't' },
        { type: 'item.completed', item: { id: 'r0', type: 'command_execution', command: 'git diff', exit_code: 0, status: 'completed' } },
        { type: 'item.completed', item: { id: 'a', type: 'agent_message', text } },
        { type: 'turn.completed' },
      );
      const body = envelopeOf(stream);
      // Withheld whole: no part of the reply reaches the loop, and the withholding is a denial.
      expect(body['result']).toBe('');
      expect(JSON.stringify(body)).not.toContain(leak.slice(-10));
      expect(body['permission_denials']).toEqual([{ tool_name: CODEX_REPLY_WITHHELD }]);
    }
  });

  it('a digest the loop itself put in the instruction is not a credential, nor is a commit, a path or a hyphenated name', () => {
    const digest = `sha256:${'ab'.repeat(32)}`;
    const instruction = `${INSTRUCTION} (candidate digest ${digest})`;
    expect(credentialShaped(`I reviewed candidate ${digest} on ${'a'.repeat(40)}`, instruction)).toBe(false);
    expect(credentialShaped('see projectos/agent/src/loop/adapters/codexCli.ts and C:/dev/ProjectOS-worktrees/host-review-path1b/x', instruction)).toBe(false);
    expect(credentialShaped('closure-wait-drops-broker-response-id-and-more-hyphenated-words', instruction)).toBe(false);
    expect(credentialShaped(VERDICT_LINE, INSTRUCTION)).toBe(false);
    // The same digest NOT in the instruction is withheld: the exemption is the loop's own values only.
    expect(credentialShaped(`I reviewed candidate ${digest}`, INSTRUCTION)).toBe(true);
  });

  it.each([
    ['a Stripe-style key', `sk_live_${'Ab3'.repeat(8)}`],
    ['a GitHub token', `ghp_${'aB3'.repeat(10)}`],
    ['an AWS access key id', 'AKIAIOSFODNN7EXAMPLE'],
    ['a refresh-token prefix', `rt_${'xY9'.repeat(8)}`],
    ['a PEM key block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['a 40-character mixed-class secret', 'wJalrXUtnFEMI7K7MDENGbPxRfiCYEXAMPLEKEYx'],
  ])('withholds %s', (_label, secret) => {
    expect(credentialShaped(`The file holds ${secret} here.`, INSTRUCTION)).toBe(true);
  });

  it('a clean reply passes through untouched', () => {
    const body = envelopeOf(CLEAN_STREAM);
    expect(body['result']).toBe(`Reviewed.\n${VERDICT_LINE}`);
    expect(body['permission_denials']).toEqual([]);
  });
});

describe('MEDIUM 2: only a command that completed with exit 0 is a read', () => {
  it('a declined command is a denial, not a read', () => {
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command: 'cat a.ts', status: 'declined' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: declined' }]);
    expect(body['num_turns']).toBe(2);
  });

  it.each([
    'Permission denied',
    'Access is denied.',
    'blocked by the sandbox policy',
    'Operation not permitted',
    'rejected: command not approved',
    // The PowerShell wording on this Windows host (recheck finding): not caught before.
    "Set-Content : Access to the path 'C:\\Users\\owner\\x.txt' is denied.",
    'System.UnauthorizedAccessException: Attempted to perform an unauthorized operation.',
  ])('a failed command the sandbox or an approval stopped is a denial, not a read: %s', (output) => {
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command: 'touch a.ts', aggregated_output: output, exit_code: 1, status: 'failed' }));
    expect(body['permission_denials']).toEqual([{ tool_name: 'command_execution: stopped by the sandbox or an approval' }]);
    expect(body['num_turns']).toBe(2);
  });

  it('a failed command that merely failed (grep with no match) is neither a read nor a denial', () => {
    const body = envelopeOf(streamWith({ id: 'x', type: 'command_execution', command: 'grep nothing a.ts', aggregated_output: '', exit_code: 1, status: 'failed' }));
    expect(body['permission_denials']).toEqual([]);
    expect(body['num_turns']).toBe(2);
  });

  it('a completed command with a non-zero or missing exit code is not a read', () => {
    const body = envelopeOf(streamWith(
      { id: 'x', type: 'command_execution', command: 'cat a.ts', exit_code: 2, status: 'completed' },
      { id: 'y', type: 'command_execution', command: 'cat b.ts', status: 'completed' },
    ));
    expect(body['num_turns']).toBe(2);
  });

  it('an error ITEM is a failure (the conservative choice), so the review is refused before any reply is read', () => {
    const { sys } = fakeSystem(ok(streamWith({ id: 'e', type: 'error', message: 'command timed out' })));
    const r = codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
    expect(r).toEqual({ kind: 'refused', detail: "the Codex reviewer's turn failed: command timed out" });
    expect(readCodexEvents(streamWith({ id: 'e', type: 'error' })).failure).toBe('the run reported an error item');
  });
});

describe('what happened to a Codex review', () => {
  it('a failed turn is refused, not read', () => {
    const { sys } = fakeSystem(ok(jsonl({ type: 'turn.failed', error: { message: 'not logged in' } })));
    const r = codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
    expect(r).toEqual({ kind: 'refused', detail: "the Codex reviewer's turn failed: not logged in" });
  });

  it('an exit 0 with no completed turn is refused', () => {
    const { sys } = fakeSystem(ok(jsonl({ type: 'thread.started', thread_id: 't' })));
    const r = codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
    expect(r?.kind === 'refused' && r.detail).toContain('without reporting a completed turn');
  });

  it('a non-zero exit is reported as that exit, with nothing read from its output', () => {
    const { sys } = fakeSystem({ code: 1, stdout: CLEAN_STREAM, stderr: 'boom' });
    const r = codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION);
    expect(r).toEqual({ kind: 'completed', exitCode: 1, stdout: CLEAN_STREAM, stderr: 'boom', providerRef: null });
  });

  it('a timeout is its own outcome', () => {
    const { sys } = fakeSystem({ code: 1, stdout: 'partial', stderr: '', failure: 'timeout' });
    expect(codexCliAdapter.review?.(sys, worker(), BRIEF, INSTRUCTION)).toEqual({ kind: 'timedOut', afterMs: 600_000, stdout: 'partial', stderr: '' });
  });

  it('an executable that never started, or output past the bound, is refused', () => {
    const notStarted = fakeSystem({ code: 1, stdout: '', stderr: 'ENOENT', failure: 'not-started' });
    const a = codexCliAdapter.review?.(notStarted.sys, worker(), BRIEF, INSTRUCTION);
    expect(a?.kind === 'refused' && a.detail).toContain('could not be started');
    const overflow = fakeSystem({ code: 1, stdout: '', stderr: '', failure: 'output-overflow' });
    const b = codexCliAdapter.review?.(overflow.sys, worker(), BRIEF, INSTRUCTION);
    expect(b?.kind === 'refused' && b.detail).toContain('more output than the runtime will hold');
  });
});
