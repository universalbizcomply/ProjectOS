# ProjectOS — PROJECTOS-V3-LOCAL-SECRET-BROKER1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 4:** `PROJECTOS-V3-LOCAL-SECRET-BROKER1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `61a601d…`

---

## 1. Objective

A local, zero-dependency secret broker so ProjectOS can store and release secrets on the operator's
own machine without ever exposing raw values in app state, logs, reports, prompts, or the audit trail —
fail-closed, bound to project/environment, owner-gated for sensitive reads, and restricted to
**synthetic** data by construction. No provider access, no network, no real credentials.

## 2. Implementation scope (new, zero-dependency `.cjs`)

- `projectos/security/redaction.cjs` — reference-based redactor. Callers register `(value →
  label)`; `redactText`/`redactObject` replace every occurrence with `«secret:LABEL»`. `__proto__`-safe
  output (`Object.create(null)`), `WeakSet` cycle guard, Buffer→UTF-8 handling, over-inclusive by
  design. Never persists values. (Files under `projectos/security/` are named without a `secret`/`token`
  prefix so the repo's `secret*`/`*token*` gitignore guards keep blocking real secret material.)
- `projectos/security/broker.cjs` — the broker. AES-256-GCM at rest under a scrypt-derived key
  (N=2^16); fresh salt+IV per record; auth-tag verified on read. Opaque `ref` handles; per-secret
  `(projectId, environment)` binding; `standard`/`high` sensitivity with owner-confirmation capability
  required for `high`; synthetic-only namespace guard; revoke/destroy (binding-enforced); append-only
  metadata audit; `assertNoPlaintextLeak` invariant. No network I/O, no disk I/O (in-memory store).
- `projectos/validators/validate-secret-broker.cjs` — 16 executable security invariants (below),
  registered in `projectos/validators/validate-all.cjs`. Uses synthetic values only.

**Files:** 2 new lib + 1 new validator + `validate-all.cjs` (1 line, registration).

## 3. Security invariants proven by the validator (all PASS)

1 encryption at rest (no plaintext in record) · 2 no plaintext in store/audit serialization ·
3 correct binding + capability releases value · 4 wrong project fails closed · 5 wrong environment
fails closed · 6 high-sensitivity without owner confirmation fails closed · 7 high-sensitivity WITH
owner confirmation succeeds · 8 revoked fails closed · 9 destroyed fails closed · 10 tampered
ciphertext AND tampered auth-tag fail closed (genuine GCM auth path) · 11 non-synthetic namespace
refused at construction · 12 failures audited as metadata with no value · 13 redactor scrubs value from
text/object incl. literal `__proto__` key · 14 sub-minimum value rejected · 15 revoke/destroy enforce
binding; refused ops leave secret intact · 16 unknown-ref revoke/destroy throw and are audited.

## 4. Review — security (security-reviewer agent)

Crypto confirmed sound: AES-256-GCM, unique random IV(12B)/salt(16B) per store, auth-tag verified via
`final()`, generic fail-closed errors, no plaintext in records/audit/errors, non-guessable 72-bit refs,
no ReDoS. Findings addressed: **HIGH** revoke/destroy now enforce the same binding as retrieve (was
ref-only). **MEDIUM** retrieve checks binding before disclosing revocation status (removed oracle);
sub-`MIN_LEN` values rejected at store (were silently un-redactable); `__proto__`/cycle/Buffer redaction
hardened; scrypt cost raised 2^14→2^16. Documented accepted-risk (synthetic-only namespace guards WHERE
not CONTENT; passphrase-KDF is for local synthetic scope — real credentials need OS-keychain/CSPRNG key,
deferred with out-of-scope real-credential work). No open HIGH/CRITICAL.

## 5. Review — code (code-reviewer agent)

Findings addressed: **HIGH** unknown-ref revoke/destroy now produce audited failures (consistent with
retrieve) + covered by invariant 16. **MEDIUM** immutable record update on revoke (`records.set(ref,
{...rec, revoked:true})` — no in-place mutation); validator header synced to all 16 invariants. Deferred
(documented, non-blocking): extracting the `createSecretBroker` closures and the flat `run()` into
smaller units — noted for a later hardening pass to keep this diff tight. No open HIGH/CRITICAL.

## 6. Review — ECC

Owner authority preserved (high-sensitivity reads require an owner-confirmation capability that
automation cannot self-grant). No PLAN READY effect. Local-only; production frozen; no provider/secret/
API; synthetic data only, enforced by the namespace guard. No document overrides governance. Completion
accounting unchanged (Phase 4 local-implementation-complete, not accepted → programme stays **15.8%**).

## 7. Tests / validators

- `node projectos/validators/validate-secret-broker.cjs` → **PASS** (16 invariants).
- `npm run validate` (full ProjectOS suite, now 42 validators) → **ALL PASS**.
- `git diff --check` → clean (only benign LF→CRLF warnings).

## 8. Live proof

Phase 4 has **no user-facing surface** (it is a backend security primitive), so no browser proof
applies. The proof is the validator executing the real broker/redactor code and asserting all 16
security invariants hold against genuine AES-256-GCM operations — run above, all PASS. Owner-facing
"no secret used" safety state is already surfaced by the Phase 3 Owner Control Plane. Wiring the broker
into the Control Centre UI is deferred to Phase 12 (Control-Centre integration).

## 9. Safety / boundaries

Production touched: NO · Deployment: NO · Database mutation: NO · External sends: NO · Payments: NO ·
Provider access: NO · Real secrets used: NO (synthetic only) · AI API used: NO · Network I/O: NO ·
Disk I/O: NO. No external repository / PolyGo touched. No secret value appears in this report.

## 10. Residue / carry-forward

- Deferred hardening (documented): smaller function decomposition of the broker factory and validator
  `run()`; exact-string redaction only (transformed/re-encoded copies not caught — redact before
  transforming); for real credentials, replace passphrase-KDF with OS keychain / CSPRNG key + higher
  KDF cost. All out-of-scope for this local synthetic phase.
- Carry-forward: Phase 5 (`SECRET-OPERATION-BROKER`) will build the operation layer that uses secrets
  via `broker.use(...)` without materializing them to callers; Phase 12 wires broker status into the UI.

## 11. Next phase

`PROJECTOS-V3-SECRET-OPERATION-BROKER1A` (Phase 5).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
