# PROJECTOS-PORT-MCP1A — governed MCP connectors on the connector contract (C15)

**Phase:** PROJECTOS-PORT-MCP1A, delta phase 12 / plan v1.36 row 6 (`docs/changes/delta_spec.md`), V4 Stage 3.
**Branch:** `projectos-port-mcp1a`, worktree `C:/dev/ProjectOS-worktrees/port-mcp1a-v136`, base `d443a0fa`. Not pushed, not
merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.
**State:** built, then changed once after two independent reviews of `d7fbea07` (ECC security-reviewer and Agency
`application-security-engineer`); see "Review round 1". The one recheck of that round has not been done. The shared credit-directories commit `86f18e23` is merged in (`192e53b4`), so `val-projectos-port-credit1a`
passes. `validate-all` is the lead's and was not run here. See "Checks" and "Converge".

Nothing was run from a vendor folder, `openbot-lower` was not opened, no `DO-NOT-PORT.txt` was read, and no `node:child_process`
is imported. `agent/src/mcp/` and `projectos/connectors/registry.json` are byte-for-byte as they were.

## Existing code found (B1, before any file was written)

| Found | What it is | Decision |
|---|---|---|
| `core/src/connectorContract.ts` | Registry parse, release gate (`admitConnectorCall`), receipt check (`checkConnectorReceipt`), error and retry vocabulary. Read-only | **Built on.** `toolCall.ts` calls its gate and its receipt check; nothing in it is copied or changed (hash-pinned, MC-18) |
| `projectos/connectors/registry.json` | The registry. `"connectors": []` | **Untouched.** MC-14 reads it and refuses a row; CC-25 (`val-projectos-connector-contract1a`) still passes |
| `core/src/taskEnvelope.ts` | The envelope, its `budget` (micro-USD, a per-call ceiling), the door | **Reused.** The envelope's budget is the per-call ceiling for a tool, and its action is the action a tool is pinned to |
| `core/src/gatekeeperCostLedger.ts` | The cumulative cost ledger, for paid model calls through the broker only (ADR-T1 §8) | **Not reused.** It meters broker calls, not tool spend. Tool spend is an immutable `SpendTally` the caller holds, and the durable ledger of Stages 4 and 5 will own it. Carried below |
| `core/src/approvals/taint.ts` | Run guards and taint. "Only the checks are public": issuing and writing a guard is kernel-only | **Not used.** My first draft called `recordOutsideContent`; it is not exported, and it must not be. The connector instead returns `outsideContent`, the source string for the kernel to record |
| `core/src/search/untrustedExcerpt.ts`, `core/src/context/fence.ts` | The hash-named untrusted fence | **Pattern followed, not imported.** `fenced()` is private, `fencedTurn` needs a `ContextTurn`, and the search fence is citation-shaped. `untrustedOutput.ts` is the same design (id over the text, notice names the closing line) with its own header and checks |
| `core/src/execution/evidence.ts` `sha256Hex` | Pure SHA-256 | **Reused** for the manifest hash and fence ids |
| `agent/src/mcp/` (`bridge`, `listener`, `oauth`, `authServer`) | The owner's private MCP **server** for ChatGPT | **Not touched, and no overlap.** It is MCP on the serving side; this phase is the client side. Hash-pinned (MC-18) |
| `core/src/context/redact.ts`, `holdsSecretShape` | Secret-shape check used inside the contract | Meets my receipt through the contract. A 32-character hex digest was flagged as a credential run, so reply digests are 16 characters |
| Any MCP client, spawn port, scope/cost/sampling guard | None existed | New, in `mcpConnectors/` as the delta names it (A8) |

## Delivered

| Item | Path | Result |
|---|---|---|
| Ported, core | `projectos/core/src/mcpConnectors/{serverKeys,toolCosts,serverRequests,contentBlocks,sessionLifecycle}.ts` | Five files from five upstream files, each credited (`toolCosts` and `serverRequests` changed in round 1) |
| Original, core | `projectos/core/src/mcpConnectors/{allowlist,toolCall,untrustedOutput,canonicalJson,index}.ts` | The pin, the gate, the fence, the canonical hashes (round 1), the seam |
| Original, agent | `projectos/agent/src/mcpConnectors/{ports,rpcClient,connector,index}.ts` | Ports, a JSON-RPC client, one governed connection |
| Export | `projectos/core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 5 entries, written by script from each file's own header |
| Tests | `projectos/core/test/mcp-{allowlist,canonical,spend,requests,toolcall,lifecycle}.test.ts`, `projectos/agent/test/mcp{Connector,RpcClient}.test.ts` | 220 core, 67 agent |
| Validator | `projectos/validators/val-projectos-port-mcp1a.cjs` | 29 rules plus MC-T, 243 text and 83 behavioural mutations; registered in `validate-all.cjs` and `speed/cached-runner.cjs`, same position |

## Ported paths and pins

Hermes `d3e586881eacb132595edcbe4c170be8381e40c5` (MIT, Nous Research). OpenClaw `c5b56f2505c4f6a5803125d2923e2934c5f750af` (MIT,
OpenClaw Foundation; each file carries `Also-Credits: pi-mono`).

| Our file | Upstream file | Strategy | What changed |
|---|---|---|---|
| `core/src/mcpConnectors/serverKeys.ts` | Hermes `tools/mcp_tool_scope.py` | TRANSLATE | Owner scope became the tenant; a key is `tenant/server`. **Adoption of another scope's live connection removed**, so a tenant resolves only its own. The mutable ledgers and re-keying removed |
| `core/src/mcpConnectors/toolCosts.ts` | Hermes `tools/mcp_tool_costs.py` | TRANSLATE | Micro-USD integers (the envelope's unit). **An undeclared tool is refused** (upstream lets it run with no cost). **A limit is required** (upstream reads 0 as none). The table is the owner's row, not the server's own figures. A call may not exceed its envelope's budget. The process-global tally became an immutable value the caller holds. A rotated session keeps its spend, as upstream's `transfer_session` does |
| `core/src/mcpConnectors/serverRequests.ts` | Hermes `tools/mcp_tool_sampling.py` | TRANSLATE | **The sampling handler is removed: `sampling/createMessage` is refused whatever it carries, with no switch.** Upstream's one-minute sliding window is kept and limits elicitations. Form-mode-only and fail-closed answers kept; the answer comes from an owner-queue item, not the chat approval prompt. A field description (the server's words) is not carried into the item |
| `core/src/mcpConnectors/contentBlocks.ts` | OpenClaw `src/mcp/plugin-tools-handlers.ts` | ADAPTED | Direction reversed: upstream builds a result to serve, this reads one received. Both image spellings are read, and an image is reduced to a note, its bytes never kept. Any other block type becomes text. SDK schema parse, hooks, run ids removed |
| `core/src/mcpConnectors/sessionLifecycle.ts` | OpenClaw `src/mcp/tools-stdio-server.ts` | ADAPTED | Upstream's lifecycle kept: accepted work counted, work after close refused, close idempotent and draining, failures collected and thrown together. SDK `Server`/`StdioServerTransport`, signal and stdin handlers, log rerouting, plugin registry and scheduler ownership removed; the transport close is an injected function |

**What the brief's source list could and could not give.** `openclaw src/mcp` is OpenClaw's MCP **server** (it serves its tools
over stdio), and `extensions/mcp-relay` is a gateway grant and UI-tunnel relay. Neither holds a client. I took what
transfers: the session lifecycle and the content-block reading. `src/agents/agent-bundle-mcp-*.ts`, which the port map names
for the client, is outside the directories this brief named, so I did not read it. **The client in `rpcClient.ts` and
`connector.ts` is therefore original**, written against the MCP wire protocol, and the OpenClaw client lifecycle is only
partly ported. See Residuals.

Pi / pi-mono: searched all five upstream files for `pi-mono`, `mario`, `zechner`, `earendil`, `@mariozechner`, `copyright` and
`spdx`: zero matches. As in the search phase, that does not rule Pi out, so the OpenClaw files carry the credit.

## Acceptance criteria

| Criterion | Evidence |
|---|---|
| A server whose manifest hash differs from its allowlist pin is refused, tested | `mcp-allowlist.test.ts` "refuses a server whose manifest hash differs from its pin", "refuses an added argument, because the hash covers the arguments"; `mcp-toolcall.test.ts` "refuses a server whose manifest hash differs from its pin, before anything else"; `mcpConnector.test.ts` "refuses a manifest that differs from its pin, and never starts the server" (the spawn port is not called). MC-8: 11 text, 3 behavioural |
| A sampling request is refused; an elicitation becomes an owner-queue item and is never answered by the model, tested | `mcp-requests.test.ts` "refuses sampling/createMessage whatever it carries", "declares no sampling and no roots"; `mcpConnector.test.ts` "refuses sampling, tells the server so, and never reaches the owner or a model", "puts an elicitation to the owner and returns the owner's answer", "turns a failed owner queue into a cancel, never an accept". There is no model port to give the connector, and MC-10 refuses any model word in it. MC-9: 5 / 3, MC-10: 13 / 5 |
| A tool call without a budget, or past it, is refused, and tool output is rendered as untrusted, tested | `mcp-spend.test.ts` (undeclared tool, envelope ceiling, spend limit, exact limit, rotation, refund); `mcp-toolcall.test.ts`; `mcp-requests.test.ts` "tool output is data" (fence id follows the text, hand-made output refused, images not kept); `mcpConnector.test.ts` "tool output is untrusted…". MC-11: 14 / 6, MC-12: 21 / 6 |
| The registry stays empty and CC-25 still passes | `projectos/connectors/registry.json` untouched. `mcpConnector.test.ts` "with the committed registry, which holds no connector, refuses the call and sends nothing" reads the committed file. MC-14 refuses a row. `val-projectos-connector-contract1a`: PASS (38 rules; 293 named mutations) |
| Credit header and notices entry on every ported file; the credit validator passes | Headers on 5 files, 5 notices entries, MC-2 and MC-4. `val-projectos-port-credit1a`: PASS (73 real files judged; 152 fixture and 59 record mutations killed), exit 0, after the shared credit-dirs commit `86f18e23` |
| The validator refuses any importer outside the module and its tests | MC-19 scans every other source file under `projectos/` by path (`mcpConnectors`) and by exported name, so an importer through the package barrel is caught. The one allowed line is the core barrel's own. Two mutations add an importer |
| Validator pin and named mutations, each killed by its own rule | 326 mutations (243 text, 83 behavioural), each named after the rule body. A mutation counts only if its rule fires and no rule it did not declare |

## Credit result: green

On the pre-merge branch the credit validator failed with 5 errors (`PC-16 ... it is outside the port directories`): it judges only
the directories in its `PORT_DIRS`, ADR-P1 §7 lists the same set (PC-17), and `mcpConnectors/` was in neither, nor in this phase's
write paths. I held a rehearsed patch rather than edit outside the write paths, and the lead landed the same change as
`86f18e23` (PORT_DIRS, ADR-P1 §7 and the PC-17 regex, which also needed `[a-z]` widened to `[A-Za-z]` for the capital C). The
held patch was deleted as superseded. After the merge the validator passes.

## Refusals this phase makes, and where each is held

| Refusal | Held in | Rule |
|---|---|---|
| A manifest whose hash is not the owner's pin | `allowlist.admitServer`; checked before the spawn port is touched | MC-8 |
| A URL, catalogue name or install step as a manifest; any transport but stdio; a shell operator in a command; an environment value (names only) | `allowlist.parseManifest` | MC-16 |
| A tool the owner's row does not name; a tool pinned to another action than the envelope's | `toolCall.admitMcpToolCall` | MC-13 |
| Sampling, any method the client does not handle, URL-mode elicitation | `serverRequests.decideServerRequest` | MC-9 |
| An elicitation answered by anything but the owner's own answer; a failed queue or bad answer read as consent | `connector.openMcpConnector` | MC-10 |
| A tool with no declared cost; a call over the envelope's ceiling; a call over the spend limit; a zero or missing limit | `toolCosts` | MC-11 |
| Tool output outside a hash-named fence; images passed on; unlisted tools exposed; descriptions kept | `untrustedOutput`, `contentBlocks`, `connector.offeredTools` | MC-12 |
| Any call while the committed registry holds no connector | `connectorContract.admitConnectorCall`, through `toolCall` | MC-14 |
| A closed session accepting work; a lost reply read as a call that never left | `sessionLifecycle`, `rpcClient`, `connector` | MC-15 |
| xAI/Grok, yolo or no-approval modes | absent; MC-17 refuses the words | MC-17 |

## Mutation table (from the validator's own export)

| Rule | Text mutations | Behavioural |
|---|---|---|
| MC-1 listing, MC-2 upstream record, MC-3 origin mark, MC-4 credit, MC-7 dependencies, MC-22 tracked | 2, 4, 3, 1, 2, 1 | 0 |
| MC-5 core purity, MC-6 connector reach | 6, 4 | 0 |
| MC-8 the pin | 11 | 3 |
| MC-9 sampling off | 5 | 3 |
| MC-10 owner answers | 13 | 5 |
| MC-11 spend: a window, a call cap, no session key | 21 | 11 |
| MC-12 output is data | 21 | 6 |
| MC-13 gate order | 10 | 2 |
| MC-14 connector contract | 10 | 3 |
| MC-15 session close | 16 | 9 |
| MC-16 install route | 7 | 3 |
| MC-17 refused features, MC-18 protected files, MC-19 unwired, MC-20 exported, MC-21 registered, MC-T tests | 3, 2, 2, 14, 3, 2 | 0 |
| MC-23 one tenant, three ways (H1) | 4 | 1 |
| MC-24 start stored before the send, one call per key (H3) | 9 | 4 |
| MC-25 rug pull (H4) | 14 | 7 |
| MC-26 timeouts, byte cap before parse, failed send (M1) | 11 | 8 |
| MC-27 elicitation rules (M2) | 13 | 9 |
| MC-28 launch hygiene (M3) | 13 | 7 |
| MC-29 spawn confinement named to the port (M4) | 16 | 2 |
| **Total** | **243** | **83** |

The unmutated copy passing every probe is the positive control, and the self-test names the rule it expects to fire and refuses a
mutation that also fires a rule it did not declare. The probes run this phase's own TypeScript, with every core file it
reaches copied into one scratch directory and run under Node's type stripping: a fake server, fake ports, no process, network or
shell.

**What the behavioural run found.** Four mutations first survived because they were equivalent to the code, not because the rule
was weak, and each was settled in the code or the validator: `a-prototype-name-is-a-listed-tool` and `a-tool-may-be-listed-with-no-cost`
change nothing observable (the table has no prototype, and a missing cost is also refused by the cost parser), so they stay as text
pins only; `a-settled-session-keeps-its-old-scope` was dead code (settled items remove themselves), so the reset was removed from
`sessionLifecycle.ts` rather than defended; and two MC-13 probes were really spend probes, so they moved to MC-11.

## Proofs and checks

| Check | Result |
|---|---|
| Tests first | Round 0: the module did not exist when the core tests were written (all 5 files failed at import). Round 1: the new and changed tests were written first and run against the round-0 code: **91 of 201 core tests failed** (the new descriptor, canonical, window, call-cap and cost-policy cases), before any fix |
| Core `npx vitest run` | 65 files, **3102 tests passed**, exit 0 (the six mcp files are 220 of them) |
| Core `npm run -s build` | exit 0 |
| Agent tests (this phase's two files) | 2 files, **67 tests passed**, exit 0, through the alias config below |
| Agent full suite | not re-run in round 1. Round 0: 111 files, 110 passed, 3449 tests passed, 10 skipped, **exit 1 from `tenantSidecar.test.ts` alone**, junction-induced, not this phase (passes on base, 10 of 10) |
| Agent typecheck | exit 0 through a scratch tsconfig mapping `@projectos/core` to this worktree's `core/dist`. Stock `npx tsc -p tsconfig.json` has 33 diagnostics, **all in `src/mcpConnectors/`**, all from the junction'd core lacking this phase's exports |
| `val-projectos-port-mcp1a` | PASS (14 real files judged; 243 text and 83 behavioural mutations killed), exit 0 |
| `val-projectos-connector-contract1a` | PASS (38 rules; 293 named mutations killed), so CC-25 stands |
| `validate-no-secrets` | PASS |
| Validators reading a touched file, re-run in round 1 | 19 validators, each its own process, **all exit 0**: `val-projectos-port-{credit1a,mcp1a,search1a,memory1a,skills1a,context1a,approvals1a}`, `val-projectos-connector-contract1a`, `validate-no-secrets`, `val-projectos-tenant-{contract1a,credentials1a,principal1a,csp1a,rls1a}`, `val-projectos-kernel-followup1a`, `val-projectos-validator-scratch-lifecycle1a`, `val-projectos-v3-validation-evidence1a`, `validate-speed-validation-cache`, `validate-v2-closure-evidence`. `val-projectos-port-credit1a` first failed with PC-24 on the uncommitted `canonicalJson.ts` (it refuses an untracked port file) and passed once committed: PASS (74 real files judged; 152 fixture and 59 record mutations killed) |
| `validate-all` | not run: the lead runs it serially |

**`test/tenantSidecar.test.ts`, the one failing agent file.** Its `beforeAll` runs the real `tsc -p projectos/agent/tsconfig.json`, and that
failed. On `d443a0fa` the same test passes: a scratch `git archive` of the base, with the same `node_modules` junctions, ran
`npx vitest run test/tenantSidecar.test.ts` to **10 of 10 passed** (241 s). On this branch, stock `tsc -p tsconfig.json --noEmit` reports 26
diagnostics, every one in `src/mcpConnectors/` (20 in `connector.ts`, 4 in `rpcClient.ts`, 2 in `ports.ts`), because the agent's
`@projectos/core` resolves through the junction to the `host-review-path1b` core, which has no `mcpConnectors` exports. This phase did not
break it and nothing outside `mcpConnectors/` changed: it is alias-induced. The same files typecheck clean (exit 0) against this
worktree's core. In a checkout whose agent resolves its own core, after a core build, the stock command and this test are expected to
pass; I could not prove that here without changing a junction, which I was told not to do.

**Agent tests and build, and the junction.** `projectos/agent/node_modules` is a junction to the `host-review-path1b` worktree, and
its `@projectos/core` resolves to that worktree's core, not this one. So `npx vitest run` and `npm run -s build` in
`projectos/agent`, as shipped, read a core without `mcpConnectors` and fail on this phase's imports (`TS2305: no exported member
'admitServer'` and the like). I did not touch the junctions. As in the search phase, the agent run used a scratch config that aliases
`@projectos/core` to this worktree's `core/src/index.ts`, and the typecheck a scratch tsconfig mapping it to this worktree's
`core/dist`:

```js
export default {
  root: 'C:/dev/ProjectOS-worktrees/port-mcp1a-v136/projectos/agent',
  resolve: { alias: { '@projectos/core': 'C:/dev/ProjectOS-worktrees/port-mcp1a-v136/projectos/core/src/index.ts' } },
  test: { include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
};
```

After a merge and a core build in the main checkout, the plain commands work there.

## Converge (B9)

**Against the phase spec (`docs/projectos-finish-phases.json`) and the approved delta, row 6.**

| Required | Built |
|---|---|
| MCP client lifecycle behind an injected spawn port | Lifecycle ported (`sessionLifecycle`), client original (`rpcClient`, `connector`), `SpawnPort` injected; the only implementation is a test fake |
| Hermes per-tool cost, scope, sampling translated | `toolCosts`, `serverKeys`, `serverRequests` |
| Server allowlist pinned by hash | `allowlist` |
| Per-tool spend | `toolCosts`, enforced in `toolCall` and `connector` |
| Sampling off; elicitation to the owner queue | `serverRequests`, `connector` |
| Output untrusted | `untrustedOutput`, `contentBlocks` |
| On `connectorContract.ts`; zero live connectors; CC-25 stands | `toolCall` calls the contract's gate and receipt check; registry untouched |
| Lives in `mcpConnectors/`; `agent/src/mcp/` untouched | Yes, and hash-pinned |
| Unwired, no new dependency, no live network/shell | MC-19, MC-7, MC-5, MC-6 |

**Unbuilt requirements, or built short:**

1. **None of the spec's criteria is unmet.** The credit validator, red before the merge, passes after `86f18e23`. `validate-all` is the lead's and was not run by me.
2. **The OpenClaw MCP client is only partly ported.** The brief's sources hold a server and a relay, not a client; the lifecycle
   and content-block reading were ported, and the client is original. `src/agents/agent-bundle-mcp-*.ts` and `src/plugins/bundle-mcp.ts`
   (port map C15) were outside the brief's source list and unread.
3. **There is no real spawn port.** By design (no `node:child_process`), `SpawnPort` has only a fake. Starting a server is a later phase's act under the owner's gate for shell and service access. Round 1 wrote down what that port must meet (`SpawnConfinement`) and the two pins it must add (binary hash, argument schema); see "Review round 1".
4. **Requests now have a timeout** (round 1, M1), through an injected `TimerPort`. The default is 30 s for a request and 5 min for a wait on the owner, set by the caller.
5. **A window's spend is not durable.** The tally is a value the caller stores; with the start record (H3) the caller now has the booking and the totals in each record to rebuild it from. Until the Stage 4 and 5 ledger owns it, a restart forgets what was spent (`toolCosts.ts` says so).

**Added in round 1, beyond the first reading of the spec:** a descriptor pin per tool in the owner's row (`descriptorHash`, required), optional `callLimit` and `spendWindowMs` row fields, a start store port and a timer port the caller must supply, raw-line transport, and `SpawnConfinement`. These widen the rows an owner approves, so the allowlist file format gains a required field before anything has been approved with it; no file with the old format exists. **Behaviour drift from the spec, deliberately:** a tool the server offers but the row does not list is hidden, not merely refused
(spec says nothing); a tool with a declared cost of zero is a budget and runs, and an undeclared one does not (stricter than Hermes);
the envelope ceiling is checked in addition to the spend limit (the spec asks only for "a budget").

**PROTECTED files:** `git diff --stat d443a0fa` lists nothing under `docs/00_Baseline_State.md`, `agent/src/mcp/`,
`projectos/connectors/registry.json`, `core/src/connectorContract.ts`, closure authority, the owner floor, gatekeeper composition, write
grants, credential custody or the tenant and action registries. MC-18 pins `agent/src/mcp/*.ts` and `connectorContract.ts` by hash. The
only existing files touched are the five the write paths name: `core/src/index.ts` (one line), `THIRD_PARTY_NOTICES` (5 entries),
`validate-all.cjs` and `cached-runner.cjs` (registration, same position, before `connector-contract1a` because that validator pins
itself as the last entry), and the new files.

## Review round 1

Two independent reviews of `d7fbea07` agreed. Every item below was written test first (the failing test, then the fix), has a
named mutation in the validator named after the rule body, and was killed by its own rule. Changes stay in `mcpConnectors/`,
its tests, the validator and this doc.

| # | Finding | Status | Fix | Test | Rule: mutation |
|---|---|---|---|---|---|
| H1 | A row for tenant A could name tenant B's connector, and B's own envelope passed the gate | **Fixed** | `toolCall` compares the server's key tenant, its manifest tenant, the envelope tenant and the connector's tenant, and refuses `TENANT_MISMATCH` before booking | `mcp-toolcall` "refuses a row for tenant A that names the connector of tenant B, even with an envelope of tenant B", and 3 more | MC-23: `the-tenant-is-taken-from-the-envelope` (behavioural), 4 text |
| H2 | A caller-chosen session key reset the spend limit; zero-cost tools were uncapped; no concurrency cap | **Fixed** | No session key. Spend is per tenant and server in a window (default a day, row field `spendWindowMs`), with a call cap that counts free calls (default 100, row field `callLimit`), and a clock that runs backwards opens no window. The connector caps calls in flight at 4. `transferSession` is removed with the thing it protected | `mcp-spend` rewritten; **the tests that pinned the per-session total and its rotation (`a session that continues under a new id keeps what it spent` and its siblings) are replaced** by "ignores a session key handed in", the window, the call cap and the backwards clock; `mcpConnector` "a new envelope, a new run or a new caller does not start a fresh budget" | MC-11: `a-window-never-ends`, `the-call-cap-is-ignored`, `a-free-call-is-not-counted`, `a-clock-that-runs-backwards-opens-a-window` and 7 more behavioural; a text rule refuses `sessionKey` in cost, call and connector code |
| H3 | `started` was returned but never stored before the send, and a doc comment said otherwise; no in-flight idempotency guard | **Fixed** | `mcpStartRecordOf` builds the record (started line, booked amount, window totals, a SHA-256 of the canonical arguments, none of the arguments). The connector awaits an injected `StartStorePort` before `tools/call`, and on a refusal or throw sends nothing and gives the booking back. A call whose idempotency key is in flight is refused, and so is a fifth concurrent call. The contradicting comment is replaced | `mcpConnector` "is stored, and awaited, before tools/call is sent", "does not send when the store refuses", "refuses a second call with the same idempotency key", "caps how many calls may be in flight"; `mcp-toolcall` and `mcp-canonical` for the record and digest | MC-24: `a-refused-start-is-sent-anyway`, `a-second-call-with-the-same-key-runs`, `any-number-of-calls-may-run-at-once`, `the-start-record-holds-the-arguments` (behavioural) and 9 text |
| H4 | A tool could change after the owner approved it (a rug pull); package runners could be launched | **Fixed** | Each tool in the owner's row carries `descriptorHash`, a hash of its description, input schema and annotations. At open, a listed tool that does not match is quarantined, not offered. On **every call** the live list is read again and the tool re-verified, refusing `TOOL_DESCRIPTOR_CHANGED` and giving the cost back. A `tools/list_changed` notice stops calls (`TOOLS_STALE`, and `tools()` is empty) until `refresh()` has read and verified the list again. Launch commands that are package runners or unpinned are refused (M3 below) | `mcp-canonical`; `mcpConnector` "the tool descriptor pin: a rug pull is refused (H4)" (7 tests) | MC-25: `a-changed-descriptor-is-offered`, `the-live-list-is-not-read-on-a-call`, `a-list-changed-notice-is-ignored`, `a-stale-list-is-called`, the three `the-descriptor-hash-leaves-out-...`, `a-hostile-schema-is-read-without-a-bound`, and 14 text |
| M1 | No timeouts; a failed send left a pending entry; the size cap was applied after parse | **Fixed** | An injected `TimerPort`. Every request has a timeout; one that is not answered ends as `outcome_unknown` with its cost booked, and releases the close's drain. A pending wait on the owner times out as a cancel, and a close ends it. A send that throws at once or rejects later removes its entry and timer. The transport now delivers raw lines, and a line over 1 MiB, counted in **bytes**, is dropped before `JSON.parse` | `mcpRpcClient` (timeouts, byte cap with a `JSON.parse` spy, a multi-byte line, both send failures, timer cancelled on reply, a late reply); `mcpConnector` "timeouts (M1)" | MC-26: `a-request-has-no-timeout`, `a-large-line-is-parsed`, `the-cap-counts-characters-and-not-bytes`, `a-settled-request-keeps-its-timer`, `a-failed-send-leaves-its-request`, `a-throwing-send-escapes-the-request`, `an-owner-wait-has-no-timeout`, `a-finished-call-keeps-its-key`, 11 text |
| M2 | Elicitation: heard with no call in flight, secrets, malformed requests free, unlimited concurrent answers, loose answers, window lost on reopen | **Fixed** | Heard only while a call is in flight; a form asking for `password`, `passwd`, `secret`, `token`, `api key`, `credential` or `private key` by name is refused; every elicitation request, bad or unprompted, takes a place in the window; at most 2 answers pending; an accept must cover **every** asked field, as typed and within the enum the server named; the rate window is the caller's `Map`, keyed by server, so a reopen is no new allowance | `mcp-requests` (7 new cases); `mcpConnector` "what a server asks of the client" | MC-27: nine behavioural, e.g. `an-unsolicited-elicitation-is-heard`, `a-form-may-ask-for-a-secret`, `any-number-of-answers-may-wait`, `the-window-starts-again-on-a-reopen`; 13 text |
| M3 | Manifest hygiene | **Fixed**, with one note | The repo's own `holdsSecretShape` (`context/redact`) runs over the command and every argument. Denied environment names: `PATH`, `PATHEXT`, `COMSPEC`, `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`, `PYTHONPATH`, `PYTHONHOME`. Control and format characters (`Cc`, `Cf`, so bidi overrides and zero-width spaces) and `^ % & \| ( )` are refused in the command and arguments. Refused launches: `npx`, `npm`, `pnpm`, `pnpx`, `yarn`, `bunx`, `bun`, `uvx`, `uv`, `pipx`, `deno`; an interpreter with no script or with `-e`, `-c`, `-p`, `--eval`, `/c`, `-Command` and the like; `-y`, `--yes`, `@latest`, `@next`. **Note:** the manifest holds environment *names* only, never values, by design, so there is no env value to scan here; the future spawn port gets values from custody and must scan them (M4) | `mcp-allowlist` "manifest hygiene (M3)" (35 cases) | MC-28: seven behavioural and 13 text |
| M4 | The spawn port's confinement requirements | **Fixed as types and prose; implementation deferred by design** | `SpawnConfinement` is a type the connector hands to `SpawnPort.open`, and the port's doc names each requirement: a scrubbed environment (no parent inheritance), a working directory the port owns, a line cap before any parse, bounded stderr, resource limits (time, memory, one process). No implementation | the `MC-29` behavioural probe checks what `open` is given | MC-29: `the-spawn-port-is-called-without-its-limits`, `the-environment-is-inherited`, 16 text (the type fields and each phrase of the contract) |

**Carried forward to the phase that writes the real spawn port (M4), not built here:**

1. A **binary-content hash pin** for `manifest.command`. The manifest hash covers the path, not the bytes, so a replaced binary at the same path still hashes the same. The port must refuse a file whose SHA-256 is not the one the owner pinned.
2. An **argument schema per row** of the owner's allowlist, so a call's arguments are checked against what the owner approved and not against the server's own schema of the day (which the descriptor hash pins only as text).
3. Every item of `SpawnConfinement`, **proved**: a test that the child sees none of the parent's environment, runs in a directory the port made, has a line dropped at the cap with no parse, has stderr cut at the bound, and is killed at its limits.
4. A scan of the environment **values** from custody with `holdsSecretShape` is not wanted (a credential is expected there); the rule is instead that a value comes only from custody for a name in `envNames`.
5. The owner-queue implementation must show `untrustedMessage` as quoted text and expire items it is not answered, as `ports.ts` says.

**Not done, and why.** Nothing from the round was deferred except the M4 implementation and the two pins above, which need a real
spawn. The per-call re-list narrows the rug-pull window to the gap between the list and the send; it does not close it, because a
server can still change a tool in between. That gap is the residual of any check made by asking the server.

## Review findings carried to the reviewers

- **The tally lives in the caller.** `reserveToolSpend` returns a new tally; a caller that drops it has booked nothing. The durable ledger must store `started` and the tally together, or a crash forgets both.
- **A server's JSON-RPC error keeps the cost booked.** The server may have spent before it refused, so the cost stays as a ceiling. Only a call that never left is refunded.
- **`outcome_unknown` on a lost reply is never retried by this module.** The contract's retry rule decides, through the history the caller keeps.
- **The receipt's `provider:mcp-reply:` marker is the transport's word.** MCP gives no provider receipt. The marker says the server answered, with a 16-character digest of the reply, and is no evidence that the tool did what it said.
- **A fence labels text; it does not make a model obey.** What protects ProjectOS is that a model's output reaches nothing without the kernel's gates. `renderUntrustedToolOutput` has no caller yet.
- **`ownerQueue.enqueue` must show the message as quoted text.** `untrustedMessage` is the server's words; nothing in this module can stop a UI rendering it as a button label.

## Residuals

- No real spawn (above). The wait on the owner now times out and a close ends it, but the owner-queue implementation must still expire its own items.
- The per-call re-list narrows the rug-pull window to the gap between the list and the send. A server can still change a tool in that gap.
- A descriptor hash pins what a tool says; it does not prove what the tool does.
- `agent/src/mcp/oauth` handles the *owner bridge's* OAuth. A third-party server's OAuth, and its tokens, are G-CUSTODY work for a later phase; this phase passes only environment-variable *names* through the manifest.
- Dependencies of the connector contract's `CONNECTOR_ID` (`[a-z][a-z0-9-]{1,63}`) and the tool-name pattern here (`[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`) are separate rules; a tool whose real name has other characters is refused rather than mapped.
- The `optional-mcps` catalogue (Hermes, 56 manifests) was not read. The port map says it is data only, and the allowlist is hand-approved.
- The behavioural copy is not the build. It runs under type stripping, with imports rewritten and a local shim for `@projectos/core`. `tsc` and the suites cover the real build.
- `validate-all` runs this validator in about two minutes; most of that is its 83 behavioural mutations, each a fresh process.

## Commits

`d65df10f` core, `97a4a1d7` agent, `5b19d29c` validator, `2667d147` wip (paused), `192e53b4` merge of the shared credit-dirs commit `86f18e23`, `d7fbea07` finish record, `d2993545` review round 1 code, tests and validator, then the commit of this doc.

## Final state

Review round 1 is answered on this branch (not pushed or merged, phase not closed). The one recheck is the lead's call.

- **Seen to pass:** core tests (65 files, 3102) and build; this phase's agent tests (67) and the agent typecheck through the alias; `val-projectos-port-mcp1a` (243 text, 83 behavioural); 19 validators, all exit 0, including `val-projectos-port-credit1a` after the commit and CC-25.
- **`tenantSidecar.test.ts`:** as in round 0, junction-induced (passes on base); the stock agent typecheck now shows 33 diagnostics, all in `src/mcpConnectors/`.
- **Not run:** `validate-all` (the lead's); the full agent suite in round 1; the stock agent build and suite against a core that resolves to this worktree.
- **Left:** the recheck, the real spawn port with its two pins, the durable ledger and the owner-queue implementation.
