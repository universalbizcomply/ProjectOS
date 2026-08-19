/**
 * Criterion 10, proven live and end to end.
 *
 * > "One automatic bounded correction cycle is proven, driven by a real validator failure and a
 * >  gatekeeper correction decision rather than by a human"
 *
 * WHAT THIS RUNS. The real `runLoop`, the real Claude Code CLI worker, the real configured checks and
 * the real OpenAI transport against the owner's real credential. Nothing here simulates a failure, a
 * decision or a correction: the only thing this script does to the repository is change ONE number in
 * a test-only fixture, and it restores it afterwards whatever happens.
 *
 * THE CHAIN, IN ORDER:
 *
 *   green baseline
 *     -> controlled harmless fixture mutation (expectedAnswer 42 -> 41)
 *     -> REAL `agent-tests` failure, run by ProjectOS, not described
 *     -> ProjectOS collects the actual failure evidence
 *     -> LIVE OpenAI gatekeeper review of that evidence
 *     -> a bound amendment naming a path
 *     -> ProjectOS validates project, phase, subject, decision and path authority
 *     -> the REAL Claude worker, granted Edit/Write on the fixture and nothing else
 *     -> the SAME check passes
 *     -> evidence returns automatically
 *     -> LIVE OpenAI follow-up review of the corrected evidence
 *
 * WHY A SCRIPT RATHER THAN `projectos run --execute`. The correction MAXIMUM is a caller input:
 * `runLoop` takes it, vetoes it against the approved phase scope, and never invents one. `run.ts`
 * does not yet derive it, and `run.ts` is outside this phase's approved implementation scope — so the
 * boundary is supplied here, from the owner's own instruction, and the gap is carry-forward.
 *
 * NO SECRET IS PRINTED. The credential is resolved by the same scoped resolver the loop uses and is
 * never held by this script.
 */
import { runLoop } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/runner.js';
import {
  loadGatekeeperConfig,
  readLedger,
  appendLedger,
  readPreviousResponseId,
  writePreviousResponseId,
  consumedDecisionIds,
} from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/gatekeeperConfig.js';
import { windowsVaultResolver } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/windowsVaultResolver.js';
import { nodeHttpPort } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/transports/nodeHttpPort.js';
import { takeGatekeeperTurn } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/gatekeeperTurn.js';
import { nodeSystem, setProcessRoot } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/system.js';
import { installNodeGovernanceEngines } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/nodeGovernanceEngines.js';
import { readCommittedReceipt, receiptIsCommitted } from 'file:///c:/dev/ProjectOS/projectos/agent/dist/loop/ownerGateReceipts.js';
import { readFileSync, writeFileSync } from 'node:fs';

installNodeGovernanceEngines();

const ROOT = 'c:/dev/ProjectOS';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const FIXTURE_REL = 'projectos/agent/test/fixtures/correction-proof-fixture.json';
const FIXTURE_ABS = `${ROOT}/${FIXTURE_REL}`;
/** The owner's instruction of 2026-08-18: this file ONLY. */
const CORRECTION_MAXIMUM = [FIXTURE_REL];

setProcessRoot(ROOT);
const sys = nodeSystem;

const say = (...a) => console.log(...a);
const readFixture = () => JSON.parse(readFileSync(FIXTURE_ABS, 'utf8'));
const writeAnswer = (n) => {
  const f = readFixture();
  writeFileSync(FIXTURE_ABS, `${JSON.stringify({ ...f, expectedAnswer: n }, null, 2)}\n`, 'utf8');
};

const ATTEMPT = process.argv[2] ?? '1';
const proof = { schemaVersion: '1.0.0', phaseId: PHASE, attempt: ATTEMPT, steps: [], ledgerBefore: null, ledgerAfter: null };
const step = (name, detail) => {
  proof.steps.push({ name, detail });
  say(`\n== ${name} ==\n${detail}`);
};

function gatekeeperDeps() {
  const gk = loadGatekeeperConfig(sys, ROOT);
  if (!gk.ok) throw new Error(`gatekeeper unusable: ${gk.reasons.join(' | ')}`);
  const ownerConfirmation =
    receiptIsCommitted(sys, ROOT, PHASE, 'secrets-handling') &&
    readCommittedReceipt(sys, ROOT, PHASE, 'secrets-handling')?.ownerChoice === 'APPROVE';
  if (!ownerConfirmation) throw new Error('no committed secrets-handling receipt; the credential stays sealed');
  const ledger = readLedger(sys, ROOT);
  return {
    config: gk.config,
    ledger,
    deps: {
      transport: gk.config.transport,
      availability: { reachable: true },
      resolver: windowsVaultResolver({ sys, root: ROOT, ownerConfirmation }),
      http: nodeHttpPort(),
      modelPolicy: gk.config.modelPolicy,
      rateCards: gk.config.rateCards,
      budget: gk.config.budget,
      ledger,
      threadBinding: gk.config.threadBinding,
      previousResponseId: readPreviousResponseId(sys, ROOT),
      transportDecider: gk.config.transportDecider,
      consumedDecisionIds: consumedDecisionIds(ledger),
    },
  };
}

let restored = false;
function restore() {
  if (restored) return;
  writeAnswer(42);
  restored = true;
  say(`\nRESTORED ${FIXTURE_REL} -> expectedAnswer ${readFixture().expectedAnswer}`);
}
process.on('exit', restore);

try {
  const before = readFixture();
  if (before.expectedAnswer !== 42) throw new Error(`baseline is not green: expectedAnswer is ${before.expectedAnswer}`);
  step('baseline', `${FIXTURE_REL} expectedAnswer = 42; the agent suite is green at this value.`);

  writeAnswer(41);
  step('controlled mutation', `expectedAnswer 42 -> ${readFixture().expectedAnswer}. Nothing else in the repository was touched.`);

  const { deps, ledger } = gatekeeperDeps();
  proof.ledgerBefore = ledger.length;

  const result = runLoop(sys, ROOT, {
    gatekeeper: deps,
    expectedDecider: loadGatekeeperConfig(sys, ROOT).config.expectedDecider,
    correctionMaximumPaths: CORRECTION_MAXIMUM,
    onGatekeeperTurn: (entry, responseId) => {
      appendLedger(sys, ROOT, entry);
      writePreviousResponseId(sys, ROOT, responseId);
    },
  });

  step('runLoop', result.lines.join('\n'));
  proof.loop = { ok: result.ok, phaseId: result.phaseId, sessionId: result.sessionId, stop: result.stop, attempts: result.attempts };

  const after = readFixture();
  proof.correctedByWorker = after.expectedAnswer === 42;
  step(
    'fixture after the loop',
    `expectedAnswer = ${after.expectedAnswer}; corrected by the governed worker: ${proof.correctedByWorker}`,
  );

  // THE FOLLOW-UP REVIEW HAPPENS ONLY IF THERE IS A CORRECTION TO REVIEW.
  //
  // The owner's instruction is explicit: if the gatekeeper refers the stop to the owner, the chain
  // STOPS - it does not go on to ask a second question. Asking anyway would spend the owner's budget
  // on a review of a correction that never happened, and would read in the evidence as though the
  // chain had continued.
  if (!proof.correctedByWorker) {
    step(
      'follow-up review NOT run',
      'the loop produced no bounded correction, so there is no corrected state to review. Per the ' +
        'owner instruction of 2026-08-18 the chain stops here rather than asking a second question.',
    );
    throw new Error('CHAIN INCOMPLETE: no bounded correction was authorised or applied');
  }

  // The corrected state has not been reviewed by anything yet, which is exactly what
  // REVIEW_OUTSTANDING names. The evidence handed over is ProjectOS's own record of the run.
  const evidencePath = `${ROOT}/.projectops/execution/${result.sessionId}.evidence.json`;
  const evidenceText = readFileSync(evidencePath, 'utf8');
  const follow = gatekeeperDeps();
  const turn = takeGatekeeperTurn(
    {
      stop: {
        code: 'REVIEW_OUTSTANDING',
        detail: 'the corrected state has not been reviewed; this is the post-correction evidence review',
      },
      projectId: 'projectos',
      phaseId: PHASE,
      subjectCommit: sys.exec('git', ['-C', ROOT, 'rev-parse', 'HEAD']).stdout.trim(),
      repositoryRoot: ROOT,
      evidenceText,
      ownerOnlyActions: ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'],
      expectedDecider: follow.config.expectedDecider,
      at: sys.now(),
    },
    follow.deps,
  );
  if (turn.ledgerEntry !== null) {
    appendLedger(sys, ROOT, turn.ledgerEntry);
    writePreviousResponseId(sys, ROOT, turn.providerResponseId);
  }
  proof.followUp = { action: turn.action, lines: turn.lines };
  step('live follow-up review', turn.lines.join('\n'));

  proof.ledgerAfter = readLedger(sys, ROOT).length;
} catch (e) {
  proof.error = String(e && e.stack ? e.stack : e);
  say(`\nFAILED: ${proof.error}`);
} finally {
  restore();
  writeFileSync(
    `${ROOT}/.projectops/evidence/${PHASE}.criterion10-live-proof-${ATTEMPT}.json`,
    `${JSON.stringify(proof, null, 2)}\n`,
    'utf8',
  );
  say(`\nProof written to .projectops/evidence/${PHASE}.criterion10-live-proof.json`);
}
