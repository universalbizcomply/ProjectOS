/**
 * The owner's two-tier policy and the ceiling on the pilot.
 *
 * The tier tests are short because the policy is short — that is the point of it. The budget tests
 * are the ones with teeth: a ruling that only exists in prose is a ruling that a later edit silently
 * repeals.
 */
import { describe, it, expect } from 'vitest';
import {
  selectTier,
  modelForAsk,
  checkPilotBudget,
  STRONG_TIER_ASKS,
  ROUTINE_TIER_ASKS,
  APPROVED_PILOT_POLICY,
  APPROVED_PILOT_BUDGET,
  GATEKEEPER_TIERS,
  BUDGET_RAISE_SCOPE,
  type PilotBudgetConfig,
} from '../src/gatekeeperModelPolicy.js';

/** A decision that authorises a budget raise, and one that is about something else entirely. */
const BUDGET_AUTHORITY = [{ decisionId: 'GATEKEEPER-BUDGET-RAISE1A', scope: BUDGET_RAISE_SCOPE }];
const UNRELATED_AUTHORITY = [
  { decisionId: 'PROJECTOS-AUTONOMOUS-SELF-HOSTING-PLAN-APPROVAL-DECISION1B', scope: 'plan-approval' },
];
const OWNER_DECISIONS = BUDGET_AUTHORITY;

function budget(over: Partial<PilotBudgetConfig> = {}): PilotBudgetConfig {
  return {
    initialCreditMicroUsd: APPROVED_PILOT_BUDGET.initialCreditMicroUsd,
    warnAtMicroUsd: APPROVED_PILOT_BUDGET.warnAtMicroUsd,
    hardStopAtMicroUsd: APPROVED_PILOT_BUDGET.hardStopAtMicroUsd,
    autoRecharge: false,
    ...over,
  };
}

describe('the two tiers', () => {
  it.each(ROUTINE_TIER_ASKS)('sends %s to the cheap model', (ask) => {
    expect(selectTier(ask)).toBe('routine');
    expect(modelForAsk(ask, APPROVED_PILOT_POLICY)).toBe('gpt-5.6-luna');
  });

  it.each(STRONG_TIER_ASKS)('sends %s to the strong model', (ask) => {
    expect(selectTier(ask)).toBe('strong');
    expect(modelForAsk(ask, APPROVED_PILOT_POLICY)).toBe('gpt-5.6-terra');
  });

  // THE DEFAULT IS THE EXPENSIVE ONE, on purpose. An unclassified question is the one most likely to
  // need the better reviewer, and being wrong this way costs fractions of a cent.
  it('sends an unrecognised ask to the strong model rather than guessing cheap', () => {
    for (const ask of ['', 'something-new', 'REVIEW', 'evidence review']) {
      expect(selectTier(ask)).toBe('strong');
    }
  });

  it('has exactly two tiers, because the owner asked for exactly two', () => {
    expect(GATEKEEPER_TIERS).toEqual(['routine', 'strong']);
  });

  // PINNED BY NAME, because `STRONG_TIER_ASKS` IS NOT OPERATIVE. `selectTier` already returns 'strong'
  // for anything outside the routine list, so removing an entry from the strong list changes no
  // behaviour and a test that iterates the list cannot notice — it just loses a case. Mutation testing
  // found exactly that. The list is the owner's classification written down, so it is asserted as
  // content, and the routine list is asserted the same way because THAT one does decide.
  it('classifies the owner\'s named categories as strong, by name', () => {
    expect([...STRONG_TIER_ASKS].sort()).toEqual([
      'ambiguity',
      'architecture-review',
      'closure-review',
      'correction-exhausted',
      'degraded-mode-reconciliation',
      'effects-unattested',
      'security-review',
      'worker-refusal',
    ]);
  });

  it('keeps the cheap tier to ordinary evidence review and ordinary correction, by name', () => {
    expect([...ROUTINE_TIER_ASKS].sort()).toEqual(['correction', 'evidence-review']);
  });

  it('classifies no ask into both tiers', () => {
    const overlap = STRONG_TIER_ASKS.filter((a) => ROUTINE_TIER_ASKS.includes(a));
    expect(overlap).toEqual([]);
  });

  it('routes closure and security to the strong model, and ordinary evidence to the cheap one', () => {
    expect(modelForAsk('closure-review', APPROVED_PILOT_POLICY)).toBe(APPROVED_PILOT_POLICY.strongModel);
    expect(modelForAsk('security-review', APPROVED_PILOT_POLICY)).toBe(APPROVED_PILOT_POLICY.strongModel);
    expect(modelForAsk('evidence-review', APPROVED_PILOT_POLICY)).toBe(APPROVED_PILOT_POLICY.routineModel);
  });

  it('does not name the model the owner excluded from the default route', () => {
    expect(Object.values(APPROVED_PILOT_POLICY)).not.toContain('gpt-5.6-sol');
  });
});

describe('the approved budget', () => {
  // THE FIGURES ARE ASSERTED AS LITERALS. Every other test builds its fixture FROM
  // `APPROVED_PILOT_BUDGET`, so a mutation that raised the approved figure moved the fixture with it
  // and nothing failed. The owner's numbers have to be written out somewhere that does not move.
  it('is exactly what the owner approved: $5 credit, $2 warning, $5 hard limit', () => {
    expect(APPROVED_PILOT_BUDGET.initialCreditMicroUsd).toBe(5_000_000);
    expect(APPROVED_PILOT_BUDGET.warnAtMicroUsd).toBe(2_000_000);
    expect(APPROVED_PILOT_BUDGET.hardStopAtMicroUsd).toBe(5_000_000);
  });

  it('accepts the figures the owner set', () => {
    expect(checkPilotBudget(budget(), OWNER_DECISIONS)).toEqual([]);
  });

  it('accepts spending less than authorised without anybody\'s permission', () => {
    expect(checkPilotBudget(budget({ hardStopAtMicroUsd: 1_000_000, warnAtMicroUsd: 500_000 }), [])).toEqual([]);
  });
});

describe('auto-recharge', () => {
  it.each([true, undefined, null, 'off', 0])('refuses auto-recharge set to %s', (value) => {
    const errors = checkPilotBudget(budget({ autoRecharge: value }), OWNER_DECISIONS);
    expect(errors.some((e) => e.includes('stays OFF'))).toBe(true);
  });

  // NO DECISION ID UNLOCKS IT HERE. Turning auto-recharge on is a different commercial decision from
  // raising a ceiling, and this phase was not given it.
  it('refuses auto-recharge even when a real budget-raise decision is named', () => {
    const errors = checkPilotBudget(
      budget({ autoRecharge: true, raisedByOwnerDecisionId: BUDGET_AUTHORITY[0]!.decisionId }),
      BUDGET_AUTHORITY,
    );
    expect(errors.some((e) => e.includes('stays OFF'))).toBe(true);
  });
});

describe('raising a limit', () => {
  it('refuses a hard stop above the approved figure with no decision named', () => {
    const errors = checkPilotBudget(budget({ hardStopAtMicroUsd: 50_000_000 }), OWNER_DECISIONS);
    expect(errors.some((e) => e.includes('the configuration names none'))).toBe(true);
  });

  it('refuses a decision id ProjectOS has not recorded', () => {
    const errors = checkPilotBudget(
      budget({ hardStopAtMicroUsd: 50_000_000, raisedByOwnerDecisionId: 'DECISION-I-MADE-UP' }),
      OWNER_DECISIONS,
    );
    expect(errors.some((e) => e.includes('is not one ProjectOS has recorded'))).toBe(true);
  });

  it('allows a raise that points at a decision authorising a budget raise', () => {
    const errors = checkPilotBudget(
      budget({
        hardStopAtMicroUsd: 50_000_000,
        initialCreditMicroUsd: 50_000_000,
        raisedByOwnerDecisionId: BUDGET_AUTHORITY[0]!.decisionId,
      }),
      BUDGET_AUTHORITY,
    );
    expect(errors).toEqual([]);
  });

  // ANY OWNER DECISION USED TO UNLOCK THE CEILING. The plan-approval decision is a real, recorded
  // owner decision — and it says nothing whatever about money.
  it('refuses a raise authorised by an owner decision that was about something else', () => {
    const errors = checkPilotBudget(
      budget({
        hardStopAtMicroUsd: 50_000_000,
        raisedByOwnerDecisionId: UNRELATED_AUTHORITY[0]!.decisionId,
      }),
      UNRELATED_AUTHORITY,
    );
    expect(errors.some((e) => e.includes('was about something else'))).toBe(true);
  });

  it.each(['initialCreditMicroUsd', 'warnAtMicroUsd', 'hardStopAtMicroUsd'] as const)(
    'guards %s, not just the headline limit',
    (field) => {
      const errors = checkPilotBudget(budget({ [field]: 99_000_000 }), OWNER_DECISIONS);
      expect(errors.some((e) => e.includes(field))).toBe(true);
    },
  );
});

describe('a budget that could not work', () => {
  it.each([undefined, null, 'five dollars', -1, Number.NaN])('refuses an amount of %s', (value) => {
    const errors = checkPilotBudget(budget({ hardStopAtMicroUsd: value }), OWNER_DECISIONS);
    expect(errors.some((e) => e.includes('not a usable amount'))).toBe(true);
  });

  it('refuses a warning threshold above the hard stop, which could never fire in time', () => {
    const errors = checkPilotBudget(budget({ warnAtMicroUsd: 4_000_000, hardStopAtMicroUsd: 1_000_000 }), []);
    expect(errors.some((e) => e.includes('no warning could ever be given'))).toBe(true);
  });
});
