# PROJECTOS-KERNEL-CORRECTION-PATHS1A — a rejected review is corrected by the implementer and reviewed again; a correction the gatekeeper asks for names its files

**Phase:** PROJECTOS-KERNEL-CORRECTION-PATHS1A. Plan v1.25 (activation `a5d5b32`, `PLANDEC-616920b1533e51f1ebf404c0`),
widened by v1.26 (`18055ac`, `PLANDEC-4e064b43a167a4d45dd53d87`) and v1.27 (`9001de4`,
`PLANDEC-cbcab1119d5ddd1cd0e33fc9`).
**Owner decisions, 2026-10-30, verbatim:**
- "Claude fixes, re-review (Recommended)" — on an independent rejection, the loop re-runs the same implementer
  with the reviewer's findings, writing only the files the plan already approved for the phase, up to the
  existing limit of three corrections, then re-runs the checks and gets a fresh independent review; no new
  permissions; a rejection still never counts as a pass.
- "Yes, reword it (Recommended)" — approving the edit of the PROTECTED rule BC-8n
  (`val-projectos-boot-continue1a.cjs`) to state that one exception.

Standing: "Yes, run it (Recommended)" (2026-10-29); "You have full authority" (2026-10-28).
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`).
**Exclusions honoured:** `correctionBoundary.ts` unchanged (a gatekeeper amendment still only narrows the
phase's correction maximum and is refused when it names no permitted path); no owner gate, closure predicate
or `ownerOnlyActions` changed.

## What was wrong

The exit proof's third run (agency, 2026-10-30 12:40) was the first clean cross-provider review: Claude
implemented, Codex reviewed by reading (`providerDistinct: true`) and returned REJECT with two real MEDIUM
findings (permissive `new Date()` for `Expires`; empty `Expires` lines not counted). The gatekeeper, now shown
them, answered AMENDMENT_REQUIRED with a precise instruction — and the loop refused it: "the amendment named
no path to correct". Two layers:

1. The gatekeeper was never told to name files; its evidence said only "Edit(path) and Write(path) only", and
   it copied `Edit(path)` as its allowedActions. The reviewer cited `validate-site.cjs:195` with no folder.
2. Deeper (ECC SECURITY F1): the production `run` command never supplies a correction maximum (always empty),
   and by design a correction maximum may not include the phase's own implementation files. So an
   independent rejection had **no fix route at all**; every rejection ended on the owner.

## Delivered

| # | Item | Commit | Tests / pins |
|---|---|---|---|
| 1 | **Rejection route.** On an independent REJECT (or CRITICAL/HIGH finding) with budget left (`attempts < 3`): doctor preflight; count one correction; re-issue exactly the phase's approved write grant through the per-attempt slot (consumed and cleared by the next dispatch); log the rejected record's digest and findings; re-dispatch the implementer. Checks re-run; a fresh review (new nonce, recomputed digest) follows. A rejection credits nothing; with the budget spent the run stops `REVIEW_OUTSTANDING` and a configured gatekeeper is asked as before. A review that was not obtained re-grants nothing. | `3e8832f`, `9077c4a` | 4 loop tests; RC-1 (positional: inside the rejection branch, behind the doctor, slot assigned exactly three ways), 5 named mutations |
| 2 | The Claude correction instruction also points at the reviewer record beside the evidence record and asks it to correct every finding listed there, whatever its severity. It says where to read, never what. | `3e8832f` | 1 test; RC-1 |
| 3 | **BC-8n reworded** (protected, owner-approved): the approved grant reaches the first dispatch and the one dispatch after an independent rejection (RC-1); the rule fires if the grant is named anywhere else. | `9077c4a` | 2 named mutations (gatekeeper correction carrying the grant; re-grant outside the budget) |
| 4 | Gatekeeper evidence: `howToAskForACorrection` — name every file by its full repository-relative path from `workerWritableMaximum`, with an example, with forward slashes, and no other file. With an empty maximum it says plainly that no file is correctable. The `Edit(path)` placeholder is gone. | `5f262a1`, `3e8832f` | 2 loop tests; GK-1, 5 named mutations |
| 5 | Reviewer instruction: cite every file by its repository-relative path, with a JSON-quoted example (the example is an implementer-controlled path). | `5f262a1`, `3e8832f` | 1 test, including a hostile path; RV-3, 2 named mutations |

## Reviews

- **Claude self-review** (lead).
- **ECC SECURITY review** (independent):
  - at `5f262a1`: **APPROVE WITH CHANGES**, no CRITICAL/HIGH vulnerability. F1, high for purpose: no
    production correction maximum, so the phase as first built could not achieve its goal. This led to the
    owner's decision and plan v1.26. F2 (`.txt` targets cannot be named; carried), F3 (raw example
    interpolation) and F4 (unpinned clauses) were fixed in `3e8832f`.
  - recheck at `3e8832f` (the one recheck the pace allows): **APPROVE WITH CHANGES**, no CRITICAL/HIGH. The
    re-grant is contained to the next dispatch; the budget is shared and monotone; a fresh review always
    follows; CRITICAL/HIGH going to the implementer first is acceptable.
    - MEDIUM governance, BC-8n: passing its text check was not compliance. Fixed by rewording BC-8n on the
      owner's approval (plan v1.27).
    - LOW-MEDIUM: a final APPROVE overwrote the record of the rejected rounds. Partly fixed: the log keeps
      each rejected digest and its findings. Carried: a durable evidence field.
    - LOW F4: the RC-1 pins missed the doctor and the branch position. Fixed and mutation-tested.
    - LOW: the budget restarts per `--resume` invocation. Carried.
  - No further round. Every change after the recheck applies its own proposals or the owner's wording, and is
    pinned and tested.

## Verification

- Agent: `tsc` and `typecheck:tests` clean; full suite 2921/2921.
- `val-projectos-kernel-followup1a`: PASS, 88 named mutations; RV-3, GK-1 and RC-1 fire on the
  pre-phase sources.
- `val-projectos-boot-continue1a`: every rule but AG-5 passes. Its 18 named mutations, including the two new
  BC-8n ones, are each killed by their own rule; AG-5 co-fires while the temporary allowlist entry stands.
- `validate-all` at `9077c4a`: 152/155 PASS (the 2 known baseline failures, plus AG-5 from the owner-approved TEMPORARY seo-agency allowlist entry for the exit proof, by design).
- `validate-no-secrets`: PASS. No provider spend in this phase.

## Carried forward

- **The exit proof's own correction write paths.** The re-grant is the phase's approved writePaths grant, so
  the agency phase's three files are what the implementer may correct — exactly as on its first dispatch.
- `pathsNamedIn` (protected `correctionBoundary.ts`) recognises only .ts/.tsx/.js/.cjs/.mjs/.json/.md, so a
  gatekeeper amendment cannot name a `.txt` file. This only bites when a correction maximum exists, and the
  production `run` still supplies none; wiring one is an owner design decision.
- A durable record of rejected review rounds needs a `RunEvidence` field (protected `verification.ts`); today
  the console log and `session.corrections` keep it.
- The correction budget restarts per `projectos run --resume` invocation (`session.corrections` is written,
  not read).
- Untested: an ordinary retry after a re-grant carrying no grant (enforced by BC-8n's exact count and RC-1's
  slot check), and rejections sharing the budget with failing checks.
