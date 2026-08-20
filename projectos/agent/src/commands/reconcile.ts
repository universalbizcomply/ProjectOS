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
  appendLedger,
  loadGatekeeperConfig,
  readLedger,
  consumedDecisionIds,
} from '../loop/gatekeeperConfig.js';
import { windowsVaultResolver } from '../loop/windowsVaultResolver.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
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
    resolver: windowsVaultResolver({ sys: ctx.sys, root: ctx.root, ownerConfirmation }),
    http: nodeHttpPort(),
    rate,
    budget: gk.config.budget,
    ledger,
    threadBinding: gk.config.threadBinding,
    repositoryRoot: ctx.root,
    decidedBy: gk.config.transportDecider,
    consumedDecisionIds: consumedDecisionIds(ledger),
    // Recorded the instant the call returns, so a later failure cannot lose the fact that it happened.
    recordSpend: (entry) => {
      appendLedger(ctx.sys, ctx.root, entry);
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
