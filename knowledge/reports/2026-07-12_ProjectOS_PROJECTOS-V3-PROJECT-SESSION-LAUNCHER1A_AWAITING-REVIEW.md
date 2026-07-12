# ProjectOS — PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 7:** `PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `524f243…`

---

## 1. Objective

Given a project + phase/task + requested operations, deterministically build a **launch spec** that
shows exactly what a work session WOULD do — worker/role, working directory, which operations are
auto-allowed vs owner-gated vs refused, which secrets it would use (by reference only), and the launch
decision — **without spawning anything, contacting a provider, or touching the network/disk**. The
owner sees and approves before anything runs. Execution is deliberately out of scope (owner-gated later).

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/launcher/session-launcher.cjs` — `buildLaunchSpec(request, trustedConfig)`:
  - **Trust model**: the untrusted request supplies intent; the trusted config supplies the
    project→root registry. The allowed root is looked up by `projectId` from that registry — the request
    can never choose its own root; an unregistered project cannot launch.
  - **Allowlist** operation classification (auto-allowed / owner-gated / prohibited); unknown → refused.
  - **Working-directory containment**: lexical relative check **and** case-sensitive prefix check
    against the registered root; traversal/absolute/escape → refused. (Lexical only — documented; a
    future execution phase must re-verify via `fs.realpathSync`.)
  - **Production-frozen** projects refuse production-targeting operations.
  - **Fail-closed decision**: `REFUSED` (any refusal or bad dir) / `BLOCKED_AWAITING_OWNER` (any gated) /
    `READY_TO_LAUNCH`. `permitted` is true only for `READY_TO_LAUNCH`.
  - **Secrets** appear only as references (`{ref, usage:'via-broker-use', valueExposed:false}`).
  - **Bounded input**: over-long operation or secret-ref lists are refused (not truncated).
  - **No execution**: `executed:false`; the module requires only `crypto` + `path`; no spawn/exec/deploy.
- `projectos/validators/validate-session-launcher.cjs` — 15 executable invariants, registered in
  `validate-all.cjs`. Synthetic inputs only.

## 3. Invariants proven (all PASS)

1 clean → READY_TO_LAUNCH/permitted · 2 gated → BLOCKED_AWAITING_OWNER · 3 prohibited → REFUSED ·
4 unknown + case/whitespace variants refused (allowlist) · 5 production-frozen refuses prod-targeting ·
6 working-dir escape refused · 7 valid dir retained · 8 sessionId deterministic + delimiter-collision-safe ·
9 secrets only as references · 10 missing projectId/phaseId throw · 11 plan-only (executed:false, only
crypto+path required, no execution export) · 12 request cannot choose its own root; unregistered project
refused · 13 `__proto__` projectId cannot pull a root via the prototype chain · 14 over-long op list
refused · 15 over-long secret-ref list refused.

## 4. Review — security (security-reviewer agent)

Confirmed sound: `permitted:true` only when nothing refused/gated and the dir resolved; allowlist design
means case/whitespace-mangled prohibited ops fall through to refused; no `child_process`/`fs`/`net`/`vm`,
no `eval`/dynamic require; secrets never read. **HIGH fixed**: the allowed root is no longer taken from
the request — it is pinned to a trusted `projectRoots` registry keyed by `projectId` (own-property
lookup, prototype-pollution-safe). **MEDIUM fixed**: added a case-sensitive containment assertion
(path.relative can collapse case on Windows); collision-safe `sessionId` (JSON basis); documented that
containment is lexical-only and a future execution phase must re-`realpath`. Bounded operation/secret
lists. No open HIGH/CRITICAL.

## 5. Review — code (code-reviewer agent)

**Fixed**: the header promised over-long secret lists are *refused* but the code silently truncated —
now it refuses (fail-closed) with a `too-many-secret-refs` reason, covered by invariant 15;
`buildLaunchSpec` split into `classifyOperations` + `buildSecretPlan` helpers to meet the function-size
rule. Deferred (documented, non-blocking, consistent with sibling validators): splitting the flat
validator `run()` into per-invariant helpers. No open HIGH/CRITICAL.

## 6. Review — ECC

Owner authority preserved: gated actions block for owner approval; prohibited actions refused; the
launcher only plans and never executes. Local-only; production frozen by default (fail safe); no
provider/secret/API/network/disk. Completion accounting unchanged (Phase 7 local-implementation-complete
→ programme stays **15.8%**).

## 7. Tests / validators

- `node projectos/validators/validate-session-launcher.cjs` → **PASS** (15 invariants).
- `npm run validate` (full suite, now 44 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 8. Live proof

No user-facing surface (backend planner) → no browser proof applies. Proof is the validator executing
the real launcher and asserting all 15 invariants, including the trust-boundary, traversal, and
fail-closed cases — run above, all PASS. UI to trigger/preview a launch is deferred to Phase 12.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO
(references only) · AI API: NO · Network: NO · Disk: NO · Process spawn: NO. No external repo / PolyGo.

## 10. Residue / carry-forward

- Deferred (documented): validator `run()` decomposition; lexical-only dir containment (future
  execution phase must `fs.realpathSync` before use).
- Carry-forward: Phase 8 (`CLAUDE-DESKTOP-BRIDGE`) and the E2E runner (Phase 9) will consume a launch
  spec; the approval queue (Phase 10) will hold `BLOCKED_AWAITING_OWNER` specs for owner decision; Phase
  12 surfaces launch preview in the Control Centre.

## 11. Next phase

`PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A` (Phase 8).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
