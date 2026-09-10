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
 * THE SAME GATEKEEPER `run` USES, IN THE SAME MODE. The reviewer is composed by `composeGatekeeper` from
 * the COMMITTED configuration: INTERACTIVE writes the question down for the ChatGPT gatekeeper and reads
 * its bound answer back; UNATTENDED asks only ProjectOSHost, whose attestation must vouch for the answer.
 * No mode falls back to the other, and neither reaches the pre-hybrid in-process provider call.
 *
 * IT ACTS ON THE OWNER'S DEBT, SO IT ASKS FIRST. `--execute` is required for the same reason `run`
 * requires it: on 2026-08-16 a real worker ran because starting one took no positive act. `--dry-run`
 * performs every check, prints what would be asked, and asks nothing.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A for acceptance criterion 11.
 * Brought under hybrid routing in PROJECTOS-HYBRID-CLOSURE-RECONCILE-ROUTING1A.
 */
import type { HostReviewPort } from '@projectos/core';
import type { CommandContext, CommandResult } from '../context.js';
import { ok, fail } from '../context.js';
import type { Flags } from '../flags.js';
import { loadGovernedContext } from '../governedContext.js';
import {
  admitGatekeeperSpend,
  resolveGatekeeperSpend,
  releaseUndispatchedReservation,
  settleGatekeeperSpend,
  readLedger,
  consumedDecisionIds,
} from '../loop/gatekeeperConfig.js';
import type { InteractiveDecisionPort } from '../loop/interactiveGatekeeper.js';
import { readBrokerAnsweredState } from '../installation/brokerAnsweredState.js';
import { nodeInstallationStateDir, nodeProjectosRuntime } from '../nodeRuntimeRoot.js';
import { canonicalRepositoryIdentity } from '../installation/projectAllowlist.js';
import {
  reconcileDegradedWork,
  type InteractiveReconciliationDeps,
  type ReconciliationDeps,
} from '../loop/reconciliation.js';
import { ALWAYS_OWNER_ONLY, committedGovernanceOwner } from '../loop/degradedMode.js';
import { composeGatekeeper, gateWaitMinutesFrom, GATE_WAIT_INVALID } from './run.js';

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

/**
 * Ports a TEST substitutes; the CLI dispatcher passes none. `hostReview` is the route to ProjectOSHost,
 * which this build has no client for; `interactive` replaces the composed interactive port so a test can
 * answer while the gate is held open. Neither can change the mode, which is the committed configuration's.
 */
export interface ReconcileSeams {
  readonly hostReview?: HostReviewPort;
  readonly interactive?: InteractiveDecisionPort;
}

export function reconcile(ctx: CommandContext, flags: Flags, seams: ReconcileSeams = {}): CommandResult {
  const grantId = str(flags, 'grant');
  const workId = str(flags, 'work');
  if (grantId === '' || workId === '') {
    return fail(1, [
      '`projectos reconcile` requires --grant <GRANT-ID> and --work <GKWORK-...>.',
      '  One review discharges one work item; naming the period instead of the item would let later',
      '  unnamed work hide inside an earlier blessing.',
    ]);
  }

  // POSITIVE INTENT, because this acts on the owner's debt and, in unattended mode, spends.
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
      'REFUSED (NO_EXECUTION_INTENT): `reconcile` will not put a question to the reviewer unless you say so.',
      '  - `projectos reconcile --grant <ID> --work <ID> --dry-run`  check everything, ask nothing',
      '  - `projectos reconcile --grant <ID> --work <ID> --execute`  put the question to the reviewer',
      '',
      'Nothing was asked and nothing was spent.',
    ]);
  }
  const gateWaitMinutes = gateWaitMinutesFrom(flags);
  if (gateWaitMinutes === null) return fail(2, [GATE_WAIT_INVALID, '', 'Nothing was asked and nothing was spent.']);

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

  // WHICH GATEKEEPER, IN WHICH MODE — the one composition `projectos run` uses, from the committed mode.
  const composed = composeGatekeeper(ctx, {
    gateWaitMinutes,
    ...(seams.hostReview === undefined ? {} : { hostReview: seams.hostReview }),
    announce: (where) =>
      process.stderr.write(
        `WAITING FOR THE INTERACTIVE GATEKEEPER (gate held open up to ${gateWaitMinutes} minute(s))\n` +
          `  the question: ${where.request}\n  save the decision as: ${where.decision}\n`,
      ),
  });
  if (!composed.ok) return fail(2, composed.lines);
  const gatekeeper = composed.gatekeeper;
  if (gatekeeper === undefined) {
    return fail(2, [
      'REFUSED (NO_USABLE_GATEKEEPER): reconciliation is a real review and cannot be simulated.',
      '  - this project is in INTERACTIVE mode and no valid committed delegation names the gatekeeper who answers',
    ]);
  }

  const ledger = readLedger(ctx.sys, ctx.root);
  const lines: string[] = [
    `${dryRun ? 'checking' : 'reconciling'} ${workId} under grant ${grantId}`,
    `  project ${governed.context.projectId}  phase ${phaseId}  owner ${recordedOwner}  mode ${composed.mode}`,
  ];

  let deps: ReconciliationDeps | InteractiveReconciliationDeps;
  if (gatekeeper.mode === 'interactive') {
    const record = gatekeeper.recordDecisionEvidence;
    deps = {
      mode: 'interactive',
      interactive: seams.interactive ?? gatekeeper.interactive,
      consumedDecisionIds: consumedDecisionIds(ledger),
      // THE DECISION ITSELF IS KEPT, AS EVIDENCE, stamped with the route's provenance. Grants nothing.
      ...(record === undefined
        ? {}
        : { recordDecisionEvidence: (r, provenance) => record(r, provenance ?? { kind: 'InteractiveGatekeeperDecision' }) }),
    };
  } else {
    const transport = gatekeeper.transport;
    const rate = transport === null ? undefined : gatekeeper.rateCards[transport.model];
    if (transport === null || rate === undefined) {
      return fail(2, [
        `REFUSED (NO_RATE_CARD): no rate card for model '${transport?.model ?? '<none>'}', so this call cannot be priced.`,
        '  A call whose price is unknown is not made.',
      ]);
    }
    deps = {
      mode: 'unattended',
      // The ProjectOSHost route. This build composes none, so an unattended reconciliation WAITS.
      ...(gatekeeper.hostReview === undefined ? {} : { hostReview: gatekeeper.hostReview }),
      transport: { model: transport.model, credentialRef: transport.credentialRef ?? '', transportId: transport.transportId },
      // THE CREDENTIAL IS NOT RESOLVED IN THIS PROCESS; in unattended mode it is the Host's.
      resolver: gatekeeper.resolver,
      http: gatekeeper.http,
      rate,
      budget: gatekeeper.budget,
      ledger,
      threadBinding: gatekeeper.threadBinding,
      repositoryRoot: ctx.root,
      decidedBy: gatekeeper.transportDecider,
      consumedDecisionIds: consumedDecisionIds(ledger),
      ...(gatekeeper.recordDecisionEvidence === undefined ? {} : { recordDecisionEvidence: gatekeeper.recordDecisionEvidence }),
      // Same serialised admission as `run`: a reconcile alongside a run is one of the concurrent pairs
      // C17-F1 described, and both make billable calls.
      admitSpend: (request) =>
        admitGatekeeperSpend(ctx.sys, ctx.root, request, gatekeeper.budget, () =>
          readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
        ),
      releaseUndispatched: (requestId: string) => releaseUndispatchedReservation(ctx.sys, ctx.root, requestId),
      resolveSpend: (request, cause) =>
        resolveGatekeeperSpend(ctx.sys, ctx.root, request.requestId, cause, () =>
          readBrokerAnsweredState(ctx.sys, nodeInstallationStateDir(), request),
        ),
      // Recorded the instant the call returns, so a later failure cannot lose the fact that it happened.
      // Settlement replaces the estimate admission wrote; appending would leave the estimate standing.
      recordSpend: (entry) => {
        settleGatekeeperSpend(ctx.sys, ctx.root, entry.requestId, entry);
        lines.push(`  call recorded: ${entry.requestId} (${entry.costMicroUsd} micro-USD)`);
      },
    };
  }

  const outcome = reconcileDegradedWork(
    ctx.sys,
    ctx.root,
    {
      projectId: governed.context.projectId,
      phaseId,
      grantId,
      workId,
      expectedDecider: composed.expectedDecider,
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
