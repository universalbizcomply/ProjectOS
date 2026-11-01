# PROJECTOS-TENANT-CONTRACT1A — tenant contract

**Phase:** PROJECTOS-TENANT-CONTRACT1A, phase 1 of V4 Stage 2, plan v1.28 (activated at `f2d2ec9`), under
`docs/changes/delta_spec.md` revision 2.
**Branch:** `projectos-tenant-contract1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-contract1a`, based
on `f2d2ec9`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete, one review round answered. The fixes have not been re-reviewed. Nothing
here touches a live service, and nothing at run time reads these records yet.

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
5. **Validator pin and named mutations, each killed by its own rule:** met. 285 of 285, 41 rules.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Core typecheck | `npx tsc -p tsconfig.json --noEmit` in `projectos/core` | 0 errors |
| Core and agent build | `npm run -s build` in `projectos/core`, then `projectos/agent` | 0 errors. Agent `tsc` compiled against the new barrel |
| Full core suite | `npx vitest run` in `projectos/core` | 31 files, 1133 tests, all pass |
| New tests | `tenant`, `action-registry`, `task-envelope`, `tenant-contract-review` | 65, 85, 98 and 104 tests (352) |
| Fail-before evidence | `tenant-contract-review.test.ts` run at `1a6b44e`, before any fix | 88 failed, 15 passed. The 15 are positive controls and invariants. Some of the 88 fail because the new API did not yet exist; the forged envelope, the class gate, R3 principal, alias, floor and environment tests fail on behaviour |
| This phase's validator | `node projectos/validators/val-projectos-tenant-contract1a.cjs` | PASS, 285 named mutations killed |
| Own-rule count, second harness | Script applying each mutation and reading `check()` output, separate from `selfTest` | 285 of 285, 41 rules |
| Validators reading a touched file | 51, each in its own process through `run()`, at `aa884ee` | 51 PASS, 0 FAIL. Includes `validate-no-secrets`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` (FU-6, runners identical), `validate-speed-validation-cache`, `validate-forbidden-actions` |
| Rerun on the final tree, this file included | `validate-no-secrets`, `val-projectos-tenant-contract1a`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` | 4 PASS |

**Not run:** full `validate-all` (the lead runs it after stacking). Agent tests. No test or validator here
reads the registries through the kernel, because that reader does not exist yet.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so 285 of 285 says the pins fire, not that a behaviour test fails.
So each mutation of a core source file was also applied to the real file, the four test files
run, and the file restored. Clean `git status` confirmed the restore.

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
- **So of the 179 core-source mutations left, 168 are killed by a behavioural test and 11 by the validator
  alone.** The full sweep was not repeated after `aa884ee`, which only adds a test and removes one mutation.
- **The first round of this sweep,** at `a2abbf4`, found two undiscriminating proofs, fixed in `ed26a7e`.

## Mutations, by rule

Every mutation below was killed by the rule it names.

| Rule | Count | Mutations |
|---|---|---|
| TC-1 | 6 | `adr-hides-worker-reach`, `adr-hides-the-real-fixes`, `adr-hides-git-name-limit`, `adr-hides-harness-only-proof`, `adr-hides-unrun-scenarios`, `adr-hides-owner-sees-both` |
| TC-2 | 2 | `adr-softens-hard-rule`, `adr-exit-proof-lifts-hard-rule` |
| TC-3 | 29 | `adr-drops-principal`, `adr-gives-supabase-authority`, `adr-drops-tenant-versus-domain`, `adr-drops-trust-basis`, `adr-drops-self-hosted-rationale`, `adr-hides-that-all-commits-are-murad`, `adr-overclaims-the-owner-check`, `adr-unbacks-same-terms`, `adr-claims-domains-were-decided`, `adr-drops-principal-from-r3`, `adr-any-listing-attaches`, `adr-claims-allowlist-guards-release`, `adr-worktree-may-release`, `adr-closes-the-release-grant`, `adr-hides-no-owner-step`, `adr-drops-postgres-rule`, `adr-postgres-wins`, `adr-drops-roots-ruling`, `adr-drops-run-link`, `adr-keeps-broker-call-local`, `adr-worktree-trusts-itself`, `adr-worktree-grants-spend`, `adr-drops-tenant-class`, `adr-drops-platform-class`, `adr-drops-project-class`, `adr-drops-owner-sees-both-ruling`, `adr-drops-service-role`, `adr-drops-stop-work`, `adr-drops-one-user-limit` |
| TC-4 | 1 | `adr-t1-accepts-itself` |
| TC-5 | 3 | `adr-k1-still-proposed`, `adr-k1-names-no-owner-word`, `adr-k1-status-rule-dropped` |
| TC-6 | 5 | `registry-moves-agency-to-owner`, `registry-changes-a-domain`, `registry-moves-a-root`, `registry-repository-not-canonical`, `registry-loses-polygo` |
| TC-7 | 9 | `registry-duplicate-repository`, `registry-duplicate-root`, `registry-duplicate-project`, `registry-wildcard-root`, `registry-wildcard-repository`, `registry-reserved-project-id`, `registry-undeclared-tenant`, `registry-unknown-domain`, `registry-nested-root` |
| TC-8 | 9 | `schema-tolerates-extra-project-fields`, `schema-domain-enum-drifts`, `schema-tenant-pattern-drifts`, `schema-allows-reserved-prefix`, `schema-root-pattern-drifts`, `schema-root-alias-dropped`, `schema-repository-pattern-drifts`, `schema-allows-dot-git`, `code-root-rule-drifts-from-schema` |
| TC-9 | 3 | `trust-boundary-omits-tenant-registry`, `trust-boundary-omits-action-registry`, `trust-boundary-claims-enforcement` |
| TC-10 | 6 | `registry-loses-a-governance-spelling`, `registry-loses-an-owner-only-spelling`, `registry-splits-phase-closure`, `registry-invents-a-spelling`, `governance-vocabulary-outgrows-registry`, `owner-floor-outgrows-registry` |
| TC-11 | 4 | `cross-tenant-access-lowered`, `tenant-registry-change-lowered`, `cross-tenant-access-unlisted`, `action-registry-change-lowered` |
| TC-12 | 4 | `phase-closure-lowered`, `secrets-handling-lowered`, `approve-lowered`, `commit-lowered` |
| TC-13 | 2 | `action-registry-duplicate-spelling`, `action-registry-wildcard` |
| TC-14 | 8 | `tenant-reads-environment`, `tenant-imports-the-filesystem`, `envelope-reads-the-clock`, `action-registry-imports-a-module`, `tenant-bare-import`, `tenant-dynamic-import`, `tenant-reexport-from-a-module`, `tenant-reaches-process-by-bracket` |
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
| TC-27 | 9 | `recorder-falsy-accepted`, `recorder-throw-reads-as-written`, `minted-refusal-not-carried-to-the-door`, `unrecorded-admission-proceeds`, `admitted-before-recorded`, `refusal-not-recorded`, `expiry-not-asked-at-admission`, `class-asked-after-the-line-is-written`, `execution-record-reports-success` |
| TC-28 | 6 | `unregistered-action-is-p1`, `unregistered-action-is-local`, `unregistered-reads-as-registered`, `unvalidated-registry-answers`, `lookup-folds-case`, `registered-class-ignored` |
| TC-29 | 16 | `action-registry-live-despite-problems`, `action-floors-skipped`, `action-duplicates-skipped`, `action-vocabulary-skipped`, `action-entries-skipped`, `action-prose-optional`, `action-wildcard-matches-nothing`, `action-wildcard-not-asked`, `action-duplicate-filter-keeps-nothing`, `absolute-floor-dropped`, `governance-floor-dropped`, `owner-floor-dropped`, `reserved-floor-allows-any-class`, `floor-test-always-passes`, `owner-floor-lowered-in-code`, `reserved-action-unlisted-in-code` |
| TC-30 | 4 | `governance-vocabulary-copied-locally`, `owner-vocabulary-copied-locally`, `vocabulary-check-one-directional`, `reserved-presence-not-checked` |
| TC-31 | 3 | `barrel-omits-tenant`, `barrel-omits-action-registry`, `barrel-omits-envelope` |
| TC-32 | 2 | `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| TC-33 | 9 | `trd-denies-engines-again`, `baseline-denies-engines-again`, `baseline-loses-the-tenant-records`, `baseline-count-of-record-dropped`, `prd-loses-the-tenant-vocabulary`, `prd-loses-the-hard-rule`, `trd-loses-the-tenant-section`, `schema-doc-loses-tenant-registry`, `schema-doc-loses-action-registry` |
| TC-34 | 17 | `door-takes-unbranded`, `brand-never-set`, `mint-does-not-brand`, `parse-brands-its-output`, `forged-parent-accepted`, `readmit-takes-a-copied-binding`, `readmit-trusts-its-tenant`, `readmit-trusts-its-domain`, `readmit-trusts-its-project`, `readmit-trusts-its-environment`, `readmit-trusts-its-class`, `readmit-compare-always-holds`, `readmit-reasons-do-not-refuse`, `readmit-derives-from-the-record`, `child-class-not-rederived`, `child-environment-not-rederived`, `child-derives-from-itself` |
| TC-35 | 13 | `p6-reaches-the-port`, `port-asked-before-p6`, `unregistered-reaches-the-port`, `p4-reaches-the-door`, `p5-needs-no-grant`, `grant-truthy-accepted`, `grant-throw-reads-as-granted`, `class-refusal-ignored`, `allowed-line-omits-provenance`, `refusal-line-omits-provenance`, `execution-line-omits-provenance`, `envelope-gains-a-registered-field`, `envelope-gains-a-via-field` |
| TC-36 | 12 | `crossing-may-be-a-child`, `boundary-test-always-false`, `run-link-omits-tenant`, `run-link-omits-domain`, `run-link-omits-project`, `run-link-omits-principal`, `run-link-scope-unchecked`, `run-link-accepts-a-child`, `run-link-to-anything`, `run-link-reasons-dropped`, `run-link-crossing-not-parsed`, `run-link-scope-any-text` |
| TC-37 | 7 | `root-admits-any-text`, `root-alias-not-asked`, `repository-admits-any-segments`, `repository-admits-any-port`, `repository-keeps-git-suffix`, `ascii-lower-folds-unicode`, `repository-compare-folds-unicode` |
| TC-38 | 5 | `listing-from-anywhere-attaches`, `checkout-under-foreign-root-allowed`, `at-or-under-drops-the-slash`, `nested-roots-not-judged`, `listing-loses-its-root` |
| TC-39 | 5 | `table-broker-call-back-to-local`, `table-push-back-to-local`, `table-run-start-raised`, `table-bridge-read-raised`, `table-gains-an-action` |
| TC-40 | 4 | `boundary-floors-not-applied`, `credential-release-floor-lowered-in-code`, `broker-call-floor-lowered-in-code`, `run-start-floor-lowered-in-code` |
| TC-T | 5 | `a-proof-skipped`, `a-proof-isolated`, `a-table-skipped`, `a-suite-skipped`, `a-proof-deleted` |

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
6. **P3 passes the door.** Its grants are decided on the paths that own them, and the port is P5 only.
7. **Baseline §5 was renumbered,** because three risks are resolved or superseded: engines and toolchain,
   the unregistered validators, and the temporary `seo-agency` allowlist entry (removed at `381acb1`). Risk
   5.1 is still 5.1.

## Carried forward

- **Unbounded expiry.** Nothing caps how far ahead `expiry` may be, so a long-lived envelope is expressible.
- **Unconsumed idempotency keys.** The key is derived, but nothing stores or consumes one, so a duplicate
  is not yet stopped. ADR-K1 §2's "returns the earlier outcome" needs a durable store.
- **`docs/06_Plan.md` is the lead's:** the phase tick, and plan 0.3, which the delta says should be ticked.
  Its log still says ADR-K1 stays Proposed, which was true when written.
- **ADR-T1 stays Proposed** until the owner marks it Accepted.
- **Stacking.** `val-projectos-tenant-contract1a` is appended last in both runners, and every parallel phase
  appends there too. The two lists must stay identical (FU-6). The counts in docs 00 and 04 are stated "as
  of this phase", and `validate-all.cjs` is named as the count of record.
- **TC-39 pins the whole action table,** so a phase that adds an action must also update the validator.
- **PRINCIPAL1A must** read the registry from committed bytes, take the worktree listing at the root
  `registeredRootOf` names, pass a real recorder and grant port to `admitEnvelope`, send persisted envelopes
  through `readmitEnvelope`, call `checkRunLink` at each crossing, and derive `principal` and `actor`. None of
  that is proved here.
- **CREDENTIALS1A must** decide the P5 grant source for `credential-release`, and what else a release from a
  worktree needs.
