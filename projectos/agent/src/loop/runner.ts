/**
 * The loop itself: authorise, brief, run, verify, correct, and stop for a decision.
 *
 * IT IS A SEQUENCE OF REFUSALS WITH SOME WORK IN THE MIDDLE. Nine things are established before a
 * worker is started, and each of them can end the run: a governed project, a checkout that matches
 * it, a phase the plan authorises, a brief that invented nothing, an authorised worker with an
 * absolute executable. Only then is anything spawned. The ordering is the safety argument — every
 * check that runs after a spawn is a check that runs too late.
 *
 * THE CORRECTION LOOP IS THE ONLY PLACE IT REPEATS. A failing check sends the phase back to the
 * worker, bounded by `MAX_CORRECTION_ATTEMPTS`, and the decision to repeat is `decideContinuation`'s
 * alone. This module never decides that something is ordinary.
 *
 * TWO BOUNDARIES, STATED RATHER THAN IMPLIED.
 *  - It does not create the durable phase record. Phase creation is `projectos phase new`, which has
 *    its own authorisation gate; duplicating it here would be a second way to admit a phase. So until
 *    a record exists the loop reports "starting" each time, which is true.
 *  - The correction bound is per invocation. Re-running after a human has read the failure starts a
 *    fresh budget, deliberately: the human choosing to try again IS the gate, and a permanently
 *    exhausted session would be a phase nobody could retry.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { System } from '../system.js';
import { loadGovernedContext, refusalLines, type GovernedContext } from '../governedContext.js';
import { verifyExecutionContext } from './observation.js';
import { computeCandidateIdentity } from './candidateIdentity.js';
import { consumeAnsweredOwnerGates, ownerGateReceiptRelPath } from './ownerGateReceipts.js';
import { runTechnicalContinuation } from './technicalContinuation.js';
import { resolveTechnicalDelegation } from './gatekeeperConfig.js';
import { selectNextPhase, selectionStopLines } from './selection.js';
import { buildWorkerBrief, briefProvenanceProblems, type WorkerBrief } from './brief.js';
import {
  committedExecutionProblems,
  resolveWorker,
  type AdapterRegistry,
  type WorkerOutcome,
  type WorkerSession,
} from './workers.js';
import { BUILT_IN_ADAPTERS } from './adapters/claudeCodeCli.js';
import { collectEvidence, configuredChecks, requiredChecks, runChecks, type CheckResult } from './verification.js';
import {
  decideContinuation,
  loopStopLines,
  MAX_CORRECTION_ATTEMPTS,
  type EffectsRecord,
  type LoopStop,
  type LoopStopCode,
  type ReviewFinding,
} from './outcome.js';
import { readWorkRecord, type WorkState } from './workRecord.js';
import { takeGatekeeperTurn, type GatekeeperTurnDeps } from './gatekeeperTurn.js';
import {
  technicalDelegationCondition,
  TECHNICAL_ACTIONS,
  type CandidateIdentity,
  type CheckedTechnicalDecision,
} from '@projectos/core';
import type { DurableBinding } from './degradedMode.js';
import {
  authorityWrapper,
  committedGovernanceOwner,
  degradedWorkSubject,
  deriveUnavailabilityId,
  runDegradedWork,
  type DegradedOperation,
  type DegradedOutcome,
} from './degradedMode.js';
import { authoriseCorrection, pathsNamedIn, within as withinPath } from './correctionBoundary.js';
import {
  gateBlockedByReconciliation,
  type GatekeeperUnavailabilityCause,
  type LedgerEntry,
} from '@projectos/core';
import * as store from './session.js';
import {
  digestOf,
  invocationIdFor,
  redactArgv,
  writeInvocation,
  INVOCATION_SCHEMA_VERSION,
  type InvocationFacts,
} from './invocation.js';

/**
 * One truthful transition in the life of a work item.
 *
 * Deliberately not the record itself: the loop knows what it is doing, not where that is stored or
 * what it was before. Assembling a `WorkRecord` from these is the entrypoint's business.
 */
export interface WorkStateReport {
  readonly state: WorkState;
  readonly phaseId: string;
  readonly sessionId?: string | null;
  readonly attempt?: number | null;
  readonly subjectCommit?: string | null;
  readonly lastCompletedStep?: string | null;
  readonly lastStopCode?: LoopStopCode | null;
  readonly lastStopDetail?: string | null;
  readonly gateDecisionId?: string | null;
  readonly nextCandidateAction?: string | null;
  readonly ownerRequired?: boolean;
}
export interface RunOptions {
  /** Which authorised worker to use. Omitted takes the project's default. */
  readonly workerId?: string;
  /**
   * Prepare everything and stop before starting a worker. The brief is still written and the
   * decision still reported, so the run can be reviewed before anything is spawned.
   */
  readonly dryRun?: boolean;
  /**
   * The process that invoked ProjectOS, recorded before any worker is spawned. Injected so a test
   * can assert deterministic values; a real run supplies its own — see `invocation.ts` for why this
   * exists and, importantly, what it does NOT establish.
   */
  readonly invocation?: InvocationFacts;
  /**
   * Continue the session this phase and commit already have, instead of starting a new one.
   *
   * Rejoining used to happen by ITSELF: the session id was phase+commit, so a second `--execute` at
   * the same commit found the earlier record, adopted its `providerRef` and continued that worker.
   * Continuing an earlier run is a different operation from starting one and now takes saying so.
   */
  readonly resume?: boolean;
  /** The session a resume continues. Required with `resume`; never derived. */
  readonly resumeSessionId?: string;
  /** Adapter registry. Injected so a test can register a worker kind without spawning a process. */
  readonly adapters?: AdapterRegistry;
  /**
   * The unattended reviewer, when one is configured.
   *
   * ABSENT BY DEFAULT, AND THE DEFAULT BUILD IS UNCHANGED BY THIS. With no gatekeeper the loop stops
   * exactly where it always stopped and the owner carries it onward — which is the correct behaviour
   * while no reviewer exists, and means wiring this in cannot alter a run nobody configured. When one
   * IS configured, a stop the reviewer may answer becomes a request instead of the end of the run.
   */
  readonly gatekeeper?: GatekeeperTurnDeps;
  /**
   * Called after every gatekeeper turn that actually reached the reviewer.
   *
   * THE LOOP DOES NOT WRITE THE LEDGER ITSELF. Spend and thread continuity are durable state, and
   * where durable state lives is the command's concern, not the loop's — the loop stays testable
   * without a filesystem. A caller that ignores this callback gets a correct run whose spend is
   * forgotten, which is why the command wires it and the tests assert it is called.
   */
  readonly onGatekeeperTurn?: (entry: LedgerEntry, providerResponseId: string | null) => void;
  /**
   * Durable work state, reported as the loop reaches it.
   *
   * A PORT, exactly like `onGatekeeperTurn` and `admitSpend`: this file owns no durability, and the
   * entrypoint decides whether anything is written down. Absent by default, so a run nobody
   * configured behaves precisely as it always did.
   *
   * IT REPORTS; IT NEVER ASKS. The loop does not read work state back, and no return value can
   * change what it does next — a checkpoint that could redirect execution would be authority, and it
   * is not. What the loop decides is decided by the governed chain, unchanged.
   */
  readonly onWorkState?: (progress: WorkStateReport) => void;
  /**
   * Continuing without a reviewer, on the owner's committed risk.
   *
   * ABSENT BY DEFAULT, exactly like `gatekeeper` above, and for the same reason: with this unset the
   * loop stops at the owner's three-way choice precisely where it always did, so wiring it in cannot
   * alter a run nobody configured. When it IS set, the loop looks for the owner's COMMITTED grant —
   * and finding none, still stops. There is no configuration under which degraded mode begins
   * without a committed grant.
   *
   * `grantId` names which grant to look for; the owner chose ACCEPT RISK by committing it. `operation`
   * is the single non-protected thing this run would do, checked against the grant's scope before
   * anything is spent.
   */
  readonly degradedMode?: {
    /**
     * WHICH committed grant to look for. A pointer, never an authority.
     *
     * Naming a grant asserts nothing: the record still has to exist in the git object store, bind
     * this project, phase, subject commit and outage, name the recorded owner, stay inside its
     * scope and bound, and not already be spent. A wrong id simply finds nothing.
     */
    readonly grantId: string;
    /**
     * What to do, from the closed vocabulary. Not a command, not a script, not a callback.
     *
     * EVERY OTHER INPUT IS DERIVED, NOT ACCEPTED. The recorded owner comes from the approved plan's
     * own governance block, the project and phase from the governed context, the subject from the
     * observed head, and the outage identity from the unavailability that actually happened. There
     * is deliberately no option through which a caller could supply an owner, a provenance flag, or
     * the work itself — authority a caller can state is not authority.
     */
    readonly operation: DegradedOperation;
    /**
     * Where the installation records what degraded mode spends.
     *
     * SUPPLIED BY THE COMPOSITION ROOT, never derived here. A state directory this module chose for
     * itself could end up inside the governed project, which is the defect the durable record exists
     * to close.
     */
    readonly durable: DurableBinding;
  };
  /**
   * The paths this phase's APPROVED SCOPE permits a correction to write.
   *
   * DERIVED BY THE CALLER FROM THE APPROVED PLAN, never from a reviewer and never from here. An
   * empty list means no correction may write anything, which is the correct default: a phase that
   * has not authorised a writable boundary has not authorised autonomous correction.
   */
  readonly correctionMaximumPaths?: readonly string[];
  /** Owner gates the approved plan names for this phase; the reviewer may never grant one. */
  readonly ownerOnlyActions?: readonly string[];
  /** Who the approved plan says reviews. Never derived from a caller flag. */
  readonly expectedDecider?: string;
}

export type RunResult =
  | { readonly ok: false; readonly lines: readonly string[] }
  | {
      readonly ok: true;
      readonly lines: readonly string[];
      readonly phaseId: string;
      readonly sessionId: string;
      readonly stop: LoopStop | null;
      readonly attempts: number;
      /** What the degraded-mode path did, when one was configured and the reviewer was unreachable. */
      readonly degraded?: DegradedOutcome | undefined;
    };

function refused(lines: readonly string[]): RunResult {
  return { ok: false, lines };
}

/**
 * Add correction grants to a worker's argv without disturbing anything else it was given.
 *
 * APPENDED TO THE EXISTING `--allowedTools` VALUE rather than replacing it, so the records the worker
 * already owns stay writable and the grant list remains one flag. Only Edit and Write ever arrive
 * here - `authoriseCorrection` emits nothing else - so no shell reaches the worker and git stays
 * unreachable.
 */
function withCorrectionGrants(args: readonly string[], grants: readonly string[]): readonly string[] {
  const out = [...args];
  const i = out.findIndex((a) => a === '--allowedTools' || a === '--allowed-tools');
  if (i >= 0 && out[i + 1] !== undefined) {
    out[i + 1] = `${out[i + 1]},${grants.join(',')}`;
    return out;
  }
  return [...out, '--allowedTools', grants.join(',')];
}

/**
 * The paths the APPROVED PHASE SCOPE names, which a correction worker may therefore never write.
 *
 * WHY THE SCOPE'S OWN PATHS ARE THE DENY LIST. A phase scope names the files the governed IMPLEMENTER
 * is authorised to change. The autonomous correction worker is not the implementer: it is a bounded
 * repair of something a check found wrong, and this phase's approved scope says so in as many words -
 * "neither path is writable by the autonomous correction worker". Reading that sentence out of prose
 * is not something a machine can do safely, but the paths beside it can be read exactly, and refusing
 * every one of them enforces the sentence structurally rather than trusting it to be honoured.
 *
 * IT IS INERT WITHOUT A SCOPE, and that is deliberate rather than overlooked. A plan whose phases
 * carry no `scope` yields an empty list and the veto below never fires - which is the only
 * backward-compatible answer for every plan approved before scope was projected into the structured
 * record, and it is why the projection was added at all. A phase that wants this protection must
 * carry a scope. Raised as CODE-SCOPE-ABSENT-BYPASS by the live reviewer.
 *
 * IT FAILS CLOSED. A scope that named a path the worker genuinely should repair would be refused here
 * rather than allowed. That is the safe direction: the cost is a refusal the owner can see and widen
 * deliberately, and the alternative cost is a correction worker editing the machinery that bounds it.
 */
function scopeImplementationPaths(context: GovernedContext, phaseId: string): readonly string[] {
  const phases = context.plan['phases'];
  if (!Array.isArray(phases)) return [];
  const phase = phases.find(
    (p): p is Record<string, unknown> =>
      typeof p === 'object' && p !== null && (p as Record<string, unknown>)['phaseId'] === phaseId,
  );
  const scope = phase === undefined ? undefined : phase['scope'];
  return typeof scope === 'string' ? pathsNamedIn(scope) : [];
}

/**
 * The programme the active approved plan declares, or `''` when it declares none.
 *
 * A DELEGATION IS PROGRAMME-SCOPED, so resolving one needs this. An empty string is deliberately not
 * a wildcard: `checkClosureDelegationRecord` compares it against the record's `programmeScope` and
 * refuses a mismatch, so a plan without a programme resolves no delegation at all rather than matching
 * every one.
 */
function programmeIdOf(context: GovernedContext): string {
  const id = context.plan['programmeId'];
  return typeof id === 'string' ? id.trim() : '';
}

/**
 * What a technical continuation actually did, so the run can say so truthfully.
 *
 * IT RETURNED `void`, AND THAT WAS A HIGH FINDING. A refusal — a candidate that drifted, a remote
 * that moved, a rejected push — was logged and then vanished: no stop was established, the loop
 * exited with `stop === null`, and the durable work state was written as COMPLETE. So the executor
 * could refuse correctly and the record could still say the phase had finished, which is the exact
 * class of untruth this programme's checkpoint exists to prevent.
 *
 * `NO_ACTION` IS NOT SUCCESS EITHER. Reaching an approved success stop and then performing nothing —
 * because the decision named no action this runtime performs, or because the facts it needed never
 * arrived — is a run that did not do what it was approved to do. It fails towards BLOCKED, which is
 * the same direction every other classification in this loop fails.
 */
type ContinuationResult =
  | { readonly kind: 'APPLIED' }
  | { readonly kind: 'REFUSED'; readonly detail: string }
  | { readonly kind: 'NO_ACTION'; readonly detail: string };

/** How much of a failing check's output the reviewer is shown. Enough to locate a failure, bounded. */
const CHECK_OUTPUT_TAIL = 4000;

/**
 * How many candidate paths the reviewer is shown by name.
 *
 * The DIGEST covers every one of them, so this bounds the prompt and not the binding. Enough to see
 * the shape of an ordinary phase's change set; a larger one is summarised by count rather than
 * enumerated into a paid call.
 */
const CANDIDATE_ENTRIES_SHOWN = 200;

/**
 * What ended the attempt, in the loop's own stop vocabulary, or `null` when nothing did.
 *
 * THREE OUTCOMES, THREE ANSWERS, AND THE THIRD IS THE POINT. A worker that refused, a worker that
 * exited non-zero and a worker that was ended for running past its bound are different events, and
 * for a long time the third could not happen at all. Now that it can, it must not arrive wearing one
 * of the other two names: a timeout reported as a refusal tells the reviewer the worker said
 * something it never said, and a timeout reported as an exit code invents a status the run never had.
 */
function describeWorkerOutcome(o: WorkerOutcome): { stop: LoopStop | null; line: string } {
  if (o.kind === 'refused') return { stop: { code: 'WORKER_REFUSED', detail: o.detail }, line: `worker refused: ${o.detail}` };
  if (o.kind === 'timedOut') {
    const seconds = Math.round(o.afterMs / 1000);
    return {
      stop: {
        code: 'WORKER_TIMED_OUT',
        detail:
          `the worker did not finish within ${seconds}s and was ended; anything it left behind ` +
          'describes work that was cut off rather than a result',
      },
      line: `worker timed out after ${seconds}s`,
    };
  }
  const tail = o.stderr.trim() === '' ? '' : ` — ${o.stderr.trim().split(/\r?\n/).slice(-1)[0]}`;
  return {
    stop: o.exitCode === 0 ? null : { code: 'WORKER_REFUSED', detail: `the worker exited ${o.exitCode}${tail}` },
    line: `worker exited ${o.exitCode}`,
  };
}

/**
 * Run one phase of the approved plan as far as it can go without a human decision.
 *
 * Returns lines for the CLI plus the structured outcome. It writes the brief, the session record and
 * the evidence, and nothing else — no phase transition, no commit, no closure. Those are gates, and
 * a loop that performed them would be the thing this design exists to prevent.
 */
export function runLoop(sys: System, root: string, options: RunOptions = {}): RunResult {
  const contextResult = loadGovernedContext(sys, root);
  if (!contextResult.ok) return refused(refusalLines(contextResult));
  const context: GovernedContext = contextResult.context;

  const verification = verifyExecutionContext(sys, root, context);
  if (verification.mismatches.length > 0) {
    return refused(['REFUSED (CONTEXT_MISMATCH): the checkout does not match the project the loop was asked to run', ...verification.mismatches.map((m) => `  - ${m}`)]);
  }

  const selection = selectNextPhase(sys, root, context);
  if (selection.kind === 'stop') return refused(selectionStopLines(selection.reason));
  const phaseId = selection.planPhase.phaseId;

  // THE INVOCATION IS ESTABLISHED BEFORE THE SESSION, because it now names it.
  //
  // A fresh live execution gets a session of its own. `--resume` addresses an existing session by
  // name instead, and is the ONLY way to continue an earlier worker — which is what makes rejoining
  // a deliberate operation rather than something that happens because the commit did not move.
  const facts: InvocationFacts = options.invocation ?? {
    pid: process.pid,
    ppid: process.ppid,
    argv: process.argv,
    cwd: process.cwd(),
  };
  const invokedAt = sys.now();
  const invocationId = invocationIdFor(phaseId, invokedAt, facts.pid);
  const resuming = options.resume === true;

  // A RESUME NAMES ITS SESSION. It cannot derive one, because every fresh execution now carries a run
  // discriminator — so a resume that guessed `phase-head` would look at an id no execution ever
  // writes, find nothing, and START A NEW WORKER while reporting a resume. That is worse than
  // refusing: it loses the stuck worker's conversation and says nothing.
  const sessionId = resuming
    ? (options.resumeSessionId ?? '')
    : store.sessionIdFor(phaseId, String(verification.observed.head), invocationId.slice(0, 8));
  if (sessionId === null || sessionId === '' || !store.isSafeSessionId(sessionId)) {
    return refused(
      resuming
        ? [
            'REFUSED (NO_SESSION_NAMED): `--resume` continues one named session and will not guess which.',
            '  - pass `--session <sessionId>`; the id is on the run you are continuing, and its records',
            '    are in .projectops/execution/',
          ]
        : [`REFUSED (UNSAFE_PHASE_ID): phase '${phaseId}' does not make a safe record name, so this run can have no durable records`],
    );
  }
  const briefFile = store.briefPath(root, sessionId);

  const briefResult = buildWorkerBrief(context, phaseId, verification.observed, sys.now(), {
    briefPath: briefFile,
    findingsPath: store.findingsPath(root, sessionId),
    effectsPath: store.effectsPath(root, sessionId),
    evidencePath: store.evidencePath(root, sessionId),
  });
  if (!briefResult.ok) {
    return refused(['REFUSED (BRIEF_NOT_BUILDABLE): no worker brief could be built from the approved plan', ...briefResult.problems.map((p) => `  - ${p}`)]);
  }
  const brief: WorkerBrief = briefResult.brief;

  // The brief must contain nothing that is not in the plan, the config or the checkout. This is the
  // check that keeps "the loop hands over no free text" a property rather than a claim.
  const invented = briefProvenanceProblems(brief, context, verification.observed);
  if (invented.length > 0) {
    return refused(['REFUSED (BRIEF_NOT_DERIVED): the brief carries content that is in no governed source', ...invented.map((p) => `  - ${p}`)]);
  }

  // What the loop is about to SPAWN must be what the owner committed, not what is on disk now — the
  // worker this loop starts can write to the config that names its own successor.
  const uncommitted = committedExecutionProblems(sys, root, context);
  if (uncommitted.length > 0) {
    return refused(['REFUSED (EXECUTION_CONFIG_UNCOMMITTED): the loop spawns only what the owner has committed', ...uncommitted.map((p) => `  - ${p}`)]);
  }

  // The project's own suites. A malformed entry is refused here rather than dropped, because a check
  // that quietly vanished from the list would make every later record overstate what was verified.
  const suites = configuredChecks(context.config as unknown as Record<string, unknown>);
  if (suites.problems.length > 0) {
    return refused(['REFUSED (BAD_CHECK_CONFIG): the project declares a check the loop cannot read', ...suites.problems.map((p) => `  - ${p}`)]);
  }

  // WHAT A CORRECTION MAY EVER WRITE, checked BEFORE a worker exists rather than when one asks.
  //
  // The maximum is the caller's, derived from the approved plan; this is where the approved plan gets
  // to veto it. A maximum that reaches into a path the phase scope names as implementation is refused
  // outright and the run does not start - not narrowed quietly, because a boundary that shrank on its
  // own would look like it had been honoured.
  const correctionMaximum = options.correctionMaximumPaths ?? [];
  const scopePaths = scopeImplementationPaths(context, phaseId);
  const overreaching = correctionMaximum.filter((m) => scopePaths.some((impl) => withinPath(m, impl)));
  if (overreaching.length > 0) {
    return refused([
      'REFUSED (CORRECTION_BOUNDARY_OVERREACHES_SCOPE): a correction boundary may not include a path the',
      'approved phase scope names as implementation.',
      ...overreaching.map((m) => `  - ${m}`),
      '  the autonomous correction worker never writes the machinery that bounds it',
    ]);
  }

  const resolution = resolveWorker(context, options.adapters ?? BUILT_IN_ADAPTERS, options.workerId);
  if (!resolution.ok) {
    return refused(['REFUSED (NO_AUTHORISED_WORKER): the loop has no worker it may start', ...resolution.problems.map((p) => `  - ${p}`)]);
  }

  // A session belongs to the worker that created it. The id is phase+commit, so a run with a
  // DIFFERENT worker — `--worker`, or an edited default — would otherwise inherit the first worker's
  // handle and hand it to a second executable that never created it, while the record kept naming
  // the first. Refuse: which worker owns a run is not something to resolve by guessing.
  const existingRead = store.readSession(sys, root, sessionId);
  if (!existingRead.ok) {
    return refused([`REFUSED (SESSION_UNREADABLE): ${existingRead.problem}`]);
  }
  const existing = existingRead.value;
  // A RESUME WITH NOTHING TO RESUME IS A REFUSAL, not a fresh start. Starting one here would spawn a
  // new worker while the operator believes an earlier one was continued — the same fail-open the
  // named-session rule above closes, one step further in.
  if (resuming && existing === null) {
    return refused([
      `REFUSED (NO_SUCH_SESSION): there is no session '${sessionId}' to resume.`,
      '  - check the id against the records in .projectops/execution/',
      '  - to start new work instead, run without `--resume`',
    ]);
  }
  if (existing !== null && existing.workerId !== resolution.worker.workerId) {
    return refused([
      `REFUSED (SESSION_WORKER_MISMATCH): session '${sessionId}' belongs to worker '${existing.workerId}' (${existing.kind}), ` +
        `but this run resolved '${resolution.worker.workerId}' (${resolution.worker.kind}). ` +
        'Finish or discard that session before running this phase under another worker.',
    ]);
  }
  // THE REST OF THE SESSION'S IDENTITY, CHECKED BEFORE ANYTHING IS REJOINED OR WRITTEN.
  //
  // The worker check above was the whole guard, and it was not enough. A session records the phase it
  // was created for and the brief it was created from, and neither was compared — so a session made
  // for one phase could have its provider handle adopted by another, rebound by the record written
  // below, and reported as "rejoined". The phase check closes that.
  //
  // AND THE BRIEF CHECK CLOSES THE ONE A PHASE CHECK CANNOT. `briefId` is `phaseId@head`, so the same
  // phase at a MOVED head produces a different brief while the phase still matches. Resuming there
  // would hand a worker a brief describing bytes that are no longer present and call the result a
  // continuation of the earlier run. Same phase, moved repository, is a refusal.
  //
  // `sessionId` is compared too, though the record was located by that id: a record whose own field
  // disagrees with where it lives is not a record to act on.
  if (existing !== null) {
    const drift: string[] = [];
    if (existing.sessionId !== sessionId) {
      drift.push(`the record names session '${existing.sessionId}', but it was found at '${sessionId}'`);
    }
    if (existing.phaseId !== phaseId) {
      drift.push(`it belongs to phase '${existing.phaseId}', and this run selected '${phaseId}'`);
    }
    if (existing.kind !== resolution.worker.kind) {
      drift.push(`it was created by a '${existing.kind}' worker, and this run resolved a '${resolution.worker.kind}'`);
    }
    if (existing.briefId !== brief.briefId) {
      drift.push(
        `it was created from brief '${existing.briefId}', and this run derives '${brief.briefId}' — ` +
          'the repository has moved, so the work it describes is not the work in this checkout',
      );
    }
    if (drift.length > 0) {
      return refused([
        `REFUSED (SESSION_CONTEXT_MISMATCH): session '${sessionId}' does not describe this run.`,
        ...drift.map((d) => `  - ${d}`),
        '  a resume continues the run that was interrupted, or it refuses; it never adopts another run’s',
        '  provider handle, and it never silently starts a fresh worker instead',
      ]);
    }
  }

  // PERSISTED ONLY NOW. Writing the brief before the checks above meant a refused resume had already
  // overwritten the historical session's brief by the time it was refused — the record of the run
  // being recovered was damaged by the act of failing to recover it.
  store.writeBrief(sys, root, sessionId, brief);

  const lines: string[] = [
    `${selection.kind === 'continue' ? 'Continuing' : 'Starting'} ${phaseId} on ${verification.observed.branch} at ${String(brief.repository.head).slice(0, 12)}`,
    `Worker: ${resolution.worker.workerId} (${resolution.worker.kind})`,
    `Brief:  ${briefFile}`,
  ];

  if (options.dryRun === true) {
    lines.push('DRY RUN: the brief is written and no worker was started.');
    return { ok: true, lines, phaseId, sessionId, stop: null, attempts: 0 };
  }

  // A previous run's handle, when there is one. It is what makes a correction cycle a REJOIN of the
  // same worker rather than a fresh worker that knows nothing about the first one's work.
  //
  // ONLY the handle is taken from the record. `briefPath` and `briefId` are recomputed, never read
  // back: the session record is a file the spawned worker can write to, and the rejoin instruction
  // puts that path on the worker's command line. A worker that edited its own session record could
  // otherwise redirect the next rejoin at a file of its choosing — the same working-tree-trust
  // mistake the committed-config gate exists to prevent, one record along.
  // WRITTEN BEFORE ANYTHING IS SPAWNED, and deliberately not before the dry-run return above: a run
  // that starts nothing has no invocation to account for. Everything downstream carries this id, so
  // "what started this worker?" is answerable from the records themselves.
  const invocation = writeInvocation(sys, root, {
    schemaVersion: INVOCATION_SCHEMA_VERSION,
    invocationId,
    createdAt: invokedAt,
    projectId: String(context.config.projectId),
    phaseId,
    sessionId,
    repository: {
      root,
      branch: verification.observed.branch,
      head: verification.observed.head,
    },
    executionMode: 'live',
    process: {
      pid: facts.pid,
      ppid: facts.ppid,
      argv: redactArgv(facts.argv),
      cwd: facts.cwd,
    },
    workerId: resolution.worker.workerId,
    workerKind: resolution.worker.kind,
    brief: { path: briefFile, briefId: brief.briefId, digest: digestOf(brief) },
  });
  lines.push(`Invocation: ${invocation.invocationId} (pid ${facts.pid}, parent ${facts.ppid})`);

  let session: WorkerSession = {
    ...(existing ?? {
      startedAt: sys.now(),
      providerRef: null,
      state: 'started' as const,
      exitCode: null,
      corrections: 0,
    }),
    invocationId: invocation.invocationId,
    sessionId,
    workerId: resolution.worker.workerId,
    kind: resolution.worker.kind,
    phaseId,
    briefId: brief.briefId,
    briefPath: briefFile,
  };

  let attempts = 0;
  let stop: LoopStop | null = null;
  /** Grants for the NEXT attempt only. Cleared after use so authority never outlives its amendment. */
  let correctionGrants: readonly string[] = [];
  /** The instruction and decision the last gatekeeper turn produced, for the correction that follows. */
  let lastInstruction: string | null = null;
  let lastDecisionId: string | null = null;
  /** The candidate identity carried in the last evidence pack, or null when none could be named. */
  let reviewedCandidate: CandidateIdentity | null = null;
  /** The last decision `checkGatekeeperDecision` accepted, or null. Never authority on its own. */
  let acceptedDecision: CheckedTechnicalDecision | null = null;
  /**
   * Owner gates this run has PAID FOR: the receipt was judged valid and provably spent.
   *
   * A gate enters this map only after `consumeAnsweredOwnerGates` proved the spend, so membership is
   * this run's own record of an act it performed and verified — not a checkpoint, not authority, and
   * never read from disk. It exists because spending is durable and therefore one-way: the stamp
   * makes the receipt stop counting, so a later attempt in the SAME run re-reading the tree would
   * find the gate unanswered and stop for the owner a second time over a decision he had already
   * given and already paid for. Remembering the passage this run bought is what stops that, and it
   * dies with the process, which is exactly the lifetime it should have.
   */
  const paidOwnerGates = new Map<string, string>();
  /**
   * The durable work record AS THIS INVOCATION FOUND IT, captured before the run writes its own.
   *
   * READ ONCE, AND EARLY, BECAUSE THE RUN OVERWRITES IT. The loop reports its progress from the
   * moment it dispatches a worker, and the caller persists every report — so by the time a decision
   * is reached, the record on disk describes THIS run at the CURRENT head, and the wait it is trying
   * to resume has already been overwritten by it. Reading later found the run's own footprints and
   * concluded there was nothing to resume, which is precisely how the resume failed in the real flow
   * while every helper test passed.
   */
  const priorWork = readWorkRecord(sys, root);

  // WHAT THE LAST RUN LEFT BEHIND, SAID OUT LOUD.
  //
  // A restart begins a fresh work item over the top of an interrupted one and said nothing about it,
  // so an operator had no way to learn that a run had been interrupted at all, or which session it
  // had been using. These lines close that gap and nothing else.
  //
  // REPORTING ONLY. Not one line below decides anything: the run does not branch on the state it
  // finds, does not read `gateDecisionId`, `nextCandidateAction` or `GATE_APPROVED`, and does not
  // consult the work record's own resume predicate — whose repository-moved rule would refuse the
  // very A-to-B movement B7's owner resume exists to serve, and which the validator beside this file
  // forbids this module from naming at all. A checkpoint may say what happened; it may never say
  // what may now happen.
  //
  // THE MALFORMED CASE IS REPORTED RATHER THAN SWALLOWED. `readWorkRecord` deliberately separates
  // "absent" from "unreadable", and every other consumer collapses the two; an operator whose record
  // is corrupt should be told so rather than left to read silence as a clean slate.
  if (!priorWork.ok) {
    lines.push(`Prior work: the durable record could not be read — ${priorWork.problem}`);
  } else if (priorWork.value === null) {
    lines.push('Prior work: none recorded.');
  } else {
    const prior = priorWork.value;
    const at = prior.subjectCommit === null ? 'no subject commit' : `at ${prior.subjectCommit.slice(0, 12)}`;
    const stopped = prior.lastStopCode === null ? 'no stop recorded' : `stopped ${prior.lastStopCode}`;
    lines.push(
      `Prior work: ${prior.projectId}/${prior.phaseId} ${prior.state}, ${at}, ${stopped}` +
        `${prior.sessionId === null ? '' : `, session ${prior.sessionId}`}`,
    );
  }
  /** Decisions that have already driven a correction. One decision, one correction. */
  const correctionsApplied: string[] = [];
  // Decisions already acted on. A restart re-derives the same request id, so a decision that was
  // applied once is refused as a replay rather than applied again.
  //
  // SEEDED FROM THE LEDGER, which is the whole point. This started as an empty per-process array while
  // the caller carefully computed the durable set from the ledger and passed it in — and line 614 then
  // overwrote that dependency with the empty one, so the guard only ever knew about the current
  // process. A second `projectos run` re-derived the same request, called again, and applied whatever
  // verdict came back: verdict shopping with no tampering and no special access. Found by adversarial
  // review of the reconciliation route, which does not share the defect.
  const consumedDecisionIds: string[] = [...(options.gatekeeper?.consumedDecisionIds ?? [])];
  let gatekeeperLedger = options.gatekeeper?.ledger ?? [];
  /** What the degraded path did, so the caller can tell refusal from a spent grant. */
  let degradedOutcome: DegradedOutcome | undefined;
  /** Set only by the callback `runDegradedWork` invokes, i.e. only after a verified spend. */
  let degradedAttemptAuthorised = false;

  /**
   * The owner's ACCEPT RISK path, taken only when they have already committed the grant.
   *
   * WHAT THIS DOES NOT DO. It does not clear the stop. Degraded mode is permission to keep
   * IMPLEMENTING unreviewed, not permission to call the run a success, so the stop stands either way
   * and the caller sees exactly what was authorised and what debt it incurred.
   *
   * ORDER IS THE SAFETY PROPERTY: authorise, check the operation against the granted scope, persist
   * the consumption AND the debt, and only then would the work run. A failed write means no work.
   */
  /**
   * The owner's ACCEPT RISK path, taken only when they have already committed the grant.
   *
   * WHAT THIS DOES NOT DO. It does not clear the stop. Degraded mode is permission to keep
   * IMPLEMENTING unreviewed, not permission to call the run a success, so the stop stands either way
   * and the caller sees exactly what was authorised and what debt it incurred.
   *
   * ORDERING IS NO LONGER THIS FUNCTION'S RESPONSIBILITY. `runDegradedWork` takes the bounded work
   * as an argument and reaches it only through a persisted, read-back-verified consumption — so the
   * runner cannot perform the work first, cannot perform it after a failed write, and cannot
   * fabricate the authority that proves the grant was spent. All this does is supply the inputs and
   * report the structured outcome.
   */
  const degradedContinuation = (candidate: LoopStop, cause: GatekeeperUnavailabilityCause): DegradedOutcome => {
    const cfg = options.degradedMode;
    if (cfg === undefined) return { kind: 'NOT_CONFIGURED' };

    // THE RECORDED OWNER, READ FROM THE PLAN AS COMMITTED — not from the plan on disk.
    //
    // `loadGovernedContext` reads plan.json with an ordinary file read, so `context.plan` is
    // working-tree bytes the implementer can rewrite. Every other owner-authority input here is read
    // from git — the grant, the secrets receipt — and this now matches them. Raised by adversarial
    // review, which caught the earlier comment claiming a digest binding the code did not perform.
    const governedOwner = committedGovernanceOwner(sys, root, context.planPath);
    if (governedOwner === null) {
      lines.push('  degraded mode REFUSED: no committed approved plan records an owner, so no risk acceptance can be checked against one');
      return {
        kind: 'REFUSED',
        reasons: ['the approved plan, as committed, records no governance owner (absent, uncommitted, or modified since)'],
      };
    }

    // THE WORK SUBJECT, WHICH IS NOT ALWAYS HEAD.
    //
    // A grant has authority only once committed, and committing it MOVES HEAD — so binding to HEAD
    // would make every grant invalidate the very baseline it names. The grant commit is an authority
    // WRAPPER: it changes the grant record and nothing else, so its parent is still the work the
    // owner reviewed. Before any grant is committed there is no wrapper and the run's own head is
    // the subject, which is what makes the discovery run and the proof run agree.
    const wrapper = authorityWrapper(sys, root, phaseId, cfg.grantId);
    const subject = degradedWorkSubject(sys, root, wrapper);
    if (subject.subjectCommit === null) {
      lines.push('  degraded mode REFUSED: the authority commit is not a clean wrapper over the approved work:');
      lines.push(...subject.problems.map((p) => `    ${p}`));
      return { kind: 'REFUSED', reasons: subject.problems };
    }
    const workSubject = subject.subjectCommit;
    if (wrapper.kind === 'wrapper') {
      lines.push(`  degraded mode: authority commit ${wrapper.grantCommit.slice(0, 7)} over work ${workSubject.slice(0, 7)}`);
    }

    const unavailabilityId = deriveUnavailabilityId({
      projectId: context.projectId,
      phaseId,
      subjectCommit: workSubject,
      stopCode: candidate.code,
      cause,
    });
    lines.push(`  degraded mode: outage ${unavailabilityId}`);

    const outcome = runDegradedWork(
      sys,
      root,
      {
        projectId: context.projectId,
        phaseId,
        subjectCommit: workSubject,
        unavailabilityId,
        grantId: cfg.grantId,
        durable: cfg.durable,
        // THE RECORDED OWNER, FROM THE APPROVED PLAN'S OWN GOVERNANCE BLOCK. Never a flag, never a
        // config value a caller chose: the plan is digest-bound and owner-approved, so this is the
        // one statement of who the owner is that a caller cannot author.
        recordedOwner: governedOwner,
        ownerOnlyActions: options.ownerOnlyActions ?? brief.phase.requiredOwnerGates,
        operation: cfg.operation,
        at: sys.now(),
      },
      // THE WORK, BUILT HERE FROM THE CLOSED VOCABULARY — never handed in by a caller. It records
      // that the attempt was authorised; the attempt itself is the loop's ordinary worker path,
      // reached only because this returned WORK_DONE, so the spend is durable before anything runs.
      () => {
        degradedAttemptAuthorised = true;
      },
    );

    if (outcome.kind === 'REFUSED') {
      lines.push('  degraded mode REFUSED; nothing was authorised and no work was done:');
      lines.push(...outcome.reasons.map((r: string) => `    ${r}`));
      return outcome;
    }
    if (outcome.kind === 'CONSUMPTION_FAILED') {
      lines.push('  degraded mode REFUSED: the grant could not be recorded as spent, so no unreviewed work started');
      lines.push(`    ${outcome.problem}`);
      return outcome;
    }
    if (outcome.kind === 'WORK_DONE') {
      lines.push(
        `  degraded mode AUTHORISED '${cfg.operation}' as ${outcome.workId} ` +
          `(${outcome.remainingAfter} work item(s) left after this)`,
      );
      if (outcome.workError !== null) {
        lines.push(`  the bounded work failed, and the grant is still spent: ${outcome.workError}`);
      }
      if (outcome.reconciliationRequired) {
        lines.push(...gateBlockedByReconciliation({
          required: true,
          outstandingWorkIds: outcome.outstandingWorkIds,
          reasons: [`${outcome.outstandingWorkIds.length} degraded-mode work item(s) await reconciliation`],
        }).map((r) => `  ${r}`));
        // The block is useless if nobody knows how to clear it. Until this line existed the debt was
        // detectable and the route to discharging it was not discoverable from the run that incurred it.
        for (const id of outcome.outstandingWorkIds) {
          lines.push(`  to discharge it: projectos reconcile --grant ${cfg.grantId} --work ${id}`);
        }
      }
    }
    return outcome;
  };

  /**
   * Hand a stop to the reviewer and say what the loop should do next.
   *
   * Returns null when there is no reviewer, or when the stop is one the reviewer may not answer — in
   * both cases the stop stands and the run ends where it always did.
   */
  const consultGatekeeper = (candidate: LoopStop, evidenceText: string): 'retry' | 'proceed' | null => {
    const deps = options.gatekeeper;
    if (deps === undefined) return null;

    // The question is about to be asked. Reported before the call, because a process that dies
    // mid-call must leave behind that it was waiting on a gate, not that it was still working.
    options.onWorkState?.({ state: 'AWAITING_GATE', phaseId, sessionId, lastStopCode: candidate.code });

    const turn = takeGatekeeperTurn(
      {
        stop: candidate,
        projectId: context.projectId,
        phaseId,
        subjectCommit: verification.observed.head ?? '',
        repositoryRoot: root,
        evidenceText,
        ownerOnlyActions: options.ownerOnlyActions ?? brief.phase.requiredOwnerGates,
        // THE OWNER'S CONDITIONAL TECHNICAL DELEGATION, RESOLVED FROM THE COMMITTED RECORD.
        //
        // Null whenever this project has not recorded one, or has recorded one that does not carry
        // `technical-continuation`, or has recorded one that is not valid — so the default is the full
        // constitutional floor and no reviewer is ever asked about a continuation this project has not
        // delegated. It is minted from the delegation state and cannot be written by hand.
        //
        // SUPPLYING IT DOES NOT MAKE THIS LIVE. `ownerOnlyActions` above still carries the phase's own
        // `requiredOwnerGates`, and the active plan declares `commit` and `push` among them, so both
        // remain owner-only for this project until the owner amends that plan. What this line changes
        // is only that a project which HAS delegated, and whose plan does not separately gate the
        // action, can have the question put to its reviewer at all.
        technicalDelegation: technicalDelegationCondition(
          resolveTechnicalDelegation(sys, root, programmeIdOf(context)),
        ),
        expectedDecider: options.expectedDecider ?? '',
        at: sys.now(),
      },
      { ...deps, ledger: gatekeeperLedger, consumedDecisionIds },
    );
    lines.push(...turn.lines);
    // CAPTURED BEFORE ANY BRANCH RETURNS. This first sat on the amendment path, so the one branch
    // that actually needs it — the approved continuation, which returns earlier — never saw it and
    // the technical action was silently skipped with "no accepted decision". Assigned once, here,
    // where every outcome of the turn passes through.
    acceptedDecision = turn.checkedDecision;

    // The cost is recorded whether or not the answer was usable: the call happened.
    if (turn.ledgerEntry !== null) {
      gatekeeperLedger = [...gatekeeperLedger, turn.ledgerEntry];
      options.onGatekeeperTurn?.(turn.ledgerEntry, turn.providerResponseId);
    }
    if (turn.request !== null) consumedDecisionIds.push(`GKDEC-${turn.request.requestId}`);

    if (turn.action.kind === 'owner') {
      lines.push(...turn.action.reasons.map((r) => `  ${r}`));
      // The run cannot wait, so it ends — but it now ends having written down that it was the
      // OWNER it ended on, which is what a later resume needs and could never previously know.
      options.onWorkState?.({
        state: 'WAITING_OWNER',
        phaseId,
        sessionId,
        ownerRequired: true,
        lastStopCode: candidate.code,
        lastStopDetail: candidate.detail,
      });
      // THE OWNER'S THIRD CHOICE, WHEN THEY HAVE ALREADY COMMITTED IT.
      //
      // The loop cannot ask a question and wait, so it does not pretend to: a committed grant
      // recording ACCEPT RISK is the owner having chosen it, and no grant means this returns null
      // and the run stops at the choice exactly as before. `ownerChoices` is only non-null when the
      // reviewer was genuinely unreachable, so a stop the reviewer DECLINED can never take this path.
      // THE STRUCTURED CAUSE, NOT THE PROSE BESIDE IT. `ownerChoices` is non-null only on the
      // unavailable path, which is exactly where the turn records a cause — so this is never null
      // here, and the fallback is a refusal rather than a guess.
      if (turn.ownerChoices !== null && turn.unavailabilityCause !== null) {
        degradedOutcome = degradedContinuation(candidate, turn.unavailabilityCause);
      }
      return null;
    }
    if (turn.action.kind === 'proceed') {
      lines.push(`  gatekeeper: ${turn.action.detail}`);
      // APPROVED IS NOT PERMISSION TO ACT. It records that the reviewer cleared this stop; whether
      // any action follows is B6's decision, taken from the decision itself and never from here.
      options.onWorkState?.({
        state: 'GATE_APPROVED',
        phaseId,
        sessionId,
        gateDecisionId: turn.request === null ? null : `GKDEC-${turn.request.requestId}`,
        lastCompletedStep: `gatekeeper cleared ${candidate.code}`,
      });
      return 'proceed';
    }
    lines.push(`  gatekeeper requires an amendment: ${turn.action.instruction}`);
    options.onWorkState?.({
      state: 'CORRECTION_REQUIRED',
      phaseId,
      sessionId,
      gateDecisionId: turn.request === null ? null : `GKDEC-${turn.request.requestId}`,
      lastStopCode: candidate.code,
    });
    lastInstruction = turn.action.instruction;
    lastDecisionId = turn.request === null ? null : `GKDEC-${turn.request.requestId}`;
    return 'retry';
  };

  /**
   * Take the reviewer's answer and, if it asked for a correction, authorise one.
   *
   * `continue` means a correction was authorised and another attempt should run; `break` means the
   * run ends here; `proceed` means the reviewer cleared the stop.
   */
  /**
   * What the reviewer is shown, in two clearly separated parts.
   *
   * PART A IS THE MECHANISM; PART B IS THE FAILURE. The first live Criterion 10 chain handed over one
   * undifferentiated blob: a failing fixture together with every open finding about the correction
   * machinery itself. That asks the reviewer to decide whether this architecture should be used while
   * simultaneously asking it to use it, and it answered AWAITING_OWNER — correctly, on the evidence it
   * was given. Separating them hides nothing: the worker's own review, including every unresolved
   * finding, is still carried in full under `workerReview`.
   *
   * MISSING EVIDENCE IS REPORTED AS MISSING, NEVER MANUFACTURED. Three stops happen BEFORE the
   * evidence they would normally carry exists: a worker that refused ran no checks; an unreadable
   * findings record has no findings; an unattested run has no effects. Those parts now arrive as
   * `{ available: false, why }` carrying the exact reason. The alternative — an empty findings list,
   * or `effects: null`, or six `false`s — would show the reviewer a run that reviewed cleanly and
   * touched nothing, which is the fail-open these stops exist to prevent. A reviewer cannot approve
   * an absent attestation into existence, and it must not be shown one that looks present.
   */
  type EvidencePart<T> = { readonly available: true; readonly value: T } | { readonly available: false; readonly why: string };
  const unavailable = (why: string): EvidencePart<never> => ({ available: false, why });
  /**
   * The candidate, named for the reviewer, or the reason it could not be named.
   *
   * Recomputed per question rather than captured once: two stops in one run are two questions, and the
   * second is about whatever the checkout holds when it is asked.
   */
  const candidateEvidence = (): Record<string, unknown> => {
    const c = computeCandidateIdentity(sys, root);
    if (!c.ok) {
      reviewedCandidate = null;
      return { available: false, why: c.problems.join('; ') };
    }
    // THE CANDIDATE THE REVIEWER WAS ACTUALLY SHOWN, remembered so that a later continuation compares
    // against what was reviewed rather than against whatever the tree holds by then. Set here and
    // nowhere else, because this is the one place a candidate enters the question.
    reviewedCandidate = c.identity;
    // THE DIGEST IS THE BINDING; THE ENTRIES ARE FOR THE READER, AND THEY ARE BOUNDED.
    //
    // The digest is taken over EVERY entry, so showing fewer of them weakens nothing — a candidate of
    // a thousand files still has exactly one digest and any change to any of them changes it. What an
    // unbounded list would change is the size of a PAID prompt: this text is what the estimator prices
    // and what the provider is billed for, and a large phase could quietly make one governance call
    // cost several times what the reviewer needed. The same reasoning bounds a failing check's output.
    const shown = c.identity.entries.slice(0, CANDIDATE_ENTRIES_SHOWN);
    return {
      available: true,
      digest: c.identity.digest,
      pathCount: c.identity.entries.length,
      entries: shown,
      ...(shown.length === c.identity.entries.length
        ? {}
        : { note: `${c.identity.entries.length - shown.length} further path(s) are covered by the digest and not listed` }),
    };
  };
  const evidenceFor = (
    reason: LoopStop,
    parts: {
      readonly checks: EvidencePart<readonly CheckResult[]>;
      readonly findings: EvidencePart<{ readonly reviews: readonly string[]; readonly findings: readonly ReviewFinding[] }>;
      readonly effects: EvidencePart<EffectsRecord | null>;
    },
  ): string => {
    const f = parts.findings;
    const c = parts.checks;
    return JSON.stringify(
      {
        correctionMechanism: {
          what: 'a bounded correction worker, already implemented, tested and in use',
          workerWritableMaximum: correctionMaximum,
          workerMayNeverWrite: scopePaths,
          grantsIssued: 'Edit(path) and Write(path) only; no shell, so no git, no commit, no push',
          correctionsApplied: correctionsApplied.length,
          correctionBudgetRemaining: MAX_CORRECTION_ATTEMPTS - correctionsApplied.length,
          unresolvedCritical: f.available
            ? f.value.findings.filter((x) => !x.resolved && x.severity === 'CRITICAL').length
            : null,
          unresolvedHigh: f.available
            ? f.value.findings.filter((x) => !x.resolved && x.severity === 'HIGH').length
            : null,
        },
        currentFailure: {
          phaseId,
          stop: reason,
          failingChecks: c.available
            ? c.value
                .filter((x) => !x.passed)
                .map((x) => ({ id: x.id, kind: x.kind, exitCode: x.exitCode, output: x.output.slice(-CHECK_OUTPUT_TAIL) }))
            : c,
          passingChecks: c.available ? c.value.filter((x) => x.passed).map((x) => x.id) : c,
        },
        workerReview: f.available ? { reviewsRecorded: f.value.reviews, findings: f.value.findings } : f,
        effects: parts.effects.available ? parts.effects.value : parts.effects,
        attemptsSpent: attempts,
        // THE EXACT BYTES THIS ANSWER IS ABOUT.
        //
        // A decision binds project, phase, `subjectCommit` and `requestDigest` — and `subjectCommit`
        // is HEAD, the BASE the work sits on. The work itself is uncommitted, so until this line the
        // reviewer was shown failing checks, findings and effects and nothing whatever about the
        // candidate: not a diff, not a changed-path list, not a digest. An approval to commit was
        // therefore an approval of bytes the reviewer had provably never seen, and drift after the
        // answer was undetectable by construction rather than merely unchecked.
        //
        // PUT INSIDE THE EVIDENCE RATHER THAN ADDED AS A FIFTH BINDING. This text's digest is one of
        // `evidenceDigests`, which `gatekeeperRequestDigest` covers, which the decision must match —
        // so a decision that passed its check is already a decision about these bytes, through
        // machinery that was already load-bearing. A new field on the request would have been a
        // gate-contract redesign to obtain a property the contract could already carry.
        //
        // A FAILURE TO NAME IT IS REPORTED AS SUCH, never omitted: a missing key would silently
        // restore the old, unbound question, and every later comparison would have nothing to
        // compare against.
        candidate: candidateEvidence(),
        // THE ONLY WORDS THAT AUTHORISE ANYTHING, STATED WHERE THE DECISION IS BOUND TO THEM.
        //
        // The first live approval of a real continuation named
        // "perform-the-bounded-technical-continuation" and placed commit and push under forbidden -
        // an approval of nothing this runtime performs, refused correctly, at the price of a paid
        // call and a stopped run. Nothing had told the reviewer that ProjectOS acts only on the exact
        // strings in TECHNICAL_ACTIONS; the surrounding text even says the WORKER has no git, which
        // reads as a prohibition on the continuation. Put in the evidence rather than the system
        // instruction for the same reason the candidate is: this text's digest is part of the
        // request digest, so the decision is bound to having been told.
        technicalContinuation: {
          performableActions: TECHNICAL_ACTIONS,
          howToAuthorise:
            'ProjectOS performs ONLY the actions named above, matched by exact string in allowedActions. ' +
            'To authorise the continuation, list the exact names (for example "commit", "push"); any other ' +
            'phrasing authorises nothing. Listing them is not an owner-gate violation for this phase: the ' +
            'owner gates for this phase are exactly ownerGatesForThisPhase below, and everything else in ' +
            'performableActions is a delegable technical action the runtime will still independently check.',
          ownerGatesForThisPhase: options.ownerOnlyActions ?? brief.phase.requiredOwnerGates,
        },
      },
      null,
      1,
    );
  };

  /**
   * The commit the OWNER was answering — recovered from durable state, not from where HEAD is now.
   *
   * THE BUG THIS EXISTS TO FIX, WHICH MADE THE RESUME UNREACHABLE IN THE REAL FLOW. A receipt binds
   * to the subject at which OWNER_GATE was raised, and it only counts once COMMITTED — but that very
   * commit moves HEAD. So the run that stopped saw subject A, the owner answered A, committing the
   * answer made HEAD B, and the next run compared the receipt against B and threw it away as stale.
   * Every owner decision was refused by the act of recording it. My own tests missed it by capturing
   * the head BEFORE writing the receipt and then passing that stale value back in by hand, which is
   * precisely the production step that does not happen.
   *
   * THE RECORD IS CONTEXT, NEVER AUTHORITY. It answers only "which waiting instance is this", and it
   * cannot manufacture a passage: whatever subject it names, a receipt must still be committed at
   * that subject, decided by the plan's owner, bound to this project, phase and gate, unspent, and
   * provably spendable. A forged record pointing anywhere the owner never signed yields nothing.
   *
   * AND THE SEPARATION MUST BE EXACTLY THE RECEIPT, WHICH ANCESTRY ALONE DID NOT ESTABLISH. Requiring
   * only that the remembered subject be an ANCESTOR of the live head was too permissive: after the
   * receipt commit B, any unrelated later commit C still has A as an ancestor and the receipt is
   * still committed and unchanged, so an approval of A could be spent on work that had moved on
   * without the owner. That is stale owner authority, which this phase exists to refuse. So the
   * relationship is now exact — the live head must BE the commit that carries the decision, and its
   * FIRST PARENT must be the subject the wait was recorded at. One commit of separation, and that
   * commit must be the owner's answer.
   *
   * Anything else — an advanced head, a record from an abandoned branch, a subject that is not this
   * head's parent, a different phase or project, an unreadable file — falls back to the live head,
   * where a receipt bound to A cannot validate. Every failure leaves the gate standing.
   */
  const waitingSubject = (pending: readonly string[]): string | null => {
    const live = verification.observed.head;
    if (live === null) return null;
    if (!priorWork.ok || priorWork.value === null) return live;
    const record = priorWork.value;
    // THE STOP, NOT THE STATE, IS WHAT NAMES A WAITING INSTANCE. `WAITING_OWNER` is written only
    // when a reviewer is CONFIGURED and routing sends the stop to the owner; a run with no reviewer
    // ends the same wait as `BLOCKED`. Both records carry `lastStopCode: 'OWNER_GATE'` and the same
    // subject, so keying on the stop recovers the wait in either configuration — and keying on the
    // state would have made the resume depend on whether a reviewer happened to be wired up.
    if (record.lastStopCode !== 'OWNER_GATE') return live;
    if (record.projectId !== context.projectId || record.phaseId !== phaseId) return live;
    const remembered = record.subjectCommit;
    if (remembered === null || remembered === live) return live;

    // ONE COMMIT OF SEPARATION. The live head's first parent must be the recorded subject, so a head
    // that has advanced past the owner's answer — by even one unrelated commit — recovers nothing.
    const parent = sys.exec('git', ['-C', root, 'rev-parse', '--verify', `${live}^1`]);
    if (parent.code !== 0 || parent.stdout.trim() !== remembered) return live;

    // AND THAT ONE COMMIT MUST BE THE OWNER'S ANSWER. Being a child of the subject is not enough:
    // the head has to be the commit that most recently touched a pending gate's receipt, which is
    // what makes it the act of recording the decision rather than any other work done on top of A.
    const carriesTheAnswer = pending.some((gate) => {
      const rel = ownerGateReceiptRelPath(phaseId, gate);
      if (rel === null) return false;
      const last = sys.exec('git', ['-C', root, 'log', '-1', '--format=%H', '--', rel]);
      return last.code === 0 && last.stdout.trim() === live;
    });
    if (!carriesTheAnswer) return live;

    lines.push(`  resuming the owner wait recorded at ${remembered}; HEAD ${live} is the commit that carries the decision`);
    return remembered;
  };

  /**
   * Buy the owner gates that are actually blocking, and report which were bought.
   *
   * CALLED ONLY WHEN OWNER_GATE IS THE DECISION, WHICH WAS THE SECOND DEFECT. This used to be
   * evaluated as an argument to `decideContinuation`, so it ran before that function had decided
   * anything — and `decideContinuation` weighs blocking findings, scope, failing checks, effects and
   * reviews BEFORE it ever considers an owner gate. A run that was about to retry a failing check
   * therefore spent Murad's single-use decision on a passage it did not take. A receipt is now spent
   * only once the owner gate is the thing standing in the way.
   *
   * ONLY THE PENDING ONES. A standing protection like `secrets-handling` is never a continuation
   * action, so it is never blocking and its receipt — if one exists — is never touched here.
   *
   * CONSUMPTION IS A PRECONDITION OF SATISFACTION, enforced in `consumeAnsweredOwnerGates`: a gate
   * whose receipt cannot be provably spent is not returned, so it stays standing and the run stops
   * on the owner exactly as it already had.
   */
  const payForPendingOwnerGates = (): boolean => {
    const pending = brief.phase.requiredOwnerGates
      .filter((g) => (TECHNICAL_ACTIONS as readonly string[]).includes(g))
      .filter((g) => !paidOwnerGates.has(g));
    if (pending.length === 0) return false;
    // NO SUBJECT, NO ANSWER. A receipt is bound to the exact commit the owner was looking at; with
    // no subject to bind it to, every gate stays outstanding.
    const subject = waitingSubject(pending);
    if (subject === null) return false;
    const planOwner = committedGovernanceOwner(sys, root, context.planPath);
    if (planOwner === null) return false;
    const { satisfied, refusals } = consumeAnsweredOwnerGates(
      sys,
      root,
      {
        projectId: context.projectId,
        phaseId,
        requiredOwnerGates: pending,
        evidenceSubjectHead: subject,
        planOwner,
        // WHAT THIS RUN HAS ALREADY SPENT. One decision buys one gate: a receipt whose id already
        // bought a passage here cannot buy a second one, in this pass or a later attempt.
        alreadyConsumedDecisionIds: [...paidOwnerGates.values()],
      },
      sys.now(),
    );
    for (const { gate, decisionId } of satisfied) {
      paidOwnerGates.set(gate, decisionId);
      lines.push(`  owner gate '${gate}' answered by committed receipt ${decisionId}, now spent`);
    }
    for (const refusal of refusals) lines.push(`  ${refusal}`);
    return satisfied.length > 0;
  };

  /**
   * Carry out the technical continuation the reviewer approved, or say why it did not happen.
   *
   * NOTHING HERE DECIDES. It assembles facts the runtime already established — the governed project
   * and phase, the branch the plan names, the remote this runtime addresses, the delegation as read
   * from the COMMITTED record, the candidate the reviewer was shown — and hands them to the executor
   * pushed at cc324a7. Every refusal below is the executor's, reported rather than interpreted.
   */
  const runContinuation = (): ContinuationResult => {
    if (acceptedDecision === null || reviewedCandidate === null) {
      const detail = 'the continuation was approved but no accepted decision, or no named candidate, reached it';
      lines.push(`  no technical continuation: ${detail}`);
      return { kind: 'NO_ACTION', detail };
    }
    const programmeId = programmeIdOf(context);
    const delegation = resolveTechnicalDelegation(sys, root, programmeId);
    // THE BRANCH THE APPROVED PLAN NAMES, not the branch the checkout happens to be on. Comparing the
    // checkout against itself would make the executor's branch check vacuous.
    const repository = (context.plan['repository'] as Record<string, unknown> | undefined) ?? {};
    const expectedBranch = typeof repository['planSourceBranch'] === 'string' ? repository['planSourceBranch'] : '';
    if (expectedBranch === '') {
      const detail = 'the approved plan names no branch for this work, so no continuation could be attempted';
      lines.push(`  no technical continuation: ${detail}`);
      return { kind: 'NO_ACTION', detail };
    }

    // THE ACTIONS THE DECISION APPROVED, in the fixed order the executor proved. A decision approving
    // only a commit does not push; one approving both does them in this order and stops at the first
    // refusal. `APPROVED_TO_PROCEED` is not a licence to keep going.
    const approved = TECHNICAL_ACTIONS.filter((a: string) => acceptedDecision!.allowedActions.includes(a));
    if (approved.length === 0) {
      const detail =
        `the decision approved no technical action ProjectOS performs ` +
        `[${acceptedDecision.allowedActions.join(', ') || 'nothing'}], so no continuation happened`;
      lines.push(`  ${detail}`);
      return { kind: 'NO_ACTION', detail };
    }

    for (const action of approved) {
      const outcome = runTechnicalContinuation(sys, {
        action,
        context: {
          root,
          projectId: context.projectId,
          phaseId,
          programmeId,
          expectedBranch,
          // The remote name this runtime addresses everywhere else, including `observeRepository`.
          // A runtime convention, never a value a model supplied.
          expectedRemote: 'origin',
          // No governed integration target exists; the executor refuses rather than inventing one.
          integrationTargetBranch: null,
        },
        decision: {
          ...acceptedDecision,
          // THE CANDIDATE THE REVIEWER SAW. Supplied by the caller because the turn cannot know it —
          // see the note on `checkedDecision`.
          reviewedCandidateDigest: reviewedCandidate.digest,
          reviewedEntries: reviewedCandidate.entries,
        },
        delegation,
        phaseOwnerGates: options.ownerOnlyActions ?? brief.phase.requiredOwnerGates,
        at: sys.now(),
      });
      if (outcome.kind === 'REFUSED') {
        lines.push(`  technical continuation REFUSED for '${action}':`);
        lines.push(...outcome.reasons.map((r) => `    ${r}`));
        // A refusal ends the sequence. The next action was authorised for a world that no longer
        // holds, and attempting it would be acting on a stale judgement.
        return { kind: 'REFUSED', detail: `'${action}' was refused: ${outcome.reasons[0] ?? 'no reason given'}` };
      }
      lines.push(`  ${outcome.result}`);
      options.onWorkState?.({
        state: 'EXECUTING',
        phaseId,
        sessionId,
        subjectCommit: outcome.head,
        lastCompletedStep: `technical-continuation:${action}`,
        gateDecisionId: acceptedDecision.decisionId,
      });
      // THE BASE MOVED, because a commit is what moved it. A later action in this sequence is about
      // the new HEAD, and the decision was taken against the old one — so the binding is refreshed
      // from what actually happened rather than left to refuse the work it just authorised.
      acceptedDecision = { ...acceptedDecision, subjectCommit: outcome.head };
      const after = computeCandidateIdentity(sys, root);
      if (!after.ok) {
        const detail = 'the candidate could not be re-named after the action, so the sequence stopped part-way';
        lines.push(`  ${detail}`);
        return { kind: 'REFUSED', detail };
      }
      reviewedCandidate = after.identity;
    }
    return { kind: 'APPLIED' };
  };

  const applyReviewerAnswer = (reason: LoopStop, evidenceText: string): 'continue' | 'break' | 'proceed' => {
    const answer = consultGatekeeper(reason, evidenceText);
    if (answer === 'proceed') return 'proceed';
    // THE OWNER'S COMMITTED RISK ACCEPTANCE, ALREADY SPENT BY THE TIME THIS IS TRUE.
    //
    // `degradedAttemptAuthorised` is set only by the callback `runDegradedWork` invokes, which it
    // reaches only past a persisted, read-back-verified consumption — so one further attempt runs
    // here on a grant that is already recorded as spent, never on the promise of one. The flag is
    // cleared immediately: a grant buys one attempt, and the next needs its own authorisation.
    if (degradedAttemptAuthorised) {
      degradedAttemptAuthorised = false;
      lines.push(`  continuing UNREVIEWED under the owner's committed risk acceptance`);
      return 'continue';
    }
    if (answer !== 'retry' || correctionsApplied.length >= MAX_CORRECTION_ATTEMPTS) {
      stop = reason;
      return 'break';
    }
    // AN AMENDMENT WITHOUT ITS DECISION IS NOT AN AMENDMENT. `''` would deduplicate against a
    // previous `''` in `correctionsApplied` and look like a spent decision, or - worse - pass as
    // a fresh one. `authoriseCorrection` refuses an empty id too; this refuses it here so the
    // loop never even asks.
    if (lastInstruction === null || lastDecisionId === null) {
      lines.push('  the gatekeeper asked for a correction but no decision was recorded for it; nothing was authorised');
      stop = reason;
      return 'break';
    }
    // THE REVIEWER ASKED FOR A CORRECTION. What it may touch is decided here, against the phase's
    // approved maximum - never against what the amendment asked for. The amendment can only
    // narrow: `authoriseCorrection` refuses any path the approved scope does not already permit.
    const authorised = authoriseCorrection(
      {
        requestedPaths: pathsNamedIn(lastInstruction),
        projectId: context.projectId,
        phaseId,
        subjectCommit: verification.observed.head ?? '',
        decisionId: lastDecisionId,
      },
      {
        maximumPaths: correctionMaximum,
        projectId: context.projectId,
        phaseId,
        subjectCommit: verification.observed.head ?? '',
        consumedDecisionIds: correctionsApplied,
        attemptsRemaining: MAX_CORRECTION_ATTEMPTS - correctionsApplied.length,
      },
    );
    if (!authorised.ok) {
      // A correction the approved scope does not permit is not narrowed silently - the run stops
      // and says which path was refused, because a quietly dropped path looks like a fix.
      lines.push('  the correction the gatekeeper asked for is outside what this phase authorises:');
      lines.push(...authorised.reasons.map((r) => `    - ${r}`));
      lastInstruction = null;
      lastDecisionId = null;
      stop = reason;
      return 'break';
    }
    correctionsApplied.push(lastDecisionId);
    // CONSUMED MEANS GONE. Leaving these set let the NEXT stop reuse the previous amendment: a
    // turn that returned no decision leaves `lastDecisionId` unchanged, and the loop would then
    // authorise a second correction against an instruction the reviewer never gave for it.
    // Raised as CORR-STALE-DECISION-ID by the live reviewer against this file.
    lastInstruction = null;
    lastDecisionId = null;
    lines.push(
      `  correcting under gatekeeper direction (correction ${correctionsApplied.length} of ${MAX_CORRECTION_ATTEMPTS}); ` +
        `authorised to write: ${authorised.correction.paths.join(', ')}`,
    );
    correctionGrants = authorised.correction.grants;
    return 'continue';
  };

  for (;;) {
    // Rejoin whenever a handle exists. A handle from a PREVIOUS invocation only appears here when
    // the operator named that session with `--resume --session`; it is never inherited by
    // accident. Without a handle the only honest option is a fresh start, and the line below says
    // so rather than passing it off as a reconnect.
    const rejoining = session.providerRef !== null && session.providerRef !== '';
    // A CORRECTION ATTEMPT RUNS THE SAME WORKER WITH ONE ADDITION: the Edit/Write grants for the
    // paths ProjectOS authorised. Nothing else about the worker changes, and the grants are dropped
    // immediately afterwards, so authority never outlives the amendment that produced it.
    // WHY `toolGrantProblems` IS NOT RE-RUN HERE. That check bounds what the CONFIG may declare, and
    // it deliberately permits only the four record patterns the worker owns - so re-running it over
    // these grants would refuse the correction the runtime just authorised. These grants are not
    // config: they came from `authoriseCorrection`, which already bounded them against the approved
    // maximum, and they are only ever `Edit(path)`/`Write(path)`. Raised as CODE-GRANTS-NOT-REVALIDATED
    // by the live reviewer, which judged the design correct and the silence about it not.
    const attemptWorker =
      correctionGrants.length === 0
        ? resolution.worker
        : { ...resolution.worker, args: withCorrectionGrants(resolution.worker.args, correctionGrants) };
    // WHETHER THIS ATTEMPT COULD HAVE FIXED ANYTHING. The base worker's grants cover only the two
    // records it owns; correction authority exists solely when `authoriseCorrection` produced it.
    // The retry decision below needs to know which of the two just ran.
    const attemptHadCorrectionAuthority = correctionGrants.length > 0;
    correctionGrants = [];

    // A WORKER IS ABOUT TO BE DISPATCHED, AND THE RECORD SAYS SO BEFORE IT IS.
    //
    // Written HERE rather than after, and the ordering is the whole value. The runtime waits for the
    // worker synchronously, so between this line and the next return it can write nothing at all —
    // and that is exactly the window in which a run is force-killed from outside. Without this, a
    // stopped run left a checkpoint that had never heard of the worker it had dispatched; with it,
    // the record truthfully says a worker went out and no answer came back, which is what B8 will
    // need in order to reconcile it. `EXECUTING` still follows only once the attempt has actually
    // run, so neither state claims something that has not happened.
    options.onWorkState?.({
      state: 'WAITING_AI',
      phaseId,
      sessionId,
      attempt: attempts + 1,
      subjectCommit: verification.observed.head ?? null,
      lastCompletedStep: `${rejoining ? 'rejoined' : 'dispatched'} ${resolution.worker.workerId}`,
    });
    const outcome = rejoining
      ? resolution.adapter.rejoin(sys, attemptWorker, session, brief)
      : resolution.adapter.start(sys, attemptWorker, brief, briefFile);
    const described = describeWorkerOutcome(outcome);
    lines.push(`attempt ${attempts + 1}: ${rejoining ? 'rejoined' : 'started'} ${resolution.worker.workerId}; ${described.line}`);
    // A worker is really running. Reported only here, after the start actually happened — a state
    // written before the attempt would claim execution the loop had not yet begun.
    options.onWorkState?.({
      state: 'EXECUTING',
      phaseId,
      sessionId,
      attempt: attempts + 1,
      subjectCommit: verification.observed.head ?? null,
    });

    session = {
      ...session,
      state: rejoining ? 'rejoined' : 'started',
      providerRef: outcome.kind === 'completed' ? outcome.providerRef ?? session.providerRef : session.providerRef,
      exitCode: outcome.kind === 'completed' ? outcome.exitCode : null,
      // RECORDED, NOT LEFT TO BE INFERRED FROM A NULL EXIT CODE. `exitCode: null` already covers a
      // refusal, so on its own it cannot say which of the two this was — and this durable record is
      // the only account a later reader gets of an attempt that was ended rather than finished.
      timedOut: outcome.kind === 'timedOut',
      corrections: attempts,
    };
    store.writeSession(sys, root, session);

    // A worker that refused produces nothing to verify. Running the phase's validators anyway would
    // burn the full suite to learn what the exit code already said, and a green suite over unchanged
    // code would sit in the evidence beside a failed run looking like reassurance.
    if (described.stop !== null) {
      const refused: LoopStop = described.stop;
      store.writeEvidence(sys, root, { ...collectEvidence(sys, root, { sessionId, brief, checks: [] }), invocationId: invocation.invocationId });
      // ROUTED, NOT ENDED. `STOP_ROUTES` says this stop is the gatekeeper's — "a refusal is
      // information about the brief; the brief may be amended but the refusal may not be overruled" —
      // and until now the loop broke here and never asked. Nothing about the refusal is overruled:
      // APPROVED_TO_PROCEED is not applicable to this stop, so the only answers available are an
      // amendment, DO_NOT_PROCEED, or the owner.
      // WHAT IT ACTUALLY LEFT BEHIND, NOT WHAT A REFUSAL USUALLY MEANS. Saying "it recorded no
      // review" and "it attested nothing" without looking was asserting two facts this branch had
      // not checked — in the very place the comment above promises evidence is never manufactured.
      // A worker can attest truthfully and THEN exit non-zero, and that attestation is the reviewer's
      // most consequential input: it is what can turn an amendment into AWAITING_OWNER. Only the
      // checks are genuinely absent here, because this branch demonstrably runs none.
      const refusedFindings = store.readFindings(sys, root, sessionId);
      const refusedEffects = store.readEffects(sys, root, sessionId);
      const answered = applyReviewerAnswer(refused, evidenceFor(refused, {
        checks: unavailable(
          refused.code === 'WORKER_TIMED_OUT'
            ? 'the worker was ended for running past its bound, so no checks were run'
            : 'the worker refused, so no checks were run',
        ),
        findings: refusedFindings.ok
          ? { available: true, value: refusedFindings.value }
          : unavailable(refusedFindings.problem),
        effects: refusedEffects.ok
          ? { available: true, value: refusedEffects.value }
          : unavailable(refusedEffects.problem),
      }));
      if (answered === 'continue') continue;
      if (stop === null) stop = refused;
      break;
    }

    const checks: readonly CheckResult[] = runChecks(sys, root, requiredChecks(sys, root, brief, suites.checks));
    for (const c of checks) lines.push(`  ${c.passed ? 'PASS' : 'FAIL'} ${c.kind} ${c.id}`);
    options.onWorkState?.({
      state: 'VALIDATING',
      phaseId,
      sessionId,
      attempt: attempts + 1,
      lastCompletedStep: `checks ran for attempt ${attempts + 1}`,
    });

    const evidence = { ...collectEvidence(sys, root, { sessionId, brief, checks }), invocationId: invocation.invocationId };
    store.writeEvidence(sys, root, evidence);

    const findings = store.readFindings(sys, root, sessionId);
    if (!findings.ok) {
      const outstanding: LoopStop = { code: 'REVIEW_OUTSTANDING', detail: findings.problem };
      // THE ATTESTATION IS READ EVEN THOUGH THE REVIEW IS NOT. An unreadable findings record used to
      // mean the effects record was never consulted at all, so this branch could send a run onward
      // for correction while an attestation on disk said production had been touched — nobody had
      // looked. The two records are independent; one being corrupt is no reason to withhold the
      // other from the reviewer, and this is the one it must not be denied.
      const outstandingEffects = store.readEffects(sys, root, sessionId);
      const answered = applyReviewerAnswer(outstanding, evidenceFor(outstanding, {
        checks: { available: true, value: checks },
        findings: unavailable(findings.problem),
        effects: outstandingEffects.ok
          ? { available: true, value: outstandingEffects.value }
          : unavailable(outstandingEffects.problem),
      }));
      if (answered === 'continue') continue;
      if (stop === null) stop = outstanding;
      break;
    }
    // An attestation that is unreadable or incomplete is NOT an attestation. It is reported as the
    // absence it is, rather than as a protected effect that was never claimed — `PROTECTED_EFFECT`
    // means the run said it did something, and this run said nothing usable.
    const effects = store.readEffects(sys, root, sessionId);
    if (!effects.ok) {
      const unattested: LoopStop = { code: 'EFFECTS_NOT_ATTESTED', detail: effects.problem };
      const answered = applyReviewerAnswer(unattested, evidenceFor(unattested, {
        checks: { available: true, value: checks },
        findings: { available: true, value: findings.value },
        effects: unavailable(effects.problem),
      }));
      if (answered === 'continue') continue;
      if (stop === null) stop = unattested;
      break;
    }

    const turnFacts = {
      brief,
      checks,
      findings: findings.value.findings,
      effects: effects.value,
      reviewsRecorded: findings.value.reviews,
      attemptsSpent: attempts,
      // NULL, AND THE COMPILER AGREES. Every outcome that ends an attempt — a refusal, a non-zero
      // exit, a bound that was reached — is handled in the branch above, which always leaves this
      // iteration. TypeScript narrows `described.stop` to `null` here, so writing anything other
      // than null would be describing a case that cannot occur.
      workerRefusal: null,
    };

    // DECIDE FIRST, PAY SECOND, AND ONLY FOR THE THING ACTUALLY IN THE WAY.
    //
    // The first pass spends nothing: it is judged against the gates this run has ALREADY bought, so
    // a failing check, a blocking finding, a scope question or an unattested effect reaches its own
    // outcome without touching the owner's decision. Only when the answer is that the owner gate is
    // what remains is a receipt validated and spent — and then the decision is taken again, because
    // a gate that has just been paid for is no longer pending. If nothing could be bought, the first
    // decision stands and the run stops on the owner, which is where it already was.
    let decision = decideContinuation({ ...turnFacts, ownerGatesSatisfied: [...paidOwnerGates.keys()] });
    if (decision.kind === 'stop' && decision.reason.code === 'OWNER_GATE' && payForPendingOwnerGates()) {
      decision = decideContinuation({ ...turnFacts, ownerGatesSatisfied: [...paidOwnerGates.keys()] });
    }


    if (decision.kind === 'stop') {
      // THE RELAY REMOVAL, at the one place the loop used to end. A reviewer that requires an
      // amendment sends the phase back through the SAME bounded correction budget as an ordinary
      // failing check - it does not get its own, and it cannot reset the one that exists.
      const answered = applyReviewerAnswer(decision.reason, evidenceFor(decision.reason, {
        checks: { available: true, value: checks },
        findings: { available: true, value: findings.value },
        effects: { available: true, value: effects.value },
      }));
      if (answered === 'continue') continue;
      // THE ONE PLACE AN APPROVED SUCCESS STOP BECOMES AN ACT.
      //
      // Reached only when the reviewer answered `APPROVED_TO_PROCEED` to `CONTINUATION_READY` — a stop
      // that is raised only after every required check passed, every required review was recorded, no
      // protected effect was attested and the phase reserved no part of the continuation to the owner.
      // Every other stop and every other verdict leaves this untouched.
      //
      // AND IT AUTHORISES NOTHING BY ARRIVING HERE. `runTechnicalContinuation` re-derives the world,
      // re-checks the whole conjunction — delegation, allowedActions, closed vocabulary, project,
      // phase, HEAD, branch, remote, owner-only floor — and re-derives the candidate again after
      // fetching. This code cannot make any of that pass; it can only ask.
      if (answered === 'proceed' && decision.reason.code === 'CONTINUATION_READY') {
        const continued = runContinuation();
        // A CONTINUATION THAT DID NOT HAPPEN LEAVES THE RUN STOPPED, not finished. Without this the
        // run ended with no stop, and the durable work state said COMPLETE for a phase whose commit
        // was refused. The stop is the SAME one the reviewer answered — the continuation is still
        // outstanding, which is precisely what `CONTINUATION_READY` means — carrying the refusal so
        // the record says why rather than merely that.
        if (continued.kind !== 'APPLIED') {
          stop = { code: 'CONTINUATION_READY', detail: continued.detail };
        }
      }
      break;
    }
    if (decision.kind === 'proceed') {
      lines.push(decision.detail);
      break;
    }
    // CONSULT FIRST WHEN THE WORKER COULD NOT HAVE FIXED IT.
    //
    // An ordinary retry re-runs the worker with exactly the authority it already had. That is the
    // right thing when the worker CAN act on the failure - a review finding it can resolve, a record
    // it owns. It is useless when a mandatory CHECK is failing on a file the worker holds no grant
    // over: the first live Criterion 10 chain spent all three attempts, and roughly ninety minutes
    // of validators, re-running a worker that could not change the failing target, and only then
    // asked the reviewer. Three identical powerless attempts are not a correction budget being
    // spent; they are a correction budget being wasted before it is available.
    //
    // NOTHING IS WIDENED HERE. No extra attempt, no extra authority, no reset budget, no new stop
    // vocabulary. The stop is the one `CORRECTION_EXHAUSTED` already means - "another identical
    // attempt cannot change this, so it needs a different instruction" - which is exactly true the
    // moment the worker has no authority over the failing target. The reviewer's answer still runs
    // through the same routing table, the same bindings and the same bounded authorisation.
    const failing = checks.filter((c) => !c.passed);
    if (failing.length > 0 && !attemptHadCorrectionAuthority && options.gatekeeper !== undefined) {
      const exhausted: LoopStop = {
        code: 'CORRECTION_EXHAUSTED',
        detail:
          `${failing.length} required check(s) failing: ${failing.map((c) => c.id).join(', ')} — the worker holds no ` +
          'write authority over the failing target, so a further identical attempt cannot change it. ' +
          `${decision.detail}`,
      };
      const answered = applyReviewerAnswer(exhausted, evidenceFor(exhausted, {
        checks: { available: true, value: checks },
        findings: { available: true, value: findings.value },
        effects: { available: true, value: effects.value },
      }));
      if (answered === 'continue') continue;
      if (answered === 'break') break;
    }
    attempts = decision.attempt;
    lines.push(`  correcting (attempt ${attempts} of ${MAX_CORRECTION_ATTEMPTS}): ${decision.detail}`);
  }

  if (stop !== null) lines.push(...loopStopLines(stop));
  lines.push(`Evidence: ${store.evidencePath(root, sessionId)}`);
  // WHERE THE RUN ACTUALLY ENDED. A standing stop is BLOCKED; no stop is this phase's work
  // COMPLETE. Neither creates the next phase and neither authorises anything — `selectNextPhase`
  // still decides what is eligible, and B6 still owns whatever may follow an approval.
  options.onWorkState?.({
    state: stop === null ? 'COMPLETE' : 'BLOCKED',
    phaseId,
    sessionId,
    attempt: attempts,
    subjectCommit: verification.observed.head ?? null,
    lastStopCode: stop === null ? null : stop.code,
    lastStopDetail: stop === null ? null : stop.detail,
    ownerRequired: stop !== null,
  });

  return { ok: true, lines, phaseId, sessionId, stop, attempts, degraded: degradedOutcome };
}
