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
import { runLoop } from '../loop/runner.js';
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
} from '../loop/gatekeeperConfig.js';
import type { GatekeeperDecisionRecord } from '@projectos/core';
import { unprovisionedResolver } from '../loop/credentialResolver.js';
import { nodeBrokeredTransport } from '../loop/transports/brokeredHttpPort.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity, installationAllowsProject } from '../installation/projectAllowlist.js';
import { resolveBoundGit } from '../system.js';

/** The governed project's declared id, from its own configuration. Empty when there is none. */
function governedProjectId(ctx: CommandContext): string {
  const governed = loadGovernedContext(ctx.sys, ctx.root);
  return governed.ok ? governed.context.projectId : '';
}

/**
 * The phase the governed state says is active. Never a caller's claim.
 *
 * Read through `loadGovernedContext` so the path comes from the project's own configuration rather
 * than from a guess about where state lives — an earlier version of this function looked in
 * `.projectops/`, where this project's current-state file is not.
 */
function activePhaseId(ctx: CommandContext): string | null {
  const governed = loadGovernedContext(ctx.sys, ctx.root);
  if (!governed.ok) return null;
  const statePath = governed.context.currentStatePath;
  if (statePath === null) return null;
  const text = ctx.sys.readText(statePath);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const id = parsed['activePhase'];
    return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
  } catch {
    return null;
  }
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

  // THE REVIEWER, WHEN ONE IS CONFIGURED.
  //
  // Absent configuration is not an error: the loop then stops for the owner exactly as it always did,
  // which is right for every project that has not opted in. A configuration that is present but
  // BROKEN is a refusal — running unreviewed because the reviewer was misconfigured is the failure
  // this whole phase exists to prevent.
  const gk = loadGatekeeperConfig(ctx.sys, ctx.root);
  if (!gk.ok && !('absent' in gk)) {
    return fail(2, ['REFUSED (GATEKEEPER_MISCONFIGURED): a gatekeeper is configured but cannot be used.', ...gk.reasons.map((r) => `  - ${r}`)]);
  }

  let gatekeeper;
  let expectedDecider = '';
  if (gk.ok) {
    // Credential release needs the owner's committed secrets-handling receipt. It is read from the
    // git object store, never from the working tree, and never asserted by the loop about itself.
    const ledger = readLedger(ctx.sys, ctx.root);
    expectedDecider = gk.config.expectedDecider;
    gatekeeper = {
      transport: gk.config.transport,
      availability: { reachable: true },
      // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS.
      //
      // The trusted installation-side broker validates the allowlist and the committed receipt,
      // resolves the value inside itself, makes the call and returns a status and a body. The resolver
      // handed over refuses by construction, so there is no in-process value even to leak — which is
      // the point: generated agent code running against an untrusted project should not be holding
      // the installation owner's key.
      resolver: unprovisionedResolver(
        'the gatekeeper credential is resolved by the trusted installation broker, never in the agent',
      ),
      broker: {
        transport: nodeBrokeredTransport(ctx.sys, nodeProjectosRuntime()),
        governedRoot: ctx.root,
        // The SAME committed policy the broker enforces, asked on this side so that a refusal is
        // classified as a call that was never made rather than as one that might have been.
        installationAllows: () =>
          installationAllowsProject(ctx.sys, nodeProjectosRuntime(), ctx.root, governedProjectId(ctx)),
      },
      http: nodeHttpPort(),
      modelPolicy: gk.config.modelPolicy,
      rateCards: gk.config.rateCards,
      budget: gk.config.budget,
      ledger,
      threadBinding: gk.config.threadBinding,
      previousResponseId: readPreviousResponseId(ctx.sys, ctx.root),
      transportDecider: gk.config.transportDecider,
      consumedDecisionIds: consumedDecisionIds(ledger),
      // THE DECISION ITSELF IS KEPT, AS EVIDENCE. The ledger records that a call happened and what
      // it cost; it has never recorded what was decided. Supplied here for the same reason as
      // `admitSpend`: this is the only place that may touch the filesystem. It grants nothing — see
      // `recordGatekeeperDecisionEvidence`.
      recordDecisionEvidence: (record: GatekeeperDecisionRecord) => {
        const outcome = recordGatekeeperDecisionEvidence(ctx.sys, ctx.root, record);
        return outcome.kind === 'written' || outcome.kind === 'already-recorded'
          ? outcome.kind
          : `${outcome.kind}: ${outcome.detail}`;
      },
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
    };
  }

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

  const result = runLoop(ctx.sys, ctx.root, {
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
  if (!result.ok) return fail(1, result.lines);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok(result.lines);
}
