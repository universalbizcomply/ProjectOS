# ProjectOS — PROJECTOS-V3-E2E-RUNNER1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 9:** `PROJECTOS-V3-E2E-RUNNER1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `4a94dcc…`

---

## 1. Objective

Prove the whole governed chain works together, deterministically and offline: **launch spec → bridge
request → synthetic worker → validated response**, with the secret/operation brokers exercised via
`broker.use`. Run the happy path and every fail-closed path as synthetic scenarios and assert the
end-to-end outcome. No real provider, no AI/metered API, no network, no real worker spawn.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/e2e/e2e-runner.cjs` — composes the earlier modules (`launcher/session-launcher`,
  `bridge/desktop-bridge`, `security/broker`, `security/operation-broker`, `security/redaction`) into a
  wired harness with a **shared redactor** threaded through the secret broker AND the bridge, then runs
  six scenarios. `runAllScenarios()` returns `[{ name, ok, detail }]`. Pure composition — adds no new
  trust; the synthetic "worker" is an in-process handler.
- `projectos/validators/validate-e2e-runner.cjs` — 4 invariants asserting every scenario passes, all six
  are present, no secret leaks into the aggregate results, and results are deterministic. Registered in
  `validate-all.cjs`.

## 3. Scenarios (all PASS)

- **happy-path** — READY spec dispatched; the synthetic worker HMAC-signs the session id using the
  secret via the operation broker (secret never materialised to the worker), returns the digest as an
  artifact + an allowlisted side effect → response **accepted**, and no secret appears in the result.
- **refused-spec** — a prohibited op (`send-external`) makes the spec REFUSED → not dispatchable.
- **owner-hold** — an owner-gated op (`close-phase`) makes the spec BLOCKED → held for owner approval,
  not dispatchable.
- **disallowed-side-effect** — the worker requests `deploy-production` → refused, response not accepted.
- **secret-redaction** — a hostile worker puts the raw secret in an artifact → redacted out of the
  validated response.
- **correlation-mismatch** — a mis-correlated response → rejected.

## 4. Review — security / ECC

The runner introduces **no new trust surface**: it only composes modules already security-reviewed in
Phases 4/5/7/8, and the fail-closed scenarios prove those guarantees hold *in combination* (a worker
cannot self-authorise a side effect, a secret used for signing never leaks, gated/prohibited specs never
dispatch). Shared-redactor threading closes the Phase-8 HIGH (redactor must be shared) in practice. No
provider/AI/API/network/disk/spawn. No PLAN READY effect. Completion accounting unchanged (Phase 9
local-implementation-complete → programme stays **15.8%**).

## 5. Review — code (self)

Small scenario functions, each asserting a specific governed outcome (no trivially-passing scenario);
deterministic; immutable result objects; `runAllScenarios` catches a throwing scenario as a failure
rather than crashing. Reuses existing modules — no duplicated logic.

## 6. Tests / validators

- `node projectos/validators/validate-e2e-runner.cjs` → **PASS** (6 scenarios, 4 invariants).
- `npm run validate` (full suite, now 46 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 7. Live proof

No user-facing surface (backend integration runner) → no browser proof applies. Proof is the validator
executing the real end-to-end chain across all six scenarios — run above, all PASS, including the
secret-signing happy path and every fail-closed path. A Control-Centre "run E2E" trigger is deferred to
Phase 12/13.

## 8. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO
(synthetic only) · AI API: NO · Network: NO · Disk: NO · Process spawn: NO. No external repo / PolyGo.

## 9. Residue / carry-forward

- Carry-forward: Phase 10 (`APPROVAL-QUEUE`) will capture the `owner-hold` and `disallowed-side-effect`
  outcomes as owner-decision items; Phase 13 (`DESKTOP-E2E-PROOF`) runs the chain through the real Tauri
  desktop shell.

## 10. Next phase

`PROJECTOS-V3-APPROVAL-QUEUE1A` (Phase 10).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
