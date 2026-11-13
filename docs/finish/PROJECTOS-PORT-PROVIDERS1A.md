# PROJECTOS-PORT-PROVIDERS1A — model broker: providers, retries, pricing and fallback (C11)

**Phase:** PROJECTOS-PORT-PROVIDERS1A, port 2 of plan v1.36 (`docs/changes/delta_spec.md` row 2).
**Branch:** `projectos-port-providers1a`, worktree `C:/dev/ProjectOS-worktrees/port-providers1a-v136`, base `d443a0fa`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.

Nothing was run from a vendor folder, `openbot-lower` and every `DO-NOT-PORT.txt` were not opened, no dependency was
added, and no xAI or Grok path exists. Vendor text was read as data.

## Two things the lead must act on

1. **The credit validator cannot see `modelBroker/`, and fixing that is outside this phase's write paths.**
   `val-projectos-port-credit1a` judges only the directories in its `PORT_DIRS`, and ADR-P1 §7 must list the same ones
   (PC-17). `modelBroker/` is in neither, so on this branch **`val-projectos-port-credit1a` fails** (PC-23, a credit mark
   outside a port directory, and PC-16, notice entries outside one) and **`validate-all` fails on it**. The fix is
   three lines in the validator and two in the ADR, and it needs one more thing a path-based search would miss: the
   ADR directory pattern is lower-case only (`src\/[a-z]+`), so a camelCase directory like `modelBroker` is not
   matched until it reads `[A-Za-z]+`. The patch is
   `docs/finish/PROJECTOS-PORT-PROVIDERS1A-credit-adoption.patch` (`git apply`). **Proved both ways** on this tree:
   with it applied, the credit validator reads `PASS (75 real file(s) judged; 149 fixture and 59 record mutations
   killed)`; without it, it fails as above. It was applied only for the proof and then reverted, so this branch's
   commit holds neither the validator nor the ADR edit. The sibling ports (routines, agents, research, mcp, computer)
   will meet the same wall with their own camelCase directories.
2. **The agent cannot see this phase's core through its `node_modules` junction.** `agent/node_modules/@projectos/core`
   is a junction to `host-review-path1b`'s older build, so plain `npm run build` in `projectos/agent` fails with
   TS2305 for every name this phase adds, whatever core's build says. As in `PORT-SEARCH1A`, the agent typecheck and
   tests ran against a scratchpad config that aliases `@projectos/core` to this worktree's `core/src/index.ts`. The
   junction was not touched.

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
| Route types, barrel | `.../routeTypes.ts`, `.../index.ts` | Original |
| Committed config loader, local model detection | `agent/src/modelBroker/{committedConfig,localModels,index}.ts` | Original |
| Barrel line | `core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 8 entries, one per upstream file, each OpenClaw one with `Also-Credits: pi-mono` |
| Tests | `core/test/modelBroker-{retry,pricing,routing,endpoints,call}.test.ts`, `agent/test/modelBroker.test.ts` | Written first; the core ones failed on the missing module before any source |
| Validator | `projectos/validators/val-projectos-port-providers1a.cjs` | 28 rules, registered in `validate-all.cjs` and `speed/cached-runner.cjs`, same position in both |

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

## Acceptance criteria to tests

| Criterion | Tests |
|---|---|
| A call without a budget, or with a zero budget, is refused before the transport | `modelBroker-call.test.ts` "refuses a call with no budget, a zero budget, or a budget that is not a whole positive number, before the transport" (transport spy at 0) |
| Retries stay above the floor and stop at the cap; an empty history cannot reset the count | `modelBroker-retry.test.ts` (floor, jitter, provider hint, NaN, cap 99, store), `modelBroker-call.test.ts` "a caller passing an empty history cannot reset the count" |
| Pricing from committed bytes only, feeding `RateCard`; an unpriced model is refused | `modelBroker-pricing.test.ts` (commit shapes, unpriced, zero, decimals, tiers, cache), `modelBroker-call.test.ts` "refuses an unpriced model", agent `loadCommittedBrokerConfig` tests |
| A fallback stays in the registry; cooldown by an injected clock | `modelBroker-routing.test.ts` (registry, cooldown, route choice), `modelBroker-call.test.ts` fallback block |
| Local detection accepts loopback only | `modelBroker-endpoints.test.ts`, agent "refuses any other host and never calls the port for it" |
| Credit headers and entries; the credit validator passes | PP-2, PP-3, PP-4. The validator passes with the patch above and not without it (see the first section) |
| The validator refuses an importer outside the module | PP-24 and its two mutations |
| Validator pin and named mutations | See below |

## Mutations

Taken from the validator's own output, not from this document:

```text
val-projectos-port-providers1a: PASS (15 real files judged; 151 text and 39 behavioural mutations killed)
```

Every mutation is applied in memory (text) or to a copy of the code that Node runs by stripping types (behavioural),
and counts only when its own rule fires and no rule it did not declare. The unmutated copy passing every probe is the
positive control. Mutations are named after the rule body, for example `a-call-with-no-budget-is-sent`,
`a-retry-is-not-charged-to-the-budget`, `any-spelling-names-a-registered-provider`, `the-cooldown-never-ends`,
`an-alias-host-is-loopback`, `a-working-tree-read-passes-for-committed`.

**Mutations that proved a rule was doubled.** Four were first written as behavioural mutations and could not be killed,
because the code defends itself twice: the retry runner's final clamp hides a missing clamp on a provider's hint; the
endpoint authority pattern refuses `@` even without the explicit check; the custom-endpoint DNS rule refuses IP literals
even without the loopback check; and the tier selector's gap fallback is unreachable through the committed reader.
Those stay as text mutations, pinned in the body that decides. The first two are also killed together as one
behavioural mutation (`the-delay-skips-its-floor-twice`). One behavioural mutation (`a-tried-route-is-chosen-again`)
looped for ever instead of failing, and was removed; its text twin stays.

## Design notes the reviewers should check

- **The attempt count lives in an `AttemptStore` keyed by the idempotency key.** The request has no history field, and
  PP-13 pins both the type and the call. The in-memory store here is the test double. A durable store backed by the
  connector contract's attempt history is the wiring phase's work.
- **Retries are charged to the budget.** `RateCard` has no cache-write price, so the card's input rate is the larger of
  input and cache-write. The estimate can only be too high, never too low.
- **A call's answer is never lost to the ledger.** If the ledger throws, the outcome says `recorded: false`. An answer
  with unreadable usage is refused and recorded at its reserved worst case, marked `unresolved`.
- **The address is read as text**, not through `new URL`, which turns decimal and hex aliases into `127.0.0.1`. PP-5
  forbids `new URL(` in core.
- **A fallback only follows a rate limit, a billing refusal or an outage.** Authentication failures, bad requests and
  unknown errors stop the call: the last of those may have been dispatched.
- **`localhost` is accepted as loopback by name.** A hosts file can change it. Literal `127.0.0.0/8` and `::1` do not
  depend on that.

## Checks

Seen passing (exit codes read, not assumed):

| Check | Result |
|---|---|
| core `npx vitest run` | 64 files, 2947 tests, all pass |
| core `npm run -s build` | exit 0 |
| agent `npm run -s build` (plain) | exit 2: TS2305, the junction (first section) |
| agent `tsc` through the alias config, all of `src` | exit 0 |
| agent `vitest` through the alias config, whole suite | 108 of 110 files, 3424 tests pass, 1 fails: `workerLifecycle.test.ts`, which passes alone (28 of 28) and is a process-liveness test, so a load flake. The second failing file was not identified, because the re-run was stopped. `modelBroker.test.ts` passes (11) |
| `val-projectos-port-providers1a` | PASS (15 real files; 151 text and 39 behavioural mutations killed), before the last agent edit |
| `validate-no-secrets` | PASS |
| `val-projectos-port-credit1a` | PASS (75 files) with the adoption patch applied; fails without it |
| `val-projectos-port-search1a`, `-memory1a`, `-approvals1a` | PASS (run with the patch applied) |

Not run, or interrupted: `val-projectos-port-context1a`, `-skills1a`, `val-projectos-connector-contract1a`,
`val-projectos-kernel-followup1a`, `validate-speed-validation-cache`, the rest of the 21 validators that read a touched
file, and `validate-all`.

## Converge (B9)

- **Unbuilt.** No prices are committed: the broker refuses every model until the owner commits a table and a provider
  list (fail closed by design). The attempt store is in memory only. No action-registry entry exists for a model call
  (`action-registry.json` is PROTECTED), so P3 is the module's constant plus a grant port, not a registry lookup. The
  agent barrel (`agent/src/index.ts`) is not edited: it is outside the write paths. No live transport exists.
- **Drift from the spec.** The criterion "no importer outside its own directory and tests" has one allowed exception, the
  core barrel's single export line, as in search. Hermes' same-name overwrite became a refusal, and a provider-declared
  reset is capped at 4 h. OpenClaw's numeric-attempts retry form is cut.
- **PROTECTED files.** `git diff --stat d443a0fa` touches only `validate-all.cjs` and `speed/cached-runner.cjs`
  (registration only, approved in the delta), `THIRD_PARTY_NOTICES` and `core/src/index.ts` (listed). The credit
  validator and ADR-P1 are untouched in the commit; their needed change is the patch file.

## PAUSED STATE

Paused before shutdown at the lead's request. Passed: see Checks. Interrupted or not run: the agent suite re-run (one
unidentified failing file), the other touched-file validators, `validate-all`. The validator was last run before one
small agent change (`listUrlOf` in `localModels.ts`, with a new test), so re-run it. Left to do: re-run the validator,
the agent suite and the validators listed above; run `validate-all` with the credit patch applied (`git apply
docs/finish/PROJECTOS-PORT-PROVIDERS1A-credit-adoption.patch`); then review (ECC SECURITY, Agency api-platform-engineer).
