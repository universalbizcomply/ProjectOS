# PROJECTOS-TENANT-CONTRACT1A — tenant contract

**Phase:** PROJECTOS-TENANT-CONTRACT1A, phase 1 of V4 Stage 2, plan v1.28 (activated at `f2d2ec9`), under
`docs/changes/delta_spec.md` revision 2.
**Branch:** `projectos-tenant-contract1a`, worktree `C:/dev/ProjectOS-worktrees/tenant-contract1a`, based
on `f2d2ec9`. Not pushed, not merged, phase not closed, no phase record created.
**State:** implementation complete. **Reviews have not run** (see below). Nothing here touches a live
service, and nothing at run time reads these records yet.

## Delivered

| Commit | Content |
|---|---|
| `c9cdae2` | `tenant-registry.json`, `action-registry.json`, `tenant-registry.schema.json`, both listed in `trust-boundary.json` |
| `522d385` | `core/src/tenant.ts`, `actionRegistry.ts`, `taskEnvelope.ts`, barrel exports, tests |
| `2ca5ddb` | ADR-T1 (Proposed); ADR-K1 status only (Accepted, D3); docs 00, 01, 04 and 05 |
| `a2abbf4` | `val-projectos-tenant-contract1a`, registered in `validate-all` and `cached-runner` |
| `ed26a7e` | Test fixes: two undiscriminating proofs found by the sweep below; malformed-line coverage |

## Acceptance criteria

1. **ADR-T1 states every limit and the owner's hard rule:** met. §10 carries each item of "What Stage 2
   does not prove"; §11 carries the hard rule. Pinned by TC-1 and TC-2.
2. **The registry binds identity to tenant and domain; a duplicate or wildcard refuses the whole file,
   tested:** met. `tenant.test.ts`. A wildcard in a repository or root is refused only by the wildcard
   rule, because those shapes are otherwise legal, and a test asserts exactly that.
3. **The action registry names both vocabularies; the two tenant actions are P5; an unregistered action
   is P5, tested:** met. `action-registry.test.ts`.
4. **R1 and R3, tested:** met. `task-envelope.test.ts`. Each of the 16 fields is removed in turn against a
   literal list, so dropping a field from the code cannot drop it from the proof. Each R3 field changes
   alone, and the unchanged child is the positive control.
5. **Validator pin and named mutations, each killed by its own rule:** met. 186 of 186, 33 rules.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Core typecheck | `npx tsc -p tsconfig.json --noEmit` in `projectos/core` | 0 errors |
| Core and agent build | `npm run -s build` in `projectos/core`, then `projectos/agent` | 0 errors. Agent `tsc` compiled against the new barrel |
| Full core suite | `npx vitest run` in `projectos/core` | 30 files, 1025 tests, all pass |
| New tests | `tenant.test.ts`, `action-registry.test.ts`, `task-envelope.test.ts` | 65, 82 and 97 tests (244) |
| Coverage of the new modules, before `ed26a7e` | vitest with `--coverage` on the three files | Lines 100% `actionRegistry.ts`, 100% `taskEnvelope.ts`, 98.08% `tenant.ts`. Not re-measured after `ed26a7e` |
| This phase's validator | `node projectos/validators/val-projectos-tenant-contract1a.cjs` | PASS, 186 named mutations killed |
| Own-rule count, second harness | Script applying each mutation and reading `check()` output, separate from `selfTest` | 186 of 186 |
| Validators reading a touched file | 51, each in its own process through `run()`, at `a2abbf4` | 51 PASS, 0 FAIL. Includes `validate-no-secrets`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` (FU-6, runners identical), `validate-speed-validation-cache`, `validate-forbidden-actions` |
| Rerun on the final tree, this file included | `validate-no-secrets`, `val-projectos-tenant-contract1a`, `val-projectos-trust-boundary1a`, `val-projectos-kernel-followup1a` | 4 PASS |

**Not run:** full `validate-all` (the lead runs it after stacking). Agent tests. No test or validator here
reads the registries through the kernel, because that reader does not exist yet.

**The 51 ran before `ed26a7e`.** That commit changes tests only, and no validator other than this phase's
reads those test files.

## Do the tests themselves discriminate?

The validator's mutations are text pins, so 186 of 186 says the pins fire, not that a behaviour test
fails. So each of the 111 mutations of a core source file was also applied to the real file, the three test
files run, and the file restored (`git diff` against HEAD confirmed `core/src` identical afterwards).

- **First sweep:** 104 of 111 killed by a behavioural test.
- **Two survivors were real test defects, now fixed:**
  - `idempotency-key-omits-tenant`: the test changed tenant and project together, so the key differed
    with the tenant dropped. Each part now changes alone.
  - `mint-takes-environment-from-the-context`: the smuggling test never carried `environment`.

  Both were rerun after the fix and are killed.
- **Five survivors are correct, and the validator is their only catch:** purity and type-only changes
  alter no behaviour. They are `tenant-reads-environment`, `tenant-imports-the-filesystem`,
  `action-registry-imports-a-module`, `request-type-gains-a-tenant` and
  `governance-vocabulary-outgrows-registry` (a union member, erased at run time, that no role list holds).

The full sweep was not repeated after `ed26a7e`. That commit only adds or tightens tests.

## Mutations, by rule

Every mutation below was killed by the rule it names.

| Rule | Count | Mutations |
|---|---|---|
| TC-1 | 6 | `adr-hides-worker-reach`, `adr-hides-the-real-fixes`, `adr-hides-git-name-limit`, `adr-hides-harness-only-proof`, `adr-hides-unrun-scenarios`, `adr-hides-owner-sees-both` |
| TC-2 | 2 | `adr-softens-hard-rule`, `adr-exit-proof-lifts-hard-rule` |
| TC-3 | 13 | `adr-drops-principal`, `adr-gives-supabase-authority`, `adr-drops-tenant-versus-domain`, `adr-drops-trust-basis`, `adr-worktree-trusts-itself`, `adr-worktree-grants-spend`, `adr-drops-tenant-class`, `adr-drops-platform-class`, `adr-drops-project-class`, `adr-drops-owner-sees-both-ruling`, `adr-drops-service-role`, `adr-drops-stop-work`, `adr-drops-one-user-limit` |
| TC-4 | 1 | `adr-t1-accepts-itself` |
| TC-5 | 3 | `adr-k1-still-proposed`, `adr-k1-names-no-owner-word`, `adr-k1-status-rule-dropped` |
| TC-6 | 5 | `registry-moves-agency-to-owner`, `registry-changes-a-domain`, `registry-moves-a-root`, `registry-repository-not-canonical`, `registry-loses-polygo` |
| TC-7 | 8 | `registry-duplicate-repository`, `registry-duplicate-root`, `registry-duplicate-project`, `registry-wildcard-root`, `registry-wildcard-repository`, `registry-reserved-project-id`, `registry-undeclared-tenant`, `registry-unknown-domain` |
| TC-8 | 5 | `schema-tolerates-extra-project-fields`, `schema-domain-enum-drifts`, `schema-tenant-pattern-drifts`, `schema-allows-reserved-prefix`, `schema-allows-wildcard-root` |
| TC-9 | 3 | `trust-boundary-omits-tenant-registry`, `trust-boundary-omits-action-registry`, `trust-boundary-claims-enforcement` |
| TC-10 | 6 | `registry-loses-a-governance-spelling`, `registry-loses-an-owner-only-spelling`, `registry-splits-phase-closure`, `registry-invents-a-spelling`, `governance-vocabulary-outgrows-registry`, `owner-floor-outgrows-registry` |
| TC-11 | 3 | `cross-tenant-access-lowered`, `tenant-registry-change-lowered`, `cross-tenant-access-unlisted` |
| TC-12 | 4 | `phase-closure-lowered`, `secrets-handling-lowered`, `approve-lowered`, `commit-lowered` |
| TC-13 | 2 | `action-registry-duplicate-spelling`, `action-registry-wildcard` |
| TC-14 | 4 | `tenant-reads-environment`, `tenant-imports-the-filesystem`, `envelope-reads-the-clock`, `action-registry-imports-a-module` |
| TC-15 | 7 | `registry-live-despite-problems`, `registry-skips-project-lines`, `registry-skips-tenant-lines`, `registry-skips-duplicates`, `registry-any-schema-version`, `registry-prose-optional`, `registry-never-marked-live` |
| TC-16 | 4 | `wildcard-matches-nothing`, `project-wildcard-falls-to-shape`, `tenant-wildcard-falls-to-shape`, `wildcard-scan-skips-repository` |
| TC-17 | 5 | `duplicate-project-case-sensitive`, `duplicate-ignores-repository`, `duplicate-ignores-root`, `duplicate-filter-keeps-nothing`, `root-key-case-sensitive` |
| TC-18 | 3 | `reserved-prefix-case-sensitive`, `reserved-prefix-never-matches`, `reserved-check-not-asked` |
| TC-19 | 2 | `unlisted-falls-to-first-project`, `unvalidated-registry-resolves` |
| TC-20 | 4 | `repository-not-compared`, `no-origin-accepted`, `root-compare-always-true`, `route-refusal-removed` |
| TC-21 | 7 | `linked-worktree-any-directory`, `linked-worktree-listing-not-matched`, `porcelain-keeps-main-tree`, `porcelain-keeps-prunable`, `asked-root-is-not-the-registered-one`, `allowlist-now-admits-linked-worktrees`, `allowlist-shape-check-gutted` |
| TC-22 | 4 | `binding-brand-accepts-any-object`, `binding-not-frozen`, `binding-never-branded`, `mint-skips-the-brand` |
| TC-23 | 14 | `envelope-field-dropped`, `budget-field-dropped`, `missing-field-tolerated`, `unparseable-field-tolerated`, `unknown-field-tolerated`, `reasons-do-not-refuse`, `any-envelope-version`, `expiry-any-date-text`, `actor-any-object`, `blank-is-a-value`, `action-any-text`, `action-name-shape-gutted`, `actor-shared-with-the-source`, `expiry-never-expires` |
| TC-24 | 7 | `mint-spreads-the-request`, `mint-takes-tenant-from-the-request`, `mint-takes-class-from-the-request`, `mint-takes-environment-from-the-context`, `request-type-gains-a-tenant`, `mint-skips-the-registry`, `idempotency-key-omits-tenant` |
| TC-25 | 9 | `child-tenant-not-compared`, `child-domain-not-compared`, `child-project-not-compared`, `child-environment-not-compared`, `child-equality-always-holds`, `child-lineage-not-compared`, `child-not-parsed`, `child-reasons-do-not-refuse`, `minted-child-not-checked` |
| TC-26 | 6 | `child-scope-widens`, `child-budget-widens`, `child-expiry-widens`, `child-class-widens`, `class-order-gutted`, `class-order-reversed` |
| TC-27 | 9 | `recorder-falsy-accepted`, `recorder-throw-reads-as-written`, `admission-trusts-the-minted-object`, `unrecorded-admission-proceeds`, `admitted-before-recorded`, `refusal-not-recorded`, `expired-refusal-not-recorded`, `expiry-not-asked-at-admission`, `execution-record-reports-success` |
| TC-28 | 6 | `unregistered-action-is-p1`, `unregistered-action-is-local`, `unregistered-reads-as-registered`, `unvalidated-registry-answers`, `lookup-folds-case`, `registered-class-ignored` |
| TC-29 | 16 | `action-registry-live-despite-problems`, `action-floors-skipped`, `action-duplicates-skipped`, `action-vocabulary-skipped`, `action-entries-skipped`, `action-prose-optional`, `action-wildcard-matches-nothing`, `action-wildcard-not-asked`, `action-duplicate-filter-keeps-nothing`, `absolute-floor-dropped`, `governance-floor-dropped`, `owner-floor-dropped`, `reserved-floor-allows-any-class`, `floor-test-always-passes`, `owner-floor-lowered-in-code`, `reserved-action-unlisted-in-code` |
| TC-30 | 4 | `governance-vocabulary-copied-locally`, `owner-vocabulary-copied-locally`, `vocabulary-check-one-directional`, `reserved-presence-not-checked` |
| TC-31 | 3 | `barrel-omits-tenant`, `barrel-omits-action-registry`, `barrel-omits-envelope` |
| TC-32 | 2 | `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| TC-33 | 9 | `trd-denies-engines-again`, `baseline-denies-engines-again`, `baseline-loses-the-tenant-records`, `baseline-count-of-record-dropped`, `prd-loses-the-tenant-vocabulary`, `prd-loses-the-hard-rule`, `trd-loses-the-tenant-section`, `schema-doc-loses-tenant-registry`, `schema-doc-loses-action-registry` |

## Reviews

Required by the phase: Claude self-review, ECC SECURITY review, Agency `software-architect` review.
**None of the independent reviews has run.** The lead dispatches them. The self-review found and fixed:
`parseEnvelope` shared `actor` with its source; `action` accepted free text that would reach a record; the
parser was laxer than the schema about the prose fields.

## Decisions for the lead to challenge

1. **Linked worktrees (ADR-T1 §5).** A worktree takes its tenant from the listing git gives at the
   registered root, never from its own `.git` file. It gets tenant identity only; the allowlist keeps
   refusing it for spend. Reason: refusing would stop every worktree run, and trusting the worktree would
   repeat F8.
2. **The registry's first commit carries the owner's git name, and an agent made it.** `c9cdae2` was
   committed under the configured identity `Murad`. PRINCIPAL1A's owner-last-commit check would pass it,
   though no person made that commit. ADR-T1 §3 says so. **Fix, owner's act:** one owner commit to
   `tenant-registry.json` before PRINCIPAL1A relies on it, or the lead commits it under the implementer
   identity so the check refuses until he does. Cost: one commit.
3. **Five extra actions in the registry:** `run-start`, `credential-release`, `broker-call`,
   `project-selection`, `bridge-read`. The delta names only the two vocabularies and the two tenant
   actions. PRINCIPAL1A mints envelopes for these boundaries and has no write path to the registry, so
   without them each would read as P5 in production. Classes follow ADR-K1 §3.
4. **`action` is a sixteenth envelope field.** ADR-K1 §2 hashes it without listing it. ADR-K1 was
   status-only here, so the addition is recorded in ADR-T1 §8.
5. **`environment` means where the executing capability acts,** so `broker-call` is `local`. An action with
   no capability yet is `production`. R3's equality would otherwise refuse a broker call inside a local run.
6. **R5 mints rather than refuses.** An unregistered action gets a P5 envelope in `production`, so the
   attempt is recorded at the class it deserves. Nothing yet enforces P5 at run time.
7. **Baseline §5 was renumbered,** because three risks are resolved or superseded: engines and toolchain,
   the unregistered validators, and the temporary `seo-agency` allowlist entry (removed at `381acb1`). Risk
   5.1 is still 5.1.

## Carried forward

- **`docs/06_Plan.md` is the lead's:** the phase tick, and plan 0.3, which the delta says should be ticked.
  Its log still says ADR-K1 stays Proposed, which was true when written.
- **ADR-T1 stays Proposed** until the owner marks it Accepted.
- **Stacking.** `val-projectos-tenant-contract1a` is appended last in both runners, and every parallel phase
  appends there too. The two lists must stay identical (FU-6). The counts in docs 00 and 04 are stated "as
  of this phase", and `validate-all.cjs` is named as the count of record.
- **PRINCIPAL1A must** read the registry from committed bytes, take the worktree listing at the root
  `registeredRootOf` names, pass the real recorder to `admitEnvelope`, and derive `principal` and `actor`.
  None of that is proved here.
