# PROJECTOS-STAGE4-EXIT-PROOF1A — finish record

**Result: NOT PROVEN (2026-11-18).** Config A (Claude implements, Codex reviews) ran live and closed. Config B (Codex implements, Claude reviews) ran live and did **not**
close: the Codex implementer did the work correctly, but the loop stopped after three corrections because of two findings the implementer wrote about itself and cannot
correct, so the Claude reviewer never ran. This is a product gap, found by the proof, not an environment fault and not a refusal of the Codex implementer. The phase stays open.

Spec: `docs/changes/delta_spec.md`, section "Plan v1.43 — PROJECTOS-STAGE4-EXIT-PROOF1A". Owner approvals (verbatim, 2026-11-18): "Approved" (the live proof, a $3.00 total cap,
the secrets-handling receipt, a new trivial agency phase writing `site/colophon.txt`) and "Yes to both, go ahead" (plan amendment v1.43 and the agency phase wording).
No product code was written or changed by this phase. The validator `val-projectos-stage4-exit-proof1a` was NOT built or registered: its own rule (SP-8) makes a proof with no closed
config-B attempt NOT PROVEN, so registering it would turn `validate-all` red; it is built when the proof can pass.

## What ran (evidence in `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A/`)

One ProjectOS runtime for every attempt: a throwaway worktree of the plan branch (`d47711561a82`) plus ONE temporary allowlist commit (`projectos/security/installation-project-allowlist.json`
only, `d7c685d4afb5`); never merged, never pushed. Agency: `C:/dev/SEOAgency`, branches forked from `work` at `a12115808abc`, pushed to the localhost remote only (nothing went to GitHub).
Each attempt is ONE bare `projectos continue --execute`, nothing relayed, no `--session`.

| Attempt | Config | Branch | Base | Result | Metered |
|---|---|---|---|---|---|
| A1 | A | `s4proof-a` | BASE1 `d23044a6` | stopped `CORRECTION_EXHAUSTED` (see "Why A1 failed") | 6,080 micro-USD |
| A2 | A | `s4proof-a2` | BASE2 `bae55991` | **closed** (reviewer APPROVE, gatekeeper approved, closure authority decided to close, exit 0) | 6,871 micro-USD |
| B1 | B | `s4proof-b` | BASE2 + swap commit `e845495` | stopped `CORRECTION_EXHAUSTED` (see "Why B1 stopped") | 7,083 micro-USD |

Metered spend in total: **20,034 micro-USD (about $0.02)** against $3.00; no run came near $1.50. Codex and Claude ran on the owner's logins and are not metered by ProjectOS.
`sha256` of each run log: A1 `4d4451ab861266d9e6e57fe2a8bea7c648b8bebbea6307f189d8849392e4a165`, A2 `8c376d9044fc1a5cd5c0e43c07cde5b57ff910d37f6e293de1448f19b3b997ef`,
B1 `c892e1c2fed85cf2890754427c998f55d5abde9d28b33263397391daa54da5ff`. No credential-shaped string appears anywhere in the evidence (checked over every file). The gatekeeper key was
read only inside the trusted broker, per the committed secrets-handling receipts (one per attempt, `decidedBy Murad`, words quoted).

## What WAS shown

1. **Config A works live** (A2): the Claude CLI implemented, validate-site passed, the Codex CLI independently reviewed in a different provider and kind and approved with no findings,
   the metered gatekeeper approved continuation, the closure authority decided to close, the phase closed. `site/colophon.txt` holds exactly the four lines; the effects record has all six
   flags false; the only non-`.projectops/` paths changed are `site/colophon.txt` and the loop's own closure report.
2. **The Codex implementer runs live end to end** (B1, first time ever): it was started under the Windows sandbox in the scratch checkout, wrote `site/colophon.txt` with exactly the four
   lines, `validate-site` passed after every attempt, and the scratch copy-back brought only that one granted path into the real tree (nothing else outside `.projectops/` changed; the effects
   record is all false). The write scope held on the first live run, and no tripwire over-refused an honest run.
3. **A provider swap by committed config alone is possible mechanically**: the only difference between A2 and B1 is one commit that changes the `execution` block of the agency's
   `project-config.json`; the source tree outside `.projectops/` is identical, and the runtime differs from the plan head by one allowlist file.

## What was NOT shown

1. **Config B did not close.** The Claude reviewer has still never reviewed live through its adapter: the loop never reached the review step in B1.
2. **A swapped run reaching the same end state** (the acceptance criterion) is therefore not met.
3. The evidence validator was not built (see above). Reads by absolute path stay open (D4); the Codex implementer's reads are not constrained; the proof shows what was recorded,
   not what any worker read. `providerDistinct` is by worker kind, not account or model.

## Why A1 failed (my phase text, fixed and recorded)

The agency phase text I committed (BASE1) required "validate-site passes in both its base copy and the phase's own copy". The loop records a phase copy
(`validate-site@phase-copy`) only when a phase edits the validator, and this phase edits none, so the evidence could only ever show one pass. The Codex reviewer rejected it three times with
one MEDIUM finding (`reviewer:F-001`), the Claude worker said honestly it could not change ProjectOS's evidence, and the loop stopped. This was a defect in the test phase, not in either
provider or in ProjectOS. BASE2 changed that one sentence to "The required validator validate-site passes." (one `.projectops/` file differs between the two bases; nothing outside
`.projectops/`). A1 stays in the evidence as a declared, committed, unedited attempt.

## Why B1 stopped (the product gap the proof found)

The Codex worker's findings record (`B1/records/findings.json`, unedited) lists two findings with `resolved: false`:

- **F1 MEDIUM** "Independent code review remains outstanding; no independent reviewer record is present." True when written, but the independent review runs only after the implementer's
  findings are clean, so an implementer that writes this can never clear it.
- **F2 LOW** "The checkout has no readable Git HEAD, so the stated baseline and complete change set could not be verified here." This is the scratch checkout, which by design has no commit
  (the risk named before the run: "scratch repo has no commit").

The loop counts every unresolved MEDIUM or LOW finding as work to correct. It re-ran the Codex worker three times; each time it re-wrote the same two findings, and then
stopped `CORRECTION_EXHAUSTED` (the gatekeeper "decided the work must not continue"). The Claude worker in A2 wrote one finding, already resolved, and no caveat about the review or HEAD.
Both workers receive the same loop instruction (`pointerInstruction`, `RECORDS_CLAUSE` in `loop/adapters/claudeCodeCli.ts`); the difference is how each model reads it. The instruction does not say
that the independent review and the platform's own checks belong to the loop and are not findings, and it does not say the checkout may have no history.

## Cheapest fix (its own plan phase, not done here)

1. **Instruction wording** (smallest): in the shared worker instruction, say that a finding is a defect in the worker's own work that it can fix; the independent review, the platform's
   checks and the absence of Git history in a scratch checkout are the loop's business and must not be listed as findings. Product code in `loop/adapters/claudeCodeCli.ts`
   (shared by both adapters), tests, validator pins.
2. **Scratch checkout with a commit** (more robust, removes F2 at the source): give the scratch repository one initial commit of the copied tree so `git rev-parse HEAD` works inside it;
   product code in `loop/scratchCheckout.ts`, with the existing byte-identity and never-copied-back-`.git` rules kept.
3. **Loop tolerance** (largest, a design decision): treat a finding about the loop's own outstanding steps as informational. Not recommended without the owner.

After the fix: a fresh B attempt (B2) on a new branch from BASE2 plus the swap commit, and re-judge. A is already proven and need not be re-run unless the runtime changes
in a way that touches config A (it would, because the shared instruction is shared: re-run A as well for a clean pair; the cost is about $0.007 each).

## Residuals (state, do not hide)

Reads by absolute path stay open (D4). The Codex implementer had not run live before this phase and has now run once, to a correct write with an uncorrectable self-report. Claude has
still never reviewed live through its adapter. The evidence is copied by the lead from the agency checkout and the installation state; a person who re-seals the manifest and records
consistently passes any check. Agency findings F3 (reads), F6 and F8 of the Codex implementer phase remain stated limits.

## State left behind

The throwaway runtime worktree (`C:/dev/ProjectOS-worktrees/exit-proof-runtime-v137`, branch `projectos-s4-exit-proof-runtime-throwaway`) and the localhost remote (started by PID, recorded
in `_handoff-v137/exit-proof-prep/githttp.pid`) are still in place for a B2. Agency branches `s4proof-base`, `s4proof-base2`, `s4proof-a`, `s4proof-a2`, `s4proof-b` exist locally and on the
localhost remote; `work` is untouched at `a12115808abc`. A mirror backup of the remote is at `C:/dev/SEOAgency-git-backup-s4`. Nothing was pushed to any real remote from this phase.
