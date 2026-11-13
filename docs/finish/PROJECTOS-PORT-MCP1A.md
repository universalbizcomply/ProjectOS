# PROJECTOS-PORT-MCP1A — governed MCP connectors on the connector contract (C15)

**Phase:** PROJECTOS-PORT-MCP1A, delta phase 12 / plan v1.36 row 6 (`docs/changes/delta_spec.md`), V4 Stage 3.
**Branch:** `projectos-port-mcp1a`, worktree `C:/dev/ProjectOS-worktrees/port-mcp1a-v136`, base `d443a0fa`. Not pushed, not
merged, phase not closed, no phase record created. `docs/06_Plan.md` is not edited.
**State:** built and self-reviewed by the implementer only. ECC SECURITY and the Agency `application-security-engineer`
review have not seen it. `val-projectos-port-credit1a` is red on this branch for one reason outside this phase's write
paths, and a tested patch is held beside this file. See "Credit result".

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
| Ported, core | `projectos/core/src/mcpConnectors/{serverKeys,toolCosts,serverRequests,contentBlocks,sessionLifecycle}.ts` | Five files from five upstream files, each credited |
| Original, core | `projectos/core/src/mcpConnectors/{allowlist,toolCall,untrustedOutput,index}.ts` | The pin, the gate, the fence, the seam |
| Original, agent | `projectos/agent/src/mcpConnectors/{ports,rpcClient,connector,index}.ts` | Ports, a JSON-RPC client, one governed connection |
| Export | `projectos/core/src/index.ts` | One line |
| Notices | `THIRD_PARTY_NOTICES` | 5 entries, written by script from each file's own header |
| Tests | `projectos/core/test/mcp-{allowlist,spend,requests,toolcall,lifecycle}.test.ts`, `projectos/agent/test/mcp{Connector,RpcClient}.test.ts` | 133 core, 35 agent |
| Validator | `projectos/validators/val-projectos-port-mcp1a.cjs` | 22 rules plus MC-T, 152 text and 42 behavioural mutations; registered in `validate-all.cjs` and `speed/cached-runner.cjs`, same position |
| Patch, not applied | `docs/finish/PROJECTOS-PORT-MCP1A.credit-dirs.patch` | The credit-directory change this phase needs, outside its write paths |

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
| Credit header and notices entry on every ported file; the credit validator passes | Headers on 5 files, 5 notices entries, MC-2 and MC-4. **The credit validator is red on this branch until the held patch is applied.** See next section |
| The validator refuses any importer outside the module and its tests | MC-19 scans every other source file under `projectos/` by path (`mcpConnectors`) and by exported name, so an importer through the package barrel is caught. The one allowed line is the core barrel's own. Two mutations add an importer |
| Validator pin and named mutations, each killed by its own rule | 194 mutations (152 text, 42 behavioural), each named after the rule body. A mutation counts only if its rule fires and no rule it did not declare |

## Credit result: red on this branch, green with a patch outside this phase's write paths

`val-projectos-port-credit1a` on this branch: **FAIL, 5 errors**, all `PC-16 … it is outside the port directories`, one per ported
file. The credit validator judges only the directories in its `PORT_DIRS`, ADR-P1 §7 lists the same directories (PC-17 keeps them equal),
and a file with a `Ported-From:` header outside them is refused. `mcpConnectors/` is not in either, and the delta names no step
that adds it. Adding a port directory is, in ADR-P1's words, "a listed, reviewed change, made here and in the validator together".
**Both files are outside this phase's write paths, so I did not edit them.**

**The fix, named (FIX IT, OR SAY THE FIX):** three small edits, held as `docs/finish/PROJECTOS-PORT-MCP1A.credit-dirs.patch`
(`git apply --check` passes on this branch):

1. `projectos/validators/val-projectos-port-credit1a.cjs`: add `projectos/core/src/mcpConnectors` and `projectos/agent/src/mcpConnectors` to `PORT_DIRS`.
2. Same file, PC-17's regex: `src\/[a-z]+` becomes `src\/[A-Za-z]+`. **The first two edits are not enough**: the directory name has a capital C, and the regex that reads ADR-P1's list would not see the new bullets.
3. `docs/adr/ADR-P1-port-ownership-and-credit.md` §7: the two directories as bullets.

**Rehearsed, with no branch touched:** `git archive` of `d443a0fa`, this branch's files laid over it, a scratch repository, the patch
applied:

```text
before the patch: val-projectos-port-credit1a: 5 error(s)   (PC-16 x5, outside the port directories)
after the patch:  val-projectos-port-credit1a: PASS (73 real file(s) judged; 149 fixture and 59 record mutations killed)
```

Who acts: the lead, with the owner's word because ADR-P1 is an approved record. Cost: apply the patch and re-run the credit
validator. It touches no authority record.

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
| MC-1 listing, MC-3 origin mark, MC-4 credit, MC-7 dependencies, MC-22 tracked | 2, 2, 1, 2, 1 | 0 |
| MC-2 upstream record | 4 | 0 |
| MC-5 core purity, MC-6 connector reach | 4, 4 | 0 |
| MC-8 the pin | 11 | 3 |
| MC-9 sampling off | 5 | 3 |
| MC-10 owner answers | 13 | 5 |
| MC-11 spend | 14 | 6 |
| MC-12 output is data | 21 | 6 |
| MC-13 gate order | 10 | 3 |
| MC-14 connector contract | 10 | 3 |
| MC-15 session close | 17 | 10 |
| MC-16 install route | 7 | 3 |
| MC-17 refused features, MC-18 protected files, MC-19 unwired, MC-20 exported, MC-21 registered, MC-T tests | 3, 2, 2, 12, 3, 2 | 0 |
| **Total** | **152** | **42** |

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
| Tests first | The five core test files and the agent connector test were written against a module that did not exist. With `src/mcpConnectors` moved aside, `npx vitest run test/mcp-` failed all 5 files at import ("Failed to load url ../src/mcpConnectors/index.js"). The connector was then written, so the agent connector's RED run is the same fact in a weaker form: the agent test did not exist before `connector.ts`, an order slip, recorded rather than hidden. Four tests failed on the first agent run and were fixed in code |
| Core `npx vitest run` | 64 files, **3015 tests passed** (the five new files are 133 of them) |
| Core `npm run -s build` | exit 0 |
| Agent tests | see below: `npx vitest run` as shipped cannot see this phase's core |
| Agent typecheck | exit 0 through a scratch tsconfig mapping `@projectos/core` to this worktree's `core/dist` (stock `npm run -s build` cannot, see below) |
| `val-projectos-port-mcp1a` | PASS (13 real files judged; 152 text and 42 behavioural mutations killed) |
| `val-projectos-connector-contract1a` | PASS (38 rules; 293 named mutations killed), so CC-25 stands |
| `validate-no-secrets` | PASS |
| `val-projectos-port-credit1a` | FAIL, 5 errors, outside this phase's write paths; PASS with the held patch (rehearsal above) |
| `validate-all` | NOT RUN (paused before shutdown) |

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

1. **The credit validator does not pass on this branch.** The phase's own criterion 5 needs two files outside its write paths. A tested
   patch is held and the fix is named above. This is the one requirement I could not meet inside the phase.
2. **The OpenClaw MCP client is only partly ported.** The brief's sources hold a server and a relay, not a client; the lifecycle
   and content-block reading were ported, and the client is original. `src/agents/agent-bundle-mcp-*.ts` and `src/plugins/bundle-mcp.ts`
   (port map C15) were outside the brief's source list and unread.
3. **There is no real spawn port.** By design (no `node:child_process`), `SpawnPort` has only a fake. Starting a server is a later phase's act under the owner's gate for shell and service access.
4. **Requests have no timeout.** A server that never answers leaves a request pending until the connection is closed. A timer is not allowed in core and the connector holds no clock port for it. Carried.
5. **A session's spend is not durable.** The tally is a value the caller stores. Until the Stage 4 and 5 ledger owns it, a restart forgets what was spent (`toolCosts.ts` says so).

**Behaviour drift from the spec, deliberately:** a tool the server offers but the row does not list is hidden, not merely refused
(spec says nothing); a tool with a declared cost of zero is a budget and runs, and an undeclared one does not (stricter than Hermes);
the envelope ceiling is checked in addition to the spend limit (the spec asks only for "a budget").

**PROTECTED files:** `git diff --stat d443a0fa` lists nothing under `docs/00_Baseline_State.md`, `agent/src/mcp/`,
`projectos/connectors/registry.json`, `core/src/connectorContract.ts`, closure authority, the owner floor, gatekeeper composition, write
grants, credential custody or the tenant and action registries. MC-18 pins `agent/src/mcp/*.ts` and `connectorContract.ts` by hash. The
only existing files touched are the five the write paths name: `core/src/index.ts` (one line), `THIRD_PARTY_NOTICES` (5 entries),
`validate-all.cjs` and `cached-runner.cjs` (registration, same position, before `connector-contract1a` because that validator pins
itself as the last entry), and the new files.

## Review findings carried to the reviewers

- **The tally lives in the caller.** `reserveToolSpend` returns a new tally; a caller that drops it has booked nothing. The durable ledger must store `started` and the tally together, or a crash forgets both.
- **A server's JSON-RPC error keeps the cost booked.** The server may have spent before it refused, so the cost stays as a ceiling. Only a call that never left is refunded.
- **`outcome_unknown` on a lost reply is never retried by this module.** The contract's retry rule decides, through the history the caller keeps.
- **The receipt's `provider:mcp-reply:` marker is the transport's word.** MCP gives no provider receipt. The marker says the server answered, with a 16-character digest of the reply, and is no evidence that the tool did what it said.
- **A fence labels text; it does not make a model obey.** What protects ProjectOS is that a model's output reaches nothing without the kernel's gates. `renderUntrustedToolOutput` has no caller yet.
- **`ownerQueue.enqueue` must show the message as quoted text.** `untrustedMessage` is the server's words; nothing in this module can stop a UI rendering it as a button label.

## Residuals

- No real spawn, and no timeouts (above). A consequence worth a reviewer's eye: an elicitation the owner never answers stays pending, and the rate limit (5 a minute) bounds how fast they pile up, not how many. The owner-queue implementation must expire its items and answer `cancel`.
- `agent/src/mcp/oauth` handles the *owner bridge's* OAuth. A third-party server's OAuth, and its tokens, are G-CUSTODY work for a later phase; this phase passes only environment-variable *names* through the manifest.
- Dependencies of the connector contract's `CONNECTOR_ID` (`[a-z][a-z0-9-]{1,63}`) and the tool-name pattern here (`[A-Za-z0-9][A-Za-z0-9_.-]{0,63}`) are separate rules; a tool whose real name has other characters is refused rather than mapped.
- The `optional-mcps` catalogue (Hermes, 56 manifests) was not read. The port map says it is data only, and the allowlist is hand-approved.
- The behavioural copy is not the build. It runs under type stripping, with imports rewritten and a local shim for `@projectos/core`. `tsc` and the suites cover the real build.
- `validate-all` runs this validator in about a minute; most of that is its 42 behavioural mutations.

## Commits

`d65df10f` core, `97a4a1d7` agent, `5b19d29c` validator, then the wip commit that holds this doc and the held patch.

## PAUSED STATE

Paused on the lead's word before shutdown. Nothing was started after it.

**Passed, seen:** core `npx vitest run` (64 files, 3015 tests) and core build exit 0; `val-projectos-port-mcp1a` PASS (152 text, 42 behavioural); `val-projectos-connector-contract1a` PASS (CC-25); `validate-no-secrets` PASS; agent typecheck exit 0 (scratch tsconfig); credit patch rehearsed green in a scratch repo.

**Agent full suite (alias config): exit 1.** 110 of 111 files passed, 3449 tests passed, 10 skipped. The one failing file is `test/tenantSidecar.test.ts` (a file-level failure, "FAIL ... [ test/tenantSidecar.test.ts ]"); its cause was not read and it is not one of this phase's files. Unknown whether it fails on the base too.

**Not run:** `validate-all`; the agent suite on base to settle `tenantSidecar`; `val-projectos-port-credit1a` after the patch (red, 5 errors, until the lead applies it).

**Left:** read why `tenantSidecar.test.ts` failed; run `validate-all`; the lead applies the credit patch; ECC SECURITY and Agency review.
