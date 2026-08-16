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
  /** Adapter registry. Injected so a test can register a worker kind without spawning a process. */
  readonly adapters?: AdapterRegistry;
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

  // The session id, and therefore every record path, is fixed before the brief is built: the worker
  // is told where to write its attestation, and the loop refuses to certify a run without one.
  const sessionId = store.sessionIdFor(
    phaseId,
    String(verification.observed.head),
    resuming ? undefined : invocationId.slice(0, 8),
  );
  if (sessionId === null) {
    return refused([
      `REFUSED (UNSAFE_PHASE_ID): phase '${phaseId}' does not make a safe record name, so this run can have no durable records`,
    ]);
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

  for (;;) {
    // Rejoin whenever a handle exists — including the one a PREVIOUS invocation recorded, which is
    // what makes `projectos run` resumable rather than restart-only. Without a handle the only
    // honest option is a fresh start, and it is said out loud rather than passed off as a reconnect.
    const rejoining = session.providerRef !== null && session.providerRef !== '';
    const outcome = rejoining
      ? resolution.adapter.rejoin(sys, resolution.worker, session, brief)
      : resolution.adapter.start(sys, resolution.worker, brief, briefFile);
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

    if (decision.kind === 'stop') {
      stop = decision.reason;
      break;
    }
    if (decision.kind === 'proceed') {
      lines.push(decision.detail);
      break;
    }
    attempts = decision.attempt;
    lines.push(`  correcting (attempt ${attempts} of ${MAX_CORRECTION_ATTEMPTS}): ${decision.detail}`);
  }

  if (stop !== null) lines.push(...loopStopLines(stop));
  lines.push(`Evidence: ${store.evidencePath(root, sessionId)}`);
  return { ok: true, lines, phaseId, sessionId, stop, attempts };
}
