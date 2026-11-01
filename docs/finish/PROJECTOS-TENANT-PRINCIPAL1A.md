# PROJECTOS-TENANT-PRINCIPAL1A — the tenant, read from committed bytes

**Phase:** PROJECTOS-TENANT-PRINCIPAL1A, plan v1.31, under `docs/changes/delta_spec.md`.
**Branch:** `projectos-tenant-principal1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-principal1a`, based on
`b0768486`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. No required review has run yet: ECC SECURITY and Agency
`identity-access-engineer` are the lead's to dispatch. Nothing here touched a live service, a provider, PolyGo or
an agency repository, and nothing was spent.

## The owner act this phase needs

**Once this is merged, every `run`, bridge read and Control Center selection is refused until the owner confirms the
registry.** The refusal is `TENANT_REGISTRY_NO_OWNER_RECEIPT`, and it prints the line below. It is loud on purpose.

After merging, build the installation (`npm run -s build` in `projectos/core`, then `projectos/agent`). Then the owner
runs this one line, in PowerShell or Windows Terminal, because Git Bash gives no terminal:

```
node C:/dev/ProjectOS/projectos/agent/bin/projectos.js tenant receipt --blob 9a49b921729317fe8f863606bb2516776649b96b
```

It shows the bindings and asks for the first 12 characters of the blob. No commit is needed. The blob is
`projectos/security/tenant-registry.json` at `b0768486`; any later change to that file needs a new receipt, and the
refusal will print the new line. I did not create or forge a receipt: the real state directory holds none.

## Delivered

| Commit | Content |
|---|---|
| `6244fa01` | `installation/tenantRegistry.ts`, `commands/tenant.ts`; `governedContext.ts`, `mcp/bridge.ts`, `cli.ts`; one entry refusal in `commands/run.ts` |
| `ff4dba93` | `control-center/sidecar/host.mjs`: selection and acting verbs ask the tenant |
| `e38e4c5f` | `tenantPrincipal.test.ts`, `tenantBridgeRule.test.ts`, `support/tenantWorld.ts`; fixtures in `mcpBridge`, `mcpOAuth`, `platformStop`; `setup.ts` |
| `95935b8e` | Sidecar import kept on its pinned line, found by `val-projectos-kernel-platform-stop1a` |
| `8550f86c` | Four weak proofs the sweep found; the dead `isAbsolute` line removed |
| _this commit_ | `val-projectos-tenant-principal1a`, registered in `validate-all` and `cached-runner`; this file |

## Acceptance criteria

1. **A tenant named in agent text, argv or environment changes nothing (R2), tested:** met. The test sets each of them,
   a project-config field included, and compares `tenant show` byte for byte, then reads the minted envelope.
2. **An unlisted project, a duplicate entry and a registry whose last commit is not the owner's are each refused by
   name, tested:** met, with a change the lead decided. The third is now `TENANT_REGISTRY_NO_OWNER_RECEIPT`, because a
   last-commit check cannot do the job (ADR-T1 §3). The test shows the last commit is named Murad and it is still
   refused, then passes in the same world once a receipt exists.
3. **A refusal that cannot be recorded stops the operation, tested:** met. `appendRefusal` no longer drops. A held lock
   gives `REFUSAL_NOT_RECORDED`, and a read or run whose admission line cannot be written does not happen.
4. **With the project check disabled, a bridge read across tenants is still refused by the tenant rule:** met.
   `tenantBridgeRule.test.ts` wraps the core's `checkBridgeRequest` so it is told the bridge is bound to whatever was
   asked. `gamma` then gets `TENANT_MISMATCH`, and `beta`, the second project in the bound tenant, is answered. A
   companion test shows the same read with the check intact is the project check's refusal, so the wrapper is real.
5. **Linked worktrees follow ADR-T1, and governed runs still work in one, tested:** met, against real git. A real
   `run --dry-run` in a `git worktree add` checkout walks to `DRY RUN: nothing was written and no worker was started.`,
   and the same worktree is refused once its project leaves the registry.
6. **Validator pin and named mutations, each killed by its own rule:** met, 141 of 141. See below for how many also fail a behavioural test.

## Found while building

**Real git keeps listing a removed worktree's path, unmarked, once something new stands there.** Delete the directory,
`git init` there, set the same origin, and `git worktree list` still names the path and does not call it `prunable`,
because a `.git` exists. ADR-T1 §5 and the core's rule assume `prunable` covers this, and it does not: that directory
would have taken the project's tenant. The test written for the ADR's claim failed, which is how this surfaced.
`resolveCheckout` now also requires the checkout's `.git` file to lead into the registered root's `.git/worktrees/`.
That reads a file ADR-T1 says counts for nothing, so note how it is used: **it only ever refuses, and it attaches
nothing.** The listing is still what attaches a worktree. Decision for the lead below.

**The old `appendRefusal` had a second defect.** `sys.readText(path) ?? ''` read an unreadable file as empty, and the
next write would have erased what it held. `appendDurableLine` refuses instead, and a test proves it.

## What the receipt proves, and what it does not

The lead's brief asked the evidence to say this stops an agent with no terminal, not a process that drives a console.
**That is true and it is not the whole limit.** The receipt is a file in the installation state directory, and any
process of this user can write the receipt file directly, as it can rewrite the emergency stop record. It needs no
console to do so.

- **It stops:** an agent or worker using the kernel's route, because `tenant receipt` refuses without a TTY on both
  stdin and stdout. A registry commit alone moving a tenant, because a new blob has no receipt. Going back to an older
  registry, because there is one receipt, not one per blob. An environment variable pointing at a forged receipt,
  because the directory is the platform stop's, and the operating system must agree with it.
- **It does not stop:** a process that drives a console. A process that writes the file. Both are ADR-T1 §10's first
  limit, one Windows user. A worker's write grant does not cover this either, because the file is outside every
  repository, so **a forged receipt is not a visible diff.** A committed receipt would be, and costs an owner commit
  and a merge per registry change. The lead chose one line; the trade is stated here so it can be challenged.

`tamperProof` stays false. `TENANT_RECEIPT_STATEMENT` says this on every `tenant show` and every `tenant receipt`
answer, refusals included, and the validator pins that it still does.

## What this phase does not do

- **`run-start` has no execution line.** The delta holds `run.ts` to one entry refusal, so nothing sees the run end.
  R4's second half is met for `project-selection`, `bridge-read` and `tenant-registry-change`, not for `run-start`.
- **a repeat `run-start` is counted, not stopped.** The key is the HEAD, so a run that did its work has a new key and a
  repeat at the same commit is a retry, with `attempts` recorded. Because no run settles its key, the store's
  `duplicate` answer is proved by tests and by a hand-settled key, and no production path reaches it yet. Reads consume
  no key: they have no effect to repeat. The store's first real consumers are CREDENTIALS1A's crossings.
- **`readmitEnvelope` and `mintCrossing` have no caller.** No persisted envelope is read back, and no run-linked action
  is minted here. The binding in CONTRACT1A applies when CREDENTIALS1A wires them.
- **`run-start`'s budget is 0,** so `mintCrossing` would refuse a paid crossing from it. CREDENTIALS1A must set one.
- **`action-registry-change` has no receipt.** ADR-T1 says the same limit applies to it. The action registry is read
  from committed bytes and judged whole, and its floors are in code, but a commit can still change it.
- **The P5 grant for `tenant-registry-change` is the typed confirmation, and nothing else has a grant.** `NO_GRANT`
  answers everything this phase admits, because P1 and P2 never ask the port.
- **The typed confirmation has not been tried in a real console.** This session has no terminal. Its TTY logic is
  tested with an injected terminal, and the no-terminal refusal against the real process. `askTerminal` is a copy of
  `stop lift`'s, because `platformStop.ts` does not export it and is outside these writePaths.
- **The packaged daemon is untested.** `host.mjs` passes the bound system root as the installation, by reading, and
  no MSI was built. `host.mjs` has no unit tests: it is pinned as text, and `node --check` passes.

## The test suite's one mock

`test/setup.ts` replaces `runStartTenantRefusal`, and only that function, for the whole agent suite, because its
fixtures are in no registry and every `run` test would stop at `TENANT_UNKNOWN`. Production code has no switch: nothing
in `src/` turns the rule off. `tenantPrincipal.test.ts` calls `vi.unmock` and runs the real rule. TP-21 pins the mock's
exact shape, the unmock, and that the entry has no bypass. The cost is real: tests other than that file no longer pass
through the rule.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Build | `npm run -s build` in `projectos/core`, then `projectos/agent` | 0 errors |
| Test typecheck | `npx tsc -p tsconfig.test.json` in `projectos/agent` | 0 errors |
| Full agent suite, final tree, nothing else running | `vitest run` in `projectos/agent`, at `8550f86c` | 101 files, 3015 tests, all pass |
| Control Center suite | `vitest run` in `projectos/control-center`, before `8550f86c`, which changed nothing it loads | 66 files, 890 tests, all pass |
| This phase's validator | `node projectos/validators/val-projectos-tenant-principal1a.cjs` | PASS, 141 named mutations, each killed by its own rule |
| Validators reading a touched file | 21, each in its own process; the RLS validator on its own, the rest on the final tree | 21 PASS, 0 FAIL. Includes `val-projectos-boot-continue1a`, which pins `run.ts`, `val-projectos-kernel-platform-stop1a`, `val-projectos-tenant-contract1a`, `validate-no-secrets`, `validate-forbidden-actions`. A further 3 that walk the agent source: 3 PASS |
| Real CLI in this worktree, read-only | `tenant show`, and `tenant receipt --blob … --as owner` | `TENANT_REGISTRY_NO_OWNER_RECEIPT` with the one line, and `TENANT_RECEIPT_NEEDS_A_TERMINAL`. Nothing written to the real state directory. The worktree bound to `projectos` through the real `C:/dev/ProjectOS` listing |

**Not run:** full `validate-all`, which is the lead's. A real interactive terminal. A packaged daemon.

**Two failures on the way, both stated:**

- The first full suite, at `e38e4c5f`, had 1 failure of 3012: `accepted for an owner-identity commit, after which runLoop proceeds` in `platformStop.test.ts`. The Control Center suite and the validators were running at the same time. It passed 3 of 3 alone and in the final full run. That path does not touch this phase's code, but **I did not find the cause, so treat it as a load-sensitive test, not an explained one.**
- `val-projectos-tenant-rls1a` failed once in the same overloaded batch (`TR-H1`, its harness timed out). It passed when run alone, with this phase's registration in place.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so 141 of 141 says the pins fire, not that a behaviour test fails. So mutations were applied to the real source files, the proof each should trip was run with an exact filter, the failing test was read, and the file restored. Clean `git status` confirmed each restore.

- **61 of the 141 were swept. 60 are killed by a behavioural test, and the 80 not swept have only their text pin.** Those 80 include the docs, registration and evidence mutations, which alter no behaviour, but many are real code mutations. Not all were tried. Each run of both test files takes minutes, so the sweep took the rules that matter most, including all of the tenant rule's.
- **`receipt-path-moved` survives correctly:** reader and writer share the path, so it alters no behaviour, and TP-3 is its only catch.
- **The sweep found four real weaknesses, all fixed in `8550f86c`:** the receipt grant was tested through a copy in the test, so it is now one exported function. The committed read was hidden behind the dirty check, so a test now edits the registry under `git update-index --assume-unchanged`, which hides the edit from `git diff`. Two unrecorded branches, the selection's outcome and the bridge's derivation refusal, were never reached. A fifth survivor showed `isAbsolute` was dead code, and it is removed.
- **My first sweep was invalid.** It split multi-word filters through a shell, so it ran the wrong tests, and its 29 of 40 means nothing. The numbers above are from the corrected script, which records which test made each kill. The sweep ran across `e38e4c5f` to `8550f86c`, and the 40 from its first pass were not repeated after the fixes.

## Mutations, by rule

Every mutation below was killed by the rule it names, in `selfTest`, on the final text.

| Rule | Count | Mutations |
|---|---|---|
| TP-1 | 5 | `registry-read-from-the-working-tree`, `dirty-registry-accepted`, `uncommitted-registry-accepted`, `blob-named-from-a-moving-head`, `action-registry-from-another-rel` |
| TP-2 | 3 | `registry-not-judged-whole`, `refusal-loses-the-duplicate-name`, `action-registry-not-judged-whole` |
| TP-3 | 12 | `receipt-not-asked`, `receipt-checked-after-the-match`, `any-receipt-will-do`, `no-receipt-passes`, `refusal-hides-the-command`, `receipt-tolerates-extra-fields`, `receipt-any-kind`, `receipt-any-version`, `receipt-any-confirmation`, `receipt-any-blob-text`, `receipt-path-moved`, `owner-check-falls-back-to-a-git-name` |
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
| TP-14 | 8 | `selection-not-asked`, `selection-set-before-it-is-asked`, `selection-refusal-ignored`, `verbs-not-asked`, `verbs-asked-after-the-act`, `packaged-daemon-ignores-its-system-root`, `every-verb-exempt`, `start-exempt` |
| TP-15 | 4 | `tenant-command-unwired`, `sidecar-cannot-reach-the-rule`, `receipt-allowed-under-the-stop`, `show-looks-elsewhere` |
| TP-16 | 6 | `port-grants-by-default`, `boundary-port-grants-by-default`, `receipt-grant-covers-any-subject`, `receipt-grant-covers-any-action`, `grant-built-before-the-terminal`, `receipt-is-not-the-p5-action` |
| TP-17 | 9 | `claim-always-first`, `unreadable-key-reads-as-new`, `completed-key-runs-again`, `unsettled-key-always-retried`, `attempt-not-counted`, `no-store-reads-as-new`, `settle-without-a-claim`, `run-never-claims-its-key`, `run-ignores-a-duplicate` |
| TP-18 | 2 | `dry-run-mints`, `dry-run-records-its-refusal` |
| TP-19 | 3 | `registry-read-from-the-project`, `state-dir-from-the-environment`, `install-root-from-the-environment` |
| TP-20 | 8 | `statement-hides-the-direct-write`, `statement-overclaims`, `refusal-drops-the-statement`, `show-drops-the-statement`, `evidence-hides-the-direct-write`, `evidence-hides-the-console`, `evidence-hides-the-missing-outcome-line`, `evidence-hides-the-unstopped-duplicate` |
| TP-21 | 5 | `suite-mocks-the-whole-module`, `suite-mocks-a-second-rule`, `real-rule-never-unmocked`, `src-grows-a-test-switch`, `src-reads-a-context-bypass` |
| TP-22 | 2 | `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| TP-T | 4 | `a-proof-skipped`, `a-proof-isolated`, `a-proof-commented-out`, `a-proof-deleted` |

## Decisions for the lead to challenge

1. **The receipt lives in the state directory, not in a commit.** See above. One line for the owner, and no visible diff.
2. **The `.git` pointer check,** which reads a file ADR-T1 §5 says counts for nothing. It can only refuse. ADR-T1 §5.2
   should be corrected: `prunable` does not cover a new directory at a listed path.
3. **One receipt, not one per blob.** A rollback needs a new confirmation.
4. **A path that is not its own realpath is refused, not resolved.** A junction to a real root is `TENANT_CHECKOUT_ALIAS`
   even though its realpath is the root. Stricter than needed for safety, and one rule instead of a list.
5. **Principals.** A run is `implementer`, reads including selection are `advisor`, and `tenant receipt` is `owner`. The
   actor is a fixed kernel value, because no worker has started at a boundary.
6. **Verbs in the Control Center are refused without a tenant,** beyond the plan's three crossings, following delta
   Zone 2 ("and governed verbs"). `refresh` and `run.stop` are exempt. So an unlisted project can be seen in the
   portfolio but not selected, as the delta says.
7. **Record contention fails closed and does not wait.** A held lock refuses a read. The window is a few milliseconds,
   but it is a refusal, and a lock left by a killed process blocks until a person removes it. The refusal says which.
8. **`envelope-records.jsonl` is rewritten whole on each line,** and it has no rotation. Low volume today.

## Carried forward

- **ADR-T1 needs an owner-accepted edit, and it is outside these writePaths:** §3 ("chooses one of those two") and §10
  ("rests on a git name") should name the receipt; §5.2 as above. `val-projectos-tenant-contract1a` pins that wording
  (`adr-hides-git-name-limit`), so the pin moves with it. The registry's `trustBasis` text and the action registry's
  note say the same, and those two files need a `tenant-registry-change` and an `action-registry-change`. Editing
  the tenant registry changes its blob, so do that **before** the owner's first receipt.
- **`docs/06_Plan.md`** is the lead's, and the plan entry's "owner-last-commit" wording no longer describes the check.
- **`askTerminal` is now in two files.** The fix is one export from `platformStop.ts`, in a phase that owns it.
- **`speed/input-map.cjs`** has no entry for this validator, like the two before it.
