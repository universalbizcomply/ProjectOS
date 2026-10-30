# PROJECTOS-KERNEL-REVIEW-READONLY1A — the reviewer reviews by reading; a refusal names why; a rejection carries its findings

**Phase:** PROJECTOS-KERNEL-REVIEW-READONLY1A, plan v1.24 (activation `aef3d07`, decision
`PLANDEC-438e9e95261457ce90c81384`). Owner answers it rests on, verbatim: "Yes, run it (Recommended)" and
"Accept tripwires (Recommended)" (2026-10-29); standing grant "You have full authority" (2026-10-28).
**Branch:** `projectos-autonomy-bootstrap1a` (worktree `host-review-path1b`).
**Exclusions honoured:** no owner gate, closure predicate or `ownerOnlyActions` changed; no tripwire narrowed
except git's own config-access warning line, matched exactly to git's default paths; a rejection still
credits nothing and stays non-approvable.

## What was wrong

The exit proof's second run (agency, 2026-10-30 10:56, after CODEX-UNC1A) stopped with the Codex review
refused again — "attempted tools it was denied" — with no record of which tripwire fired. Five traced
reviews of the same candidate (live Codex CLI 0.165.0, the loop's own instruction and adapter):

| Trace | Denial | Cause |
|---|---|---|
| 2 (UNC1A build) | none | — |
| 2a | `names a path outside the repository` | a Node probe script patching the validator source held the JS string `".."`, read as a parent escape |
| 2b | `stopped by the sandbox or an approval` | a probe step failed; its output carried git's own warning `unable to access '…/.config/git/ignore': Permission denied`, printed on every sandboxed git command |
| 2c | none | — |

Every false denial came from the reviewer writing and running scripts that execute the candidate's code.
With one sentence telling it to review by reading, **three of three** traced reviews ran no script, tripped
nothing, and still found the candidate's real defect (MEDIUM: `new Date()` accepts non-ISO `Expires`).

Separately: a REJECT whose findings are all MEDIUM reached the gatekeeper as "returned REJECT" with no
finding text, so its amendment "named no path to correct" and the run ended on the owner.

## Delivered

| # | Item | Tests / pins |
|---|---|---|
| 1 | `reviewInstruction`: review by reading only, inside the repository — read tools, and where a read-only shell was given, git diff/show/log and file reads; write, pipe or run no script; run no repository code (the loop already ran it). Worded true of both reviewers (a Claude reviewer holds no shell). | test; RV-2, 2 named mutations |
| 2 | A review refused for denied tools names the reasons: first five, each through the reviewer-text sanitiser (control, bidi, zero-width, tag characters) and cut to 120 characters, then "and N more". | loop test with escape, bidi, tag and over-long names |
| 3 | `reviewerObjection`: a REJECT with no CRITICAL/HIGH names its findings, most severe first, first five, then "and N more". Summaries were already inert and bounded at parse. `reviewPassed` and crediting unchanged; `REVIEW_OUTSTANDING` still offers the gatekeeper no approval. | 5 tests |
| 4 | Codex: a whole line `warning: unable to access '<…>/.config/git/ignore|attributes': Permission denied` is set aside before a failed command is judged as stopped by the sandbox. Any other quoted path, or other sandbox wording anywhere, still denies. | 3 positive, 7 negative tests; CX-15, 4 named mutations |

Commits: `acf6a3e` (implementation), `4ec1416` (review items), `434cbc1` (`validate-all` at `4ec1416` failed
RR-17 of `val-projectos-kernel-role-review1a`, which pins the refusal gate's exact text; the count is kept as
`reviewerDenials` and the names come from `reviewerDenialNames`).

## Reviews

- **Claude self-review** (lead), including the five traces and the three read-only traces.
- **ECC SECURITY review** (independent) at `acf6a3e`: **APPROVE WITH CHANGES**, no CRITICAL/HIGH. MEDIUM (the
  reading sentence sent a Claude reviewer, which holds no shell, to git; fail-closed availability) fixed with
  conditional wording; LOW-MEDIUM (the git warning's quoted path was unconstrained, so a hidden excludes file
  outside the checkout would lose its "steered" signal) fixed by pinning git's own default paths; LOW (denial
  names used a weaker sanitiser) fixed by reusing `inert`; LOW (first five in reviewer order) fixed by severity
  order. All in `4ec1416`, exactly as proposed; no further round, every change only tightens and is pinned.

## Verification

- Agent: `tsc` and `typecheck:tests` clean; the three touched suites 257/257; full suite 2913/2913.
- `val-projectos-kernel-followup1a`: PASS, 76 named mutations killed; RV-2 and CX-15 fire on the
  pre-change sources.
- `validate-all` at `434cbc1`: 152/155 PASS (the 2 known baseline failures, plus AG-5 from the owner-approved TEMPORARY seo-agency allowlist entry for the exit proof, by design).
- `validate-no-secrets`: PASS. No provider spend: the traces used the owner's ChatGPT sign-in in Codex's
  read-only sandbox.

## Carried forward (LOW)

- The reading sentence is an instruction, not a grant: a steered reviewer can ignore it, and the tripwires
  stay the protection. If Codex runs a probe anyway, a false denial is still possible (fails closed, and the
  stop now names it).
- A git warning for the default paths is set aside even when a command redirected `XDG_CONFIG_HOME` inside
  the checkout; the path tripwires cover redirects outside it.
- Unchanged from CODEX-UNC1A: quote-in-host UNC forms; UNC after `::`, `;`, `,` or `<`.
