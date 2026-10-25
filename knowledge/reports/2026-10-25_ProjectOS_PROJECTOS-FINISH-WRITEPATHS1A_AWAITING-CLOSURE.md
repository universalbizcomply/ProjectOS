# PROJECTOS-FINISH-WRITEPATHS1A — awaiting closure

**Phase:** PROJECTOS-FINISH-WRITEPATHS1A, phase 1 of plan v1.9, amended as v1.10 (`plan-0b32a3adb9da9521-72bcf9b170cf`) to carry writePaths
**Evidence subject:** `2078ef0` on `projectos-autonomy-bootstrap1a` (one commit on the activation head `aabdf9c`, pushed, fast-forwarded to `main`)
**Closure route:** owner-direct, under the owner's general grant of full authority. No gatekeeper closure ruling was obtained, and none is claimed.

## What the phase delivered

- **Write grants are data.** A worker may write exactly the paths in its phase's `writePaths` list. The scope sentence grants nothing, and the negation-word list is gone. A bad list refuses the run.
- **Validators judge from the base commit.** A phase's required validators run from the commit the phase started at, so a worker cannot weaken the check that judges it. Closure preparation uses the same commit.
- **What a worker creates under a grant is checked.** Agent instruction files, hook or settings directories, and a file grant turned into a directory all stop the run.
- **Plan v1.10.** Every phase of the plan now carries its `writePaths`.

## Proof

- agent 2496/2496, core 765/765, typecheck clean; validate-all 145/147 (known 2).
- 25 named mutations, each killed by its rule; 17 also by a test.
- Pinned to the base commit, the five required validators give 4 PASS and 1 designed FAIL (the old validator asserts what this phase retires) — the pin working on the real repository, and the reason for the owner route.
- ECC CODE approved; ECC SECURITY's one HIGH fixed in a single fix round.

Full evidence, review dispositions and carried items: `docs/finish/PROJECTOS-FINISH-WRITEPATHS1A.md`; closure evidence: `.projectops/closure/PROJECTOS-FINISH-WRITEPATHS1A.json`.
