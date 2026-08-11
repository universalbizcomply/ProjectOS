# PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-CLOSURE. Closure is delegated to ChatGPT for this programme.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A — "After an approved PLAN READY plan, let ProjectOS run ordinary phases end to end with the governed Claude worker and without manual prompt relay."
3. **Date:** 2026-08-11
4. **Evidence subject:** `4bb7c9c384924a465838bd059a8da7e78408d051` on `projectos-post-v3-selfhost-pilot1a`. Integrated into the recovery branch from `projectos-recovery-phase4-prep` by fast-forward only — no merge commit, no rebase, no force push. Baseline before integration was `3f83ab6b`.
5. **Files changed:** new — `projectos/agent/src/loop/{selection,observation,brief,workers,verification,outcome,session,runner}.ts`, `projectos/agent/src/loop/adapters/claudeCodeCli.ts`, `projectos/agent/src/commands/run.ts`, `projectos/agent/tsconfig.test.json`, and eight test files (`loopSelection`, `loopBrief`, `loopWorkers`, `loopOutcome`, `loopRunner`, `loopAttestation`, `loopExecutionContext`, `loopToolGrants`, `systemEnvScrub`); modified — `projectos/agent/src/{cli,system,governedContext}.ts`, `projectos/agent/package.json`, `projectos/agent/test/governedContext.test.ts`, `projectos/schemas/project-config.schema.json`, `.projectops/project-config.json`.

## 6. Summary, against each acceptance criterion

**(1) Next authorised phase, verified context, bounded instructions from the approved plan.**
`selectNextPhase` walks the approved plan in order and asks `governedContext` — the same module the
phase-creation gate uses — which phases are complete and whether the next one is authorised. There is
deliberately no second completion ledger: a loop that judged completeness its own way would start
phases the gate then refuses. `verifyExecutionContext` re-derives repository, branch and HEAD from git
and compares them with what the project declares; a protected branch, a different remote, an
unreadable HEAD or a non-absolute root each refuse. `buildWorkerBrief` copies the phase from the plan
and takes no free-text argument at all, and `briefProvenanceProblems` proves that against the output:
every string the brief carries must also appear in the approved plan, the config or the observed
checkout. The live brief was 3,082 characters against a 16,000 bound.

**(2) Start or reconnect the governed Claude worker, context transferred automatically.**
Proven live three times, not argued. ProjectOS spawned `C:/Users/murad/.local/bin/claude.exe` — the
exact configured absolute path — as a child of `node projectos/agent/bin/projectos.js run`. The command
line carried a path and one fixed sentence, and no phase description, no acceptance criterion and no
phase id: there was no giant manual prompt relay because there is no channel for one. The worker's own
session record independently reports `cwd: C:\dev\ProjectOS` and
`gitBranch: projectos-post-v3-selfhost-pilot1a`. Handles recorded: `9cfd64b6-400a-4be1-b6b5-d3c15a452ce1`,
`158411fa-8b8f-426f-a8c1-d8142d200d16`, `2a07e337-f625-4dac-9d32-f07b22a29070`.

**(3) The worker seam is configuration, not a rewrite.** Which workers exist, where their executables
are and which is the default live in `execution.workers`; what stays in code is the adapter for a kind
of worker. A test registers a foreign adapter and resolves a second worker kind through the registry
alone. Executables must be absolute — on Windows a bare name resolves against the governed checkout
before PATH, and a `claude.exe` committed to a repository must never become that repository's worker.

**(4) Validators, tests and reviews run automatically; evidence collected.** The validators come from
the plan's `requiredValidators` and the loop may not add to them; the project's own suites come from
`execution.checks`, because no plan can sensibly name them. All run in the governed root with
credential-shaped environment variables removed and their output redacted before it reaches the
durable record. A validator the plan names but the repository lacks FAILS — never a skip. Reviews are
not run by the loop and that is said plainly: a review is a judgement, not a script, so the loop
requires the evidence and refuses to certify a run without it.

**(5) Ordinary defects corrected and retested automatically.** A failing check and an unresolved
LOW/MEDIUM finding are the same class of work and both go back to the worker under
`MAX_CORRECTION_ATTEMPTS`, after which the loop stops and says the defect resisted correction.
**This path is proven by unit and adversarial tests, not by the live runs** — every live check passed
and every finding was recorded resolved, so no correction cycle triggered, and no artificial defect was
manufactured to force one.

**(6) Execution stops only for a genuine decision.** The ordering in `decideContinuation` is the safety
argument and is spelled out there: a worker refusal is never read as a pass; a protected effect stops
everything including a green run; an unresolved CRITICAL or HIGH outranks a failing check so a defect
can never mask a security finding; a scope question is the owner's; only then is ordinary work retried;
and a run that attested nothing about its own effects cannot be certified. The live runs ended
`STOPPED (OWNER_GATE)`, refusing to perform commit, push or phase-closure.

## 7. Live governed worker proof

| | Run 1 — `507f3c64` | Run 2 — `934f9ce1` | Run 3 — `f7495444` |
|---|---|---|---|
| Worker | started, exit 0 | started, exit 0 | started, exit 0 |
| Handle | `9cfd64b6-…` | `158411fa-…` | `2a07e337-…` |
| Checks | 4/4 PASS | 4/4 PASS | 4/4 PASS |
| Attestation | absent | complete, all false | complete, all false |
| Stop | `EFFECTS_NOT_ATTESTED` | `OWNER_GATE` | `OWNER_GATE` |

Binding, identical on every run: project `projectos`; repository `C:\dev\ProjectOS` /
`universalbizcomply/ProjectOS`; branch `projectos-post-v3-selfhost-pilot1a`; phase
`PROJECTOS-RECOVERY-AUTONOMOUS-LOOP1A`; base HEAD the governed commit, with `briefId` = `<phase>@<full sha>`.

Automatic checks on every run: `validate-all` PASS, `core-tests` PASS, `agent-tests` PASS,
`agent-typecheck` PASS.

**Run 1 was a genuine failure and is recorded as one.** The loop demanded an effects attestation that
nothing had ever asked the worker to write. The worker read the brief, inferred what was wanted, and
finished by asking a human for permission it could not receive, because a `-p` worker is not
interactive. The gate fired correctly on a run that could never have satisfied it. Both defects were
fixed — the start instruction now names the two records and the six attestation fields, and the worker
was granted the narrow authority to write them.

## 8. Reviews

Both plan-required reviews were performed by the governed worker on its own phase. Run 3 recorded
**14 findings — 4 MEDIUM, 10 LOW, 0 CRITICAL, 0 HIGH, 0 unresolved.**

**FIXED — source changed:**

- **CR-3** `readSession` treated a malformed session record as an absent one, so a worker could corrupt its own record and the worker-identity refusal would never fire while a resumable handle was silently discarded. It now refuses.
- **CR-4** the start instruction never asked for the findings and effects records the loop refuses to proceed without. Both instructions now name them and the six attestation fields.
- **CR-5** the grant `.projectops/execution/**` gave the worker write authority over its own brief, session and evidence. Narrowed to the two records it owns.
- Orphaned doc block on `buildWorkerBrief` (cosmetic).
- **Not reported by the worker, found by reading its findings:** the narrowed enforcement policed `Write`/`Edit` while waving `Bash(*)` through. A shell grant is a write grant under another name; `Bash`, `Task` and `Agent` are now on the same closed list.

**REVIEWED / ACCEPTED — no source change:** CR-1 duplicated `isAbsolutePath` (deliberate, keeps each
module self-contained); CR-2 `runLoop` length (the ordering of the pre-spawn gates is the safety
argument and splitting it would fragment that reasoning); CR-6 `readSession` validates the fields that
reach a decision and recomputes the rest; CR-7 and CR-8 naming and case-sensitivity, both fail-safe;
SR-1 output redaction is best-effort; SR-2 `briefPath` is recomputed and never read back, proven by
test; SR-3 the flag-name coverage was verified correct; SR-4 session-id collision is theoretical;
SR-5 the stderr tail line; SR-6 symlink defence-in-depth.

Earlier independent ECC `code-reviewer` and `security-reviewer` passes on the engineering boundary
reported 1 CRITICAL, 4 HIGH and 3 MEDIUM, all fixed with regressions before integration: the
protected-effect gate was structurally inert; a validator name from the plan became a path unchecked;
worker executables were read from the working tree the worker can write to; a malformed worker entry
crashed instead of refusing; a rejoin could use another worker's handle; environment credentials were
inherited and output reached evidence unredacted.

## 9. Worker authority

Exact grant in `.projectops/project-config.json`:

```
--allowedTools Write(.projectops/execution/*.findings.json),Edit(.projectops/execution/*.findings.json),Write(.projectops/execution/*.effects.json),Edit(.projectops/execution/*.effects.json)
```

A run has two owners. The worker owns what it **asserts** — its findings and its effects attestation.
ProjectOS owns what it **states and observes** — the brief the worker is judged against, the session
record naming who owns the run, and the evidence collected about it. `toolGrantProblems` refuses any
write-capable grant outside that closed list when the config is read, before anything can spawn, so a
future config cannot widen the boundary quietly. What it cannot do is stated rather than implied: it
governs what this config may grant, not the CLI's own defaults or a user's settings files.

**Negative proof over `*.brief.json`, `*.session.json`, `*.evidence.json`:**

- *Observed*, in an isolated sandbox outside the repository, using the exact shipped grant: `findings.json` was **written**; `brief.json` and `evidence.json` were **refused — permission denied** — and were byte-identical afterwards.
- *Live*, run 3: the brief was byte-identical before and after the worker ran, md5 `f8d78191928587a6876dd26e246032b8`.
- *Mechanical*: regressions refuse `Write`, `Edit`, `MultiEdit` and `NotebookEdit` for each ProjectOS-owned suffix, plus `Bash`, `Task`, `Agent`, `**`, `.projectops/**` and source paths; one test asserts the shipped config against the same rule.

## 10. Protected effects

Complete six-field attestation on runs 2 and 3, every field `false`:

```json
{ "productionTouched": false, "deploymentOccurred": false, "databaseMutationOccurred": false,
  "externalSendOccurred": false, "paymentOccurred": false, "rawSecretStored": false }
```

An incomplete attestation is refused — `{}` used to certify a run, which was the absent-record
fail-open wearing a different hat. All six fields must be present and boolean; `"false"` as a string
is refused, because it reads like a denial and is truthy.

**PROTECTED EFFECTS: NONE.** No production, deployment, database mutation, external send, payment,
credential access or secret storage. No installation, service, ACL, registry or ProgramData action. No
force push, no history rewrite, no merge to a protected branch. Across all three live runs no worker
changed any source file; the only files any worker wrote were its own two records.

## 11. Validation

`validate-all --record-evidence` run **once** against the frozen subject from a clean tree:
**127 registered modules, 127 PASS, 0 FAIL, `aggregatePassed: true`,
`workingTreeCleanAtRunStart: true`**, recorded at
`.projectops/validation/4bb7c9c384924a465838bd059a8da7e78408d051.json`.

Agent tests 349, core tests 211, typecheck clean over `src` **and** `test` — the test project is new,
because vitest strips types without checking them and four fixtures contradicted the interfaces they
exercised.

## 12. Carry-forward, recorded rather than tidied away

- `resolved: true` currently means "no further corrective action is required". Distinguishing a finding that was **fixed** from one **reviewed and accepted** is an accepted schema improvement and is deferred.
- The loop does not create the durable phase record; `projectos phase new` does, and has its own authorisation gate. Until a record exists the loop reports "starting" each time, which is true.
- The correction bound is per invocation. Re-running after a human has read the failure starts a fresh budget, deliberately.
- `.projectops/execution/` accumulates one record set per distinct HEAD, with no pruning.
- The attestation is a worker assertion under the project's manual-governance model (`tamperProof: false`). Anything that can write the file can write `false` into it; the backstop is the owner commit gate, where the claim is a visible diff. Nothing here is cryptographic and nothing here claims to be.
- Reviews are performed by the governed worker, not by an independent reviewer, on runs 2 and 3. The independent ECC review passes were run on the engineering boundary before integration.

## 13. Protected-branch and programme integrity

ProjectOS V3 is untouched by this phase. The recovery branch was advanced by fast-forward only, and
every commit after the evidence subject is closure-tail metadata: the validation record, the phase
lifecycle, this report and the closure evidence.
