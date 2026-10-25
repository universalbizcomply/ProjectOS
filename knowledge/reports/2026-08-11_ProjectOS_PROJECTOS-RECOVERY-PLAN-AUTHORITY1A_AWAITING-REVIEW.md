# PROJECTOS-RECOVERY-PLAN-AUTHORITY1A — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is delegated to ChatGPT for this programme.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-RECOVERY-PLAN-AUTHORITY1A — "Let a specific generated draft — and nothing else — become an approved post-V3 plan with execution authority."
3. **Date:** 2026-08-11
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a` — implementation `0da42ca`, `648c770`, `f537909`, `f04a13c`, `851dd0d`; **proven live** by the activation at `4c49a92`
5. **Files changed:** `projectos/agent/src/planApproval.ts` (new), `projectos/agent/src/planIntake.ts`, `projectos/agent/src/commands/plan.ts`, `projectos/agent/test/planApproval.test.ts` (new), `projectos/schemas/project-plan.schema.json`, `projectos/validators/plan-governance-engine.cjs`, `projectos/validators/validate-projectos-recovery-plan-authority1a.cjs` (new), `projectos/validators/validate-all.cjs`, `.projectops/authority/plan-approval-delegation.json` (new), `.projectops/authority/closure-delegation.json` (new)

## 6. Summary

`plan draft` could produce a proposal and `phase` could refuse to start work without an approved
plan, but nothing joined the two: the only approved plan this repository had was the closed V3 plan,
so a new objective went nowhere. This phase is that join, and deliberately the smallest one that is
safe.

**The authority chain, and why no link grants itself.** The project's active owner-approved plan
records who the owner is. A COMMITTED delegation record, written by that owner, says who else may
approve a plan for this project — it exists as a separate artefact BEFORE any plan it authorises, so
a plan never confers the authority that made it. A COMMITTED decision by exactly that authority
approves one draft, by id AND by plan digest. ProjectOS then recomputes the proposal from the
repository as it is now, and the digest must still match. Only then is a NEW plan record written, and
its readiness is recomputed from scratch by the existing evaluator rather than asserted.

**The plan digest** covers PLAN MATERIAL only — vision, definition of complete, success standard,
scope, environments, phases, conflicts, owner decisions, planning sources. Not the timestamp, not the
commit, not the checksums of the several hundred unrelated files discovery walked past. Editing an
unrelated file must not invalidate an approval; changing one word of the plan must. Both are proven,
and the digest held identical across five commits and across repeat runs.

**A hole in the readiness evaluator, found while wiring this up and fixed here.**
`evaluatePlanReady` checked that `approvalAuthority` said "owner" and that `approvedBy` was not the
implementer — and ANY other name satisfied both. A plan approved by a stranger read as an
owner-authority approval. The approver must now BE the recorded owner, or the plan must carry an
`approvalDelegation` from that owner to exactly that person, scoped to this project, carrying plan
approval only and no protected action. Eight escalation attempts are proven to fail.

**Closure authority is recorded separately from plan approval**, on purpose: approving a plan and
closing a phase are different authorities, and a single record granting both would be a way to widen
one by editing the other. The validator refuses them sharing a scope.

**Proven live, not only in tests.** This mechanism activated the recovery plan at `4c49a92` under
ChatGPT's committed decision: digest re-verified, delegation and decision read FROM THE COMMITTED
BLOBS, plan materialised, schema validated, `PLAN READY` recomputed by the evaluator, decision marked
consumed, and `projectos-v3.plan.json` left byte-identical. Replay of the same decision is refused by
name. It then authorised this very phase.

## 7. Validators

`validate-projectos-recovery-plan-authority1a` — the phase's required validator, new in this phase and
registered in `validate-all` — PASS. It proves the corrected authority rule over a synthetic matrix
(baseline, the stranger, the legitimate delegate, eight escalations, the implementer under six spellings,
and the tamper-proof overclaim) and then applies it to every plan record present in this repository,
found by walking rather than by a list, so a new record cannot slip past.

`validate-all` 127/127, 0 FAIL, recorded subject-bound from a clean tree. Agent 190 tests, core 211.

**Mutations, 25/25 killed across this phase:** 11 on the approval mechanism (committed-ness of each
record, digest currentness, decider checked against the delegation, delegator checked against the
recorded owner, readiness recomputed, the active plan record protected, replay refused, a missing risk
level not defaulted, a stranger approving under owner authority); 6 on the authority boundary in the
governance engine; 7 on the self-review fixes; 1 on the ordering fix. One documented survivor: a
state-schema guard no input can reach while the plan schema passes, kept and annotated as unreachable
rather than deleted.

## 8. Secrets used?

No. Both authority records are scanned for secret-shaped content by the validator, and the plan
record is scanned by the existing raw-secret walk before it can be READY.

## 9. Gated actions performed?

None. The one authority-bearing act — activating the plan — was performed by the runtime on the
strength of a committed decision by the delegated authority, and is recorded in
`.projectops/plan-decisions/PROJECTOS-RECOVERY-PLAN-APPROVAL-DECISION1A.json` with its `consumedAt`
marker. No production, database, external send, payment, credential, installation, service, ACL,
registry or ProgramData action. No force push, no history rewrite, no merge to a protected branch.

## 10. Risks / carry-forward

- `tamperProof` is false and stays false. Anything that can write a file can write these records. The
  boundary is that they must exist as distinct reviewable artefacts and must be COMMITTED, so a
  forgery is a visible diff at the owner's gate. Stated plainly rather than dressed as cryptography.
- `planVersion` is fixed at `1.0`; plan supersession for a second approval at the same path is not
  implemented — the command refuses to overwrite an existing plan record, which fails closed.
- `.projectops/drafts/` is gitignored, so the approved draft is regenerable rather than committed.
  The digest is recomputed at approval, which is stronger, but a reviewer wanting the exact bytes must
  regenerate them.
- Four defects were found in this phase's own new code by self-review before it was ever used, and
  fixed: a committed-ness check that then read the working tree; command-line ids joined onto a path;
  an approval able to overwrite any existing file; and an activation that would have dropped the
  outgoing completion evidence and resurrected the closed programme's phases.

## 11. Decision needed

Delegated closure decision by ChatGPT for `PROJECTOS-RECOVERY-PLAN-AUTHORITY1A`, recorded at
`.projectops/closure/decisions/PROJECTOS-RECOVERY-PLAN-AUTHORITY1A.json` and committed.

## Final status

**PROJECTOS-RECOVERY-PLAN-AUTHORITY1A — AWAITING-REVIEW.**
