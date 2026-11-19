# PROJECTOS-STAGE4-EXIT-PROOF1A — validator notes

Validator: `projectos/validators/val-projectos-stage4-exit-proof1a.cjs` (rules SP-1 to SP-9, named mutations). Built and registered on 2026-11-19, after config B closed live as attempt B2.
Evidence: `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A/` (a manifest of sha256 covers every file). Finish record: `docs/finish/PROJECTOS-STAGE4-EXIT-PROOF1A.md`.

## What the notes must say (the validator reads these lines)

This phase wrote no product code and made no model call: the live runs are recorded in the evidence, and this validator only reads files. The proof does not lift D4: reads by absolute path stay open, a green proof shows what was recorded, not what any worker read, and `providerDistinct` is by worker kind, not by account or model.

Stated plainly: the closed runs ran on different runtimes. Attempt A2 ran on the runtime recorded in `runtime.json` (the plan head `d4771156`, before the plan v1.44 fixes, plus the one temporary allowlist commit). Attempt B2 ran on the runtime recorded in `B2/runtime.json` (the plan head `c9e8188e`, with the v1.44 fixes, plus the same one allowlist commit). The owner skipped the re-run of A as A3 on the new runtime on 2026-11-19, and approved plan v1.45, which replaced "one runtime" in SP-2 with "each attempt records its own runtime, which differs from its plan head only by the temporary allowlist file" (`docs/changes/delta_spec.md`, section "Plan v1.45"). The source tree outside `.projectops/` and the phase text are identical across A2 and B2.

SP-4 as amended by plan v1.45: an APPROVE with no unresolved MEDIUM, HIGH or CRITICAL finding. B2's Claude reviewer wrote one unresolved LOW (a verification limit: the read-only reviewer cannot run `git diff`); it is kept as the reviewer wrote it and bound to the evidence by hash.

## Attempts (each is declared in `setup.json`, has its folder and an outcome that matches its log)

- attempt A1: stopped. Config A on BASE1; stopped CORRECTION_EXHAUSTED on an acceptance sentence the loop cannot evidence (my phase text, fixed in BASE2). Kept as evidence, unedited.
- attempt A2: closed. Config A on BASE2: Claude implements, Codex reviews, closed.
- attempt B1: stopped. Config B on BASE2: the Codex implementer wrote the file, but its own two unresolved findings (the review is outstanding; no readable Git HEAD) stopped the loop CORRECTION_EXHAUSTED before the reviewer ran. Kept as evidence, unedited.
- attempt B2: closed. Config B on BASE2, on the runtime with the v1.44 fixes: the Codex implementer wrote the file with no findings, the Claude reviewer approved, closed.

## sha256 of each run log

- A1/run.log sha256 `4d4451ab861266d9e6e57fe2a8bea7c648b8bebbea6307f189d8849392e4a165`
- A2/run.log sha256 `8c376d9044fc1a5cd5c0e43c07cde5b57ff910d37f6e293de1448f19b3b997ef`
- B1/run.log sha256 `c892e1c2fed85cf2890754427c998f55d5abde9d28b33263397391daa54da5ff`
- B2/run.log sha256 `0a45ab88cb5f0cb1b00eb182997c24715e4c443b6bc1fdaf45cccf09681838db`

## Spend

Metered broker calls (the OpenAI gatekeeper and closure questions) in total across the four attempts: 26,319 micro-USD, under the $1.50 per run and $3.00 total caps. Codex and Claude spend is unmetered by ProjectOS (the owner's logins).

## Changes made to the evidence after it was first committed (stated, not hidden)

- `B2/setup.json` (a draft of mine, committed in `68bb4462`) was replaced by `B2/runtime.json`; its attempt data moved into the B2 entry of `setup.json`. `setup.json` gained the B2 attempt and the 2026-11-19 owner approvals. `MANIFEST.json` was regenerated. No loop record, log, outcome or digest was edited; `B2/source-digest.json` was re-derived once with the right base branch (the first run used the wrong default, BASE1) and `B2/run.log` was checked byte-identical.

## Limits

An edit of logs and records made consistently, with the manifest and these hashes re-sealed, passes every rule: the mutations are a brake for accident, not a defence against a forger. The proof is one small phase, once in each direction.
