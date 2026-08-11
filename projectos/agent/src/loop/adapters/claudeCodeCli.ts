/**
 * The Claude Code CLI adapter — the one worker kind ProjectOS ships.
 *
 * WHAT CROSSES THE ARGV. A path and a fixed sentence that says "read the governed brief at this
 * path". Nothing else. The phase contract — description, acceptance criteria, required validators,
 * reviews, owner gates, boundaries — is in the brief FILE, written by ProjectOS from the approved
 * plan. That is the difference between this and the giant manual prompt relay it replaces: the
 * instruction is durable, governed and reviewable rather than assembled by whoever called the loop.
 *
 * THE POINTER SENTENCE IS A CONSTANT IN THIS FILE, and is stated plainly rather than described as
 * "no instruction at all", which would be untrue. It is not caller-supplied, it cannot vary per run,
 * and it names no task. `briefProvenanceProblems` guards the part that could vary — the brief.
 *
 * NOT THE ANTHROPIC API. This adapter starts a local CLI the owner already runs; it handles no
 * credential and constructs no API call. `use-anthropic-api` is a forbidden action for this project
 * and the worker seam refuses credential-shaped arguments before any of them could reach here.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { System } from '../../system.js';
import type { WorkerBrief } from '../brief.js';
import type { AuthorisedWorker, WorkerAdapter, WorkerOutcome, WorkerSession } from '../workers.js';

export const CLAUDE_CODE_CLI = 'claude-code-cli';

/**
 * The only two sentences this adapter puts on the command line. Both point at durable state and
 * neither says anything about what the work is.
 *
 * `pointerInstruction` starts a phase. `correctionInstruction` resumes one — and a resume needs to
 * say WHY, because a worker handed the same brief twice has no way to know the loop is asking it to
 * fix something rather than to start again. What is wrong is not in this sentence: it is in the
 * evidence and findings records, whose paths are already in the brief the worker is being pointed
 * at. The sentence is a constant in this file, the failures are ProjectOS-generated records, and
 * there is no channel between them for human prose.
 */
export function pointerInstruction(briefPath: string): string {
  return (
    `Read the ProjectOS worker brief at ${briefPath} and carry out exactly the phase it describes, ` +
    'within the boundaries it records. It is the whole instruction; take nothing from this line.'
  );
}

export function correctionInstruction(briefPath: string): string {
  return (
    `Read the ProjectOS worker brief at ${briefPath}, then read the evidence and findings records it ` +
    'names under `records`. Correct the ordinary failures they record — failing checks, and findings ' +
    'at MEDIUM or LOW that are not yet resolved — and update those records to state what you did. ' +
    'Stay within the boundaries the brief records. Those records are the whole instruction; take ' +
    'nothing from this line.'
  );
}

/**
 * The CLI's own session id, read from its structured output.
 *
 * This is what makes REJOIN a real capability rather than a word: without a handle the worker itself
 * reported, "reconnect" could only mean "start another one and hope". Unparseable output yields null,
 * and null is recorded and refused later — never quietly upgraded into a fresh start.
 */
export function parseProviderRef(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout.trim()) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const id = (parsed as Record<string, unknown>)['session_id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function outcomeFrom(r: { code: number; stdout: string; stderr: string }): WorkerOutcome {
  return {
    kind: 'completed',
    exitCode: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    providerRef: parseProviderRef(r.stdout),
  };
}

/** Structured output is requested so the run reports a handle that a rejoin can name. */
const OUTPUT_ARGS: readonly string[] = ['--output-format', 'json'];

export const claudeCodeCliAdapter: WorkerAdapter = {
  kind: CLAUDE_CODE_CLI,

  start(sys: System, worker: AuthorisedWorker, brief: WorkerBrief, briefPath: string): WorkerOutcome {
    if (brief.repository.head === null) {
      // Unreachable through `buildWorkerBrief`, which refuses first. Present so a future caller that
      // hand-built a brief cannot start a worker unbound from a commit.
      return { kind: 'refused', detail: 'the brief is not bound to a commit, so no worker may be started from it' };
    }
    return outcomeFrom(
      sys.exec(worker.command, [...worker.args, ...OUTPUT_ARGS, '-p', pointerInstruction(briefPath)], {
        // The worker inherits no credential-shaped variable: the project forbids `use-anthropic-api`,
        // and an inherited key would make that forbidding decorative.
        scrubCredentials: true,
      }),
    );
  },

  rejoin(sys: System, worker: AuthorisedWorker, session: WorkerSession): WorkerOutcome {
    if (session.providerRef === null || session.providerRef === '') {
      return {
        kind: 'refused',
        detail:
          `session '${session.sessionId}' records no worker session to rejoin; ` +
          'a run that was never recorded cannot be resumed, and starting a fresh one silently would lose its work',
      };
    }
    return outcomeFrom(
      sys.exec(
        worker.command,
        [...worker.args, ...OUTPUT_ARGS, '--resume', session.providerRef, '-p', correctionInstruction(session.briefPath)],
        { scrubCredentials: true },
      ),
    );
  },
};

/** The adapters built in. A new KIND is a new entry here; a new WORKER is configuration only. */
export const BUILT_IN_ADAPTERS: Readonly<Record<string, WorkerAdapter>> = {
  [CLAUDE_CODE_CLI]: claudeCodeCliAdapter,
};
