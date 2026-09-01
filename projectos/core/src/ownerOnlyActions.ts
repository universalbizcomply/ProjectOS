/**
 * The owner-only floor, and the one narrow way part of it may yield.
 *
 * A FLOOR, NOT THE LIST. The owner-only set is otherwise plan-derived (`requiredOwnerGates`) or
 * caller-supplied, and both can legitimately be empty — an authoring omission, or a caller passing
 * `[]` explicitly, which `??` does not treat as absent because an empty array is not nullish. Either
 * would have made "this may never authorise a protected action" vacuously true for that phase. The
 * actions below are the ones whose whole purpose is that a human decided, so they are refused
 * regardless of what a phase remembered to declare.
 *
 * WHY IT LIVES IN CORE. It was first written for degraded mode, in the agent, alongside the disk and
 * git code that reads a risk-acceptance grant — and for as long as it lived there it protected only
 * the paths that happened to import that module. Degraded mode and `reconcile` applied it; the LIVE
 * gatekeeper turn did not, so a phase that omitted `push` from its gates made `push` grantable by a
 * model, and the floor was untouched the whole time. A protection that exists but does not cover the
 * live path is not a protection.
 *
 * TWO KINDS OF OWNER-ONLY, AND THE DISTINCTION IS THE WHOLE POINT OF THIS FILE.
 *
 * The floor originally said one thing about five actions: never, whatever any list says. That was
 * right while ProjectOS had no way for the owner to delegate anything technical — but it made two
 * different sentences look identical. "Production must never be deployed by a machine" and "no
 * machine may commit" are not the same claim: the first is about the blast radius of the act, and the
 * second was about there being nobody trustworthy to ask. Once the owner recorded a delegation and a
 * live reviewer answered the question, the second sentence had an answer and the first still did not.
 *
 * So the floor is now two lists:
 *
 *   ABSOLUTE_OWNER_ONLY               never yields, to anything, ever
 *   CONDITIONALLY_DELEGABLE_TECHNICAL yields ONLY to a proven technical delegation
 *
 * `ALWAYS_OWNER_ONLY` remains their union and remains the answer to "what is protected by default",
 * because DEFAULT IS THE IMPORTANT WORD: `enforcedOwnerOnlyActions(declared)` with no second argument
 * behaves exactly as it did before this change, protecting all of it. Degraded mode, reconciliation
 * and every caller that has not been told about the split therefore keep today's restrictive
 * behaviour, which is what makes the relaxation opt-in rather than a new default nobody chose.
 *
 * Owner decision "APPROVE B6 CONDITIONAL TECHNICAL FLOOR", recorded in
 * PROJECTOS-AUTOMATIC-TECHNICAL-CONTINUATION1A. First written in
 * PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, where it was raised as MEDIUM by adversarial review; moved
 * to core in PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A.
 */

/**
 * Actions no plan, delegation or gatekeeper decision may ever authorise.
 *
 * NOTHING IN THIS MODULE CAN REMOVE ONE. There is no argument, no condition and no code path that
 * subtracts from this list — the relaxation below operates only on the other one, and a test asserts
 * that every member of this list survives every form of the call.
 *
 * `phase-closure` is here rather than in the conditional list even though closure IS delegable,
 * because it is delegated somewhere else entirely: `governance.closureDelegation` and the delegated
 * phase-advance path decide it, and duplicating it into a technical delegation would create a second
 * answer to who may close.
 */
export const ABSOLUTE_OWNER_ONLY = ['phase-closure', 'secrets-handling', 'payment-or-live-charge'] as const;

/**
 * Ordinary source-control actions the owner has approved for conditional delegation.
 *
 * SHORT, AND IT STAYS SHORT. These are the two the owner's decision names, and the decision is
 * explicit that it extends to nothing else: not production, not payments, not sends, not credentials,
 * not force push — which is not merely absent from this list but is not expressible by the executor at
 * all. Adding a member here is a governance act with an owner decision behind it, which is why it is a
 * literal list rather than a rule.
 *
 * CONDITIONAL MEANS BLOCKED BY DEFAULT. Membership here does not relax anything on its own; it only
 * makes an action *eligible* to be relaxed by a proven technical delegation, and even then only when
 * the phase has not separately declared it as its own owner gate.
 */
export const CONDITIONALLY_DELEGABLE_TECHNICAL = ['commit', 'push'] as const;

/**
 * Everything protected by default — the union, and the answer callers have always had.
 *
 * DECLARED AS A LITERAL rather than composed from the two lists above, so that this file states the
 * default protection outright and a test asserts the three lists agree. Composition would have made
 * the most important list in the module a derived value, readable only by following two others.
 */
export const ALWAYS_OWNER_ONLY = [
  'commit',
  'push',
  'phase-closure',
  'secrets-handling',
  'payment-or-live-charge',
] as const;

/**
 * Proof that a technical delegation was actually judged and accepted.
 *
 * A CAPABILITY TOKEN, for the same reason `AuthorisedContinuation` is one: the brand is a symbol
 * private to this module, so a caller cannot write `{ delegated: true }` and relax the floor with it.
 * The only way to obtain one is to hand `technicalDelegationCondition` a delegation state that has no
 * problems and carries the scope — and in production the only thing that produces such a state is
 * `resolveTechnicalDelegation`, which reads the owner's COMMITTED record through git.
 */
declare const DELEGATED: unique symbol;

export interface TechnicalDelegationCondition {
  readonly [DELEGATED]: true;
}

/**
 * Mint the condition, or `null` when the delegation does not support one.
 *
 * STRUCTURALLY TYPED ON PURPOSE. It takes the two facts rather than importing
 * `TechnicalDelegationState`, so this module keeps its only real virtue — it depends on nothing — and
 * the delegation contract stays free to grow without dragging this file into its graph.
 *
 * A NON-ARRAY `problems` IS A FAILURE, not an empty one. A caller that does not say whether it checked
 * has not checked; the alternative is that forgetting to check relaxes the floor.
 */
export function technicalDelegationCondition(delegation: {
  readonly problems?: readonly string[];
  readonly carriesTechnicalScope?: boolean;
}): TechnicalDelegationCondition | null {
  if (!Array.isArray(delegation?.problems) || delegation.problems.length > 0) return null;
  if (delegation.carriesTechnicalScope !== true) return null;
  return {} as TechnicalDelegationCondition;
}

/**
 * The owner-only set actually enforced.
 *
 * WITHOUT A CONDITION — the default, and every caller that predates the split — this is the union of
 * the whole floor and whatever the phase declared, exactly as before. Degraded mode and reconciliation
 * take this path and are therefore unaffected: the constitutional purpose of the old floor was that
 * unreviewed work may not be committed, and degraded mode is precisely the state in which no reviewer
 * looked. A delegation is not a reviewer, and nothing here lets it stand in for one.
 *
 * WITH A PROVEN CONDITION, the two conditionally-delegable actions are omitted — and nothing else is.
 * `ABSOLUTE_OWNER_ONLY` is added unconditionally, and `declared` is added unconditionally too, so a
 * phase that names `commit` among its own required owner gates keeps it owner-only however good the
 * delegation is. That ordering is deliberate: the plan is allowed to be stricter than the
 * constitution, never laxer.
 *
 * IT ONLY EVER WIDENS relative to `declared`. The result is deduplicated, so a phase that restates a
 * floor action changes nothing.
 */
export function enforcedOwnerOnlyActions(
  declared: readonly string[],
  condition?: TechnicalDelegationCondition | null,
): readonly string[] {
  const conditional = condition === undefined || condition === null ? CONDITIONALLY_DELEGABLE_TECHNICAL : [];
  return [...new Set([...ABSOLUTE_OWNER_ONLY, ...conditional, ...declared])];
}

/** Is this action one the owner's decision allows a technical delegation to reach? */
export function isConditionallyDelegableTechnical(action: string): boolean {
  return (CONDITIONALLY_DELEGABLE_TECHNICAL as readonly string[]).includes(action);
}

/** Is this action one that never yields, whatever is delegated or decided? */
export function isAbsolutelyOwnerOnly(action: string): boolean {
  return (ABSOLUTE_OWNER_ONLY as readonly string[]).includes(action);
}
