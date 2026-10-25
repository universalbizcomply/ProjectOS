# PROJECTOS-BOOT-CONTINUE1A — awaiting closure

**Phase:** PROJECTOS-BOOT-CONTINUE1A, phase 1 of plan v1.8 (`plan-fad4d5ff8d67abc8-bbf6214dc32b`)
**Evidence subject:** `48de278` on `projectos-autonomy-bootstrap1a` (one commit on the activation head `a2425cf`, pushed, remote-verified)
**Closure route:** owner-direct, under the owner's general grant of full authority. No gatekeeper closure ruling was obtained, and none is claimed.

## What the phase delivered

**Safety**
- An owner gate written as prose now reserves every action that can be delegated. A gate list that can't be read reserves everything too. The brief is checked against a fresh derivation from the plan.
- G4-11 reads only this phase's own runs that the runner recorded. Every run must attest that no protected effect happened. Any doubt counts as an effect.
- Every configured check runs under a bounded, recorded timeout. A timeout is never a pass.
- A stale interactive gatekeeper question is cleared with `--supersede-stale-request`. It is archived with a record, never deleted. A question that was already answered and acted on is never revived.

**Continuation**
- `run --continue` treats selection stops as results. A phase awaiting closure is handed to the closure route, and a finished plan ends as complete. A defect ends with a non-zero exit code.
- `projectos continue` is one entry point. It routes to `run`, `closure prepare`, `closure request` or `closure resume`, and adds no authority of its own.
- `closure prepare` builds the closure evidence, the validation record and the report from the run's own records. It re-runs the checks on the pushed commit and commits nothing.
- `closure resume --owner-wait-minutes` waits, up to a bound, for the owner's commit, and can be resumed later.
- The implementer may write only the paths the approved scope names, after normalisation and containment checks. Any new hidden content under a grant stops the run. The Speed-programme source grant is retired.

## Evidence

| Item | Result |
|---|---|
| Required validators (6) and `val-projectos-boot-continue1a` | PASS |
| validate-all | 144/146. Failures: validate-desktop-e2e and val-cd-b4-sealed-expected-window-facts1a (known, unchanged) |
| Agent tests | 2465/2465 |
| Core tests | 765/765 |
| Typecheck (all) | clean |
| Named mutation battery | 50/50 killed, each by its own rule |
| ECC SECURITY | cleared after 5 rounds; 0 CRITICAL, 0 HIGH open |
| ECC CODE | approved after 3 rounds |
| Live disposable two-phase proof | PASS: 8 invocations, 4 relays, 6 owner commits, 1 restart; both phases closed |

## Carried forward

- **Medium:**
  - The review claims in prepared closure evidence are still the worker's own, labelled as such.
  - The scope exclusion vocabulary is open-ended. A structured field for write paths is planned.
  - G4-11's every-run rule can leave a phase needing the owner route.
- **Low:** L4 (configuration argv forms not policed), L5 (hard links and device names beneath granted directories), L6 (a timed-out check stops only its direct child).
- **For the next plan:**
  - The scopes of BOOT-UNATTENDED1A and BOOT-CERT1A name no file paths.
  - G4-1 limits closure to the project id `projectos`.

Off-tree evidence is in `C:\dev\ProjectOS-candidate-backups\boot-continue1a\`.
