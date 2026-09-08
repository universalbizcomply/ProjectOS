/**
 * THE REAL CANONICAL IMPLEMENTATION, DRIVEN FROM A TEST.
 *
 * This is not a model of `admitGatekeeperSpend` and not a re-implementation of it: it imports the
 * compiled `projectos/agent/dist/loop/gatekeeperConfig.js` and calls it. That is the whole point of
 * the file — §10D's claim is that the Host and the agent are two clients of ONE ledger protocol, and
 * a claim like that can only be checked by running both against the same bytes.
 *
 * NOTHING REAL IS TOUCHED. Every root this is given is a disposable directory the Rust test created
 * under the system temporary directory. No provider is contacted, no credential is read, and the
 * only files written are the ledger and the lock inside that disposable root.
 *
 * Usage:  node canonical_driver.mjs <agent-dist> <op> [args...]
 *   admit   <root> <requestId> <projectId> <phaseId> <model> <estimateMicroUsd> <atIso> <hardStop> <warnAt>
 *   settle  <root> <requestId> <inputTokens> <outputTokens> <costMicroUsd>
 *   release <root> <requestId>
 *   read    <root>
 *   policy  <configPath>
 *   holdlock <root> <milliseconds>
 *
 * Every op prints one line of JSON on stdout and exits 0; a refusal is data, not an exit code.
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const [, , agentDist, op, ...rest] = process.argv;

const importFrom = (relative) => import(pathToFileURL(join(agentDist, relative)).href);

const { nodeSystem } = await importFrom('system.js');
const {
  admitGatekeeperSpend,
  settleGatekeeperSpend,
  releaseUndispatchedReservation,
  readLedger,
  GATEKEEPER_LEDGER_LOCK_REL,
} = await importFrom('loop/gatekeeperConfig.js');

const say = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

switch (op) {
  case 'admit': {
    const [root, requestId, projectId, phaseId, model, estimate, at, hardStop, warnAt] = rest;
    const result = admitGatekeeperSpend(
      nodeSystem,
      root,
      {
        requestId,
        projectId,
        phaseId,
        model,
        estimateMicroUsd: Number(estimate),
        at,
      },
      { hardStopAtMicroUsd: Number(hardStop), warnAtMicroUsd: Number(warnAt) },
      // The installation's broker record. `not-answered` is the only value that lets an existing
      // reservation be re-asked; the Host has no broker record at all and therefore always refuses,
      // which is the direction the cross-implementation test asserts.
      () => 'not-answered',
    );
    say(result);
    break;
  }
  case 'settle': {
    const [root, requestId, inputTokens, outputTokens, costMicroUsd] = rest;
    const existing = readLedger(nodeSystem, root).find((e) => e.requestId === requestId);
    if (existing === undefined) {
      say({ settled: false, reason: 'no such entry' });
      break;
    }
    settleGatekeeperSpend(nodeSystem, root, requestId, {
      requestId,
      projectId: existing.projectId,
      phaseId: existing.phaseId,
      model: existing.model,
      usage: { inputTokens: Number(inputTokens), cachedInputTokens: 0, outputTokens: Number(outputTokens) },
      costMicroUsd: Number(costMicroUsd),
      at: existing.at,
    });
    say({ settled: true });
    break;
  }
  case 'release': {
    const [root, requestId] = rest;
    releaseUndispatchedReservation(nodeSystem, root, requestId);
    say({ released: true });
    break;
  }
  case 'read': {
    const [root] = rest;
    say(readLedger(nodeSystem, root));
    break;
  }
  case 'policy': {
    const [configPath] = rest;
    // THE SCOPE COMES FROM THE CANONICAL PACKAGE, NOT FROM A STRING TYPED HERE. A literal would be a
    // second place the value lives, and a second place is how this driver drifted from production in
    // the first place. Raised by the ECC security review as the structural half of that defect: the
    // filter below is still a transcription of `loadGatekeeperConfig`'s, but the value it compares
    // against can no longer disagree with the one the agent uses.
    const { checkPilotBudget, BUDGET_RAISE_SCOPE } = await importFrom('../../core/dist/index.js');
    if (typeof BUDGET_RAISE_SCOPE !== 'string' || BUDGET_RAISE_SCOPE === '') {
      // FAIL LOUDLY RATHER THAN FILTER ON `undefined`, which would silently match nothing and make
      // every policy look unenforceable — a green test proving the opposite of what it claims.
      say({ problems: ['the canonical package exported no BUDGET_RAISE_SCOPE'] });
      break;
    }
    let raw;
    try {
      raw = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch (error) {
      say({ problems: [`unreadable configuration: ${String(error)}`] });
      break;
    }
    const budget = raw?.budget ?? {};
    const authorities = Array.isArray(raw?.budgetRaiseAuthorities) ? raw.budgetRaiseAuthorities : [];
    const problems = [
      ...(raw?.schemaVersion === '1.0.0' ? [] : ['schemaVersion is not 1.0.0']),
      ...(raw?.enabled === true ? [] : ['the gatekeeper is not enabled']),
      ...checkPilotBudget(
        {
          initialCreditMicroUsd: budget.initialCreditMicroUsd,
          warnAtMicroUsd: budget.warnAtMicroUsd,
          hardStopAtMicroUsd: budget.hardStopAtMicroUsd,
          autoRecharge: budget.autoRecharge,
          raisedByOwnerDecisionId: budget.raisedByOwnerDecisionId,
        },
        // EXACTLY THE FILTER `loadGatekeeperConfig` APPLIES, transcribed from
        // `projectos/agent/src/loop/gatekeeperConfig.ts` — including the scope check, whose absence
        // here made this driver a copy of a MISREADING of the canonical rule rather than a witness to
        // it, so the cross-implementation test compared two implementations of the same mistake.
        // `checkPilotBudget` alone is not the canonical rule; this call site plus that function is.
        // Raised by the ECC security re-review.
        //
        // IT IS STILL A TRANSCRIPTION, and that is the honest limit of this proof: the agent does not
        // export its filtering step, so calling the real one would mean calling
        // `loadGatekeeperConfig` itself — which resolves a committed delegation through git and would
        // refuse a disposable test root for reasons that have nothing to do with budgets. Recorded
        // for the gate as the residual, with the scope constant now imported so the two cannot
        // disagree about the value at least.
        authorities.filter(
          (a) => a && typeof a.decisionId === 'string' && a.scope === BUDGET_RAISE_SCOPE,
        ),
      ),
    ];
    say({ problems });
    break;
  }
  case 'holdlock': {
    // WHAT ANOTHER PROCESS HOLDING THE CANONICAL LOCK REALLY LOOKS LIKE — taken through the agent's
    // own primitive rather than by writing a file, so the exclusion under test is the real one.
    const [root, milliseconds] = rest;
    const lock = join(root, ...GATEKEEPER_LEDGER_LOCK_REL.split('/'));
    const taken = nodeSystem.createExclusive(lock, `{"heldSince":"${nodeSystem.now()}"}\n`);
    say({ taken });
    if (taken) {
      await new Promise((resolve) => setTimeout(resolve, Number(milliseconds)));
      nodeSystem.removeFile(lock);
    }
    break;
  }
  default:
    say({ error: `unknown op ${op}` });
    process.exitCode = 2;
}
