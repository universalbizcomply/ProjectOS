/**
 * `projectos reconcile` — discharge one degraded-mode work item's review debt.
 *
 * WHY A SEPARATE ENTRY AND NOT A STOP. Every other gatekeeper question the loop asks is about a run
 * that is stuck: a stop code names what went wrong and `STOP_ASKS` turns it into a question. This
 * question is not that. The work already happened, the run already ended, and nothing is currently
 * failing — what remains is a debt. Forcing it into the stop vocabulary would mean inventing a stop the
 * phase is not at, and a reviewer answering a question about a state that does not exist. The subject
 * here is the degraded work RECORD, not the phase.
 *
 * ONE ITEM, NAMED. `--work` is required and takes a single workId, because `reconciliationState` clears
 * per item: a review that blessed "the degraded period" would let later unnamed work hide inside an
 * earlier blessing.
 *
 * IT SPENDS MONEY AND READS A CREDENTIAL, SO IT ASKS FIRST. `--execute` is required for the same reason
 * `run` requires it: on 2026-08-16 a real worker ran because starting one took no positive act.
 * `--dry-run` performs every check, prints what would be asked and what it would cost, and sends
 * nothing. The credential is released only by the owner's COMMITTED secrets-handling receipt, read from
 * the git object store by the same predicate the loop uses.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for acceptance criterion 11.
 */
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import type { Flags } from '../flags.js';
import { loadGovernedContext } from '../governedContext.js';
import {
  admitGatekeeperSpend,
  resolveGatekeeperSpend,
  releaseUndispatchedReservation,
  settleGatekeeperSpend,
  loadGatekeeperConfig,
  readLedger,
  consumedDecisionIds,
} from '../loop/gatekeeperConfig.js';
import { unprovisionedResolver } from '../loop/credentialResolver.js';
import { nodeBrokeredTransport } from '../loop/transports/brokeredHttpPort.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity, installationAllowsProject } from '../installation/projectAllowlist.js';
import { ownerGateReceiptRelPath, ownerApprovedSecretsHandling } from '../loop/ownerGateReceipts.js';
import { reconcileDegradedWork, type ReconciliationDeps } from '../loop/reconciliation.js';
import { ALWAYS_OWNER_ONLY, committedGovernanceOwner } from '../loop/degradedMode.js';

/** The phase in force, from the governed current-state record — the same source `run` uses. */
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

function str(flags: Flags, key: string): string {
  const v = flags[key];
  return typeof v === 'string' ? v.trim() : '';
}

function bool(flags: Flags, key: string): boolean {
  return flags[key] === true;
}

export function reconcile(ctx: CommandContext, flags: Flags): CommandResult {
  const grantId = str(flags, 'grant');
  const workId = str(flags, 'work');
  if (grantId === '' || workId === '') {
    return fail(1, [
      '`projectos reconcile` requires --grant <GRANT-ID> and --work <GKWORK-...>.',
      '  One review discharges one work item; naming the period instead of the item would let later',
      '  unnamed work hide inside an earlier blessing.',
    ]);
  }

  // POSITIVE INTENT, because this spends the owner's money and reads the owner's credential.
  const dryRun = bool(flags, 'dry-run');
  const execute = bool(flags, 'execute');
  if (dryRun && execute) {
    return fail(2, [
      'REFUSED (CONFLICTING_INTENT): --dry-run and --execute cannot both be given.',
      '  - --dry-run checks everything and asks nothing; --execute puts the question to the reviewer',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }
  if (!dryRun && !execute) {
    return fail(2, [
      'REFUSED (NO_EXECUTION_INTENT): `reconcile` will not spend or read a credential unless you say so.',
      '  - `projectos reconcile --grant <ID> --work <ID> --dry-run`  check everything, ask nothing',
      '  - `projectos reconcile --grant <ID> --work <ID> --execute`  put the question to the reviewer',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }

  const governed = loadGovernedContext(ctx.sys, ctx.root);
  if (!governed.ok) {
    return fail(2, [`REFUSED (${governed.code}): ${governed.detail}`]);
  }
  const phaseId = str(flags, 'phase') || activePhaseId(ctx) || '';
  if (phaseId === '') {
    return fail(1, ['no active phase, and none was named with --phase']);
  }

  // THE OWNER IS THE COMMITTED PLAN'S, never the grant's claim about itself.
  const recordedOwner = committedGovernanceOwner(ctx.sys, ctx.root, governed.context.planPath);
  if (recordedOwner === null) {
    return fail(2, [
      'REFUSED (NO_COMMITTED_OWNER): the plan does not name an owner in the committed tree, so the',
      '  grant’s `grantedBy` cannot be checked against anyone.',
    ]);
  }

  const stateDir = nodeInstallationStateDir();
  const repository = canonicalRepositoryIdentity(ctx.sys, ctx.root);
  if (stateDir === null || repository === null) {
    return fail(2, [
      'REFUSED (NO_DURABLE_DEGRADED_RECORD): a discharge must update the installation record that',
      '  outlives this project, and it cannot be located.',
      stateDir === null ? '  - no per-user application-data directory could be resolved' : `  - state directory: ${stateDir}`,
      repository === null ? '  - this checkout has no readable `origin` remote' : `  - repository: ${repository}`,
    ]);
  }
  const durable = { stateDir, installRoot: nodeProjectosRuntime().installRoot, repository };

  const gk = loadGatekeeperConfig(ctx.sys, ctx.root);
  if (!gk.ok) {
    return fail(2, [
      'REFUSED (NO_USABLE_GATEKEEPER): reconciliation is a real review and cannot be simulated.',
      ...gk.reasons.map((r) => `  - ${r}`),
    ]);
  }

  const rate = gk.config.rateCards[gk.config.transport.model];
  if (rate === undefined) {
    return fail(2, [
      `REFUSED (NO_RATE_CARD): no rate card for model '${gk.config.transport.model}', so this call cannot be priced.`,
      '  A call whose price is unknown is not made.',
    ]);
  }

  const ledger = readLedger(ctx.sys, ctx.root);
  const ownerConfirmation = ownerApprovedSecretsHandling(ctx.sys, ctx.root, phaseId);
  const lines: string[] = [
    `${dryRun ? 'checking' : 'reconciling'} ${workId} under grant ${grantId}`,
    `  project ${governed.context.projectId}  phase ${phaseId}  owner ${recordedOwner}`,
  ];
  if (!ownerConfirmation && !dryRun) {
    lines.push(
      '  note: no committed secrets-handling receipt approves credential use for this phase ' +
        `(${ownerGateReceiptRelPath(phaseId, 'secrets-handling') ?? 'unsafe path'}); the call will be refused`,
    );
  }

  const deps: ReconciliationDeps = {
    transport: {
      model: gk.config.transport.model,
      credentialRef: gk.config.transport.credentialRef ?? '',
      transportId: gk.config.transport.transportId,
    },
    // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS.
    //
    // The trusted installation-side broker validates the allowlist and the committed receipt,
    // resolves the value inside itself, makes the call and returns a status and a body. The
    // resolver handed over refuses by construction, so there is no in-process value even to leak.
    resolver: unprovisionedResolver(
      'the gatekeeper credential is resolved by the trusted installation broker, never in the agent',
    ),
    broker: {
      transport: nodeBrokeredTransport(ctx.sys, nodeProjectosRuntime()),
      governedRoot: ctx.root,
      // The SAME committed policy the broker enforces, asked on this side so that a refusal is
      // classified as a call that was never made rather than as one that might have been.
      installationAllows: () =>
        installationAllowsProject(ctx.sys, nodeProjectosRuntime(), ctx.root, governed.context.projectId),
    },
    http: nodeHttpPort(),
    rate,
    budget: gk.config.budget,
    ledger,
    threadBinding: gk.config.threadBinding,
    repositoryRoot: ctx.root,
    decidedBy: gk.config.transportDecider,
    consumedDecisionIds: consumedDecisionIds(ledger),
    // Same serialised admission as `run`: a reconcile alongside a run is one of the concurrent pairs
    // C17-F1 described, and both make billable calls.
    admitSpend: (request) =>
      admitGatekeeperSpend(ctx.sys, ctx.root, request, gk.config.budget, () =>
        readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
      ),
    // Recorded the instant the call returns, so a later failure cannot lose the fact that it happened.
    // Settlement replaces the estimate admission wrote; appending would leave the estimate standing.
    releaseUndispatched: (requestId: string) => releaseUndispatchedReservation(ctx.sys, ctx.root, requestId),
    resolveSpend: (
      request: { readonly requestId: string; readonly projectId: string; readonly phaseId: string },
      cause: string,
    ) =>
      resolveGatekeeperSpend(ctx.sys, ctx.root, request.requestId, cause, () =>
        readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
      ),
    recordSpend: (entry) => {
      settleGatekeeperSpend(ctx.sys, ctx.root, entry.requestId, entry);
      lines.push(`  call recorded: ${entry.requestId} (${entry.costMicroUsd} micro-USD)`);
    },
  };

  const outcome = reconcileDegradedWork(
    ctx.sys,
    ctx.root,
    {
      projectId: governed.context.projectId,
      phaseId,
      grantId,
      workId,
      expectedDecider: gk.config.expectedDecider,
      ownerOnlyActions: ALWAYS_OWNER_ONLY,
      recordedOwner,
      durable,
      at: ctx.sys.now(),
      ...(dryRun ? { prepareOnly: true } : {}),
    },
    deps,
  );

  if (outcome.kind === 'PREPARED') {
    return ok([...lines, ...outcome.reasons.map((r) => `  ${r}`)]);
  }

  if (outcome.kind === 'RECONCILED') {
    lines.push(
      `  RECONCILED ${outcome.workId} by decision ${outcome.decisionId} (${outcome.verdict})`,
      outcome.outstandingAfter.length === 0
        ? `  no work under grant ${grantId} remains outstanding (other grants are counted separately)`
        : `  still outstanding under this grant: ${outcome.outstandingAfter.join(', ')}`,
    );
    return ok(lines);
  }

  lines.push(`  NOT RECONCILED (${outcome.kind}); the debt stands:`);
  lines.push(...outcome.reasons.map((r) => `    ${r}`));
  // The reviewer's own words. Reported, never acted on — a refusal the owner cannot read is a refusal
  // the owner cannot answer.
  if (outcome.reviewerReason !== null) lines.push(`  reviewer said: ${outcome.reviewerReason}`);
  if (outcome.reviewerInstruction !== null) lines.push(`  reviewer asks: ${outcome.reviewerInstruction}`);
  if (outcome.requestId !== null && outcome.ledgerEntry === null) {
    lines.push(
      outcome.definitelyNotSent
        ? `  request ${outcome.requestId} was never sent, so nothing was spent`
        : `  request ${outcome.requestId} produced no usable answer; if it reached the provider it may ` +
          'still have been billed, and no ledger entry could be written for it',
    );
  }
  if (outcome.outstandingAfter.length > 0) {
    lines.push(`  outstanding under this grant: ${outcome.outstandingAfter.join(', ')}`);
  }
  return fail(2, lines);
}
