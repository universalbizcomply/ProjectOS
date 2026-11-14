# PROJECTOS-PORT-PROVIDERS1A — model broker: providers, retries, pricing and fallback (C11)

**Phase:** PROJECTOS-PORT-PROVIDERS1A, port 2 of plan v1.36 (`docs/changes/delta_spec.md` row 2).
**Branch:** `projectos-port-providers1a`, worktree `C:/dev/ProjectOS-worktrees/port-providers1a-v136`, base `d443a0fa`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.

Nothing was run from a vendor folder, `openbot-lower` and every `DO-NOT-PORT.txt` were not opened, no dependency was
added, and no xAI or Grok path exists. Vendor text was read as data.

## What the lead needs to know

1. **Credit validator and directories.** The shared credit-dirs commit `86f18e23` (merged into this branch) lists
   `modelBroker` in `PORT_DIRS`, ADR-P1 §7 and the PC-17 pattern, so the earlier adoption patch is gone. The only edit
   this phase makes to the credit validator is the `PORT_VALIDATORS` line: `"providers"` was added to it, so this
   phase's validator may quote upstream marks in its own proofs. That line is outside this phase's write paths and was
   approved by the lead. The directories came from the shared commit. The credit validator passes (76 real files
   judged).
2. **The agent's `@projectos/core` junction.** `agent/node_modules/@projectos/core` points at the `host-review-path1b`
   worktree. Core was built in this worktree first (exit 0), but the agent still reads the other worktree, so the plain
   `npm run -s build` in `projectos/agent` fails with TS2305 on every name this phase adds. The agent typecheck and
   tests therefore ran against a scratchpad config that aliases `@projectos/core` to this worktree's
   `core/src/index.ts` (the same method as `PORT-SEARCH1A`). The junction was not touched.
3. **`tenantSidecar.test.ts` fails here only because of that junction.** It runs the plain `tsc -p agent/tsconfig.json`
   and so meets the same TS2305. On base `d443a0fa` (agent sources from `git archive` in a scratch directory, the same
   `node_modules`) the plain `tsc` exits 0, so it passes on base. It goes green once the junction sees this core, as
   after a merge and a core build in the main checkout.
4. **Registration order.** `val-projectos-port-providers1a` is registered before `val-projectos-connector-contract1a` in
   both lists, not after it, because that validator pins its own entry as the last one in the list
   (`CC-27`). Both lists are identical and in the same order.
## Existing code found (B1, before any file was written)

| Found | Where | Used how |
|---|---|---|
| `RateCard`, `rateCardProblems`, `estimateCostMicroUsd`, `recordCall`, `LedgerEntry` | `core/src/gatekeeperCostLedger.ts` | **Reused, not redefined.** The committed price becomes a `RateCard`; the ledger prices and records every call. PP-16 refuses a second `RateCard` declaration |
| `CONNECTOR_MAX_ATTEMPTS` (5), `CONNECTOR_RETRY_RULES` (`rate_limited`: `after-backoff`) | `core/src/connectorContract.ts` | The cap is that constant. The contract's recorded carry ("no backoff floor") is closed here, in the broker. `decideConnectorRetry` takes a caller-supplied `history`, which is the hole this phase must not copy, so it is not used. The file is unchanged |
| `isProjectId` | `core/src/tenant.ts` | Reused for the request's project |
| Committed `rateCards` loading | `agent/src/loop/gatekeeperConfig.ts` (PROTECTED) | Read only. The gatekeeper keeps its own committed rate cards for its own two models. The broker's table is a separate committed record in the same `RateCard` shape; whether the two are ever merged is a wiring decision, not made here |
| `GATEKEEPER_TRANSPORT_KINDS`, `ModelPolicy` | `core/src/gatekeeperTransport.ts`, `gatekeeperModelPolicy.ts` (PROTECTED) | Gatekeeper-only. No overlap with a general provider registry. Unchanged |
| A synthetic test provider, and CommonJS git, vercel and supabase providers | `core/src/execution/providers/`, `projectos/providers/` | Different concerns (the A8 name collision). Unchanged, hence `modelBroker/` |
| Retry and backoff elsewhere | `agent/src/mcp/oauth.ts`, `loop/*` | Searched for a retry runner or backoff helper to extend: none exists. Cooldowns are mentioned only in `core/src/context/accounting.ts`, as not ported |
| The search port's validator and finish doc | `val-projectos-port-search1a.cjs`, `PORT-SEARCH1A.md` | The shape followed: pure core, ports in the agent, credit headers, a behavioural run, named mutations |

## Delivered

| Item | Path | Origin |
|---|---|---|
| Retry runner, jitter, config | `core/src/modelBroker/retry.ts` | OpenClaw `packages/retry/src/index.ts`, DIRECT, at `c5b56f25` |
| Transport shape (apis, stop reasons, token buckets) | `.../transportTypes.ts` | OpenClaw `llm-core` `model-data.ts`, `types.ts`, ADAPT |
| Tier selection and per-million price reader | `.../pricingTiers.ts` | OpenClaw `llm-core` `usage-cost.ts`, `model-catalog-core` `model-catalog-pricing.ts`, DIRECT |
| Provider registry | `.../providerRegistry.ts` | Hermes `agent/provider_registry.py`, `provider_base.py`, TRANSLATE, at `d3e58688` |
| Cooldown | `.../cooldown.ts` | Hermes `agent/fallback_cooldown.py`, TRANSLATE |
| Backoff floor, cap, attempt store | `.../retryPolicy.ts` | Original |
| Committed price table to `RateCard` | `.../committedPricing.ts` | Original |
| Endpoint rules, loopback rule | `.../endpoints.ts` | Original |
| Route choice | `.../fallback.ts` | Original |
| The call | `.../callModel.ts` | Original |
| The idempotency key | `.../requestKey.ts` | Original (review round 1) |
| Route types, barrel | `.../routeTypes.ts`, `.../index.ts` | Original |
| Committed config loader, local model detection | `agent/src/modelBroker/{committedConfig,localModels,index}.ts` | Original |
| Barrel line | `core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 8 entries, one per upstream file, each OpenClaw one with `Also-Credits: pi-mono` |
| Tests | `core/test/modelBroker-{retry,pricing,routing,endpoints,call}.test.ts`, `agent/test/modelBroker.test.ts` | Written first; the core ones failed on the missing module before any source |
| Validator | `projectos/validators/val-projectos-port-providers1a.cjs` | 35 rules, registered in `validate-all.cjs` and `speed/cached-runner.cjs`, same position in both |

**Read and not ported, by choice.** Hermes `route_binding.py` (it swaps a live agent's client in place: wiring, not a
rule), Hermes `usage_pricing.py` (its price snapshots are vendor-claimed numbers, include xAI, and would be
committed prices nobody on this side has checked; only its shape informed the tier rule), OpenClaw `canonical-model-key`
and `provider-id` (normalisation the closed registry does not need), the streaming and thinking parts of `llm-core`
(no live transport here), and the remote catalogue sources and OpenRouter reader in `model-catalog-pricing.ts`
(they fetch prices; this phase reads committed bytes only). Hermes `credential_pool` was refused as the delta says.

## Refusals, and the rule each is held by

| Refusal | Rule |
|---|---|
| No budget, a zero, fractional, NaN or string budget: `BUDGET_REQUIRED`, before the grant and before the transport | PP-9 |
| A call without a provider-spend grant that answers exactly `true`; a throwing grant is not one | PP-10 |
| A retry below the 1 s floor, whatever the caller or the provider asks or says | PP-11 |
| A retry past the cap of 5 per idempotency key, across retries, providers and calls | PP-12 |
| A caller-held count: the request has no history field, and extra `history`, `attempts` fields change nothing | PP-13 |
| A retry that spends past the budget: each attempt reserves its worst case first | PP-14 |
| A price not read at a 40-character commit; an unpriced, zero, missing or over-precise price; a duplicate | PP-15 |
| A second `RateCard`; a dearer cache write left out of the estimate | PP-16, PP-17 |
| A fallback to a provider outside the committed registry, or to another spelling of one | PP-18 |
| A provider used inside its cooldown; a cooldown past 4 h | PP-19 |
| A non-loopback address as a local model; aliases (`2130706433`, `0x7f000001`, `127.1`), `localhost.evil.com`, `127.0.0.1@evil.com`, v4-mapped IPv6 | PP-20 |
| A key field in a provider record; a secret passed as a reference | PP-21 |
| Unreadable usage counted as free: the worst case stays on the ledger, marked unresolved | PP-25 |
| Repeating or falling back on a failure that may have acted (unknown error, auth, invalid request) | PP-26 |
| A custom endpoint that is http, an IP literal, this machine, a private range or a bare name | PP-27 |
| Any xAI or Grok provider | PP-8 |
| Any importer of the module outside its directory and tests, by path or by exported name | PP-24 |
| A prompt larger than the caller's token claim: the estimate is raised to the ledger's own estimate for the prompt | PP-28 |
| An idempotency key the caller made up, or one bound to another prompt, tenant, project or request id | PP-29 |
| A repeat of a finished request reaching the transport again; one tenant's attempt count or cooldown seen by another | PP-29 |
| A call that may have acted, retried without its key or on another provider: it stops with `OUTCOME_UNKNOWN` | PP-30 |
| A stop reason of `error` or `aborted` returned as an ok answer; `length` hidden from the caller | PP-31 |
| A failed attempt left off the audit record; a possibly billed one counted as free; a free one holding its reservation | PP-32 |
| A Retry-After above the cap waited out, or ignored by the cooldown | PP-33 |
| A bad clock after the spend, an answer over one million characters, or an unbounded attempt store | PP-34 |

## Acceptance criteria to tests

| Criterion | Tests |
|---|---|
| A call without a budget, or with a zero budget, is refused before the transport | `modelBroker-call.test.ts` "refuses a call with no budget, a zero budget, or a budget that is not a whole positive number, before the transport" (transport spy at 0) |
| Retries stay above the floor and stop at the cap; an empty history cannot reset the count | `modelBroker-retry.test.ts` (floor, jitter, provider hint, NaN, cap 99, store), `modelBroker-call.test.ts` "a caller passing an empty history cannot reset the count" |
| Pricing from committed bytes only, feeding `RateCard`; an unpriced model is refused | `modelBroker-pricing.test.ts` (commit shapes, unpriced, zero, decimals, tiers, cache), `modelBroker-call.test.ts` "refuses an unpriced model", agent `loadCommittedBrokerConfig` tests |
| A fallback stays in the registry; cooldown by an injected clock | `modelBroker-routing.test.ts` (registry, cooldown, route choice), `modelBroker-call.test.ts` fallback block |
| Local detection accepts loopback only | `modelBroker-endpoints.test.ts`, agent "refuses any other host and never calls the port for it" |
| Credit headers and entries; the credit validator passes | PP-2, PP-3, PP-4. The credit validator passes (see the first section) |
| The validator refuses an importer outside the module | PP-24 and its two mutations |
| Validator pin and named mutations | See below |

## Mutations

Taken from the validator's own output, not from this document:

```text
val-projectos-port-providers1a: PASS (16 real files judged; 195 text and 73 behavioural mutations killed)
```

Every mutation is applied in memory (text) or to a copy of the code that Node runs by stripping types (behavioural),
and counts only when its own rule fires and no rule it did not declare. The unmutated copy passing every probe is the
positive control. Mutations are named after the rule body, for example `a-call-with-no-budget-is-sent`,
`a-retry-is-not-charged-to-the-budget`, `any-spelling-names-a-registered-provider`, `the-cooldown-never-ends`,
`an-alias-host-is-loopback`, `a-working-tree-read-passes-for-committed`, and, for the review round, `the-estimate-is-the-callers`, `a-made-up-key-is-accepted`, `a-finished-request-calls-again`, `the-key-is-not-sent`, `an-error-stop-is-an-ok-answer`, `a-free-failure-keeps-its-reservation`, `a-long-retry-after-is-waited-out`, `the-raw-runner-has-no-floor`.

**Mutations that proved a rule was doubled.** Four were first written as behavioural mutations and could not be killed,
because the code defends itself twice: the retry runner's final clamp hides a missing clamp on a provider's hint; the
endpoint authority pattern refuses `@` even without the explicit check; the custom-endpoint DNS rule refuses IP literals
even without the loopback check; and the tier selector's gap fallback is unreachable through the committed reader.
Those stay as text mutations, pinned in the body that decides. The first two are also killed together as one
behavioural mutation (`the-delay-skips-its-floor-twice`). One behavioural mutation (`a-tried-route-is-chosen-again`)
looped for ever instead of failing, and was removed; its text twin stays.

## Design notes the reviewers should check

- **The attempt count lives in an `AttemptStore` keyed by tenant, project and the bound idempotency key.** The request has no history field, and
  PP-13 pins both the type and the call. The in-memory store here is the test double. A durable store backed by the
  connector contract's attempt history is the wiring phase's work.
- **Retries are charged to the budget.** `RateCard` has no cache-write price, so the card's input rate is the larger of
  input and cache-write. The estimate can only be too high, never too low.
- **A call's answer is never lost to the ledger.** If the ledger throws, the outcome says `recorded: false`. An answer
  with unreadable usage is refused and recorded at its reserved worst case, marked `unresolved`.
- **The address is read as text**, not through `new URL`, which turns decimal and hex aliases into `127.0.0.1`. PP-5
  forbids `new URL(` in core.
- **A fallback only follows a rate limit, a billing refusal, an outage or an answer that was an error.** Authentication
  failures, bad requests and unknown errors stop the call, and a call that may have acted ends as `OUTCOME_UNKNOWN`.
- **`localhost` is accepted as loopback by name.** A hosts file can change it. Literal `127.0.0.0/8` and `::1` do not
  depend on that.

## Checks

Every line below was read from an exit code or an output on this tree after the review-round changes.

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 64 files, 2976 tests, all pass (94 of them in the five `modelBroker-*` files) |
| agent `npm run -s build` (plain, in this worktree) | **exit 2**, TS2305: `agent/node_modules/@projectos/core` is a junction to the `host-review-path1b` worktree, so it does not see this core whatever core's build says |
| agent `tsc` over all of `src`, **alias config** (`@projectos/core` mapped to this worktree's `core/src/index.ts`) | exit 0 |
| agent `tsc` over `src/modelBroker` and its test, alias config | exit 0 |
| agent `vitest`, whole suite, **alias config** | 110 files, 3435 tests: 3425 pass, 0 fail, 10 skipped (not ours). One file fails to load, `tenantSidecar.test.ts`, which runs the plain `tsc` and so meets the junction (see the first section; it passes on base) |
| `modelBroker.test.ts` (agent) | 11 of 11 |
| `val-projectos-port-providers1a` | PASS (16 real files judged; 195 text and 73 behavioural mutations killed) |
| `val-projectos-port-credit1a` | PASS (76 real file(s) judged; 152 fixture and 59 record mutations killed) |
| `validate-no-secrets` | PASS |
| The 36 other validators that read a touched file, one process each (`val-projectos-{agent-workforce,boot-continue,closure-transport,connector-contract,gate-decision-evidence,gatekeeper-contract,host-review-path1a,host-review-path1b,kernel-*,live-gate-owner-floor,port-{approvals,context,memory,search,skills},provider-key-shapes,technical-continuation,tenant-*,trust-boundary,v3-validation-evidence,validator-scratch-lifecycle,work-record-not-authority,worker-lifecycle-bounded}1a`, `val-watchdog-core1a`, `validate-speed-validation-cache`, `validate-v2-closure-evidence`, `validate-zero-relay-continuity`) | all 36 exit 0 |
| The 14 `val-cd-b4-*` validators | **not run.** Rust build fixtures that match the touched-file search only through a broad pattern. The lead runs `validate-all` |
| `validate-all` | **not run**, by the lead's instruction |

The alias is the only way the agent sees this phase's core in this worktree. It was used for the agent typecheck and
for every agent test; the plain agent build was run and fails for the stated reason.

## Converge (B9)

Compared with the phase entry in `docs/projectos-finish-phases.json`, delta row 2 and the review round:

| Requirement | State |
|---|---|
| Provider registry, retry with a backoff floor, committed pricing feeding `RateCard`, fallback and cooldown, custom endpoint records, loopback-only detection | Built, each with tests and a rule |
| Every call P3 with a mandatory budget | Built as a refusal before the transport, a spend-grant port, and (review round) a budget that is a bound: the estimate is floored from the prompt. **Not built:** an `action-registry.json` entry for a model call (PROTECTED). P3 is the module's constant, not a registry lookup |
| Pricing from committed bytes only | The module accepts only text stamped with a 40-hex commit, and the agent loader reads only through a committed reader. **No price table or provider list is committed**, so the broker refuses every model until the owner commits both (fail closed, intended) |
| Credit headers, notices, credit validator passes | Built; passes with the shared dirs commit and the `PORT_VALIDATORS` line |
| The validator refuses an importer outside the module and its tests | Built (PP-24), by import path and by exported name, with one exception: the core barrel's single export line, as in `PORT-SEARCH1A` |
| Validator pin and named mutations, each killed by its own rule | 195 text, 73 behavioural |
| Backoff floor owed by CONNECTOR-CONTRACT1A | Closed in the broker and, in the review round, in the raw runner (PP-11). `connectorContract.ts` is unchanged, so `decideConnectorRetry` still has no floor for connector calls |

**Unbuilt, on purpose or by scope:** a durable attempt store and outcome memory (the in-memory ones are the double); a
live transport; the `agent/src/index.ts` barrel (outside the write paths); Hermes `route_binding.py` (wiring); the vendor
price snapshots; and the items under Deferred below.

**Behaviour drift from upstream, each in a `CHANGED:` line:** a same-name provider registration is refused, not
overwritten; a provider-declared reset is capped at 4 h and never shortens the base cooldown; the numeric-attempts retry
form is cut; the runner holds a floor and a ceiling no option can move; a free cache rate is priced as fresh input;
cache-write dearer than input is carried as the input rate.

**PROTECTED files.** `git diff --stat d443a0fa` was read after the last edit: `validate-all.cjs` and
`speed/cached-runner.cjs` (registration only, approved by the delta), `THIRD_PARTY_NOTICES`, `core/src/index.ts` (one
line), `val-projectos-port-credit1a.cjs` (the `PORT_VALIDATORS` line, approved by the lead, plus the shared commit's own
edits) and ADR-P1 (the shared commit's). No other PROTECTED file is in the diff; `gatekeeperConfig.ts`, `run.ts`, the
broker, `credentialResolver.ts`, `gatekeeperCostLedger.ts` and `connectorContract.ts` are untouched.

## Review round 1

ECC security-reviewer and Agency api-platform-engineer reviewed head `e87f9aae`. Their findings overlapped. Each was
fixed test-first (the new tests failed on the missing code before any source changed) and has a named mutation killed
by its own rule. House rule held: a business refusal is a returned value with a machine-readable `code`, and a
transport failure is classed, never rethrown as a refusal.

| Finding | Disposition | Tests | Mutations (rule) |
|---|---|---|---|
| H1 budget is not a bound (ECC H1, Agency F3) | Fixed. The caller's estimate is raised to `estimateInputTokensFromText(prompt)` from the cost ledger, never lowered, and the price tier comes from it. A 500 KB prompt claiming zero tokens is refused | `modelBroker-call` "the budget is a bound" (3) | `the-estimate-is-the-callers`, `the-floor-is-a-ceiling`, `the-tier-is-picked-from-the-claim`, `the-ledgers-estimator-is-rewritten` (PP-28) |
| H2 attempt cap and idempotency are not real (Agency F1, ECC M3) | Fixed. The key is `bindingKeyOf(tenant, project, requestId, prompt)` and a request whose key is not that is refused. The attempt store and the cooldown book are keyed by tenant and project. A finished request is remembered and replayed (`replayed: true`): one transport call, one ledger record | `modelBroker-call` "the key is bound...", `modelBroker-retry` store, scope, key tests | `a-made-up-key-is-accepted`, `the-key-ignores-the-tenant` and three siblings, `the-key-has-no-length-prefix`, `a-finished-request-calls-again`, `an-answer-is-not-remembered`, `the-count-ignores-the-tenant-and-project`, `the-cooldown-book-is-global` (PP-29) |
| H3 the key does not reach the transport; a call that may have acted is retried blindly | Fixed. `ModelTransportRequest.idempotencyKey` is passed on every request. `may_have_acted` is a class of its own: retried on the same route with the key, never on another provider, and a failure ends as `OUTCOME_UNKNOWN` with the worst case on the ledger as unresolved. A retry without a valid key is refused. PP-26's claim is now true | `modelBroker-call` "the key reaches the transport..." (3) | `the-key-is-not-sent`, `a-retry-needs-no-key`, `a-call-that-may-have-acted-falls-back`, `the-transport-request-has-no-key-field` (PP-30) |
| H4 stop reason dropped | Fixed. `stopReason` is on the success. `error` and `aborted` are `provider_error` failures: they fall back, keep their reservation, and do not clear a cooldown. `length` reaches the caller | `modelBroker-call` "a stop reason is part of the answer" (3) | `an-error-stop-is-an-ok-answer`, `an-aborted-stop-is-an-ok-answer`, `the-stop-reason-is-dropped`, `a-provider-error-does-not-fall-back` (PP-31) |
| M1 floor and ceiling in the raw runner | Fixed. `createRetryRunner` holds `RETRY_FLOOR_MS` (1 s) and `RETRY_ATTEMPT_CEILING` (5) itself, and its default minimum is the floor | `modelBroker-retry` "the raw runner holds the floor and the ceiling itself" (3) | `the-raw-runner-has-no-floor`, `the-raw-runner-has-no-ceiling` (PP-11, PP-12) |
| M2 a NaN delay skips the sleep | Fixed. A non-finite delay falls back to the floor, and the sleep always runs | same block, NaN case | `a-random-source-of-nan-skips-the-sleep` (PP-11) |
| M3 Retry-After above the cap, outage cooldown, wasted reservation | Fixed. Above the cap: no retry, the cooldown is armed from `retryAfterMs` (or `resetAtMs`), then fallback. A provider reset never shortens a cooldown below the base. `upstream_unavailable` arms a 30 s cooldown. A failure known to be free releases its reservation, so a cheap backup is still tried. Pre-loop and in-loop budget checks now use the same reservation. **The old test pinning "retries cannot spend past the budget" with rate limits was changed**: it now uses `may_have_acted` (which is billed), and a new test covers the release. Three tests that used `upstream_unavailable` to exhaust a key moved to `may_have_acted`, because an outage now arms a cooldown | `modelBroker-call` retries and cooldown blocks; `modelBroker-routing` cooldown | `a-long-retry-after-is-waited-out`, `the-retry-after-is-not-the-cooldown`, `a-provider-reset-shortens-the-cooldown`, `an-outage-arms-no-cooldown`, `a-free-failure-keeps-its-reservation` (PP-19, PP-32, PP-33) |
| M4 refusal shape, failed attempts, the unchecked `recorded()` | Fixed. A refusal carries `code`, `reason`, `retryAtMs` when every route is cooling, and `failures[]` per route (reason, attempts, possibly spent). Every failed attempt goes to a new `recordAttempt` port (reason, possibly spent, zero when known free), and a possibly billed one also writes an unresolved ledger entry. The unresolved path's record result is checked and reported as `recorded`. The test "with what each did" now asserts the failures | `modelBroker-call` (refusal shape, attempt record, unreadable-usage record tests) | `the-refusal-forgets-its-routes`, `the-refusal-forgets-when-to-return`, `the-unresolved-record-is-not-checked`, `a-failed-attempt-is-not-noted`, `a-possibly-billed-failure-is-not-in-the-ledger` (PP-32) |
| M5 endpoint deny-list; xAI screen on the model name | Fixed. Custom endpoints refuse `.localhost`, `.internal`, `.local` and `nip.io`, `sslip.io`, `xip.io` names. The xAI or Grok screen now covers model names in the price table and in a call's chain | `modelBroker-endpoints`, `modelBroker-routing` | `a-custom-endpoint-may-be-an-internal-name`, `a-wildcard-dns-name-is-public`, `a-grok-model-is-priced`, `a-grok-model-is-called` (PP-27, PP-8) |
| M6 bad clock after the spend, text size, unbounded store | Fixed. The ledger date falls back to the call's start when the clock goes bad; an answer over 1,000,000 characters is refused after its spend is recorded; the memory store is bounded (4096 keys, oldest forgotten) | `modelBroker-call`, `modelBroker-retry` | `a-bad-clock-after-the-spend-throws`, `an-answer-has-no-size-cap`, `the-attempt-store-grows-without-end` (PP-34) |
| Doc claim that the credit-validator change is one line | Corrected in the first section: it is the `PORT_VALIDATORS` line only; the directories came from the shared commit | | |

**Deferred, with their owner:**

- **Per-provider and per-egress grant on fallback (F9).** The grant is asked once per call. A fallback to another provider
  is not re-granted. The wiring phase that connects the grant to the action registry owns it.
- **`pricedAt` staleness (F10).** The date is recorded and not judged. Judging it needs a clock policy the owner has not set.
- **Cooldown per model (F11).** Cooldowns are per provider, as upstream. A per-model cooldown comes with the first real transport.
- **A self-declared commit stamp (ECC M7).** `CommittedText.commit` is the reader's word. The committed-bytes reader that
  verifies it against git is the wiring phase's, with the real reader port.
- **Month, phase and day caps (ECC M4).** The call's own budget is enforced here. The kernel's `BudgetPolicy` caps
  (`phaseHardStopAtMicroUsd`, `dayHardStopAtMicroUsd`, the monthly stop) are owned by the Stage 4 phase that first calls the
  broker (4.1, headless workers and role broker), through the existing `authoriseRequestSpend`.
- **Concurrent duplicates.** Two simultaneous calls with the same key both pass the replay check and share an attempt count.
  A durable store with a compare-and-set claim closes it; the in-memory double does not.
- **Eviction resets a count.** A key evicted from the bounded in-memory store starts again. A durable store does not evict.

## Final state

Ready for the recheck: ECC SECURITY and Agency `api-platform-engineer`, then `validate-all` run by the lead. Open for the
owner: the committed price table and provider list, the action-registry entry for a model call, and a durable attempt
store with outcome memory when this is wired.
