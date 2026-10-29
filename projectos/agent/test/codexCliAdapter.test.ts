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
  codexArgProblems,
  codexCliAdapter,
  codexReviewArgv,
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
    expect(Object.keys(options ?? {})).not.toContain('env');
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

  it.each([[['--api-key', 'sk-x']], [['-m', 'model', 'OPENAI_API_KEY=sk-x']], [['--token=abc']], [['--auth', 'x']]])(
    'refuses a credential-shaped argument %j and passes nothing',
    (args) => {
      const { sys, calls } = fakeSystem(ok(CLEAN_STREAM));
      const r = codexCliAdapter.review?.(sys, worker(args), BRIEF, INSTRUCTION);
      expect(r?.kind).toBe('refused');
      if (r?.kind === 'refused') expect(r.detail).toContain('credential');
      expect(calls).toHaveLength(0);
    },
  );

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

  it('a reviewer that read nothing reports one turn, which the loop refuses as no review', () => {
    const r = reviewed(jsonl(
      { type: 'thread.started', thread_id: 't' },
      { type: 'item.completed', item: { id: 'i', type: 'agent_message', text: VERDICT_LINE } },
      { type: 'turn.completed' },
    ));
    expect(r?.kind === 'completed' && (JSON.parse(r.stdout) as Record<string, unknown>)['num_turns']).toBe(1);
  });

  it('an attempted write or tool call is a denial, counted once per item', () => {
    const r = reviewed(jsonl(
      { type: 'item.completed', item: { id: 'c', type: 'command_execution', status: 'completed' } },
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
