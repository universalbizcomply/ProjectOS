# PROJECTOS-KERNEL-EXIT-PROOF1A — Stage 1 exit proof: cross-provider review and a refusing cap, live

**Phase:** PROJECTOS-KERNEL-EXIT-PROOF1A, the last phase of plan v1.27. Evidence only.
**Owner decisions it rests on, verbatim:**
- "Yes, run it (Recommended)" (2026-10-29): the live exit proof under the caps.
- "Codex CLI (OpenAI) (Recommended)": the second provider.
- "Keep the current key".
- "Raise to $1.50": the phase cap.
- "Accept tripwires (Recommended)": see *What was accepted* below.
- "Yes, temporarily (Recommended)": the agency allowlisted for this proof only.
- "Claude fixes, re-review (Recommended)" and "Yes, reword it (Recommended)" (2026-10-30).

Standing grant: "You have full authority" (2026-10-28).
**Proof project:** SEO & Social Agency (`C:\dev\SEOAgency`, branch `work`, localhost remote), plan v1.4, phase
`SEO-AGENCY-SITE-CHECK3A`: `site/.well-known/security.txt` (RFC 9116) and new `validate-site` rules with
fixtures. Implementer: Claude Code (`claude-local`). Independent reviewer: Codex CLI 0.165.0 (`codex-reviewer`,
OpenAI). Gatekeeper and closure authority: ChatGPT through the installation broker.
**Logs** are committed beside this file in `PROJECTOS-KERNEL-EXIT-PROOF1A/`, by sha256:

| Log | sha256 |
|---|---|
| run 1 | `0683a7d9da59675ce4242f300e225d17db8d2aae5babf7ba5c8b14ba0b4f9d02` |
| run 2 | `bd7f1cb9f2b216f3042d4f4960e3c0779f217ffb35fb54c271ee0e6924df73b4` |
| run 3 | `a8190faccb10e371deb38f91c5dd96cfceffd25e49518ca27d8b2133cef5c965` |
| run 4 | `fb8cf27b88043f2ed9202f4c7bd62541e3cedcf04bc74d9853125552f1bbbd7d` |

## How it went — said plainly

It did **not** close from the capped run plus one `continue`, as planned. It took four live runs and three
small governed fix phases in ProjectOS. Each fix came out of what a live run showed. Those fix phases needed
their own plan amendments, two owner decisions and owner-direct closures, so **total owner involvement across
the four runs was not zero**. The zero-owner-act claim is for the agency's proof run only (run 4).

| Run | When (UTC) | Result | What it showed / what fixed it |
|---|---|---|---|
| 1 | 2026-10-30 09:30 | Stopped — **deliberate cap refusal** | The metered gatekeeper call was refused before it was made: "estimated at $0.001355; the phase has spent $0.00, so it would reach $0.001355 and cross the per-phase cap of $0.000001" (`GKREQ-4bfc24adceb5683ac1d2a326`; no ledger or decision record exists for it). The Codex review was also refused: a false positive in the UNC tripwire (a quoted `"\\nExpires"` in a reviewer probe script). The handover's suspicion that the worker had not written `security.txt` was wrong: run 1's evidence record lists it, and it was 151 bytes. **Fix: PROJECTOS-KERNEL-CODEX-UNC1A.** |
| 2 | 10:56 | Stopped (`REVIEW_OUTSTANDING`) | The Codex review was refused again; traces showed Codex's own probe scripts trip the tripwires (`".."`, git's sandbox warning). **Fix: PROJECTOS-KERNEL-REVIEW-READONLY1A** — review by reading; a refusal names its denials; a rejection carries its findings. Spend $0.000412. |
| 3 | 12:40 | Stopped (`REVIEW_OUTSTANDING`) | First clean cross-provider review: Codex REJECT, two real MEDIUM findings (R1 permissive date parsing; R2 empty `Expires:` not counted). No fix route existed for a rejection. **Owner decision and fix: PROJECTOS-KERNEL-CORRECTION-PATHS1A** — the implementer corrects a rejection within the approved files and the 3-correction budget, then a fresh review. Spend $0.000468. |
| 4 | 17:34–17:42 | **CLOSED from one `continue`, zero owner acts** | Below. |

**Between runs**, Claude made these commits in the agency under the owner's git identity (Murad), each carrying a
Claude `Co-Authored-By`, as setup under the owner's decisions:
- `3bbe408` raised the phase cap from the deliberate 1 micro-USD to 1,500,000 (owner: "Raise to $1.50").
- `a8a790e` and `297ccaf` committed runs 2 and 3's spend and gatekeeper decisions.
- Each run's candidate was preserved outside the tree and discarded.

The agency's `secrets-handling` receipt `122654e` is likewise a Claude transcription of the owner's chat
answers, committed under the owner's identity (its record says "Transcribed by the implementer (Claude)",
`MANUAL_GOVERNANCE_APPROVAL, tamperProof false`).

## Run 4 (the proof)

One `projectos continue --execute` in `C:\dev\SEOAgency` at `297ccaf` (itself an owner-identity setup commit,
above).

1. Claude implemented; `validate-site` passed in its base and phase copies.
2. Codex reviewed by reading: **REJECT**, MEDIUM `R-001`, at record digest `606c0462…`. Claude corrected
   (correction 1 of 3).
3. Codex again: **REJECT**, MEDIUM `R-001` (an impossible calendar date accepted), at digest `e1fd2e3c…`. Claude
   corrected (2 of 3).
4. Codex: **APPROVE**, no findings.
5. The gatekeeper (`GKREQ-0f686f655139d456ddd64cb2`, $0.000401) approved `CONTINUATION_READY`. ProjectOS
   committed the work (`69d5107`) and its records (`da1cbe3`), and pushed both.
6. The log then prints `STOPPED (OWNER_DECISION_REQUIRED): … awaiting_closure`. That is the run loop handing
   over, not a wait: the same `continue` carried on into the closure route.
7. The closure route prepared the records (`e727895`). The closure authority
   (`CLREQ-ac344179cc60345d942bee00`, $0.006351, `decidedBy: ChatGPT`; broker provenance in the log and the
   phase history) decided to close. ProjectOS committed the decision (`4766735`) and persisted the close
   (`d6c50f5`). The phase is `closed`; the agency plan is 4/4; `work` equals `origin/work`.

The five run-4 commits (`69d5107`–`d6c50f5`) are authored and committed by "ProjectOS implementer"; none is
the owner's. The two rejected review records were overwritten by the next review. They survive only as log
lines with their digests, and `R-001`'s wording only in the implementer's own findings — the
durable-record gap carried from CORRECTION-PATHS1A.

## Acceptance criteria

| Criterion | Met | Evidence |
|---|---|---|
| Recorded reviewer provider differs from the implementer provider for the proof phase | Yes | `.projectops/execution/SEO-AGENCY-SITE-CHECK3A-297ccaf18da1-2ee75e8f.reviewer.json` as committed in `69d5107`: `claude-code-cli`, `codex-cli`, `providerDistinct: true`, `APPROVE`. Its sha256 (`282d2928…`) equals the `reviewerSha256` in the committed evidence record; closure bound to it (`reviewsComplete: true`). |
| A cap refusal is recorded before any network call | Yes, for the metered gatekeeper call | Run 1 log: "the ProjectOS spend limit refused this gatekeeper call before it was made". No ledger entry or decision record for `GKREQ-4bfc24adceb5683ac1d2a326`. (Codex had already made unmetered calls under the ChatGPT sign-in in that run.) |
| Zero owner acts for the proof phase beyond the gates the plan names | Yes, for the agency proof phase's run 4 | One `continue` to `closed`. The only owner gate exercised was the plan-named `secrets-handling` receipt (`122654e`, before run 1). The plan also names `payment-or-live-charge`; it was not exercised, because the phase touched no payment, so no receipt was needed. Not zero across the whole exercise: see above. |

**Spend for the proof phase:** 7,632 micro-USD (about $0.0076) across the metered calls of four runs
(412 + 468 + 401 + 6,351, per the committed ledger), against a $1.50 phase cap. The design routes the OpenAI
key only through the installation broker, and the ledger records only these broker calls. Codex ran on the
owner's ChatGPT sign-in, which ProjectOS neither meters nor caps.

## What was accepted ("Accept tripwires")

The Codex reviewer runs as the owner and can read `~/.codex`, which holds the ChatGPT login. Its only
protections are text tripwires on the commands it reports and a credential-shaped-reply check. The adapter
itself says these are heuristics that a command built to hide a path can evade. No tripwire and no reply
withholding fired in run 4. The owner chose to revisit this before Codex reviews untrusted code.

## The output

`site/.well-known/security.txt` carries exactly the four required fields. `validate-site` passes and
`validate-site.fixtures` passes 27/27. The run-3 rejections are enforced in `validate-site.cjs`: R1, permissive
date parsing; R2, an empty `Expires:` not counted. The fixtures cover non-ISO and impossible dates; **no fixture
covers an empty `Expires:` line** (carried). Run 4's `R-001` was the impossible calendar date.

## After the proof

- The TEMPORARY `seo-agency` allowlist entry is removed (`381acb1`; file restored byte-for-byte to `d8ec61e^`).
  AG-5 passes, and `val-projectos-boot-continue1a` passes with all 18 named mutations, including the two new
  BC-8n mutations, killed by their own rules.
- `validate-all` at `381acb1`: 153/155 PASS (the 2 known baseline failures: validate-desktop-e2e needs a Control Centre bundle, val-cd-b4-sealed-expected-window-facts1a V2; AG-5 green again).

## Reviews

- **Claude self-review** (lead).
- **ECC SECURITY review** of this evidence against the agency's committed records: APPROVE WITH CHANGES, no CRITICAL/HIGH; all six checks PASS on the committed agency records; corrections applied (one overstated fixture claim, owner-identity commits by Claude, fix-phase owner involvement, what Accept tripwires accepts, run logs committed with sha256).

## Carried forward

- No agency fixture for an empty `Expires:` line.
- From the three fix phases:
  - UNC quote-in-host and prefix gaps.
  - The reading rule is an instruction, not a grant.
  - `.txt` paths cannot be named in an amendment.
  - No production correction maximum (an owner design decision).
  - No durable record of rejected review rounds.
  - The correction budget restarts per resume.
- Codex can read the owner's ChatGPT login; tripwires only (owner-accepted; revisit before untrusted code).
- The OpenAI key rotation remains due at project completion (owner: "Keep the current key").
