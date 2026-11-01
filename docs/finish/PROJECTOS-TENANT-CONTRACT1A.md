# PROJECTOS-TENANT-CONTRACT1A — tenant contract

**Phase:** PROJECTOS-TENANT-CONTRACT1A, phase 1 of V4 Stage 2, plan v1.28 (activated at `f2d2ec9`), under
`docs/changes/delta_spec.md` revision 2.
**Branch:** `projectos-tenant-contract1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-contract1a`, based
on `f2d2ec9`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete, two review rounds and one additional gstack pass answered. The last two
fix rounds were read by the lead and not re-reviewed (see "Required review status"). The gstack round was
built on `projectos-tenant-stack2`, worktree `C:/dev/ProjectOS-worktrees/tenant-stack2`. Nothing here touches
a live service, and nothing at run time reads these records yet.

## Delivered

| Commit | Content |
|---|---|
| `c9cdae2` | `tenant-registry.json`, `action-registry.json`, `tenant-registry.schema.json`, both listed in `trust-boundary.json` |
| `522d385` | `core/src/tenant.ts`, `actionRegistry.ts`, `taskEnvelope.ts`, barrel exports, tests |
| `2ca5ddb` | ADR-T1 (Proposed); ADR-K1 status only (Accepted, D3); docs 00, 01, 04 and 05 |
| `a2abbf4` | `val-projectos-tenant-contract1a`, registered in `validate-all` and `cached-runner` |
| `ed26a7e` | Test fixes: two undiscriminating proofs found by the sweep below; malformed-line coverage |
| `1224682` | Review round: provenance, class gate, boundary roots, alias closure, worktree listing, floors, tests, records, schema |
| `85014d2` | Review round: ADR-T1 corrections; validator rules TC-34 to TC-40 and TC-T |
| `aa884ee` | Review round: execution-line test; equivalent mutant removed |
| `dd2ce19` | Final round: bounded readmission, `mintCrossing` replacing `checkRunLink`, P3 asks the grant port, purity pin |
| `0f728210` | gstack round: readmission checks scope and identity; minted is not admitted; the port sees provenance; budget ruling; TC-T reads stripped source |
| `a4ac1c66` | gstack round: 0003 pinned as applied live in the RLS validator; its evidence corrected |
| `b6eb149a` | gstack round: the only-a-run proof now reaches its own rule |
| `1d66bc1d` | gstack recheck: a parent must be admitted; ADR-T1 on late outcomes and the ledger's reach; P3 port test |
| `8fb6710f` | gstack recheck: D11 recorded in the delta |

## Acceptance criteria

1. **ADR-T1 states every limit and the owner's hard rule:** met. §10 carries each item of "What Stage 2
   does not prove"; §11 carries the hard rule. Pinned by TC-1 and TC-2.
2. **The registry binds identity to tenant and domain; a duplicate or wildcard refuses the whole file,
   tested:** met. `tenant.test.ts`. A wildcard is reported by name, ahead of the shape rule that would also
   refuse it, and a test asserts the code.
3. **The action registry names both vocabularies; the tenant actions are P5; an unregistered action is
   P5, tested:** met. `action-registry.test.ts`. After the review an unregistered action also cannot pass
   the door.
4. **R1 and R3, tested:** met. `task-envelope.test.ts`. Each of the 16 fields is removed in turn against a
   literal list, so dropping a field from the code cannot drop it from the proof. Each R3 field changes
   alone, and the unchanged child is the positive control.
5. **Validator pin and named mutations, each killed by its own rule:** met. 346 of 346, 41 rules.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Core typecheck | `npx tsc -p tsconfig.json --noEmit` in `projectos/core` | 0 errors |
| Core and agent build | `npm run -s build` in `projectos/core`, then `projectos/agent` | 0 errors. Agent `tsc` compiled against the new barrel |
| Full core suite | `npx vitest run` in `projectos/core` | 31 files, 1186 tests, all pass |
| New tests | `tenant`, `action-registry`, `task-envelope`, `tenant-contract-review` | 65, 85, 98 and 157 tests (405) |
| Fail-before evidence | `tenant-contract-review.test.ts` run at `1a6b44e`, before any fix | 88 failed, 15 passed. The 15 are positive controls and invariants. Some of the 88 fail because the new API did not yet exist; the forged envelope, the class gate, R3 principal, alias, floor and environment tests fail on behaviour |
| Fail-before evidence, final round | The final-round tests run at `336feda`, before any fix | 31 failed, 8 passed. The 8 are controls and behaviour that must stay. Some of the 31 fail because `mintCrossing` did not exist; the readmission and P3 tests fail on behaviour |
| Fail-before evidence, gstack round | The suite run at `f77e1731` with the new tests added, before any fix | 15 failed: 14 of the 19 new tests and 1 reworked existing test. `0f728210`'s message says 15 of 19; this split is the exact one. Of the 5 new tests that passed, 3 are positive controls, 1 is the per-call budget test, which pins existing behaviour, and 1, the port-tampering test, passed for the wrong reason until `via` reached the port; its mutation `provenance-left-mutable` shows it now discriminates |
| Fail-before evidence, gstack recheck | The suite run at `cc0bff46` with the new tests added, before any fix | 3 of 6 new tests failed, including the reported attack. The other 3 pin behaviour that must stay: the positive control, the late outcome, and the P3 port, which proves itself through its mutation `port-not-handed-the-provenance-at-p3` |
| This phase's validator | `node projectos/validators/val-projectos-tenant-contract1a.cjs` | PASS, 346 named mutations killed |
| Own-rule count, second harness | Script applying each mutation and reading `check()` output, separate from `selfTest` | 346 of 346, 41 rules |
| RLS validator | `val-projectos-tenant-rls1a` at `8fb6710f` | PASS, 205 named mutations killed, its Postgres harness run |
| Validators reading a touched file | 52, each in its own process through `run()`, at `8fb6710f` | 52 PASS, 0 FAIL. Includes `validate-no-secrets`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` (FU-6, runners identical), `validate-speed-validation-cache`, `validate-forbidden-actions` |
| Rerun on the final tree, this file included | `validate-no-secrets`, `val-projectos-tenant-contract1a`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` | 4 PASS |

**Not run:** full `validate-all` (the lead runs it after stacking). Agent tests. No test or validator here
reads the registries through the kernel, because that reader does not exist yet.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so 346 of 346 says the pins fire, not that a behaviour test fails.
So each mutation of a core source file was also applied to the real file, the four test files
run, and the file restored. Clean `git status` confirmed the restore.

- **Sweep of the gstack recheck, at `8fb6710f`:** 223 core-source mutations, 208 killed by a behavioural test,
  including `port-not-handed-the-provenance-at-p3`, `parent-needs-only-a-brand` and
  `execution-refuses-a-late-outcome`.
- **All 15 survivors alter no behaviour, and the validator is their only catch:** the same 2 comment and 13
  purity or type-only survivors as the gstack round below. No real gap this time. Only this evidence file
  follows this sweep.

The earlier rounds:

- **Sweep of the gstack round, at `a4ac1c66`:** 220 core-source mutations, 204 killed by a behavioural test.
- **One survivor was a real test defect, caused by this round and now fixed:** `crossing-from-anything`. The
  new admission check refused the test's unadmitted envelope first, so `only a run can be crossed from` passed
  with the `run-start` rule removed. It now uses an admitted envelope of another action and asserts the
  reason. The mutation was rerun: killed. So 205 of 220.
- **The other 15 survivors are correct, and the validator is their only catch:** they alter no behaviour.
  Two change only a comment: `code-hides-the-per-call-budget`, `code-calls-the-field-a-total`. The rest are the
  13 purity and type-only survivors listed under the final round below.
- **Sweep of the final round, at `dd2ce19`:** 205 core-source mutations, 192 killed by a behavioural test.
- **The 13 survivors are correct, and the validator is their only catch:** purity and type-only changes alter
  no behaviour. They are `tenant-reads-environment`, `tenant-imports-the-filesystem`, `tenant-bare-import`,
  `tenant-reexport-from-a-module`, `tenant-tight-import`, `tenant-tight-reexport`,
  `tenant-reaches-process-by-bracket`, `action-registry-imports-a-module`, `request-type-gains-a-tenant`,
  `envelope-gains-a-registered-field`, `envelope-gains-a-via-field`, `listing-loses-its-root` and
  `governance-vocabulary-outgrows-registry` (a union member, erased at run time, that no role list holds).
- **No real gap this time.** This sweep ran on the final code, and only this evidence file follows it.

- **Sweep of the review round, at `85014d2`:** 167 of 180 killed by a behavioural test.
- **One survivor was a real test defect, now fixed:** `execution-line-omits-provenance`. Nothing tested that
  the execution line carries `registered` and `via`. The test was added and the mutation rerun: killed.
- **One survivor was an equivalent mutant, and is removed:** `foreign-check-after-the-route`. With no route
  the answer is `TENANT_MISMATCH` either way, so that mutation and its order pin proved nothing.
- **Eleven survivors are correct, and the validator is their only catch:** purity and type-only changes alter
  no behaviour. They are `tenant-reads-environment`, `tenant-imports-the-filesystem`, `tenant-bare-import`,
  `tenant-reexport-from-a-module`, `tenant-reaches-process-by-bracket`, `action-registry-imports-a-module`,
  `request-type-gains-a-tenant`, `envelope-gains-a-registered-field`, `envelope-gains-a-via-field`,
  `listing-loses-its-root` and `governance-vocabulary-outgrows-registry` (a union member, erased at run
  time, that no role list holds).
- **The first round of this sweep,** at `a2abbf4`, found two undiscriminating proofs, fixed in `ed26a7e`.

## Mutations, by rule

Every mutation below was killed by the rule it names.

| Rule | Count | Mutations |
|---|---|---|
| TC-1 | 6 | `adr-hides-worker-reach`, `adr-hides-the-real-fixes`, `adr-hides-git-name-limit`, `adr-hides-harness-only-proof`, `adr-hides-unrun-scenarios`, `adr-hides-owner-sees-both` |
| TC-2 | 2 | `adr-softens-hard-rule`, `adr-exit-proof-lifts-hard-rule` |
| TC-3 | 45 | `adr-drops-principal`, `adr-gives-supabase-authority`, `adr-drops-tenant-versus-domain`, `adr-drops-trust-basis`, `adr-drops-self-hosted-rationale`, `adr-hides-that-all-commits-are-murad`, `adr-overclaims-the-owner-check`, `adr-unbacks-same-terms`, `adr-claims-domains-were-decided`, `adr-drops-principal-from-r3`, `adr-any-listing-attaches`, `adr-claims-allowlist-guards-release`, `adr-worktree-may-release`, `adr-closes-the-release-grant`, `adr-hides-no-owner-step`, `adr-drops-postgres-rule`, `adr-postgres-wins`, `adr-drops-roots-ruling`, `adr-drops-run-link`, `adr-keeps-broker-call-local`, `adr-readmission-trusts-the-subject`, `adr-readmission-trusts-the-scope`, `adr-drops-minted-not-admitted`, `adr-calls-the-budget-cumulative`, `adr-adds-a-second-ledger`, `adr-says-expired-gets-no-line`, `adr-calls-the-ledger-account-wide`, `adr-says-the-record-counts-money`, `adr-says-workers-pass-through`, `adr-drops-the-stage-4-carry`, `adr-hides-that-the-port-sees-via`, `code-hides-the-per-call-budget`, `code-calls-the-field-a-total`, `adr-makes-the-link-optional`, `adr-hides-the-p3-grant-source`, `adr-drops-readmission-limits`, `adr-worktree-trusts-itself`, `adr-worktree-grants-spend`, `adr-drops-tenant-class`, `adr-drops-platform-class`, `adr-drops-project-class`, `adr-drops-owner-sees-both-ruling`, `adr-drops-service-role`, `adr-drops-stop-work`, `adr-drops-one-user-limit` |
| TC-4 | 1 | `adr-t1-acceptance-drops-owner-word` |
| TC-5 | 3 | `adr-k1-still-proposed`, `adr-k1-names-no-owner-word`, `adr-k1-status-rule-dropped` |
| TC-6 | 5 | `registry-moves-agency-to-owner`, `registry-changes-a-domain`, `registry-moves-a-root`, `registry-repository-not-canonical`, `registry-loses-polygo` |
| TC-7 | 9 | `registry-duplicate-repository`, `registry-duplicate-root`, `registry-duplicate-project`, `registry-wildcard-root`, `registry-wildcard-repository`, `registry-reserved-project-id`, `registry-undeclared-tenant`, `registry-unknown-domain`, `registry-nested-root` |
| TC-8 | 9 | `schema-tolerates-extra-project-fields`, `schema-domain-enum-drifts`, `schema-tenant-pattern-drifts`, `schema-allows-reserved-prefix`, `schema-root-pattern-drifts`, `schema-root-alias-dropped`, `schema-repository-pattern-drifts`, `schema-allows-dot-git`, `code-root-rule-drifts-from-schema` |
| TC-9 | 3 | `trust-boundary-omits-tenant-registry`, `trust-boundary-omits-action-registry`, `trust-boundary-claims-enforcement` |
| TC-10 | 6 | `registry-loses-a-governance-spelling`, `registry-loses-an-owner-only-spelling`, `registry-splits-phase-closure`, `registry-invents-a-spelling`, `governance-vocabulary-outgrows-registry`, `owner-floor-outgrows-registry` |
| TC-11 | 4 | `cross-tenant-access-lowered`, `tenant-registry-change-lowered`, `cross-tenant-access-unlisted`, `action-registry-change-lowered` |
| TC-12 | 4 | `phase-closure-lowered`, `secrets-handling-lowered`, `approve-lowered`, `commit-lowered` |
| TC-13 | 2 | `action-registry-duplicate-spelling`, `action-registry-wildcard` |
| TC-14 | 11 | `tenant-reads-environment`, `tenant-imports-the-filesystem`, `envelope-reads-the-clock`, `action-registry-imports-a-module`, `tenant-bare-import`, `tenant-dynamic-import`, `tenant-reexport-from-a-module`, `tenant-tight-import`, `tenant-tight-reexport`, `envelope-reads-the-performance-clock`, `tenant-reaches-process-by-bracket` |
| TC-15 | 8 | `registry-live-despite-problems`, `registry-skips-project-lines`, `registry-skips-tenant-lines`, `registry-skips-duplicates`, `registry-any-schema-version`, `registry-prose-optional`, `registry-never-marked-live`, `registry-skips-nested-roots` |
| TC-16 | 4 | `wildcard-matches-nothing`, `project-wildcard-falls-to-shape`, `tenant-wildcard-falls-to-shape`, `wildcard-scan-skips-repository` |
| TC-17 | 5 | `duplicate-project-case-sensitive`, `duplicate-ignores-repository`, `duplicate-ignores-root`, `duplicate-filter-keeps-nothing`, `root-key-case-sensitive` |
| TC-18 | 3 | `reserved-prefix-case-sensitive`, `reserved-prefix-never-matches`, `reserved-check-not-asked` |
| TC-19 | 2 | `unlisted-falls-to-first-project`, `unvalidated-registry-resolves` |
| TC-20 | 4 | `repository-not-compared`, `no-origin-accepted`, `root-compare-always-true`, `route-refusal-removed` |
| TC-21 | 7 | `linked-worktree-any-directory`, `linked-worktree-listing-not-matched`, `porcelain-keeps-the-root`, `porcelain-keeps-prunable`, `asked-root-is-not-the-registered-one`, `allowlist-now-admits-linked-worktrees`, `allowlist-shape-check-gutted` |
| TC-22 | 4 | `binding-brand-accepts-any-object`, `binding-not-frozen`, `binding-never-branded`, `mint-skips-the-brand` |
| TC-23 | 17 | `envelope-field-dropped`, `budget-field-dropped`, `missing-field-tolerated`, `unparseable-field-tolerated`, `unknown-field-tolerated`, `reasons-do-not-refuse`, `any-envelope-version`, `expiry-any-date-text`, `actor-any-object`, `blank-is-a-value`, `action-any-text`, `action-name-shape-gutted`, `actor-shared-with-the-source`, `expiry-never-expires`, `sparse-scope-accepted`, `paid-action-needs-no-budget`, `broker-call-not-paid` |
| TC-24 | 7 | `mint-spreads-the-request`, `mint-takes-tenant-from-the-request`, `mint-takes-class-from-the-request`, `mint-takes-environment-from-the-context`, `request-type-gains-a-tenant`, `mint-skips-the-registry`, `idempotency-key-omits-tenant` |
| TC-25 | 10 | `child-tenant-not-compared`, `child-domain-not-compared`, `child-project-not-compared`, `child-environment-not-compared`, `child-principal-not-compared`, `child-equality-always-holds`, `child-lineage-not-compared`, `child-not-parsed`, `child-reasons-do-not-refuse`, `minted-child-not-checked` |
| TC-26 | 6 | `child-scope-widens`, `child-budget-widens`, `child-expiry-widens`, `child-class-widens`, `class-order-gutted`, `class-order-reversed` |
| TC-27 | 10 | `recorder-falsy-accepted`, `recorder-throw-reads-as-written`, `minted-refusal-not-carried-to-the-door`, `admitted-marked-before-the-line`, `unrecorded-admission-proceeds`, `admitted-before-recorded`, `refusal-not-recorded`, `expiry-not-asked-at-admission`, `class-asked-after-the-line-is-written`, `execution-record-reports-success` |
| TC-28 | 6 | `unregistered-action-is-p1`, `unregistered-action-is-local`, `unregistered-reads-as-registered`, `unvalidated-registry-answers`, `lookup-folds-case`, `registered-class-ignored` |
| TC-29 | 16 | `action-registry-live-despite-problems`, `action-floors-skipped`, `action-duplicates-skipped`, `action-vocabulary-skipped`, `action-entries-skipped`, `action-prose-optional`, `action-wildcard-matches-nothing`, `action-wildcard-not-asked`, `action-duplicate-filter-keeps-nothing`, `absolute-floor-dropped`, `governance-floor-dropped`, `owner-floor-dropped`, `reserved-floor-allows-any-class`, `floor-test-always-passes`, `owner-floor-lowered-in-code`, `reserved-action-unlisted-in-code` |
| TC-30 | 4 | `governance-vocabulary-copied-locally`, `owner-vocabulary-copied-locally`, `vocabulary-check-one-directional`, `reserved-presence-not-checked` |
| TC-31 | 3 | `barrel-omits-tenant`, `barrel-omits-action-registry`, `barrel-omits-envelope` |
| TC-32 | 2 | `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| TC-33 | 9 | `trd-denies-engines-again`, `baseline-denies-engines-again`, `baseline-loses-the-tenant-records`, `baseline-count-of-record-dropped`, `prd-loses-the-tenant-vocabulary`, `prd-loses-the-hard-rule`, `trd-loses-the-tenant-section`, `schema-doc-loses-tenant-registry`, `schema-doc-loses-action-registry` |
| TC-34 | 37 | `door-takes-unbranded`, `brand-never-set`, `provenance-left-mutable`, `readmit-ignores-the-scope`, `readmit-trusts-its-subject`, `readmit-trusts-its-idempotency-key`, `readmit-trusts-its-parent`, `readmit-fact-compare-always-holds`, `door-never-marks-admitted`, `mint-marks-admitted`, `execution-records-the-unadmitted`, `mint-does-not-brand`, `parse-brands-its-output`, `readmit-marks-everything-registered`, `readmit-keeps-a-run-link`, `readmit-takes-the-record-as-its-limit`, `readmit-accepts-an-expired-record`, `readmit-trusts-its-principal`, `readmit-trusts-its-actor`, `readmit-trusts-its-budget`, `readmit-trusts-its-expiry`, `readmit-unreadable-limit-passes`, `forged-parent-accepted`, `parent-needs-only-a-brand`, `execution-refuses-a-late-outcome`, `readmit-takes-a-copied-binding`, `readmit-trusts-its-tenant`, `readmit-trusts-its-domain`, `readmit-trusts-its-project`, `readmit-trusts-its-environment`, `readmit-trusts-its-class`, `readmit-compare-always-holds`, `readmit-reasons-do-not-refuse`, `readmit-derives-from-the-record`, `child-class-not-rederived`, `child-environment-not-rederived`, `child-derives-from-itself` |
| TC-35 | 19 | `p6-reaches-the-port`, `port-asked-before-p6`, `unregistered-reaches-the-port`, `p4-reaches-the-door`, `p5-needs-no-grant`, `p3-needs-no-grant`, `port-not-told-the-provenance`, `port-not-handed-the-provenance-at-p3`, `port-not-handed-the-provenance-at-p5`, `run-link-not-asked-at-the-door`, `run-link-asked-after-the-port`, `grant-truthy-accepted`, `grant-throw-reads-as-granted`, `class-refusal-ignored`, `allowed-line-omits-provenance`, `refusal-line-omits-provenance`, `execution-line-omits-provenance`, `envelope-gains-a-registered-field`, `envelope-gains-a-via-field` |
| TC-36 | 24 | `crossing-may-be-a-child`, `boundary-test-always-false`, `crossing-omits-tenant`, `crossing-omits-domain`, `crossing-omits-project`, `crossing-omits-principal`, `crossing-compare-always-holds`, `crossing-takes-an-unbranded-run`, `crossing-takes-a-merely-minted-run`, `crossing-from-anything`, `crossing-for-any-action`, `crossing-from-an-expired-run`, `crossing-above-the-run-budget`, `crossing-after-the-run-expiry`, `crossing-reasons-dropped`, `crossing-takes-the-caller-scope`, `crossing-not-marked-linked`, `run-link-scope-any-text`, `run-link-check-is-back`, `run-linked-omits-credential-release`, `run-linked-omits-broker-call`, `run-linked-omits-commit`, `run-linked-omits-push`, `run-linked-test-always-false` |
| TC-37 | 7 | `root-admits-any-text`, `root-alias-not-asked`, `repository-admits-any-segments`, `repository-admits-any-port`, `repository-keeps-git-suffix`, `ascii-lower-folds-unicode`, `repository-compare-folds-unicode` |
| TC-38 | 5 | `listing-from-anywhere-attaches`, `checkout-under-foreign-root-allowed`, `at-or-under-drops-the-slash`, `nested-roots-not-judged`, `listing-loses-its-root` |
| TC-39 | 5 | `table-broker-call-back-to-local`, `table-push-back-to-local`, `table-run-start-raised`, `table-bridge-read-raised`, `table-gains-an-action` |
| TC-40 | 4 | `boundary-floors-not-applied`, `credential-release-floor-lowered-in-code`, `broker-call-floor-lowered-in-code`, `run-start-floor-lowered-in-code` |
| TC-T | 8 | `a-tight-suite-skipped`, `a-proof-skipped`, `a-proof-isolated`, `a-table-skipped`, `a-suite-skipped`, `a-proof-commented-out`, `a-whole-file-commented-out`, `a-proof-deleted` |

## Required review status

- **ECC SECURITY:** two rounds, verdict **APPROVE WITH CHANGES**, no HIGH open. This final round was read by
  the lead and not re-reviewed, because the one-recheck limit was used.
- **Agency `software-architect`:** the persona read succeeded. The wrapper's handback was blocked by the
  Agency guard, and the lead took the report text from the wrapper's task output. The guard later refused a
  direct read of a wrapper transcript as governed. The findings were verified against the code, and ECC
  independently found F2 and F3 (as H1 and M3). **The owner decides whether this satisfies the plan's
  required Agency review.**
- **gstack review:** an additional review, not a replacement for a plan-required one. Its record says
  `completed: false`, because its Review Army and QA steps were not run. This fix round was read by the
  lead and not re-reviewed.

## gstack round

From a gstack-review adversarial pass on `projectos-tenant-stack2` at `f77e1731`. The lead verified the first
two findings and decided the design calls. Migrations `0001`, `0002`, `0003` and `live-owner-membership.sql`
are live, and their bytes did not change.

| Finding | Disposition |
|---|---|
| `readmitEnvelope` did not check `scope`, `subjectHash`, `idempotencyKey` or `parentEnvelopeId`; a tampered scope was readmitted and then admitted a `secrets/**` child its parent had refused | Fixed. Required limits: the allowed scope, and the expected `subjectHash`, `idempotencyKey` and `parentEnvelopeId`. Any difference refuses |
| **Rated CRITICAL by the skill:** `budget <= run.budget` is per call and nothing draws the run down | **Not changed in code, by decision.** The observation is correct. `gatekeeperCostLedger`, through `admitGatekeeperSpend`, refuses a paid call before dispatch, against committed caps, so no second total is added here. **The recheck narrowed this:** that cap is per project root, and it is not account-wide. See "gstack recheck". A second running total would be a second answer to what was spent. ADR-T1 §8 and the code now say an envelope budget is a per-call ceiling and the ledger is the cumulative cap, and a test pins the behaviour. Nothing yet connects a `broker-call` envelope to the ledger; both sit on the same path once PRINCIPAL1A wires it |
| The brand meant minted, not admitted: a run refused under R4 still linked an admitted `credential-release`, and `recordExecution` recorded forged and expired envelopes | Fixed. Admission is tracked apart from the brand and set only after the door writes its line. `mintCrossing` and `recordExecution` require it, and after the recheck so does `mintEnvelope` for a parent. A readmitted run must pass the door again. "Expired" here means refused as expired at the door: an envelope admitted in time can still record a late outcome |
| `EnvelopeGrantPort` could not see `via`, though ADR-T1 says worktree identity alone must never release a secret | Fixed. The port receives the frozen provenance as a second argument: `via`, `registered`, `runLinked`. A test has a port refuse a worktree binding and grant the registered root |
| TC-T matched raw text, so a comment satisfied it, proven with the whole review test file commented out | Fixed. TC-T reads comment-stripped source. Mutations `a-whole-file-commented-out` and `a-proof-commented-out` |
| The RLS validator's `LIVE_APPLIED` omitted `0003`, and its evidence said it was not applied | Fixed. Pinned at `094d74db…17bf`, mutation `applied-0003-edited`, evidence corrected. The bytes on disk match the pin |

## gstack recheck

As relayed by the lead at `cc0bff46`; this file does not hold the recheck's own report.

**Closed:**

| Item | Disposition |
|---|---|
| `mintEnvelope` asked for a brand, so a child of a refused run was admitted | Fixed. The parent must be admitted. Mutation `parent-needs-only-a-brand` |
| ADR-T1 said an expired envelope gets no execution line | Corrected, and `recordExecution` deliberately unchanged. A forged envelope gets no line. An expired one still can if it was admitted before expiry, because an operation admitted in time that finishes late must record its outcome. Test added; mutation `execution-refuses-a-late-outcome` |
| ADR-T1 overstated the ledger | Corrected in §8. The ledger is per project root, so it is not an account-wide cap. The installation record counts calls, not money. Workers and `codex exec` do not pass through it |
| A lying P3 port provenance was caught only by TC-35's text pin | A behavioural test now kills `port-not-handed-the-provenance-at-p3` |
| D11, agency client data | Recorded in the delta after D10: "No for now". Revisit before Stage 5 |

**Binding on later phases:**

- **PRINCIPAL1A must provide the idempotency-key store.** The key is derived and nothing stores or consumes it,
  so until that store exists a duplicate is not stopped.
- **PROJECTOS-TENANT-CREDENTIALS1A needs its own check at the broker.** A crossing is an in-process value and
  cannot reach the broker process, so the door's run link proves nothing on the far side of that boundary.
- **A command with no run mints a `run-start`.** `mintCrossing` needs an admitted run, so a command acting
  outside a run must mint and admit one first.
- **An account-wide spend cap is carried to Stage 4,** with the per-tenant spend limits already there.

## Final round

From the ECC SECURITY recheck at `336feda`, which closed all HIGHs. Decided by the lead:

| Finding | Disposition |
|---|---|
| MEDIUM, `readmitEnvelope` branded disk values it did not re-derive, and they then capped children | Fixed. Takes the kernel's `principal` and `actor` and required `latestExpiry` and `maxBudget`; refuses anything differing or over them, an unreadable limit, and a record already expired |
| MEDIUM, the run link was optional and weak | Fixed. `mintCrossing` requires a branded, unexpired run, derives the single `run:<envelopeId>` scope, caps expiry and budget at the run's, and refuses a different tenant, domain, project or principal. The pinned `RUN_LINKED_ACTIONS` names `credential-release`, `broker-call`, `commit` and `push`, and the door refuses those from anywhere else (`RUN_LINK_REQUIRED`). `checkRunLink` is removed |
| MEDIUM, P3 passed the door ungated | Fixed. P3 asks the grant port, with `P3_NO_GRANT`. Its grant source stays the technical gate, wired by later phases (ADR-T1 §8) |
| LOW, purity pin | Fixed. It catches `import{x}from'node:fs'`, the tight re-export and `performance.now()` |
| LOW, `registered: true` in `readmitEnvelope` | Fixed. A test sends an unregistered action through readmission to the door, and the mutation is killed |
| LOW, stale note in `action-registry.json` | Fixed |

## Review round

Reviews ran at `1a6b44e`. **ECC SECURITY: APPROVE WITH CHANGES. Agency `software-architect`: APPROVE WITH
CHANGES.** The lead verified the HIGHs against the code and decided the design calls. All were fixed:

| Finding | Disposition |
|---|---|
| HIGH envelope provenance: a forged full-shape envelope was admitted | Fixed. Private `WeakMap` brand; the door takes branded envelopes only; `readmitEnvelope(raw, binding, registry)`; `checkChildEnvelope` re-derives class and environment; a parent must be branded; R3 requires `principal` equal |
| HIGH F1, admission did not gate class | Fixed. Grant port; `P6_PROHIBITED`, `UNREGISTERED_ACTION`, `P5_NO_GRANT`. The record line carries `registered` and `via`. No envelope field added |
| HIGH F3, M3, boundary crossings | Fixed. Five actions are roots, refused as children; `checkRunLink`; `broker-call` is `production`. `push` checked against the registry's own definition and fixed to `production`, because it writes to the shared remote, so a push is a root too. The note says `run-start`'s paid calls are separate P3 roots |
| HIGH F4, `credential-release` | Recorded OPEN in ADR-T1 §6, the owner to decide at CREDENTIALS1A. Stays P5. No grant invented |
| HIGH F5, worktree claim | Corrected in ADR-T1 §5.4 |
| HIGH H2, owner check | Stated in ADR-T1 §3. The two remedies this file offered did not work and are removed |
| MEDIUM M1, aliases | Fixed. ASCII, per-segment classes, ASCII-only case folding, schema pinned to the code's regexes |
| MEDIUM M2, worktree listing | Fixed. `WorktreeListing`, checked against the registered root; a foreign or nested root is refused; the root is dropped by path |
| MEDIUM M3, F6, table | Fixed. Whole table pinned (TC-39); floors for the five boundary actions (TC-40); `action-registry-change` P5 with a floor |
| MEDIUM M4, validator | Fixed. TC-T refuses `.skip` and `.only`; TC-14 catches bare and dynamic imports, re-exports and `globalThis['process']` |
| F8 to F11, ADR text | Fixed. Postgres never authority; committed ref named; `projectos` rationale; class comment; dangling §10; domains recorded as the lead's reading |
| LOW, sparse scope, zero budget | Fixed |

**One addition beyond the brief, for the lead to confirm:** the door also refuses P4 by name
(`P4_NO_GRANT`), because ADR-K1 §4 says P4 cannot run. Nothing is registered at P4 today.

## Decisions for the lead to challenge

1. **Linked worktrees (ADR-T1 §5).** A worktree takes its tenant from the listing git gives at the
   registered root, never from its own `.git` file. It gets tenant identity only, and that alone must never
   release a secret.
2. **The owner-last-commit check is not an owner check (ADR-T1 §3).** Every commit here carries the name
   Murad, including `c9cdae2`, which an agent made. PRINCIPAL1A chooses an owner-only signature or an
   owner-gate receipt naming the registry blob sha.
3. **Six extra actions in the registry:** the five boundary actions, which PRINCIPAL1A needs and cannot
   add, and `action-registry-change`. Classes follow ADR-K1 §3.
4. **`action` is a sixteenth envelope field,** and the one addition. ADR-K1 was status-only here, so it is
   recorded in ADR-T1 §8.
5. **`environment` means where the executing capability acts:** `local` on this machine, `production` when
   it reaches something live outside it. An action with no capability yet is `production`.
6. **`mintCrossing` takes `now` as a fourth argument.** "Unexpired" needs a clock and this module has none.
   "Caps" is implemented as a refusal, not a silent clamp, matching R3.
7. **A persisted crossing loses its run link,** so `readmitEnvelope` plus the door refuses it
   (`RUN_LINK_REQUIRED`), and it must be minted again from a live run. Its idempotency key is unchanged.
8. **`commit` as a child still mints, and the door then refuses it.** `commit` is not a boundary action, so R3
   does not refuse it; `RUN_LINK_REQUIRED` does.
9. **Baseline §5 was renumbered,** because three risks are resolved or superseded: engines and toolchain,
   the unregistered validators, and the temporary `seo-agency` allowlist entry (removed at `381acb1`). Risk
   5.1 is still 5.1.

## Carried forward

- **Unbounded expiry on a plain root.** Nothing caps how far ahead a plain root's `expiry` may be. Crossings
  are capped at their run, and a readmission at the caller's limit.
- **`WorktreeListing` is a bare object.** A caller can build one by hand, so PRINCIPAL1A's reader must wrap it.
- **`payment-or-live-charge` at budget 0.** `PAID_ACTIONS` holds `broker-call` only, so this P5 action can mint
  with no budget. Its door still needs a grant, and no capability exists.
- **Unconsumed idempotency keys.** The key is derived, but nothing stores or consumes one, so a duplicate
  is not yet stopped. ADR-K1 §2's "returns the earlier outcome" needs a durable store.
- **`docs/06_Plan.md` is the lead's:** the phase tick, and plan 0.3, which the delta says should be ticked.
  Its log still says ADR-K1 stays Proposed, which was true when written.
- **ADR-T1 is Accepted** on the owner's word, D10 in the delta, 2026-11-01; the domains are confirmed by the same word. TC-4 now pins that wording, and the mutation is `adr-t1-acceptance-drops-owner-word`.
- **Stacking.** `val-projectos-tenant-contract1a` is appended last in both runners, and every parallel phase
  appends there too. The two lists must stay identical (FU-6). The counts in docs 00 and 04 are stated "as
  of this phase", and `validate-all.cjs` is named as the count of record.
- **TC-39 pins the whole action table,** so a phase that adds an action must also update the validator.
- **PRINCIPAL1A must** read the registry from committed bytes, take the worktree listing at the root
  `registeredRootOf` names, wrap `WorktreeListing`, pass a real recorder and grant port to `admitEnvelope`,
  send persisted envelopes through `readmitEnvelope` with real limits and then back through the door, mint
  each crossing with `mintCrossing` from an admitted run, and derive `principal` and `actor`. None of that is
  proved here.
- **BINDING on PRINCIPAL1A:** its reader must canonicalise a checkout with realpath, and reject 8.3 and alias
  forms, before `resolveTenant` (`tenant.ts:402`). `resolveTenant` compares the strings it is handed.
- **Run link and idempotency key are spelling-keyed** (`actionRegistry.ts:130`): `close_phase` and
  `phase-closure` are one action with two keys. TC-39 pins the table, and a registry edit is an owner act.
- **`speed/input-map.cjs:233` omits `trust-boundary.json`** for its validator. This is pre-existing and outside
  these writePaths. The fix is one added path, in a phase that owns the file.
- **CREDENTIALS1A must** decide the P5 grant source for `credential-release`, and what else a release from a
  worktree needs.
