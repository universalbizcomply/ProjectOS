# ProjectOS — PROJECTOS-V3-APPROVAL-QUEUE1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 10:** `PROJECTOS-V3-APPROVAL-QUEUE1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `e77065a…`

---

## 1. Objective

A deterministic local store of owner-decision items produced by the governed chain (a
`BLOCKED_AWAITING_OWNER` launch spec, a bridge request needing owner approval, a worker's refused side
effects). Only the owner can decide — and only with an explicit owner-confirmation capability;
ProjectOS/Claude can never self-approve. Deciding never auto-grants PLAN READY.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/approval/approval-queue.cjs` — `createApprovalQueue({ redactor })`:
  - `enqueue({ kind, summary, payload })` → a `pending` item (kind allowlisted; summary/payload redacted;
    payload deep-frozen so a holder can't rewrite what the owner reviews). Rejections are audited.
  - `decide({ id, decision, capability })` — `decision ∈ {approve,return,reject}`. Fail-closed order:
    unknown item → invalid decision → **owner-confirmation required** → already-decided. Without
    `capability.ownerConfirmation === true` it throws (no self-approve). No double-decision.
  - `get`/`list(status)`/`pendingCount`/`getAudit` — return copies; audit is append-only metadata only.
- `projectos/validators/validate-approval-queue.cjs` — 12 executable invariants, registered in
  `validate-all.cjs`. Synthetic data only.

## 3. Invariants proven (all PASS)

1 enqueue → pending item · 2 approve WITH owner confirmation → approved + audited · 3 decide without
owner confirmation throws, item stays pending · 4 invalid decision throws · 5 unknown item throws ·
6 already-decided throws · 7 return/reject transitions work · 8 unknown kind refused (allowlist) ·
9 secret in summary/payload redacted + absent from audit · 10 audit metadata-only records decisions;
list/pendingCount reflect status · 11 fresh item confers no authority (pending) · 12 returned payload is
frozen (not externally mutable).

## 4. Review — security (security-reviewer agent)

Core authorization sound: `decide` fail-closes on `ownerConfirmation !== true` (strict equality, no
coercion); decision key validated via `hasOwnProperty` on a literal map (proto-pollution-safe); kind
gated by a Set allowlist; double-decision blocked; secrets redacted before storage so they cannot reach
returned items or the metadata-only audit. **MEDIUM fixed**: payload was a shallow copy sharing a live
internal reference (a bait-and-switch on decision content) — payload is now **deep-frozen** at creation
(invariant 12). **LOW fixed**: `enqueue` now audits rejected attempts; the owner-confirmation check now
runs **before** the already-decided check so an unauthorised caller gets a uniform response regardless of
state. Documented trust boundary (informational): `ownerConfirmation` is a self-asserted boolean — a
trusted interactive owner flow must be the only thing that sets it; read methods are unauthenticated by
design (only decisions are gated). No open HIGH/CRITICAL.

## 5. Review — ECC

Owner authority is the whole point and is preserved: automation cannot self-approve; approving records a
decision but never auto-grants PLAN READY. Local-only; no provider/secret/API/network/disk. Completion
accounting unchanged (Phase 10 local-implementation-complete → programme stays **15.8%**).

## 6. Tests / validators

- `node projectos/validators/validate-approval-queue.cjs` → **PASS** (12 invariants).
- `npm run validate` (full suite, now 47 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 7. Live proof

No user-facing surface in this phase (the Owner Control Plane already has an inert decisions region;
wiring it to this queue is deferred to Phase 12 Control-Centre integration). Proof is the validator
executing the real queue and asserting all 12 invariants — run above, all PASS.

## 8. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO ·
AI API: NO · Network: NO · Disk: NO · Process spawn: NO. No external repo / PolyGo touched.

## 9. Residue / carry-forward

- Documented trust boundary: the owner-confirmation capability must come from a genuine owner-authenticated
  flow, never constructed by automation. Read-side access is intentionally ungated (in-process trust).
- Carry-forward: Phase 12 wires the queue into the Owner Control Plane decisions region (with live proof);
  the E2E runner's `owner-hold` / `disallowed-side-effect` outcomes become enqueued items.

## 10. Next phase

`PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A` (Phase 11).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
