# PROJECTOS-PORT-FOUNDATION1A — credit foundation for the V4 ports

**Phase:** PROJECTOS-PORT-FOUNDATION1A, phase 1 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.31 (active).
**Branch:** `projectos-port-foundation1a`, worktree `C:/dev/ProjectOS-worktrees/port-foundation1a`, based on `b0768486`.
Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete and one review round answered: ECC SECURITY and Agency software-architect, both
APPROVE WITH CHANGES at `44e7ef2c`. Item 11's delta correction is refused here, see "Review round". Full `validate-all`
is the lead's and was not run here.

This phase ports no upstream code. Nothing was run from a vendor folder.

## Delivered

| Item | File | Result |
|---|---|---|
| Notices | `THIRD_PARTY_NOTICES` | Entry format, five approved sources, the Pi / pi-mono note, an empty PORTED FILES section |
| Decision | `docs/adr/ADR-P1-port-ownership-and-credit.md` | Written. Status: Proposed, with the owner's approval of the delta stated |
| Validator | `projectos/validators/val-projectos-port-credit1a.cjs` | 23 rules, 125 fixture and 57 record mutations; registered in both runners |
| Records | ADR-S1, ADR-S2, `docs/recon/V4_Capability_Recon.md` | ADOPT recorded as superseding, in the owner's words, with the history kept |
| Port map | `docs/recon/V4_Port_Map.md` | §1 re-pinned, downloads named, PolyForm warning, changed OpenBot file noted, §2 and §7 updated, `isl-openbot` marked not approved |
| Plan | `docs/06_Plan.md` | Stages 3 and 4 expanded with phases 3.5 to 3.10 and 4.4 to 4.9. Nothing ticked, Log untouched |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| ADR-P1 states the owner's rule in the owner's words, what the owner may claim and what must be credited, the Apache-2.0 duties, and that a credit does not license non-commercial code | §1 to §5. PC-18 pins each, with 25 record mutations |
| A ported file with no header, no notices entry, an unknown source, or a source outside the approved list is refused by name, tested | PC-1, PC-5 and PC-3, with fixture mutations for each, plus a positive control |
| nightly-labs/openbot and any PolyForm source are refused by name, tested | PC-2, 19 fixture mutations, including punctuation, tab, no-break space, U+2011, zero-width and full-width spellings, split words, a short sha, and LobeHub |
| ADR-S1, ADR-S2 and the capability recon no longer say code is never copied, and they cite the owner's decision | PC-19, 15 record mutations, including one per record that says code is never copied |
| Validator pin and named mutations, each killed by its own rule | 182 named mutations. A fixture mutation counts only when exactly its named rule fires, plus any rule declared as also true of it |

## Sources checked

Licence text was copied by script from each project's own `LICENSE` file, so none of it was typed. Each block in
`THIRD_PARTY_NOTICES` hashes to that file's SHA-256, and the validator pins that hash.

| Source | Licence read from | Pin read from the zip's archive comment | `LICENSE` SHA-256 |
|---|---|---|---|
| hermes-agent | `incoming-2026-11-01/hermes-agent/hermes-agent-main/LICENSE` | `hermes-agent-main.zip`: `d3e5868…` | `821556e6…` |
| openclaw | `incoming-2026-11-01/openclaw/openclaw-main/LICENSE` | `openclaw-main.zip`: `c5b56f2…` | `9efd316e…` |
| copilotkit-openbot | `incoming-2026-11-01/openbot-upper/OpenBot-main/LICENSE` | `OpenBot-main (2).zip`: `c396a5f…` | `6d35a6bb…` |
| oh-my-hermes | `oh-my-hermes/oh-my-hermes-main/LICENSE` | `oh-my-hermes-main.zip`: `612a1cd…` | `51a61c86…` |
| rakazo | `rakazo/rakazo-main/LICENSE` | `rakazo-main.zip`: `bf78ebd…` | `b9738182…` |

- **Pi / pi-mono.** Its text comes from the Pi entry in OpenClaw's `THIRD_PARTY_NOTICES.md`, which is identical in the
  earlier clone and the 2026-11-01 download. ProjectOS holds no copy of Pi's own `LICENSE`.
- **Rakazo.** A case-insensitive search of its tree found no `NOTICE` file, so §4(d) adds no text. Its copyright line is `Copyright 2026
  Rakazo contributors`, verbatim.
- **OpenBot `server/src/computer/policy-network.ts`.** `cmp` confirms it differs between `4766e42` and `c396a5f`.
- **`isl-openbot`.** Its `LICENSE` is MIT, read and verified, and its pin is `c5f0527…`. It was dropped from the approved
  list in the review round: its embedded Apache-2.0 and BSD-3-Clause files could carry an MIT header.
- **LobeHub.** `docs/legal/vendor-provenance.md` line 54 records the Community License restriction, and Hermes
  `tools/terminal_tool_result.py:82` at the pin reads "ported from lobehub/lobehub#19329". It is on the denied list.
- **`openbot-lower`.** Never opened. Its folder name appeared in one listing of `incoming-2026-11-01`. The lowercase
  `openbot-main (1).zip` in Downloads was not read at all.

## Proofs

`node projectos/validators/val-projectos-port-credit1a.cjs`:

```text
val-projectos-port-credit1a: PASS (0 real file(s) judged; 125 fixture and 57 record mutations killed)
```

**The "0 real files" is deliberate and is not the proof.** The port directories hold nothing yet. `selfTest` always
runs, and writes its fixtures to one scratch directory, removed in a `finally`.

**Removing each rule.** A scratchpad harness, not committed, removed each rule body from an in-memory copy of the
validator and ran it against the real records. Result: 70 removals, 70 failed as they must, across 6 shards. Each removal made the run fail, naming that rule. It also
made the validator refuse everything, which the positive control caught, and refuse nothing, which the mutations caught.

**What the removals found.** An earlier harness run had two real survivors. Removing the climb check on an entry changed
nothing, because that fixture's path also did not exist, so "stale" fired instead. Removing the owner-store check changed
nothing, because that fixture's record was also untracked. Both proofs now isolate their rule, and the owner record gained
two more: a rejected decision, and one not decided by the owner.

**The git facts.** The fixtures inject what git knows, so `gitProofs` proves the reading itself. It builds a two-commit
repository in scratch with plumbing, so no hook runs, and confirms that an entry deleted in the later commit is still
reported. A directory that is no repository answers nothing, and `run` then refuses.

**The real tree, by hand.** Temporary files in this worktree, all removed afterwards:

| Case | Exit | Output |
|---|---|---|
| A first real port with its entry, in the header format of `44e7ef2c` | 0 | `1 real file(s) judged`, so `selfTest` no longer breaks on a real entry |
| A tracked `projectos/core/src/probe-stray.ts` with an upstream copyright | 1 | `PC-23 upstream mark outside the port directories` |
| Restored | 0 | `0 real file(s) judged` |

**A real defect the mutations found.** `adr-names-the-legal-holder-as-fact` survived on the first run. The check was
per line, so a false statement beside the word "unconfirmed" passed. It is now per sentence.

## Validators that read a touched file

No validator names `V4_Port_Map`, `ADR-S1`, `ADR-S2`, `V4_Capability_Recon` or `06_Plan`. Validators reading
`trust-boundary`, `validate-all` or `cached-runner` ran one process each, with `validate-no-secrets`: **34 of 34 PASS**, on the final
content, before it was committed. The two required validators were run again on the committed tree, and both passed.

## Corrections to the brief

- **ADR-S1, ADR-S2 and the recon were already amended.** Commit `be6059e8` added ADOPT with the owner's words on
  2026-10-29, so they no longer said code was never copied. What remained was the `## Decision: REFERENCE` heading,
  which still read as current. This phase added a superseding record, retitled that heading, relabelled the status
  line as "at the time", and retitled the recon's table as being about behaviours.
- **The plan number.** The delta says plan v1.30 carries phases 1 to 6. The active plan is v1.31. The delta is not in
  this phase's write paths, so it stays as it is.

## Review round at `44e7ef2c`

Each defect was reproduced first, with a scratch script against the committed validator.

| # | Reported | Reproduced at `44e7ef2c` | Now |
|---|---|---|---|
| H1 | A real entry fails `selfTest` | 2 errors, PC-16 stale | The fixture takes the notices above `PORTED FILES`, and a check proves a real entry cannot leak in |
| H2 | Upstream SPDX below our header | PC-6 | `End-Of-Credit-Header` ends our header. It is optional, so existing headers stay valid, and required only with upstream text below it |
| H3 | One pin per source | PC-4 on a true commit | `earlierPins` and `Earlier-Pins`. A file keeps its commit, and restamping it is refused because file and entry disagree |
| H4 | Further upstreams unmodelled | An unknown one passed; LobeHub passed | `FURTHER` plus approved sources. An unrecorded one is PC-9. LobeHub verified and denied |
| H5 | Header and entry can vanish | Both cases passed | PC-22, reading every path ever entered from git history |
| M6 | Original mark passes licence text | 5 of 6 passed | PC-10 refuses all six kinds |
| M7 | Denied spellings | 8 of 8 passed | NFKC, lowercase and non-alphanumerics stripped before matching; `7ef25fbc` prefix |
| M8 | `isl-openbot` | An MIT header passed on an Apache file | Off the list until its phase |
| M9 | Superlinear comment pattern | **A line of 30,000 spaces did not finish in over 100 s** | Trim first, then look at the ends; a 400,000-character line is a test |
| M10 | Marks outside `PORT_DIRS` | No scan existed | PC-23 over tracked source and tests. Test trees are judged |
| M11 | Records | See below | ADR-P1 and the notices corrected. The delta is refused |
| LOW | Six items | Confirmed by inspection: the script hung at M9 before reaching them | All six fixed, each with a mutation |

**Design calls made here.**

- **Test directories.** The port phases hold all of `projectos/core/test/` and `projectos/agent/test/`, and those trees
  already hold unmarked files. So a file there is judged only once it shows an upstream mark.
- **The owner record.** A `REMOVED` record points at a committed `.projectops/plan-decisions/PLANDEC-*.json` that says
  `approve`, has `decidedBy` Murad, and names the path. This validator only reads that store.
- **Cost.** The run takes about 14 s, up from 6 s.

### PORT-SEARCH1A's self-test failure

The report was 11 failures on `hybrid.ts`: 9 stale and 2 duplicated. **Neither suggested cause is right.** Its notices
have 10 entries with 10 distinct keys, and no basename repeats across directories. It was H1. The self-test fed real
entries into a tree without their files, giving 9 stale. The fixture also uses `projectos/core/src/search/hybrid.ts`, the
same path as the real port, so one key appeared twice and both copies were flagged, giving 2 duplicated.

| Check, read-only against `port-search1a` at `8b1efbf3` | Result |
|---|---|
| `selfTest` on this round's notices plus its 10 entries | 0 errors |
| `selfTest` on its notices as they stand | 3 errors, all from being based on `44e7ef2c`: the `isl-openbot` section, the Pi `Text-From` line, and the MIT count. Taking this round's text above `PORTED FILES` clears them |
| PC-16 on its entries | None |

The fixture now proves all of this directly. `projectos/agent/src/search/hybrid.ts` shares a basename and an upstream file
with `SEARCH`, and `tokenize.ts` names two upstream paths in one block, as PORT-SEARCH1A does. The duplicate check is not
loosened. The key stays full path, source and source path, and three mutations prove a real duplicate is refused.

**Two real findings in that worktree under this round's rules.** Neither is loosened here:

- **PC-10**, `projectos/core/src/search/index.ts`, line 3: a file marked original names OpenClaw in a comment. The fix is
  to drop the name, or to give the file a header if it holds ported code.
- **PC-23**, `projectos/validators/val-projectos-port-search1a.cjs`, line 85: it holds Pi's copyright line as a test
  string. The cheapest fix is for that validator to build the line from parts. Exempting port validators here would be
  a wider rule, and that is the lead's call.

### Item 11: the delta is refused

`docs/changes/delta_spec_V4_PORTS.md` is not in this phase's write paths, and it is a document the owner approved. A
coordinator's message cannot widen either, so it was not edited. The record that needed the correction is ADR-P1 §8,
which was extended.

**The fix.** The owner approves the change, or the plan adds that path to a phase's writePaths. It is a two-line edit:

- Line 26, replace with: "Original ProjectOS code and every change we make are the owner's, subject to the open
  legal-holder decision. The credit validator enforces the file header, the notices entry, and the approved and denied
  lists. Names and logos, claims and a false 'original' mark are for review: see ADR-P1 §8."
- Line 151, replace with: "**Licences:** the credit validator refuses a file in a port directory with no recorded
  source, and any upstream mark elsewhere in tracked source. It cannot see a port with every mark removed: see ADR-P1 §8."

## Limits

- **`docs/legal/` still shows earlier details.** `porting-convention.md` and `THIRD_PARTY_NOTICES.draft.md` name
  `THIRD_PARTY_NOTICES.md`, `PORTED_FILES.tsv`, `val-ported-file-provenance.cjs` and the earlier pins. They are outside
  this phase's write paths. ADR-P1 §10 says which wins.
- **The delta still says a validator enforces every row of the ownership rule.** See item 11. ADR-P1 §8 lists what it
  cannot: a false "original" mark on a file with its marks removed, upstream names in identifiers, sales claims,
  whether a `Source-Path` exists at the pin, shipping the notices with the product, per-file licences inside a source,
  and OpenClaw's own notice entries.
- **A rewrite under a new path is not seen.** A similarity check is advisory, feasible hash-only, and not a gate.
- **Only tracked files are scanned outside the port directories.** An untracked file there is seen once it is added.

## Open owner decisions

1. **The legal holder of original ProjectOS code.** ADR-P1 leaves it open and no file names a company.
2. **Formal acceptance of ADR-P1.** It is Proposed.
3. **The product name**, already open in the delta.
4. **The two-line delta correction** above.

## Commits

- `96d3a68b` feat(validators): the port credit rule, notices file and ADR-P1
- `06226536` docs(recon): record ADOPT as superseding and re-pin the port sources
- `44e7ef2c` docs(finish): PROJECTOS-PORT-FOUNDATION1A evidence
- `5a70d168` fix(validators): answer the port credit review round
- The evidence commit that adds this review round.
