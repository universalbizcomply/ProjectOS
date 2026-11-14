# PROJECTOS-PORT-PROVIDERS1A — model broker: providers, retries, pricing and fallback (C11)

**Phase:** PROJECTOS-PORT-PROVIDERS1A, port 2 of plan v1.36 (`docs/changes/delta_spec.md` row 2).
**Branch:** `projectos-port-providers1a`, worktree `C:/dev/ProjectOS-worktrees/port-providers1a-v136`, base `d443a0fa`.
Not pushed, not merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.

Nothing was run from a vendor folder, `openbot-lower` and every `DO-NOT-PORT.txt` were not opened, no dependency was
added, and no xAI or Grok path exists. Vendor text was read as data.

## What the lead needs to know

1. **Credit validator and directories.** The shared credit-dirs commit `86f18e23` (merged into this branch) lists
   `modelBroker` in `PORT_DIRS`, ADR-P1 §7 and the PC-17 pattern, so the earlier adoption patch is gone. One more edit
   was needed and is recorded here, outside this phase's write paths and approved by the lead: `"providers"` was added to
   `PORT_VALIDATORS` in `val-projectos-port-credit1a.cjs` (one line), so this phase's validator may quote upstream marks
   in its own proofs. The credit validator then passes (75 real files judged).
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
| Credit headers and entries; the credit validator passes | PP-2, PP-3, PP-4. The credit validator passes (see the first section) |
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

Every line below was read from an exit code or an output on this tree (last commit `07f423d0` plus this phase's edits).

| Check | Result |
|---|---|
| core `npm run -s build` | exit 0 |
| core `npx vitest run` | 64 files, 2947 tests, all pass (65 of them in the five `modelBroker-*` files) |
| agent `npm run -s build` (plain) | **exit 2**, TS2305, the junction (item 2 above) |
| agent `tsc` over all of `src` through the alias config | exit 0 |
| agent `tsc` over `src/modelBroker` and its test through the alias config | exit 0 |
| agent `vitest`, whole suite, alias config | 110 files (109 ran), 3435 tests: 3425 pass, 0 fail, 10 skipped (not ours). One file failed to load: `tenantSidecar.test.ts` (item 3) |
| `workerLifecycle.test.ts` | Failed once under load in the first full run. Passes alone (28 of 28) and passed in the second full run |
| `val-projectos-port-providers1a` | PASS (15 real files judged; 151 text and 39 behavioural mutations killed), after the `localModels.ts` edit and after the registration move |
| `val-projectos-port-credit1a` | PASS (75 real file(s) judged; 152 fixture and 59 record mutations killed) |
| `validate-no-secrets` | PASS |
| `val-projectos-connector-contract1a` | PASS (38 rules; 293 named mutations killed). It failed twice (CC-M) with the first registration order, which is why the order moved |
| `val-projectos-port-{search,memory,approvals,context,skills}1a` | all PASS (113+25, 197, 81+64, 320, 440 mutations) |
| `val-projectos-kernel-{cost-cap,followup,platform-stop,role-review}1a`, `boot-continue1a`, `closure-transport1a`, `agent-workforce1a`, `gate-decision-evidence1a`, `gatekeeper-contract1a`, `host-review-path1a`, `host-review-path1b`, `live-gate-owner-floor1a`, `provider-key-shapes1a`, `technical-continuation1a`, `trust-boundary1a`, `work-record-not-authority1a`, `worker-lifecycle-bounded1a`, `v3-validation-evidence1a`, `validator-scratch-lifecycle1a` | all exit 0 |
| `val-projectos-tenant-{contract,credentials,csp,principal,rls}1a`, `val-watchdog-core1a`, `validate-speed-validation-cache`, `validate-v2-closure-evidence`, `validate-zero-relay-continuity` | all exit 0 |
| The 14 `val-cd-b4-*` validators | **not run.** They are Rust build fixtures that matched the touched-file search only through a broad pattern. The lead runs `validate-all` |
| `validate-all` | **not run**, by the lead's instruction |

The 36 validators that read a touched file were run one process each, after the last source change, except that the
early batch (up to `val-projectos-port-approvals1a`) ran before the registration move and was run again afterwards
(17 validators, all exit 0).
## Converge (B9)

Compared with the phase entry in `docs/projectos-finish-phases.json` and delta row 2:

| Requirement | State |
|---|---|
| Port the provider registry, retry with a backoff floor, committed pricing feeding `RateCard`, fallback and cooldown, custom endpoint records, loopback-only detection | Built, each with tests and a rule |
| Every call P3 with a mandatory budget | Built as a refusal before the transport, plus a spend-grant port. **Not built:** an `action-registry.json` entry for a model call (PROTECTED, the owner's O1-style act). P3 is the module's constant, not a registry lookup |
| "Pricing is read from committed bytes only" | The module accepts only text stamped with a 40-hex commit, and the agent loader only reads through a committed reader. **No price table or provider list is committed**, so the broker refuses every model until the owner commits both (fail closed, intended) |
| Credit headers, notices, credit validator passes | Built; the credit validator passes after the shared dirs commit and the one-line `PORT_VALIDATORS` edit |
| The validator refuses an importer outside the module and its tests | Built (PP-24), by import path and by exported name. **One deliberate exception:** the core barrel's single export line, as in `PORT-SEARCH1A`; the spec wording does not say so |
| Validator pin and named mutations, each killed by its own rule | 151 text, 39 behavioural |
| Backoff floor owed by CONNECTOR-CONTRACT1A | Closed in the broker (PP-11). `connectorContract.ts` itself is unchanged, so `decideConnectorRetry` still has no floor for connector calls |

**Unbuilt, on purpose or by scope:** a durable attempt store (the in-memory one is the double); a live transport; the
`agent/src/index.ts` barrel (outside the write paths); Hermes `route_binding.py` (wiring); the vendor price snapshots.

**Behaviour drift from upstream, each in a `CHANGED:` line:** a same-name provider registration is refused, not
overwritten; a provider-declared reset is capped at 4 h; the numeric-attempts retry form is cut; a free cache rate is
priced as fresh input; cache-write dearer than input is carried as the input rate.

**PROTECTED files.** `git diff --stat d443a0fa..HEAD` was read after the last edit: `validate-all.cjs` and
`speed/cached-runner.cjs` (registration only, approved by the delta), `THIRD_PARTY_NOTICES`, `core/src/index.ts` (one
line) and `val-projectos-port-credit1a.cjs` (one line, approved by the lead, plus the shared commit's own edits). No
other PROTECTED file is in the diff; `gatekeeperConfig.ts`, `run.ts`, the broker and `credentialResolver.ts` are
untouched.

## Final state

Ready for review: ECC SECURITY and Agency `api-platform-engineer` (the phase's required reviews), then `validate-all`
run by the lead. Open for the owner: the committed price table and provider list; the action-registry entry for a
model call; a durable attempt store when this is wired.
