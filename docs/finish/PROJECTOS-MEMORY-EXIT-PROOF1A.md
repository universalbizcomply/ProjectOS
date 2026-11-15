# PROJECTOS-MEMORY-EXIT-PROOF1A — Stage 3 exit proof: a fresh session resumes a half-done phase, live

**Phase:** PROJECTOS-MEMORY-EXIT-PROOF1A, the last phase of plan v1.36 (47/47 when closed). Evidence and one validator only: no product code, no model call added, no authority record changed. A green proof does not lift D4.
**Owner words it rests on, verbatim:** "you are on full autonomy now until this project is complete" and "That means you won't have to wait for me to write anything" (2026-11-14); "Full authority stands." (2026-11-13); and, for the provider spend, "yes, run the exit-proof pilot, $1.50 cap" (2026-11-15), given after the lead said the phase is a live pilot on `C:/dev/SEOAgency` that spends provider money (cap $1.50) and needs the owner's explicit yes first.
**Proof project:** SEO & Social Agency (`C:\dev\SEOAgency`, branch `work`, localhost remote), plan v1.5, phase `SEO-AGENCY-MEMORY-PROOF1A` (add `site/humans.txt` and five new `validate-site` rules with fixtures). Implementer Claude Code (`claude-local`); independent reviewer Codex CLI (`codex-reviewer`); gatekeeper and closure authority ChatGPT through the installation broker.
**Runtime:** an isolated, throwaway worktree of main `e404a82d` (`C:/dev/ProjectOS-worktrees/exit-proof-runtime-v136`, branch `projectos-exit-proof-runtime-throwaway`). It carries ONE extra commit, `3efb83ef`, a TEMPORARY `seo-agency` entry in the installation allowlist, because the broker reads that file from the installation's git object store. The branch is never merged, so main's allowlist is untouched and AG-5 stays green.

## What was proved

A governed phase run was cut off partway. A fresh process, started with one `projectos continue --execute` and nothing else, carried it to `closed` with no human-written text, and the loop's own ledger shows what the new worker was given.

| Step | When (UTC) | What happened |
|---|---|---|
| Run 1 | 2026-11-15 22:37:20 | `projectos continue --execute` (pid 5704). The loop admitted the run, built the brief, placed a context file and dispatched Claude. |
| Cut-off | 22:37:48 | The worker had written `site/humans.txt` (1 of the 3 phase files). A script killed the whole process tree (`taskkill /T /F`). The child exited 1. The work record stayed `WAITING_AI` ("dispatched claude-local"); the phase record stayed before review. No reviewer record, evidence or session record exists for run 1. |
| Run 2 | 22:38:05 – 22:39:53 (108 s) | ONE fresh process (pid 33112, a different parent): `continue --execute`, no `--session`, no `--objective`, no note. Claude was dispatched again, exited 0 on its first attempt; both `validate-site` copies passed; Codex reviewed by reading: **APPROVE**, no findings, `providerDistinct: true`; the gatekeeper approved (`GKREQ-e5a7c9115a9034d3a7830ecf`, 384 micro-USD); ProjectOS committed and pushed the work (`98f5c6b`), its run records (`5e2b5ac`), the closure records (`5138b5f`); the closure authority (`CLREQ-6aa39ed6a15776a0890777ff`, 6,196 micro-USD, ChatGPT) decided to close; the decision was committed (`583c078`) and the close persisted (`a121158`). Plan 5/5 complete, `work` = `origin/work`. Exit code 0. |

**Metered broker spend: 6,580 micro-USD (about $0.0066)** (the gatekeeper and closure calls) against the committed $1.50 phase cap. The ledger records only broker calls. Two things are NOT metered by ProjectOS: Codex, which ran on the owner's ChatGPT sign-in, and the Claude worker, which ran twice (the killed run and the resumed one) on the owner's Claude login.

### What the new worker was shown (the loop's ledger, hash-chained, 4 entries)

Run 1 (seq 1, 2) retrieved three committed items: the previous phase's closure decision (rank 1), the plan's current state, the plan. Nothing about an earlier attempt exists then.

Run 2 (seq 3, 4: retrieved, then placed for attempt 1; the evidence record's `storedContext` repeats the retrieval and names the same ledger hashes) held four items, no approved memory decision, one item withheld:

| Rank | Item | Kind | Tier | Source |
|---|---|---|---|---|
| 1 | `.projectops/closure/decisions/SEO-AGENCY-SITE-CHECK3A.json` | committed-decision | 0 | committed |
| 2 | `.projectops/plan-f3614f2ecf63116f-82af6c940086.json` (truncated) | plan-memory | 1 | committed |
| 3 | `resume:cut-off-attempt` (by RESUME1A's design: the work record's four closed values; 319 bytes) | execution-record | 2 | working-tree |
| 4 | `resume:dirty-paths` (by RESUME1A's design: the changed paths and hashes the loop observed; 1,346 bytes) | execution-record | 2 | loop-observed |

The committed evidence holds the ids, sizes, ranks and content hashes of these items, not their text: run 2's context file was retired by the loop before the checks, as designed, and is not kept. Run 1's placed file IS kept (`agency-records/run1.context.md`; its sha256 equals the ledger's `fileHash` for seq 1 and 2), so the file format and the retrieval of committed decisions can be read. Withheld: the current-state file, `COMMITTED_WORKING_TREE_DIFFERS` (the loop's own run had rewritten it, so the committed bytes were not what the tree held: it fails closed). `taintsRun` is true in both runs (it is true for run 1's committed-only set too, so it is not a resume signal). Both resume items rank below every committed decision and plan-memory item and are execution records, never decisions: worker-authored text did not rank as a decision.

## Acceptance criteria

| Criterion | Met | Evidence |
|---|---|---|
| One `continue --execute` from a fresh process carries the cut-off phase to closed, with no `--session` and no human-written text, recorded | Yes | `run2.invocation.json` argv is `[node, projectos.js, continue, --execute]`; log has one `projectos continue: run` line and none of `--session`, `--objective`, `--note`; closure `a121158`. Validator rules EP-2, EP-3, EP-6. |
| The ledger proves which retrieved items the new worker was shown and that none was worker-authored text ranked as a decision | Yes, for what was SHOWN and POINTED AT | Ledger seq 3, 4 and `run2.evidence.json`; validator rules EP-4, EP-5. See *What this does not prove*. |
| Phase spend under the committed $1.50 cap | Yes, for the metered broker calls | 384 + 6,196 = 6,580 micro-USD; rule EP-7. Codex and the Claude worker are unmetered (see above). |
| Validator pin and named mutations, each named after the rule body and killed by its own rule | Yes | `val-projectos-memory-exit-proof1a`: 9 rules, 226 named mutations (see `PROJECTOS-MEMORY-EXIT-PROOF1A-validator-notes.md`). |

## What this does not prove — said plainly

- **Shown is not read.** The ledger and the evidence record show the context file was retrieved, placed for the dispatch and named by the brief. Nothing records that the worker opened or used it. The worker's own transcript is not kept.
- **No control run.** The phase is small: `site/humans.txt` already existed in the tree, and a worker started from nothing could well have finished it. The proof of retrieval is the contrast in the ledger (run 1 had no resume items, run 2 had both), not a measured difference in outcome.
- **The cut-off was a deliberate kill** by a script the lead wrote, not a natural crash. Run 1's own console output was lost with the process. Run 1's context file was kept only outside the evidence folder.
- **Not zero owner involvement across the exercise.** Before run 1 the lead, committing under the owner's git identity (Murad) with a Claude `Co-Authored-By`, did the setup under the owner's words above: the plan source (`243d21c`), the plan decision recorded as "Murad approved" (`e3b264b`), the objective (`25b267d`), the activation (`8f873fc`) and the phase's `secrets-handling` receipt (`0ade0a9`, transcribed from the owner's message, `MANUAL_GOVERNANCE_APPROVAL, tamperProof false`); it also started the local git server and made the temporary allowlist commit on the throwaway branch. "Zero manual context relay" is claimed for run 2 only.
- The reviewer ran on the owner's ChatGPT login with text tripwires only (owner-accepted in Stage 1; revisit before untrusted code).
- The closure decision file in the evidence is the later version committed at `a121158` (it carries `consumedAt`); the log prints the hash of the earlier version presented at closure (`6a61c…`), so the two differ by that field.
- The evidence is copied into this repository by the lead from the agency checkout and the installation state; a person who edits those copies defeats the validator, as with every record in the programme. The manifest and the pinned log hashes make an accidental or careless change fail the validator; a person who re-seals the manifest and the notes hashes together with consistent edits passes every rule, and only the git history would show it.

## Existing code found (B1)

Everything used already existed: `projectos continue --execute`, the context manager and its installation-state ledger (CONTEXT-MANAGER1A), the resume state (RESUME1A), the reviewer route and gatekeeper (Stage 1 exit proof, `PROJECTOS-KERNEL-EXIT-PROOF1A.md`), `validate-zero-relay-continuity` as the style precedent. No product code was added or changed.

## Neighbour pins moved by the lead (truthful, none loosened)

The new validator is registered as the LAST entry in `validate-all.cjs` and `speed/cached-runner.cjs`, after `val-projectos-connector-contract1a`, so that `val-projectos-resume1a` RS-13 ("immediately before the connector entry") stays true. Two validators assumed the connector entry was last: `val-projectos-connector-contract1a` (CC-M, two mutations) and `val-projectos-port-computer1a` (CP-M, one mutation). Their mutation text now removes or anchors on the entry plus its trailing comma. Both still kill every named mutation (293; 306 behaviour and 120 text). Commit `1704d050`.

## Process notes

- **Incident (a builder, not the proof):** the validator builder ran `taskkill /F /IM node.exe` to stop its own runner and killed every node process on the machine, including any in the peer session `polygo-c3` and the local git server used by the proof (the proof was already pushed). Nothing in this repository depends on it. Future builder briefs must forbid killing processes by image name.
- The builder's note that the invocation's brief digest "does not match" the brief file was a misreading: the digest is the SHA-256 of the compact `JSON.stringify` of the brief, which does match; the validator pins it.

## Carried forward

- A no-resume control run (same phase, no retrieval) would turn "shown" into "made a difference".
- Record what the worker opened (a read receipt) if the proof is ever to say "used".
- Everything in `PROJECTOS-SKILLS-ADOPT1A.md` and `PROJECTOS-RESUME1A.md` residuals still stands, notably: no skill loads in production until the owner names what answers as the skill reviewer, and unrelated untracked files in a checkout block a resume.
- Stage 4.1: runner/session wiring leftovers, owner verifier, deletion command, ledger anchor, taint enforcement.
- The OpenAI key rotation remains due at project completion (owner: "Keep the current key").

## Reviews

Claude self-review (lead); ECC security-reviewer and ECC code-reviewer — see the closure record.
