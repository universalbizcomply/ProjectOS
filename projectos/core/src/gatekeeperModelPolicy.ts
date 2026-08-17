/**
 * Which model reviews what, and the ceiling the owner set on the whole pilot.
 *
 * THE OWNER ASKED FOR A SIMPLE TWO-TIER POLICY AND SAID SO EXPLICITLY: "Do not implement unnecessary
 * dynamic routing." So there is no scoring, no heuristic and no model picking its own tier. There is
 * a list of asks that take the strong model and one rule for everything else.
 *
 * THE DEFAULT IS THE EXPENSIVE ONE. An ask this module does not recognise takes the STRONG tier, not
 * the cheap one. That is the opposite of what cost pressure suggests and it is deliberate: the failure
 * mode of guessing cheap is a weak review of something nobody classified, which is exactly the class
 * of question most likely to need the better reviewer. The price of being wrong in this direction is
 * fractions of a cent; the price of being wrong in the other direction is a missed finding.
 *
 * THE BUDGET IS THE OWNER'S NUMBER, NOT A DEFAULT. The owner approved $5 initial credit,
 * auto-recharge OFF, a $5 monthly hard limit and a $2 warning, and stated that "any increase above
 * this pilot budget requires a new Murad owner decision". `checkPilotBudget` is what makes that
 * sentence mechanical: a configuration that raises a limit, or turns auto-recharge on, is refused
 * unless it names an owner decision that authorises it. Without the check, the ruling would be a
 * comment.
 *
 * Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A under the owner's commercial ruling of 2026-08-17.
 */

export const GATEKEEPER_TIERS = ['routine', 'strong'] as const;
export type GatekeeperTier = (typeof GATEKEEPER_TIERS)[number];

/**
 * Asks that always take the strong model: security, architecture, closure and genuine ambiguity, in
 * the owner's own words.
 *
 * `degraded-mode-reconciliation` is here because reviewing work that was never reviewed is not a
 * routine review. `effects-unattested` is here because the open question is whether something
 * protected was touched.
 */
export const STRONG_TIER_ASKS: readonly string[] = [
  'security-review',
  'architecture-review',
  'closure-review',
  'ambiguity',
  'degraded-mode-reconciliation',
  'effects-unattested',
  'worker-refusal',
  'correction-exhausted',
];

/** Asks that take the cheap model: ordinary evidence review and ordinary correction. */
export const ROUTINE_TIER_ASKS: readonly string[] = ['evidence-review', 'correction'];

export interface ModelPolicy {
  readonly routineModel: string;
  readonly strongModel: string;
}

/** The pilot's policy as the owner set it. Model identifiers are configuration, restated here as the
 * approved pair so a silent substitution is visible rather than invisible. */
export const APPROVED_PILOT_POLICY: ModelPolicy = {
  routineModel: 'gpt-5.6-luna',
  strongModel: 'gpt-5.6-terra',
};

/** Which tier answers this ask. Unrecognised asks take the strong tier — see the header. */
export function selectTier(ask: string): GatekeeperTier {
  return ROUTINE_TIER_ASKS.includes(ask) ? 'routine' : 'strong';
}

/** The model that tier resolves to under a given policy. */
export function modelForAsk(ask: string, policy: ModelPolicy): string {
  return selectTier(ask) === 'routine' ? policy.routineModel : policy.strongModel;
}

/** The commercial settings, as configured. Every field is untrusted until checked. */
export interface PilotBudgetConfig {
  readonly initialCreditMicroUsd?: unknown;
  readonly warnAtMicroUsd?: unknown;
  readonly hardStopAtMicroUsd?: unknown;
  readonly autoRecharge?: unknown;
  /** The owner decision that authorises these figures, if they exceed the approved pilot. */
  readonly raisedByOwnerDecisionId?: unknown;
}

/** What the owner actually approved, in micro-USD. */
export const APPROVED_PILOT_BUDGET = {
  initialCreditMicroUsd: 5_000_000,
  warnAtMicroUsd: 2_000_000,
  hardStopAtMicroUsd: 5_000_000,
} as const;

/**
 * Why this budget configuration is not the one the owner approved, or `[]` when it is.
 *
 * LOWER IS ALWAYS FINE; HIGHER NEEDS A DECISION. Spending less than authorised needs nobody's
 * permission. Spending more is a new commercial decision, and naming a decision id is how the
 * configuration points at it rather than asserting it.
 */
export interface BudgetRaiseAuthority {
  readonly decisionId: string;
  /** Must be exactly BUDGET_RAISE_SCOPE, or the decision was about something else. */
  readonly scope: string;
}

/** The only scope that authorises a budget above the approved pilot. */
export const BUDGET_RAISE_SCOPE = 'gatekeeper-budget-raise';

export function checkPilotBudget(
  config: PilotBudgetConfig,
  budgetRaiseAuthorities: readonly BudgetRaiseAuthority[],
): readonly string[] {
  const e: string[] = [];

  // AUTO-RECHARGE IS THE ONE SETTING NO DECISION ID UNLOCKS HERE. A hard limit stops spending at a
  // number; auto-recharge off means the account cannot spend money that was never put into it, which
  // still holds when a limit is misconfigured. Turning it on is a different commercial decision from
  // raising a ceiling, and this phase was not given it.
  if (config.autoRecharge !== false) {
    e.push(
      `auto-recharge is ${JSON.stringify(config.autoRecharge)}; the owner's ruling is that it stays OFF, ` +
        'and it is the limit that holds even when another limit is wrong',
    );
  }

  // ANY OWNER DECISION USED TO UNLOCK THE CEILING. Naming a recorded decision id was treated as
  // authority to raise the budget, so the plan-approval decision — or any other owner decision this
  // project had ever recorded — would have done it. A decision authorises what it was about, so the
  // scope has to match as well as the id.
  const raisedBy = typeof config.raisedByOwnerDecisionId === 'string' ? config.raisedByOwnerDecisionId.trim() : '';
  const matched = budgetRaiseAuthorities.find((a) => a.decisionId === raisedBy);
  const authorised = raisedBy !== '' && matched !== undefined && matched.scope === BUDGET_RAISE_SCOPE;

  const fields: readonly (keyof typeof APPROVED_PILOT_BUDGET)[] = [
    'initialCreditMicroUsd',
    'warnAtMicroUsd',
    'hardStopAtMicroUsd',
  ];
  for (const field of fields) {
    const value = config[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      e.push(`${field} is ${JSON.stringify(value)}, which is not a usable amount`);
      continue;
    }
    if (value > APPROVED_PILOT_BUDGET[field] && !authorised) {
      e.push(
        `${field} is set to ${value} micro-USD, above the approved pilot figure of ` +
          `${APPROVED_PILOT_BUDGET[field]}; raising it needs a new owner decision, and ` +
          (raisedBy === ''
            ? 'the configuration names none'
            : matched === undefined
              ? `decision '${raisedBy}' is not one ProjectOS has recorded`
              : `decision '${raisedBy}' has scope '${matched.scope}', not '${BUDGET_RAISE_SCOPE}', so it ` +
                'was about something else'),
      );
    }
  }

  const warn = config.warnAtMicroUsd;
  const stop = config.hardStopAtMicroUsd;
  if (typeof warn === 'number' && typeof stop === 'number' && warn > stop) {
    e.push('the warning threshold is above the hard stop, so no warning could ever be given before spending stops');
  }

  return e;
}
