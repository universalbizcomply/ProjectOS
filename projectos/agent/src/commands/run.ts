/**
 * `projectos run` — advance the approved plan by one phase, as far as it can go without a decision.
 *
 * This is the only entry point to the execution loop, and it is deliberately thin: every refusal,
 * every choice and every record belongs to `loop/`, so the command cannot become a second place where
 * governance is decided.
 *
 * `--dry-run` prepares everything and starts nothing. It exists because "what would this do?" must be
 * answerable without doing it — the loop's whole risk is that it acts with nobody reading first.
 *
 * Created in PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import { type Flags, str, bool } from '../flags.js';
import { runLoop, type RunResult } from '../loop/runner.js';
import { continuationLines, continueProgramme, phaseAttemptOf } from '../loop/programmeContinuation.js';
import { isDegradedOperation, DEGRADED_OPERATIONS } from '../loop/degradedMode.js';
import { loadGovernedContext } from '../governedContext.js';
import {
  loadGatekeeperConfig,
  readLedger,
  readPreviousResponseId,
  consumedDecisionIds,
  recordGatekeeperDecisionEvidence,
  admitGatekeeperSpend,
  resolveGatekeeperSpend,
  releaseUndispatchedReservation,
  settleGatekeeperSpend,
  writePreviousResponseId,
  resolveDelegatedDecider,
} from '../loop/gatekeeperConfig.js';
import type { DecisionProvenanceStamp, GatekeeperDecisionRecord, GatekeeperMode, HostReviewPort } from '@projectos/core';
import {
  beginWork,
  advanceWork,
  writeWorkRecord,
  type WorkRecord,
} from '../loop/workRecord.js';
import type { WorkStateReport } from '../loop/runner.js';
import type { GatekeeperTurnDeps } from '../loop/gatekeeperTurn.js';
import type { InteractiveGatekeeperDeps } from '../loop/interactiveGatekeeper.js';
import { nodeInteractivePort, resolveGatekeeperMode } from '../loop/gatekeeperHandoff.js';
import { unprovisionedResolver } from '../loop/credentialResolver.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity } from '../installation/projectAllowlist.js';
import { resolveBoundGit } from '../system.js';
import { createLifecycleRecorder } from '../phaseProgress.js';

/** The governed project's declared id, from its own configuration. Empty when there is none. */
function governedProjectId(ctx: CommandContext): string {
  const governed = loadGovernedContext(ctx.sys, ctx.root);
  return governed.ok ? governed.context.projectId : '';
}

/** The longest an interactive run may hold the gate open waiting for the ChatGPT gatekeeper's answer. */
const MAX_GATE_WAIT_MINUTES = 240;

/**
 * How long an interactive run holds its gate open when not told otherwise.
 *
 * NOT ZERO, because zero makes interactive mode a dead end: a decision answers the exact evidence it
 * was shown, a later run asks a new question with its own evidence, so an answer has to arrive while
 * the asking run waits. `--gate-wait-minutes 0` still ends the run at the question.
 */
const DEFAULT_INTERACTIVE_GATE_WAIT_MINUTES = 60;

/**
 * `--gate-wait-minutes`, or null when it is not a whole number in range. One parser for every command
 * that asks an interactive gatekeeper question — `run`, `closure request` and `reconcile`.
 */
export function gateWaitMinutesFrom(flags: Flags): number | null {
  const raw = str(flags, 'gate-wait-minutes');
  const minutes = raw === '' ? DEFAULT_INTERACTIVE_GATE_WAIT_MINUTES : Number(raw);
  return Number.isInteger(minutes) && minutes >= 0 && minutes <= MAX_GATE_WAIT_MINUTES ? minutes : null;
}

/** The refusal every such command gives for an unusable `--gate-wait-minutes`. */
export const GATE_WAIT_INVALID = `REFUSED (GATE_WAIT_INVALID): --gate-wait-minutes takes a whole number from 0 to ${MAX_GATE_WAIT_MINUTES}.`;

/** The gatekeeper a run is handed, or the refusal that stops it before anything starts. */
export type GatekeeperComposition =
  | {
      readonly ok: true;
      readonly mode: GatekeeperMode;
      readonly gatekeeper: GatekeeperTurnDeps | InteractiveGatekeeperDeps | undefined;
      readonly expectedDecider: string;
    }
  | { readonly ok: false; readonly lines: readonly string[] };

/**
 * Compose this project's gatekeeper for ITS mode — the one place either mode is assembled.
 *
 * THE MODE COMES FROM THE COMMITTED CONFIGURATION, before anything else about the reviewer is read. A
 * configured project that declares no mode is refused rather than assigned one, and a working-copy edit
 * cannot switch it; see `gatekeeperHandoff.ts`.
 *
 * `hostReview` is the route to ProjectOSHost's attested review. `projectos run` supplies none, because
 * this build has no agent-side Host client: an unattended project therefore WAITS at its gate. It is a
 * parameter so that client plugs in here when it exists — and so the vertical-slice proof drives this
 * exact composition with a deterministic fake provider behind the port.
 */
export function composeGatekeeper(
  ctx: CommandContext,
  opts: {
    readonly gateWaitMinutes: number;
    readonly hostReview?: HostReviewPort;
    readonly announce?: (where: { readonly request: string; readonly decision: string }) => void;
  },
): GatekeeperComposition {
  const modeResolution = resolveGatekeeperMode(ctx.sys, ctx.root);
  if (!modeResolution.ok) {
    return {
      ok: false,
      lines: [
        'REFUSED (GATEKEEPER_MODE_UNRESOLVED): which gatekeeper answers this project cannot be established.',
        ...modeResolution.reasons.map((r) => `  - ${r}`),
        '',
        'Nothing was prepared and nothing was started.',
      ],
    };
  }
  // THE DECISION ITSELF IS KEPT, AS EVIDENCE, stamped with the route's provenance. The ledger records
  // that a call happened; this records what was decided. It grants nothing — see
  // `recordGatekeeperDecisionEvidence`. One writer for both modes.
  const recordEvidence = (record: GatekeeperDecisionRecord, provenance?: DecisionProvenanceStamp): string => {
    const outcome = recordGatekeeperDecisionEvidence(ctx.sys, ctx.root, record, provenance);
    return outcome.kind === 'written' || outcome.kind === 'already-recorded' ? outcome.kind : `${outcome.kind}: ${outcome.detail}`;
  };

  if (modeResolution.mode === 'interactive') {
    // INTERACTIVE: the ChatGPT gatekeeper answers through the owner. No transport, model, price or
    // credential is involved — only the decider the owner's COMMITTED delegation names. With no valid
    // delegation there is no gatekeeper to ask, and the loop stops for the owner exactly as it always has.
    const governed = loadGovernedContext(ctx.sys, ctx.root);
    const planProgramme = governed.ok ? governed.context.plan['programmeId'] : undefined;
    const programmeId = typeof planProgramme === 'string' ? planProgramme.trim() : '';
    const delegate = programmeId === '' ? null : resolveDelegatedDecider(ctx.sys, ctx.root, programmeId);
    if (delegate === null || !delegate.ok) return { ok: true, mode: 'interactive', gatekeeper: undefined, expectedDecider: '' };
    return {
      ok: true,
      mode: 'interactive',
      expectedDecider: delegate.decider,
      gatekeeper: {
        mode: 'interactive',
        interactive: nodeInteractivePort(ctx.sys, ctx.root, {
          waitMs: opts.gateWaitMinutes * 60_000,
          ...(opts.announce === undefined ? {} : { onWaiting: opts.announce }),
        }),
        consumedDecisionIds: [],
        recordDecisionEvidence: recordEvidence,
      },
    };
  }

  // UNATTENDED: the configured provider is asked BY PROJECTOSHOST, which attests what it returned. A
  // configuration that is present but BROKEN is a refusal — running unreviewed because the reviewer was
  // misconfigured is the failure this whole loop exists to prevent.
  const gk = loadGatekeeperConfig(ctx.sys, ctx.root);
  if (!gk.ok) {
    return { ok: false, lines: ['REFUSED (GATEKEEPER_MISCONFIGURED): a gatekeeper is configured but cannot be used.', ...gk.reasons.map((r) => `  - ${r}`)] };
  }
  const ledger = readLedger(ctx.sys, ctx.root);
  return {
    ok: true,
    mode: 'unattended',
    expectedDecider: gk.config.expectedDecider,
    gatekeeper: {
      mode: 'unattended',
      // The in-process provider call is never made in this mode: with no Host route, the turn waits.
      ...(opts.hostReview === undefined ? {} : { hostReview: opts.hostReview }),
      transport: gk.config.transport,
      availability: { reachable: true },
      // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS. The resolver handed over refuses by
      // construction, so there is no in-process value even to leak: in unattended mode the credential is
      // the Host's, and generated agent code running against an untrusted project never holds it.
      resolver: unprovisionedResolver('the gatekeeper credential is resolved on the Host side, never in the agent'),
      http: nodeHttpPort(),
      modelPolicy: gk.config.modelPolicy,
      rateCards: gk.config.rateCards,
      budget: gk.config.budget,
      ledger,
      threadBinding: gk.config.threadBinding,
      transportDecider: gk.config.transportDecider,
      consumedDecisionIds: consumedDecisionIds(ledger),
      recordDecisionEvidence: recordEvidence,
      // THE ONLY PLACE THAT MAY TOUCH THE FILESYSTEM SUPPLIES THE ADMISSION.
      //
      // `ledger` above is a snapshot, and a snapshot cannot bound concurrent spend. This port re-reads
      // the ledger under an exclusive lock, decides against the hard stop, and records the estimate
      // before the call is allowed to happen — so a second process is refused rather than paying in
      // parallel. C17-F1.
      admitSpend: (request: {
        readonly requestId: string;
        readonly projectId: string;
        readonly phaseId: string;
        readonly model: string;
        readonly estimateMicroUsd: number;
        readonly at: string;
      }) =>
        admitGatekeeperSpend(ctx.sys, ctx.root, request, gk.config.budget, () =>
          readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
        ),
      // The other half of admission: when the call produced no answer, the reservation it wrote is
      // released or retained here rather than left standing (C11-W2-F6).
      releaseUndispatched: (requestId: string) => releaseUndispatchedReservation(ctx.sys, ctx.root, requestId),
      resolveSpend: (
        request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
        cause: string,
      ) =>
        resolveGatekeeperSpend(ctx.sys, ctx.root, request.requestId, cause, () =>
          readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
        ),
    },
  };
}

export function run(ctx: CommandContext, flags: Flags): CommandResult {
  const worker = str(flags, 'worker');
  const dryRun = bool(flags, 'dry-run');
  const execute = bool(flags, 'execute');

  // LIVE EXECUTION REQUIRES POSITIVE INTENT, and this is why.
  //
  // `dryRun: bool(flags, 'dry-run')` made LIVE the default: a bare `projectos run` started a real
  // worker, so the difference between preparing and spawning was the ABSENCE of a flag. That is the
  // wrong way round for the most consequential thing this CLI does, and on 2026-08-16 a real worker
  // ran against Dead Aisle with no attributable invocation — a run nobody could account for
  // afterwards, because starting one took no positive act.
  if (dryRun && execute) {
    return fail(2, [
      'REFUSED (CONFLICTING_INTENT): --dry-run and --execute cannot both be given.',
      '  - --dry-run prepares and validates; --execute starts a real worker',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }
  if (!dryRun && !execute) {
    return fail(2, [
      'REFUSED (NO_EXECUTION_INTENT): `run` will not start a worker unless you say so.',
      '  - `projectos run --dry-run`  prepare and validate, spawn nothing',
      '  - `projectos run --execute`  start the authorised worker for real',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  const resume = bool(flags, 'resume');
  /**
   * CARRY THE PROGRAMME, rather than stopping after one phase.
   *
   * The flag is what removes "type continue" from between two phases. Opt-in, so every existing
   * caller behaves exactly as it did, and because starting a programme that will carry itself is a
   * decision worth making explicitly rather than inheriting. It grants nothing: see
   * `loop/programmeContinuation.ts` for what still stops it.
   */
  const carryProgramme = bool(flags, 'continue');
  const session = str(flags, 'session');
  if (resume && session === '') {
    return fail(2, [
      'REFUSED (NO_SESSION_NAMED): `--resume` continues one named session and will not guess which.',
      '  - `projectos run --execute --resume --session <sessionId>`',
      '  - the id is on the run you are continuing; its records are in .projectops/execution/',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  // THE ORACLE MUST ANSWER BEFORE ANY GOVERNANCE FACT IS REPORTED.
  //
  // Almost everything below is decided from COMMITTED bytes, and every one of those reads asks git.
  // `readCommittedJson` returns null when it cannot ask -- and its ten callers each read that null as
  // a fact about the record: "declares no programmeId", "no delegation names a decider", "no committed
  // plan". With git merely missing, ProjectOS would report a cascade of governance findings that are
  // all false, and send the owner looking for a delegation problem that does not exist. Observed:
  // a run refused with "the committed .projectops/gatekeeper.json declares no programmeId" against a
  // file that declares one on the very commit being run.
  //
  // So the oracle's absence is stated once, as itself. This does not make the downstream messages
  // defensive -- it makes them TRUE, because past this point git demonstrably answered.
  if (resolveBoundGit() === null) {
    return fail(2, [
      'REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so no repository fact can be established.',
      '  - every governed record is read from COMMITTED bytes, and git is what reads them',
      '  - this is NOT a finding about your plan, delegation or gatekeeper configuration: none of them were read',
      '  - bind one with PROJECTOS_GIT_EXE, or install Git so it is on PATH',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  const gateWaitMinutes = gateWaitMinutesFrom(flags);
  if (gateWaitMinutes === null) {
    return fail(2, [GATE_WAIT_INVALID, '', 'Nothing was prepared and nothing was started.']);
  }

  // WHICH GATEKEEPER, IN WHICH MODE — composed in one place, before anything starts. No Host route is
  // supplied: this build has no agent-side ProjectOSHost client, so an unattended project waits.
  const composed = composeGatekeeper(ctx, {
    gateWaitMinutes,
    // A waiting run returns nothing until it ends, so where to answer is said the moment it starts.
    announce: (where) =>
      process.stderr.write(
        `WAITING FOR THE INTERACTIVE GATEKEEPER (gate held open up to ${gateWaitMinutes} minute(s))\n` +
          `  the question: ${where.request}\n  save the decision as: ${where.decision}\n`,
      ),
  });
  if (!composed.ok) return fail(2, composed.lines);
  const { gatekeeper, expectedDecider } = composed;

  // CONTINUING WITHOUT A REVIEWER, ON THE OWNER'S COMMITTED RISK.
  //
  // OFF UNLESS ASKED FOR, BY NAME. Without `--degraded-grant` this stays undefined and the loop
  // behaves exactly as it always has: the reviewer being unreachable ends the run at the owner's
  // three choices. Nothing about an outage enables this on its own — an unreachable gatekeeper is
  // not consent, and the flag is not consent either. It names WHICH committed grant to look for,
  // and if no such grant is committed, nothing is authorised and no work happens.
  //
  // THE FLAG CARRIES NO AUTHORITY. There is deliberately no `--owner`, no `--committed`, no
  // `--grant-valid`, and no way to pass an operation outside the closed vocabulary. The owner, the
  // project, the phase, the subject commit and the outage identity are all derived from governed
  // state inside the loop; a caller can point at a grant, and nothing more.
  const degradedGrant = str(flags, 'degraded-grant');
  const degradedOperation = str(flags, 'degraded-operation') || 'implement';
  if (degradedGrant !== '' && !isDegradedOperation(degradedOperation)) {
    return fail(2, [
      `REFUSED (DEGRADED_OPERATION_UNKNOWN): '${degradedOperation}' is not something degraded mode can do.`,
      `  - permitted: ${DEGRADED_OPERATIONS.join(', ')}`,
      '  - degraded mode is a bounded authority, not a way to run an arbitrary command unreviewed',
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  // WHERE THE INSTALLATION RECORDS WHAT DEGRADED MODE SPENDS.
  //
  // Composed here, at the entrypoint, because this is the only layer that may consult the ambient
  // environment. Without all three facts there is no durable record to write, and degraded mode is
  // refused rather than run against a project-local file that a `rm` would erase.
  const stateDir = nodeInstallationStateDir();
  const repository = canonicalRepositoryIdentity(ctx.sys, ctx.root);
  const durable =
    stateDir === null || repository === null
      ? null
      : { stateDir, installRoot: nodeProjectosRuntime().installRoot, repository };
  if (degradedGrant !== '' && durable === null) {
    return fail(2, [
      'REFUSED (NO_DURABLE_DEGRADED_RECORD): degraded mode records what it spends outside the governed',
      '  project, and this machine gives no such location or this checkout has no readable `origin`.',
      stateDir === null ? '  - no per-user application-data directory could be resolved' : `  - state directory: ${stateDir}`,
      repository === null ? '  - this checkout has no readable `origin` remote' : `  - repository: ${repository}`,
      '',
      'Nothing was prepared and nothing was started.',
    ]);
  }

  // DURABLE WORK STATE. The only place that may touch the filesystem supplies the writing, exactly
  // as it does for the spend ledger and the decision evidence — `runLoop` owns no durability.
  //
  // The record is EVIDENCE OF PROGRESS, never permission for any of it: nothing reads it back to
  // decide what the loop may do, and a `GATE_APPROVED` written here authorises nothing.
  //
  // Identity is fixed at the first report and never moved. A progression cannot carry a checkpoint
  // to another project or phase; a different phase is a different work item, started fresh.
  //
  // The project's OWN declared id, from its committed configuration — the same source every other
  // governed fact comes from. An empty id means there is no governed context to belong to, and
  // nothing is written: a checkpoint that cannot name its project is one another project could
  // later mistake for its own.
  const workProjectId = governedProjectId(ctx);
  let work: WorkRecord | null = null;
  const onWorkState = (progress: WorkStateReport): void => {
    if (workProjectId === '') return;
    const at = ctx.sys.now();
    if (work === null || work.phaseId !== progress.phaseId) {
      work = beginWork({
        projectId: workProjectId,
        phaseId: progress.phaseId,
        subjectCommit: progress.subjectCommit ?? null,
        at,
      });
    }
    const { state, phaseId: _phaseId, ...rest } = progress;
    work = advanceWork(work, { state, ...rest }, at);
    writeWorkRecord(ctx.sys, ctx.root, work);
    recordLifecycle(progress);
  };

  // THE SAME PROGRESS, WRITTEN WHERE THE PLAN CAN SEE IT.
  //
  // `work.v1` is the loop's own checkpoint and nothing else reads it for lifecycle. The canonical
  // phase record is what `syncCurrentState` recomputes the owner's plan screen from, and until now
  // the loop never wrote one — so a phase could run to completion, commit and push while the plan
  // still read `0 of 4 - PLAN READY`. See `phaseProgress.ts` for what this may and may not record;
  // in particular it can never close a phase.
  //
  // A failure to record is NOT a failure of the run: the work happened either way, and refusing to
  // report it because its bookkeeping failed would be the worse outcome. It is always surfaced.
  const lifecycleContext = loadGovernedContext(ctx.sys, ctx.root);
  const lifecycle =
    lifecycleContext.ok
      ? createLifecycleRecorder(ctx.sys, ctx.root, lifecycleContext.context, workProjectId)
      : null;
  const recordLifecycle = (progress: WorkStateReport): void => lifecycle?.record(progress);

  /**
   * ONE PHASE, THE WAY IT HAS ALWAYS RUN — now callable more than once.
   *
   * Nothing inside changed. Continuation re-enters this exact path, so every phase it carries gets
   * the same Doctor preflight, the same worker grants, the same checks, reviews and owner-only floor,
   * and the same budget admission. It adds no way to run a phase that did not exist before it.
   *
   * THE LEDGER SNAPSHOT IS DELIBERATELY NOT REBUILT PER PHASE, and that is safe because it is not
   * what admits spend: `admitSpend` below re-reads the ledger under an exclusive lock for every
   * request. The snapshot only feeds the reported status, so a second phase cannot spend against a
   * first phase's stale view of the money.
   */
  const runOnePhase = (): RunResult => runLoop(ctx.sys, ctx.root, {
    onWorkState,
    ...(worker === '' ? {} : { workerId: worker }),
    dryRun,
    resume,
    ...(session === '' ? {} : { resumeSessionId: session }),
    ...(degradedGrant === '' || !isDegradedOperation(degradedOperation) || durable === null
      ? {}
      : { degradedMode: { grantId: degradedGrant, operation: degradedOperation, durable } }),
    ...(gatekeeper === undefined
      ? {}
      : {
          gatekeeper,
          expectedDecider,
          onGatekeeperTurn: (entry, responseId) => {
            // SETTLE, DO NOT APPEND. Admission already wrote this request id at its estimate; appending
            // the truth beside it would leave the estimate standing, because the ledger keeps the first
            // entry it sees for a request id.
            settleGatekeeperSpend(ctx.sys, ctx.root, entry.requestId, entry);
            writePreviousResponseId(ctx.sys, ctx.root, responseId);
          },
        }),
  });

  /**
   * ONE PHASE, OR THE PROGRAMME — and the difference is a flag the owner sets when starting it.
   *
   * `--continue` is what removes "type continue" from between two phases. It is opt-in so that every
   * existing caller behaves exactly as it did, and because starting a programme that will carry
   * itself is a decision worth making explicitly rather than inheriting.
   *
   * IT GRANTS NOTHING. `continueProgramme` can only decide whether to ASK for another phase; it stops
   * on any stop, on no progress, and at a hard bound. See `programmeContinuation.ts`.
   */
  const lifecycleLinesNow = (): readonly string[] => {
    const problems =
      lifecycle === null
        ? ['no governed context could be loaded, so the phase record was not updated from this run']
        : lifecycle.problems();
    return problems.length === 0
      ? []
      : ['', 'The phase record was not fully updated (the work itself is unaffected):', ...problems.map((p) => `  - ${p}`)];
  };

  if (carryProgramme) {
    const continued = continueProgramme({ runPhase: () => phaseAttemptOf(runOnePhase()) });
    const report = [...continued.lines, ...continuationLines(continued), ...lifecycleLinesNow()];
    // REFUSED is the one continuation end that is not a governed outcome: nothing ran at all.
    return continued.end === 'REFUSED' ? fail(1, report) : ok(report);
  }

  const result = runOnePhase();
  const lifecycleLines = lifecycleLinesNow();
  if (!result.ok) return fail(1, [...result.lines, ...lifecycleLines]);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok([...result.lines, ...lifecycleLines]);
}
