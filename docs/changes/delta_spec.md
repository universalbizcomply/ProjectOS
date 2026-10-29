# Delta Specification — plan v1.17, V4 Stage 1: kernel hardening

**Status:** PROPOSED. D11 (phase PROJECTOS-KERNEL-ROLE-REVIEW1A) is owner-approved as written in
`docs/06_Plan.md` 1.1: "D11 approved as written in 06_Plan 1.1" (2026-10-28). The rest of plan v1.17
needs `plan decide`. **No code is written until v1.17 is decided and activated.**

The previous delta (PROJECTOS-COMPLETION1A, approved and closed) is archived at
`docs/changes/archive/delta_spec_PROJECTOS-COMPLETION1A.md`.

**Goal:** make the kernel safe to share across V4 domains. That means:
- review separated by role;
- a hard spend cap;
- a platform-wide stop;
- the kernel contract;
- the small truth and hygiene fixes.

It ends with one live exit proof. There are no new domains, and no owner gate is relaxed.

## Zone 1 — ADDED

| File | Phase | Purpose |
|---|---|---|
| `docs/adr/ADR-K1-kernel-contract.md` | KERNEL-CONTRACT1A | The task envelope and the six permission classes mapped onto today's gates |
| `projectos/validators/val-projectos-kernel-role-review1a.cjs` | KERNEL-ROLE-REVIEW1A | Pins the D11 rules |
| `projectos/validators/val-projectos-kernel-cost-cap1a.cjs` | KERNEL-COST-CAP1A | Pins the cap rules |
| `projectos/validators/val-projectos-kernel-platform-stop1a.cjs` | KERNEL-PLATFORM-STOP1A | Pins the stop rules |
| `projectos/agent/src/commands/stop.ts` | KERNEL-PLATFORM-STOP1A | The owner stop and lift command |
| `rust-toolchain.toml` (repo root) | KERNEL-HYGIENE1A | Pins rustc 1.96.1 |
| Tests under `projectos/agent/test/` and `projectos/core/test/` | each code phase | Behavioural tests beside their peers |
| `docs/finish/<phase>.md` and closure records | each phase | Evidence |

## Zone 2 — MODIFIED (these are PROTECTED in `00_Baseline_State.md` §4; deciding v1.17 approves them)

| File(s) | Phase | Why |
|---|---|---|
| `projectos/agent/src/loop/` (`verification.ts`, `outcome.ts`, `brief.ts`, `runner.ts`, `gatekeeperTurn.ts`, `closureTurn.ts`, `gatekeeperConfig.ts`, `ownerGateReceipts.ts`) | ROLE-REVIEW, COST-CAP, PLATFORM-STOP, TRUTH | Record the reviewer before the gatekeeper; refuse calls over the cap; check the stop at entry; apply the truth fixes |
| `projectos/agent/src/workforce/`, `projectos/agent/src/planApproval.ts` | ROLE-REVIEW | Refuse a plan whose only review is a self-review; bind roles to providers |
| `projectos/agent/src/commands/closure.ts` (closure prepare only: G4-9 `reviewsComplete` and the reviewer-record binding) | ROLE-REVIEW | D11-C1: G4-9 credited the worker's own review claims. **Moved out of PROTECTED by the owner, 2026-10-29: "go for it".** No change to closure authority, eligibility predicates or the decision path |
| `projectos/core/src/gatekeeperCostLedger.ts` | COST-CAP | Make the cap a bound, not a reservation |
| `projectos/agent/src/cli.ts`, `projectos/agent/src/commands/run.ts` | PLATFORM-STOP, TRUTH | Wire the stop command; fix the dry-run briefs |
| `projectos/validators/val-projectos-boot-continue1a.cjs` | TRUTH | Add pins for the five truth fixes |
| `projectos/validators/` (registration only), `package.json` ×3 | HYGIENE | Register validators; add `engines` |
| `docs/04_TRD.md`, `docs/06_Plan.md` | CONTRACT, all | Record the contract; tick the plan |

## Zone 3 — PROTECTED (do not touch in v1.17)

- **Closure authority:** `projectos/core/src/closureAuthority.ts`, `closureEligibility.ts`,
  `closureDecision.ts`, `closureTransport.ts`, `ownerOnlyActions.ts`, `permissions.ts`, `phase.ts`;
  `projectos/agent/src/closureGate.ts`, `closureWait.ts`, `commands/closure.ts` (except the D11-C1 change above),
  `commands/phase.ts`.
- **Broker and credentials:** `projectos/security/**` (including the allowlist just narrowed),
  `projectos/credentials/**`, `projectos/scripts/projectos-credential-router.cjs`.
- **Governance engines and schemas:** `planDecision.ts`, `governanceEngines.ts`,
  `projectos/validators/plan-*-engine.cjs`, `projectos/schemas/**`.
- **Elsewhere:**
  - `projectos/host/**`, `projectos/control-center/**` (including the Supabase SQL, which is
    Stage 2), `projectos/watchdog/**`.
  - Every existing `.projectops/` authority record.
  - The agency repo. Stage 1.8 runs under the agency's own plan.

## Owner acts this plan needs
1. **`plan decide` for v1.17.** D11 is already approved; the rest is not.
2. **The key.** The current key, or a new one with a provider-side spend cap, must be stored for the
   exit proof's provider calls.
3. **A second provider** for the reviewer role in the exit proof, for example Codex. Its credential
   or login is the owner's to store (`secrets-handling`).
4. **Signed authority commits** (Stage 1.7). This is an owner decision and not a v1.17 phase.

## Impact and risk
- **Risk is high.** v1.17 edits the loop, which is protected code. Mitigations:
  - one rule per validator pin, each with named mutations;
  - an ECC SECURITY review on every code phase;
  - an ECC CODE review where the plan names it;
  - the Agency `software-architect` review for the contract ADR.
- **Behaviour change.** Plans with only a worker self-review stop closing. Provider calls over the cap
  are refused. The owner can halt everything with one command.
- **Reversibility.** Each phase is its own commit series, reverted per phase.
