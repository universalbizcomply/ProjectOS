/**
 * Where a stopped loop goes, and what a verdict may do when it gets there.
 *
 * The relay this phase removes is the owner carrying a stop to ChatGPT and a decision back. Removing
 * it is only safe if the stops that were never ChatGPT's to answer keep going to the owner — so most
 * of what follows checks that a verdict does NOT resolve something.
 */
import { describe, it, expect } from 'vitest';
import {
  routeStop,
  applyVerdictToStop,
  gatekeeperRoutableCodes,
  STOP_ROUTES,
} from '../src/loop/gatekeeperRouting.js';
import { GATEKEEPER_VERDICTS, verdictRequiresOwner, type GatekeeperVerdict } from '@projectos/core';
import type { LoopStop, LoopStopCode } from '../src/loop/outcome.js';

const OWNER_STOPS: LoopStopCode[] = ['PROTECTED_EFFECT', 'OWNER_GATE', 'SCOPE_DECISION'];
const GATEKEEPER_STOPS: LoopStopCode[] = [
  'UNRESOLVED_CRITICAL_OR_HIGH',
  'CORRECTION_EXHAUSTED',
  'REVIEW_OUTSTANDING',
  'WORKER_REFUSED',
  'EFFECTS_NOT_ATTESTED',
];

function stop(code: LoopStopCode): LoopStop {
  return { code, detail: `detail for ${code}` };
}

describe('the routing table', () => {
  it('routes every stop code the loop can produce', () => {
    const routed = Object.keys(STOP_ROUTES).sort();
    expect(routed).toEqual([...OWNER_STOPS, ...GATEKEEPER_STOPS].sort());
  });

  it('sends review questions to the gatekeeper', () => {
    expect([...gatekeeperRoutableCodes()].sort()).toEqual([...GATEKEEPER_STOPS].sort());
  });

  it.each(OWNER_STOPS)('keeps %s with the owner', (code) => {
    expect(routeStop(stop(code)).audience).toBe('owner');
    expect(routeStop(stop(code)).applicableVerdicts).toEqual([]);
  });

  it('states a rationale for every route, so no stop is routed silently', () => {
    for (const route of Object.values(STOP_ROUTES)) {
      expect(route.rationale.trim().length).toBeGreaterThan(20);
    }
  });

  // THE INVARIANT THAT REPLACES A RUNTIME GUARD. If no route ever offers an owner-gated verdict as an
  // answer, the loop cannot act on one — so this is asserted here rather than re-checked at every
  // call. Adding APPROVED_FOR_CLOSURE to a route is exactly the plausible future change (closure IS
  // delegated to the gatekeeper for this programme), and it must fail here before it ships.
  it('never offers an owner-gated verdict as an answer to any stop', () => {
    for (const [code, route] of Object.entries(STOP_ROUTES)) {
      const gated = route.applicableVerdicts.filter((v) => verdictRequiresOwner(v));
      expect(gated, `${code} offers owner-gated verdict(s): ${gated.join(', ')}`).toEqual([]);
    }
  });
});

describe('stops that are the owner\'s alone', () => {
  it.each(OWNER_STOPS)('refuses every verdict against %s', (code) => {
    for (const verdict of GATEKEEPER_VERDICTS) {
      const action = applyVerdictToStop(stop(code), { decision: verdict, nextClaudeInstruction: 'do the thing', problems: [] });
      expect(action.kind).toBe('owner');
    }
  });

  it('says plainly that no verdict was applied', () => {
    const action = applyVerdictToStop(stop('PROTECTED_EFFECT'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: 'carry on', problems: [] });
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('none was applied'))).toBe(true);
  });
});

describe('verdicts that cannot answer the stop they were given', () => {
  it('refuses to approve past a worker refusal', () => {
    const action = applyVerdictToStop(stop('WORKER_REFUSED'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: null, problems: [] });
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('cannot answer this stop'))).toBe(true);
  });

  // THE ONE THAT MATTERS MOST. An absent effects attestation means it is unknown whether production
  // was touched. Approval cannot convert an absent record into a denial.
  it('refuses to approve past a run that never said what it did', () => {
    const action = applyVerdictToStop(stop('EFFECTS_NOT_ATTESTED'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: null, problems: [] });
    expect(action.kind).toBe('owner');
  });

  it('refuses to approve past a defect that resisted correction', () => {
    const action = applyVerdictToStop(stop('CORRECTION_EXHAUSTED'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: null, problems: [] });
    expect(action.kind).toBe('owner');
  });

  it('lists what would have been applicable, so the refusal is actionable', () => {
    const action = applyVerdictToStop(stop('CORRECTION_EXHAUSTED'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: null, problems: [] });
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('AMENDMENT_REQUIRED'))).toBe(true);
  });
});

describe('owner-gated verdicts', () => {
  it.each(['APPROVED_TO_COMMIT', 'APPROVED_TO_PUSH', 'APPROVED_FOR_CLOSURE'] as GatekeeperVerdict[])(
    'records %s as a recommendation and leaves the action to the owner',
    (verdict) => {
      const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), { decision: verdict, nextClaudeInstruction: 'ship it', problems: [] });
      expect(action.kind).toBe('owner');
    },
  );
});

describe('verdicts the loop may act on', () => {
  it('retries with the gatekeeper\'s instruction on an amendment', () => {
    const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), {
      decision: 'AMENDMENT_REQUIRED',
      nextClaudeInstruction: '  Narrow the SQL query to the caller\'s tenant.  ',
      problems: [],
    });
    expect(action).toEqual({ kind: 'retry', instruction: "Narrow the SQL query to the caller's tenant." });
  });

  // FORGETTING TO CHECK MUST NOT LOOK LIKE PASSING.
  it('refuses when the caller never says whether the decision was checked', () => {
    const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), {
      decision: 'APPROVED_TO_PROCEED',
      nextClaudeInstruction: 'carry on',
    } as never);
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('not known whether the decision passed'))).toBe(true);
  });

  it('refuses an amendment with no instruction rather than guessing', () => {
    for (const instruction of [null, '', '   ']) {
      const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), { decision: 'AMENDMENT_REQUIRED', nextClaudeInstruction: instruction, problems: [] });
      expect(action.kind).toBe('owner');
      if (action.kind !== 'owner') throw new Error('unreachable');
      expect(action.reasons.some((r) => r.includes('nothing to act on'))).toBe(true);
    }
  });

  it('proceeds when the gatekeeper reviewed the finding and approved continuation', () => {
    const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), { decision: 'APPROVED_TO_PROCEED', nextClaudeInstruction: null, problems: [] });
    expect(action.kind).toBe('proceed');
  });

  // A DECISION THAT FAILED ITS OWN CHECKS DECIDES NOTHING. The previous signature took a bare verdict,
  // so a caller could check one decision and act on a verdict from somewhere else and nothing here
  // could tell. Passing the check's own output makes the linkage structural.
  it('refuses to act on a decision that did not pass checkGatekeeperDecision', () => {
    const action = applyVerdictToStop(stop('UNRESOLVED_CRITICAL_OR_HIGH'), {
      decision: 'APPROVED_TO_PROCEED',
      nextClaudeInstruction: 'carry on',
      problems: ['decision is for project "polygo", not \'projectos\''],
    });
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('did not pass its own checks'))).toBe(true);
    expect(action.reasons.some((r) => r.includes('polygo'))).toBe(true);
  });

  // A MISSING REVIEW IS SATISFIED BY THE REVIEW HAPPENING, never by a word. One approval would
  // otherwise discharge every outstanding review at once, including a security review nobody ran.
  it('refuses to discharge an outstanding review with a bare approval', () => {
    const action = applyVerdictToStop(stop('REVIEW_OUTSTANDING'), {
      decision: 'APPROVED_TO_PROCEED',
      nextClaudeInstruction: 'looks fine',
      problems: [],
    });
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('cannot answer this stop'))).toBe(true);
  });

  it('stops for the owner when the gatekeeper says the work must not continue', () => {
    const action = applyVerdictToStop(stop('REVIEW_OUTSTANDING'), { decision: 'DO_NOT_PROCEED', nextClaudeInstruction: 'anything', problems: [] });
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('must not continue'))).toBe(true);
  });

  it('stops for the owner when the gatekeeper refers the question upward', () => {
    const action = applyVerdictToStop(stop('REVIEW_OUTSTANDING'), { decision: 'AWAITING_OWNER', nextClaudeInstruction: null, problems: [] });
    expect(action.kind).toBe('owner');
    if (action.kind !== 'owner') throw new Error('unreachable');
    expect(action.reasons.some((r) => r.includes('referred this to the owner'))).toBe(true);
  });
});

describe('the loop never continues by accident', () => {
  // Across EVERY stop and EVERY verdict, continuation is the exception and it is enumerable.
  it('proceeds only on an explicit approval of a review question', () => {
    const proceeding: string[] = [];
    for (const code of [...OWNER_STOPS, ...GATEKEEPER_STOPS]) {
      for (const verdict of GATEKEEPER_VERDICTS) {
        if (applyVerdictToStop(stop(code), { decision: verdict, nextClaudeInstruction: 'instruction', problems: [] }).kind === 'proceed') {
          proceeding.push(`${code}/${verdict}`);
        }
      }
    }
    // ONE PAIR, down from two: REVIEW_OUTSTANDING no longer accepts a bare approval.
    expect(proceeding.sort()).toEqual(['UNRESOLVED_CRITICAL_OR_HIGH/APPROVED_TO_PROCEED']);
  });

  it('never retries a stop that is the owner\'s', () => {
    for (const code of OWNER_STOPS) {
      for (const verdict of GATEKEEPER_VERDICTS) {
        expect(applyVerdictToStop(stop(code), { decision: verdict, nextClaudeInstruction: 'instruction', problems: [] }).kind).not.toBe('retry');
      }
    }
  });
});
