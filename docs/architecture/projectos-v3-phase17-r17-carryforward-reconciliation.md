# Phase 17 — R17 carry-forward reconciliation

**Phase** `PROJECTOS-V3-RELIABILITY-HARDENING1A` · plan v1.3 · reconciled 2026-08-10

Every R17 item recorded at Phase-16 closure and at the plan-authority bootstrap, re-checked against
the CURRENT source rather than against the note that raised it. Nothing here is carried forward on
the strength of an old description: each row names what the source says today.

| | Item | Source position today | Disposition |
|---|---|---|---|
| R17-1 | `governedContext` resolves the schema and readiness engines by repo-relative path (`../../validators/plan-governance-engine.cjs`) rather than through a `@projectos/core` module | STILL TRUE — [`governedContext.ts` `loadEngine`](../../projectos/agent/src/governedContext.ts) resolves from `import.meta.url`, deliberately, so the target project cannot redirect them | CARRY FORWARD. It is a packaging coupling, not a correctness or authority defect: the engines resolved are the shipped ones, and resolving them from the caller's cwd — the alternative that would remove the coupling badly — is the thing the current code exists to prevent. |
| R17-2 | `approve` is not governed-context-gated | **FIXED THIS PHASE.** `approve request` and `approve decide` now load the governed context before writing, so an approval cannot be minted or decided in a checkout whose plan is for another project, or under a plan that no longer recomputes READY. Reads stay ungated. | CLOSED |
| R17-3 | `report` hardcodes `knowledge/reports` and ignores the target project's `evidenceRequirements` | STILL TRUE — [`report.ts`](../../projectos/agent/src/commands/report.ts) writes to `reportsDir(root)` unconditionally and never reads the config | CARRY FORWARD. It misplaces evidence for an external project rather than mis-authorising anything, and the PolyGo pilot produced its evidence correctly by other means. Fixing it means deciding where a project declares its evidence location, which is a plan-shaped decision, not a hardening one. |
| R17-4 | plan-import claim extraction produces noisy false conflicts | STILL TRUE IN PART — `detectPlanConflicts` compares regex-extracted claims pairwise across every source, so two documents disagreeing about branch, remote or phase order raise a conflict. Supersession is ALREADY reconciled rather than raised (`plan-discovery-engine.cjs`), which removes the largest source of noise. | CARRY FORWARD. The remaining noise is the price of a control that must not silently discard competing evidence; narrowing it risks suppressing a real conflict, which is the worse failure. |
| R17-5 | PolyGo `origin/main` carries pre-existing validator failures outside the pilot baseline | UNCHANGED, and EXTERNAL | NOT ACTIONABLE HERE. This phase has no authority over `polygonia-apres/polygo`; the excluded scope forbids modifying it. Recorded, not mutated. |
| R17-6 | approval-before-closure is PROCEDURAL: `transitionPhase` does not mechanically require a matching approved closure record | STILL TRUE. G4 gained a required-validator predicate this phase (G4-17) but no approval-record predicate. | CARRY FORWARD, and now cheaper to close: the G4-17 pattern — a plan-declared requirement proven against a durable, subject-bound record — is exactly the shape an approval-before-closure predicate would take. |
| R17-7 | several validators assert GLOBAL working-tree cleanliness rather than scoping to their own phase | THE PATTERN IS FIXED IN NEW CODE: the zero-relay executor requires a clean tree *except* `.projectops/continuity/`, because demanding global cleanliness would mean the first thing a handoff writes makes the next handoff impossible. The affected PolyGo validators are in an external repository. | PATTERN CLOSED HERE; external instances NOT ACTIONABLE (see R17-5). |
| R17-8 | the config-declared plan-memory path check is LEXICAL only; a symlink planted inside the project could resolve outside it | STILL TRUE — `resolveWithinRoot` says so in its own comment, and `System` still exposes no realpath | CARRY FORWARD, with the same reasoning recorded when it was raised: planting the symlink already requires local write access to the repository, and the pre-existing default `.projectops/plan.json` has carried the identical exposure since it was introduced. Closing it means adding a realpath capability to `System`, which widens the impure surface of the runtime and deserves its own decision. |
| R17-9 | dependency completion evidence requires a `-> closed by owner` final transition, but anything able to write the record can write a plausible history entry | UNCHANGED BY DESIGN | NOT A DEFECT TO FIX. Consistent with `MANUAL_GOVERNANCE_APPROVAL` / `tamperProof: false` across this programme; the backstop is the owner commit gate, where a forged record is a visible diff. It is not claimed as tamper-proofing anywhere. |

## Two things this phase changed that were not on the list

- **`phase new` could persist `"objective": "<objective>"`.** The CLI defaulted the flag to a template
  token and no schema, validator or G4 predicate ever read the field, so a placeholder became durable
  governance state. Fixed at the root: the objective now comes from the approved plan's own
  description, a placeholder is refused by any route, and the existing Phase-17 record was repaired
  through a bounded governed command rather than hand-edited.
- **The plan's `requiredValidators` were read by nothing.** Closed by G4-17 — see the closure
  evidence and `projectos/core/src/closureEligibility.ts`.

## Also outstanding, carried into Phase 18

Repeatable native-Windows foreground acquisition from a background worker remains a HARNESS
limitation, not a ProjectOS defect — recorded at Phase-12 closure and unchanged here.
