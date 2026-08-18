/**
 * The whole loop, end to end, with no network and no money — the rehearsal the plan permits.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. The approved scope allows a local route to "rehearse
 * transport plumbing only" and states plainly that it "can never be the accepted gatekeeper". So this
 * file proves the MECHANISM: that a stop becomes a bound request, that a decision answering that
 * request is checked before it is applied, that applying it produces the next action, that the money
 * is accounted for before the call, and that a restart cannot make any of it happen twice. It does
 * NOT prove the live cycle. The live cycle needs a real reviewer, and a real reviewer needs the
 * owner's commercial gate, which has not been reached.
 *
 * Writing it now is the point. When the key exists, what is unproven is the transport — not the
 * governance around it.
 */
import { describe, it, expect } from 'vitest';
import {
  gatekeeperRequestDigest,
  checkGatekeeperDecision,
  selectGatekeeperTransport,
  checkDegradedModeGrant,
  reconciliationState,
  gateBlockedByReconciliation,
  isolationProblems,
  estimateCostMicroUsd,
  recordCall,
  summariseLedger,
  authoriseRequestSpend,
  GATEKEEPER_DECISION_SCHEMA_VERSION,
  GATEKEEPER_REQUEST_SCHEMA_VERSION,
  DEGRADED_MODE_SCHEMA_VERSION,
  DEGRADED_MODE_CHOICE,
  RECONCILIATION_ASK,
  type GatekeeperRequest,
  type GatekeeperTransportDescriptor,
  type GatekeeperVerdict,
  type LedgerEntry,
  type RateCard,
  type BudgetPolicy,
} from '@projectos/core';
import { applyVerdictToStop } from '../src/loop/gatekeeperRouting.js';
import type { LoopStop } from '../src/loop/outcome.js';

const SUBJECT = '0965059aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PHASE = 'PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A';
const OWNER_ONLY = ['commit', 'push', 'phase-closure', 'secrets-handling', 'payment-or-live-charge'];

/** A local route: it may carry the plumbing and may never be the reviewer. */
const REHEARSAL: GatekeeperTransportDescriptor = {
  transportId: 'local-rehearsal',
  kind: 'local-rehearsal',
  model: 'rehearsal-stub',
  capabilities: ['submit-request', 'receive-decision'],
  commercialApproval: false,
};

const RATE: RateCard = {
  model: 'rehearsal-stub',
  inputMicroUsdPerMillion: 1_250_000,
  cachedInputMicroUsdPerMillion: 125_000,
  outputMicroUsdPerMillion: 10_000_000,
};

const BUDGET: BudgetPolicy = { warnAtMicroUsd: 5_000_000, hardStopAtMicroUsd: 10_000_000 };
const SCOPE = { projectId: 'projectos', phaseId: PHASE, month: '2026-08' };

function request(over: Partial<GatekeeperRequest> = {}): GatekeeperRequest {
  return {
    schemaVersion: GATEKEEPER_REQUEST_SCHEMA_VERSION,
    requestId: 'GKREQ-R1',
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    ask: 'evidence-review',
    evidenceDigests: ['sha256:' + '1'.repeat(64)],
    ownerOnlyActions: OWNER_ONLY,
    ...over,
  };
}

/**
 * A stand-in reviewer. It answers the request it was given and nothing else — which is exactly the
 * discipline a real one has to be held to, so the fixture models it rather than assuming it.
 */
function rehearsalGatekeeper(
  req: GatekeeperRequest,
  verdict: GatekeeperVerdict,
  instruction: string | null,
  decisionId: string,
) {
  return {
    schemaVersion: GATEKEEPER_DECISION_SCHEMA_VERSION,
    decisionId,
    projectId: req.projectId,
    phaseId: req.phaseId,
    subjectCommit: req.subjectCommit,
    requestDigest: gatekeeperRequestDigest(req),
    decision: verdict,
    allowedActions: ['implement', 'run-validators'],
    forbiddenActions: [...OWNER_ONLY],
    ownerApprovalRequired: false,
    reason: 'rehearsal decision',
    nextClaudeInstruction: instruction,
    risks: [],
    carryForward: [],
    decidedBy: 'ChatGPT',
    decidedAt: '2026-08-17T17:00:00+01:00',
  };
}

function expectations(over: Record<string, unknown> = {}) {
  return {
    projectId: 'projectos',
    phaseId: PHASE,
    subjectCommit: SUBJECT,
    requestDigest: gatekeeperRequestDigest(request()),
    expectedDecider: 'ChatGPT',
    alreadyConsumedDecisionIds: [] as string[],
    ownerOnlyActions: OWNER_ONLY,
    ...over,
  };
}

const criticalStop: LoopStop = {
  code: 'UNRESOLVED_CRITICAL_OR_HIGH',
  detail: 'CRITICAL GK-1 — tenant filter missing from the ledger query',
};

describe('one ordinary cycle, rehearsed', () => {
  it('carries a stop to a bound request, a checked decision and a next action', () => {
    // 1. The route is usable for rehearsal, and would be refused as a reviewer.
    expect(selectGatekeeperTransport(REHEARSAL, { reachable: true }, { rehearsalOnly: true }).outcome).toBe('SELECTED');
    expect(selectGatekeeperTransport(REHEARSAL, { reachable: true }).outcome).toBe('UNAVAILABLE');

    // 2. The money is authorised BEFORE the call, against the estimate.
    const usage = { inputTokens: 17_088, cachedInputTokens: 0, outputTokens: 800 };
    const estimate = estimateCostMicroUsd(usage, RATE);
    const before = summariseLedger([], SCOPE);
    expect(authoriseRequestSpend(estimate, before, BUDGET).allowed).toBe(true);

    // 3. The reviewer answers the request it was given.
    const decision = rehearsalGatekeeper(
      request(),
      'AMENDMENT_REQUIRED',
      'Add the tenant predicate and re-run validate-all.',
      'GKDEC-R1',
    );
    const problems = checkGatekeeperDecision(decision, expectations());
    expect(problems).toEqual([]);

    // 4. The CHECKED DECISION becomes the loop's next move. The verdict is read from the record that
    //    was checked, not passed alongside it — an earlier version of this proof passed a hardcoded
    //    verdict literal and so demonstrated the hazard rather than closing it.
    const action = applyVerdictToStop(criticalStop, { ...decision, problems });
    expect(action).toEqual({ kind: 'retry', instruction: 'Add the tenant predicate and re-run validate-all.' });

    // 5. The call is recorded, and the month's totals move by exactly its cost.
    const entry = recordCall({ requestId: 'GKREQ-R1', projectId: 'projectos', phaseId: PHASE, usage, rate: RATE, at: '2026-08-17T17:00:00+01:00' });
    const after = summariseLedger([entry], SCOPE);
    expect(after.monthMicroUsd).toBe(estimate);
    expect(after.callCount).toBe(1);
  });

  it('reaches the owner gate rather than passing it', () => {
    const gateStop: LoopStop = { code: 'OWNER_GATE', detail: 'the phase now needs commit, push' };
    const action = applyVerdictToStop(gateStop, {
      decision: 'APPROVED_TO_PROCEED',
      nextClaudeInstruction: 'ship it',
      problems: [],
    });
    expect(action.kind).toBe('owner');
  });
});

describe('restart mid-objective', () => {
  const usage = { inputTokens: 17_088, outputTokens: 800 };
  const entry: LedgerEntry = recordCall({
    requestId: 'GKREQ-R1',
    projectId: 'projectos',
    phaseId: PHASE,
    usage,
    rate: RATE,
    at: '2026-08-17T17:00:00+01:00',
  });

  it('does not apply the same decision twice', () => {
    const decision = rehearsalGatekeeper(request(), 'AMENDMENT_REQUIRED', 'do the thing', 'GKDEC-R1');
    const replayed = checkGatekeeperDecision(decision, expectations({ alreadyConsumedDecisionIds: ['GKDEC-R1'] }));
    expect(replayed.some((e) => e.includes('cannot be replayed'))).toBe(true);
  });

  it('does not count the same call twice', () => {
    const totals = summariseLedger([entry, entry], SCOPE);
    expect(totals.callCount).toBe(1);
    expect(totals.duplicatesIgnored).toBe(1);
    expect(totals.monthMicroUsd).toBe(entry.costMicroUsd);
  });

  it('accepts genuinely new work after the restart', () => {
    // An approval still has to say what happens next — a verdict that continues the work with no
    // instruction leaves the loop approved and directionless.
    const second = rehearsalGatekeeper(
      request({ requestId: 'GKREQ-R2' }),
      'APPROVED_TO_PROCEED',
      'Continue with the transport rehearsal.',
      'GKDEC-R2',
    );
    const errors = checkGatekeeperDecision(
      second,
      expectations({
        requestDigest: gatekeeperRequestDigest(request({ requestId: 'GKREQ-R2' })),
        alreadyConsumedDecisionIds: ['GKDEC-R1'],
      }),
    );
    expect(errors).toEqual([]);
  });
});

describe('another project cannot answer for this one', () => {
  it('refuses a decision produced in a different project\'s thread', () => {
    const foreign = rehearsalGatekeeper(request({ projectId: 'polygo' }), 'APPROVED_TO_PROCEED', null, 'GKDEC-X');
    const errors = checkGatekeeperDecision(foreign, expectations());
    // Both the project binding and the request digest catch it — independently.
    expect(errors.some((e) => e.includes("not 'projectos'"))).toBe(true);
    expect(errors.some((e) => e.includes('not an answer to this one'))).toBe(true);
  });

  it('refuses a decision about another commit even within this project', () => {
    const stale = rehearsalGatekeeper(request({ subjectCommit: 'f'.repeat(40) }), 'APPROVED_TO_PROCEED', null, 'GKDEC-Y');
    expect(checkGatekeeperDecision(stale, expectations()).some((e) => e.includes('is stale'))).toBe(true);
  });

  it('keeps distinct projects on distinct threads and roots', () => {
    expect(
      isolationProblems([
        { projectId: 'projectos', repositoryRoot: 'C:/dev/ProjectOS', providerThreadId: 'resp_aaaaaaaaaaaa' },
        { projectId: 'dead-aisle', repositoryRoot: 'C:/dev/DeadAisle', providerThreadId: 'resp_bbbbbbbbbbbb' },
      ]),
    ).toEqual([]);
  });
});

describe('the gatekeeper goes away', () => {
  const OUTAGE = 'GKOUT-R1';

  it('refuses to continue and hands the owner an explicit choice', () => {
    const selection = selectGatekeeperTransport(
      { ...REHEARSAL, kind: 'openai-responses', transportId: 'openai-primary', commercialApproval: true },
      { reachable: false, detail: 'no response within timeout' },
    );
    expect(selection.outcome).toBe('UNAVAILABLE');
    if (selection.outcome !== 'UNAVAILABLE') throw new Error('unreachable');
    expect(selection.ownerChoices).toContain(DEGRADED_MODE_CHOICE);
  });

  it('continues only on the owner\'s recorded risk acceptance, and never with owner authority', () => {
    const grant = {
      schemaVersion: DEGRADED_MODE_SCHEMA_VERSION,
      grantId: 'GKDEG-R1',
      projectId: 'projectos',
      phaseId: PHASE,
      subjectCommit: SUBJECT,
      unavailabilityId: OUTAGE,
      ownerChoice: DEGRADED_MODE_CHOICE,
      grantedBy: 'Murad',
      grantedAt: '2026-08-17T17:30:00+01:00',
      reason: 'reviewer unreachable; bounded implementation may continue unreviewed',
      grantedScope: ['implement', 'run-validators'],
      maxWorkItems: 2,
    };
    const expectGrant = {
      projectId: 'projectos',
      phaseId: PHASE,
      subjectCommit: SUBJECT,
      unavailabilityId: OUTAGE,
      recordedOwner: 'Murad',
      ownerOnlyActions: OWNER_ONLY,
      alreadyConsumedGrantIds: [] as string[],
      readFromCommittedTree: true,
    };
    expect(checkDegradedModeGrant(grant, expectGrant)).toEqual([]);

    // The same grant with commit added is refused — "carry on" is not "carry on and ship it".
    const overreaching = { ...grant, grantedScope: ['implement', 'commit'] };
    expect(checkDegradedModeGrant(overreaching, expectGrant).some((e) => e.includes('owner-only action'))).toBe(true);
  });

  it('leaves a debt that blocks the next major gate until a real review clears it', () => {
    const work = [
      { workId: 'W1', grantId: 'GKDEG-R1', phaseId: PHASE, summary: 'ledger wiring', at: '2026-08-17T17:40:00+01:00' },
      { workId: 'W2', grantId: 'GKDEG-R1', phaseId: PHASE, summary: 'thread binding', at: '2026-08-17T17:50:00+01:00' },
    ];
    const reviewed = (workId: string) => ({
      workId,
      decisionId: `GKDEC-RECON-${workId}`,
      ask: RECONCILIATION_ASK,
      decisionAccepted: true,
    });
    expect(gateBlockedByReconciliation(reconciliationState(work, []))).not.toEqual([]);
    expect(gateBlockedByReconciliation(reconciliationState(work, [reviewed('W1')]))).not.toEqual([]);
    // The loop cannot clear its own debt by naming its own work: the decision must have been accepted.
    expect(
      gateBlockedByReconciliation(
        reconciliationState(work, [{ ...reviewed('W1'), decisionAccepted: false }, reviewed('W2')]),
      ),
    ).not.toEqual([]);
    expect(gateBlockedByReconciliation(reconciliationState(work, [reviewed('W1'), reviewed('W2')]))).toEqual([]);
  });
});
