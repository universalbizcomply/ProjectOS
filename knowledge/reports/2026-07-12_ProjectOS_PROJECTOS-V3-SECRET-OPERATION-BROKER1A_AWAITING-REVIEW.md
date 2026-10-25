# ProjectOS — PROJECTOS-V3-SECRET-OPERATION-BROKER1A — Phase Evidence

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase 5:** `PROJECTOS-V3-SECRET-OPERATION-BROKER1A`
**Local status:** **LOCAL IMPLEMENTATION COMPLETE** — not accepted, not closed. **Not pushed.**
**Branch:** `projectos-v3` · **Starting commit:** `2cdb723…`

---

## 1. Objective

Let ProjectOS *use* a secret to perform an operation (sign / fingerprint / verify) **without ever
handing the raw secret to the caller**. The plaintext must materialise only inside the operation
closure, the operation must return a non-secret result, and every result must be proven secret-free
before release. Synthetic, in-process only — no provider, no network, no real credentials.

## 2. Implementation scope (new, zero-dependency `.cjs`, on top of Phase 4)

- `projectos/security/operation-broker.cjs` — `createOperationBroker({ secretBroker })`:
  - **Allowlist**: only registered operations run; unknown op refused + audited.
  - **Owner gate**: operations flagged `sensitive` require an owner-confirmation capability (in addition
    to the secret's own high-sensitivity gate).
  - **Binding**: the secret's `(projectId, environment)` binding is enforced via `broker.use(...)`.
  - **No-leak (defence in depth)**: the operation result must be plain-JSON-safe — functions, Buffers/
    TypedArrays, Map/Set/Date, Promises/thenables, getters, non-enumerable props, symbols and bigint are
    all refused (they can smuggle a secret past a text scan). The value is then redactor-scanned for the
    verbatim secret and the caller receives the value **re-derived from the exact scanned text**, so what
    is returned is provably what was scanned. Async operations are refused at registration.
  - **Audit**: metadata-only outcome events (operation, ref, project, environment, ok, reason).
  - `STANDARD_OPERATIONS`: `hmac-sign` (HMAC-SHA256 digest), `fingerprint` (non-reversible 16-hex id),
    `verify-candidate` (sensitive; constant-time equality via fixed-length keyed HMACs — no length leak).
- `projectos/validators/validate-secret-operation-broker.cjs` — 12 executable invariants, registered in
  `validate-all.cjs`. Synthetic values only.

## 3. Invariants proven (all PASS)

1 unknown op refused · 2 allowlisted op returns correct non-secret result · 3 op genuinely used the
secret (matches independent HMAC) and never equals it · 4 fingerprint non-reversible, not the secret ·
5 verify-candidate true/false correct · 6 sensitive op without owner confirmation refused · 7 wrong
binding fails **and is audited** · 8 every exfiltration shape blocked (verbatim string, nested string,
Buffer, returned function, Map, hidden non-enumerable property) — caller gets nothing · 9 audit is
metadata-only, no secret · 10 duplicate registration refused · 11 async/thenable ops refused at
registration · 12 valid plain-object result passes through unchanged.

## 4. Review — security (security-reviewer agent)

Two **CRITICAL** found and fixed: (a) the leak-scan ran on a *serialization* while `execute` returned
the *live object* — JSON-invisible carriers (Buffer, function, Map/Set, non-enumerable/getter/`toJSON`,
symbol) escaped; now the result must pass `assertPlainJsonSafe` and the caller receives only the
re-parsed scanned text. (b) async/Promise results bypassed the sync scan; now thenables and async
`run` are refused. **HIGH** (encoded/transformed copies defeat the exact-substring scanner) and
**MEDIUM** (owner-confirmation is a self-asserted boolean; `hmac-sign` is a chosen-message oracle)
documented as explicit trust-boundary / accepted-risk notes in the module header. **LOW**
(verify-candidate length timing) fixed via fixed-length keyed-HMAC comparison. Confirmed sound:
allowlist via `Map` (no prototype-pollution), binding delegated to the reviewed broker, error paths
never surface `run`/broker error text, audit metadata-only. No open HIGH/CRITICAL.

## 5. Review — code (code-reviewer agent)

Fixed: `logOp` converted to a single options object (same-typed fields can't be transposed);
invariant 7 now asserts the wrong-binding failure is actually recorded in the audit log. Deferred
(documented, non-blocking, consistent with the sibling validator): splitting the flat validator `run()`
into per-invariant helpers. No open HIGH/CRITICAL.

## 6. Review — ECC

Owner authority preserved (sensitive operations require owner confirmation automation cannot self-grant;
documented trust boundary). No PLAN READY effect. Local-only; production frozen; synthetic in-process
only; no provider/secret/API/network/disk. Completion accounting unchanged (Phase 5
local-implementation-complete, not accepted → programme stays **15.8%**).

## 7. Tests / validators

- `node projectos/validators/validate-secret-operation-broker.cjs` → **PASS** (12 invariants).
- `npm run validate` (full suite, now 43 validators) → **ALL PASS**.
- `git diff --check` → clean.

## 8. Live proof

No user-facing surface (backend security primitive) → no browser proof applies. Proof is the validator
executing the real operation broker against genuine HMAC/crypto operations and asserting all 12
invariants — run above, all PASS, including the six exfiltration-shape blocks. UI integration deferred
to Phase 12.

## 9. Safety / boundaries

Production: NO · Deploy: NO · DB: NO · Sends: NO · Payments: NO · Provider: NO · Real secrets: NO
(synthetic only) · AI API: NO · Network: NO · Disk: NO. No external repo / PolyGo touched. No secret
value appears in this report.

## 10. Residue / carry-forward

- Accepted-risk (documented): encoded/re-formatted exfiltration by a hostile registered `run` is out of
  scope — keep operations minimal and code-reviewed; owner-confirmation provenance must be enforced by a
  trusted UI/flow above this module.
- Carry-forward: Phase 6 (`OWNER-CHAT`) and later launcher/bridge phases will call operations through
  this broker; Phase 12 surfaces operation status in the Control Centre.

## 11. Next phase

`PROJECTOS-V3-OWNER-CHAT1A` (Phase 6).

---

**LOCAL STATUS: LOCAL IMPLEMENTATION COMPLETE — not accepted, not closed. Not pushed.**
