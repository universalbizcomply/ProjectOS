# PROJECTOS-TENANT-PRINCIPAL1A — the tenant, read from committed bytes

**Phase:** PROJECTOS-TENANT-PRINCIPAL1A, plan v1.31, under `docs/changes/delta_spec.md`.
**Branch:** `projectos-tenant-principal1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-principal1a`, rebased onto
`374f9eaf` (plan v1.33). Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete, one review round answered. ECC SECURITY and Agency `identity-access-engineer`
both gave APPROVE WITH CHANGES at `aac21426`, and every finding is dispositioned below. This round has not been
re-reviewed. Nothing here touched a live service, a provider, PolyGo or an agency repository, and nothing was spent.

## The one act this phase needs: run it BEFORE merging

**Once this is merged, every `run`, bridge read and Control Center selection or acting verb is refused until the
registry has a receipt.** The refusal is `TENANT_REGISTRY_NO_RECEIPT`, and it prints the line to run.

**Do it from this worktree, before the merge,** so that if the prompt misbehaves nothing is locked yet. A receipt
lives in the installation state and names a blob, so one made here still counts after the merge, as long as the
registry bytes are the same. Use PowerShell or Windows Terminal, because Git Bash gives no terminal.

1. Build this worktree: `npm run -s build` in `projectos/core`, then `projectos/agent`.
2. In PowerShell, run this one line from this worktree:

```
node "C:/dev/ProjectOS-worktrees/tenant-principal1a/projectos/agent/bin/projectos.js" tenant receipt --blob 8f7b7437c648defc54d8d2005ab76691f51948fb
```

That is the final registry's blob, at `0f9dfaea`. If the registry changes again, the blob changes, and
`projectos.js tenant show` prints the new line.

It shows what changed and every binding, then asks for the first 12 characters of the blob. No commit is needed. I
created no receipt and forged none: the real state directory holds none.

## Which projects are refused after the first receipt

The installed host's registry, `projects.v1.json`, lists thirteen projects, and all thirteen have `.projectops`. The
tenant registry first listed three, which would have refused eleven. Under plan v1.33, each project was read from its
own `.projectops/project-config.json` and origin, and eight lines were added, in `owner-personal` under D2:

`dead-aisle`, `jd-testing`, `criclocal`, `coverdrive`, `boithok-khana`, `brik`, `trading-bot`, `bizcomply-v2`.

Every line was then checked against its real repository, read-only, with the same `bindCheckout` the kernel uses:
ten of the thirteen bind, and `seo-agency` binds too. **Three stay refused**, by `run`, by the bridge and by Control
Center selection, with `TENANT_UNKNOWN`:

`tkn`, `erp-system`, `wizard-probe`.

They have `.projectops` and no `origin`. A registry line needs a repository, and `resolveTenant` refuses a checkout
with none. The fix is the owner's: give each an origin, then add its line, which changes the blob and needs a new
receipt.

- **Dead Aisle's line names `C:/dev/deadaisle`, not the checkout the host registers.** That checkout,
  `C:/dev/deadaisle-phase6-proof1a`, is a linked worktree, and ADR-T1 §5 says one is never a registry entry. It binds
  `via linked-worktree`, proved on the real repository. `C:/dev/deadaisle` itself has no `.projectops`, so standing
  there is refused.
- **The domain on all eight is my reading, `develop`.** D2 names tenants only.
- **The list comes from the host's registry.** I did not list `C:/dev`, so a project with `.projectops` that the host
  does not register is not covered.
- **`seo-agency`** is in the tenant registry and not in the host's, so the installed Control Center cannot offer it,
  while the CLI can reach it.

## If the receipt cannot be made: recovery

| Route | Who | Cost |
|---|---|---|
| **Another console.** PowerShell or Windows Terminal, not Git Bash, not an IDE's output pane | The owner | A minute |
| **A held record.** If it refuses `ENVELOPE_NOT_RECORDED`, and no ProjectOS process is running, remove the `.jsonl.lock` in the installation state | The owner | A minute |
| **Revert the merge.** `git revert` the merge commit on `main`. That removes the entry refusal, the bridge rule and the sidecar rule together, and the owner's gates apply to it as to any merge | The owner | One revert, and the phase reopens |
| **By hand.** As with the emergency stop's `BY_HAND_RECOVERY`, a person at this account can write the receipt and its line. Nothing in ProjectOS does that for them, and no refusal prints how. It is exactly the forgery the limit below describes, so it is the last route | The owner | Accepts that the receipt then shows nothing |

The prompt itself has now been exercised on a real console (below). The pre-merge order above is what makes a failure
cheap: if `tenant receipt` fails in the worktree, nothing is locked.

## Delivered

| Commit | Content |
|---|---|
| `c9315efb` | `installation/tenantRegistry.ts`, `commands/tenant.ts`; `governedContext.ts`, `mcp/bridge.ts`, `cli.ts`; one entry refusal in `commands/run.ts` |
| `fa4c1fad` | `control-center/sidecar/host.mjs`: selection and acting verbs ask the tenant |
| `f636b12b` | `tenantPrincipal.test.ts`, `tenantBridgeRule.test.ts`, `support/tenantWorld.ts`; fixtures in `mcpBridge`, `mcpOAuth`, `platformStop`; `setup.ts` |
| `3b4dbc31` | Sidecar import kept on its pinned line, found by `val-projectos-kernel-platform-stop1a` |
| `ffd3be4e` | Four weak proofs the sweep found; the dead `isAbsolute` line removed |
| `41769ab3` | `val-projectos-tenant-principal1a`, registered in `validate-all` and `cached-runner`; this file |
| `dc6ab91b`, `f2f894b8` | The review round: fixes, then real-git, real-sidecar and real-console tests |
| `ff39f2aa` | The allowlist's replace-ref fix; four tests the sweep showed to be weak |
| `0f9dfaea` | `tenant-registry.json` and ADR-T1 |
| _this commit_ | The validator's review rules; this file |

Commits are hashed after the rebase onto plan v1.33. The review ran at `aac21426`, which is `41769ab3` here.

## Acceptance criteria

1. **A tenant named in agent text, argv or environment changes nothing (R2), tested:** met. The test sets each of them,
   a project-config field included, and compares `tenant show` byte for byte, then reads the minted envelope.
2. **An unlisted project, a duplicate entry and a registry whose last commit is not the owner's are each refused by
   name, tested:** met, with a change the lead decided. The third is now `TENANT_REGISTRY_NO_RECEIPT`, because a
   last-commit check cannot do the job (ADR-T1 §3). The test shows the last commit is named Murad and it is still
   refused, then passes in the same world once a receipt exists.
3. **A refusal that cannot be recorded stops the operation, tested:** met. `appendRefusal` no longer drops. A lock held
   past the wait gives `REFUSAL_NOT_RECORDED`, and a read or run whose admission line cannot be written does not happen.
4. **With the project check disabled, a bridge read across tenants is still refused by the tenant rule:** met.
   `tenantBridgeRule.test.ts` wraps the core's `checkBridgeRequest` so it is told the bridge is bound to whatever was
   asked. `gamma` then gets `TENANT_MISMATCH`, and `beta`, the second project in the bound tenant, is answered. A
   companion test shows the same read with the check intact is the project check's refusal, so the wrapper is real.
5. **Linked worktrees follow ADR-T1, and governed runs still work in one, tested:** met, against real git. A real
   `run --dry-run` in a `git worktree add` checkout walks to `DRY RUN: nothing was written and no worker was started.`,
   and the same worktree is refused once its project leaves the registry.
6. **Validator pin and named mutations, each killed by its own rule:** met, 199 of 199. See below for how many
   also fail a behavioural test.

## Review round, at `aac21426`

Findings as relayed by the lead, who decided them. This file does not hold the reviewers' own reports. Fail-before at
`aac21426`: 17 of 26 new tests failed. Some failed because the new API did not exist; the replace-ref, lock, rotation
and receipt tests failed on behaviour. The 9 that passed were the proof of cwd, the real 8.3 tests, the real-path
tests and one undiscriminating test of mine, which was rewritten.

| # | Finding | Disposition |
|---|---|---|
| HIGH 1 | The receipt key came from `rev-parse` and the judged bytes from `git show`, so a `git replace` ref changed the bytes under the same blob name, with no commit and no diff, across linked worktrees. ECC reproduced it | **Fixed, and it was a real hole.** Every call passes `--no-replace-objects`, and the bytes must hash to `sha1("blob <len>\0"+bytes)`. The tests plant a real replace ref, in the installation and from a linked worktree, and first show plain git serving the flipped bytes |
| HIGH 2 (F2) | `runStartTenantRefusal` discarded the admitted envelope, and `mintCrossing` needs a live one | **Fixed.** Held in a `WeakMap` keyed by the context, read by `admittedRunEnvelopeOf`, used by `mintRunCrossing`. A test mints a crossing from it and passes the door. `run.ts` still holds one refusal. The run does not survive the process; see below |
| HIGH 3 (F1) | cwd selects the checkout | **Proved, stated, not redesigned.** See "What decides which work is bound" |
| MEDIUM 4 | The receipt claimed the owner | **Fixed.** It records `typed-terminal`. The envelope's principal is `implementer`, its scope carries `confirmation:typed-terminal`, and the refusal is now `TENANT_REGISTRY_NO_RECEIPT` |
| MEDIUM 5 | A moved tenant could be rubber-stamped; a receipt did not answer to its line | **Fixed.** The prompt leads with `CHANGED`, `ADDED` and `REMOVED` against the last receipted blob. A receipt names its envelope, and needs its admission line in `tenant-registry-changes.jsonl`, which is never rotated |
| MEDIUM 6 | `appendDurableLine` rewrote the whole file, did not rotate, never waited | **Fixed.** Bounded wait of 2 seconds, rotation past 1 MiB keeping the old file. It still rewrites the file, now at most 1 MiB. A test has a real second process hold the lock during a real `run --execute` admission |
| MEDIUM 7 | The 8.3 proof injected realpath | **Fixed.** Tests use the real function on `C:/PROGRA~1` and on Windows' own short name for a registered root, so `realpath-not-native` is killed by behaviour |
| MEDIUM 8 | `host.mjs` had text pins only; did the mock hide the real path? | **Fixed.** `tenantSidecar.test.ts` runs the real `host.mjs` as a real process over its real stdin and stdout. The mock was checked: `tenantPrincipal` and `tenantReviewRound` unmock it, and the real `cli`, `run` and `continue` reach the real rule |
| LOW | Restored or default selection skipped the envelope; unquoted command; corrupt idempotency file | **Fixed.** `admittedSelection` at start and on refresh, tested through the real sidecar. The command is quoted. The refusal names the file and the fix |
| Unlock safety | If `askTerminal` misreads on Windows, everything refuses with no recovery | **Tested on a real console.** `support/conpty.ps1` gives the real command a real ConPTY, using only the operating system. Wrong and correct answers both behave. The routes above are the recovery |
| Same defect, allowlist | `projectAllowlist.ts` read through replace refs too | **Fixed under plan v1.33.** `--no-replace-objects` and the hash, with behaviour otherwise unchanged. All 3 new tests failed first, on behaviour: a planted policy admitted a project it never named |

**One bug in my own harness is worth recording.** The first ConPTY run reported "no terminal", which looked like the
unlock failure. It was the harness: a child of a redirected parent inherits the pipes unless `STARTF_USESTDHANDLES` is
set. The real prompt was then read correctly. That does not prove every console: Git Bash's mintty gives no TTY and is
refused by name.

## What decides which work is bound

**cwd selects the checkout.** The tenant value is derived and cannot be supplied, but "the work this is bound to" means
wherever the process started. A test proves it: `run --execute` from one tenant's root, then from another's, gets each
root's tenant, and nothing ties the two. An agent that can start a process in another tenant's root gets that tenant's
envelope. Stage 2 stops the kernel's routes from being told a tenant. It does not bind a piece of work to one. This was
not redesigned, on the lead's decision.

### BINDING on PROJECTOS-TENANT-CREDENTIALS1A

Decided by the lead at this review:

- **the requester is a kernel-issued run handle that survives process boundaries, never cwd.** `admittedRunEnvelopeOf`
  is in-process only, and the broker is another process, so it cannot be that handle.
- **worktree binding alone releases nothing.**
- **a receipt is never a credential-release grant.** `tenantReceiptGrant` answers only `tenant-registry-change`.
- **no JWT or OAuth requester.**
- **`run-start` has a budget.** It is 0 today, so `mintCrossing` would refuse any paid crossing from it.

## What the receipt shows, and what it does not

**A receipt shows that a person or a process confirmed this registry blob at a console, nothing more.** It is not the
owner's signature, and nothing here calls it that.

- **It stops:** an agent or worker with no terminal on this route, because `tenant receipt` refuses without a TTY on
  both stdin and stdout. A registry commit alone moving a tenant, because a new blob has no receipt. A `git replace`
  under a receipted blob. Going back to an older registry, because there is one receipt, not one per blob. An
  environment variable pointing at a forged receipt, because the directory is the platform stop's and the operating
  system must agree with it. A receipt file copied in alone, because it needs its line.
- **It does not stop:** a process that drives a console. And any process of this user can write the receipt and its line directly,
  as it can rewrite the emergency stop record. Both are ADR-T1 §10's first limit, one Windows user.

**The console limit is not theoretical.** `support/conpty.ps1` is about 130 lines, needs no dependency, and answers the
prompt. It is in this repository as a test, so an agent could run it, against the real state, and write a real
receipt. I ran it against the real state once, with a wrong answer, which writes nothing; every correct answer in
these tests went to a throwaway profile. The TTY check stops an agent that follows the route. It does not stop one that
is trying.

**The lesson of the replace ref.** My first version pinned the commit and named the blob, and I called that committed
bytes. It was not: the name and the bytes came from two calls, and something between git's names and git's objects
could separate them, invisibly. So a receipt's strength is only ever what the bytes behind its name are. The hash now
holds that for each reader separately, which is why `projectAllowlist.ts` needed the same fix and has it. **Other readers
of committed records were not audited for this,** including the closure and owner-gate readers: they still read through
replace refs, and they are outside this phase. A forged receipt is still not a visible diff, because it lives
outside every repository. A committed receipt would be, and would cost an owner commit per registry change.

`tamperProof` stays false. `TENANT_RECEIPT_STATEMENT` says this on every `tenant show` and every `tenant receipt`
answer, refusals included, and the validator pins that it still does.

## Found while building

**Real git keeps listing a removed worktree's path, unmarked, once something new stands there.** Delete the directory,
`git init` there, set the same origin, and `git worktree list` still names the path and does not call it `prunable`,
because a `.git` exists. ADR-T1 §5 and the core's rule assume `prunable` covers this, and it does not: that directory
would have taken the project's tenant. `resolveCheckout` now also requires the checkout's `.git` file to lead into the
registered root's `.git/worktrees/`. That reads a file ADR-T1 says counts for nothing, so note how it is used: **it only
ever refuses, and it attaches nothing.**

**The old `appendRefusal` had a second defect.** `sys.readText(path) ?? ''` read an unreadable file as empty, and the
next write would have erased what it held. `appendDurableLine` refuses instead, and a test proves it.

**`@projectos/core` here resolves to another worktree.** `node_modules` is a junction to `host-review-path1b`, so this
worktree's tests run against that tree's core build. `core/src/taskEnvelope.ts` is identical there, and that was the file checked. The sidecar test
points `@projectos/agent` at this worktree's build for the same reason. After a merge the junctions do not apply.

## What this phase does not do

- **`run-start` has no execution line.** The delta holds `run.ts` to one entry refusal, so nothing sees the run end.
  R4's second half is met for `project-selection`, `bridge-read` and `tenant-registry-change`, not for `run-start`.
- **a repeat `run-start` is counted, not stopped.** The key is the HEAD, so a run that did its work has a new key and a
  repeat at the same commit is a retry, with `attempts` recorded. Because no run settles its key, the store's
  `duplicate` answer is proved by tests and by a hand-settled key, and no production path reaches it yet. Reads consume
  no key: they have no effect to repeat.
- **`readmitEnvelope` has no caller, and `mintCrossing` none in production.** No persisted envelope is read back, and
  `mintRunCrossing` is proved by a test, until CREDENTIALS1A calls it.
- **Four core tests fail, and they are outside this phase's writePaths.** See "Needs the lead".
- **`action-registry-change` has no receipt.** ADR-T1 says the same limit applies to it. The action registry is read
  from committed bytes and hashed, and its floors are in code, but a commit can still change it.
- **The P5 grant for `tenant-registry-change` is the typed confirmation, and nothing else has a grant.** `NO_GRANT`
  answers everything this phase admits, because P1 and P2 never ask the port.
- **The packaged daemon is untested.** The real `host.mjs` was run under Node, with the bound system root as the
  installation, not as a bundled MSI.

## The test suite's one mock

`test/setup.ts` replaces `runStartTenantRefusal`, and only that function, for the whole agent suite, because its
fixtures are in no registry and every `run` test would stop at `TENANT_UNKNOWN`. Production code has no switch: nothing
in `src/` turns the rule off. `tenantPrincipal.test.ts` and `tenantReviewRound.test.ts` call `vi.unmock` and run the real
rule, including through the real CLI. TP-21 pins the mock's exact shape, the unmock, and that the entry has no bypass.
The cost is real: tests other than those two files no longer pass through the rule.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Build | `npm run -s build` in `projectos/agent` | 0 errors |
| Test typecheck | `npx tsc -p tsconfig.test.json` in `projectos/agent` | 0 errors |
| Full agent suite, final tree, nothing else running | `vitest run` in `projectos/agent`, on the final tree | 105 files, 3187 tests, all pass |
| Control Center suite | `vitest run` in `projectos/control-center`, before the review round | 66 files, 890 tests, all pass. It does not load `host.mjs`, which the agent suite's real-process test proves. Not rerun after the rebase |
| Core tests that read the registry | `tenant`, `tenant-contract-review`, `task-envelope`, `action-registry` | **401 of 405. The 4 failures are named under "Needs the lead"** |
| This phase's validator | `node projectos/validators/val-projectos-tenant-principal1a.cjs` | PASS, 199 of 199 |
| Validators reading a touched file | Each in its own process, on the final tree, nothing else running | 23 PASS, 0 FAIL. Includes `val-projectos-boot-continue1a`, which pins `run.ts`, `val-projectos-kernel-platform-stop1a`, `val-projectos-tenant-contract1a` (346), `val-projectos-trust-boundary1a`, `val-projectos-tenant-rls1a`, `validate-no-secrets`. The RLS validator ran alone. A further 3 that walk the agent source passed before the rebase and were not rerun |
| Real registry against real repositories, read-only | `bindCheckout` for all thirteen host projects and `seo-agency` | 11 bound, `dead-aisle` via `linked-worktree`; `tkn`, `erp-system`, `wizard-probe` refused `TENANT_UNKNOWN`. Nothing written |
| Real CLI in this worktree, read-only | `tenant show`, and `tenant receipt --blob … --as owner` | `TENANT_REGISTRY_NO_RECEIPT` with the one line, and `TENANT_RECEIPT_NEEDS_A_TERMINAL`. Nothing written to the real state directory |

**Not run:** full `validate-all`, which is the lead's. A packaged daemon. Mintty, which is refused by name.

**Failures on the way, all stated:**

- The first full suite had 1 failure of 3012: `accepted for an owner-identity commit, after which runLoop proceeds` in `platformStop.test.ts`, while the Control Center suite and the validators ran at the same time. It passed 3 of 3 alone and in every full run since. **I did not find the cause, so treat it as a load-sensitive test, not an explained one.**
- `val-projectos-tenant-rls1a` failed once in the same overloaded batch (`TR-H1`, its harness timed out), and passed alone.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so 199 of 199 says the pins fire, not that a behaviour test fails. So mutations were applied to the real source files, the proof each should trip was run with an exact filter, the failing test was recorded, and the file restored. Clean `git status` confirmed each restore.

- **On the final code, 98 mutations were swept, and 98 are killed by a behavioural test that passes unmutated in the full suite above.** That baseline matters, and I learned it late: the last full run showed two tests failing with no mutation at all, after the bounded retry changed what a single failed lock means, so the sweep had counted two false kills. Both tests were fixed, each confirmed green, and each mutation run again. The kills include every mutation of the tenant rule, the receipt, the door's recording, the replace-ref fix, the admitted run, the real sidecar and the allowlist. The rest have only their text pin. Many of those are docs, registration and evidence, which alter no behaviour, but some are real code mutations and were not tried.
- **`receipt-path-moved` survives correctly:** reader and writer share the path, so it alters no behaviour, and TP-3 is its only catch.
- **The sweeps found eight weak proofs, all fixed.** Four in the first round: the receipt grant was tested through a copy, the committed read was hidden behind the dirty check, and two unrecorded branches were never reached. A dead `isAbsolute` line came out. Four in the review round: a spy that missed the `HEAD` call, a fake that failed every rename rather than the rotation, a selection read before its inventory arrived, and an assertion whose failure hung the reporter on a megabyte.
- **My first sweep was invalid.** It split multi-word filters through a shell and ran the wrong tests. Its numbers are discarded, and the script now records which test made each kill.

## Mutations, by rule

Every mutation below was killed by the rule it names, in `selfTest`, on the final text.

| Rule | Count | Mutations |
|---|---|---|
| TP-1 | 12 | `registry-read-from-the-working-tree`, `dirty-registry-accepted`, `uncommitted-registry-accepted`, `blob-named-from-a-moving-head`, `action-registry-from-another-rel`, `replace-objects-allowed`, `bytes-not-hashed`, `allowlist-replace-objects-allowed`, `allowlist-bytes-not-hashed`, `hash-ignores-the-length`, `a-call-bypasses-the-flag`, `old-blob-not-hashed` |
| TP-2 | 3 | `registry-not-judged-whole`, `refusal-loses-the-duplicate-name`, `action-registry-not-judged-whole` |
| TP-3 | 13 | `receipt-not-asked`, `printed-command-unquoted`, `receipt-checked-after-the-match`, `any-receipt-will-do`, `no-receipt-passes`, `refusal-hides-the-command`, `receipt-tolerates-extra-fields`, `receipt-any-kind`, `receipt-any-version`, `receipt-any-confirmation`, `receipt-any-blob-text`, `receipt-path-moved`, `owner-check-falls-back-to-a-git-name` |
| TP-4 | 10 | `one-tty-is-enough`, `no-tty-means-yes`, `unreadable-terminal-means-yes`, `confirmation-comes-from-the-context`, `confirmation-not-required`, `any-typed-text-confirms`, `as-owner-skips-the-terminal`, `receipt-for-a-named-blob`, `receipt-written-outside-the-command`, `cli-gives-the-tenant-command-a-confirm` |
| TP-5 | 5 | `alias-canonicalised-and-trusted`, `realpath-not-native`, `realpath-skipped`, `checkout-not-canonicalised`, `raw-root-handed-to-resolve` |
| TP-6 | 7 | `listing-taken-at-the-checkout`, `listing-reader-wrong-root`, `worktree-asks-its-common-dir`, `new-directory-at-a-listed-path-attaches`, `any-worktree-pointer-will-do`, `a-caller-hands-in-a-listing`, `resolve-tenant-called-from-a-second-place` |
| TP-7 | 5 | `derivation-reads-a-flag`, `derivation-reads-the-environment`, `tenant-show-reads-a-flag`, `a-login-picks-the-tenant`, `envelope-tenant-from-the-request` |
| TP-8 | 8 | `envelope-hand-built`, `binding-not-the-derived-one`, `run-mints-another-action`, `run-claims-the-owner`, `selection-mints-another-action`, `bridge-mints-another-action`, `bridge-claims-the-owner`, `subject-is-not-the-checkout` |
| TP-9 | 11 | `held-lock-reads-as-written`, `unreadable-file-replaced`, `rename-failure-ignored`, `line-not-read-back`, `write-throw-reads-as-written`, `no-state-dir-reads-as-recorded`, `run-starts-unrecorded`, `selection-proceeds-unrecorded`, `selection-outcome-ignored`, `not-recorded-loses-its-name`, `receipt-written-without-admission` |
| TP-10 | 6 | `append-refusal-drops-again`, `unrecorded-refusal-not-said`, `contract-refusal-outcome-ignored`, `unimplemented-refusal-outcome-ignored`, `cli-refusal-outcome-ignored`, `refusal-record-always-claims-written` |
| TP-11 | 10 | `tenant-rule-compares-nothing`, `unlisted-project-passes-the-rule`, `rule-reduced-to-the-project-check`, `bridge-skips-the-tenant-rule`, `tenant-rule-compares-the-asked-with-itself`, `bridge-checks-after-reading`, `unrecorded-read-answered`, `read-outcome-not-recorded`, `stop-work-needs-a-tenant`, `bridge-binds-the-requested-project` |
| TP-12 | 4 | `bridge-refusal-returns-the-reasons`, `bridge-crossing-returns-the-reasons`, `tenant-refusal-not-recorded-at-the-bridge`, `crossing-not-recorded-at-the-bridge` |
| TP-13 | 4 | `run-loses-the-entry-refusal`, `run-asks-after-the-gatekeeper`, `run-skips-the-execute-flag`, `compose-gatekeeper-learns-the-tenant` |
| TP-14 | 11 | `selection-not-asked`, `selection-set-before-it-is-asked`, `selection-refusal-ignored`, `verbs-not-asked`, `verbs-asked-after-the-act`, `packaged-daemon-ignores-its-system-root`, `every-verb-exempt`, `start-exempt`, `restored-selection-unasked`, `default-selection-unasked`, `restored-refusal-ignored` |
| TP-15 | 4 | `tenant-command-unwired`, `sidecar-cannot-reach-the-rule`, `receipt-allowed-under-the-stop`, `show-looks-elsewhere` |
| TP-16 | 6 | `port-grants-by-default`, `boundary-port-grants-by-default`, `receipt-grant-covers-any-subject`, `receipt-grant-covers-any-action`, `grant-built-before-the-terminal`, `receipt-is-not-the-p5-action` |
| TP-17 | 10 | `claim-always-first`, `unreadable-key-reads-as-new`, `completed-key-runs-again`, `unsettled-key-always-retried`, `attempt-not-counted`, `no-store-reads-as-new`, `settle-without-a-claim`, `run-never-claims-its-key`, `run-ignores-a-duplicate`, `corrupt-key-names-no-fix` |
| TP-18 | 2 | `dry-run-mints`, `dry-run-records-its-refusal` |
| TP-19 | 3 | `registry-read-from-the-project`, `state-dir-from-the-environment`, `install-root-from-the-environment` |
| TP-20 | 9 | `statement-hides-the-direct-write`, `statement-claims-a-person`, `statement-overclaims`, `refusal-drops-the-statement`, `show-drops-the-statement`, `evidence-hides-the-direct-write`, `evidence-hides-the-console`, `evidence-hides-the-missing-outcome-line`, `evidence-hides-the-unstopped-duplicate` |
| TP-21 | 5 | `suite-mocks-the-whole-module`, `suite-mocks-a-second-rule`, `real-rule-never-unmocked`, `src-grows-a-test-switch`, `src-reads-a-context-bypass` |
| TP-22 | 2 | `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| TP-23 | 6 | `run-discarded`, `run-kept-before-the-claim`, `stale-run-survives-a-refusal`, `crossing-needs-no-run`, `accessor-hands-out-the-derivation`, `run-held-on-the-context` |
| TP-24 | 5 | `receipt-claims-the-owner`, `method-not-recorded`, `method-names-a-person`, `wording-claims-the-owner`, `refusal-name-claims-the-owner` |
| TP-25 | 9 | `prompt-hides-the-change`, `change-ignores-the-tenant`, `removed-project-not-shown`, `receipt-needs-no-line`, `any-line-will-do`, `line-for-any-blob`, `refused-line-counts`, `receipt-lines-in-the-rotated-file`, `receipt-names-no-envelope` |
| TP-26 | 7 | `no-wait-for-the-lock`, `unbounded-wait`, `wait-grows-past-its-bound`, `unwritable-directory-waits`, `never-rotates`, `rotation-failure-ignored`, `rotation-size-grows` |
| TP-27 | 9 | `evidence-drops-cwd`, `evidence-drops-the-handle`, `evidence-drops-worktree-rule`, `evidence-drops-receipt-rule`, `evidence-drops-jwt-rule`, `evidence-drops-the-budget`, `evidence-hides-dead-aisle`, `evidence-hides-bizcomply`, `evidence-hides-the-console-script` |
| TP-28 | 9 | `registry-trust-basis-claims-the-owner`, `registry-loses-dead-aisle`, `dead-aisle-entered-as-its-worktree`, `added-project-moved-to-the-agency`, `adr-hides-cwd`, `adr-overclaims-the-receipt`, `adr-drops-the-replace-ref-lesson`, `adr-drops-what-git-is-read-for`, `adr-drops-the-binding` |
| TP-T | 4 | `a-proof-skipped`, `a-proof-isolated`, `a-proof-commented-out`, `a-proof-deleted` |

## Decisions for the lead to challenge

1. **The receipt lives in the state directory, not in a commit.** One line for the owner, and no visible diff.
2. **`principal: 'implementer'` on `tenant-registry-change`.** The envelope needs a role, and `owner` is what cannot be
   shown. The method is in the scope and on the receipt.
3. **The `.git` pointer check,** which reads a file ADR-T1 §5 says counts for nothing. It can only refuse.
4. **One receipt, not one per blob.** A rollback needs a new confirmation.
5. **A path that is not its own realpath is refused, not resolved.** A junction to a real root is `TENANT_CHECKOUT_ALIAS`
   even though its realpath is the root. Stricter than needed for safety, and one rule instead of a list.
6. **Verbs in the Control Center are refused without a tenant,** beyond the plan's three crossings, following delta
   Zone 2. `refresh` and `run.stop` are exempt.
7. **A remembered selection refused at start is dropped, not retried.** The surface shows no selection, and the reason
   goes to stderr. The owner sees the full refusal when they choose a project.
8. **Reads wait up to 2 seconds on a held lock,** synchronously, inside the bridge's handler.
9. **`conpty.ps1` is committed.** It is a real proof of the only way out, and it is also a ready tool for the limit above.
10. **Eight lines went into `owner-personal` on D2's "rest mine".** `jd-testing` and `coverdrive` are businesses with
    their own names and repositories. If either is another party's, D4's hard rule applies, and the owner should say so.

## Needs the lead

**Four tests in `projectos/core/test` now fail, because they pin the old registry, and those two files are outside the
v1.33 grant.** `core/src` is untouched. The fix is a grant of `projectos/core/test/tenant.test.ts` and
`projectos/core/test/tenant-contract-review.test.ts`, then:

- `tenant.test.ts:73` `binds exactly the projects`: add the eight `[id, 'owner-personal', 'develop']` rows.
- `tenant.test.ts:83` `canonicalises each repository`: add the eight origins to `origins`.
- `tenant.test.ts:190` and `tenant-contract-review.test.ts:389`: the fixture root `C:/dev/BizComply V2` now holds the
  real `C:/dev/BizComply V2/Source`, so it is a nested root and is rightly refused. Use `C:/dev/A Spaced Project`.

**`val-projectos-tenant-contract1a` pins ADR-T1 §10's "rests on a git name" and §3's "until an owner-only signature or an
owner-gate receipt" lines,** so they stay, each followed by what replaced it. They read as history now. The fix, when
that validator is next granted, is to pin the new wording and drop the old.

## Carried forward

- **`docs/06_Plan.md`** is the lead's, and the plan entry's "owner-last-commit" wording no longer describes the check.
- **`askTerminal` is now in two files.** The fix is one export from `platformStop.ts`, in a phase that owns it.
- **`speed/input-map.cjs`** has no entry for this validator, like the two before it.
