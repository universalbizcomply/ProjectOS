# PROJECTOS-AGENT-WORKFORCE1A — evidence

Plan v1.6 (`plan-01053932764c573b-68d21d6830c1`), third phase. Branch `projectos-agent-workforce1a`, base `69fb141`
(PATH1A + PATH1B closure tip, pushed). Nothing is activated: no live specialist execution, no provider call, no
credential, no spend. Every proof uses deterministic fixture engines.

## Operating model as built

Owner → ProjectOS governance → exactly one project leader per governed project → the minimum specialist team
ProjectOS selects → fixture execution engines → evidence (append-only events) → ProjectOS gates → owner.

| Part | Where |
|---|---|
| Governance-owned data (read ONLY from the owner-accepted commit = the branch's remote-tracking upstream; local-candidate commits refused) | `.projectops/workforce/{workforce-config,registry,selection-policy,model-policy}.json`, `projectos/agent/src/workforce/governance.ts` |
| Registry: 279 agents / 18 divisions at `ad9264e3`, MIT, most-restrictive defaults on every entry, 17 configured roles fixture-eligible, 6 restricted, 256 ineligible | `registry.json`, `registry.ts`, generator `projectos/scripts/workforce-registry-from-reference.cjs` (reads the governed reference metadata + per-file sha256 only; no instruction text) |
| One leader: exclusive claim + hash-chained event log it must agree with; lease-bound takeover by ProjectOS only; generation voiding | `leader.ts`, `eventStore.ts` |
| Durable state OUTSIDE the checkout (per-user installation state, keyed by repository; project named at the accepted commit) | `orchestrator.ts` `workforceStateRoot` |
| Deterministic minimum-team selection, facts from records (phase risk, required reviews, browser proof, scope/candidate paths through a governance path→fact map), leader raise-only | `facts.ts`, `teamSelection.ts` |
| Dispatch order: leader gate → team → contradictions → panel → per-task least-privilege grant → protected actions to their owning gates → context by recorded-result digest → ceiling → instruction hash → fresh random frame marker → bounded attempts → contract validation | `dispatch.ts`, `framing.ts`, `contracts.ts`, `protectedActions.ts` |
| Leader decisions (prohibited kinds refused by the owning gate), contradiction resolution rules, panels | `leaderDecisions.ts` |
| Role ≠ model: static fallback from owner-approved model policy, eligibility per role and model | `models.ts` |
| Review independence (leader, contributors, panels, reviewer-without-subject never satisfy; plan reviews never replaced) | `review.ts` |
| Eligibility pipeline (6 checks, in order; stronger for high-risk roles; fixture eligibility only) | `evaluation.ts` |
| Owner-run, read-only acquisition into a quarantined cache outside the repo; hash-before-use source | `acquisition.ts` |
| Objective-driven operation: `projectos run` selects the team automatically; `projectos workforce roster|team|check-update|acquire|evaluate` | `loop/runner.ts` (opt-in `workforce` option, set only by `run`), `commands/workforce.ts` |
| Validator (criterion 35) | `projectos/validators/val-projectos-agent-workforce1a.cjs`, registered in `validate-all`, input map entry |

## Reconciliation (before building)

| Primitive | Found | Decision |
|---|---|---|
| Worker loop / invocation / attempt bounds | WORKING | reused unchanged; one opt-in hook |
| Fixture engine | PARTIAL (test-only fakes; adapters dir pinned to one file) | new `workforce/engines.ts`, outside the pinned adapters dir |
| Core `ExecutionProvider` / old `Worker` model | SYNTHETIC ONLY / STALE | not used |
| Leader / generation / takeover | MISSING | built |
| Exclusive claim / lease | PARTIAL (`.cjs` locks, no generation) | `System.createExclusive` reused |
| Specialist registry | MISSING | built |
| Governance roles, owner floor, closure authority, approval engine | WORKING | reused as the refusing gates; no new role |
| Model policy | PARTIAL (gatekeeper only) | separate fixture-only workforce model policy |
| Per-specialist grants | MISSING | built |
| Task-type facts | MISSING | built |
| Append-only persisted events | MISSING in the agent | built |
| Per-execution call/cost ceiling | MISSING | built |
| Committed-only reads | PARTIAL (`HEAD` may be a local candidate) | stricter reader: remote-tracking upstream, trailer refused |
| Third-party cache | MISSING | built (outside the repo) |

## Multi-agent systems architecture recheck (plan-required)

`multi-agent-systems-architect` (AMBER, corpus `ad9264e3`) returned **BLOCK: 5 HIGH, 8 MEDIUM, 3 LOW**. Every finding
was verified against the code and every one was fixed in scope, with a proof:

| # | Finding | Disposition |
|---|---|---|
| F1 HIGH | an escalated contradiction counted as closed | stays open and blocking; only a recorded resolution closes one; the leader cannot resolve an escalated one |
| F2 HIGH | a contradicted result could be passed on by `result-ref` | refused (`BLOCKED_BY_CONTRADICTION`) |
| F3 HIGH | state in the working tree + working-tree `projectId` → reset by deleting files | state moved to the per-user installation state dir keyed by repository; `projectId` from the accepted commit |
| F4 HIGH | `@{upstream}` could be a local branch | must be `refs/remotes/…`; residual (a shell can move a remote-tracking ref) stated |
| F5 HIGH | too few record facts; `run` always defaulted to bug-fix | governance path→fact map over phase scope/candidate paths; task type derived from record facts; leader cannot override it |
| F6 MED | resolution trusted caller-supplied facts; `auth` not protected | facts read from recorded team; `auth` protected |
| F7 MED | unbounded proposals; `propose()` under the lock; leader calls uncounted | proposal cap (governance); consultation counted against the ceiling; outside the lock |
| F8 MED | panel caps leader-chosen; re-declaration reset rounds; only rounds enforced | governance caps; declared once; cost and context budgets enforced |
| F9 MED | grant per role, not per task | exactly what the task requested within the role grant |
| F10 MED | re-ask guard textual only | a party to an OPEN contradiction gets no task at all |
| F11 MED | `reconcileLedger` unused | the leader always receives the reconciled ledger; disagreements recorded |
| F12 MED | the reviewer could be given implementation work | its task must reference contributors' recorded results; evidence records what it reviewed |
| F13 MED | multi-system + security phase unstaffable (5 > 4) | multi-system mandatory roles 3 → 2 (frontend joins via the `ui` fact); multi-system + security now fits; + security + production still refuses (owner may raise the bound) |
| F14 LOW | crash between log and head, or a stale lock, blocks the store | kept fail-closed; recovery is an owner action (below) |
| F15 LOW | `acquire --cache` accepted a path in the repo | refused |
| F16 LOW | unreadable time read as "live" | refuses (`LEADER_TIME_UNKNOWN`) |

## Catalogue acquisition (criterion 34) — owner action

The assistant session never reads, copies or runs git in the local corpus (standing rule; the corpus's own update
policy already routes every read of it to the owner's terminal). The guard is untouched. The mechanism is built and
proven on a synthetic corpus (commit/count/digest/licence refusals, read-only snapshot, immutable, planted scripts
and hooks never run — with a live control leg — and nothing outside the cache changed). After the owner-gated push,
the owner runs once, in his own terminal, from the checkout:

```
node projectos/agent/bin/projectos.js workforce acquire --source C:\dev\_tools\external\agency-agents
```

It writes only `%LOCALAPPDATA%\ProjectOS\third-party\specialist-catalogue\ad9264e309bd5e5422c04784372d7841b1e5d604\`.

## Residuals (stated, not hidden)

- A process with the user's own shell can move a local remote-tracking ref or reach the per-user state directory — the
  same residual as every committed-state read and the degraded-mode ledger. The leader and specialists hold no shell.
- Store recovery after a crash between the event write and the head write, or a left lock, is an owner action (inspect,
  then remove `store.lock` / restore `head.json`); the store fails closed until then.
- Live eligibility, live engines, model/provider configuration, credentials and spend remain owner activation inputs.
- Escalated contradictions have no owner-decision recording command in this phase; they stay blocking (fail closed).
