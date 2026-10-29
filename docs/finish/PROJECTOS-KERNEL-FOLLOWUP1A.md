# PROJECTOS-KERNEL-FOLLOWUP1A — closure-route truth fixes, validator pins, Codex reviewer adapter

**Phase:** PROJECTOS-KERNEL-FOLLOWUP1A, plan v1.19 (activation `841f38b`; owner: "Yes, add and do it
(Recommended)"; second reviewer "Codex CLI (OpenAI) (Recommended)"), writePaths repaired in plan v1.20
(`3c1c073`). V4 Stage 1 follow-up.
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`). Built in two isolated
worktrees (`projectos-kernel-followup1a-closure`, `projectos-kernel-followup1a-codex`), stacked by
cherry-pick with zero conflicts. Not pushed, not merged.
**Exclusions honoured:** no owner gate, closure-eligibility predicate or `ownerOnlyActions` was relaxed. The
Codex adapter only reviews.

## Delivered

| # | Item | Where | Tests / pins |
|---|---|---|---|
| 1 | **D9, closure route.** `InstallationBrokerProviderAnswer` is a named class in core `GATEKEEPER_PROVENANCES` (`ModeProvenance` keeps it out of mode-derived stamps). `takeClosureTurn` stamps an accepted broker answer with the provider response id, under the run loop's precedence (Host stays Host, rehearsal unstamped). The closure wait persists it. `closureResume` tests `waiting.provenance === INSTALLATION_BROKER_PROVENANCE && brokerRouteOptedIn(…)` — the opt-in kept, so the class accepts nothing the old inference did not. **Transitional rule: fail closed.** An unstamped wait is no longer a broker answer; the owner commits the presented bundle under their own identity. No live wait was stranded (every existing wait in ProjectOS, the worktree and SEOAgency is CLOSED). | `core/src/gatekeeperMode.ts`, `loop/closureTurn.ts`, `closureWait.ts`, `commands/closure.ts` | `closureTurn.test.ts` (6), `hybridClosureReconcile.test.ts` (5, real git), `gatekeeper-mode.test.ts` (1); ZT-4 updated with 5 named mutations |
| 2 | **D3, funding sentence.** The hard-coded sentence is gone; `closureRequest` prints `closureFundingLine(id, secretsHandlingReceiptScope(…))`, committed bytes only, for broker answers only (false on the Host route). Advisory: the broker does not enforce `questionKinds`, and the code says so. | `commands/closure.ts`, `loop/ownerGateReceipts.ts` (comments) | TR-7 flipped deliberately; 2 named mutations |
| 3 | **Dry-run wording.** `cli.ts` and `docs/02_AppFlow.md` now say a dry run writes nothing. | `cli.ts`, `docs/02_AppFlow.md` | — |
| 4 | **Registry-rule pin.** New `val-projectos-kernel-followup1a` (registered) pins `validate-all`'s registry check and the non-array-`run()` crash rule in both runners. | `validators/val-projectos-kernel-followup1a.cjs` | FU-1..FU-6 |
| 5 | **cached-runner resync.** MODULES is an exact copy of `validate-all`'s; non-array `run()` is a crash; exports precede the CLI block. `validate-speed-validation-cache` now passes and is registered. | `speed/cached-runner.cjs`, `validate-all.cjs` | FU pins |
| 6 | **validate-claude-worker.** inv50 now checks repos come from `scratch.owned`; inv27 compares against half a 30 s backstop (machine git takes ~2.7 s). Passes standalone (55 invariants); stays retired with an accurate reason (async `run()`, opt-in owner-machine evidence). | `validate-claude-worker.cjs` | — |
| 7 | **Codex CLI reviewer adapter** (`codex-cli`). `review()` runs `codex exec --sandbox read-only --json --color never --ignore-user-config --ignore-rules --ephemeral --cd <checkout> <instruction>`; `start`/`rejoin` refuse without spawning; closed argument allowlist (values checked too); credential env scrubbed; bounded by `timeoutMs` and a 16 MiB cap; exactly one `--sandbox read-only` or refused. Its JSON events are converted to the shape the shared `parseReviewerVerdict(reviewerText(…))` already reads — no forked parser. A read counts only on `completed` + exit 0; declined/sandbox-blocked commands, out-of-checkout paths and credential-shaped reply text are denials, so the loop refuses the review as possibly steered. The worker-lifecycle validator admits a closed list of two adapters; the config schema accepts `codex-cli`. | `loop/adapters/codexCli.ts`, `claudeCodeCli.ts` (registry), `reviewRoles.ts`, `val-projectos-worker-lifecycle-bounded1a.cjs`, `schemas/project-config.schema.json` | `codexCliAdapter.test.ts`, 4 loop-level `[CX]` tests in `loopRunner.test.ts`; CX-1..CX-11, RV-1, CW-1 |

## Reviews

- **Claude self-review** (lead): briefs, stacking, the v1.20 writePath repair, a stale core `dist` diagnosed
  (agent `tsc` read an old build; rebuilt, 0 errors).
- **ECC SECURITY review** (independent) at `54c0bd2`: **APPROVE WITH CHANGES**, 0 CRITICAL, 1 HIGH
  (reviewer can read the owner's Codex login and leak it in findings), 3 MEDIUM, 7 LOW. Fixed in `5f9e8aa`
  (HIGH 1, M2, M4, L5, L6, L7, L9). **Recheck at `5f9e8aa`:** APPROVE WITH CHANGES, no new CRITICAL/HIGH; one item required before merge — the
  PowerShell denial wording was not recognised as a sandbox refusal — fixed in `69062f3` with tests, together
  with more credential shapes (Stripe, GitHub, AWS, refresh-token, PEM; mixed-class runs from 30 characters)
  and a credited loop test that now asserts the reviewer record. HIGH 1 is MITIGATED, not closed: both checks
  are tripwires a deliberate evasion beats (see Carried forward).

## Verification (combined branch)

- Core: `tsc` clean; vitest 781/781.
- Agent: `tsc` and `typecheck:tests` clean; vitest 2857/2857 at `5f9e8aa` (2729 before the phase); at
  `69062f3` the two changed suites 186/186 and both typechecks clean.
- `val-projectos-kernel-followup1a`: PASS, 51 named mutations killed by their own rules.
  `val-projectos-boot-continue1a`: PASS, 16. Worker-lifecycle, role-review (37), platform-stop (101),
  closure-transport: PASS.
- `validate-all` at `69062f3`: 153/155 PASS (the 2 known baseline failures: validate-desktop-e2e, val-cd-b4-sealed-expected-window-facts1a).
- `validate-no-secrets`: PASS.
- No provider call, no Codex run, no spend.

## Carried forward

- **To PROJECTOS-KERNEL-EXIT-PROOF1A (preconditions before the first real Codex review):** (1) the owner
  accepts the HIGH 1 residual as tripwire-only in writing, or a read-scope restriction is added; (2) M3: one live Codex probe proving the read-only
  sandbox blocks a write outside the checkout on this host (the owner's `[windows] sandbox = "elevated"`
  is discarded by `--ignore-user-config`). Then the `codex-cli` reviewer worker goes into
  `.projectops/project-config.json`. The probe also records the `command` form Codex reports on this host
  (a `powershell.exe -Command` wrapper would make every command a denial — fails closed) and whether benign
  `error` items appear (they now refuse the review).
- The HIGH 1 checks are heuristics: a runtime-built path or a re-encoded secret passes; token-name and
  long-hex patterns may refuse an honest review of credential code (fails safe).
- On a non-zero exit or timeout the adapter keeps raw JSONL in `stdout`; nothing stores it today.
- The broker stamp is a label on an uncommitted wait, not a binding (no regression); optional hardening:
  cross-check the installation-side broker-answered state on resume.
- The timeout kills only the direct child; source sent to OpenAI under the owner's login is not gated by
  the installation allowlist.
- Broker enforcement of `questionKinds` remains the separate D3 amendment.
