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
import { decideContinuation, loopStopLines, MAX_CORRECTION_ATTEMPTS, type LoopStop } from './outcome.js';
import { takeGatekeeperTurn, type GatekeeperTurnDeps } from './gatekeeperTurn.js';
import { authoriseCorrection, pathsNamedIn, within as withinPath } from './correctionBoundary.js';
import type { LedgerEntry } from '@projectos/core';
import * as store from './session.js';
import {
  digestOf,
  invocationIdFor,
  redactArgv,
  writeInvocation,
  INVOCATION_SCHEMA_VERSION,
  type InvocationFacts,
} from './invocation.js';

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

/** How much of a failing check's output the reviewer is shown. Enough to locate a failure, bounded. */
const CHECK_OUTPUT_TAIL = 4000;

function describeWorkerOutcome(o: WorkerOutcome): { refusal: string | null; line: string } {
  if (o.kind === 'refused') return { refusal: o.detail, line: `worker refused: ${o.detail}` };
  const tail = o.stderr.trim() === '' ? '' : ` — ${o.stderr.trim().split(/\r?\n/).slice(-1)[0]}`;
  return {
    refusal: o.exitCode === 0 ? null : `the worker exited ${o.exitCode}${tail}`,
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

  store.writeBrief(sys, root, sessionId, brief);

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
  /** Decisions that have already driven a correction. One decision, one correction. */
  const correctionsApplied: string[] = [];
  // Decisions already acted on IN THIS RUN. A restart re-derives the same request id, so a decision
  // that was applied once is refused as a replay rather than applied again.
  const consumedDecisionIds: string[] = [];
  let gatekeeperLedger = options.gatekeeper?.ledger ?? [];

  /**
   * Hand a stop to the reviewer and say what the loop should do next.
   *
   * Returns null when there is no reviewer, or when the stop is one the reviewer may not answer — in
   * both cases the stop stands and the run ends where it always did.
   */
  const consultGatekeeper = (candidate: LoopStop, evidenceText: string): 'retry' | 'proceed' | null => {
    const deps = options.gatekeeper;
    if (deps === undefined) return null;

    const turn = takeGatekeeperTurn(
      {
        stop: candidate,
        projectId: context.projectId,
        phaseId,
        subjectCommit: verification.observed.head ?? '',
        repositoryRoot: root,
        evidenceText,
        ownerOnlyActions: options.ownerOnlyActions ?? brief.phase.requiredOwnerGates,
        expectedDecider: options.expectedDecider ?? '',
        at: sys.now(),
      },
      { ...deps, ledger: gatekeeperLedger, consumedDecisionIds },
    );
    lines.push(...turn.lines);

    // The cost is recorded whether or not the answer was usable: the call happened.
    if (turn.ledgerEntry !== null) {
      gatekeeperLedger = [...gatekeeperLedger, turn.ledgerEntry];
      options.onGatekeeperTurn?.(turn.ledgerEntry, turn.providerResponseId);
    }
    if (turn.request !== null) consumedDecisionIds.push(`GKDEC-${turn.request.requestId}`);

    if (turn.action.kind === 'owner') {
      lines.push(...turn.action.reasons.map((r) => `  ${r}`));
      return null;
    }
    if (turn.action.kind === 'proceed') {
      lines.push(`  gatekeeper: ${turn.action.detail}`);
      return 'proceed';
    }
    lines.push(`  gatekeeper requires an amendment: ${turn.action.instruction}`);
    lastInstruction = turn.action.instruction;
    lastDecisionId = turn.request === null ? null : `GKDEC-${turn.request.requestId}`;
    return 'retry';
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

    const outcome = rejoining
      ? resolution.adapter.rejoin(sys, attemptWorker, session, brief)
      : resolution.adapter.start(sys, attemptWorker, brief, briefFile);
    const described = describeWorkerOutcome(outcome);
    lines.push(`attempt ${attempts + 1}: ${rejoining ? 'rejoined' : 'started'} ${resolution.worker.workerId}; ${described.line}`);

    session = {
      ...session,
      state: rejoining ? 'rejoined' : 'started',
      providerRef: outcome.kind === 'completed' ? outcome.providerRef ?? session.providerRef : session.providerRef,
      exitCode: outcome.kind === 'completed' ? outcome.exitCode : null,
      corrections: attempts,
    };
    store.writeSession(sys, root, session);

    // A worker that refused produces nothing to verify. Running the phase's validators anyway would
    // burn the full suite to learn what the exit code already said, and a green suite over unchanged
    // code would sit in the evidence beside a failed run looking like reassurance.
    if (described.refusal !== null) {
      stop = { code: 'WORKER_REFUSED', detail: described.refusal };
      store.writeEvidence(sys, root, { ...collectEvidence(sys, root, { sessionId, brief, checks: [] }), invocationId: invocation.invocationId });
      break;
    }

    const checks: readonly CheckResult[] = runChecks(sys, root, requiredChecks(sys, root, brief, suites.checks));
    for (const c of checks) lines.push(`  ${c.passed ? 'PASS' : 'FAIL'} ${c.kind} ${c.id}`);

    const evidence = { ...collectEvidence(sys, root, { sessionId, brief, checks }), invocationId: invocation.invocationId };
    store.writeEvidence(sys, root, evidence);

    const findings = store.readFindings(sys, root, sessionId);
    if (!findings.ok) {
      stop = { code: 'REVIEW_OUTSTANDING', detail: findings.problem };
      break;
    }
    // An attestation that is unreadable or incomplete is NOT an attestation. It is reported as the
    // absence it is, rather than as a protected effect that was never claimed — `PROTECTED_EFFECT`
    // means the run said it did something, and this run said nothing usable.
    const effects = store.readEffects(sys, root, sessionId);
    if (!effects.ok) {
      stop = { code: 'EFFECTS_NOT_ATTESTED', detail: effects.problem };
      break;
    }

    const decision = decideContinuation({
      brief,
      checks,
      findings: findings.value.findings,
      effects: effects.value,
      reviewsRecorded: findings.value.reviews,
      attemptsSpent: attempts,
      workerRefusal: described.refusal,
    });

    /**
     * What the reviewer is shown, in two clearly separated parts.
     *
     * PART A IS THE MECHANISM; PART B IS THE FAILURE. The first live Criterion 10 chain handed over
     * one undifferentiated blob: a failing fixture together with every open finding about the
     * correction machinery itself. That asks the reviewer to decide whether this architecture should
     * be used while simultaneously asking it to use it, and it answered AWAITING_OWNER - correctly,
     * on the evidence it was given. Separating them hides nothing: the worker's own review,
     * including every unresolved finding, is still carried in full under `workerReview`.
     */
    const evidenceFor = (reason: LoopStop): string =>
      JSON.stringify(
        {
          correctionMechanism: {
            what: 'a bounded correction worker, already implemented, tested and in use',
            workerWritableMaximum: correctionMaximum,
            workerMayNeverWrite: scopePaths,
            grantsIssued: 'Edit(path) and Write(path) only; no shell, so no git, no commit, no push',
            correctionsApplied: correctionsApplied.length,
            correctionBudgetRemaining: MAX_CORRECTION_ATTEMPTS - correctionsApplied.length,
            unresolvedCritical: findings.value.findings.filter((f) => !f.resolved && f.severity === 'CRITICAL').length,
            unresolvedHigh: findings.value.findings.filter((f) => !f.resolved && f.severity === 'HIGH').length,
          },
          currentFailure: {
            phaseId,
            stop: reason,
            failingChecks: checks
              .filter((c) => !c.passed)
              .map((c) => ({ id: c.id, kind: c.kind, exitCode: c.exitCode, output: c.output.slice(-CHECK_OUTPUT_TAIL) })),
            passingChecks: checks.filter((c) => c.passed).map((c) => c.id),
          },
          workerReview: { reviewsRecorded: findings.value.reviews, findings: findings.value.findings },
          effects: effects.value,
          attemptsSpent: attempts,
        },
        null,
        1,
      );

    /**
     * Take the reviewer's answer and, if it asked for a correction, authorise one.
     *
     * `continue` means a correction was authorised and another attempt should run; `break` means the
     * run ends here; `proceed` means the reviewer cleared the stop.
     */
    const applyReviewerAnswer = (reason: LoopStop): 'continue' | 'break' | 'proceed' => {
      const answer = consultGatekeeper(reason, evidenceFor(reason));
      if (answer === 'proceed') return 'proceed';
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

    if (decision.kind === 'stop') {
      // THE RELAY REMOVAL, at the one place the loop used to end. A reviewer that requires an
      // amendment sends the phase back through the SAME bounded correction budget as an ordinary
      // failing check - it does not get its own, and it cannot reset the one that exists.
      const answered = applyReviewerAnswer(decision.reason);
      if (answered === 'continue') continue;
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
      const answered = applyReviewerAnswer({
        code: 'CORRECTION_EXHAUSTED',
        detail:
          `${failing.length} required check(s) failing: ${failing.map((c) => c.id).join(', ')} — the worker holds no ` +
          'write authority over the failing target, so a further identical attempt cannot change it. ' +
          `${decision.detail}`,
      });
      if (answered === 'continue') continue;
      if (answered === 'break') break;
    }
    attempts = decision.attempt;
    lines.push(`  correcting (attempt ${attempts} of ${MAX_CORRECTION_ATTEMPTS}): ${decision.detail}`);
  }

  if (stop !== null) lines.push(...loopStopLines(stop));
  lines.push(`Evidence: ${store.evidencePath(root, sessionId)}`);
  return { ok: true, lines, phaseId, sessionId, stop, attempts };
}
