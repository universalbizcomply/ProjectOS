# PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — Evidence Pack (credential boundary, durable degraded mode, owner bridge)

**Project:** ProjectOS
**Programme:** ProjectOS Autonomous Self-Hosting (post-V3)
**Report generated:** 2026-08-21 08:21:14 (Europe/London) — 2026-08-21 07:21:14 UTC
**Evidence subject:** `58f814b254f7b7c1ed3d592c05eac9b6f47bff52` on `projectos-post-v3-selfhost-pilot1a`

> **STATUS: AWAITING-REVIEW. AND READ THIS FIRST — THE WORK THIS REPORT DESCRIBES IS NOT COMMITTED.**
> The evidence subject above is the commit the working tree sits on top of, not a commit containing
> the work. Everything described here is uncommitted working-tree state. Under `tamperProof: false`
> the implementer may write any working-tree file and may not commit, so **none of this is authority
> yet and none of it is tamper-evident**. A reader who wants an immutable subject must commit it
> first. The report is filed now because the owner asked for it, not because the work has a home.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A — the autonomous gatekeeper loop, its credential
   boundary, and the durable record of what degraded mode spends.
3. **Date:** 2026-08-21
4. **Evidence subject:** `58f814b` on `projectos-post-v3-selfhost-pilot1a`, 413 commits ahead of
   `origin/main`. No commit, no tag, no push, no history rewrite was performed.
5. **Files changed:** 31 tracked files modified (+1922 / −128) plus new untracked files.
   New — `projectos/agent/src/mcp/bridge.ts`, `projectos/agent/src/mcp/listener.ts`,
   `projectos/agent/src/commands/mcp.ts`, `projectos/agent/bin/projectos-bridge.js`,
   `projectos/agent/test/mcpBridge.test.ts`, `projectos/security/trust-boundary.json`,
   `projectos/validators/val-projectos-trust-boundary1a.cjs`.
   Modified — `projectos/agent/src/installation/{degradedLedger,projectAllowlist}.ts`,
   `projectos/agent/src/loop/{degradedMode,reconciliation}.ts`, `projectos/agent/src/system.ts`,
   `projectos/agent/src/cli.ts`, `projectos/security/gatekeeper-transport-broker.cjs`,
   `projectos/security/installation-project-allowlist.json`,
   `projectos/validators/{validate-all,val-projectos-gatekeeper-contract1a}.cjs`, and 20 test files.

---

## 6. Summary, against what the gate asked for

### §3 — Minimal credential identity

An allowlist entry now names the **absolute governed root** it authorises, not only the origin.
`git remote get-url origin` reads `.git/config`, which lives inside the project and is rewritable, so
origin alone let any checkout claim to be the allowlisted repository by saying so. The checkout must
also be an ordinary full checkout rooted exactly there: a subdirectory of another repository, a
linked worktree, and a `.git` **file** are each refused, because each lets a directory borrow another
repository's history. Enforced on both the agent side and inside the trusted broker.

No root-commit pinning, no signing, no PKI, no attestation, no remote lookup — as ruled.

### §4 — The trust boundary, declared and enforced

`projectos/security/trust-boundary.json` states what is TRUSTED (the owner's Windows account, the
trusted installation, accepted committed code and policy, installation-owned state) and what is
UNTRUSTED (external governed repositories, Claude output, project working-tree changes, model text,
project-local evidence mirrors), plus the self-hosted case, the external case, and what is out of
scope. `val-projectos-trust-boundary1a.cjs` refuses a record that disagrees with the code.

The validator was adversarially reviewed and found weak, then fixed: it now checks the **trusted
broker** rather than only the agent's defence-in-depth copy, strips trailing comments (a `// HEAD:./`
comment used to satisfy the committed-read check), and requires real **call sites** rather than names
a function declaration satisfies. Seven mutations were applied to prove it can fail; all seven were
killed.

### §5 — One writer at a time

The installation ledger is one JSON file, and every read-modify-write over it now happens inside a
lock taken with a new `System.createExclusive` primitive (`writeFileSync` with flag `wx` — the
filesystem decides, so exactly one caller wins; an `exists()` check would let both proceed). There is
no wait and no retry loop: a busy ledger refuses and names the lock file so a stale one is clearable.
A lock that cannot be released is now reported rather than silently treated as released.

### §6 — The work id comes from the record that survives

The work-item ordinal was `mirror.workItems.length + 1`. Delete the mirror after one spend and the
count restarted, so the next work id collided with one already in the ledger and a grant with budget
left became unusable. The ordinal now comes from the installation's own count — and, after review,
is decided by the **same locked read** that writes the row (see CRITICAL 3 below).

### §7 — Reconcile works without the mirror

`projectos reconcile` rebuilds the work from the installation ledger when the project mirror is
absent, or when the mirror exists but does not record the work item being asked about. It discharges
into the ledger and does not recreate a project record for work this checkout has no other trace of.
A **corrupt** mirror still refuses: absent is a fact, corrupt is a question.

### §11–§14 — C15, the private owner bridge

Built on the existing `gatekeeperBridge.ts` authority contract rather than a new one. Every tool is
named exactly after an operation that contract already lists; there is no free-text property in any
tool schema, so there is nowhere for a sentence to go; every call passes `checkBridgeRequest` before
anything is read; refusals are recorded in installation state, outside the governed project, so a
project cannot erase the evidence that it was probed. The listener binds loopback only and refuses a
non-loopback bind address out loud rather than ignoring it. No response carries a path, host or port.
The bearer token is supplied by the owner — **ProjectOS mints none**, because minting a credential is
an owner-protected act.

**Not proven, and cannot be by me:** the leg from ChatGPT over the tunnel. The owner's own committed
screen record says the capability exists but "no tunnel has been created and no tunnel credential
exists; that remains a separate owner gate."

---

## 7. What the adversarial review found, including in code that was already committed

Two rounds, eight read-only lenses. The findings below were confirmed by reading the code, not taken
on the reviewers' word.

**CRITICAL 1 — the trusted credential path had never carried a live call.** In
`gatekeeper-transport-broker.cjs`, `const body = await res.text()` sat in the same block as the `body`
handed to `fetch`, so the request reference resolved to a binding still in its temporal dead zone.
Every brokered call threw a `ReferenceError`, the catch swallowed it, and the caller saw "the
gatekeeper transport failed". The HIGH-2 boundary has therefore never been exercised end to end.
Fixed by naming the response separately.

**CRITICAL 2 — git's environment chose which repository answered.** The verifier that decides *which
bytes become the trusted broker* ran `git` with the full inherited environment. `GIT_DIR`,
`GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_CONFIG_*` all redirect what
`HEAD:./<path>` resolves to, with a genuine binary and no race. Git now always receives a
seven-variable allowlist and nothing else.

**CRITICAL 3 — the grant ceiling was checked outside the lock.** Two concurrent runs both saw room
for the last item of a one-item grant and both spent it: the owner authorised one piece of unreviewed
work and two ran, recorded as legitimate. Worse, `reconcileDegradedWork` refuses to review a grant
whose rows exceed its bound, so **both** items became permanently undischargeable and every major
gate would have stayed shut with no remedy. This was made reachable by the §6 change — the old
colliding id had been bounding the second writer by accident. The ceiling is now decided by the same
locked read that names the entry.

**CRITICAL 4 — deleting the mirror re-opened an answered question.** The request id is derived from a
digest of the evidence text, and the ledger-backed and mirror-backed wordings differ. So `rm` the
mirror after an unwelcome verdict and the identical question could be put again — verdict shopping,
available to exactly the party the trust model says can delete that file. The durable record now
names the **work item**, so the wording cannot argue with it. One of my own tests had pinned the
defect open by asserting the two requests differed; it now asserts the second ask is refused.

**HIGH — an ask could strand a debt forever.** The ask and the discharge were two lock acquisitions.
Between them another process could hold the lock, the discharge would be refused, the accepted
paid-for decision discarded, and the retry blocked by "already asked". They now settle in one
acquisition: either both land or neither does.

**HIGH — the broker took its git binary from its caller.** `PROJECTOS_GIT_EXE` was accepted from
inside the governed checkout, and git is the oracle for every other claim the broker makes. The
exclusion the agent side already applied is now applied on the side that decides.

**Also fixed:** unguarded field reads that turned a refusal into a crash on legacy ledger rows; rows
naming this project under another installation being silently dropped and reported as "no debt";
`maxWorkItems: -1` being shown to the reviewer as the owner's ceiling; a lock-release failure being
reported as success; and a gate that could be cleared by subtracting settled work from a refusal that
named no work item.

---

## 8. Validators

`npm run validate` — **131 registered modules, 131 PASS, 0 FAIL, ALL PASS.**

Two validator defects were found and fixed on the way:

- `val-projectos-gatekeeper-contract1a` had never been told about the brokered transport, so its
  dependency allowlist refused the whole suite once that transport landed.
- `val-projectos-trust-boundary1a` — mine — went red when I merged two ledger writers, which is
  precisely what it is for.

## 9. Tests

Agent suite **1001 passed / 1001**, 32 files (955 before this work). `npm run typecheck` and
`npm run typecheck:tests` both clean.

Mutation testing, three batteries, **26 mutants, 26 killed**: 9 on the locking and mirror-free
reconcile, 10 on the round-two fixes, 7 on the trust-boundary validator. Three mutants initially
survived; in every case the fault was **my test failing to discriminate**, not the guard, and each
test was tightened until the mutant died. One test I wrote was flaky by construction — a
`not.toContain('-1')` assertion against a body carrying a hex request id, which would have failed
roughly one run in sixteen for no behavioural reason. It is now a positive assertion.

No mutation residue remains in `src/` (`grep -rn "if (false" src/` → empty).

## 10. Scope

Confined to what the gate named: credential authority correctness, durable degraded-mode correctness,
and C15. No new security programme was opened. Where a reviewer proposed a broader mechanism — a
database, PKI, cryptographic attestation, a remote lookup — it was refused as out of scope.

## 11. Forbidden actions checked

None performed. No commit, no push, no tag, no history rewrite, no production deployment, no
production data mutation, no real send, no live payment or refund, no destructive action, and no new
material credential or signing authority created. The bridge deliberately refuses to generate its own
token for this reason.

## 12. Production touched?

No.

## 13. External sends

None. No OpenAI call was made. Witness 1 (`GKWORK-b8d77cc39efa081e`,
`GKREQ-fdb2dc990b7df0e177add77a`, `AMENDMENT_REQUIRED`) was not retried and is preserved as negative
reconciliation evidence. Cost incurred this session: nil.

## 14. MCP Used

None.

## 15. External Tools Used

Eight read-only `Explore` review agents, instructed not to write, build or run tests. Working tree
re-checked afterwards; no agent-authored change and no probe file was found.

## 16. Residue

Scratch scripts under the session scratchpad only. Nothing written outside the repository except the
installation state directory the design requires. The untracked `.projectops/execution/*` worker
records predate this work.

## 17. Carry-forward — the review findings I did NOT act on

These are real and unfixed. They need a scope ruling before I touch them.

| Sev | Finding |
|---|---|
| HIGH | The broker binds a request to its authority by `body.includes("project: …")` — a substring test over caller-supplied bytes, satisfiable by embedding the string anywhere in the payload. |
| HIGH | Any historic committed secrets-handling receipt authorises unbounded future spend: nothing counts calls, and nothing ties the receipt to the phase in flight. |
| MED | Identity is compared as a path **string** — no `realpath` — so a directory junction at `.git` is not detected. |
| MED | `windowsVaultResolver` is unwired but live code that would put the raw credential back in the agent process. Recommend deleting it. |
| MED | The ledger is atomic-visible but not crash-durable: no `fsync` on the temp file or the directory. |

Lower-severity test-quality gaps were also reported (coverage that a deletion would survive) and are
not listed individually here.

## 18. Decision needed

1. **Scope ruling** on the five carry-forward findings above: fix now, or defer, item by item.
2. **Commit the working tree?** Nothing described here is committed, so nothing is tamper-evident.
3. **Bridge token** — the owner must choose one (32+ characters) for the bridge to listen at all.
4. **The tunnel** — create it and connect the ChatGPT plugin. C15 cannot close without this.

## 19. Owner Approval Required

Yes, for all four items above. Push remains **not authorised** and was not attempted. Phase closure
is not requested: no criterion is claimed as newly satisfied by this report, and the 17-criterion
matrix stands unchanged at 11/17.

---

**Claude prepared this report. Claude is not the closure authority and claims no acceptance here.**
