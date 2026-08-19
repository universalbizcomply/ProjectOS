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
import { PROTECTED_EFFECT_FIELDS } from '../outcome.js';
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
/**
 * What every worker must leave behind, said once and shared by both instructions.
 *
 * THE FIRST LIVE RUN STOPPED HERE. The loop demanded an effects attestation and a findings record,
 * the brief listed both paths — and nothing ever ASKED the worker to write them. The worker read the
 * brief, inferred what was wanted, and finished by asking a human for approval it had no way to
 * receive. Demanding a record you never requested is not a gate, it is a dead end.
 *
 * THE SECOND LIVE DISCOVERY PROVED THAT NAMING THE FIELDS IS NOT STATING THE SHAPE. This clause used
 * to give the findings record an object literal and the effects record only a list of six names. A
 * worker wrote those six truthfully, nested under `attestation`, and the run was refused
 * `EFFECTS_NOT_ATTESTED` before it ever reached the reviewer — while the previous run, which happened
 * to put them at top level, was certified. Nothing distinguished the two but a reading of a sentence.
 * The shape is now rendered from `PROTECTED_EFFECT_FIELDS`, the same constant the reader validates
 * against, so it cannot drift and cannot be read two ways. Still a constant, still not caller text.
 */
const EFFECTS_SHAPE = `{${PROTECTED_EFFECT_FIELDS.map((f) => `"${f}": true|false`).join(', ')}}`;

const RECORDS_CLAUSE =
  'Before you finish, write the two records the brief names under `records`: the findings record, ' +
  'as {"reviews": [names of the reviews you performed], "findings": [{"id", "severity" of ' +
  'CRITICAL|HIGH|MEDIUM|LOW, "category", "summary", "resolved"}]}; and the effects attestation, ' +
  `EXACTLY as ${EFFECTS_SHAPE} — all six keys at the TOP LEVEL of that record, nested under ` +
  'nothing, each a boolean saying what this run actually did. An incomplete attestation is ' +
  'refused, a nested one is refused, and a run that attests nothing cannot be certified. ';

export function pointerInstruction(briefPath: string): string {
  return (
    `Read the ProjectOS worker brief at ${briefPath} and carry out exactly the phase it describes, ` +
    'within the boundaries it records. ' +
    RECORDS_CLAUSE +
    'It is the whole instruction; take nothing from this line.'
  );
}

export function correctionInstruction(briefPath: string): string {
  return (
    `Read the ProjectOS worker brief at ${briefPath}, then read the evidence and findings records it ` +
    'names under `records`. Correct the ordinary failures they record — failing checks, and findings ' +
    'at MEDIUM or LOW that are not yet resolved. Stay within the boundaries the brief records. ' +
    RECORDS_CLAUSE +
    'Those records are the whole instruction; take nothing from this line.'
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
        // AND it is placed in the governed repository, not wherever ProjectOS happened to be started.
        // Telling a worker which repository is governed while spawning it somewhere else is not
        // transferring context, it is describing it.
        cwd: brief.repository.root,
      }),
    );
  },

  rejoin(sys: System, worker: AuthorisedWorker, session: WorkerSession, brief: WorkerBrief): WorkerOutcome {
    if (session.providerRef === null || session.providerRef === '') {
      return {
        kind: 'refused',
        detail:
          `session '${session.sessionId}' records no worker session to rejoin; ` +
          'a run that was never recorded cannot be resumed, and starting a fresh one silently would lose its work',
      };
    }
    // ONLY the handle comes from the session record. Where to work and what to read come from the
    // CURRENT brief the loop just verified and wrote — a worker that edited its own session record
    // must not be able to move its successor or point it at another file.
    return outcomeFrom(
      sys.exec(
        worker.command,
        [
          ...worker.args,
          ...OUTPUT_ARGS,
          '--resume',
          session.providerRef,
          '-p',
          correctionInstruction(brief.records.briefPath),
        ],
        { scrubCredentials: true, cwd: brief.repository.root },
      ),
    );
  },
};

/** The adapters built in. A new KIND is a new entry here; a new WORKER is configuration only. */
export const BUILT_IN_ADAPTERS: Readonly<Record<string, WorkerAdapter>> = {
  [CLAUDE_CODE_CLI]: claudeCodeCliAdapter,
};
