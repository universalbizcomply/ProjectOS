# PROJECTOS-CONNECTOR-CONTRACT1A — connector contract, with no connector

**Phase:** PROJECTOS-CONNECTOR-CONTRACT1A, V4 Stage 2, plan v1.35 (tip `70ffbca8`), owner decision D5, "Rules
now, connectors later (Recommended)".
**Branch:** `projectos-connector-contract1a`, worktree `C:/dev/ProjectOS-worktrees/connector-contract1a`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is the lead's.
**State:** implementation complete. Reviewed at `33763d70`, rechecked at `bc740e99`, and this last round answers the
recheck. No further review: the lead reads this diff.

## Delivered

| File | Content |
|---|---|
| `projectos/core/src/connectorContract.ts` | The pure contract: registry parser, gate, receipt, retry rule, reconciliation, nine scenarios. No I/O, no clock, no new dependency |
| `projectos/core/src/index.ts` | One barrel line |
| `projectos/connectors/registry.json` | Empty and schema-valid: zero live connectors |
| `projectos/schemas/connector-registry.schema.json` | Draft-07 schema; its patterns are the code's regexes, and the validator runs it |
| `projectos/core/test/connector-contract.test.ts` | 306 behavioural tests |
| `projectos/validators/val-projectos-connector-contract1a.cjs` | 38 rules, 293 named mutations, registered in `validate-all` and `cached-runner` |

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

## Required review status

- **ECC SECURITY, at `33763d70`:** APPROVE WITH CHANGES, no CRITICAL. 2 HIGH, 4 MEDIUM, 4 LOW.
- **ECC CODE, at `33763d70`:** APPROVE WITH CHANGES, no CRITICAL.
- **ECC SECURITY recheck, at `bc740e99`:** APPROVE WITH CHANGES. Both HIGHs fixed, no new forgery. 1 MEDIUM and 2 further items, below.
- **The lead reads the last round's diff; it had no further review.** All three reports are as relayed by the lead; this file does not hold them.

| Finding | Disposition |
|---|---|
| SECURITY HIGH 1, reconciliation unbound and unauthorised | Fixed. A record names its `attempt`, and its connector must match that attempt's start. A copy, or one for another connector, answers nothing, and a replay does not stop the real answer. `reconcileConnectorOutcome` takes an admitted, unexpired envelope for `CONNECTOR_RECONCILE_ACTION` of the same tenant. `reconciledBy` and `reconcilerEnvelope` come from it, and `reconciledAt` is the `now` handed in. CC-31 |
| SECURITY HIGH 2, admission and refused receipts left no record | Fixed. Admission returns `started`. A start with no valid receipt counts as `outcome_unknown`, so a refused receipt, a crash after the write and a second admit that sees the start are all stopped. A receipt with no start fails closed. CC-30 |
| SECURITY MEDIUM 3, stops read only the last entry | Fixed. Every failure in the history is read, so `[permission_denied, rate_limited]` does not admit. CC-32 |
| SECURITY MEDIUM 4, registration took what the door would refuse | Fixed, by asking the real door. See decision 1. CC-33 |
| SECURITY MEDIUM 5, reference gaps | Fixed. The last segment refuses a long run split by single separators, which covers a UUID. A project-class reference must match the connector's tenant and domain. CC-5, CC-6 |
| SECURITY MEDIUM 6, no provider receipt | Fixed. `providerReceipt` is a `provider:` pointer, and `succeeded` without one is refused, so `missing-evidence` is enforceable. CC-34 |
| SECURITY LOW, normalise first | Fixed. `plainCopy` runs first, everything is judged on it, and only it comes back. A getter gets one read, and one that throws is malformed input. CC-36 |
| SECURITY LOW, class at the gate | Fixed. A read-only connector whose action moved from P1 to P3 is refused. CC-12 |
| SECURITY LOW, long run in evidence | Fixed. CC-4, CC-15 |
| SECURITY LOW, duplicates | Fixed. `RETRY_ALREADY_COMPLETED` carries `earlier`, from `decideConnectorRetry` and the gate, per ADR-K1 §2. CC-35 |
| CODE, `instantOf` copy | **Not done as instructed.** The import was made, and it fails a registered validator: AP-29 in `val-projectos-port-approvals1a` names `approvals/instant` in `WIRED_NAMES` (line 109), and that file is outside this phase's grant. The check stays private, inside `readInstant`, as `taskEnvelope.ts` already does. See "Carried to the Stage 5 first-connector phase" |
| CODE, repeated values | Fixed. Those refusals name a position. CC-37 |
| CODE, schema and code disagree | Fixed. Dates past four year digits are refused by the code, and whitespace prose and credential-shaped evidence and last segments by the schema. CC-26 runs each through both |
| CODE, weak tests | Fixed. The near-miss test now asserts the exact code. The key test tested `taskEnvelope`, so it was replaced by a real rule here: a history line of another tenant under this key fails closed at the gate. The tally test now asserts which scenarios carry a proof |
| CODE, unused exports | `SCENARIO_STATUSES` removed. `CONNECTOR_OUTCOMES` had one internal consumer, so it is now a private list. `CONNECTOR_IDEMPOTENCY` kept |
| CODE, size | 800 lines, by trimming only. Not split |

**The recheck:**

| Finding | Disposition |
|---|---|
| MEDIUM, `connectorContract.ts:712,716`: registered as P2, an implementer-principal envelope reconciles itself | Fixed. The registered action must be P3 or higher, as a floor in code (`RECONCILE_CLASS_TOO_LOW`). The envelope's own class must also equal the registry's, so one minted under a lower registry cannot present a higher one. CC-31 |
| `:359`: a forged tenant registry refused as a door refusal | Fixed. `parseConnectorRegistry` asks first, and refuses the whole file as `CONNECTOR_TENANT_REGISTRY_INVALID`, "the tenant registry did not pass whole-file validation", with an empty `connectors` list too. CC-38 |
| `:126`: `aaaaaaaaaaaa--bbbbbbbbbbbb--cccccccccccc` passed as a last segment, and a UUID as a provider | Fixed. The split rule takes any run of separators and reads the provider and credential segments, because the provider is not a closed name. CC-5, CC-26 |

## Reconciliation fails closed today

`CONNECTOR_RECONCILE_ACTION` is `connector-reconcile`. `action-registry.json` is outside this phase, so nothing registers it, and `reconcileConnectorOutcome` refuses every call as `RECONCILE_ACTION_UNREGISTERED` until the first connector phase does, at P3 or higher. Below that it refuses as `RECONCILE_CLASS_TOO_LOW`. The tests inject a registry that has it at P3. So, on the committed records, **an `outcome_unknown` cannot be cleared by anyone today.** That is safe with zero live connectors.

## Decisions for the lead to challenge

1. **Registration asks the real door, and that leaves P1 and P2.** `classRefusal` is private and `taskEnvelope.ts` is outside this phase's writePaths. So `doorRefusal` mints a throwaway envelope and calls `admitEnvelope` with a grant port that says no, which gives the door's own rule and no second list. A connector has no grant source yet, so P3 and P5 are refused along with P4, P6 and every run-linked action. **Consequence: no sending connector can register until a phase gives connectors a grant source.** ADR-K1 makes an external send P5, so the first sending connector needs that decision.
2. **Staleness is per connector, not whole-file.** One tenant's lapsed date must not stop the other tenant's connector, and the blueprint says a failed test blocks "the affected connector". A stale entry parses and every call is refused. CC-8 proves the other tenant keeps working.
3. **A release record lists all nine scenarios and all ten checklist items.** That ties the definitions to the gate. It is a claim in a committed file: see "What this does not prove".
4. **A release record also binds the tenant.** The brief named connector and version. Without this, moving a connector to another tenant is a one-word diff.
5. **`read-only` is checked:** only P1 actions may sit under it, at registration and again at the gate.
6. **`connectorId` is unique across tenants,** so `telegram` for two tenants needs two ids.
7. **Domain is compared too,** under `CONNECTOR_CROSS_TENANT`, because an entry declares one.
8. **`admittedAtTheDoor` asks `recordExecution` with a recorder that writes nothing.** It is the one public question that reveals admission. A plain `isAdmittedEnvelope` export would be cleaner.
9. **A reconciliation answers the oldest open attempt.** The caller does not name one, so it cannot aim at another.

## Lead decisions, carried

| Decision | Owner | Stage |
|---|---|---|
| 90 days and 5 attempts are ceilings, not targets. A connector may be held to less | Lead, when a connector phase sets its own | Stage 5 |
| `acceptedAt` is self-attested until acceptance sits behind a committed release record | First connector phase | Stage 5 |
| No backoff floor. A rate-limited key may retry as soon as a caller asks, up to the attempt ceiling | Provider broker phase | Stage 4 |
| A new intent scope starts a new count, for attempts and for the unknown stop | Whoever wires `intentScope`, at the call sites | Stage 4 |
| `now` is supplied by the caller. A caller that lies about it passes the staleness and expiry checks | Kernel call sites | Stage 4 |

**Superseded in the last round.** The lead recorded "a forged `TenantRegistry` is not detected here". The recheck then asked for it to be refused in plain words, so it now is, by CC-38. The kernel reader still owns reading the real one.

## Carried to the Stage 5 first-connector phase

Line numbers are as at `bc740e99`.

| Item | Owner | Stage |
|---|---|---|
| **An in-flight attempt can be reconciled,** after which a late genuine receipt fails closed as `RETRY_HISTORY_INVALID` (`connectorContract.ts:721`). Fail-closed, and it stops that key until someone repairs the history | First connector phase, with the ledger | Stage 5 |
| **`provider:` pointers are shape-only,** and a real provider id of 24 or more alphanumerics, or containing `=`, is refused (`:503`, `:128`, `:257`). Each connector must declare its id shape | First connector phase | Stage 5 |
| **P2 governance actions `run-start`, `rollback` and `implement` still register** (`:335`). The door admits them. To be closed by the `connector-registry-change` work | First connector phase | Stage 5 |
| **`instantOf` stays private,** because AP-29 bars the import. Fix `val-projectos-port-approvals1a.cjs:109` by dropping `|instant` from `WIRED_NAMES` when that validator is granted, then import it and add it to `LOADED` and `PURE_IMPORTS` | Whichever phase holds that validator's grant | Stage 5 |
| **Only P1 and P2 actions can register,** so a sending connector needs a grant source first | Lead and owner, in the first sending connector's phase | Stage 5 |

## Mutations, by rule

Every mutation below fired exactly its declared rules.

| Rule | Says | Count | Mutations |
|---|---|---|---|
| CC-1 | a complete entry registers with what it declared | 6 | `entry-scopes-lost`, `entry-secret-reference-lost`, `entry-data-categories-lost`, `entry-idempotency-lost`, `record-evidence-lost`, `record-checklist-lost` |
| CC-2 | a connector with no declared tenant is refused | 4 | `tenant-missing-not-named`, `tenant-blank-allowed`, `tenant-undeclared-allowed`, `tenant-optional` |
| CC-3 | a connector with no secret reference is refused | 3 | `secret-missing-not-named`, `secret-blank-allowed`, `secret-optional` |
| CC-4 | a connector with no passing release record is refused | 11 | `release-record-optional`, `release-missing-misnamed`, `release-never-judged`, `result-not-asked`, `result-truthy`, `checklist-not-asked`, `scenarios-not-asked`, `evidence-not-asked`, `exactly-allows-extras`, `exactly-allows-gaps`, `checklist-loses-an-item` |
| CC-5 | a raw credential in the reference field is refused, and not repeated | 9 | `credential-shape-not-asked`, `raw-run-not-asked`, `split-run-not-asked`, `split-run-weakened`, `split-run-needs-single-separators`, `split-run-reads-only-the-last-segment`, `credential-falls-to-shape`, `credential-repeated-in-the-refusal`, `raw-run-weakened` |
| CC-6 | a reference has the store's shape and the connector's own tenant | 7 | `reference-any-environment`, `reference-any-root`, `reference-any-shape`, `reference-any-tenant`, `reference-any-listed-project`, `reference-any-domain`, `reference-any-tenant-class` |
| CC-7 | a release record binds its connector, version, tenant and date | 4 | `record-any-connector`, `record-any-version`, `record-any-tenant`, `record-any-date` |
| CC-8 | acceptance is judged per connector against time handed in | 7 | `never-stale`, `stale-one-early`, `window-raised`, `future-date-allowed`, `unreadable-now-is-fresh`, `gate-skips-acceptance`, `lapse-refuses-the-whole-file` |
| CC-9 | an unknown field is refused | 5 | `header-unknown-field-tolerated`, `entry-unknown-field-tolerated`, `record-unknown-field-tolerated`, `entry-fields-gain-an-override`, `unknown-field-filter-keeps-nothing` |
| CC-10 | the file is judged whole | 22 | `file-live-despite-problems`, `wildcard-matches-nothing`, `id-wildcard-falls-to-shape`, `tenant-wildcard-falls-to-shape`, `list-wildcard-falls-to-shape`, `duplicate-connector-allowed`, `list-repeats-allowed`, `any-schema-version`, `any-policy`, `prose-optional`, `no-list-reads-as-empty`, `empty-list-is-a-declaration`, `version-any-text`, `domain-any-text`, `id-any-text`, `idempotency-any-text`, `date-any-text`, `year-past-four-digits`, `a-date-that-does-not-exist`, `scope-any-text`, `category-any-text`, `action-any-text` |
| CC-11 | an unregistered action is P5 and refused | 4 | `unregistered-action-accepted`, `unregistered-action-not-called-p5`, `gate-skips-the-action-registry`, `gate-hides-the-class` |
| CC-12 | read-only is checked against the action registry | 4 | `read-only-not-checked`, `gate-skips-the-class`, `read-only-any-class`, `read-only-applies-to-all` |
| CC-13 | the error vocabulary is closed | 5 | `vocabulary-gains-timeout`, `vocabulary-loses-outcome-unknown`, `unknown-code-mapped`, `code-folds-case`, `code-trims` |
| CC-14 | a retry after outcome_unknown is refused until reconciled | 9 | `unknown-ignored`, `unknown-cleared-by-a-later-failure`, `unknown-cleared-by-a-later-success`, `completed-asked-before-unknown`, `a-fact-clears-the-unknown`, `keyed-by-the-connector`, `every-key-blocks-every-key`, `gate-skips-the-retry-rule`, `gate-reads-a-fresh-history` |
| CC-15 | reconciliation is explicit and leaves evidence | 11 | `reconcile-needs-no-evidence`, `reconcile-with-nothing-open`, `reconcile-any-finding`, `completed-reopens`, `not-completed-closes`, `reconcile-rewrites-the-history`, `reconcile-takes-the-callers-tenant`, `reconcile-drops-the-evidence`, `evidence-may-hold-a-credential`, `evidence-long-run-not-scanned`, `evidence-any-word` |
| CC-16 | every other code has its stated retry rule | 19 | `rate-limited-never`, `upstream-never`, `denied-retried`, `invalid-retried`, `auth-retried-blind`, `approval-retried-blind`, `unknown-rule-misstated`, `never-means-maybe`, `reauthentication-ignored`, `approval-ignored`, `reauthentication-truthy`, `approval-truthy`, `success-repeated`, `attempts-unbounded`, `attempts-one-late`, `attempts-one-early`, `bound-raised`, `attempt-not-counted`, `gate-drops-the-attempt` |
| CC-17 | history that cannot be trusted fails closed | 9 | `bad-line-skipped`, `no-history-reads-as-empty`, `tenant-crossing-tolerated`, `action-crossing-tolerated`, `reconciliation-line-needs-no-evidence`, `reconciliation-line-any-field`, `reconciliation-line-free-text-reconciler`, `reconciliation-line-names-no-envelope`, `key-shape-not-asked` |
| CC-18 | a receipt has the standard fields and no room for content | 13 | `receipt-unknown-field-tolerated`, `receipt-field-optional`, `receipt-field-unjudged`, `receipt-credential-not-scanned`, `receipt-credential-repeated`, `receipt-unknown-code-not-named`, `receipt-unknown-code-tolerated`, `receipt-outcome-unchecked`, `success-may-carry-a-code`, `unknown-may-carry-any-code`, `failure-may-claim-unknown`, `failure-needs-no-code`, `receipt-gains-a-payload` |
| CC-19 | a receipt must match its admitted call | 9 | `receipt-tenant-not-compared`, `receipt-tenant-misnamed`, `receipt-connector-not-compared`, `receipt-action-not-compared`, `receipt-key-not-compared`, `receipt-attempt-not-compared`, `receipt-mismatch-ignored`, `receipt-takes-any-call`, `call-never-branded` |
| CC-20 | nine scenarios are defined, one proved, none counted as passed | 11 | `scenario-dropped`, `scenario-renamed`, `scenario-given-blank`, `a-defined-scenario-counted-as-proved`, `a-defined-scenario-runs-in-stage-2`, `a-defined-scenario-claims-a-proof`, `cross-tenant-only-defined`, `cross-tenant-names-no-proof`, `tally-counts-defined-as-proved`, `tally-gains-a-passed-count`, `scenario-table-editable` |
| CC-21 | cross-tenant denial holds at the gate | 6 | `tenant-not-compared`, `domain-not-compared`, `cross-tenant-never`, `cross-tenant-misnamed`, `owner-passes-the-tenant-check`, `cross-tenant-action-opens-the-door` |
| CC-22 | the gate takes only what was admitted | 8 | `gate-takes-any-registry`, `registry-never-branded`, `gate-takes-any-envelope`, `door-probe-always-yes`, `door-probe-always-no`, `gate-skips-expiry`, `undeclared-action-allowed`, `unlisted-connector-falls-to-the-first` |
| CC-23 | no input is mutated, and what comes back is frozen | 10 | `registry-not-frozen`, `connector-list-not-frozen`, `entry-not-frozen`, `record-not-frozen`, `list-not-frozen`, `receipt-not-frozen`, `reconciliation-not-frozen`, `new-history-not-frozen`, `call-not-frozen`, `retry-table-editable` |
| CC-24 | the contract stays pure | 9 | `contract-reads-the-clock`, `contract-news-a-date`, `contract-reads-the-environment`, `contract-imports-the-filesystem`, `contract-gains-a-dependency`, `contract-calls-the-network`, `contract-imports-dynamically`, `contract-holds-a-mangled-escape`, `contract-falls-back-to-the-clock` |
| CC-25 | zero live connectors | 2 | `registry-gains-a-qualified-connector`, `registry-gains-an-unqualified-connector` |
| CC-26 | the schema agrees with the code | 25 | `schema-pattern-drifts-id`, `schema-pattern-drifts-reference`, `schema-tenant-drifts`, `schema-action-drifts`, `schema-evidence-drifts`, `schema-raw-run-dropped`, `schema-split-run-dropped`, `schema-evidence-credential-allowed`, `schema-prose-may-be-blank`, `schema-year-any-length`, `schema-tolerates-extra-registry-fields`, `schema-tolerates-extra-entry-fields`, `schema-tolerates-extra-record-fields`, `schema-tenant-optional`, `schema-reference-optional`, `schema-release-optional`, `schema-result-any`, `schema-domain-drifts`, `schema-idempotency-gains-none`, `schema-checklist-drifts`, `schema-scenario-drifts`, `schema-keyword-not-understood`, `reference-format-drifts`, `reference-environment-drifts`, `idempotency-shape-drifts` |
| CC-27 | the contract is exported and this validator registered | 3 | `barrel-omits-the-contract`, `validate-all-omits-this-validator`, `cached-runner-omits-this-validator` |
| CC-28 | the proofs exist and run | 6 | `a-proof-skipped`, `a-proof-isolated`, `a-table-skipped`, `a-suite-skipped`, `a-proof-commented-out`, `a-proof-deleted` |
| CC-29 | the committed registry passes the real reader | 3 | `registry-loses-its-policy`, `registry-loses-its-authority`, `registry-any-schema-version` |
| CC-30 | a start with no valid receipt is outcome_unknown | 11 | `broken-history-judged-anyway`, `a-start-with-no-receipt-is-fine`, `a-superseded-start-is-forgotten`, `a-receipt-closes-any-attempt`, `a-receipt-closes-any-connector`, `a-start-may-come-in-any-order`, `admission-returns-no-start`, `the-start-names-the-wrong-attempt`, `the-start-is-not-frozen`, `a-start-line-any-field`, `a-start-line-any-envelope` |
| CC-31 | a reconciliation answers one attempt, through an admitted envelope | 15 | `reconciliation-with-nothing-open-tolerated`, `a-copy-answers-again`, `another-connector-answers`, `reconcile-action-not-asked`, `reconcile-any-class`, `reconcile-floor-lowered`, `reconcile-class-of-the-envelope-unread`, `reconcile-any-envelope`, `reconcile-after-expiry`, `reconcile-any-action`, `reconcile-any-tenant`, `reconciler-from-free-text`, `reconciler-names-no-envelope`, `newest-attempt-answered-first`, `reconcile-action-renamed` |
| CC-32 | a stop reads the whole history | 1 | `a-stop-reads-only-the-last-line` |
| CC-33 | a connector may hold only what the door allows it | 5 | `the-door-is-not-asked`, `the-door-answer-is-ignored`, `the-door-grants-everything`, `the-door-refusal-says-nothing`, `the-door-probe-always-refuses` |
| CC-34 | a success points at its provider receipt | 3 | `a-success-needs-no-receipt`, `a-provider-receipt-may-point-anywhere`, `a-provider-receipt-may-be-any-text` |
| CC-35 | a duplicate returns the earlier outcome | 3 | `a-duplicate-gets-a-bare-refusal`, `the-gate-drops-the-earlier-outcome`, `the-first-outcome-is-overwritten` |
| CC-36 | everything is judged on a plain copy, and only that comes back | 3 | `the-receipt-is-judged-in-place`, `the-registry-is-judged-in-place`, `a-throwing-getter-escapes` |
| CC-37 | no refusal repeats a value that could be a credential | 3 | `an-unregistered-action-is-repeated`, `a-read-only-action-is-repeated`, `a-repeated-id-is-repeated` |
| CC-38 | a forged tenant registry is refused as one | 5 | `a-forged-tenant-registry-is-not-asked`, `a-forged-tenant-registry-reads-as-the-door`, `a-forged-tenant-registry-is-misnamed`, `a-shapeless-tenant-registry-throws`, `an-empty-tenant-registry-binds-nothing` |

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

The validator's mutations prove the validator fires. So each mutation of `connectorContract.ts` was also applied to the real file, `connector-contract.test.ts` run, and the bytes restored and hash-checked.

- **Last round: 252 of 254 killed by a behavioural test.** The 2 survivors, `contract-imports-the-filesystem` and `contract-imports-dynamically`, alter no behaviour: purity is the validator's to catch, and CC-24 does.
- **Round two:** 242 of 244. **Round one:** 188 of 199, then 197 of 199 once 9 real gaps in the test file were closed.
- **The first sweep's log was truncated by another run,** because the scratchpad is shared across the session and my script names collided with others. That run's control failed and it wrote nothing, but only by luck: it would otherwise have captured mutated bytes as its original. Later rounds ran from a directory named for this phase.
- **The exact-fire rule found two masked proofs in the last round.** The wider split rule answered for the raw-run rule, and the class check for the action check. Each now has a fixture only its own rule can refuse.

## Verification (run in this worktree)

| Check | Command | Result |
|---|---|---|
| Core typecheck | `npx tsc -p tsconfig.json --noEmit` in `projectos/core` | 0 errors |
| Full core suite | `npx vitest run` in `projectos/core` | 59 files, 2881 tests, all pass |
| New tests | `test/connector-contract.test.ts` | 306 tests, all pass |
| Fail-before, first build | Against a throwaway stub of the same API that accepts everything, at 215 tests | 195 failed, 20 passed |
| Fail-before, review round | The new tests, 294, against the code at `33763d70` | 88 failed, 206 passed |
| Fail-before, recheck round | The new tests, 304, against the code at `bc740e99` | 8 failed, 296 passed |
| This phase's validator | `node projectos/validators/val-projectos-connector-contract1a.cjs` | PASS, 38 rules, 293 named mutations, each firing exactly its declared rules. 72 declare a second rule also true of the same change |
| No secrets | `validate-no-secrets` | PASS |
| Readers of a touched file | 77 validators, each in its own process through `run()` | 75 PASS, 2 FAIL, neither from this phase (below) |
| Size | `wc -l projectos/core/src/connectorContract.ts` | 800 lines |
| Ignored files | `git check-ignore` and `git ls-files` on all six new files | None ignored, all tracked |

**A commit landed without its evidence.** `b962c50a` says this file lists the recheck. It does not: the evidence step failed in that command and the commit still ran, because `set -e` does not stop a chain in this tool. The source in `b962c50a` is what every check above ran on. The next commit carries the evidence, and from then on each step is gated by hand. Earlier rounds used the same `set -e`, and their output shows every check passing before the commit, so nothing else went in behind a failure.

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
- **A release record is a claim, and the gate is not live.** It binds a record to connector, version, tenant and
  date, and cannot tell whether a listed scenario really ran. At `33763d70` the evidence field even accepted the
  word "nothing". It now needs a `provider:`, `commit:` or `docs/` pointer, but that is a shape: `provider:nothing`
  passes, and nothing checks that the pointer resolves. Zero live connectors is what holds today: CC-25.
- **History is handed in, and this module is pure.** The durable write before acting is the duty of the Stage 4 and 5
  ledger. **The store must append a start only if `attempt == count + 1`, or two concurrent admits both run:** each
  reads the same history, and this module cannot see the other. Until it exists, **a caller passing an empty history
  defeats the retry rule**, and a caller that acts without persisting `started` loses the stop. A test records that limit.
- **A key follows the intent the kernel states.** A new `intentScope` is a new key, so a caller that changes it
  escapes the unknown. Only the call sites can prove they do not.
- **`reauthenticated` and `approved` are the kernel's word.** Nothing here can check them.
- **Backoff is not timed here,** and a receipt has no timestamp.
- **The credential check is a backstop.** A credential of no known shape passes if the provider and credential segments
  each hold fewer than 24 alphanumerics, whatever separates them, so one split across the two can pass. Below that length
  it cannot be told from a name. The store holding the value is the real control.
- **A tampered history file is not detected.** A copy or replay of a reconciliation answers nothing, because it names
  its attempt and connector. A new well-formed line written by hand, with the right attempt and connector, is
  honoured: parsing a stored line cannot check the envelope it names. Only `reconcileConnectorOutcome` checks that.
- **The gate's refusals are not recorded by it.** R4's execution line is the caller's, through `recordExecution`.
- **ADR-T1 §10 and §11 still bind.** This is not a boundary against a hostile worker.

## Carried forward

- **Stage 5 must register connector actions before the first connector,** and TC-39 pins the action table, so that
  phase updates `val-projectos-tenant-contract1a` too.
- **The first connector phase must register `connector-reconcile`,** or no unknown can be cleared, and must give
  connectors a grant source, or no sending connector can register.
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
