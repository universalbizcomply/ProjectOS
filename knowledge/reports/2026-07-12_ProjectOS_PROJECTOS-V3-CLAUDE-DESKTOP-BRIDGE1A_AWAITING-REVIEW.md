# ProjectOS — PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 8:** `PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `43663ca…`

---

## 1. Objective

Define and validate the local, in-process handoff protocol between ProjectOS and an **untrusted**
desktop/CLI worker (a Claude Code session): build a request envelope from a Phase-7 launch spec, and
validate the worker's response — **with no AI/metered-API call and no network**. The bridge only defines,
validates, and (for tests) simulates the protocol with a synthetic in-process worker.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/bridge/desktop-bridge.cjs`:
  - `createBridgeRequest({ launchSpec, correlationId, redactor })` → dispatchable request envelope. Only
    a `READY_TO_LAUNCH` spec is dispatchable; `REFUSED` yields no envelope; `BLOCKED` is held with
    `requiresOwnerApproval`. Only auto-allowed ops are dispatched; gated ops are surfaced for owner
    approval, not sent as instructions. Secrets appear as references only.
  - `validateBridgeResponse(requestEnvelope, response, redactor)` — validates an **untrusted** worker
    response, fail-closed: snapshots the response once (JSON round-trip, defeating getter/Proxy TOCTOU
    and enforcing the 256 KB cap), checks correlation id + status, **allowlists** side effects (accepted
    only if on the launcher's `AUTO_ALLOWED` set — unknown/gated/prohibited/non-string all refused),
    **recursively strips** forbidden authority fields (`planReady`, `authoritative`, …) at every level,
    and redacts secrets. `accepted` is true only when status is `completed` with zero refused side
    effects.
  - `runSyntheticWorker(envelope, handler, redactor)` — in-process simulation for tests (no network/AI).
  - The `redactor` is **required** in all three — no silent empty-redactor default.
- `projectos/validators/validate-desktop-bridge.cjs` — 14 executable invariants, registered in
  `validate-all.cjs`. Synthetic data only.

## 3. Invariants proven (all PASS)

1 READY → dispatchable · 2 REFUSED → no envelope · 3 BLOCKED → held for owner · 4 correlationId required ·
5 correlation mismatch rejected · 6 invalid status rejected · 7 owner-gated / prohibited / **unknown** /
non-string side effects all refused (allowlist) · 8 allowlisted side effect accepted · 9 forbidden
authority fields stripped **top-level AND nested in artifacts** · 10 oversized response rejected ·
11 secrets redacted both directions · 12 synthetic worker round-trips a benign response · 13 malformed
response rejected · 14 omitting the required redactor throws.

## 4. Review — security (security-reviewer agent)

Found and fixed a **CRITICAL**: the side-effect gate was a *denylist* (`OWNER_GATED ∪ PROHIBITED`), so an
unknown/mistyped side-effect string (e.g. "wipe-repo") slipped through as *accepted* — now it is an
**allowlist** against `AUTO_ALLOWED` (matching the launcher's own model), with unknown/non-string
refused (invariant 7). **HIGH** (a silently-defaulted empty redactor gave false redaction) → the redactor
is now a **required** argument that throws if missing/invalid (invariant 14). **MEDIUM** (forbidden
authority fields stripped only at the top level) → now stripped **recursively** including inside
`artifacts` (invariant 9); **MEDIUM** (getter/Proxy TOCTOU between the size check and decision reads) →
the response is **snapshotted once** via JSON round-trip and every check runs against the inert copy.
Confirmed sound: only READY dispatchable; correlation/ status/ malformed all fail closed; `stripForbidden`
uses `Object.create(null)` (proto-safe). No open HIGH/CRITICAL.

## 5. Review — code (self)

Small, cohesive module (helpers `requireRedactor`, `serialize`, `stripForbidden`); functions under the
size guideline; immutable/derived outputs; explicit fail-closed reasons; no dead code. Deferred
(documented, non-blocking): exporting the launcher's classification sets as accessor functions rather
than raw mutable `Set`s (in-process-only, low impact).

## 6. Review — ECC

Untrusted-worker model upheld: a worker cannot self-authorise side effects (allowlist) or grant
authority/PLAN READY (fields stripped). No PLAN READY effect. Local-only; production frozen; no
provider/secret/API/network/disk/spawn. Completion accounting unchanged (Phase 8
local-implementation-complete → programme stays **15.8%**).

## 7. Tests / validators

- `node projectos/validators/validate-desktop-bridge.cjs` → **PASS** (14 invariants).
- `npm run validate` (full suite, now 45 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 8. Live proof

No user-facing surface (backend protocol contract) → no browser proof applies. Proof is the validator
executing the real bridge and asserting all 14 invariants, including the allowlist, authority-strip, and
redaction cases — run above, all PASS. Wiring the bridge to the real always-on daemon
(`projectos/bridge/daemon`) and surfacing it in the Control Centre is deferred to Phases 9–12.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Disk: NO · Process spawn: NO. No external repo / PolyGo touched.

## 10. Residue / carry-forward

- Deferred (documented): accessor-wrap the classification sets; connect the protocol to the TS bridge
  daemon runtime.
- Carry-forward: Phase 9 (`E2E-RUNNER`) will drive a launch spec → bridge request → synthetic worker →
  validated response end to end; Phase 10 (`APPROVAL-QUEUE`) will hold `requiresOwnerApproval` requests
  and refused side effects for owner decision; Phase 12 surfaces bridge status in the Control Centre.

## 11. Next phase

`PROJECTOS-V3-E2E-RUNNER1A` (Phase 9).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
