# ProjectOS — PROJECTOS-FORGE-GENERATION1A (F4) — Phase Evidence

**Programme:** ProjectOS Forge · **Phase F4:** `PROJECTOS-FORGE-GENERATION1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** (steps 2–4) — awaiting advisor/owner review + closure. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `ebcbd4b…`

---

## 1. Objective

The bounded, governed loop that fills the scaffold's typed slots by handing scoped tasks to a **LOCAL
worker** (the owner's Claude Code session over the desktop bridge, or a local model) — **NO Claude/
ChatGPT/metered API**. It fixes the two failures every incumbent shares: **unbounded cost** (hard budget
cap) and **doom-loops** (halt after K consecutive failures instead of retrying forever). The worker
response is treated as **untrusted** (validated through the already-reviewed bridge).

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/forge/generation-loop.cjs` — `runGenerationLoop({ tasks, worker, files?, budgetCap?,
  perCallMax?, maxAttempts?, doomThreshold?, redactor? })`. Per task: issue a task envelope → validate the
  untrusted response via `bridge.validateBridgeResponse` (correlation, allowlisted side effects,
  forbidden-field strip, secret redaction) → apply the redacted diff (relative-path-safe) → account cost.
  Hard budget: a call only issues if `spent + perCallMax ≤ budgetCap`, and every cost is clamped to
  `[0, perCallMax]`, so **spent can never exceed the cap**. Doom-loop halts a task after
  `doomThreshold` consecutive failures (bounded by `maxAttempts` too). Distinct outcomes: completed /
  doom-loop-halted (consultantSuggested) / blocked (budget-exhausted, up-front or mid-task) / failed
  (attempts exhausted). Returns `{ results, spent, remaining, withinBudget, files }`.
- `projectos/validators/validate-forge-generation.cjs` — **13 invariants** with synthetic workers,
  registered.

## 3. Invariants proven (all PASS)

1 happy path applies diffs within budget · 2 budget cap never exceeded; over-budget tasks blocked · 3
doom-loop halts at threshold (not maxAttempts) with consultantSuggested · 4 disallowed-side-effect worker
not accepted, diff not applied · 5 secret in a worker diff redacted before apply · 6 correlation mismatch
rejected · 7 huge per-call cost clamped (can't exceed cap) · 8 deterministic · 9 no network/metered-API/
spawn (source-scanned) · 10 incremental (only the target file changes) · 11 hostile diff path
(absolute/UNC/drive/traversal/degenerate) not applied · 12 mid-task budget exhaustion distinguished +
id-less blocked tasks get unique ids · 13 attempts-exhausted → 'failed' (distinct from doom-loop).

## 4. Review — security (security-reviewer agent)

Confirmed: the hard budget cap **cannot be exceeded** (clampCost maps hostile/negative/NaN/huge/missing
cost into `[0,perCallMax]`; both gates keep `spent ≤ budgetCap`); attempts are **doubly bounded** (no
infinite loop); a diff is applied **only** when the bridge accepted the response, using the **redacted**
`validated.response.diff` (not the raw worker output); no network/AI-API/spawn. **MEDIUM fixed**:
`applyDiff` path allowlist missed Windows-absolute/UNC keys → strict `isSafeRelKey` (rejects
absolute/drive/UNC/backslash/traversal/degenerate) + invariant 11. No open HIGH/CRITICAL.

## 5. Review — code (code-reviewer agent)

**HIGH fixed**: id-less blocked tasks could share a fallback id (derived from the attempt counter) → a
**per-task index** now names them uniquely (invariant 12). **MEDIUM fixed**: failure taxonomy collapsed
distinct causes and dropped the reason → distinct outcomes (`budget-exhausted-midtask`,
`attempts-exhausted`/`failed`, `doom-loop-halted`) with the last `validated.reason`/worker-exception
threaded through (invariants 12/13); the inner loop extracted into `attemptTask` to meet the function-size
guideline. No open HIGH/CRITICAL.

## 6. Review — ECC

The worker is untrusted (side effects allowlisted, authority fields stripped, secrets redacted — all via
the reviewed bridge); the loop is deterministic and offline; **no metered AI API** (source-scanned) — the
worker is the owner's local Claude Code session over the bridge. No PLAN READY effect. Local-only. Does
not change V3 accounting.

## 7. Tests / validators

- `node projectos/validators/validate-forge-generation.cjs` → **PASS** (13 invariants).
- `npm run validate` (full suite, now 54 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 8. Live demo

Budget cap: 3 tasks × 1000 tokens, cap 1500 → task a completed (spent 1000), b + c **blocked
(budget-exhausted)** — spent never passes the cap. (This is the incumbents' #1 complaint, structurally
eliminated.) Doom-loop: a failing task halts at the threshold, not after unbounded retries.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Disk: NO · Spawn: NO. No external repo / PolyGo touched.

## 10. Next phase

**F5 — Verification Harness**: a verifier subagent (isolated context) that proves the generated app
actually works (build + tests + browser checks) before "done" — anti-Potemkin. Reuses the bridge; the
real browser drive is owner-approved.

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE (steps 2–4) — AWAITING ADVISOR/OWNER REVIEW + CLOSURE. Not pushed.**
