# PROJECTOS-PORT-ROUTINES1A: routine floors

Plan v1.36 phase 1 of the port group (delta row 1, C13). Branch `projectos-port-routines1a`, base `d443a0fa`.
Status: built and committed on the branch. Not pushed, not merged, not closed: closure is the owner's.

## What this phase delivers

Pure core, no scheduler. A routine is a plan-approved record. The rules that stop a routine running too often or for
ever are constants and functions over that record:

- a five-field cron reader and a 15-minute floor that is checked over the next 200 occurrences,
- at most 20 enabled routines, and a routine switched off after its 10th failed run in a row,
- an unattended run held to P2 and below, with the refused request put on the owner's queue,
- one idempotency key per occurrence, so a replayed occurrence is refused,
- the routine prompt scan, applied when the record is approved.

Nothing is wired into the run loop. No gate was loosened or replaced.
Floors are constants, and a record has no field that changes one.
No dependency was added: `core` stays dependency-free.

## Existing code found (Code Bible B1, before any file was written)

Searched `core/src` and `agent/src` for schedulers, cron and occurrence logic, prompt scanning, retry and backoff,
idempotency, escalation, cost and connector code. Nothing schedules anything. What exists was reused, not copied:

| Found | Where | What this phase did with it |
|---|---|---|
| `deriveIdempotencyKey`, whose doc says the intent scope may be "a schedule's occurrence id" | `core/src/taskEnvelope.ts` | Reused as the occurrence key. The key is the one `mintEnvelope` would derive for the same intent. |
| `resolveAction`, `classAtMost`, `isActionName`, the registered `run-start` action (P2, local) | `core/src/actionRegistry.ts`, `security/action-registry.json` | The unattended class is read from the registry, never from the caller. A routine run is keyed as `run-start`. Nothing was added to the registry. |
| `firstThreat` and the strict threat scan (invisible characters, comments, oversize, injection, exfiltration) | `core/src/memory/threatScan.ts` | The routine prompt scan runs it first, then the Hermes cron patterns. No second invisible-character list. |
| The credit validator, notices file, header format | `val-projectos-port-credit1a.cjs`, `THIRD_PARTY_NOTICES` | Used as is. The shared commit `86f18e23` lists this directory, so the credit validator judges it. |
| `connectorContract` idempotency vocabulary, `gatekeeperModelPolicy` and cost ledger | `core/src/connectorContract.ts`, `gatekeeper*.ts` | Read, not reused: they concern connectors and model spend, and a routine run has neither here. |
| Retry and backoff | nothing in core or agent | The model broker (phase 2) owns it. Not built here. |

Everything this phase touched is inside the approved rows: `core/src/routines/`, `core/src/index.ts`, `core/test/`,
`THIRD_PARTY_NOTICES`, this phase's validator, the two registration lists and `docs/finish/`. The credit validator and
ADR-P1 §7 needed the new directory listed. That came from the shared commit `86f18e23`, merged into this branch, and
this phase does not edit either file.

## Ported files

Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry. All pins below are the commits inside
the owner's downloads of 2026-11-01.

| ProjectOS file | Upstream project | Source path | Pin | Licence | Strategy |
|---|---|---|---|---|---|
| `core/src/routines/cronSchedule.ts` | CopilotKit OpenBot | `server/src/routines/schedule.ts` | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` | MIT | ADAPTED |
| `core/src/routines/fatigue.ts` | CopilotKit OpenBot | `server/src/routines/runner.ts` | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` | MIT | ADAPTED |
| `core/src/routines/promptScan.ts` | Hermes Agent | `tools/cronjob_prompt_scan.py` | `d3e586881eacb132595edcbe4c170be8381e40c5` | MIT | TRANSLATE |
| `core/src/routines/occurrence.ts` | Hermes Agent | `cron/occurrences.py` | `d3e586881eacb132595edcbe4c170be8381e40c5` | MIT | TRANSLATE |

Original ProjectOS code, marked `// Origin: original ProjectOS code`: `routineRecord.ts`, `unattended.ts`,
`runAdmission.ts`, `index.ts`. `openbot-lower` (nightly-labs, PolyForm Noncommercial) was never opened. No xAI or Grok
path exists. Vendor folders were read only, and nothing was installed or run from them.

## What changed from the sources, and what was refused

- **No `cron-parser`.** The five-field reader and the occurrence walk are written here (delta assumption A9).
  `cron-parser` and its approval stay with the Stage 4 wiring.
- **Only UTC is read.** Upstream accepts any IANA zone through `cron-parser`. A zone other than `UTC` is refused
  (`SCHEDULE_TIMEZONE`) instead of guessed. A routine that must follow a local clock waits for the zone-aware parser.
- **Macros, a seconds or year field, `?`, `L`, `W` and `#` are unreadable.** Upstream's parser is lenient on those and
  relies on a field-count check; here the reader has no grammar for them.
- **An expression that never fires is refused** (`0 0 31 2 *`). Upstream swallows that case and fails later.
- **The second pair measure was not ported.** Upstream re-measures the pair ahead of the asking time as a backstop for a
  daylight-saving shift. UTC has none, and the case cannot be reached, so code for it could not be proved.
- **`describeCron` was not ported.** It is a wording helper for a page, and nothing here renders one.
- **The GitHub Authorization-header exemption was not ported** (it is Hermes's), and neither was the assembled-prompt scan or the
  ZWJ-in-emoji allowance. Nothing here loads a skill, and each of them only lets more text through. The shared scan
  refuses a zero-width joiner everywhere.
- **The agent cannot create a routine.** Upstream and Hermes let the agent create a cron job. Here a routine is a record
  with the plan decision that approved it, and a hand-built copy is not an admitted record.
- **A routine switched off for fatigue is re-enabled only by a new admitted record**, where upstream re-enables when a
  person asks in chat.
- **No model-judged approval and no no-approval mode was ported.** An unattended run is refused P3 and above, whatever
  its prompt says.

## Rules and where each is proved

| Acceptance criterion | Behaviour tests (`core/test/`) | Validator rule |
|---|---|---|
| A schedule that would run more often than every 15 minutes in any of its next 200 occurrences is refused, tested at 14 and 15 minutes | `routines-schedule.test.ts`: "refuses a schedule whose closest pair is 14 minutes apart"; "admits a schedule whose closest pair is 15 minutes apart: the control at the floor"; the third-occurrence gap | RT-1, RT-2 |
| A 21st enabled routine is refused; a routine is disabled after its 10th consecutive failure and stays disabled until a new approved record re-enables it | `routines-fatigue.test.ts`: the 20th admitted, the 21st refused; nine failures enabled, the tenth disables; the old record does not re-enable, a new one does | RT-4 |
| An unattended run asking for P3 or higher is refused and escalated, with a P2 control that is admitted | `routines-unattended.test.ts`: `implement` (P2) admitted with nothing sent; `commit`, `push`, `broker-call` (P3), `approve`, `payment-or-live-charge` (P5) refused and escalated once | RT-5 |
| Each occurrence derives one idempotency key, so a replayed occurrence is refused as a duplicate | `routines-occurrence.test.ts`: same key for the same occurrence, a new key for the next, equal to the envelope's key; a replay, and a replay in another offset, refused | RT-6 |
| A routine prompt that fails the prompt scan is refused at approval | `routines-record.test.ts` and `routines-prompt-scan.test.ts` | RT-3, RT-7 |
| Every ported file carries its credit header and a notices entry; the credit validator passes | credit validator, plus RT-10 in this phase's validator | RT-10 |
| The validator refuses any importer of this module outside its directory and tests | RT-9: the core barrel names the directory once and no product file names a rule | RT-9 |
| Validator pin and named mutations, each named after the rule body and killed by its own rule | `val-projectos-port-routines1a.cjs` | RT-1 to RT-15 |

Behaviour tests, one failing test per rule before the code: the six `routines-*.test.ts` files were written first and
failed to load (the module did not exist). The code followed, and they pass.

## Mutations

The validator compiles the real source, runs every scenario, removes one rule from the source and runs them all again.
A refusal counts as killed only when the refused call now goes through, so a refusal that merely changes name is not a
kill. The mutation results are in the validator's own output, quoted in Checks below. Table of named mutations:

| Rule | Behaviour mutations (each named after the rule body) |
|---|---|
| RT-1 | the-floor-is-14-minutes, a-gap-under-the-floor-passes, the-scan-reads-two-occurrences |
| RT-2 | a-sixth-field-is-accepted, an-over-long-expression-is-read, a-zone-other-than-utc-is-guessed, a-schedule-that-never-fires-is-approved, sunday-is-only-0, both-day-fields-must-match, the-next-occurrence-may-be-the-time-asked, seconds-are-ignored, the-walk-gives-up-after-a-year |
| RT-3 | any-decider-is-the-owner, any-decision-id-is-a-plan-decision, an-unknown-field-rides-along, a-run-needs-no-budget, a-record-skips-the-floor, a-record-skips-the-prompt-scan, a-copy-is-an-admitted-record |
| RT-4 | enabling-does-not-check-the-record, the-cap-is-21, an-enabled-routine-counts-against-itself, the-limit-is-eleven, the-limit-is-nine, a-success-keeps-the-count, a-skipped-run-counts-as-a-failure, a-switched-off-routine-takes-more-outcomes, the-old-record-re-enables, any-routines-record-enables |
| RT-5 | the-ceiling-is-p3, the-ceiling-is-p5, nothing-is-escalated, a-full-queue-lets-it-through |
| RT-6 | the-claim-is-not-asked, the-offset-spelling-is-kept, the-key-omits-the-occurrence, a-slot-can-be-invented, a-zone-less-instant-is-read, a-switched-off-routine-runs, any-state-runs-any-record, a-run-does-not-check-the-record, the-run-has-no-budget, the-run-is-keyed-as-another-action, the-run-action-is-unregistered |
| RT-7 | the-shared-threat-scan-is-skipped, rm-rf-root-is-prose, visudo-is-prose, an-ed25519-key-may-be-read, the-patterns-are-case-sensitive, the-text-is-not-folded |

RT-8 to RT-15 carry text mutations of their own (a clock, a timer, the filesystem, the network and the agent in core;
a wired caller; a dropped header, entry or pin; an upstream name in an identifier; a cron library; a dependency; a
refused mode; a dropped export; an unregistered validator; a skipped test; a lost limit in a header or in this record).

## Refusals that are not mutations (stated, not proved)

- The local Hermes exfiltration patterns (`curl` and `wget` with a secret variable) overlap the shared scan, so no
  prompt reaches them alone. They are ported as data and have no mutation of their own: removing one changes nothing a
  test can see.
- An action the registry does not know is P5 and is refused unattended. That is the registry's rule (R5), proved in
  `action-registry.test.ts`, and `routines-unattended.test.ts` repeats it for one action.

## Checks

Run in this worktree after the merge of `86f18e23`; exit codes read, counts copied from the output. `validate-all` was
not run here (the lead runs it serially).

| Check | Result |
|---|---|
| core `npx vitest run` | exit 0: 65 files, 2994 tests passed (the six `routines-*` files are 112 of them: schedule 33, record 20, occurrence 18, fatigue 15, prompt scan 15, unattended 11) |
| core `npm run -s build` | exit 0 |
| `val-projectos-port-routines1a` | exit 0: PASS (59 scenarios; 52 behaviour and 57 text mutations killed) |
| `val-projectos-port-credit1a` | exit 0: PASS (68 real files judged; 152 fixture and 59 record mutations killed) |
| `validate-no-secrets` | exit 0: PASS |
| validators that read a touched file | search1a PASS (17 files; 113 text, 25 behavioural mutations); memory1a PASS (20 rules; 197 mutations); approvals1a PASS (83 scenarios; 64 text mutations); kernel-followup1a PASS (88); tenant-contract1a PASS (346); tenant-credentials1a PASS (279); tenant-principal1a PASS (210); tenant-csp1a PASS (106); connector-contract1a PASS (38 rules; 293 mutations) after the registration fix below; validate-speed-validation-cache PASS; validator-scratch-lifecycle1a PASS; v3-validation-evidence1a PASS |
| skills1a, context1a | skills1a exit 0: PASS (21 rules; 440 mutations); context1a exit 0: PASS (18 rules; 320 mutations). Both timed out at 280 s in the first batch loop (exit 124) and were re-run alone with a 900 s limit (128 s and 383 s). |

**Registration order.** `val-projectos-connector-contract1a` pins that its own entry is the last in both lists, and
refused a list with this phase's entry after it. This phase is therefore registered in `validate-all.cjs` and
`speed/cached-runner.cjs` immediately before the connector entry, in the same place in both. The other port phases that
register after this one will meet the same pin and should insert before that entry as well.

Mutation results come from the validator's own output above: each mutation is applied to the source in memory and
counted only when its named scenario or rule moved, so the PASS line means every one was killed by its own rule.
An earlier run in this phase found two finish-record mutations that survived (the pinned word also appeared elsewhere in
this record); they were fixed by making each mutation replace every occurrence and the pin a heading, not by loosening
a rule.

## Residuals

- **Only UTC is read.** Zone-aware schedules come with the Stage 4 parser and its dependency approval.
- **The reader checks the shape of an approval, not the approval.** That `decisionId` names a committed owner decision
  with this plan digest is for the wiring to check against the committed bytes.
- **A state is data the store holds.** `RoutineState` is a plain frozen object; the store that reads it from committed
  records must refuse one it did not write. The reader's admitted-record set is per process.
- **The owner queue is a port the caller supplies**, and so is the occurrence claim. This phase proves what they are
  asked, in what order, and what happens when they say no. It does not provide a queue or a ledger.
- **The assembled-prompt scan is not ported.** When a routine can load a skill (Stage 3 skills), that scan is a decision
  for that phase.
- **A routine's own prompt is scanned once, at approval.** An admitted record is frozen. A wiring that reads records
  from files must admit each one again, which scans again.
- **Review:** ECC SECURITY and Claude self-review are required by the plan; both are the lead's to run on this commit.
- **The `waiting` outcome counts as neither a failure nor a success.** The fatigue source this phase was given
  (`runner.ts`) calls a store for the failure count and does not say how a waiting run is read there. Treating it as
  neutral is this phase's choice, stated in `fatigue.ts` and proved by a test.
- **The cap of 20 comes from the delta and the port map** (OpenBot `store.ts`, not among this phase's sources). The value
  is pinned here; the store that enforces it in OpenBot was not read.

## Converge (Code Bible B9)

Compared the code against the phase entry in `docs/projectos-finish-phases.json`, the approved delta row 1, ADR-P1 and
the V4 port map row C13.

**Built, per acceptance criterion:** all eight. The 14 and 15 minute floor over 200 occurrences; the 21st enabled
routine refused and the tenth failure in a row switching a routine off until a new admitted record; P3 and above refused
and escalated unattended with a P2 control; one key per occurrence and a replay refused; the prompt scan at approval;
credit header and notices entry on every ported file and the credit validator passing; the unwired fence; the pin and
named mutations.

**Unbuilt (inside the delta, not in this phase's scope):**
- `projectos/agent/src/routines/` and its tests (the delta lists an agent directory for routines). This phase was core
  only, by instruction. Nothing reads routine records from git yet, and nothing enqueues to a real owner queue.
- The envelope call itself. The occurrence key equals the one `mintEnvelope` would derive; admission through the
  envelope is the Stage 4 wiring.
- Metering of the per-run budget. The record carries it and admission returns it; nothing spends against it.
- Zone-aware schedules and `cron-parser` (A9: approved for later, with the Stage 4 wiring).

**Behaviour drift from the sources (each stated above and in a file header):** UTC only; no second pair measure; no
`describeCron`; no GitHub Authorization-header exemption or ZWJ allowance; a disabled routine re-enables only through a
new admitted record; an agent cannot create a routine; a never-firing expression is refused.

**PROTECTED files touched:** one, `projectos/validators/validate-all.cjs`, by two added lines (a comment and the
registration), the registration-only edit the delta approved. `projectos/speed/cached-runner.cjs` has the same two
lines. `git diff d443a0fa --stat` shows no other file from `docs/00_Baseline_State.md` §4 or the delta's Zone 3:
`actionRegistry.ts`, `taskEnvelope.ts`, `permissions.ts`, `gatekeeper*`, `run.ts`, `host/**` and `action-registry.json`
are untouched, and `core` gained no dependency (the validator pins the dependency list empty).

## Final state

Built and committed on `projectos-port-routines1a`. Not pushed, not merged, not closed. The remaining steps are the
lead's: `validate-all` (only `val-cd-b4` may fail), the ECC SECURITY review, and the owner's closure.
