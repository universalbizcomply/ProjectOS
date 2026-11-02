# PROJECTOS-CONNECTOR-CONTRACT1A — connector contract, with no connector

**Phase:** PROJECTOS-CONNECTOR-CONTRACT1A, V4 Stage 2, plan v1.35 (tip `70ffbca8`), owner decision D5, "Rules
now, connectors later (Recommended)".
**Branch:** `projectos-connector-contract1a`, worktree `C:/dev/ProjectOS-worktrees/connector-contract1a`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is the lead's.
**State:** implementation complete. The required reviews (Claude self-review, ECC SECURITY, ECC CODE) have not
run; they are the lead's to dispatch.

## Delivered

| File | Content |
|---|---|
| `projectos/core/src/connectorContract.ts` | The pure contract: registry parser, gate, receipt, retry rule, reconciliation, nine scenarios. No I/O, no clock, no new dependency |
| `projectos/core/src/index.ts` | One barrel line |
| `projectos/connectors/registry.json` | Empty and schema-valid: zero live connectors |
| `projectos/schemas/connector-registry.schema.json` | Draft-07 schema; its patterns are the code's regexes, and the validator runs it |
| `projectos/core/test/connector-contract.test.ts` | 232 behavioural tests |
| `projectos/validators/val-projectos-connector-contract1a.cjs` | 29 rules, 234 named mutations, registered in `validate-all` and `cached-runner` |

## Acceptance criteria

1. **An entry without a tenant, a secret reference or a passing release record is refused, tested:** met.
   `CONNECTOR_TENANT_MISSING`, `CONNECTOR_SECRET_MISSING`, `CONNECTOR_RELEASE_MISSING`,
   `CONNECTOR_RELEASE_NOT_PASSED`. Rules CC-2, CC-3, CC-4.
2. **A connector's action must exist in the action registry; an unregistered one is P5, tested:** met, at
   registration and again at the gate, because the registry can change after acceptance. The refusal states the
   class. CC-11.
3. **The error vocabulary distinguishes the seven codes, and a retry after `outcome_unknown` is refused until
   reconciled, tested:** met. CC-13, CC-14, CC-15.
4. **Validator pin and named mutations, each killed by its own rule:** met. A mutation counts only when the
   exact set of rules that fires equals its declared set, so an earlier check cannot take the credit.

## The rulings this phase states

| Code | Retry rule | Why |
|---|---|---|
| `outcome_unknown` | After an explicit reconciliation, keyed by idempotency key | A write may have happened |
| `rate_limited`, `upstream_unavailable` | After backoff, same key | The provider said nothing happened |
| `authentication_required` | After the kernel says it re-authenticated, same key | Nothing happened, and repeating now cannot work |
| `approval_required` | After the kernel says an approval exists, same key | As above |
| `permission_denied`, `invalid_input` | Never under this key | It cannot succeed. A changed request is a new intent, so a new key |

- `upstream_unavailable` means the provider was known not to have acted. A timeout during a write is
  `outcome_unknown`.
- A reconciliation finding `completed` closes the key for good; `not_completed` opens the next attempt.
- An unanswered unknown refuses ahead of everything, including a later success, because no later line can say
  what that first write did.
- A success is never repeated (`RETRY_ALREADY_COMPLETED`).

## Decisions for the lead to challenge

1. **Staleness is per connector, not whole-file.** One tenant's lapsed date must not stop the other tenant's
   connector, and the blueprint says a failed test blocks "the affected connector". So `parseConnectorRegistry`
   is timeless, and `connectorAcceptanceRefusal` runs at the gate. A stale entry parses and every call is
   refused. CC-8 proves the other tenant keeps working.
2. **90 days for acceptance, 5 attempts per key.** Implementer's readings. The blueprint asks for a
   last-acceptance date and bounded retries and names neither number. Both are named constants.
3. **A release record lists all nine scenarios and all ten checklist items.** That makes the definitions a live
   gate, and it is a claim in a committed file: see "What this does not prove".
4. **A release record also binds the tenant.** The brief named connector and version. Without this, moving a
   connector to another tenant is a one-word diff.
5. **`read-only` is checked:** only P1 actions may sit under it, read from the registry.
6. **`connectorId` is unique across tenants,** so `telegram` for two tenants needs two ids.
7. **Domain is compared too,** under `CONNECTOR_CROSS_TENANT`, because an entry declares one.
8. **`admittedAtTheDoor` asks `recordExecution` with a recorder that writes nothing.** It is the one public
   question that reveals admission. A plain `isAdmittedEnvelope` export would be cleaner, and `taskEnvelope.ts`
   is outside this phase's writePaths.

## Mutations, by rule

Every mutation below fired exactly its declared rules.

| Rule | Says | Count | Mutations |
|---|---|---|---|
| CC-1 | a complete entry registers with what it declared | 6 | `entry-scopes-lost`, `entry-secret-reference-lost`, `entry-data-categories-lost`, `entry-idempotency-lost`, `record-evidence-lost`, `record-checklist-lost` |
| CC-2 | a connector with no declared tenant is refused | 4 | `tenant-missing-not-named`, `tenant-blank-allowed`, `tenant-undeclared-allowed`, `tenant-optional` |
| CC-3 | a connector with no secret reference is refused | 3 | `secret-missing-not-named`, `secret-blank-allowed`, `secret-optional` |
| CC-4 | a connector with no passing release record is refused | 11 | `release-record-optional`, `release-missing-misnamed`, `release-never-judged`, `result-not-asked`, `result-truthy`, `checklist-not-asked`, `scenarios-not-asked`, `evidence-not-asked`, `exactly-allows-extras`, `exactly-allows-gaps`, `checklist-loses-an-item` |
| CC-5 | a raw credential in the reference field is refused, and not repeated | 5 | `credential-shape-not-asked`, `raw-run-not-asked`, `credential-falls-to-shape`, `credential-repeated-in-the-refusal`, `raw-run-weakened` |
| CC-6 | a reference has the store's shape and the connector's own tenant | 5 | `reference-any-environment`, `reference-any-root`, `reference-any-shape`, `reference-any-tenant`, `reference-any-listed-project` |
| CC-7 | a release record binds its connector, version, tenant and date | 4 | `record-any-connector`, `record-any-version`, `record-any-tenant`, `record-any-date` |
| CC-8 | acceptance is judged per connector against time handed in | 7 | `never-stale`, `stale-one-early`, `window-raised`, `future-date-allowed`, `unreadable-now-is-fresh`, `gate-skips-acceptance`, `lapse-refuses-the-whole-file` |
| CC-9 | an unknown field is refused | 5 | `header-unknown-field-tolerated`, `entry-unknown-field-tolerated`, `record-unknown-field-tolerated`, `entry-fields-gain-an-override`, `unknown-field-filter-keeps-nothing` |
| CC-10 | the file is judged whole | 21 | `file-live-despite-problems`, `wildcard-matches-nothing`, `id-wildcard-falls-to-shape`, `tenant-wildcard-falls-to-shape`, `list-wildcard-falls-to-shape`, `duplicate-connector-allowed`, `list-repeats-allowed`, `any-schema-version`, `any-policy`, `prose-optional`, `no-list-reads-as-empty`, `empty-list-is-a-declaration`, `sparse-list-skipped`, `version-any-text`, `domain-any-text`, `id-any-text`, `idempotency-any-text`, `date-any-text`, `scope-any-text`, `category-any-text`, `action-any-text` |
| CC-11 | an unregistered action is P5 and refused | 4 | `unregistered-action-accepted`, `unregistered-action-not-called-p5`, `gate-skips-the-action-registry`, `gate-hides-the-class` |
| CC-12 | read-only is checked against the action registry | 3 | `read-only-not-checked`, `read-only-any-class`, `read-only-applies-to-all` |
| CC-13 | the error vocabulary is closed | 5 | `vocabulary-gains-timeout`, `vocabulary-loses-outcome-unknown`, `unknown-code-mapped`, `code-folds-case`, `code-trims` |
| CC-14 | a retry after outcome_unknown is refused until reconciled | 9 | `unknown-ignored`, `unknown-cleared-by-a-later-failure`, `unknown-cleared-by-a-later-success`, `completed-asked-before-unknown`, `a-fact-clears-the-unknown`, `keyed-by-the-connector`, `every-key-blocks-every-key`, `gate-skips-the-retry-rule`, `gate-reads-a-fresh-history` |
| CC-15 | reconciliation is explicit and leaves evidence | 12 | `reconcile-needs-no-evidence`, `reconcile-with-nothing-open`, `reconcile-any-finding`, `reconcile-finding-unread`, `reconcile-time-unread`, `reconcile-anyone`, `completed-reopens`, `not-completed-closes`, `reconcile-rewrites-the-history`, `reconcile-takes-the-callers-tenant`, `reconcile-drops-the-evidence`, `evidence-may-hold-a-credential` |
| CC-16 | every other code has its stated retry rule | 19 | `rate-limited-never`, `upstream-never`, `denied-retried`, `invalid-retried`, `auth-retried-blind`, `approval-retried-blind`, `unknown-rule-misstated`, `never-means-maybe`, `reauthentication-ignored`, `approval-ignored`, `reauthentication-truthy`, `approval-truthy`, `success-repeated`, `attempts-unbounded`, `attempts-one-late`, `attempts-one-early`, `bound-raised`, `attempt-not-counted`, `gate-drops-the-attempt` |
| CC-17 | history that cannot be trusted fails closed | 9 | `bad-line-skipped`, `no-history-reads-as-empty`, `tenant-crossing-tolerated`, `action-crossing-tolerated`, `reconciliation-with-nothing-open-tolerated`, `reconciliation-line-needs-no-evidence`, `reconciliation-line-any-field`, `key-shape-not-asked`, `broken-history-judged-anyway` |
| CC-18 | a receipt has the standard fields and no room for content | 13 | `receipt-unknown-field-tolerated`, `receipt-field-optional`, `receipt-field-unjudged`, `receipt-credential-not-scanned`, `receipt-credential-repeated`, `receipt-unknown-code-not-named`, `receipt-unknown-code-tolerated`, `receipt-outcome-unchecked`, `success-may-carry-a-code`, `unknown-may-carry-any-code`, `failure-may-claim-unknown`, `failure-needs-no-code`, `receipt-gains-a-payload` |
| CC-19 | a receipt must match its admitted call | 8 | `receipt-tenant-not-compared`, `receipt-tenant-misnamed`, `receipt-connector-not-compared`, `receipt-action-not-compared`, `receipt-key-not-compared`, `receipt-mismatch-ignored`, `receipt-takes-any-call`, `call-never-branded` |
| CC-20 | nine scenarios are defined, one proved, none counted as passed | 11 | `scenario-dropped`, `scenario-renamed`, `scenario-given-blank`, `a-defined-scenario-counted-as-proved`, `a-defined-scenario-runs-in-stage-2`, `a-defined-scenario-claims-a-proof`, `cross-tenant-only-defined`, `cross-tenant-names-no-proof`, `tally-counts-defined-as-proved`, `tally-gains-a-passed-count`, `scenario-table-editable` |
| CC-21 | cross-tenant denial holds at the gate | 6 | `tenant-not-compared`, `domain-not-compared`, `cross-tenant-never`, `cross-tenant-misnamed`, `owner-passes-the-tenant-check`, `cross-tenant-action-opens-the-door` |
| CC-22 | the gate takes only what was admitted | 8 | `gate-takes-any-registry`, `registry-never-branded`, `gate-takes-any-envelope`, `door-probe-always-yes`, `door-probe-always-no`, `gate-skips-expiry`, `undeclared-action-allowed`, `unlisted-connector-falls-to-the-first` |
| CC-23 | no input is mutated, and what comes back is frozen | 12 | `registry-not-frozen`, `connector-list-not-frozen`, `entry-not-frozen`, `record-not-frozen`, `list-not-frozen`, `list-shared-with-the-input`, `receipt-not-frozen`, `reconciliation-not-frozen`, `new-history-not-frozen`, `call-not-frozen`, `retry-table-editable`, `history-mutated-in-place` |
| CC-24 | the contract stays pure | 9 | `contract-reads-the-clock`, `contract-news-a-date`, `contract-reads-the-environment`, `contract-imports-the-filesystem`, `contract-gains-a-dependency`, `contract-calls-the-network`, `contract-imports-dynamically`, `contract-holds-a-mangled-escape`, `contract-falls-back-to-the-clock` |
| CC-25 | zero live connectors | 2 | `registry-gains-a-qualified-connector`, `registry-gains-an-unqualified-connector` |
| CC-26 | the schema agrees with the code | 21 | `schema-pattern-drifts-id`, `schema-pattern-drifts-reference`, `schema-tenant-drifts`, `schema-action-drifts`, `schema-evidence-drifts`, `schema-raw-run-dropped`, `schema-tolerates-extra-registry-fields`, `schema-tolerates-extra-entry-fields`, `schema-tolerates-extra-record-fields`, `schema-tenant-optional`, `schema-reference-optional`, `schema-release-optional`, `schema-result-any`, `schema-domain-drifts`, `schema-idempotency-gains-none`, `schema-checklist-drifts`, `schema-scenario-drifts`, `schema-keyword-not-understood`, `reference-format-drifts`, `reference-environment-drifts`, `idempotency-shape-drifts` |
| CC-27 | the contract is exported and this validator registered | 3 | `barrel-omits-the-contract`, `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| CC-28 | the proofs exist and run | 6 | `a-proof-skipped`, `a-proof-isolated`, `a-table-skipped`, `a-suite-skipped`, `a-proof-commented-out`, `a-proof-deleted` |
| CC-29 | the committed registry passes the real reader | 3 | `registry-loses-its-policy`, `registry-loses-its-authority`, `registry-any-schema-version` |

## Corrections to the brief

- **The nine scenarios are not in `docs/`.** The delta cites "§10" and memory lists six. The list came from the
  owner's own blueprint, §10 "Required acceptance scenarios",
  `ProjectOS_Agent_Capabilities_and_Connector_Blueprint.docx`, read as data, in memory, not extracted: cross-tenant
  access denial, duplicate webhook delivery, expired approval, token revocation, prompt injection in retrieved
  content, process crash after a write, cancellation, missing evidence, provider outage. The ten checklist items
  are its §13 "Connector release checklist".

## Found while building

- **A credential fitted the receipt's name shapes.** `sk-ant-…` is lowercase and hyphenated, so it passed as
  `tenant`, `connector` and `action`. A test caught it. Receipts now scan those values, and refusals do not repeat
  them.
- **The cross-tenant proof did not rest on its own rule.** Mutation `tenant-not-compared` survived: every fixture
  pair also differed in domain, so the domain check answered for the tenant check. A same-domain, different-tenant
  pair was added to the test and the probe. The mutation is now killed.
- **`x.repeat(30)` hid the prefix rule behind the long-run rule.** Fixtures now hold each apart.
- **My comment claimed the platform key was refused by the tenant rule.** It is not: `OPENAI_GATEKEEPER_KEY` is
  refused by the shape rule, and no rule knows a platform class. Comment and test corrected.
- **Two equivalent mutants removed by simplifying the code:** a redundant `isTenantId` and a redundant `acceptedAt`
  read. A third, `receipt-parse-skipped`, was dropped because it changes nothing observable.

## Do the tests themselves discriminate?

The validator's mutations prove the validator fires. So each of the 199 mutations of `connectorContract.ts` was
also applied to the real file, `connector-contract.test.ts` run, and the bytes restored and hash-checked.

- **First sweep: 188 of 199 killed by a behavioural test.**
- **9 survivors were real gaps in the test file,** though the validator caught each:
  `record-evidence-lost`, `record-checklist-lost`, `scope-any-text`, `reauthentication-truthy`, `bound-raised`,
  `reconciliation-line-any-field`, `reconciliation-not-frozen`, `new-history-not-frozen`, `retry-table-editable`.
  Tests were added and those 9 rerun: all 9 killed.
- **So 197 of 199.** The other 2, `contract-imports-the-filesystem` and `contract-imports-dynamically`, alter no
  behaviour. Purity is the validator's to catch, and CC-24 does.
- **A note on the first sweep's log.** The scratchpad is shared across the session, and another run truncated the log
  partway. It changed nothing here: its control failed and it exited without writing. The count above is the sweep
  process's own final result, and the contract file's hash was the same before and after.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Core typecheck | `npx tsc -p tsconfig.json --noEmit` in `projectos/core` | 0 errors |
| Full core suite | `npx vitest run` in `projectos/core` | 59 files, 2807 tests, all pass |
| New tests | `test/connector-contract.test.ts` | 232 tests, all pass |
| Fail-before, no module | The same file before any source existed | The file fails to load. That shows only a missing file, so the next row is the real one |
| Fail-before, behaviour | The same file, then 215 tests, against a throwaway stub of the same API that accepts everything | 195 failed, 20 passed. The 20 are controls a permissive stub satisfies |
| This phase's validator | `node projectos/validators/val-projectos-connector-contract1a.cjs` | PASS, 29 rules, 234 named mutations, each firing exactly its declared rules. 32 declare a second rule that is also true of the same change |
| No secrets | `validate-no-secrets` | PASS |
| Readers of a touched file | 77 validators, each in its own process through `run()`: every one that names a touched file or `projectos/schemas`, or scans a directory, plus `validate-no-secrets` | 75 PASS, 2 FAIL, neither from this phase (below) |
| Rerun after the last test edit | This validator, `validate-no-secrets`, `val-projectos-kernel-followup1a` (FU-6, runners identical), `validate-speed-validation-cache` | 4 PASS |
| Ignored files | `git check-ignore` on all six new files, and `git ls-files` after the commit | None ignored |

**The two failures, neither from this phase:**

- `val-cd-b4-sealed-expected-window-facts1a`: "V2 public getter for a sealed binding digest in ipc_session.rs". It
  reads `projectos/host` only, and this branch has no diff there. It is registered in `validate-all`, so the lead
  will see it. **A baseline run on `70ffbca8` was not done:** the conclusion rests on the inputs being unchanged.
- `validate-desktop-e2e`: "no production bundle at projectos/control-center/dist/assets". This worktree has no
  Control Center build.

**Not run:** full `validate-all` (the lead runs it after stacking). Agent tests and agent build: the agent's
`node_modules` junction resolves `@projectos/core` through the plan worktree, so a build there would not see this
branch. No live service, network or credential was used.

## What is proved

- Cross-tenant denial, on the real committed registries, real `resolveTenant` bindings and the real door: both
  directions, the owner's own work, two tenants in one domain, another domain of one tenant, and the
  `cross-tenant-access` action. The same-tenant pair is admitted, which is what lets the proof fail.
- The registry, release-gate, receipt, vocabulary and retry rules of the pure contract, each with a positive
  control, and each mutation killed by its own rule.
- The committed registry is empty, passes the real reader, and passes the schema, run by an evaluator that refuses
  any keyword it does not understand.

## What is only defined

**Eight of the nine scenarios.** Each is `status: 'defined'`, `firstRun: 'stage-5'`, `proof: null`, and none is
counted as passed. `scenarioTally()` answers `{ total: 9, proved: 1, defined: 8 }` and has no passed count. They
need a real connector: duplicate webhook delivery, expired approval, token revocation, prompt injection in
retrieved content, process crash after a write, cancellation, missing evidence, provider outage.

## What this does not prove

- **No connector exists,** and nothing reads this registry at run time. The contract enforces nothing until a
  kernel path calls it.
- **A release record is a claim.** The gate binds it to connector, version, tenant and date, and cannot tell
  whether a listed scenario really ran. Stage 5 must tie each to run evidence. Zero live connectors is what holds
  today: CC-25.
- **History is handed in.** An empty history reads as a first attempt, so the retry rule is only as good as the
  store behind it. No durable store exists yet.
- **A key follows the intent the kernel states.** A new `intentScope` is a new key, so a caller that changes it
  escapes the unknown. Only the call sites can prove they do not.
- **`reauthenticated` and `approved` are the kernel's word.** Nothing here can check them.
- **Backoff is not timed here,** and a receipt has no timestamp.
- **The credential check is a backstop.** A short credential of no known shape, fitted into a reference, passes.
  The store holding the value is the real control.
- **A tampered history file is not detected.** A well-formed reconciliation line written by hand is honoured.
- **The gate's refusals are not recorded by it.** R4's execution line is the caller's, through `recordExecution`.
- **The tenant registry handed to `parseConnectorRegistry` is not provenance-checked.** `tenant.ts` exposes no
  such question. An envelope's tenant still comes from a real binding, so a forged list cannot pass the gate.
- **ADR-T1 §10 and §11 still bind.** This is not a boundary against a hostile worker.

## Carried forward

- **Stage 5 must register connector actions before the first connector,** and TC-39 pins the action table, so that
  phase updates `val-projectos-tenant-contract1a` too.
- **Stage 5 must add `connector-registry-change` as a P5 action** and list the registry in `trust-boundary.json`,
  as ADR-T1 §3 does for the other two records. Both files are outside these writePaths, and the exclusions forbid
  changing an existing authority record here.
- **Stage 5 must lift CC-25 deliberately,** by a phase that says so. The first connector will fail it by design.
- **The idempotency store** bound on PRINCIPAL1A, and the task ledger in Stage 4, are what make the history real.
- **`taskEnvelope.ts` could export `isAdmittedEnvelope`,** replacing the `recordExecution` probe.
- **If CREDENTIALS1A gives platform credentials a five-segment form,** this contract needs a rule refusing it. Today
  the shape rule does the work.
- **CC-26 rebuilds the reference shape from `credentials/reference.cjs`,** which CREDENTIALS1A changes. If that
  phase changes `SEGMENT_RE` or `ENVIRONMENTS`, CC-26 fires on stacking, by design.
- **Stacking.** `val-projectos-connector-contract1a` is appended last in both runners. Parallel phases append there
  too, and the two lists must stay identical (FU-6).
