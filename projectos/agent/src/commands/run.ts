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
import { ok, fail, join } from '../context.js';
import { type Flags, str, bool } from '../flags.js';
import { runLoop, type RunResult } from '../loop/runner.js';
import { continuationLines, continueProgramme, phaseAttemptOf } from '../loop/programmeContinuation.js';
import { isDegradedOperation, DEGRADED_OPERATIONS } from '../loop/degradedMode.js';
import { loadGovernedContext, refusalLines, type GovernedContext } from '../governedContext.js';
import { selectNextPhase, selectionStopLines } from '../loop/selection.js';
import { readClosureWait } from '../closureWait.js';
import { changesSince, closureEvidencePath, gitFacts, programmeStateTailPaths, validationRecordPath } from '../closureGate.js';
import {
  loadGatekeeperConfig,
  readLedger,
  readPreviousResponseId,
  consumedDecisionIds,
  recordGatekeeperDecisionEvidence,
  admitGatekeeperSpend,
  settleUnansweredGatekeeperSpend,
  releaseUndispatchedReservation,
  settleGatekeeperSpend,
  writePreviousResponseId,
  resolveDelegatedDecider,
} from '../loop/gatekeeperConfig.js';
import { composeHostReview } from '../loop/hostReviewComposition.js';
import type { GatekeeperDecisionRecord, GatekeeperMode, HostReviewPort } from '@projectos/core';
import {
  beginWork,
  advanceWork,
  writeWorkRecord,
  type WorkRecord,
} from '../loop/workRecord.js';
import type { WorkStateReport } from '../loop/runner.js';
import type { GatekeeperTurnDeps, LoopDecisionProvenance } from '../loop/gatekeeperTurn.js';
import type { InteractiveGatekeeperDeps } from '../loop/interactiveGatekeeper.js';
import { nodeInteractivePort, resolveGatekeeperMode } from '../loop/gatekeeperHandoff.js';
import { unprovisionedResolver } from '../loop/credentialResolver.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { nodeBrokeredTransport } from '../loop/transports/brokeredHttpPort.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity, installationAllowsProject } from '../installation/projectAllowlist.js';
import { resolveBoundGit, type System } from '../system.js';
import { createLifecycleRecorder } from '../phaseProgress.js';
// A CYCLE, AND A SAFE ONE: `closure.ts` imports `run` for the after-close carry, and this imports
// `closureRequest` for the before-close hand-off. Both are only ever CALLED, never read at load time.
import { closurePrepare, closureRequest, closureResume, ownRecordsLines, type OwnerCommitWaitPorts } from './closure.js';
import { commitOwnRecordsFor } from '../loop/technicalContinuation.js';
import { GATEKEEPER_DECISIONS_REL, GATEKEEPER_LEDGER_REL, GATEKEEPER_THREAD_REL } from '../loop/gatekeeperConfig.js';
import { GATEKEEPER_INTERACTIVE_REL, INTERACTIVE_RECORD_FILENAME } from '../loop/gatekeeperHandoff.js';
import { WORK_RECORD_REL } from '../loop/workRecord.js';
import { platformStopDirOf, platformStopRefusal } from '../loop/platformStop.js';

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

/** The committed `route` value that opts an unattended project in to the trusted installation broker. */
export const INSTALLATION_BROKER_ROUTE = 'installation-broker';

/**
 * Has this project's owner OPTED IN to the trusted installation broker? — PROJECTOS-FINISH-API-GATEKEEPER1A
 * (ECC SECURITY M2). Only when `.projectops/gatekeeper.json` says `"route": "installation-broker"` BOTH in
 * the committed configuration and in the working copy. Without an explicit committed opt-in, the absence of
 * a Host block never routes a paid call anywhere: deleting one line must not quietly downgrade a project
 * from a Host-attested review to a same-user key. Never throws; anything unreadable is "not opted in".
 */
export function brokerRouteOptedIn(sys: System, root: string): boolean {
  const routeOf = (text: string | null): unknown => {
    if (text === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>)['route'] : undefined;
    } catch {
      return undefined;
    }
  };
  const committed = sys.exec('git', ['-C', root, 'show', 'HEAD:./.projectops/gatekeeper.json']);
  return (
    committed.code === 0 &&
    routeOf(committed.stdout) === INSTALLATION_BROKER_ROUTE &&
    routeOf(sys.readText(join(root, '.projectops', 'gatekeeper.json'))) === INSTALLATION_BROKER_ROUTE
  );
}

/**
 * The trusted installation broker for one governed project — the ONE composition both the loop and closure
 * use: the transport, the governed root it is asked about, and the installation's committed allowlist asked
 * on this side first, so a refusal is knowably a call that was never made. The broker resolves the key in
 * its own process; nothing here reads a credential.
 */
export function trustedBroker(sys: System, root: string, projectId: string): NonNullable<GatekeeperTurnDeps['broker']> {
  return {
    transport: nodeBrokeredTransport(sys, nodeProjectosRuntime()),
    governedRoot: root,
    installationAllows: () => installationAllowsProject(sys, nodeProjectosRuntime(), root, projectId),
  };
}

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
 * `hostReview` is the route to ProjectOSHost's attested review, composed from the committed
 * `hostReview` block (or supplied by a proof). Without one, an unattended project WAITS at its gate —
 * unless its committed configuration opts in to the trusted installation broker (`brokerRouteOptedIn`),
 * PROJECTOS-FINISH-API-GATEKEEPER1A.
 */
export function composeGatekeeper(
  ctx: CommandContext,
  opts: {
    readonly gateWaitMinutes: number;
    /** `--supersede-stale-request`: archive a stale interactive question and ask afresh. */
    readonly supersedeStale?: boolean;
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
  const recordEvidence = (record: GatekeeperDecisionRecord, provenance?: LoopDecisionProvenance): string => {
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
          ...(opts.supersedeStale === true ? { supersedeStale: true } : {}),
          ...(opts.announce === undefined ? {} : { onWaiting: opts.announce }),
        }),
        consumedDecisionIds: [],
        recordDecisionEvidence: recordEvidence,
      },
    };
  }

  // UNATTENDED: the configured provider is asked BY PROJECTOSHOST, which attests what it returned, or —
  // when the owner's committed configuration opts in — by the trusted installation broker. A
  // configuration that is present but BROKEN is a refusal — running unreviewed because the reviewer was
  // misconfigured is the failure this whole loop exists to prevent.
  const gk = loadGatekeeperConfig(ctx.sys, ctx.root);
  if (!gk.ok) {
    return { ok: false, lines: ['REFUSED (GATEKEEPER_MISCONFIGURED): a gatekeeper is configured but cannot be used.', ...gk.reasons.map((r) => `  - ${r}`)] };
  }
  // THE HOST ROUTE, ONLY WHEN THE OWNER'S COMMITTED CONFIGURATION NAMES ONE. A caller-supplied port (the
  // proofs) wins; otherwise the production client is composed from the committed `hostReview` block, and
  // with no such block NOTHING is composed — the turn then refuses before spend admission — unless the
  // committed configuration opts in to the trusted broker. Both at once is ambiguous and refused.
  let hostReview: HostReviewPort | undefined = opts.hostReview;
  if (hostReview === undefined) {
    const composedHost = composeHostReview(ctx.sys, ctx.root);
    if (composedHost.kind === 'refused') return { ok: false, lines: composedHost.lines };
    if (composedHost.kind === 'composed') hostReview = composedHost.port;
  }
  const brokerRoute = brokerRouteOptedIn(ctx.sys, ctx.root);
  if (brokerRoute && hostReview !== undefined) {
    return {
      ok: false,
      lines: [
        'REFUSED (GATEKEEPER_ROUTE_AMBIGUOUS): the committed configuration names both a ProjectOSHost review route and the',
        '  installation broker. Keep exactly one. Nothing was asked and nothing was spent.',
      ],
    };
  }
  const ledger = readLedger(ctx.sys, ctx.root);
  return {
    ok: true,
    mode: 'unattended',
    expectedDecider: gk.config.expectedDecider,
    gatekeeper: {
      // THE TRUSTED INSTALLATION BROKER, ONLY ON THE OWNER'S COMMITTED OPT-IN — PROJECTOS-FINISH-API-
      // GATEKEEPER1A (owner decision of 2026-10-25, "Route 2 now"). It is composed in the PRE-HYBRID shape:
      // no `mode`, because `mode: 'unattended'` means Host-attested and the turn refuses that mode without a
      // Host route. The broker checks the installation allowlist and this project's committed
      // secrets-handling receipt, resolves the key inside itself and makes the call; evidence from it
      // carries no Host provenance stamp, so it can never pass for a Host-attested answer. Otherwise the
      // Host route when one is configured, or nothing — and the turn waits.
      ...(brokerRoute
        ? { broker: trustedBroker(ctx.sys, ctx.root, governedProjectId(ctx)) }
        : { mode: 'unattended' as const, ...(hostReview === undefined ? {} : { hostReview }) }),
      transport: gk.config.transport,
      availability: { reachable: true },
      // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS. The resolver handed over refuses by
      // construction, so there is no in-process value even to leak: the credential is the Host's or the
      // broker's, and generated agent code running against an untrusted project never holds it.
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
        providerDispatched?: boolean,
      ) =>
        settleUnansweredGatekeeperSpend(ctx.sys, ctx.root, request.requestId, cause, providerDispatched, () =>
          readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
        ),
    },
  };
}

export function run(ctx: CommandContext, flags: Flags): CommandResult {
  // THE PLATFORM STOP, BEFORE ANYTHING ELSE. `closure resume --continue` calls this in process, past the
  // CLI gate, so the command asks for itself — and the loop asks again at every step that can act.
  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));
  if (halted !== null) return fail(2, halted);
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

  // WHICH GATEKEEPER, IN WHICH MODE — composed in one place, before anything starts: the committed Host
  // route, or the trusted installation broker on the owner's committed opt-in, or nothing — and it waits.
  const composed = composeGatekeeper(ctx, {
    gateWaitMinutes,
    supersedeStale: flags["supersede-stale-request"] === true,
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
  const runLoopOnce = (): RunResult => runLoop(ctx.sys, ctx.root, {
    platformStopStateDir: platformStopDirOf(ctx),
    onWorkState,
    workforce: true,
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
   * ONE PHASE, AND THEN THE RUN'S OWN RECORDS — PROJECTOS-FINISH-MULTIPROJECT1A.
   *
   * After an approved technical continuation the run still writes its records (the phase record, the
   * work record, the gate decision, the run's execution records, the governed current state). They
   * describe the run, not the work, and used to wait for an owner commit that reviewed nothing. When the
   * phase leaves commit and push delegated they are committed and pushed here, as ProjectOS's own — and
   * only AFTER AN APPROVED TECHNICAL CONTINUATION: the run ended with no stop, was not degraded, and its
   * own commit moved HEAD. A stopped, refused or degraded run, a dry run, or an owner-gated phase leaves
   * the tree exactly as it was (ECC SECURITY H1, ECC CODE M1).
   */
  const runOnePhase = (): RunResult => {
    const headBefore = ctx.sys.exec('git', ['-C', ctx.root, 'rev-parse', 'HEAD']).stdout.trim();
    const result = runLoopOnce();
    if (!result.ok || dryRun || result.stop !== null || result.degraded !== undefined) return result;
    const headAfter = ctx.sys.exec('git', ['-C', ctx.root, 'rev-parse', 'HEAD']).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(headAfter) || headAfter === headBefore) return result;
    return foldRunRecords(ctx, result);
  };

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
    if (continued.end === 'REFUSED') return fail(1, report);
    if (continued.end !== 'AWAITING_CLOSURE' || continued.closurePhaseId === null) return ok(report);
    return handToClosure(ctx, flags, continued.closurePhaseId, dryRun, report);
  }

  const result = runOnePhase();
  const lifecycleLines = lifecycleLinesNow();
  if (!result.ok) return fail(1, [...result.lines, ...lifecycleLines]);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok([...result.lines, ...lifecycleLines]);
}

/**
 * The run's records ProjectOS may commit as its own, by the EXACT shapes their writers produce
 * (ECC SECURITY H1): the runner's execution records `<session>.(brief|session|evidence|invocation).json`,
 * the gate decision record, the interactive question and answer, the work record, the thread pointer, the
 * spend ledger, this phase's record and the governed current state. NEVER the worker's own findings or
 * effects attestation (worker-written bytes, committed only inside a reviewed candidate), a degraded-use
 * record (the owner's commit, by its own rule), a directory, or anything else under those folders.
 */
export function isFoldableRunRecord(path: string, phaseId: string, stateTail: readonly string[]): boolean {
  const p = path.replace(/\\/g, '/');
  if (p.includes('..') || p.endsWith('/')) return false;
  const inFlat = (dir: string, name: RegExp): boolean => p.startsWith(`${dir}/`) && name.test(p.slice(dir.length + 1));
  return (
    inFlat('.projectops/execution', /^[A-Za-z0-9_.-]{1,200}\.(?:brief|session|evidence|invocation)\.json$/) ||
    inFlat(GATEKEEPER_DECISIONS_REL, /^[A-Za-z0-9_-]{4,128}\.json$/) ||
    inFlat(GATEKEEPER_INTERACTIVE_REL, INTERACTIVE_RECORD_FILENAME) ||
    [WORK_RECORD_REL, GATEKEEPER_THREAD_REL, GATEKEEPER_LEDGER_REL, `.projectops/phases/${phaseId}.json`, ...stateTail].includes(p)
  );
}

/**
 * The run's own records, committed and pushed as ProjectOS's own when the phase leaves commit and push
 * delegated — see `runOnePhase` for WHEN, and `isFoldableRunRecord` for WHICH. Nothing else, ever.
 */
export function foldRunRecords(ctx: CommandContext, result: Extract<RunResult, { ok: true }>): RunResult {
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  if (!gc.ok) return { ...result, lines: [...result.lines, '', "the run's own records: not committed — no governed context could be loaded"] };
  const stateTail = programmeStateTailPaths(gc.context);
  const outcome = commitOwnRecordsFor(ctx.sys, ctx.root, gc.context, result.phaseId, 'run-records', (p) => isFoldableRunRecord(p, result.phaseId, stateTail));
  return { ...result, lines: [...result.lines, '', ...ownRecordsLines(outcome, 'run-records')] };
}

/**
 * A FINISHED PHASE GOES TO THE EXISTING CLOSURE ROUTE — PROJECTOS-BOOT-CONTINUE1A.
 *
 * THE SAME ROUTING `projectos continue` uses (`closureRouteFor`), so the two entry points cannot
 * disagree about which closure step comes next: prepare the records, ask the closure authority, or
 * resume on the owner's commit — and a preparation that commits its records carries on into the request in
 * the same call. Each is the existing command, called as the owner would type it;
 * nothing here closes a phase, asserts an identity or supplies a decision, and `phase-closure` stays in
 * `ABSOLUTE_OWNER_ONLY`. A dry run names the step and runs nothing.
 *
 * ITS EXIT CODE IS THE RESULT. The hand-off is this invocation's last act, so a closure step that
 * refused is reported as itself.
 */
function handToClosure(
  ctx: CommandContext,
  flags: Flags,
  phaseId: string,
  dryRun: boolean,
  report: readonly string[],
): CommandResult {
  const route = closureRouteFor(ctx, phaseId);
  const command = continueRouteCommand(route);
  if (dryRun) {
    return ok([...report, '', `dry run: the closure route was not asked; the next step is \`${command}\`${carriesOn(route)}`]);
  }
  const handed = dispatchContinueRoute(ctx, flags, route, {});
  return {
    code: handed.code,
    lines: [...report, '', `handing phase ${phaseId} to the existing closure route (${command})`, ...handed.lines],
  };
}

/**
 * `projectos continue` — ONE ENTRY POINT that carries the approved programme from wherever it stands.
 * PROJECTOS-BOOT-CONTINUE1A (continuation two).
 *
 * WHAT WAS MISSING. Moving a programme on needed the operator to know which command applied now:
 * `run` for a phase with work left, `closure prepare`, `closure request` or `closure resume` for a
 * finished one, and nothing for a finished plan. Choosing wrongly cost a run or a refusal, and the
 * choice was made by reading records by hand.
 *
 * IT IS A ROUTER AND NOTHING ELSE. It asks `selectNextPhase` — the one selection authority — git, and
 * the phase's closure records, and calls the EXISTING command for that state with the caller's own
 * waits. It writes nothing itself, holds no queue, decides no closure and grants nothing: every gate the
 * routed command applies still applies, and `phase-closure` stays in `ABSOLUTE_OWNER_ONLY`.
 *
 *   phase with work left (draft … awaiting_review)    →  run --execute --continue
 *   awaiting_closure, closure records not generated    →  closure prepare --id <phase>, and — when that
 *                                                         commits its records — closure request in the
 *                                                         same call (PROJECTOS-FINISH-CONTINUE-INTEGRITY1A)
 *   awaiting_closure, records generated and committed  →  closure request --id <phase> --execute
 *   awaiting_closure, decision presented to the owner  →  closure resume --id <phase> --continue
 *   plan finished                                      →  nothing; reported complete
 *   any other stop                                     →  nothing; reported with its true reason
 *
 * `--execute` IS REQUIRED for the same reason `run` requires it. `--dry-run` names the route; for a
 * phase with work left it is a real `run --dry-run`.
 */
type ContinueRoute =
  | { readonly kind: 'run' }
  | { readonly kind: 'closure-prepare' | 'closure-request' | 'closure-resume'; readonly phaseId: string }
  | { readonly kind: 'complete'; readonly lines: readonly string[] }
  | { readonly kind: 'stopped'; readonly lines: readonly string[] }
  | { readonly kind: 'refused'; readonly lines: readonly string[] }
  | { readonly kind: 'defect'; readonly lines: readonly string[] };

/** The waits and recovery choices a routed command may receive — never an identity or an authority. */
const CONTINUE_FORWARDED_FLAGS = ['gate-wait-minutes', 'owner-wait-minutes', 'supersede-stale-request', 'worker'] as const;

function continueForwarded(flags: Flags, base: Record<string, string | boolean>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = { ...base };
  for (const key of CONTINUE_FORWARDED_FLAGS) {
    const v = flags[key];
    if (v !== undefined && v !== '') out[key] = v;
  }
  return out;
}

/**
 * Are this phase's closure records CURRENT and PASSING, so the next step is to ask the closure authority?
 *
 * Existence is not enough: records prepared at an older subject, or prepared truthfully as failing, would
 * send every later `continue` to a request G4 refuses for ever. So the records must pass, their subject
 * must be an ancestor of HEAD, and nothing but closure-tail records may have changed since it. Anything
 * else routes back to `closure prepare`, which re-establishes them from the run at the current subject.
 */
function closurePrepared(ctx: CommandContext, context: GovernedContext, phaseId: string): boolean {
  if (!gitFacts(ctx.sys, ctx.root).clean) return false;
  const text = ctx.sys.readText(closureEvidencePath(ctx.root, phaseId));
  if (text === null) return false;
  let evidence: Record<string, unknown>;
  try {
    evidence = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return false;
  }
  const subject = evidence['evidenceSubjectHead'];
  if (typeof subject !== 'string' || !/^[0-9a-f]{40}$/.test(subject)) return false;
  if (!ctx.sys.exists(validationRecordPath(ctx.root, subject))) return false;
  if (evidence['validatorsPass'] !== true || evidence['checksPass'] !== true) return false;
  const since = changesSince(ctx.sys, ctx.root, subject, programmeStateTailPaths(context));
  return since.isAncestor && since.substantive.length === 0;
}

/** Where the programme stands. Reads only. */
function continueRouteFor(ctx: CommandContext): ContinueRoute {
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  if (!gc.ok) return { kind: 'refused', lines: refusalLines(gc) };
  const selection = selectNextPhase(ctx.sys, ctx.root, gc.context);
  if (selection.kind !== 'stop') return { kind: 'run' };
  const reason = selection.reason;
  if (reason.code === 'PROGRAMME_COMPLETE') return { kind: 'complete', lines: selectionStopLines(reason) };
  if (reason.code === 'OWNER_DECISION_REQUIRED' && reason.phaseStatus === 'awaiting_closure' && reason.phaseId !== undefined) {
    return closureRouteFor(ctx, reason.phaseId);
  }
  // AN OWNER'S STOP IS A RESULT (exit 0); A DEFECT IS A REFUSAL (exit 1) — the same split `run --continue`
  // makes, so an unattended caller reads the same answer from either entry point.
  const ownersStop = reason.code === 'OWNER_DECISION_REQUIRED' || reason.code === 'PHASE_BLOCKED';
  const lines = [...selectionStopLines(reason), 'projectos continue routes to nothing past a stop: it is either the owner\'s decision or a defect'];
  return ownersStop ? { kind: 'stopped', lines } : { kind: 'defect', lines };
}

/** Which closure step a phase awaiting closure is at: prepare, request or resume. Reads only. */
function closureRouteFor(ctx: CommandContext, phaseId: string): ContinueRoute {
  const waitRead = readClosureWait(ctx.sys, ctx.root, phaseId);
  if (!waitRead.ok) return { kind: 'refused', lines: [`REFUSED (CLOSURE_WAIT_UNREADABLE): ${waitRead.problem}`] };
  if (waitRead.value !== null && waitRead.value.state === 'WAITING_OWNER') return { kind: 'closure-resume', phaseId };
  const gc = loadGovernedContext(ctx.sys, ctx.root);
  if (!gc.ok) return { kind: 'refused', lines: refusalLines(gc) };
  return closurePrepared(ctx, gc.context, phaseId) ? { kind: 'closure-request', phaseId } : { kind: 'closure-prepare', phaseId };
}

/** Run the existing command a route names, with the caller's waits and nothing else. */
function dispatchContinueRoute(
  ctx: CommandContext,
  flags: Flags,
  route: ContinueRoute,
  ownerWait: OwnerCommitWaitPorts,
): CommandResult {
  switch (route.kind) {
    case 'run':
      return run(ctx, continueForwarded(flags, { execute: true, continue: true }));
    case 'closure-prepare': {
      // ONE CONTINUE REACHES THE CLOSURE QUESTION — PROJECTOS-FINISH-CONTINUE-INTEGRITY1A (EXTERNAL-PROOF2A
      // D7). Preparation used to end the call even when it had committed its records, so the closure
      // question waited for a second `continue` that nothing in the records needed. Route ONCE more, from
      // the records as they now stand: only a preparation whose records are committed moves the route on to
      // the request, and a failure, or records left for the owner to commit, stops exactly as before.
      const prepared = closurePrepare(ctx, { id: route.phaseId });
      if (prepared.code !== 0) return prepared;
      const next = closureRouteFor(ctx, route.phaseId);
      // A RE-ROUTE THAT REFUSES IS SAID, not dropped: the preparation stands, and why nothing followed is shown.
      if (next.kind === 'refused') return { code: prepared.code, lines: [...prepared.lines, '', ...next.lines] };
      if (next.kind !== 'closure-request') return prepared;
      const asked = closureRequest(ctx, continueForwarded(flags, { id: next.phaseId, execute: true }));
      return { code: asked.code, lines: [...prepared.lines, '', `carrying on: ${continueRouteCommand(next)}`, ...asked.lines] };
    }
    case 'closure-request':
      return closureRequest(ctx, continueForwarded(flags, { id: route.phaseId, execute: true }));
    case 'closure-resume':
      return closureResume(ctx, continueForwarded(flags, { id: route.phaseId, continue: true }), ownerWait);
    case 'refused':
      return fail(2, route.lines);
    case 'defect':
      return fail(1, route.lines);
    default:
      return ok(route.lines);
  }
}

/** What a dry run adds for a preparation, which now carries on into the request once its records are committed. */
function carriesOn(route: ContinueRoute): string {
  return route.kind === 'closure-prepare' ? ', and the closure request after it once its records are committed' : '';
}

function continueRouteCommand(route: ContinueRoute): string {
  switch (route.kind) {
    case 'run':
      return 'projectos run --execute --continue';
    case 'closure-prepare':
      return `projectos closure prepare --id ${route.phaseId}`;
    case 'closure-request':
      return `projectos closure request --id ${route.phaseId} --execute`;
    case 'closure-resume':
      return `projectos closure resume --id ${route.phaseId} --continue`;
    default:
      return '(nothing to run)';
  }
}

export function continueCommand(ctx: CommandContext, flags: Flags, ownerWait: OwnerCommitWaitPorts = {}): CommandResult {
  // THE PLATFORM STOP, BEFORE THE ROUTE IS EVEN WORKED OUT — `--dry-run` included: it writes nothing now,
  // but under a stop nothing is prepared either.
  const halted = platformStopRefusal(ctx.sys, platformStopDirOf(ctx));
  if (halted !== null) return fail(2, halted);
  const dryRun = bool(flags, 'dry-run');
  const execute = bool(flags, 'execute');
  if (dryRun === execute) {
    return fail(2, [
      dryRun
        ? 'REFUSED (CONFLICTING_INTENT): --dry-run and --execute cannot both be given.'
        : 'REFUSED (NO_EXECUTION_INTENT): `continue` routes to a command that may start a worker or ask a closure question.',
      '  - `projectos continue --dry-run`  say where the programme stands and what would run, run nothing',
      '  - `projectos continue --execute`  run it',
      '',
      'Nothing was started and nothing was asked.',
    ]);
  }
  if (resolveBoundGit() === null) {
    return fail(2, [
      'REFUSED (GIT_UNAVAILABLE): ProjectOS has no bound Git executable, so where the programme stands cannot be established.',
      '  - bind one with PROJECTOS_GIT_EXE, or install Git so it is on PATH',
    ]);
  }

  const route = continueRouteFor(ctx);
  const header = `projectos continue: ${route.kind} → ${continueRouteCommand(route)}`;
  if (route.kind === 'refused') return fail(2, [header, ...route.lines]);
  if (route.kind === 'defect') return fail(1, [header, ...route.lines]);
  if (route.kind === 'complete' || route.kind === 'stopped') return ok([header, ...route.lines]);

  if (dryRun) {
    if (route.kind === 'run') {
      const r = run(ctx, continueForwarded(flags, { 'dry-run': true, continue: true }));
      return { code: r.code, lines: [header, ...r.lines] };
    }
    return ok([header, '', `dry run: nothing was run; the next step is \`${continueRouteCommand(route)}\`${carriesOn(route)}`]);
  }

  const routed = dispatchContinueRoute(ctx, flags, route, ownerWait);
  return { code: routed.code, lines: [header, ...routed.lines] };
}
