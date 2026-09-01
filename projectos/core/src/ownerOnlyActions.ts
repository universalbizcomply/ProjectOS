/**
 * The constitutional owner-only floor: actions no delegate may ever be granted.
 *
 * A FLOOR, NOT THE LIST. The owner-only set is otherwise plan-derived (`requiredOwnerGates`) or
 * caller-supplied, and both can legitimately be empty — an authoring omission, or a caller passing
 * `[]` explicitly, which `??` does not treat as absent because an empty array is not nullish. Either
 * would have made "this may never authorise a protected action" vacuously true for that phase. These
 * five are the ones whose whole purpose is that a human decided, so they are refused regardless of
 * what a phase remembered to declare.
 *
 * WHY IT LIVES IN CORE. It was first written for degraded mode, in the agent, alongside the disk and
 * git code that reads a risk-acceptance grant — and for as long as it lived there it protected only
 * the paths that happened to import that module. Degraded mode and `reconcile` applied it; the LIVE
 * gatekeeper turn did not, so a phase that omitted `push` from its gates made `push` grantable by a
 * model, and the floor was untouched the whole time. A protection that exists but does not cover the
 * live path is not a protection.
 *
 * So it sits here, with the decision contract it constrains: pure, dependency-free, and reachable
 * from every module that judges what an answer may authorise — including `gatekeeperTurn.ts`, whose
 * permitted-dependency list is deliberately narrow and correctly refused an import of the agent's
 * degraded-mode module. The agent's `degradedMode.ts` re-exports both names, so every existing caller
 * keeps the spelling it already had and there is still exactly one definition.
 *
 * Moved here in PROJECTOS-LIVE-GATE-OWNER-FLOOR-HARDENING1A; first written in
 * PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A, where it was raised as MEDIUM by adversarial review.
 */

/** Actions no plan, delegation or gatekeeper decision may ever authorise. */
export const ALWAYS_OWNER_ONLY = [
  'commit',
  'push',
  'phase-closure',
  'secrets-handling',
  'payment-or-live-charge',
] as const;

/**
 * The owner-only set actually enforced: whatever was declared, plus the floor that never moves.
 *
 * A UNION, SO NEITHER SOURCE REPLACES THE OTHER. A phase gate outside the floor is still enforced,
 * and a phase that restates a floor action changes nothing — the result is deduplicated, so it only
 * ever widens.
 */
export function enforcedOwnerOnlyActions(declared: readonly string[]): readonly string[] {
  return [...new Set([...ALWAYS_OWNER_ONLY, ...declared])];
}
