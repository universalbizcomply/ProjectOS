# PROJECTOS-PORT-AGENTS1A: agent records, routes, delegation, messages and queue-state rules

Plan v1.36 phase 3 of the port group (delta row 3, C7 and C12). Branch `projectos-port-agents1a`, worktree
`C:/dev/ProjectOS-worktrees/port-agents1a-v136`, built on the reviewed providers branch and the shared credit-directories
commit. Status: built and committed on the branch. Not pushed, not merged, not closed: closure is the owner's.
`docs/06_Plan.md` is not edited.

## What this phase delivers

Pure core, no queue and no dispatcher. An agent is a well-formed record, and a task or a message moves between agents
only by rules over data:

- an **agent record** that names a plan decision and no tenant: the tenant, domain and project are stamped from a binding
  only `resolveTenant` can produce, grants are an allowlist of words, and delegation and messaging are off unless the record
  says so,
- an **agent book** keyed by tenant, project and agent id, that never overwrites and never evicts,
- **routing** (OpenClaw's order: peer, parent peer, wildcard peer, guild with roles, guild, team, account, channel, default)
  re-keyed on the tenant and project, with session keys that start with both,
- **delegation**: a child never holds more than its parent (grants, tenant, domain, project, environment, scope, budget,
  expiry, class), never a P5 action, never past the depth, fan-out, concurrency or size caps, and never in a cycle; the depth,
  the counts and the reserved budget are the book's and have no field in a request, a root is only the envelope the kernel's
  own door admitted, and a lapsed delegate keeps its slot until an owner-form record that a port verifies releases it,
- **messages** between agents of one tenant and project, off until the sender's record lists the recipient, enveloped through
  `checkChildEnvelope`, at P2 or below, spending nothing, handed on as untrusted data; the sender is the run the delegation
  book holds for the envelope id, never an agent id the request states,
- **queue-state rules** (claim, renew, complete, pause, resume, cancel, crash recovery, a resolution of an unknown item that
  is bound to the item and verified by a port, restore) as pure functions the workforce dispatch can adopt in a later stage;
  every move states the revision it expects.

Nothing outside this module and its tests imports it, except the one `export *` line in the core barrel.
The workforce dispatch stays the only queue: `agent/src/workforce/` is not changed.
The validator refuses a queue store, a timer, a loop or a dispatcher in this directory.
No gate was loosened or replaced. No dependency was added: `core` stays dependency-free.

## Existing code found (Code Bible B1, before any file was written)

Searched `core/src` and `agent/src` for agents, delegation, routing, queues, leases, messages, envelopes and the registry.

| Found | Where | What this phase did with it |
|---|---|---|
| `checkChildEnvelope`, `parseEnvelope`, `envelopeExpired`, `deriveIdempotencyKey`, rules R1 to R5 | `core/src/taskEnvelope.ts` | **Reused, not redefined.** Every child and every message envelope is judged by `checkChildEnvelope` against the parent the book holds. A message key is `deriveIdempotencyKey`. The file is unchanged |
| `resolveTenant`, `isDerivedBinding`, `TenantBinding`, `isTenantId`, `isProjectId` | `core/src/tenant.ts` | The tenant, domain and project of every record, binding, item and key come only from a derived binding. Unchanged |
| `resolveAction`, `classAtMost`, the registered classes (P5 is the owner's) | `core/src/actionRegistry.ts`, `security/action-registry.json` | A delegate's class is looked up in the registry and is at most P3. A message is at most P2. Nothing was added to the registry |
| The workforce dispatch: leader generations and leases, the closed `GRANTABLE_TOOLS`, `maxParallel`, `retries`, an event store | `agent/src/workforce/` (leader, dispatch, eventStore, types) | Read only. It is the one queue. It has no pause, resume or crash-recovery rule and no delegation depth, so the rules here are shaped to be adopted by it in Stage 4, and nothing here replaces or duplicates its store. The grant vocabulary here is words, not its closed list, because core cannot import the agent |
| Orchestration and workers | `core/src/orchestration.ts`, `workers.ts` | Different concerns: phase workflow and worker roles. Unchanged |
| Connector retry and attempt vocabulary, the model broker's per-key attempt store | `core/src/connectorContract.ts`, `core/src/modelBroker/` | Read, not reused: they count attempts of a call, not of a queue item |
| The routines port's record reader, idempotency key and fatigue rules | `port-routines1a-v136` (read only, for shape) | The shape followed: a record that names a plan decision, a frozen branded result, no getters, a scope key |
| The search and providers ports' validators and finish records | `val-projectos-port-search1a.cjs`, `val-projectos-port-providers1a.cjs` | The shape followed: pure core, credit headers, behaviour run against the real source, named mutations |

Everything this phase touched is inside the approved rows: `core/src/agents/`, `core/src/index.ts`, `core/test/`,
`THIRD_PARTY_NOTICES`, this phase's validator, the two registration lists and `docs/finish/`.
The shared commit `86f18e23` lists this directory in the credit validator and ADR-P1 section 7, so this phase edits neither.

## Ported files

Every ported file carries its credit header and a `THIRD_PARTY_NOTICES` entry (OpenClaw files also credit pi-mono). The pins
are the commits inside the owner's downloads of 2026-11-01: OpenClaw `c5b56f2505c4f6a5803125d2923e2934c5f750af`, Hermes
`d3e586881eacb132595edcbe4c170be8381e40c5`.

| ProjectOS file | Upstream | Source path | Licence | Strategy |
|---|---|---|---|---|
| `core/src/agents/sessionKey.ts` | OpenClaw | `src/routing/session-key.ts`, `src/routing/account-id.ts` | MIT | ADAPT |
| `core/src/agents/bindingScope.ts` | OpenClaw | `src/routing/binding-scope.ts` | MIT | DIRECT |
| `core/src/agents/routeResolve.ts` | OpenClaw | `src/routing/resolve-route.ts` | MIT | ADAPT |
| `core/src/agents/delegationToolsets.ts` | Hermes Agent | `tools/delegate_tool_toolsets.py` | MIT | TRANSLATE |
| `core/src/agents/delegationTasks.ts` | Hermes Agent | `tools/delegate_tool_tasks.py` | MIT | TRANSLATE |
| `core/src/agents/queueState.ts` | Hermes Agent | `tools/async_delegation.py` | MIT | TRANSLATE |

Original ProjectOS code, marked `// Origin: original ProjectOS code`: `agentRecord.ts`, `agentBook.ts`, `routeBinding.ts`,
`delegation.ts`, `messages.ts`, `clockGuard.ts`, `plainRecords.ts`, `delegationLimits.ts`, `index.ts`. `openbot-lower`
(nightly-labs, PolyForm Noncommercial) was never opened. No xAI or Grok path exists. Vendor folders were read only, and
nothing was installed or run from them.

## What changed from the sources, and what was refused

- **OpenClaw shares one session across all direct messages by default and routes any agent to any other.** Here every
  session key starts with the tenant and the project, each direct peer has its own session, and a part that holds a colon is
  refused so no part can forge another tenant's prefix. Messaging between agents is off until the sender's record lists the
  recipient, and cross-tenant access is never a message.
- **OpenClaw reads its bindings from a config object and caches them.** Cut. A binding is admitted from a plain record, is
  stamped with the tenant and project of a derived binding, and names none of its own. One for another scope refuses the
  whole call, and an agent the tenant does not hold is refused rather than replaced by another. A peer with an unknown kind
  or a bad id refuses the binding when it is written; the source skips it.
- **Hermes children inherit a toolset list minus a denylist, and a request for a toolset the parent lacks is silently
  dropped.** Here a child states its grants as an allowlist, and a grant the parent lacks, a blocked grant (the source's
  list is kept word for word) or a grant the child's own record lacks is refused by name.
- **Hermes lets the configured depth have no ceiling and runs a depth-derived orchestrator role.** Here the depth, the
  fan-out, the live count and the size of the book are named constants with no field to raise them, the depth is derived from
  the parent's node, and a delegate at the cap cannot delegate.
- **The source's recovery rule is the one taken from `async_delegation.py`:** a delegation still running whose owner is gone
  is classified outcome unknown and is not re-dispatched by the rule. The SQLite ledger, the owner process probe, the
  threads, the orphan sweep and the delivery claims were not ported. The owner being gone is a lease that ends by an injected
  clock.
- **Not ported:** Hermes `delegate_tool_child_run.py`, `delegate_tool_dispatch.py`, `async_delegation_worker.py` (they run
  children and threads), the worktree and redaction helpers, OpenClaw `src/agents/subagents/` and `sessions-spawn` (coupled
  to the Gateway session controller, reference only), and OpenClaw's pairing. Nothing here spawns anything.

## Refusals, and the rule each is held by

| Refusal | Rule |
|---|---|
| A grant the parent lacks, a grant the child's record lacks, a blocked grant, a repeated grant | AG-1 |
| A child in another tenant, domain, project or environment, with a scope, expiry or budget above its parent's, or that is not an envelope | AG-2 (`checkChildEnvelope`) |
| A parent the book never saw (never taken for a root), a parent in another tenant with the same envelope id | AG-2, AG-3 |
| A delegate past the depth cap, a depth stated by the request, a child envelope registered again as a root, a root twice | AG-3 |
| A parent whose record does not say it may delegate, a delegate to an agent already in the chain, a child agent another tenant holds | AG-3 |
| A sixth child of one parent (finished ones count), an eleventh live delegate in a project, a 61st node | AG-4 |
| A child that does not fit in what the parent has left; a finished child's budget given back | AG-5 |
| A P5 child, an unregistered action (reads as P5), a P4 child | AG-6 |
| A message naming another tenant or project, a recipient of another tenant, one not on the allowlist, to oneself, above P2, with a budget | AG-7 |
| A message from a run the delegation book does not hold for this tenant and project, that has ended, or whose envelope expired; a sending agent stated by the request | AG-7 |
| A record that says an agent decided, names no decision, names its own tenant, holds a wildcard grant or a flag that is not a boolean | AG-8 |
| A lost item run again, an unknown item moved by anything but a record bound to it and vouched for by the port, a running item paused, a paused scope claimed, a fourth claim, a copy of an item, a stale revision | AG-9 |
| A child, message or root envelope that holds an accessor; a hand-built or copied root; a context that answers differently twice | AG-2, AG-3, AG-7 |
| A grant under another spelling of a blocked name; a message from a run without the `send_message` grant; a message id repeated, a reply to a message never received, a reply chain or a pair past its cap, a full ledger | AG-1, AG-7 |
| A parent's own spend ignored; an agent record changed under a running node; ending a parent that leaves live children | AG-3, AG-5, AG-11 |
| A snapshot nobody vouches for, or whose tree the rules could not have produced | AG-4 |
| A session key without the tenant, a colon in a part, a binding of another scope, an agent the tenant does not hold, more than 200 bindings | AG-10 |
| A failed delegate that keeps its slot, a lost delegate that gives its budget back or is forgotten | AG-11 |
| A delegate's output that is trusted, unbounded, or closes its own fence; a placeholder goal | AG-12 |
| A clock that runs backwards, is not whole, or throws | AG-21 |
| A timer, a store, a loop, a dispatcher or a clock of its own in this module | AG-13 |
| Any importer of the module outside its directory and tests, by name or by path | AG-14 |

## Acceptance criteria to tests

| Criterion | Tests |
|---|---|
| A child asking for a grant its parent lacks is refused; tenant, domain, project and environment equal the parent's through `checkChildEnvelope` | `agents-delegation.test.ts` "refuses a child that asks for a grant its parent lacks", "refuses a child in another tenant, with the envelope rule that decided it", "...another project of the same tenant", "...another domain", "...another environment" |
| Delegation past the depth cap, the fan-out cap, or the parent's remaining budget is refused | "refuses a delegate one level past the cap", "cannot be reset by a request that states its own depth", "admits the last child within the fan-out cap, and refuses the next, even after the others finished", "refuses a delegate past the live cap of a project...", "admits children up to exactly the parent", "refuses a child that does not fit in what remains" |
| A message to an agent of another tenant is refused; the same message within the tenant is admitted | `agents-messages.test.ts` "admits the same message within the tenant: the positive control", "refuses a message that names an agent of another tenant as its recipient", "refuses a message whose envelope is in another tenant, through checkChildEnvelope" |
| No child may delegate a P5 action | "refuses a P5 child of a P5 parent: the class check, not the envelope check, decides", "refuses a child whose action the registry does not list, which reads as P5", "admits a P3 child of a P5 parent" |
| The queue-state rules are pure; the validator refuses a queue store, timer or dispatcher | `agents-queue.test.ts` (every rule), validator AG-13 and its seven mutations |
| Credit headers and entries; the credit validator passes | AG-15; the credit validator passes (see Checks) |
| The validator refuses an importer outside the module | AG-14 and its four mutations |
| Validator pin and named mutations | See below |

## Mutations

Taken from the validator's own output, not from this document: see Checks. Every behaviour mutation is applied in memory to a
copy of the real source that Node compiles and runs, and counts as killed only when the scenario it names goes the wrong
way, by the rule and not by a crash. A refusal is killed only when the refused call now goes THROUGH: refused under another
name is a second defence behind the rule and proves nothing. Mutations are named after the rule body, for example
`the-parent-need-not-hold-the-grant`, `the-child-envelope-is-not-held-to-its-parent`, `the-depth-is-the-requests`,
`a-childs-budget-is-never-reserved`, `a-p5-child-is-delegated`, `a-lost-item-is-queued-again`,
`a-pause-covers-every-scope`, `the-fence-is-a-fixed-marker`, `a-node-is-keyed-by-envelope-id-alone`.

**Design choices the mutations forced.** Scenarios are built so each rule is the only thing standing in the way: a grant the
parent lacks is on the child's own record, a message to a recipient of another tenant is on the allowlist, a cross-tenant
message names the destination with an envelope that is in the right tenant, and so on. The tenant of a child is held by
`checkChildEnvelope` and by nothing else in the delegation, so removing that call frees the call. The pause cap and an agent
total cap were removed once they could not be killed: the set of scopes is bounded by the tenant registry, since only a
derived binding can be paused, and nothing is dropped from it.

## Design notes the reviewers should check

- **Depth, fan-out and budget are the book's.** A request has no field for them, and the request's extra fields change
  nothing. A delegate's depth is the parent's plus one, read from the parent's stored node, and a root is registered once from
  an envelope that has no parent.
- **Keys are tenant, project and id, everywhere:** the agent book, the node key, the live count, the node cap, the pause set,
  the session key and the message key.
- **A lost delegate or item is unknown for good.** A live delegate past its lease, or past its deadline, and a running item past its lease become unknown. A delegate keeps its slot and its budget stays reserved until an owner-form record, verified by the caller's port, releases the slot; a later "completed" does not erase it, and a result that arrives after the lapse is refused. Ending a node ends what is live beneath it. An item resolves only on a record bound to it and to the revision it was unknown at, vouched for by a port, and a requeue is refused once its attempts are used up.
- **`runDelegated` needs the caller's timer and releases the slot in a `finally`, and does not pass the work's error text on:** it is as untrusted as the output. With no timer the run is not started. At the deadline the answer is `LAPSED` while the work may still be running, so the node stays unknown and holds its slot.
- **The sender of a message is the book's.** A request names the envelope id of the run it comes from, and the sending agent,
  tenant, project and envelope are read from the node the delegation book holds, which must be live and unexpired. A request
  that names another agent changes nothing.
- **What is checked is what runs.** The context and the request are copied once into plain data, and the child, message
  and root envelopes are copied once by descriptor (an accessor in the envelope, its actor or its scope refuses the whole
  envelope), so what `parseEnvelope` and `checkChildEnvelope` judge, what is stored and what is delivered are the same plain
  data. The goal is stored on the node that the work is handed. (Round 1 found that the first version only copied the
  request: `parseEnvelope` validated a getter and then spread it again.)
- **The clock is injected, whole and not behind the latest time seen.** A clock that gives no time refuses every call.

## Residuals and what this module cannot prove

- A root is only the envelope object the kernel's door admitted (the module asks the kernel's own record, so a copy or a hand-built envelope is refused), and its class labels are checked against the registry as well.
  That the caller is the run an envelope id names is the wiring's: a caller that holds a valid envelope id is taken to be that run.
- Whether a verifier port is honest is the wiring's. The three ports (a resolution, a release, a snapshot) each answer exactly `true` or the record counts for nothing, and with no port every one of them is refused.
  A well-formed record that names a decision id is not an approval: whether the decision exists and is the owner's is for the port to look up in the committed plan-decision records.
- A finished delegate does not give its budget back, and neither does a failed or lapsed one: what it really spent belongs to
  the canonical budget adapter, which owns real spend. This module holds a parent's own recorded spend and its reservations
  for children against its budget, and nothing more.
- A pruned envelope id is remembered as a tombstone, so it cannot be admitted again (a spent root budget cannot be reset by registering the root again). A tombstone is dropped only once its envelope has expired, when it could not be admitted anyway, and a full set refuses to prune and forgets nothing. Deduplicating a task by its idempotency key is still the store's.
- The message ledger and the revision are only as durable as the caller makes them, and a revision is a compare-and-swap only
  if the store compares it. The per-pair and ledger caps are lifetime caps of one ledger, never decremented.
- Retry counting is not unified with the workforce dispatch's `maxAttemptsPerTask`: that is Stage 4 wiring.
- The budget ceiling of a run is the kernel's admission to own, not this module's: a root is the kernel's `run-start` envelope of the agent the kernel names as its actor, and whatever budget the door admitted is the ceiling. This module only keeps a delegate inside it.
- A forged unstarted queued copy of an item cannot be told from a real one without store authentication, which the wiring owns. Every other restore (a started, finished, paused or formerly unknown item) needs the store's verifier to answer exactly `true`.
- A message id is remembered only for the window, so one older than the window could be admitted again: the receiving queue deduplicates on the derived idempotency key.
- A restored item is only as trustworthy as the store it came from: the rules refuse an item they could not have produced,
  not one edited to a state they could.
- Delegation and queue state are in memory values; durable storage, the hash-chained event store and the adoption by the
  workforce dispatch are Stage 4.
- The agent's `@projectos/core` junction points at another worktree, so the agent's own typecheck was not run here (see Checks).

## Review round 1

Two independent reviews of head `574a6430`: ECC security-reviewer (block on H1) and Agency
`multi-agent-systems-architect` (concerns, three HIGH). Each item got a failing test first, the fix, and a named validator
mutation killed by its own rule.

| Item | What was wrong | The fix | Test, mutation |
|---|---|---|---|
| H1 | `parseEnvelope` checked an envelope field through its getter and then spread the same object, which read every getter a second time: a budget that answered 0 and then -1e15 sent the parent's reservation negative | `snapshotEnvelope` copies an envelope once by descriptor (the actor and the scope too), refuses an accessor anywhere, and only the plain copy is judged, stored and delivered; the context and the request are copied once; the same in `registerRoot` and `admitAgentMessage` | `agents-review1.test.ts`; `a-getter-envelope-is-read-twice`, `a-context-is-read-through-its-accessors` |
| H2 | `registerRoot` trusted a root on shape: a hand-built root with a budget of 10^12 was accepted | a root must be the envelope object the kernel's door admitted: the module asks the kernel's own record (`recordExecution` with a no-op recorder, which answers `true` only for an admitted envelope), nothing in the kernel was changed, and with no admission there is no root | `a-root-need-not-be-admitted` |
| H3 | an owner-form record was only a shape: any record, with no port and no binding, resolved any unknown item, and a store could restore a formerly unknown item as queued | the resolution is bound to the item id, tenant, project and the revision the item had while unknown, so it resolves one item once; a port must answer exactly `true`, with none the item stays unknown; the item remembers it was unknown, and a restore of a formerly unknown item needs its resolution, bound and verified | `a-resolution-need-not-name-the-item`, `-the-revision`, `an-unvouched-resolution-is-taken`, `a-formerly-unknown-item-needs-no-resolution` |
| H4 | `send_message` is a blocked grant but nothing read a node's grants, and a blocked name under another spelling passed | a message needs the run to hold `send_message`, which no delegate can; blocked names are matched with case, `-`, `_`, `.` and whitespace taken out, before the shape is judged | `a-message-needs-no-grant`, `a-blocked-name-is-matched-as-spelled` |
| M1 | a slow run could outlive its lease and still return `ok`, and its slot was freed by the lapse | `runDelegated` takes an injected timer (none: not started); a deadline marks the node unknown and answers `LAPSED`; a late result is refused; an unknown node keeps its slot until a verified owner-form release | `a-deadline-is-ignored`, `a-late-result-is-returned`, `a-lapsed-delegate-frees-its-slot`, `an-unvouched-release-is-taken` |
| M2 | no compare-and-swap, no lease renewal | every move bumps a revision and states the one it expects; a stale one is refused; a running item may renew its lease a bounded number of times | `a-stale-revision-is-taken`, `a-renewal-does-not-extend-the-lease`, `the-renewal-cap-is-nine` |
| M3 | no persistence, the 60-node cap was a lifetime cap | `exportDelegationBook` and `restoreDelegationBook` (verified, and held to the tree invariants); `pruneSettledDelegations` drops ended delegates but never a root or an unknown node | `an-unvouched-snapshot-is-restored`, `a-reservation-is-not-checked`, `pruning-drops-nothing`, `a-root-is-pruned` |
| M4 | ending a parent left live children | ending or lapsing a node marks everything live beneath it unknown, so an orphan cannot message | `ending-a-parent-leaves-its-children-live` |
| M5 | a parent's own spend was not held against its reservations | `recordDelegateSpend`; a child gets only what is left after the parent's spend. The canonical budget adapter owns real spend, and reservations are never returned here | `a-parents-spend-is-not-counted`, `spend-has-no-ceiling` |
| M6 | a swapped agent book could change what a run may do | a node pins the hash of its agent record, and a changed record is refused | `a-changed-record-is-taken`, `a-record-swapped-for-another-is-taken-as-the-same` |
| M7 | two agents could message each other for ever | a ledger records each message id once, the hop count of a reply chain is the ledger's and has a cap, one pair has a cap, and a full ledger refuses | `a-message-id-may-repeat`, `the-hop-cap-is-five`, `the-pair-cap-is-twenty-one`, `the-ledger-cap-is-forty-one` |
| LOW | a per-root cap, a cut surrogate pair, a node read at a time that cannot be trusted, mojibake in two comments | `MAX_LIVE_DELEGATES_PER_ROOT`; `delegateOutput` does not split a pair; `delegationNodeAt` answers nothing for a time that is not whole or is behind the book; the two registration comments now carry the same em dash as their neighbours. The default agent of a route comes from the book and is refused if this tenant and project do not hold it | `the-root-cap-is-nine`, `a-cut-may-split-a-pair`, `a-node-read-may-use-any-time` |

Deferred, in Residuals: the wiring proving that a caller is the run its envelope id names, and unifying the retry counter with
the dispatch's `maxAttemptsPerTask`.

## Review round 2

The recheck of `574a6430..bd37909a` closed H1 (accessors), F3, and F4 to F10, and raised six more. Each got a failing test first
(21 of the 23 new tests fail against the source of `bd37909a`), the fix, and a named validator mutation killed by its own rule.

| Item | What was wrong | The fix | Mutation |
|---|---|---|---|
| N1 | the verifier saw `raw` and the restore then read `top.nodes` again: a Proxy `nodes` array showed the honest graph to the verifier and a forged one (a root that had spent 0, not 400) to the restore | `deepSnapshot` copies the whole snapshot once, deeply, into frozen plain data (descriptor copy, no accessor, no symbol key, no odd prototype, `length` read once, bounded); the verifier is shown that copy and the book is built from it only. A restored delegate with a blocked grant is refused, as are a reservation past the budget, a negative spend, a cycle and a fan-out past the cap | `a-snapshot-is-read-again-after-it-is-verified`, `a-snapshot-accessor-is-read`, `a-restored-delegate-may-hold-a-blocked-grant`, `a-length-is-read-on-every-pass` |
| N2 | a timer that threw made `deadline` reject while the work still ran | the timer is called and checked before anything is admitted: one that throws, or returns no cancel function, means the run is not started. A deadline can no longer reject, and a cancel that throws changes nothing, so a lapsed-but-running node keeps its slot until the verified release | `a-throwing-timer-is-ignored`, `a-timer-without-a-cancel-is-taken` |
| N3 | after 60 roots a project was full for ever, and a pruned child's id could be admitted again | a whole ended subtree is pruned together, roots included, and each pruned id becomes a tombstone (exported and restored too): re-registering or re-admitting it is refused. Tombstones are bounded per project, dropped only when their envelope has expired, and a full set refuses to prune. A child whose own envelope has expired is refused | `a-root-is-never-pruned`, `a-pruned-root-may-return`, `a-pruned-child-may-return`, `an-unknown-descendant-does-not-block-pruning`, `the-tombstone-cap-is-three-hundred`, `an-expired-child-is-admitted` |
| N4 | the ledger caps never reset | each entry carries the injected-clock time it was admitted; the caps count only the last window (`MESSAGE_WINDOW_MS`), older entries are forgotten, and a clock behind the ledger is refused | `the-message-window-never-ends`, `a-ledger-clock-may-run-backwards` |
| N5 | the kernel proof said "some kernel admitted this", not whose run it was | a root is registered only for the agent its envelope names as the actor, and only if its action is the kernel's `run-start` (the action `mintCrossing` holds a crossing to; read in `taskEnvelope.ts`, which is not changed). The budget ceiling stays the kernel's admission to own. Two rules fell out: a kernel-admitted child can never be a `run-start`, so the separate "a child is not a root" check was dead code and is gone, and a parent that has expired has only expired children, so the separate parent-expiry check went too | `a-root-may-be-registered-for-any-agent`, `a-root-may-be-any-action` |
| N6 | a forged copy of a completed item restored as a fresh queued one | anything but an unstarted queued item that was never unknown needs the store verifier to answer exactly `true`; the verifier is shown the item. A forged unstarted copy cannot be told apart without store authentication, which the wiring owns | `a-finished-item-needs-no-vouching` |
| L1 | a hostile list could answer a new `length` on every read | `plainList` and the deep copy read `length` once | `a-length-is-read-on-every-pass` |

## Checks

Exit codes and counts are from the runs themselves, not from this document. `validate-all` was not run (the lead runs it).

```text
core: npm run -s build                      exit 0
core: npx vitest run                        72 files, 3251 tests passed (this phase: 8 files, 258 tests)
core: vitest --coverage on src/agents       99.59% lines, 93.03% branches, 99.18% functions
val-projectos-port-agents1a                 PASS (157 scenarios; 132 behaviour and 65 text mutations killed)
val-projectos-port-credit1a                 PASS (93 real files judged; 157 fixture and 59 record mutations killed)
validate-no-secrets                         PASS
val-projectos-connector-contract1a          PASS (reads validate-all and the runner lists)
val-projectos-kernel-followup1a, port-approvals1a, -context1a, -memory1a, -providers1a, -search1a, -skills1a   PASS
val-projectos-tenant-contract1a, -credentials1a, -csp1a, -principal1a, -rls1a      PASS
val-projectos-v3-validation-evidence1a, val-projectos-validator-scratch-lifecycle1a PASS
```

The same set was run after review rounds 1 and 2, and every exit code was 0 (the context, memory and skills validators took several minutes each).

The registration is in both lists, in the same position, before `val-projectos-connector-contract1a`, which pins its own entry as
the last one. The agent package was not typechecked: its `@projectos/core` junction points at another worktree (as for the
providers port), and this phase changes nothing in `agent/`.

## Converge (Code Bible B9)

Reconciled against the delta spec row 3 and ADR-P1 after the code was written. The module is exactly the approved shape:
pure rules, the workforce dispatch stays the only queue, same-tenant only, allowlist grants at most the parent's, the depth
and fan-out caps under the parent budget, and enveloped messages through `checkChildEnvelope`. Every file in the module has
its credit header or its original mark, and every ported file has its notices entry. Nothing in PROTECTED was touched: the
only edits outside this phase's own files are the one core barrel line, the notices entries, and the registration of the
validator in the two lists, in the same position and order, before the connector-contract entry.

Review rounds 1 and 2 were reconciled against the same shape: the fixes stay inside `core/src/agents/`, its tests, the validator, this
record and the two registration comments (their mojibake dash is now the em dash their neighbours use). Nothing in the kernel
was changed to give the module its proof of a root: it reuses `recordExecution`, which already answers `true` only for an
envelope the door admitted. `envelopeSnapshot.ts` and `ownerForm.ts` are new original files, and the module is still
unwired. Round 2 added nothing outside `core/src/agents/`, its tests, the validator and this record. ECC SECURITY and Agency `multi-agent-systems-architect` reviews are requested for the recheck.
