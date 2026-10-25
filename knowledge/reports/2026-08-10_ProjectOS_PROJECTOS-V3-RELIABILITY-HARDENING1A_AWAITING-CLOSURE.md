# PROJECTOS-V3-RELIABILITY-HARDENING1A — phase evidence bundle

**Project** ProjectOS · **Phase 17 of 19** · **Plan** v1.3 · **Branch** `projectos-v3`
**Date** 2026-08-10 · **Status** AWAITING-CLOSURE

One self-contained bundle. Everything asserted below is either recomputed by a validator in this
repository or reproducible from a committed harness; where something is NOT proven, it says so.

---

## 1. What the phase was for

Reliability hardening of the canonical `projectos/core` and `projectos/agent` runtime and the
Phase-12 integration seam — and, added by owner-approved plan v1.3, a LIVE-PROVEN zero-relay session
continuity handoff. The plan also names `validate-zero-relay-continuity` as a required validator, so
the criterion is checkable rather than asserted.

## 2. Plan v1.3 activation

| | |
|---|---|
| Approved candidate | `projectos/state/versions/projectos-v3.plan.v1.3-candidate.json` |
| SHA-256 (canonical git blob) | `4d35bc34b5740aacc98c9350221603cc2dc611081dd53581024da98ce1e497f1` |
| Candidate commit | `4dfe2cb` · Activation `d48a7b0` · Persistence bound `85f2345` |
| Supersedes | v1.2, retained byte-identically at `projectos/state/versions/projectos-v3.plan.v1.2.json` |

Approval identity is the **git blob**, not a working-tree checkout: `core.autocrlf=true` with no
`.gitattributes` means a fresh clone materialises JSON with CRLF and hashes differently from the
bytes that were approved, while the stored object is unchanged. Activation read the candidate with
`git cat-file blob` and re-verified that SHA-256 before binding. Activation proof: **28/28**, every
assertion recomputed from the files and the real plan engine — 19 phases, PLAN READY with 0 unmet,
schema valid, version record legal, Phase-17 dependencies unchanged, Phase 18 still depends on
Phase 17, delegation still `projectos`-scoped and still excluding protected actions, counters
unchanged at 17/19.

## 3. The gap this phase closed first: plan text was not a gate

`evaluateG4` read exactly one field off the plan phase — `requiredBrowserProof`. It never iterated
`acceptanceCriteria`, and the plan's `requiredValidators` were read by **nothing** in core, agent or
the Control Centre. Worse, `validatorsPass` was a boolean in `.projectops/closure/<phaseId>.json`, a
file **no code writes**. Adding a criterion to the plan would have changed nothing.

The chain is now closed end to end, and contains no phase id and no validator name:

```
active plan phase.requiredValidators
  -> subject-bound validator-run record written by the RUNNER
    -> G4 compares required names against recorded PASSING names
      -> missing / failing / untrusted  =>  G4-17 refuses, naming what is missing
```

- **Producer** — `projectos/validators/lib/validation-record.cjs`, wired into `validate-all.cjs`
  behind `--record-evidence`. Refuses to write on no head, malformed head, dirty tree, git failure,
  or any disagreement between the result count and the registry. A crashed module is recorded as a
  FAILING result, never omitted.
- **Gate** — `G4-17` in `projectos/core/src/closureEligibility.ts`. Vacuous for a phase declaring no
  validators, so every closed phase and Phase 18 behave exactly as before.
- **Closure tail** — admits `.projectops/validation/<40-hex>.json` as an exact pattern, never the
  directory: a directory prefix would make any hand-placed file under it non-substantive.

**Proof:** core 178 → 191 tests, agent 84 → 96, V1–V12 including the full subset lattice of a
three-name requirement, and **6/6 mutations killed** (predicate disabled; untrusted record accepted;
one missing validator tolerated; tail widened to the directory; required names read from the
caller-authored evidence; the record's self-declared subject trusted over its filename).

## 4. The primary acceptance item: live zero-relay continuity

Run by the committed harness `projectos/worker/zero-relay-proof.cjs` at `c9ff40c`, evidence at
`7b98497`. Three distinct processes:

| | pid |
|---|---|
| supervisor (ProjectOS) | 3524 |
| Worker A | 33992 — exited before anything replaced it |
| Worker B | 42340 — **parentPid 3524**, the supervisor; not Worker A, not a shell |

The ledger records, in the only order it accepts: checkpoint → release → **post-release write
refused** → permit → spawn → verify → **protected action refused** → continuation → release.

- Ownership is proven by a **recorded refusal**, not by silence. A worker that merely stopped is
  indistinguishable from one that was prevented.
- Worker B's argv is `["--resume","--root",…,"--project",…,"--session",…]` — identifiers only.
- Worker B **re-derived** repository root, branch, head, plan version and phase membership and its
  observations are recorded beside the checkpoint's claims, `mismatches: []`. The comparison is the
  proof; an echo would prove nothing.
- The protected boundary is proven by **attempting** `deploy-production` in memory and being refused.
  It cannot be evidenced by never trying.

A **second ledger** proves owner authority: the owner stops the project in the window between the
permit and the spawn, the executor's last check catches it, records the stop as honoured *immediately
before spawn*, and starts **nothing**. This cannot share a ledger with a completed handoff — if the
stop is honoured, the continuation does not happen — and a worker that wrote the owner's control file
to stage one would be forging owner authority to prove owner authority.

**What this does not prove, stated plainly:** it does not prove no human was in the room. It proves
the replacement was started by ProjectOS code as a child of the executor, that no owner- or
user-authored event appears anywhere in the handoff window, and that the instruction channel carried
no prose. Someone who edits the ledger JSON defeats it, as they defeat every record in this
programme — `MANUAL_GOVERNANCE_APPROVAL`, `tamperProof: false`, with the owner commit gate as the
backstop.

## 5. Failure matrix — 26 cases, real repository, real processes

Cases 1–21 from the phase directive (normal; crash after/before checkpoint; stale checkpoint; wrong
head; dirty checkout; wrong branch; wrong repo; wrong project; wrong session; duplicate worker;
duplicate handoff; launch failure; cannot load state; write after release; owner pause; owner stop
before spawn; protected action next; no next action; malformed ledger; manual worker), plus five
added from review findings (§6). Every case asserts the refusal **and the reason**; case 1 exists so
the others cannot pass vacuously.

Two findings the matrix itself produced: an out-of-band worker crashed instead of refusing (fixed),
and case 21 turned out provable far more strongly than designed — a hand-started worker cannot enter
the ledger at all, so it writes nothing and performs no continuation.

## 6. Review findings — 0 unresolved CRITICAL, 0 unresolved HIGH

| Severity | Finding | Disposition |
|---|---|---|
| CRITICAL | `git` spawned by BARE NAME in the worker, validator and CLI paths. On Windows an unqualified command resolves against the cwd before PATH, and the cwd is the governed checkout — untrusted content until the owner reviews it. A planted `git.exe` could answer "clean" and decide whether its own phase may close. | **FIXED.** `projectos/worker/bound-git.cjs` resolves ONE absolute executable (`PROJECTOS_GIT_EXE`, else the first absolute PATH entry, skipping anything inside the governed root). No bare-name fallback; unbound ⇒ facts fail closed. Same binding applied to the CLI's `System.exec`, which is what `closureGate.ts` uses. Case 25. |
| HIGH | Lock acquisition was read-then-write: two processes could both believe they held the checkout. | **FIXED.** Every acquisition path ends in an exclusive `wx` create. Case 26 races **six concurrent processes**; exactly one wins. |
| HIGH | A governed refusal surfaced as an uncaught stack trace: a ledger append in `finally` threw and discarded the pending return when the owner stopped between verification and continuation. | **FIXED.** Case 22 asserts exit code 3, no stack trace, no continuation, stop recorded, lock released. |
| MEDIUM | The clean-tree gate was checked once, before the spawn; nothing Worker B verifies is working-tree-level. | **FIXED.** Re-checked immediately before the continuation. Case 23. |
| MEDIUM | `sessionId` is a path component and was validated only at the create site. | **FIXED.** Validated at every path builder and at the process boundary. Case 24. |
| MEDIUM | The committed proof was stale at the branch tip. | **RESOLVED** by re-running it — which is the control working, not a defect. |
| LOW | `requireCleanTree` was an unused caller-supplied fail-open switch. | **REMOVED.** |

Reviewed and clean: spawn/argv injection, the checkpoint allowlist as an injection channel,
self-closure and caller-asserted authority, secret handling, fresh-clone dependencies, dead code.

## 7. R17 carry-forwards

Every item re-checked against current source, not against the note that raised it:
`docs/architecture/projectos-v3-phase17-r17-carryforward-reconciliation.md`. **R17-2 CLOSED** (the
approval loop is now governed-context-gated — approvals could previously be minted and decided in a
checkout whose plan is for another project). **R17-7 pattern closed.** R17-1, R17-3, R17-6, R17-8
carried forward with reasons. R17-5 external. R17-9 not a defect.

Also fixed, not on the list: `phase new` could persist `"objective": "<objective>"` — the CLI's own
default, which no schema, validator or G4 predicate ever read. The objective now comes from the
approved plan's description, a placeholder is refused by any route, and the existing Phase-17 record
was repaired through a bounded governed command, not hand-edited.

## 8. Validation

`node projectos/validators/validate-all.cjs` — **126 registered modules, 126 PASS, 0 FAIL, exit 0.**
Registered module count and the aggregate command are now reported as distinct numbers; the earlier
"124/124" for a 123-module registry was a counting-convention artefact, and the runner no longer
allows it.

core 191/191 · agent 96/96 · typecheck clean · `git diff --check` clean · no raw secret.

## 9. Protected effects

**NONE.** No production, deployment, database mutation, external send, payment, credential access or
installation. The only writes outside source and evidence were inside `.projectops/continuity/`.

## 10. Not claimed

ProjectOS V3 is **not** complete. Phase 18 `PROJECTOS-V3-FINAL-E2E-CLOSURE1A` remains OPEN and is the
final closure phase. Repeatable native-Windows foreground acquisition from a background worker
remains a harness limitation carried forward from Phase 12.
