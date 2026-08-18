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
import { loadGovernedContext } from '../governedContext.js';
import {
  loadGatekeeperConfig,
  readLedger,
  readPreviousResponseId,
  consumedDecisionIds,
  appendLedger,
  writePreviousResponseId,
} from '../loop/gatekeeperConfig.js';
import { windowsVaultResolver } from '../loop/windowsVaultResolver.js';
import { nodeHttpPort } from '../loop/transports/nodeHttpPort.js';
import { ownerGateReceiptRelPath, receiptIsCommitted, readCommittedReceipt } from '../loop/ownerGateReceipts.js';

/**
 * Has the owner approved credential use for the active phase?
 *
 * READ FROM THE COMMITTED TREE. A receipt sitting in the working tree is a file the loop itself could
 * have written; the commit is the owner action a model cannot perform, and it is the whole of the
 * separation this record relies on.
 */
function ownerSecretsGateApproved(ctx: CommandContext): boolean {
  const phaseId = activePhaseId(ctx);
  if (phaseId === null) return false;
  if (!receiptIsCommitted(ctx.sys, ctx.root, phaseId, 'secrets-handling')) return false;
  const receipt = readCommittedReceipt(ctx.sys, ctx.root, phaseId, 'secrets-handling');
  return receipt !== null && receipt['ownerChoice'] === 'APPROVE' && receipt['gateName'] === 'secrets-handling';
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
    const ownerConfirmation = ownerSecretsGateApproved(ctx);
    const ledger = readLedger(ctx.sys, ctx.root);
    expectedDecider = gk.config.expectedDecider;
    gatekeeper = {
      transport: gk.config.transport,
      availability: { reachable: true },
      resolver: windowsVaultResolver({ sys: ctx.sys, root: ctx.root, ownerConfirmation }),
      http: nodeHttpPort(),
      modelPolicy: gk.config.modelPolicy,
      rateCards: gk.config.rateCards,
      budget: gk.config.budget,
      ledger,
      threadBinding: gk.config.threadBinding,
      previousResponseId: readPreviousResponseId(ctx.sys, ctx.root),
      consumedDecisionIds: consumedDecisionIds(ledger),
    };
  }

  const result = runLoop(ctx.sys, ctx.root, {
    ...(worker === '' ? {} : { workerId: worker }),
    dryRun,
    resume,
    ...(session === '' ? {} : { resumeSessionId: session }),
    ...(gatekeeper === undefined
      ? {}
      : {
          gatekeeper,
          expectedDecider,
          onGatekeeperTurn: (entry, responseId) => {
            appendLedger(ctx.sys, ctx.root, entry);
            writePreviousResponseId(ctx.sys, ctx.root, responseId);
          },
        }),
  });
  if (!result.ok) return fail(1, result.lines);
  // A stop is a governed outcome, not an error: the loop did its job and the next move is someone
  // else's. Only a refusal to run at all is a non-zero exit.
  return ok(result.lines);
}
