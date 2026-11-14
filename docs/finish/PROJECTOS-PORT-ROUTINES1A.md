# PROJECTOS-PORT-ROUTINES1A: routine floors

Plan v1.36 phase 1 of the port group (delta row 1, C13). Branch `projectos-port-routines1a`, base `d443a0fa`.
Status: built and committed on the branch. Not pushed, not merged, not closed: closure is the owner's.

## What this phase delivers

Pure core, no scheduler. A routine is a well-formed record that names a plan decision. The rules that stop a routine
running too often or for ever are constants and functions over that record:

- a five-field cron reader and a 15-minute floor worked out exactly for the whole expression,
- at most 20 enabled routines, and a routine switched off after its 10th failed run in a row,
- an unattended run held to P2 and below, with the refused request put on the owner's queue,
- one idempotency key per occurrence, so a replayed occurrence is refused,
- a run admitted only now (not from the future, not past a catch-up window), for its own tenant, one at a time per
  tenant, project and routine, spaced from the last claimed occurrence and inside a budget for the window for the
  routine and for the project,
- the routine prompt scan, applied when the record is read.

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
- **The floor is the exact smallest gap the expression can produce.** Upstream walks the first 200 occurrences from a
  fixed date. Review round 1 showed that walk misses a gap that only occurs where the day fields line up late
  (`0,59 0,23 */2 * 1,2` fires 2025-03-31 23:59 and 2025-04-01 00:00). Here the closest two times of day and the
  midnight wrap are measured, and the wrap is counted only if the day fields can match two calendar days in a row,
  found by walking every day of one 400-year cycle. Every occurrence is covered, so the next 200 are too.
- **A record that names a plan decision is not an approval.** Upstream and Hermes let the agent create a cron job. Here
  a routine needs a record that names a plan decision, says the owner decided, and carries a plan digest. The reader
  checks that form and nothing more; a hand-built copy is not an admitted record, and whether the named decision
  exists is the wiring's check.
- **The run is admitted through ports.** The clock, the claim ledger, the in-flight guard, the last-claim and spend
  reads and the owner queue are injected, and each must answer exactly `true`, or a number or time of the right kind.
  Upstream has none of these bounds.
- **The prompt scan is linear.** The command-shaped patterns are judged a line at a time with simple tests joined by
  "and", the prompt is capped at the record's limit, and common Cyrillic and Greek lookalikes are folded to Latin first.
- **A routine switched off for fatigue is re-enabled only by a new admitted record**, where upstream re-enables when a
  person asks in chat.
- **No model-judged approval and no no-approval mode was ported.** An unattended run is refused P3 and above, whatever
  its prompt says.

## Rules and where each is proved

| Acceptance criterion | Behaviour tests (`core/test/`) | Validator rule |
|---|---|---|
| A schedule that would run more often than every 15 minutes in any of its next 200 occurrences is refused, tested at 14 and 15 minutes | `routines-schedule.test.ts`: "refuses a schedule whose closest pair is 14 minutes apart"; "admits a schedule whose closest pair is 15 minutes apart: the control at the floor"; the third-time gap; the wrap across midnight, a month end and a year end, and the controls for it | RT-1, RT-2 |
| A 21st enabled routine is refused; a routine is disabled after its 10th consecutive failure and stays disabled until a new record that names a different plan decision re-enables it | `routines-fatigue.test.ts`: the 20th admitted, the 21st refused; nine failures enabled, the tenth disables; the old record does not re-enable, a new record id under the same decision does not, one under a different decision does | RT-4 |
| An unattended run asking for P3 or higher is refused and escalated, with a P2 control that is admitted | `routines-unattended.test.ts`: `implement` (P2) admitted with nothing sent; `commit`, `push`, `broker-call` (P3), `approve`, `payment-or-live-charge` (P5) refused and escalated once | RT-5 |
| Each occurrence derives one idempotency key, so a replayed occurrence is refused as a duplicate | `routines-occurrence.test.ts`: same key for the same occurrence, a new key for the next, equal to the envelope's key; a replay, and a replay in another offset, refused; the bounds on a run (future, catch-up, in flight, spacing, budget, tenant, ports) | RT-6 |
| A routine prompt that fails the prompt scan is refused at approval | `routines-record.test.ts` and `routines-prompt-scan.test.ts` | RT-3, RT-7 |
| Every ported file carries its credit header and a notices entry; the credit validator passes | credit validator, plus RT-10 in this phase's validator | RT-10 |
| The validator refuses any importer of this module outside its directory and tests | RT-9: the core barrel names the directory once and no product file names a rule | RT-9 |
| Validator pin and named mutations, each named after the rule body and killed by its own rule | `val-projectos-port-routines1a.cjs` | RT-1 to RT-15 |

Behaviour tests, one failing test per rule before the code: the six `routines-*.test.ts` files were written first and
failed to load (the module did not exist). The code followed, and they pass.

## Mutations

The validator compiles the real source, runs every scenario, removes one rule from the source and runs them all again.
A refusal counts as killed only when the refused call now goes through, so a refusal that merely changes name is not a
kill. A mutation that made the module throw is an error, not a kill. The results are in the validator's own output,
quoted in Checks below. Table of named mutations, generated from the validator's list:

| Rule | Behaviour mutations (each named after the rule body, each killed by its own scenario) |
|---|---|
| RT-1 | the-floor-is-14-minutes, a-gap-inside-a-day-passes, only-the-first-two-times-of-a-day-are-compared, the-midnight-wrap-is-not-measured, month-and-year-ends-are-not-days-in-a-row, any-two-days-count-as-days-in-a-row |
| RT-2 | a-sixth-field-is-accepted, an-over-long-expression-is-read, a-zone-other-than-utc-is-guessed, a-schedule-that-never-fires-is-approved, sunday-is-only-0, both-day-fields-must-match, the-next-occurrence-may-be-the-time-asked, seconds-are-ignored, the-walk-gives-up-after-a-year, years-0-to-99-are-read-as-1900-to-1999 |
| RT-3 | any-decider-is-the-owner, any-decision-id-is-a-plan-decision, an-unknown-field-rides-along, a-run-needs-no-budget, the-run-budget-has-no-ceiling, a-record-skips-the-floor, a-record-skips-the-prompt-scan, a-getter-is-called, a-copy-is-an-admitted-record, enabling-does-not-check-the-record, the-run-budget-maximum-is-ten-times, a-run-does-not-check-the-record |
| RT-4 | the-cap-is-21, an-enabled-routine-counts-against-itself, the-limit-is-eleven, the-limit-is-nine, a-success-keeps-the-count, a-skipped-run-counts-as-a-failure, a-switched-off-routine-takes-more-outcomes, the-old-record-re-enables, the-same-decision-re-enables, any-routines-record-enables |
| RT-5 | the-ceiling-is-p3, the-ceiling-is-p5, nothing-is-escalated, any-queue-answer-counts-as-escalated, a-full-queue-lets-it-through |
| RT-6 | the-claim-is-not-asked, the-key-includes-the-record-hash, a-promise-counts-as-a-claim, a-refused-claim-leaves-the-routine-open, a-failed-release-is-not-said, an-invalid-answer-leaves-the-guard-open, a-throwing-claim-leaves-the-guard-open, a-guard-held-by-another-run-is-released, a-truthy-answer-opens-the-run, an-open-run-does-not-block, the-lease-never-ends, the-lease-is-zero, the-scope-is-the-routine-id-alone, the-guard-is-shared-across-tenants, the-spend-is-shared-across-tenants, the-project-scope-is-the-tenant-alone, the-guard-is-keyed-by-the-routine-id-alone, the-last-claim-is-read-by-the-routine-id-alone, the-routine-spend-is-read-by-the-routine-id-alone, the-project-spend-is-read-under-the-routine-scope, the-owner-is-told-before-the-bounds-are-checked, a-port-that-throws-says-yes, any-clock-answer-is-a-time, a-future-occurrence-is-due, a-stale-occurrence-is-caught-up, the-catch-up-window-is-a-day, spacing-is-not-rechecked, the-window-budget-is-not-held, the-window-budget-is-one-run-short, the-project-budget-is-not-held, the-project-budget-is-one-run-short, the-project-budget-is-ten-times, unreadable-project-spend-counts-as-zero, the-window-budget-is-ten-times, unreadable-routine-spend-counts-as-zero, the-offset-spelling-is-kept, the-key-omits-the-occurrence, a-slot-can-be-invented, a-zone-less-instant-is-read, a-switched-off-routine-runs, any-state-runs-any-record, any-tenant-runs-the-record, the-run-action-is-not-held-to-p2, the-run-has-no-budget, the-run-is-keyed-as-another-action, the-run-action-is-unregistered |
| RT-7 | the-shared-threat-scan-is-skipped, an-invisible-character-passes, the-scan-reads-an-unbounded-prompt, rm-rf-root-is-prose, visudo-is-prose, an-ed25519-key-may-be-read, the-patterns-are-case-sensitive, the-text-is-not-normalised, lookalike-letters-are-not-folded, the-folded-text-is-not-given-to-the-shared-scan, powershell-environment-variables-are-not-secrets, a-powershell-request-is-prose, evaluating-the-environment-is-prose, a-pipe-before-a-line-break-is-not-a-pipe, a-substituted-download-is-prose, the-script-g-is-not-folded, the-cyrillic-h-is-not-folded, get-content-of-an-env-file-is-prose, a-piped-download-is-prose |

Totals: 109 scenarios, 108 behaviour mutations, 83 text mutations.

RT-8 to RT-15 carry text mutations of their own (a clock, a timer, the filesystem, the network, the environment and the
agent in core; a wired caller; a dropped header, entry or pin; an upstream name in an identifier; a cron library; a
dependency; a refused mode; a dropped export; an unregistered validator; a skipped test; a lost limit in a header or in
this record), and RT-7 carries one text mutation that puts two long bounded repeats back into one pattern.

## Refusals that are not mutations (stated, not proved)

- The local Hermes exfiltration patterns (`curl` and `wget` with a secret variable) overlap the shared scan, so no
  prompt reaches them alone. They are ported as data and have no mutation of their own: removing one changes nothing a
  test can see.
- An action the registry does not know is P5 and is refused unattended. That is the registry's rule (R5), proved in
  `action-registry.test.ts`, and `routines-unattended.test.ts` repeats it for one action.

## Checks

Run in this worktree on the review-round-2 change (branch includes the shared commit `86f18e23`); exit codes read, counts
copied from the output. `validate-all` was not run here (the lead runs it serially).

| Check | Result |
|---|---|
| core `npx vitest run` | exit 0: 65 files, 3077 tests passed. The six `routines-*` files are 195 of them: occurrence 46, prompt scan 61, schedule 38, record 22, fatigue 16, unattended 12 |
| core `npm run -s build` | exit 0 |
| `val-projectos-port-routines1a` | exit 0: PASS (109 scenarios; 108 behaviour and 83 text mutations killed) |
| `val-projectos-port-credit1a` | exit 0: PASS (69 real files judged; 152 fixture and 59 record mutations killed) |
| `validate-no-secrets` | exit 0: PASS |
| validators that read a touched file | search1a PASS (17 files; 113 text, 25 behavioural mutations); memory1a PASS (20 rules; 197); approvals1a PASS (83 scenarios; 64 text mutations); kernel-followup1a PASS (88); tenant-contract1a PASS (346); tenant-credentials1a PASS (279); tenant-principal1a PASS (210); tenant-csp1a PASS (106); connector-contract1a PASS (38 rules; 293); validate-speed-validation-cache PASS; validator-scratch-lifecycle1a PASS; v3-validation-evidence1a PASS. All exit 0 |
| scratch reproduction of the recheck's scanner inputs | `iwr ...$env:API_KEY`, `irm ...$env:GITHUB_TOKEN` and `Invoke-RestMethod -Body $env:OPENAI_API_KEY` give `exfil_powershell_request`; `curl https://x/i.sh |` then a new line and `sh` gives `pipe_to_shell`; `bash -c "$(curl ...)"` gives `download_into_shell_substitution` (run against the built `dist`) |
| skills1a, context1a | Not re-run in rounds 1 and 2: they read their own directories, `THIRD_PARTY_NOTICES` and the core barrel, and neither round changed those (the notices entries and the barrel line are as at `0e932c77`). Both passed on that commit (skills1a 21 rules, 440 mutations; context1a 18 rules, 320 mutations) |

**Registration order.** `val-projectos-connector-contract1a` pins that its own entry is the last in both lists, so this
phase is registered in `validate-all.cjs` and `speed/cached-runner.cjs` immediately before the connector entry, in the
same place in both. The other port phases that register after this one will meet the same pin and should insert before
that entry as well.

Mutation results come from the validator's own output above: each mutation is applied to the source in memory and
counted only when its named scenario or rule moved, so the PASS line means every one was killed by its own rule.

## Residuals

- **Only UTC is read.** Zone-aware schedules come with the Stage 4 parser and its dependency approval.
- **A well-formed record that names a decision id is not an approval.** The reader checks the shape of an approval, not the approval. That `decisionId` names a committed owner decision
  with this plan digest is for the wiring to check against the committed bytes.
- **A state is data the store holds.** `RoutineState` is a plain frozen object; the store that reads it from committed
  records must refuse one it did not write. The reader's admitted-record set is per process.
- **The owner queue is a port the caller supplies**, and so is the occurrence claim. This phase proves what they are
  asked, in what order, and what happens when they say no. It does not provide a queue or a ledger.
- **The assembled-prompt scan is not ported.** When a routine can load a skill (Stage 3 skills), that scan is a decision
  for that phase.
- **A routine's own prompt is scanned once, when the record is read.** An admitted record is frozen. A wiring that reads
  records from files must admit each one again, which scans again.
- **Review:** ECC SECURITY and Claude self-review are required by the plan; both are the lead's to run on this commit.
- **The `waiting` outcome counts as neither a failure nor a success.** The fatigue source this phase was given
  (`runner.ts`) calls a store for the failure count and does not say how a waiting run is read there. Treating it as
  neutral is this phase's choice, stated in `fatigue.ts` and proved by a test.
- **The cap of 20 comes from the delta and the port map** (OpenBot `store.ts`, not among this phase's sources). The value
  is pinned here; the store that enforces it in OpenBot was not read.
- **Overlap and catch-up are bounded here, not closed.** Admission refuses a future slot, a slot older than 30 minutes,
  a second open run under the same tenant, project and routine, a run within 15 minutes of the last claimed occurrence
  and spend past the routine and project caps. All of that rests on what the ports answer. 
  A crashed run blocks its routine for at most the 60-minute lease, after which the next run is admitted, and a run that really lasts longer
  than the lease can be overlapped by the next one. A ledger that under-reports `spentSince` lets spend through, and
  nothing here meters real spend against the run budget. Those belong to the wiring phase, which owns the ledger.
- **What remains of the aggregate cap.** The project cap (5000 cents per 24 hours) is held per tenant and project, so
  twenty routines in one project share it instead of bringing twenty routine caps. It is only as true as the ledger: it
  counts what admission reserved, not what was spent; the caller must record each admitted run's cents under both the
  routine scope and the project scope (the keys come back in the admission result); spend that does not come through a
  routine is not counted; and nothing caps a tenant across its projects. A release that fails after a refused run says
  `releaseFailed: true` and leaves the lease to clear the guard.
- **The four run limits are this round's choice, not a source's.** 30 minutes of catch-up, 500 cents per run, 2000 cents
  per routine per 24 hours, and the units (cents, not the envelope's micro-USD). The owner should confirm them.
- **The lookalike folding is a small explicit map.** A lookalike it does not list passes, `%VAR%` secrets in the cmd
  style and `bash <(curl ...)` are not matched, and `type` followed by an env file can refuse a harmless sentence.
- **The prompt-scan timing proof is a guard, not a red-first test.** The roughly one second the review saw for a
  repeated `curl -d ` could not be reproduced on this machine (the old patterns took at most 12 ms on the inputs tried),
  so the test caps a set of hostile inputs at 400 ms and the structural fix is pinned by a validator rule.

## Review round 1

Round 2 below supersedes the parts of M2 that keyed the guard, the spacing and the spend by routine id alone.

ECC security-reviewer on `0e932c77`: no CRITICAL. Each finding below was handled test first (the new tests failed
against the old code before the change), with a named validator mutation killed by its own rule.

| Finding | Result | Test | Mutation(s) |
|---|---|---|---|
| M1 The floor was a scan of 200 occurrences from 2024, and `0,59 0,23 */2 * 1,2` passed | Fixed: exact smallest gap from the time-of-day set and a 400-year day walk; the 200-occurrence constant is gone; header and this record no longer overstate it; `admitRoutineRun` also rechecks spacing against the last claimed occurrence | `routines-schedule.test.ts` (wrap across midnight, month and year end, controls); `routines-occurrence.test.ts` (spacing) | the-midnight-wrap-is-not-measured, month-and-year-ends-are-not-days-in-a-row, any-two-days-count-as-days-in-a-row, a-gap-inside-a-day-passes, only-the-first-two-times-of-a-day-are-compared, spacing-is-not-rechecked |
| M2 Run admission had no bounds | Fixed: injected clock; future slots and slots past a 30-minute catch-up window refused; in-flight guard released on a failed claim; spacing; per-routine budget cap for 24 hours; named constants in `runLimits.ts` | `routines-occurrence.test.ts` (2050, window edge, in flight, budget edge, spend unreadable) | a-future-occurrence-is-due, a-stale-occurrence-is-caught-up, the-catch-up-window-is-a-day, an-open-run-does-not-block, a-refused-claim-leaves-the-routine-open, the-window-budget-is-not-held, the-window-budget-is-one-run-short, the-window-budget-is-ten-times, unreadable-spend-counts-as-zero |
| M3 "Owner-approved" overstated what the code proves | Fixed: headers, code `ROUTINE_NO_PLAN_DECISION`, state field `enabledUnderRecordId` and this record say a well-formed record that names a decision id; the host-wiring check stays a declared residual | `routines-record.test.ts` | the validator pins the new wording (header and record) |
| L1 Prompt-scan CPU | Fixed structurally: line-based rules of simple tests, prompt capped at 8000 characters before any scan. Not reproduced as slow here (see Residuals) | `routines-prompt-scan.test.ts` (limit edge, 400 ms bound on hostile shapes) | the-scan-reads-an-unbounded-prompt, the-exfil-rules-nest-two-bounded-repeats |
| L2 Scanner gaps | Fixed: PowerShell `$env:` secrets, `Get-Content` or `type` of an env file, a download piped into a shell, Cyrillic and Greek lookalikes folded; shared `firstThreat` reused and run on the folded text too; nothing outside `routines/` changed | `routines-prompt-scan.test.ts` | powershell-environment-variables-are-not-secrets, get-content-of-an-env-file-is-prose, a-piped-download-is-prose, lookalike-letters-are-not-folded, the-folded-text-is-not-given-to-the-shared-scan, the-text-is-not-normalised |
| L3 A Promise from an async port counted as a claim | Fixed: a port answers exactly `true`; a Promise, a truthy non-boolean and a throw are refusals (`PORT_ANSWER_INVALID`); the owner queue likewise | `routines-occurrence.test.ts`, `routines-unattended.test.ts` | a-promise-counts-as-a-claim, a-truthy-answer-opens-the-run, a-port-that-throws-says-yes, any-queue-answer-counts-as-escalated |
| L4 Fields read more than once; budget uncapped and its unit unnamed | Fixed: the record is copied field by field once and a getter is refused; `runBudgetCents` is capped at 500 and named as US cents in the type | `routines-record.test.ts` | a-getter-is-called, an-unknown-field-rides-along, the-run-budget-has-no-ceiling, the-run-budget-maximum-is-ten-times |
| L5 `Date.UTC` years 0 to 99; no tenant check | Fixed: dates built with `setUTCFullYear`; `admitRoutineRun` takes the executing tenant and refuses a mismatch | `routines-schedule.test.ts` (year 50), `routines-occurrence.test.ts` (tenant) | years-0-to-99-are-read-as-1900-to-1999, any-tenant-runs-the-record |
| L6 The P2 ceiling depended on the caller | Fixed: `admitRoutineRun` asks `admitUnattendedAction` about the run action against the registry it is given | `routines-occurrence.test.ts` (registry raising `run-start` to P3) | the-run-action-is-not-held-to-p2 |

A separate check, not committed: the exact floor was compared with a brute-force minute scan of 2024 to 2030 on 40
random schedules, and every schedule the floor admitted had a real smallest gap of at least 15 minutes (33 admitted,
7 refused, 0 unsound).

## Review round 2

Recheck of `0e932c77..83df6b80` found M1, L1 and L3 to L6 fixed, and the items below open. Each was handled test first
(the new tests failed against the old code before the change), with named validator mutations killed by their own rule.

| Finding | Result | Test | Mutation(s) |
|---|---|---|---|
| N1 The guard, the last claim and the spend were keyed by routine id alone | Fixed: all three are held under a scope key built from tenant, project and routine (`routineScopeKey`), and the project aggregate under `projectScopeKey`; both are exported for the wiring and returned in the admission result | `routines-occurrence.test.ts` (tenants A and B each with a routine `daily`: B at 10:05 is not `RUN_TOO_SOON` after A's 10:00, and A's guard and spend do not block B) | the-scope-is-the-routine-id-alone, the-guard-is-shared-across-tenants, the-spend-is-shared-across-tenants, the-project-scope-is-the-tenant-alone, the-guard-is-keyed-by-the-routine-id-alone, the-last-claim-is-read-by-the-routine-id-alone, the-routine-spend-is-read-by-the-routine-id-alone, the-project-spend-is-read-under-the-routine-scope |
| N2 A guard could stay open: a throwing release, or a non-boolean answer from the port that opened it | Fixed: every path that opened the guard (or may have) and did not claim releases it; a failed release is surfaced as `releaseFailed: true`; the guard has a 60-minute lease passed to the port with the injected clock, so a crashed run stops blocking; a guard the port said it did not open is not released | `routines-occurrence.test.ts` (release throws, Promise from `tryOpen`, claim throws, told-not-opened, lease edge) | a-refused-claim-leaves-the-routine-open, a-failed-release-is-not-said, an-invalid-answer-leaves-the-guard-open, a-throwing-claim-leaves-the-guard-open, a-guard-held-by-another-run-is-released, a-truthy-answer-opens-the-run, an-open-run-does-not-block, the-lease-never-ends, the-lease-is-zero |
| M2b Aggregate spend was per routine, so N routines meant N caps | Fixed as far as admission can: a per-tenant-and-project cap (5000 cents per 24 hours) is checked beside the routine cap, from the same spend port under the project scope. What remains is in Residuals | `routines-occurrence.test.ts` (project cap edge, unreadable project spend, another project) | the-project-budget-is-not-held, the-project-budget-is-one-run-short, the-project-budget-is-ten-times, unreadable-project-spend-counts-as-zero |
| M3b A new record id under the same decision re-enabled a routine switched off for failures | Fixed: the state remembers the decision id and a re-enable needs a different one; wording in this record and in the code corrected | `routines-fatigue.test.ts` | the-same-decision-re-enables, the-old-record-re-enables |
| L2b Scanner gaps: `iwr` and `irm` with `$env:` secrets, `Invoke-Expression`, a pipe across a line break, `bash -c "$(curl ...)"`, more lookalikes | Fixed: new rules `exfil_powershell_request`, `powershell_eval_environment`, a multi-line `pipe_to_shell` and `download_into_shell_substitution`; the lookalike map covers the letters a c e i j o p s x y h k m t v u n g (U+0261, U+04BB, U+0456, U+0455 included); still linear (measured under 30 ms on hostile inputs) and capped at 8000 | `routines-prompt-scan.test.ts` | a-powershell-request-is-prose, evaluating-the-environment-is-prose, a-pipe-before-a-line-break-is-not-a-pipe, a-substituted-download-is-prose, the-script-g-is-not-folded, the-cyrillic-h-is-not-folded |
| LOW The occurrence key included the record hash, so a re-recorded routine could run a slot twice | Fixed: the key is tenant, project, routine and slot; the record hash travels in the admission result for the ledger entry | `routines-occurrence.test.ts` | the-key-includes-the-record-hash |
| LOW The owner was told before spacing and budget were checked | Fixed: escalation happens only after those checks pass | `routines-occurrence.test.ts` | the-owner-is-told-before-the-bounds-are-checked |

## Converge (Code Bible B9)

Compared the code against the phase entry in `docs/projectos-finish-phases.json`, the approved delta row 1, ADR-P1 and
the V4 port map row C13.

**Built, per acceptance criterion:** all eight. The 14 and 15 minute floor, exact over every occurrence; the 21st enabled
routine refused and the tenth failure in a row switching a routine off until a new admitted record; P3 and above refused
and escalated unattended with a P2 control; one key per occurrence and a replay refused; the prompt scan at approval;
credit header and notices entry on every ported file and the credit validator passing; the unwired fence; the pin and
named mutations.

**Unbuilt (inside the delta, not in this phase's scope):**
- `projectos/agent/src/routines/` and its tests (the delta lists an agent directory for routines). This phase was core
  only, by instruction. Nothing reads routine records from git yet, and no real owner queue, claim ledger, in-flight
  store or spend ledger exists: the ports are proved with fakes.
- The envelope call itself. The occurrence key equals the one `mintEnvelope` would derive; admission through the
  envelope is the Stage 4 wiring.
- Metering of the per-run budget against real spend. The record carries it, admission returns it, and the window cap is
  checked against what the ledger port reports.
- Zone-aware schedules and `cron-parser` (A9: approved for later, with the Stage 4 wiring).

**Round 2 changes to the contract with the wiring:** `RunPorts.tryOpen`, `release`, `lastClaimed` and `spentSince` take a
scope key (tenant, project, routine; or tenant and project for the aggregate), and `tryOpen` also takes the time and the
lease. `RoutineState` carries `enabledUnderDecisionId`. `deriveOccurrenceKey` no longer takes a record hash, and the
admission result carries `recordHash`, `routineScope` and `projectScope`. Nothing outside `routines/` calls any of it.

**Behaviour drift from the sources (each stated above and in a file header):** UTC only; an exact floor in place of the
200-occurrence walk; no second pair measure; no `describeCron`; no GitHub Authorization-header exemption or ZWJ
allowance; a disabled routine re-enables only through a new admitted record; a record without a named plan decision is
refused; a never-firing expression is refused; run admission is bounded by ports.

**PROTECTED files touched:** one, `projectos/validators/validate-all.cjs`, by two added lines (a comment and the
registration), the registration-only edit the delta approved. `projectos/speed/cached-runner.cjs` has the same two
lines. `git diff d443a0fa --stat` shows no other file from `docs/00_Baseline_State.md` §4 or the delta's Zone 3:
`actionRegistry.ts`, `taskEnvelope.ts`, `permissions.ts`, `gatekeeper*`, `run.ts`, `host/**` and `action-registry.json`
are untouched, and `core` gained no dependency (the validator pins the dependency list empty).

## Final state

Built and committed on `projectos-port-routines1a`. Not pushed, not merged, not closed. The remaining steps are the
lead's: `validate-all` (only `val-cd-b4` may fail), the ECC SECURITY review, and the owner's closure.
