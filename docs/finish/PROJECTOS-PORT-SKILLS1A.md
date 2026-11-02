# PROJECTOS-PORT-SKILLS1A — skill validation and promotion (C9)

**Phase:** PROJECTOS-PORT-SKILLS1A, phase 4 of `docs/changes/delta_spec_V4_PORTS.md`, plan v1.33 (active).
**Branch:** `projectos-port-skills1a`, worktree `C:/dev/ProjectOS-worktrees/port-skills1a`, based on `374f9eaf`. Not pushed,
not merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.
**State:** one review round answered, at the commits below. Neither review has seen the fixes. Full `validate-all` is the lead's and was not run here.

Nothing was run from a vendor folder, `openbot-lower` was not opened, and `.projectops/` was not touched.

## Delivered

| Item | File | Result |
|---|---|---|
| Frontmatter | `projectos/core/src/skills/frontmatter.ts` | A closed YAML subset read line by line, CRLF and BOM folded. Pure |
| Hidden text | `projectos/core/src/skills/hiddenText.ts` | The classes memory refuses, plus surrogates, private use, U+2800 and what a renderer drops. Pure |
| Threat patterns | `projectos/core/src/skills/guardPatterns.ts`, `guard.ts` | 135 patterns, every repeat bounded. Pure |
| Python audit | `projectos/core/src/skills/sourceAudit.ts` | A linear token scan in place of Python's `ast`. Pure |
| Linter | `projectos/core/src/skills/linter.ts` | Errors block and warnings inform, by named rule. Pure |
| Validator pass | `projectos/core/src/skills/skillPackage.ts` | Caps first, then shape, then text. Holds the package hash. Pure |
| Promotion | `projectos/core/src/skills/promotion.ts` | Build, check, decide, promote, read. Owner-only review, a hashed origin. Uses `HashPinnedProposal`. Pure |
| Prompt block | `projectos/core/src/skills/prompt.ts` | The one way a skill reaches a prompt. Pure |
| Queue | `projectos/agent/src/skills/skillQueue.ts` | Propose, list, review and promote, reject, load, on the `System` port |
| Credit | `THIRD_PARTY_NOTICES` | 17 entries. Ten files credited; `refusal.ts` and both barrels are marked original |
| Tests | `projectos/core/test/skills-*.test.ts`, `projectos/agent/test/skillsQueue.test.ts` | 376 core, 47 agent |
| Validator | `projectos/validators/val-projectos-port-skills1a.cjs` | 21 rules, 440 named mutations, about 45 seconds, in both runners |

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A skill failing the linter or audit cannot be promoted, by a named rule, tested with a passing control | `skills-promotion.test.ts`, `skills-package.test.ts`. The refusal carries `named` and every finding. It holds at proposal, at decision and at promotion, and for a forgery that reached the queue. PK-5, PK-6, PK-7, PK-8 |
| A promoted skill changed by one byte is stale, tested | `checkPromotedSkill` hashes again on every read. A byte, a CRLF, a BOM, a Unicode form, a renamed or added file each move the pin. PK-10, and in the agent through a real record |
| Skill text is data: an instruction inside a skill grants nothing, tested | A skill saying it is approved stays pending, needs the same review, and renders with `authority: 'none'` and `grants: []`. The string sent is the string scanned. PK-6, PK-13 |
| Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry; the credit validator passes | `val-projectos-port-credit1a`: PASS. PK-18 also pins the exact upstream files each one credits |
| Validator pin and named mutations, each killed by its own rule | 440 mutations. See "How the mutations run" for what that does and does not prove |

## What replaced what

| Upstream | Here |
|---|---|
| `skill_manage` lets an agent create and patch skills | An agent only proposes. `reviewAndPromoteSkill` is the one route, and PK-16 pins one writer |
| The curator rewrites skills in the background | Not ported. Nothing runs on a timer |
| Hub install, `--force`, trust levels, `builtin` never scanned | Not ported. No source is exempt and there is no override |
| `.skillignore` excludes files from the scan | Refused as a forbidden file |
| An unlisted file extension is skipped unread | Refused by `file-kind`. Every file is listed text, and every file is scanned |
| Lines inside `"""` are not scored | Scored. In a `SKILL.md` that skip would hide any line |
| Comments and denylist lines are demoted, `sudo` in Markdown is demoted | No demotion. The context that earns one is the author's own text |
| Malformed YAML falls back to splitting on colons | Refused, so a reviewer and a loader cannot read one file two ways |
| The audit returns nothing for source it cannot parse | `unreadable_source` blocks |
| Size findings are medium or low | Refusals, asked before anything is read |
| A finding quotes the matched line | A finding names file, line and rule. It never repeats the text, which may be a key |
| `sha256(path + NUL + bytes)` over the tree | Each file hashed alone, then the list of pairs, so text cannot pose as the next file |
| An audit finding is a hint | It blocks. There is no way to force it |

**The pattern table, by script against upstream.** 142 upstream rows hold 140 ids, of which 7 are structural and became named
package rules, and `invisible_unicode` became `hiddenText`. The rest all arrive with the same severity. After the review round many of
them are narrower than upstream, because gaps are bounded and no two wide repeats nest, and a long enough gap now misses. Otherwise: `html_comment_injection` is
dropped, because every comment is refused with no keyword; two ids that shared a name are split (`shell_profile_mod`,
`setuid_mention`); four `hermes_*` ids became `agent_home_*` and also match `.projectops`; `governance_record_mod` is added;
`role_hijack` is narrowed as memory narrows it.

**Credit is wider than translation.** `promotion.ts`, `prompt.ts` and `skillQueue.ts` hold no line from a skill file upstream. They
are adapted from `memory/proposal.ts`, `memory/prompt.ts` and the memory queue, which are credited ports, so they carry those
credits with `Port-Strategy: ADAPT`. Marking them original would have claimed code that came through a port.

**Not ported, on purpose:** the name-directory rule and the reference-count rule (a package has no directory here, and the file
cap is lower), the upstream author and `metadata.hermes` rules, platform and environment matching, and the three-stage loader.

## Reviews and dispositions

Round 1, at `bc380ee2`: **ECC SECURITY accepted with conditions, two HIGH. ECC CODE approved.** The findings reached this builder as
one decided list from the coordinator, which did not say which review raised each item, except that the HIGHs are the security
conditions. The tests were written first: 24 core and 8 agent tests failed before the source changed, some of those only because a
fixture needed the new field. Neither review has seen the fixes.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | HIGH | A double-quoted `\t` decoded after the scan, so `"ignore\tall\tprevious\tinstructions"` passed, promoted and rendered | **Fixed.** `\n` and `\t` are refused like every other escape. `deliveredSkillText` builds the string the prompt sends, and the validator scans that exact string. A folded description that only joins into an attack is caught by this, which the first fix alone would miss |
| 2 | HIGH | Nested 512-wide repeats: `sed -i ` 33 s on 1 MB, `dd if= ` 2.7 s on 262 KB | **Fixed.** Both now cost under 0.3 s at 1 MB. PK-21 fails the class twice over: a static rule on the product of wide repeats in each alternative, limit 4,096, and a clock per pattern on 30 hostile shapes and on each pattern's own sample cut short. The clock also caught `translate_execute` and `python_compile_exec`, and the static rule listed 16 patterns, all narrowed. The caps already came first in the pass; they now also come before the hash on a read |
| 3 | MEDIUM | A self-chosen `advisor` with a fresh session promoted, and a hand-written record renders | **Fixed in part, as decided.** `SKILL_REVIEWER_ROLES` is owner-only. A hand-written record still renders, so signing is BINDING below |
| 4 | MEDIUM | No record of where a skill came from | **Fixed.** A hashed `origin`, kept in the pin. `imported` needs the owner as proposer, and a resealed import by an agent is refused. See Limits |
| L | LOW | `</untrusted-skill>` | **Fixed.** `fence-forgery`, in any file, for the memory tag too |
| L | LOW | `writeWhole` duplicated `writeFileAtomically` | **Fixed.** Imported. `agent/src/memory` is outside the write paths, so the validator lifts that one function unchanged into its scratch copy, and PK-14 mutates it where it lives. PK-16 allows one call |
| L | LOW | `SKILL_NAME` omitted Windows device names | **Fixed.** `skillNameProblem(name)` |
| L | LOW | A corrupt active record blocked a rejection | **Fixed.** The active hash is read only for an approval |
| L | LOW | No per-author cap | **Fixed.** Ten of the fifty |
| L | LOW | `<path>.tmp` followed a write | **Fixed** in this phase's wrapper, which clears the path first and stops if it cannot. The memory write itself still follows a planted link, and memory is outside the write paths. That belongs in `memoryFiles.ts` |
| V | Coordinator | A probe that throws must not count as killed | **Fixed.** Nine mutations had been killed only by a crash. Each now has a probe that answers, or a mutant that runs |
| C | CARRY | Homoglyphs, HTML entities and base64 | **Carried**, see Limits |
| C | CARRY | No export from `agent/src/index.ts` | **Carried**, matching memory and search |

## Defects found by the proofs

- **Upstream's dangling-link rule catches the sentence's full stop.** `See references/a.md.` read as a missing `a.md.`. Kept, fixed
  here, with its own mutation.
- **A cubic pattern.** `md_link_exfil` took 5.7 seconds on `[a](http://` repeated to the cap, with two 512-wide repeats nested.
  It now starts at `](`. This first look covered one shape, and it missed the two the review found.
- **Open repeats the first translation kept.** `[ \t]*`, `\d+`, and `[A-Z0-9]*(?:_[A-Z0-9]+)+`. PK-21 reads every compiled source
  and refused them.
- **Dead checks.** The mutations `tab-indent-allowed` and `nested-lists-allowed` survived, because the key rule and the scalar rule
  already refuse those. Both lines are gone.
- **Weak proofs.** Removing `Cf` survived until a character that is `Cf` and not default-ignorable was added (U+FFF9). `[//]:` outside
  Markdown, a nested call as an argument, a missing version beside missing tags, and an id climbing out of the queue each needed a
  probe that the mutation could not pass. All are now in both the tests and the validator.
- **A quadratic I introduced.** `import:import:import` read every statement to its end. The read is now bounded at 256 tokens.
- **Input that threw.** A request whose files are not strings threw. It is now refused as `not-a-package`.
- **What the memory review caught, applied here first.** `containsSecret` runs at the prompt, and the comment forms it listed
  (`[x]: <>`, `[x]: # '…'`, `[ // ]: #`) and U+2800 are refused.
- **The write tool and the shell handle escapes differently.** `Write` keeps `\\` and decodes `\uXXXX`, and a heredoc through Bash loses
  backslashes. So the source builds invisible characters with `String.fromCodePoint`, and PK-3 refuses a raw one. The two curly
  quotes in `deception_hide` are literal, and visible.

## Proofs

```text
val-projectos-port-skills1a: PASS (21 rules; 440 named mutations killed)
val-projectos-port-credit1a: PASS (47 real file(s) judged; 147 fixture and 59 record mutations killed)
validate-no-secrets: PASS
core whole suite: 50 files, 2,232 passed (376 of them skills)
agent: skillsQueue 47, memoryQueue and searchIndex with it, 182 passed
tsc core: clean. tsc agent/src/skills and its test, through the alias: clean
```

**Validators that read a touched file.** A scratchpad script selected 72 by a text match and ran each in its own process, four at
a time, at `9031c712`: **71 pass**. The one failure is below. `val-cd-b4-production-ipc-provider1a`, the six-minute Rust fixture, was left out. It reads none of
these files.

**One failure that is not this phase, and that `validate-all` will show.** `val-cd-b4-sealed-expected-window-facts1a` fails with
`V2 session_digest is public` in `projectos/host/core/src/ipc_session.rs`. It is registered in `validate-all`. This branch changes
nothing under `projectos/host`, and neither that file nor the validator. So it should fail the same at `374f9eaf`, though it was not
run there. It was not investigated further, and it needs a look on `main`.

**How the agent tests ran.** With a scratchpad config aliasing `@projectos/core` to this worktree's source, as
`docs/finish/PROJECTOS-PORT-SEARCH1A.md` describes. After a merge, build `core` before the agent tests.

## How the mutations run

The unmutated source runs every probe, which is the positive control. A probe that throws fails that run and kills no mutation. A
mutation runs every text rule, and the behaviour probes of
the rules it names and no others. **This is weaker than the memory validator**, where a mutation runs every probe. An early run did
nearly that here, and found 33 mismatches, all answered, so cross-rule firing was seen once. It is not held from now on: a mutation
proves its own rule fires, and does not prove that another rule's behaviour probes stay quiet.

**The cut may have been larger than it needed to be.** That run took four minutes, and scoping was the first answer. Profiling then
showed most of the time was the timed mutants, and shrinking those took the scoped run to under a minute. A full run at today's sizes was
not measured. Going back means running every group for every mutation and retuning the `also` lists.

**PK-21 uses wall-clock budgets.** A real run takes milliseconds against budgets of 500 and 750, and a slow mutant takes seconds. A badly
starved machine could fail the real run. The shapes are a list, so a new pattern with a new word needs one, and the static rule is what
holds in between. It counts negated classes and `\S` only, so a wide repeat over a listed class passes it: the mutation
`a-slow-pattern-the-static-rule-cannot-see` is there to show the clock catches that.

**The behavioural copy is not the build.** It runs under type stripping with imports rewritten, and a stand-in for
`authoringEvidence.js`. PK-15 pins that import, and `skillsQueue.test.ts` uses the real one.

## Binding on the phase that wires skills in

- **Export it.** `agent/src/index.ts` is outside this phase's write paths, so nothing can reach the queue yet.
- **Supply `SkillActor` from something stronger than the caller.** Independence is by actor and session, and both are asserted until
  owner proof exists. The queue takes them from the kernel and never from a request, and nothing proves them.
- **BINDING: sign the pin before any loader reads it.** A hand-written promoted record renders today. Nothing loads one yet, and nothing may
  until the pin is signed.
- **Make the actor kernel-issued before widening `SKILL_REVIEWER_ROLES`.** It is owner-only for that reason, and D11 roles wait for it.
- **Ignore or sign `.projectops/skills/`.** See Limits.
- **Run nothing from `scripts/`.** A package may hold scripts, and no code here runs them. Running one is a C14 action under that
  policy, not something a promotion allows.

**From the ECC recheck, binding on the same phase.** Nothing loads a skill yet, so none of these is live.

- **BINDING: sign the pin or kernel-issue the actor before any loader reads a promoted skill.** A self-asserted `owner` plus a second
  label still promotes, and a hand-written promoted record still renders.
- **BINDING: the kernel sets `origin`.** Today it comes from the request and defaults to `proposed`.
- **BINDING: an import needs an owner design.** A single owner label cannot promote an import. That is a safe dead end, not a route.
- **BINDING: close the bounded-repeat evasions.** The 64 bound lets a 70-character path to `.env` evade `py_read_secrets_file` and
  `js_read_secrets_file`. A `sed` with 5 or more arguments before `-i` evades the critical `agent_config_mod_shell`, and only the low
  `agent_config_ref` still fires. Both were run against the stacked build, with a short-path and a 4-argument control that fire.

## Limits

- **Only the owner role reviews, and the owner does not review the owner.** So a skill the owner proposed, which includes every import, needs a
  second actor holding the owner role. There is one owner today, so **an import cannot be promoted under one label.** The fix is a decision:
  let the owner review an import in a separate session, since the owner did not write that text. It was not made here, because it loosens
  an authority rule.
- **`origin` is what the caller states.** An agent can paste outside text and call it `proposed`. The review is what catches that.
- **The pin is a hash, not a signature.** Anyone who can write `.projectops/skills/` can reseal a proposal, hand-write a record that passes
  every check, or put back an older promoted record. The hash detects a change. Today's rules still run on such a record, and
  it still grants nothing. Signing belongs with owner proof.
- **`.projectops/skills/` is not git-ignored,** so a cloned or PR-borne record counts, as memory's does.
- **The state of a proposal is not hashed.** A file changed from `rejected` to `pending` reads as pending. It still needs an independent
  review over its hash.
- **The patterns are a list.** A miss proves nothing. They do not decode base64, HTML entities or `\uXXXX`, and they do not fold cross-script
  look-alikes (homoglyphs). That is why a promoted skill stays fenced. The scan reads the whole file, so a phrase split over lines is seen, and one
  split across two files is not.
- **False positives have no override.** A legitimate skill that says `sudo apt install` is refused until reworded, and so is a doc link
  three levels up. That is the safe way to be wrong, and a reviewer cannot wave it through.
- **Refusing default-ignorable characters refuses emoji with a joiner or a variation selector.** The same limit as memory.
- **A reference title on its own line, and `<details>`, are not refused.** The first is rare, and the second stays visible when opened.
- **The Python audit reads names.** `g = globals()` and other indirection pass it, and it reads only `.py`. An import list past 256
  tokens is not read to its end.
- **`SKILL.md` is the exchange format, not the store.** A promoted package is one JSON record, so pin and text land in one rename, and
  it holds the exact text of `SKILL.md`. There is no export command yet.
- **A fence is a statement to a model, not a boundary.** What protects ProjectOS is that model output reaches nothing without the
  kernel's gates.
- **Upstream names.** Patterns still match `.hermes`, and `.clawhubignore` is named so it can be refused. These are paths to detect, not
  branding. Review should sweep this, as ADR-P1 §8 says.
- **The credential check is the agent's vocabulary,** so a credential with no known shape passes it.

## Commits

- `7f2b11dc` feat(skills): skill linter, audit and promotion through a validator
- `4ee9636a` fix(skills): what the mutation run and self-review found
- `89eb4fa2` feat(validators): the skill rules, run against the real source
- `7007036f` fix(skills): spell the fake access key in two parts
- `bc380ee2` docs(finish): PROJECTOS-PORT-SKILLS1A evidence
- `9031c712` fix(skills): answer the skills review round
- The evidence commit that adds this review round.
