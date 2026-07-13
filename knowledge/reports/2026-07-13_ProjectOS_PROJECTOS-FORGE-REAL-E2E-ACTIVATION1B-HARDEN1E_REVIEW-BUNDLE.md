# ProjectOS — Forge Real-E2E Activation 1B — HARDEN1E — REVIEW BUNDLE

**Phase:** PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E — *Sandbox Execution Binding and Fail-Closed Operation Finalisation*
**Date:** 2026-07-13 · **Repo:** `C:\dev\ProjectOS` · **Branch:** `projectos-v3`
**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW**
**Governance:** Owner = Murad · Gatekeeper = ChatGPT · Implementer = Claude Code. This is a **local implementation + synthetic-validation** phase. No push. No real Claude worker. No Docker/Supabase. No install. No real Gates 1–3.

This is ONE self-contained file: **Part A** is the review report (all §20 sections); **Part B** is the full source of every changed file, inline.

---

## A1. Baseline (start of phase)

| Item | Value |
|---|---|
| Folder | `C:\dev\ProjectOS` |
| Branch | `projectos-v3` |
| HEAD (start) | `005a5a5` (HARDEN1D) |
| origin/projectos-v3 | `4c3f076` (FROZEN — unchanged) |
| ahead / behind vs frozen remote | 35 ahead / 0 behind (start); +1 corrective commit this phase |
| Working tree (start) | clean |
| `git diff --check` | clean |
| HARDEN1D commit | `005a5a5` present |
| ECC agents | security-reviewer, silent-failure-hunter, architect, code-reviewer (+ typescript/type-design/comment/simplifier) — **available** |
| Full ECC | available (4-surface parallel round run twice) |
| UI UX Pro Max | **available** (used for owner execution-state UI) |
| Claude Design (named product) | **UNAVAILABLE** → used ui-ux-pro-max + frontend-design equivalent; not fabricated |

Do-not list honoured throughout: no push, no deploy, no real sandbox install/activation, no real Claude worker, no Docker/Supabase start, no production/staging access, no DB mutation, no email/SMS/WhatsApp, no payments/refunds, no secret exposure, no metered OpenAI/Anthropic API, no Git-history rewrite.

## A2. What HARDEN1E corrects (findings addressed)

HARDEN1D closed the "declared vs executed" gap for the invocation and for workspace materialisation. HARDEN1E closes the remaining executable-identity, workspace-mount, lifecycle, termination, readiness and evidence gaps **before** any real sandbox provider exists:

1. **§4 Provider preparation + workspace custody** — a provider now MOUNTS the exact workspace and returns a prepared-operation descriptor that ProjectOS verifies (nothing but the workspace mounted; network disabled; every identity + hash matches). A caller-supplied hash alone is never accepted as proof of a mount.
2. **§5 Actual sandbox executable identity** — the host executable and the sandbox executable are treated as **distinct concepts**. ProjectOS resolves / hashes / versions the executable **inside** the provider and binds the SANDBOX facts (not the host's) to the detection record + attestation. Unresolvable / unmeasurable / mismatched ⇒ `BLOCKED-SANDBOX-EXECUTABLE-IDENTITY`.
3. **§6 Attestation binding** — the capability attestation is now bound to the prepared-operation id, the sandbox workspace path, the mount-policy hash, the pre-execution ledger, and the sandbox executable path/hash/version.
4. **§7 Exact invocation grammar** — for the first controlled-change proof exactly one 4-argument grammar is accepted `[mechanism, tools, -p, prompt]`, with a mechanism **registry** bound to CLI exe hash + version + detector version + policy version.
5. **§8 Single fail-closed operation finaliser** — every result after operation creation funnels through one finaliser; no post-spawn branch bypasses it.
6. **§9 Provider-error-after-handle ≠ NOT EXECUTED** — once a handle exists a provider error becomes TERMINATED-CONFIRMED+disposed or EMERGENCY-STOP.
7. **§10 Termination proof** — a confirmed termination additionally requires enumeration = 0, a terminal provider status, and a handle bound to the current operation; `confirmed=true` + processes-remain ⇒ EMERGENCY-STOP.
8. **§11 Provider-wait cancellation** — the host-timeout race aborts the provider wait (AbortSignal) and clears its own timer; no leaked timer/promise/callback.
9. **§12/§13 Readiness real-probe** — readiness materialises a real probe workspace, prepares/attests/resolves-exe/builds-argv/creates-handle/terminates/disposes, with all cleanup in an unconditional `finally`. No placeholder values; no default-pass ownership.
10. **§14/§15 Evidence** — operation evidence separates `capabilityDerived` (from the attestation canaries) from `operationObserved` (what actually happened); verify rejects contradictions.
11. **§16 Deterministic symlink equivalence** — a dependency-injected symlink primitive forces the fallback deterministically; real mode fails closed with no regular-file substitute, no env skip.

## A3. Prepared-operation architecture (§4)

Lifecycle: `materialise workspace → trusted materialisation + pre-execution ledger evidence → provider.prepareOperation(...) → provider mounts/imports the exact workspace → prepared-operation descriptor → ProjectOS verifies the descriptor → capability canaries against that prepared operation → ProjectOS verifies attestation → spawn using the same prepared operation`.

`prepareOperation({operationId, projectId, phaseId, workspaceId, hostWorkspacePath, hostWorkspacePathHash, materialisationManifestHash, preExecutionLedgerHash, networkPolicy, executableIdentity, mountPolicy})` returns a descriptor with: `preparedOperationId, providerId, providerVersion, providerImplementationHash, operationId, workspaceId, hostWorkspacePathHash, sandboxWorkspacePath, materialisationManifestHash, preExecutionLedgerHash, mountPolicyHash, canonicalMounted, otherProjectsMounted, homeMounted, credentialsMounted, networkPolicy, preparationTimestamp, preparationExpiry, preparationEvidenceHash`.

`verifyPreparedOperation` fails unless `canonicalMounted=false`, `otherProjectsMounted=false`, `homeMounted=false`, `credentialsMounted=false`, `networkPolicy="disabled"`, every identity/hash matches the current operation (ctx complete — a missing ctx field is a hard failure), the descriptor is unexpired, and `preparationEvidenceHash` is a valid sha256 of the descriptor. A mount / identity mismatch ⇒ `BLOCKED-WORKSPACE-MOUNT`; a malformed/expired descriptor ⇒ `BLOCKED-PROVIDER-PREPARATION`.

## A4. Host vs sandbox executable model (§5)

`buildExecutableIdentity` records `{hostRequestedExecutable, hostResolvedPath, hostContentHash, sandboxResolvedPath, sandboxContentHash, sandboxReportedVersion, providerId, preparedOperationId, identityEvidenceHash}`. The host path is captured for the record; the **authoritative** content-hash + version binding is enforced against the SANDBOX facts via `verifyExecutableIdentity`, which fails when the sandbox executable cannot be resolved / hashed / versioned, when the sandbox hash ≠ the detection record's `executableContentHash`, when the version mismatches, or when provider / prepared-op identity drifts. Missing ctx ⇒ hard failure (fixed in ECC round; see A17). The executable passed to `spawnOperation` is the **verified sandbox path**, never the host path. The adapter's step-4 host gate now only proves a real host binary exists (resolvable, not a shim, invocable) — it no longer equality-gates the host hash/version against the sandbox-bound values.

## A5. Actual workspace mount binding (§4/§6)

The attestation context carries `workspacePathInsideSandbox` (= `prep.sandboxWorkspacePath`), `mountPolicyHash` (of the canonical fail-closed `MOUNT_POLICY_FIRST_PROOF`), and `preExecutionLedgerHash`. `verifyAttestation`'s `REQUIRED_CTX` now includes all of these plus the sandbox executable path/hash/version and the prepared-operation id — each is a hard binding (missing ⇒ failure). The result contract persists `preparedOperationId`, `mountPolicyHash`, `sandboxWorkspacePath`, `sandboxExecutable{Path,Hash,Version}`, `sandboxExecutableIdentityHash`, and `invocationGrammarStatus`.

## A6. Exact invocation grammar (§7)

`verifyGrammar(argv, record, prompt, bindCtx)` accepts exactly `[mechanism, tools, "-p", prompt]`: exactly four arguments; mechanism / tools value / print flag each exactly once (scanning only the non-prompt positions — the prompt is DATA, never scanned); prompt is the final argument; no empty tool entry; deterministic (sorted) tool ordering; and the mechanism must be in the supported registry for the detected CLI version. `mechanismRegistry(bindCtx)` binds the supported set to `{executableContentHash, cliVersion, detectorVersion, policyVersion}`. This layers on top of HARDEN1D's argument-template token allowlist + `verifyInvocation` APPLIED-AND-VERIFIED check.

## A7. Central operation finaliser (§8/§9/§10)

After `spawnOperation`, the only returns are: `finalize(handle)` (normal), `finalize(handle, {pidReject})` (bare-PID rejection — routed THROUGH the finaliser so it terminates+confirms+disposes), and `emergencyStop(...)` from the outer catch (an exception once a handle exists). Spawn-threw-no-handle is the sole genuine `NOT EXECUTED`. Inside `finalize`, `proveTerminationAndDispose` gates disposal behind ALL of: `confirmed===true`, enumeration length 0, provider status `exited`, handle bound to `policy.operationId`. Any exception (`termination-exception` / `confirmation-exception` / `enumeration-exception` / `operation-status-exception`), any malformed status/enumeration, an unconfirmed termination, or a `confirmed=true`-but-processes-remain contradiction ⇒ `EMERGENCY-STOP-REQUIRED` (not an ordinary BLOCKED with TERMINATION-UNCONFIRMED). Disposal failure is the headline (`OPERATION-DISPOSAL-FAILED`) on every post-confirmation branch; a leftover **workspace** source tree escalates to `WORKSPACE-DISPOSAL-FAILED` on every branch via `done()` (fixed in ECC round).

## A8. Provider wait cancellation (§11)

`finalize` races `provider.waitForOperationExit(handle, {timeoutMs, maxOutputBytes, signal})` against a host-timeout backstop. When the backstop wins it calls `ac.abort()` (cancelling the provider wait via AbortSignal) and the timer is always cleared in `finally`. When the provider wait wins the host timer is cleared, so it never fires or aborts — no double termination, no leaked timer, no callback after disposal. The mock `waitForOperationExit` honours the signal, removes its abort listener, and clears its own timer/interval on settle. Validators 26–28 exercise host-timeout cancellation, prompt completion (no backstop wait), and abort-settles-the-promise.

## A9. Termination proof (§10)

See A7. A confirmed result requires `confirmed=true` AND enumeration=0 AND terminal status AND a bound handle AND a valid process-control evidence hash. `confirmed=true` with a non-empty enumeration is rejected as `termination-contradiction-processes-remain` (EMERGENCY). No destructive dispose occurs until termination is proven (validator 25 asserts `disposeOperation` is never called on the contradiction path).

## A10. Readiness real-probe model (§12) and probe cleanup (§13)

`realProbeLifecycle` (in `runtime-config.cjs`) creates a throwaway git repo, materialises a real probe workspace, prepares it through the provider, verifies the prepared descriptor, resolves+hashes+versions the sandbox executable and verifies its identity, attests the mounted probe, constructs the exact restricted argv, spawns an actual operation handle and verifies its type, and exercises process-scope termination (with a real independent sentinel for a non-mock provider). The `finally` unconditionally tears down: the probe operation, the sentinel, the prepared operation, provider residue, and the host workspace + throwaway repo. Any residue sets `cleanupOk=false`, which blocks ownership + termination readiness. There are **no** placeholder strings (`readiness-probe-ws/-path/-manifest` are gone). Ownership allows only PASS or BLOCKED-PROCESS-OWNERSHIP; a null / missing-handleType / crashed probe is BLOCKED — there is no default-pass path. `probeProcessControl` was rewritten to tear down its sentinel + operation on every path and report the real `sentinelCleaned` outcome (fixed in ECC round).

## A11. Capability-derived vs operation-observed evidence (§14/§15)

`operation-evidence.cjs` (schema `op-evidence-2.0`) splits `capabilityDerived` (canonical/other-project/credential/network denial CAPABILITY, from the attestation canaries) from `operationObserved` (actual workspace identity, actual executable identity, actual argv hash, process observations, network/canonical/credential attempts = `NOT OBSERVABLE` for this proof, termination result, disposal result, residue). `verifyOperationEvidence` rejects: a canary value substituted for an observation; `TERMINATED-CONFIRMED` with process count ≠ 0; `disposed` with non-empty residue; a completed outcome without a concrete terminal termination; evidence whose observed identity/argv doesn't echo the operation; timestamps out of order (evidence before exit); and a bad hash.

## A12. Persisted evidence model (§14)

On every operation branch the returned envelope carries `persistedEvidence = {providerPreparation, capabilityAttestationHash, executableIdentity, detectionRecordHash, invocationArgvHash, invocationGrammarStatus, invocationRestrictionStatus, operationEvidence, capabilityDerived, operationObserved}`. These are redacted, non-secret identifiers/hashes/paths only — never the prompt or any secret. Validators 41–42 assert the objects are persisted and that their hashes recompute (`operationEvidence.evidenceHash`, `preparationEvidenceHash`).

## A13. Symlink equivalence (§16)

`materialize(repoRoot, baseHead, {symlinkSync, realRun})` accepts a dependency-injected symlink primitive. A test forces it to throw AFTER a symlink entry is encountered. Proven (validator 43, no env skip): synthetic mode records the fallback and writes a substitute; **real** mode throws `WORKSPACE-MATERIALISATION-NOT-EQUIVALENT`, removes the partial workspace, and writes **no** regular-file substitute. Full `workspace-ledger.cjs` source is in Part B (§20 requirement).

## A14. Validator matrix + exact results (§17/§19)

`projectos/validators/validate-claude-worker.cjs` — **55 invariants: 51 (§17) + 4 ECC round-2 regressions**. Opt-in; NOT part of `npm run validate`.

- §5 host↔sandbox exe: 1 distinct concepts · 2 sandbox resolved · 3 hash bound · 4 version bound · 5 different exe refused
- §4 preparation: 6 prepared before attestation · 7 sandbox workspace path bound · 8 workspacePathInsideSandbox mismatch refused · 9 mount-policy mismatch refused · 10 pre-exec ledger mismatch refused · 11 spawn uses attested prepared op · 12 spawn uses verified sandbox exe
- §7 grammar: 13 exactly four args · 14 duplicate mechanism refused · 15 duplicate prompt refused · 16 unknown mechanism refused
- §8/§9/§10 finaliser: 17 provider error enters finaliser · 18 not NOT-EXECUTED when op may exist · 19 PID rejection confirms termination · 20 PID rejection disposes · 21 unexpected error → emergency when unconfirmed · 22 confirmed=true + non-empty enum rejected · 23 malformed enumeration → emergency · 24 terminal status required · 25 no dispose before confirmed zero processes
- §11 cancellation: 26 host timeout cancels provider wait · 27 completed wait clears host timeout · 28 no callback after disposal
- §12/§13 readiness: 29 real probe workspace · 30 no placeholder evidence · 31 null handle blocks · 32 missing handleType blocks · 33 crash blocks · 34 probe op cleaned in finally · 35 sentinel cleaned in finally · 36 cleanup failure blocks
- §14/§15 evidence: 37 capability-derived labelled · 38 operation-observed labelled · 39 confirmed requires zero processes · 40 disposed requires empty residue · 41 evidence persisted · 42 hashes recompute
- §16 symlink: 43 deterministic failure blocks real execution · 44 workspace-ledger source in bundle
- governance/hygiene: 45 no self-approve/close · 46 no metered AI API · 47 no prod/provider/send/payment · 48 canonical monitored state stable · 49 residue accounted · 50 tmpdir-only (working tree clean) · 51 remote frozen
- ECC round-2 regressions: 52 non-mock bare-PID rejected without realRun · 53 emergency reports preservation FAILED (not fabricated) · 54 exe-identity fails on incomplete ctx · 55 workspace-disposal failure escalates on a killed run

**Exact results:**
- `node projectos/validators/validate-claude-worker.cjs` → **PASS (55 invariants, 0 skipped)**
- `npm run validate` (validate-all) → **ALL PASS (61)**
- `git diff --check` → **clean**
- capability (no config) → **BLOCKED-SANDBOX-IMPLEMENTATION** (`SYNTHETIC validation: READY`)
- temporary residue after a validator run → **0** (`pos-ws-*`/`pos-rp-*`/`cw-can-*`)

## A15. Full ECC findings + resolution

Two parallel 4-surface rounds (round 1 on the initial implementation; round 2 on the fixed source). All CONFIRMED HIGH/CRITICAL fixed; each locked with a regression invariant where testable.

**Round 1 (6 CONFIRMED):**
- CRITICAL (security) — bare-PID handle rejection gated only on `requireReal`; a non-mock provider without the flag could reach a false COMPLETED. **Fixed:** guard is now `(requireReal || provider.kind !== "mock")`. Invariant 52.
- HIGH (security) — `verifyExecutableIdentity` used `if (ctx.X && …)` conditional binding (fail-open contract). **Fixed:** missing ctx field ⇒ hard failure. Invariant 54.
- CRITICAL (silent-failure) — `emergencyStop` fabricated "evidence preserved" when `preserveOperationEvidence` threw. **Fixed:** real outcome captured; `not-disposed-evidence-preservation-failed` + a risk line. Invariant 53.
- HIGH (silent-failure) — `probeProcessControl` cleaned the sentinel only on the success path; `sentinel="cleaned"` was hardcoded. **Fixed:** unconditional `finally` tears down sentinel + operation; `sentinelCleaned` is real and feeds `cleanupOk`.
- HIGH (silent-failure) — `realSentinel` spawned a child with no `'error'` listener (could crash the host). **Fixed:** `'error'` listener; a spawn failure reports the sentinel dead (fails closed).
- HIGH (silent-failure) — workspace-disposal residue was folded into a field on non-success finalize branches, not gated like operation disposal. **Fixed:** `done()` escalates to `WORKSPACE-DISPOSAL-FAILED` (unless OPERATION-DISPOSAL-FAILED already dominates). Invariant 55.

**Round 2 (architecture CLEAN on HIGH/CRITICAL; code/dup found 1 CRITICAL + 1 HIGH latent + dup notes):**
- CRITICAL (code) — `canonicalJson` cycle detection never popped `seen`, so a legitimate DAG (shared sub-object referenced twice) would corrupt the hash. Dormant (no current hashed input shares a reference) but it is the hashing backbone. **Fixed:** ancestor-chain tracking (add on entry, delete on exit); true cycles still collapse to null; verified a DAG now hashes identically to two copies, with no change to any cycle-free hash.
- HIGH (code) — `DISPOSAL_STATUSES` omitted `not-disposed-evidence-preservation-failed` (produced by the emergency path). Latent (verify runs only on the clean path today). **Fixed:** value added to the enum.
- MEDIUM (architecture) — post-disposal clean-exit `ledger.snapshot/diff/manifest` not wrapped; a throw would propagate to the outer catch and fabricate a false EMERGENCY for an already-completed+disposed op. **Fixed:** wrapped → `post-execution-ledger-failed` (an ordinary BLOCKED, workspace disposed).
- MEDIUM (code, dead-code) — dead `verMatch`/`sha256File`/`crypto` in `runtime-config.cjs`. **Fixed:** removed.

## A16. UI UX Pro Max findings

Applied to the owner-facing execution states in `owner-readiness-report.cjs`: `EXECUTION_STATES` gives each blocked/emergency state six explicit facts — what failed, whether a process may still exist, whether evidence was preserved, whether cleanup occurred, the single next owner action, and what must NOT be done. `renderExecutionState` (terminal) and `renderExecutionHtml` (self-contained, offline) both render them; the HTML reuses the existing readiness visual system (security-first hierarchy, text+icon not colour-only, 4.5:1, light+dark, reduced-motion). New readiness recovery/next-action strings added for the HARDEN1E reasons (executable identity, mount, preparation, probe cleanup).

## A17. Claude Design

**UNAVAILABLE** as a named generative product in this environment (only a Vercel `import-claude-design-from-url` tool exists, which needs an external URL). Used ui-ux-pro-max + the frontend-design equivalent instead. Not fabricated.

## A18. Claude self-review

- Re-read the finaliser end-to-end: confirmed single-funnel (no post-spawn bypass), correct ordering, disposal gated behind full termination proof, and idempotent `disposeAll`.
- Confirmed readiness uses the SAME verifiers as the adapter and that a mock can never reach READY-FOR-REAL.
- Verified every new reason/enum value is within its declared allowed set (result contract, termination enum, disposal enum, invocation status, grammar status).
- Verified no secret path: prompt is pre-screened, env is a minimal allowlist with a tokenish-name denylist, output is scrubbed, persisted evidence is hashes/paths only.
- Re-ran the full gate after every material change; final state green.

## A19. Unresolved limitations (honest)

- **Integrity, not authenticity.** All evidence hashes are sha256 over canonical JSON — they detect post-hoc mutation, not a compromised provider. A malicious provider that computes self-consistent hashes is out of scope for this layer; real prevention is the OS sandbox itself. Documented, unchanged from prior phases.
- **Not itself an OS sandbox.** No real provider is installed; real runs are BLOCKED. The mock proves the contracts synthetically and is refused for real runs.
- **Windows real-run executable constraint (ECC note).** `.cmd/.bat/.ps1` shims are refused by design (they re-enter `cmd.exe` even with `shell:false`). A stock npm-global Claude install on Windows resolves to a `.cmd`/`.ps1` shim, so a real run needs a genuine native binary path (or a vetted wrapper). This is a deliberate, accepted security constraint — surfaced here so it is understood as a real-run prerequisite, not a bug.
- **Duplication-drift follow-ups (MEDIUM, deferred — not requested now):** consolidate the canonical-hash helpers (`hashObj`/`hashPrepared`/`hashExeIdentity`/`hashEvidence`/`hashAttestation`/`hashRecord`/`hashTemplate`/`mountPolicyHash`) and the two hashing philosophies (`canonicalJson` vs pre-sorted `JSON.stringify`) into one hash-util; extract shared `GIT_MAXBUF`, the `UNSAFE_SHIM` regex, and the readiness `CHECK_TITLES`/recovery maps; remove the remaining pre-existing dead `isUnsafeShim` in `worker-policy.cjs`. All are self-consistent today (never cross-compared); flagged to prevent a future silent divergence.
- **Operation-observed network/canonical/credential attempts are `NOT OBSERVABLE`** for the first proof — the run does not yet instrument the worker's syscalls; this is stated honestly rather than asserted as "denied".
- `verifyOperationEvidence` is applied on the clean-completion path; applying it to emergency/persisted evidence in audit tooling is a documented future step (the enum is now ready for it).

## A20. Change control

| Item | Value |
|---|---|
| Files changed | 11 (10 bridge `.cjs` + 1 validator) — see numstat below |
| Deleted source files | none |
| Branch | `projectos-v3` |
| Commit (this phase) | see repo tip after the single corrective commit |
| Remote | `origin/projectos-v3` = `4c3f076` — **FROZEN, unchanged** |
| Ahead / behind | 36 ahead / 0 behind after this commit |
| Push status | **NOT PUSHED** |

**numstat (added / removed vs `005a5a5`):**
```
30	11	projectos/bridge/attestation.cjs
199	90	projectos/bridge/claude-worker.cjs
56	2	projectos/bridge/invocation-detector.cjs
106	34	projectos/bridge/operation-evidence.cjs
5	0	projectos/bridge/owner-capability-check.cjs
82	13	projectos/bridge/owner-readiness-report.cjs
125	44	projectos/bridge/runtime-config.cjs
168	26	projectos/bridge/sandbox-provider.cjs
16	0	projectos/bridge/worker-policy.cjs
17	5	projectos/bridge/workspace-ledger.cjs
162	109	projectos/validators/validate-claude-worker.cjs
```

**No-X proofs:** remote SHA unchanged at `4c3f076`; no `git push` run; no real worker executed (real runs BLOCKED, mock refused for real); no Docker/Supabase started; no install; no metered API (source scan invariant 46); no prod/provider/send/payment (invariant 47); no secret in source/evidence/report.

## A21. Decision required

ChatGPT review of HARDEN1E. If accepted, the next gate is a **real sandbox provider on an owner machine** (Gates 1–3) — not started here. No push / close / accept / PLAN READY / READY-FOR-REAL-WORKER-PROOF without the owner/ChatGPT gate.

---

# Part B — Full source of every changed file

Order: the 10 bridge modules, then the validator. `workspace-ledger.cjs` is included in full per §16/§20.

## projectos/bridge/attestation.cjs

```javascript
"use strict";
/**
 * Operation-bound sandbox attestation contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§4).
 *
 * Replaces the boolean `attest().enforced === true` with a STRUCTURED, OPERATION-BOUND attestation that a
 * real provider produces by running CANARIES through the SAME sandbox boundary that will run the worker.
 * The adapter verifies the attestation belongs to THIS operation + workspace + provider instance, is
 * unexpired, covers every mandatory canary with no FAIL, matches the executable + policy, and is unmodified
 * (evidenceHash). A provider returning only `{ enforced: true }` fails every check.
 *
 * This module defines + VERIFIES the contract. It does NOT run a real sandbox; the mock provider generates a
 * SYNTHETIC attestation (labelled) that is still refused for real runs by the sandbox gate.
 */

const crypto = require("crypto");

const SCHEMA_VERSION = "attestation-1.0";
const MANDATORY_CANARIES = [
  "canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary",
  "networkCanary", "writablePathCanary", "childProcessContainmentCanary", "cleanupCanary",
  "emergencyTerminationCanary",
];
const REQUIRED_FIELDS = [
  "schemaVersion", "providerId", "providerVersion", "providerImplementationHash", "preparedOperationId",
  "operationId", "projectId", "phaseId", "workspaceId", "workspacePathHash", "materialisationManifestHash",
  "workspacePathInsideSandbox", "mountPolicyHash", "preExecutionLedgerHash",
  "executableResolvedPathInsideSandbox", "sandboxExecutablePath", "sandboxExecutableHash", "sandboxExecutableVersion",
  "timestamp", "expiry", "overallResult", "evidenceHash",
].concat(MANDATORY_CANARIES);

// Canaries whose EXPECTED result is that the access is denied / not reachable.
const DENY_CANARIES = ["canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary", "networkCanary"];
// The ONLY safe `expected` value per canary — pinned by the verifier so a provider cannot self-choose a
// permissive expectation and pass. actual must equal this exact value (and result must be PASS).
const CANARY_EXPECTED = { canonicalPathCanary: "denied", otherProjectPathCanary: "denied", homePathCanary: "denied", credentialPathCanary: "denied", networkCanary: "denied", writablePathCanary: "allowed", childProcessContainmentCanary: "contained", cleanupCanary: "complete", emergencyTerminationCanary: "confirmed" };
// Context fields the caller MUST supply for binding — a missing one is a verification failure, never skipped.
// §6 grows this: the capability attestation is bound to the PREPARED operation, the exact mount policy, the
// pre-execution ledger, and the ACTUAL SANDBOX executable identity (path/hash/version) — not the host's.
const REQUIRED_CTX = [
  "providerId", "providerVersion", "providerImplementationHash", "preparedOperationId", "operationId",
  "projectId", "phaseId", "workspaceId", "workspacePathHash", "materialisationManifestHash",
  "workspacePathInsideSandbox", "mountPolicyHash", "preExecutionLedgerHash",
  "executableResolvedPathInsideSandbox", "sandboxExecutablePath", "sandboxExecutableHash", "sandboxExecutableVersion",
];

function canonicalJson(obj) {
  // deterministic stringify (sorted keys) so the hash is stable across key order. Cycle detection tracks only
  // the CURRENT ancestor chain (add on entry, delete on exit) — a true cycle (a back-edge to an ancestor) still
  // collapses to null, but a legitimate DAG (the same sub-object referenced twice as siblings) serialises
  // correctly BOTH times, so two logically-identical inputs never hash differently.
  const ancestors = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === "object") {
      if (ancestors.has(v)) return null; // back-edge to an ancestor ⇒ real cycle
      ancestors.add(v);
      let out;
      if (Array.isArray(v)) out = v.map(norm);
      else { out = {}; for (const k of Object.keys(v).sort()) out[k] = norm(v[k]); }
      ancestors.delete(v); // pop: v is no longer on the ancestor chain
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}
function hashAttestation(att) {
  const copy = Object.assign({}, att); delete copy.evidenceHash;
  return crypto.createHash("sha256").update(canonicalJson(copy)).digest("hex");
}

/** A well-formed canary result. */
function makeCanary(attempted, expected, actual, evidence) {
  const pass = String(actual) === String(expected);
  return { attempted, expected, actual, result: pass ? "PASS" : "FAIL", evidence: String(evidence || "").slice(0, 200) };
}

/**
 * Verify an attestation against the CURRENT operation context. Returns { ok, errors }.
 * @param att  the attestation object returned by provider.attest(ctx)
 * @param ctx  { providerId, operationId, projectId, phaseId, workspaceId, executableResolvedPathInsideSandbox, now }
 */
function verifyAttestation(att, ctx) {
  const errors = [];
  const c = ctx || {};
  if (!att || typeof att !== "object") return { ok: false, errors: ["attestation: not an object (a bare { enforced:true } fails)"] };
  for (const f of REQUIRED_FIELDS) if (!(f in att)) errors.push("attestation: missing '" + f + "'");
  if (att.schemaVersion !== SCHEMA_VERSION) errors.push("attestation: bad schemaVersion");

  // binding to THIS operation / workspace / provider / executable — the ctx MUST be complete (a missing ctx
  // field is a failure, not a silently-skipped binding).
  for (const k of REQUIRED_CTX) { if (c[k] === undefined || c[k] === null) { errors.push("attestation: incomplete verification context (missing " + k + ")"); continue; } if (att[k] !== c[k]) errors.push("attestation: " + k + " does not match the current operation"); }

  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof att.timestamp !== "number" || typeof att.expiry !== "number") errors.push("attestation: timestamp/expiry must be numbers");
  else { if (att.expiry <= now) errors.push("attestation: expired"); if (att.timestamp > now + 60000) errors.push("attestation: timestamp is in the future"); }

  // every mandatory canary present, well-formed, PASS, and pinned to its ONLY safe expected value — a
  // provider cannot self-choose a permissive `expected`.
  for (const name of MANDATORY_CANARIES) {
    const k = att[name];
    if (!k || typeof k !== "object") { errors.push("attestation: canary '" + name + "' missing/malformed"); continue; }
    if (!("attempted" in k) || !("expected" in k) || !("actual" in k) || !("result" in k)) errors.push("attestation: canary '" + name + "' incomplete");
    if (k.result !== "PASS") errors.push("attestation: canary '" + name + "' is not PASS");
    if (String(k.expected) !== CANARY_EXPECTED[name]) errors.push("attestation: canary '" + name + "' expected must be '" + CANARY_EXPECTED[name] + "'");
    if (String(k.actual) !== CANARY_EXPECTED[name]) errors.push("attestation: canary '" + name + "' actual is not '" + CANARY_EXPECTED[name] + "'");
  }
  if (att.overallResult !== "PASS") errors.push("attestation: overallResult is not PASS");

  // integrity — the hash MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash fails,
  // it never skips the check). NOTE: this is an INTEGRITY hash, not an authenticity MAC — it detects post-hoc
  // mutation, not a compromised provider (see the module header / report trust boundary).
  if (typeof att.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(att.evidenceHash)) errors.push("attestation: evidenceHash missing/invalid");
  else if (hashAttestation(att) !== att.evidenceHash) errors.push("attestation: evidenceHash mismatch (modified)");

  return { ok: errors.length === 0, errors };
}

/**
 * Build a SYNTHETIC attestation for a mock provider (labelled). Bound to the supplied context; all deny
 * canaries "PASS" by asserting the access was denied/unreachable. Refused for real runs by the sandbox gate
 * (kind: mock) regardless — this only proves the VERIFIER accepts a well-formed operation-bound attestation.
 */
function syntheticAttestation(ctx, opts) {
  const o = opts || {};
  const now = typeof (o.now) === "number" ? o.now : Date.now();
  const c = ctx || {};
  const denied = (what) => makeCanary("access " + what, "denied", o.fail === what ? "reachable" : "denied", "synthetic");
  const contained = (what) => makeCanary(what, "contained", o.fail === what ? "escaped" : "contained", "synthetic");
  const sandboxExePath = c.sandboxExecutablePath || c.executableResolvedPathInsideSandbox || "/sandbox/bin/claude";
  const att = {
    schemaVersion: SCHEMA_VERSION,
    providerId: c.providerId || null, providerVersion: o.providerVersion || "mock-0", providerImplementationHash: o.providerImplementationHash || "mock-hash",
    preparedOperationId: c.preparedOperationId || null,
    operationId: c.operationId || null, projectId: c.projectId || null, phaseId: c.phaseId || null,
    workspaceId: c.workspaceId || null, workspacePathHash: c.workspacePathHash || null, materialisationManifestHash: c.materialisationManifestHash || null,
    workspacePathInsideSandbox: c.workspacePathInsideSandbox || o.workspacePathInsideSandbox || "/sandbox/workspace",
    mountPolicyHash: c.mountPolicyHash || null, preExecutionLedgerHash: c.preExecutionLedgerHash || null,
    executableResolvedPathInsideSandbox: sandboxExePath, sandboxExecutablePath: sandboxExePath,
    sandboxExecutableHash: c.sandboxExecutableHash || null, sandboxExecutableVersion: c.sandboxExecutableVersion || null,
    timestamp: now, expiry: now + (o.ttlMs || 300000),
    canonicalPathCanary: denied("canonical-repo"), otherProjectPathCanary: denied("other-projects"),
    homePathCanary: denied("home"), credentialPathCanary: denied("credentials"), networkCanary: denied("network"),
    writablePathCanary: makeCanary("write inside workspace", "allowed", o.fail === "writable" ? "denied" : "allowed", "synthetic"),
    childProcessContainmentCanary: contained("child-process"), cleanupCanary: makeCanary("cleanup", "complete", o.fail === "cleanup" ? "residue" : "complete", "synthetic"),
    emergencyTerminationCanary: makeCanary("emergency-terminate", "confirmed", o.fail === "emergency" ? "unconfirmed" : "confirmed", "synthetic"),
    overallResult: "PASS",
  };
  // overallResult reflects the canaries
  const anyFail = MANDATORY_CANARIES.some((n) => att[n].result !== "PASS");
  att.overallResult = anyFail ? "FAIL" : "PASS";
  if (o.omitCanary) delete att[o.omitCanary];
  att.evidenceHash = hashAttestation(att);
  if (o.tamper) att.workspacePathInsideSandbox = "/tampered"; // do NOT re-hash → evidenceHash mismatch
  return att;
}

module.exports = { verifyAttestation, syntheticAttestation, makeCanary, hashAttestation, canonicalJson, SCHEMA_VERSION, MANDATORY_CANARIES, REQUIRED_FIELDS, DENY_CANARIES, CANARY_EXPECTED, REQUIRED_CTX };

```

## projectos/bridge/claude-worker.cjs

```javascript
"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C.
 *
 * Operation-bound, technically-verified pipeline (fail-closed at every gate):
 *   policy tamper/content
 *     → SANDBOX (fail-closed; real ⇒ non-mock) → FIRST-PROOF NETWORK must be DISABLED (allowlist refused)
 *     → STRUCTURED OPERATION-BOUND ATTESTATION verified (canaries; not a boolean) → EXECUTABLE (shared checker,
 *       provider-permitted) → TOOL-RESTRICTION DETECTION RECORD verified (bound to exe hash + version)
 *     → canonical baseline (strict git) → MATERIALISE .git-free workspace → FS snapshot BEFORE
 *     → provider.spawnOperation (STABLE operation handle, not a bare PID) → bounded output/timeout
 *     → CONFIRM via the operation HANDLE (clean exit never kills a reused PID) — unconfirmed ⇒ EMERGENCY-STOP
 *       (preserve evidence, no reconcile) → FS snapshot AFTER → TRUSTED FS DIFF → enforce every path
 *     → monitored-state reconcile → dispose → schema-v2 result (termination as an ENUM; no apply/commit/gate)
 *
 * HONEST SCOPE: OS-level PREVENTION is delivered by the sandbox provider (verified via operation-bound
 * canary attestation), not this wrapper. No real provider is installed here ⇒ real runs BLOCKED. Claude cannot
 * approve/close.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { createRedactor } = require("../security/redaction.cjs");
const P = require("./worker-policy.cjs");
const ledger = require("./workspace-ledger.cjs");
const sandbox = require("./sandbox-provider.cjs");
const attestation = require("./attestation.cjs");
const detector = require("./invocation-detector.cjs");
const opEvidence = require("./operation-evidence.cjs");
const execcheck = require("./executable-check.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024;

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
function gitStrict(repoRoot, args) { return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", maxBuffer: GIT_MAXBUF }); }
function gitLine(repoRoot, args) { return gitStrict(repoRoot, args).trim(); }
function refused(reason, extra) { return Object.assign({ ok: false, decision: "REFUSED", reason }, extra || {}); }
function blocked(reason, extra) { return Object.assign({ ok: false, decision: "BLOCKED", reason }, extra || {}); }
function emergency(reason, extra) { return Object.assign({ ok: false, decision: "EMERGENCY-STOP", reason }, extra || {}); }
function resolveGitDir(repoRoot, answer) { return path.isAbsolute(answer) ? answer : path.resolve(repoRoot, answer); }

function monitorSnapshot(repoRoot, opts) {
  const o = opts || {};
  const status = gitStrict(repoRoot, ["status", "--porcelain"]).trim();
  const ignoredList = gitStrict(repoRoot, ["status", "--porcelain", "--ignored", "--untracked-files=all", "-z"]);
  const tracked = gitStrict(repoRoot, ["ls-files", "-z"]).split("\0").filter(Boolean).sort();
  const files = {}; let unverifiable = 0;
  for (const rel of tracked) { try { files[rel] = ledger.sha256File(path.join(repoRoot, rel)); } catch (e) { files[rel] = "MISSING"; unverifiable++; } }
  let deepInventory = "off";
  if (o.deepIgnored) {
    const deep = {}; const paths = ignoredList.split("\0").filter(Boolean).map((rec) => rec.slice(3)).sort();
    for (const rel of paths) { const abs = path.join(repoRoot, rel); try { if (fs.statSync(abs).isFile()) deep[rel] = ledger.sha256File(abs); } catch (e) { deep[rel] = "ERR"; } }
    deepInventory = sha256(JSON.stringify(deep));
  }
  return { toplevel: gitLine(repoRoot, ["rev-parse", "--show-toplevel"]), origin: safeOrigin(repoRoot), branch: gitLine(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]), head: gitLine(repoRoot, ["rev-parse", "HEAD"]), status, ignoredInventory: sha256(ignoredList), deepInventory, filesHash: sha256(JSON.stringify(files)), metaHash: gitMetaDigest(repoRoot), unverifiable };
}
function safeOrigin(repoRoot) { try { return gitLine(repoRoot, ["remote", "get-url", "origin"]); } catch (e) { return /no such remote|No such/i.test(String(e.message)) ? "no-origin" : "origin-unreadable"; } }
function gitMetaDigest(repoRoot) {
  const common = resolveGitDir(repoRoot, gitLine(repoRoot, ["rev-parse", "--git-common-dir"]));
  const parts = [];
  const addFile = (p) => { try { if (fs.existsSync(p)) parts.push(p + ":" + sha256(fs.readFileSync(p))); } catch (e) { parts.push(p + ":ERR"); } };
  for (const f of ["config", "HEAD", "packed-refs"]) addFile(path.join(common, f));
  for (const f of ["exclude", "attributes", "sparse-checkout"]) addFile(path.join(common, "info", f));
  const walk = (dir, tag) => { let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { parts.push(dir + ":READDIR-ERR"); return; } for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) { const full = path.join(dir, e.name); if (e.isSymbolicLink()) { try { parts.push(full + ":LINK:" + sha256(fs.readlinkSync(full))); } catch (er) { parts.push(full + ":LINKERR"); } } else if (e.isDirectory()) walk(full, tag); else if (e.isFile()) { if (tag === "hooks" && e.name.endsWith(".sample")) continue; addFile(full); } } };
  walk(path.join(common, "refs"), "refs"); walk(path.join(common, "hooks"), "hooks");
  return sha256(parts.sort().join("|"));
}
function monitorDrift(a, b) { return ["toplevel", "origin", "branch", "head", "status", "ignoredInventory", "deepInventory", "filesHash", "metaHash"].filter((k) => a[k] !== b[k]); }

async function runClaudeWorker(req, config) {
  const r = req || {}; const c = config || {};
  const redactor = c.redactor || createRedactor();
  const base = { projectId: r.projectId || null };
  const out = (env, extra) => {
    const fields = Object.assign({}, base, { outcome: env.decision, reason: env.reason || null }, extra || {});
    let res; try { res = P.buildResult(fields); } catch (e) { try { console.error("[claude-worker] result build error: " + e.message); } catch (_) {} return Object.assign({}, env, { resultBuildError: e.message }); }
    return Object.assign({}, env, { result: res });
  };
  // Pre-spawn refusals: no process ever existed ⇒ termination NOT APPLICABLE.
  const na = (env, extra) => out(env, Object.assign({ processTerminationStatus: "NOT APPLICABLE" }, extra || {}));

  // 1) Request tamper + content.
  const { policy, violations } = P.resolvePolicy(r, c);
  Object.assign(base, { operationId: policy.operationId, phaseId: policy.phaseId });
  if (violations.length) return na(refused("request-policy-tamper", { violations }), { refusedPaths: violations });
  if (typeof r.prompt !== "string" || !r.prompt.trim()) return na(refused("empty-prompt"));
  if (r.prompt.length > policy.maxPromptChars) return na(refused("prompt-too-long"));
  if (P.promptHasRawSecret(r.prompt)) return na(refused("prompt-contains-raw-secret"));
  if (typeof r.projectId !== "string" || !r.projectId) return na(refused("no-project"));
  if (!policy.repoRoot) return na(refused("no-trusted-root"));
  if (P.allowlistTouchesProjectos(policy)) return na(refused("allowlist-touches-projectos"));
  if (r.prompt.trim().startsWith("-")) return na(refused("prompt-looks-like-flag"));

  // 2) Sandbox (fail-closed). requireReal forces a non-mock provider.
  const requireReal = !!c.realRun || !!c.requireExecInvoke;
  const sb = sandbox.resolveSandbox(c, { requireReal });
  if (!sb.ok) return na(blocked("OS-SANDBOX-" + sb.reason.replace(/^OS-SANDBOX-/, ""), { errors: sb.errors }));
  const provider = sb.provider;
  const sandboxPolicy = sandbox.policySummary(provider);

  // 3) FIRST-PROOF NETWORK POLICY: must be disabled (no allowlist / DNS / localhost / registries / remotes).
  if (provider.networkPolicy !== "disabled") return na(blocked("BLOCKED-NETWORK-POLICY", { networkPolicy: provider.networkPolicy }));

  // 4) HOST executable presence. §5: the host executable and the SANDBOX executable are DISTINCT concepts. Here
  //    we only prove a REAL host binary exists (resolvable, not a shim, invocable) and capture its identity for
  //    the record. The authoritative content-hash + version BINDING is enforced against the SANDBOX executable
  //    identity measured INSIDE the sandbox (step 10) — never the host path.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-configured" }));
  if (provider.kind !== "mock" && Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-in-provider-permitted-executables" }));
  let exeResolved = provider.kind === "mock" ? "/sandbox/bin/claude" : null;
  let hostExeHash = null;
  if (requireReal || provider.kind !== "mock") {
    let ev; try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-check-crashed", detail: String(e.message).slice(0, 120) })); }
    if (!ev.ok) return na(blocked("BLOCKED-EXECUTABLE", { execReason: ev.reason, resolvedPath: ev.resolvedPath || null }));
    exeResolved = ev.resolvedPath;
    try { hostExeHash = sha256(fs.readFileSync(ev.resolvedPath)); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-unreadable" })); }
  }
  // NB: a caller `claudeArgs` function is intentionally NOT consulted — ProjectOS builds the final argv itself
  // from the verified detection record (§3). An arbitrary callback can never control the real invocation.

  // 5) TOOL-RESTRICTION DETECTION RECORD verified (bound to exe hash + version + provider + policy + template).
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider.providerId, policyVersion: c.policyVersion, now: c.now, firstControlledChange: true });
  if (!dv.ok) return na(blocked("WORKER-TOOL-RESTRICTION-NOT-PROVEN", { errors: dv.errors }));
  const permittedTools = (c.detectionRecord && c.detectionRecord.permittedTools) || [];

  // 6) Canonical baseline (strict git; fails closed).
  const repoRoot = policy.repoRoot;
  let before;
  try { const tl = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]); if (path.resolve(tl) !== path.resolve(repoRoot)) return na(refused("root-not-git-toplevel", { toplevel: tl })); before = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); }
  catch (e) { return na(blocked("baseline-snapshot-failed", { detail: String(e.message).slice(0, 160) })); }
  if (!before.head) return na(blocked("baseline-head-unresolved"));
  if (policy.expectedRemote && before.origin !== policy.expectedRemote) return na(refused("remote-mismatch", { origin: before.origin }));
  if (policy.expectedBranch && before.branch !== policy.expectedBranch) return na(refused("branch-mismatch", { branch: before.branch }));
  if (policy.requireClean && before.status) return na(refused("working-tree-dirty"));
  Object.assign(base, { toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: before.branch, finalHead: before.head });

  // 7) Materialise the .git-free workspace FIRST (before prepare/attestation). A real-run symlink fallback that
  //    is not type-equivalent to the baseline fails closed (§11/§16). workspaceId is UNIQUE and ≠ operationId.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head, { realRun: requireReal }); }
  catch (e) { const eq = /NOT-EQUIVALENT/.test(String(e.message)); return na(blocked(eq ? "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT" : "workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace; const workspaceId = mat.workspaceId;
  let disposed = false, preserve = false;
  const disposeAll = () => { if (c.keepWorkspace) return ["kept-by-config:" + workspace]; if (disposed || preserve) return []; disposed = true; return ledger.dispose(workspace); };

  // Mutable evidence holders — assigned as the pre-spawn gates pass; read by evFields()/commonResult() at return.
  const wsBefore = ledger.snapshot(workspace);
  const preExecutionLedgerHash = ledger.hashSnapshot(wsBefore);
  let prep = null, exeIdentity = null, att = null;
  let sandboxExePath = null, sandboxExeHash = null, sandboxExeVersion = null;
  let providerCapabilityAttestationHash = null, invocationArgvHash = null;
  let invocationRestrictionStatus = "NOT VERIFIED", invocationGrammarStatus = "NOT VERIFIED";
  let capabilityDerivedObj = { canonicalDenialCapability: "not-evaluated", otherProjectDenialCapability: "not-evaluated", credentialDenialCapability: "not-evaluated", networkDenialCapability: "not-evaluated" };
  const mountPolicy = sandbox.MOUNT_POLICY_FIRST_PROOF;
  const expectedMountPolicyHash = sandbox.mountPolicyHash(mountPolicy);
  const canaryOf = (a, n) => (a && a[n] && a[n].actual) || "not-evaluated";

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree", "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape", "timeout", "output-cap", "fail-closed-sandbox-gate", "provider-prepared-operation", "workspace-mount-custody", "sandbox-executable-identity", "workspace-bound-attestation", "detection-record-verification", "exact-invocation-binding", "exact-invocation-grammar", "shared-executable-check", "provider-permitted-executable", "first-proof-network-disabled", "provider-operation-handle", "provider-wait-cancellation", "single-fail-closed-finaliser", "mandatory-operation-disposal"];
  const evFields = () => ({
    invocationArgvHash, invocationRestrictionStatus, invocationGrammarStatus, providerCapabilityAttestationHash, preExecutionLedgerHash,
    preparedOperationId: prep && prep.preparedOperationId, preparedOperationVerified: !!prep,
    mountPolicyHash: prep && prep.mountPolicyHash, sandboxWorkspacePath: prep && prep.sandboxWorkspacePath,
    sandboxExecutablePath: sandboxExePath, sandboxExecutableHash: sandboxExeHash, sandboxExecutableVersion: sandboxExeVersion,
    sandboxExecutableIdentityHash: exeIdentity && exeIdentity.identityEvidenceHash,
  });
  const wsFields = { workspaceId, materialisationManifestHash: mat.materialisationManifestHash, materialiseWarnings: mat.symlinkFallbacks || [] };
  const controlsFor = (killConfirmed, toolsApplied) => ({ technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []).concat(toolsApplied ? ["exact-invocation-restriction-applied"] : []), policyRequested: ["worker-tool-restriction"], delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"], notVerified: killConfirmed ? [] : ["process-termination-confirm"], outOfScope: [] });
  const commonBase = () => Object.assign({ sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy, canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy, workerToolsPermitted: permittedTools, workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE", projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"], filesInspectionStatus: "NOT OBSERVABLE", processControlProvider: provider.providerId }, wsFields, evFields());
  const commonResult = (kc, toolsApplied) => Object.assign(commonBase(), { controls: controlsFor(kc, toolsApplied), workerToolsVerified: toolsApplied ? "APPLIED AND VERIFIED" : "NOT VERIFIED" });
  // Post-materialise refusal that always disposes the workspace (no process ran ⇒ termination NOT APPLICABLE).
  const postMat = (env, extra, toolsApplied) => out(env, Object.assign({}, commonResult(false, toolsApplied), { processTerminationStatus: "NOT APPLICABLE", residue: disposeAll() }, extra || {}));

  // 8) §4 PROVIDER PREPARATION + WORKSPACE CUSTODY — the provider mounts the EXACT workspace and returns a
  //    descriptor bound to this operation. Verified fail-closed: nothing but the workspace mounted, network
  //    disabled, every identity+hash matches, integrity valid. A caller-supplied hash alone is never accepted.
  try { prep = provider.prepareOperation({ operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, workspaceId, hostWorkspacePath: workspace, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash, networkPolicy: provider.networkPolicy, executableIdentity: null, mountPolicy }); }
  catch (e) { prep = null; }
  const pv = sandbox.verifyPreparedOperation(prep, { operationId: policy.operationId, workspaceId, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash, mountPolicyHash: expectedMountPolicyHash, providerId: provider.providerId, now: c.now });
  if (!pv.ok) { const mount = pv.errors.some((e) => /mounted|networkPolicy|does not match/.test(e)); prep = (prep && typeof prep === "object") ? prep : null; return postMat(blocked(mount ? "BLOCKED-WORKSPACE-MOUNT" : "BLOCKED-PROVIDER-PREPARATION", { errors: pv.errors })); }

  // 9) §5 ACTUAL SANDBOX EXECUTABLE IDENTITY — resolve/hash/version the executable INSIDE the sandbox (never
  //    the host path). The detection record + attestation bind to the SANDBOX hash+version, not the host's.
  try { sandboxExePath = provider.resolveExecutable(prep, c.claudeBin); } catch (e) { sandboxExePath = null; }
  try { sandboxExeHash = sandboxExePath ? provider.hashExecutable(prep, sandboxExePath) : null; } catch (e) { sandboxExeHash = null; }
  try { sandboxExeVersion = sandboxExePath ? provider.getExecutableVersion(prep, sandboxExePath) : null; } catch (e) { sandboxExeVersion = null; }
  exeIdentity = sandbox.buildExecutableIdentity({ hostRequestedExecutable: c.claudeBin, hostResolvedPath: exeResolved, hostContentHash: hostExeHash, sandboxResolvedPath: sandboxExePath, sandboxContentHash: sandboxExeHash, sandboxReportedVersion: sandboxExeVersion, providerId: provider.providerId, preparedOperationId: prep.preparedOperationId });
  const eiv = sandbox.verifyExecutableIdentity(exeIdentity, { expectedContentHash: c.executableContentHash, cliVersion: c.cliVersion, providerId: provider.providerId, preparedOperationId: prep.preparedOperationId });
  if (!eiv.ok) return postMat(blocked("BLOCKED-SANDBOX-EXECUTABLE-IDENTITY", { errors: eiv.errors }));

  // 10) §6 STRUCTURED provider CAPABILITY attestation — produced against the PREPARED operation, bound to the
  //     prepared-op id, sandbox workspace path, mount policy, pre-execution ledger, and SANDBOX executable id.
  const attCtx = {
    providerId: provider.providerId, providerVersion: provider.providerVersion, providerImplementationHash: provider.providerImplementationHash,
    preparedOperationId: prep.preparedOperationId, operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId,
    workspaceId, workspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash,
    workspacePathInsideSandbox: prep.sandboxWorkspacePath, mountPolicyHash: expectedMountPolicyHash, preExecutionLedgerHash,
    executableResolvedPathInsideSandbox: sandboxExePath, sandboxExecutablePath: sandboxExePath, sandboxExecutableHash: sandboxExeHash, sandboxExecutableVersion: sandboxExeVersion, now: c.now,
  };
  try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
  const av = attestation.verifyAttestation(att, attCtx);
  if (!av.ok) return postMat(blocked("BLOCKED-SANDBOX-ATTESTATION", { errors: av.errors }));
  providerCapabilityAttestationHash = att && att.evidenceHash;
  capabilityDerivedObj = { canonicalDenialCapability: canaryOf(att, "canonicalPathCanary"), otherProjectDenialCapability: canaryOf(att, "otherProjectPathCanary"), credentialDenialCapability: canaryOf(att, "credentialPathCanary"), networkDenialCapability: canaryOf(att, "networkCanary") };

  // 11) §3/§7 EXACT INVOCATION BINDING + GRAMMAR: ProjectOS builds the FINAL argv itself and enforces both the
  //     exact 4-argument grammar and the applied-restriction check. Either failing ⇒ refuse.
  const built = detector.buildArgv(c.detectionRecord, r.prompt);
  const bindCtx = { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, policyVersion: c.policyVersion };
  const gram = detector.verifyGrammar(built.argv, c.detectionRecord, r.prompt, bindCtx);
  invocationGrammarStatus = gram.ok ? "PASS" : "FAIL";
  const inv = detector.verifyInvocation(built.argv, c.detectionRecord, r.prompt);
  invocationArgvHash = inv.argvHash; invocationRestrictionStatus = inv.status;
  if (!gram.ok) return postMat(blocked("BLOCKED-INVOCATION-GRAMMAR", { errors: gram.errors }), { invocationGrammarStatus });
  if (inv.status !== detector.INVOCATION_STATUS.APPLIED_VERIFIED) return postMat(blocked("INVOCATION-RESTRICTION-NOT-APPLIED", { invocationRestrictionStatus: inv.status, errors: inv.errors }));
  const argv = built.argv;

  // Redacted, non-secret persistence bundle (§14). Contains identifiers/hashes/paths only — never the prompt.
  const persistBundle = (oev) => ({ providerPreparation: prep, capabilityAttestationHash: providerCapabilityAttestationHash, executableIdentity: exeIdentity, detectionRecordHash: c.detectionRecord && c.detectionRecord.recordHash, invocationArgvHash, invocationGrammarStatus, invocationRestrictionStatus, operationEvidence: oev, capabilityDerived: capabilityDerivedObj, operationObserved: oev && oev.operationObserved });

  const startTs = Date.now();

  // ── §8 SINGLE FAIL-CLOSED OPERATION FINALISER ──────────────────────────────────────────────────────
  // Every result AFTER operation creation funnels through finalize() — no post-spawn branch bypasses it. §9:
  // a provider error once a handle exists is NEVER "NOT EXECUTED". §10: a confirmed termination additionally
  // requires enumeration=0 + terminal status + a bound handle. §11: the host-timeout race cancels the provider
  // wait (AbortSignal) and clears its own timer.
  const opBaseFor = (handle, exitTs, exitStatus) => ({ operationId: policy.operationId, workspaceId, providerId: provider.providerId, providerVersion: provider.providerVersion, preparedOperationId: prep.preparedOperationId, operationHandleType: handle && handle.handleType, operationHandleIdRedacted: handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null, executableContentHash: c.executableContentHash, executableIdentityHash: exeIdentity && exeIdentity.identityEvidenceHash, argvHash: invocationArgvHash, startTimestamp: startTs, exitTimestamp: exitTs, exitStatus, canonicalDenialCapability: capabilityDerivedObj.canonicalDenialCapability, otherProjectDenialCapability: capabilityDerivedObj.otherProjectDenialCapability, credentialDenialCapability: capabilityDerivedObj.credentialDenialCapability, networkDenialCapability: capabilityDerivedObj.networkDenialCapability });

  const emergencyStop = (handle, reason, opBaseObj, output, extraProc) => {
    preserve = true;
    // The preservation call outcome is REAL, not assumed — a failed preserve must not report "evidence preserved".
    let preserved = false, preserveErr = null;
    try { const pr = provider.preserveOperationEvidence(handle); preserved = !!(pr && pr.preserved); } catch (e) { preserved = false; preserveErr = String(e && e.message).slice(0, 80); }
    const disposalStatus = preserved ? "not-disposed-evidence-preserved" : "not-disposed-evidence-preservation-failed";
    const opResidue = preserved ? ["operation-preserved"] : ["operation-preserved:PRESERVATION-FAILED"];
    const procCount = extraProc && extraProc.processCount != null ? extraProc.processCount : null;
    const oev = opEvidence.buildOperationEvidence(Object.assign({}, opBaseObj, { outcome: "EMERGENCY-STOP", terminationStatus: "TERMINATION-UNCONFIRMED", operationProcessCount: procCount, disposalStatus, residue: opResidue }));
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted: opBaseObj.operationHandleIdRedacted, reason, processCount: procCount, preserved }));
    const risks = ["operation termination " + reason + " — external-operation lock; owner resolution required"];
    if (!preserved) risks.push("operation-evidence PRESERVATION FAILED" + (preserveErr ? " (" + preserveErr + ")" : "") + " — forensic evidence may be incomplete");
    const envlp = out(emergency("EMERGENCY-STOP-REQUIRED", { emergencyReason: reason }), Object.assign({}, commonResult(false, true), { operationHandleType: opBaseObj.operationHandleType, operationHandleIdRedacted: opBaseObj.operationHandleIdRedacted, operationProcessCountObserved: procCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: oev.evidenceHash, operationDisposalStatus: disposalStatus, operationResidue: opResidue, outputExcerpt: output || "", processTerminationStatus: "EMERGENCY-STOP-REQUIRED", killConfirmed: false, residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace], risks, cancellationStatus: "unconfirmed" }));
    envlp.persistedEvidence = persistBundle(oev);
    return envlp;
  };

  // Termination proof + disposal (§10). Returns { emergency } or { ok, ...facts }.
  const proveTerminationAndDispose = (handle, killFirst) => {
    if (killFirst) { try { provider.terminateOperation(handle); } catch (e) { return { emergency: "termination-exception" }; } }
    let conf; try { conf = provider.confirmOperationTerminated(handle); } catch (e) { return { emergency: "confirmation-exception" }; }
    let procs; try { procs = provider.enumerateOperationProcesses(handle); } catch (e) { return { emergency: "enumeration-exception" }; }
    if (!Array.isArray(procs)) return { emergency: "malformed-enumeration", processCount: null };
    let st; try { st = provider.operationStatus(handle); } catch (e) { return { emergency: "operation-status-exception" }; }
    if (!st || (st.state !== "running" && st.state !== "exited")) return { emergency: "malformed-operation-status" };
    const confirmedTrue = !!conf && conf.confirmed === true;
    const enumCount = procs.length;
    if (!confirmedTrue) return { emergency: "termination-unconfirmed", processCount: (conf && conf.processCount != null) ? conf.processCount : enumCount };
    if (enumCount > 0) return { emergency: "termination-contradiction-processes-remain", processCount: enumCount }; // confirm=true but processes remain
    if (st.state !== "exited") return { emergency: "provider-status-not-terminal", processCount: enumCount };
    if (!handle || handle.operationId !== policy.operationId) return { emergency: "operation-handle-not-bound", processCount: enumCount };
    // Phase 5 satisfied (0 processes). Phase 7/8: dispose + verify.
    let descendants = []; try { descendants = provider.enumerateOperationProcesses(handle) || []; } catch (e) { descendants = []; }
    let disp; try { disp = provider.disposeOperation(handle); } catch (e) { disp = null; }
    const operationResidue = disp && Array.isArray(disp.residue) ? disp.residue : ["disposal-result-malformed"];
    const disposalOk = !!disp && disp.disposed === true && Array.isArray(disp.residue) && disp.residue.length === 0;
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted: handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null, processCount: 0, confirmed: true, providerEvidence: conf && conf.evidence }));
    return { ok: true, conf, descendants, disp, operationResidue, disposalOk, pcEvidenceHash, processCount: 0 };
  };

  const REFUSE_MAP = { "timeout": "timeout", "host-timeout": "timeout", "host-cancelled": "timeout", "output-overflow": "output-overflow", "stderr-overflow": "stderr-overflow", "worker-error": "worker-error", "provider-error": "worker-error", "spawn-error": "worker-error" };

  async function finalize(handle, o) {
    o = o || {};
    const handleType = handle && handle.handleType;
    let run, output = "";
    if (o.forceKillNoRun) { run = { exitStatus: null, killedFor: o.killedFor || "ownership-forced-kill" }; }
    else {
      // §11: race the provider wait against a host-timeout backstop; the backstop ABORTS the provider wait and
      // clears its own timer so no provider promise or timer survives finalisation.
      const ac = new AbortController(); let hostTimer = null;
      const hostTimeout = new Promise((rz) => { hostTimer = setTimeout(() => { try { ac.abort(); } catch (e) {} rz({ exitStatus: null, killedFor: "host-timeout" }); }, (policy.timeoutMs || 120000) + 2000); });
      try { run = await Promise.race([provider.waitForOperationExit(handle, { timeoutMs: policy.timeoutMs, maxOutputBytes: policy.maxOutputBytes, signal: ac.signal }), hostTimeout]); }
      catch (e) { run = { exitStatus: null, killedFor: "provider-error" }; }
      finally { if (hostTimer) clearTimeout(hostTimer); }
      if (run && run.killedFor === "host-timeout") { try { provider.terminateOperation(handle); } catch (e) {} }
      try { const raw = provider.readOperationOutput(handle, policy.maxOutputBytes); output = P.scrubSecrets(redactor.redactText(raw || "")).slice(0, 4000); } catch (e) { output = ""; }
    }
    const exitTs = Date.now();
    const killedFor = run && run.killedFor;
    const opBaseObj = opBaseFor(handle, exitTs, run && run.exitStatus);

    // §9/§10: terminate (if killed OR ownership-forced) + prove termination. Any exception / unconfirmed / a
    // confirm=true-but-processes-remain contradiction ⇒ EMERGENCY-STOP (never NOT EXECUTED, never plain BLOCKED).
    const t = proveTerminationAndDispose(handle, !!killedFor || !!o.forceKillNoRun);
    if (t.emergency) return emergencyStop(handle, t.emergency, opBaseObj, output, { processCount: t.processCount });

    const outcomeFor = (kind) => kind; // COMPLETED | FAILED | TERMINATED | BLOCKED
    const opFieldsFor = (outcome) => {
      const oev = opEvidence.buildOperationEvidence(Object.assign({}, opBaseObj, { outcome, terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, containedDescendants: t.descendants, disposalStatus: t.disposalOk ? "disposed" : "disposal-failed", residue: t.operationResidue }));
      return { oev, fields: { operationHandleType: handleType, operationHandleIdRedacted: opBaseObj.operationHandleIdRedacted, operationProcessCountObserved: 0, processControlEvidenceHash: t.pcEvidenceHash, operationEvidenceHash: oev.evidenceHash, operationDisposalStatus: t.disposalOk ? "disposed" : "disposal-failed", operationResidue: t.operationResidue } };
    };
    // Every non-success finaliser branch disposes the workspace HERE and escalates a leftover source tree to the
    // WORKSPACE-DISPOSAL-FAILED headline (unless the operation-disposal headline already dominates) — a source
    // tree left on disk is never buried under a plain REFUSED/BLOCKED on the killed/timeout/ownership paths.
    const done = (env, of, extra) => {
      const residue = disposeAll();
      const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
      const finalEnv = (realResidue.length && env.reason !== "OPERATION-DISPOSAL-FAILED") ? blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue, underlyingReason: env.reason }) : env;
      const e = out(finalEnv, Object.assign({}, commonResult(true, true), evFields(), of.fields, { residue }, extra || {}));
      e.persistedEvidence = persistBundle(of.oev);
      return e;
    };

    // Disposal failure is the HEADLINE on EVERY post-confirmation branch — a leftover operation is never buried.
    if (!t.disposalOk) return done(blocked("OPERATION-DISPOSAL-FAILED", { operationResidue: t.operationResidue }), opFieldsFor(o.forceKillNoRun ? "BLOCKED" : "TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Ownership rejection (real-run PID handle): confirmed-terminated + disposed safely, but BLOCKED.
    if (o.pidReject) return done(blocked("BLOCKED-PROCESS-OWNERSHIP", { reason2: "pid-handle-forbidden-for-real-runs" }), opFieldsFor("BLOCKED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Killed (but confirmed dead + disposed) ⇒ refuse.
    if (killedFor) { const reason = REFUSE_MAP[killedFor] || "worker-error"; return done(refused(reason), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", cancellationStatus: "confirmed", timeoutStatus: (killedFor === "timeout" || killedFor === "host-timeout" || killedFor === "host-cancelled") ? "killed" : "none", residualDriftStatus: "not-evaluated" }); }

    // Clean exit ⇒ trusted FS diff + path enforcement + monitored-state reconciliation. The operation is ALREADY
    // confirmed-terminated + disposed here; a post-execution ledger I/O error must fail closed as an ordinary
    // BLOCKED (workspace disposed by done()), NOT propagate to the outer catch and fabricate a false EMERGENCY.
    let wsAfter, led, manifest, patchHash;
    try { wsAfter = ledger.snapshot(workspace); led = ledger.diff(wsBefore, wsAfter); manifest = ledger.manifest(wsAfter, led); patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null; }
    catch (e) { return done(blocked("post-execution-ledger-failed", { detail: String(e.message).slice(0, 160) }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" }); }
    const refusedPaths = [];
    for (const p of led.changedPaths) { const norm = P.normPath(p); if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; } }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p);

    let after; try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); } catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED" }); }
    if (after.unverifiable > 0 || before.unverifiable > 0) return done(blocked("monitored-state-unverifiable", { unverifiable: after.unverifiable + before.unverifiable }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, ledgerSummary });
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), opFieldsFor("TERMINATED"), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary });

    // §8 phase 9: dispose the WORKSPACE and gate on it — a source tree left on disk must NOT be COMPLETED.
    const successOutcome = (run && run.exitStatus === 0) ? "COMPLETED" : "FAILED";
    const of = opFieldsFor(successOutcome);
    const residue = disposeAll();
    const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
    if (realResidue.length) { const e = out(blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue }), Object.assign({}, commonResult(true, true), of.fields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, residue })); e.persistedEvidence = persistBundle(of.oev); return e; }

    // §8 phase 10/11: verify the operation evidence before returning success.
    const oevOk = opEvidence.verifyOperationEvidence(of.oev, { operationId: policy.operationId, workspaceId, providerId: provider.providerId, executableContentHash: c.executableContentHash, argvHash: invocationArgvHash });
    if (!oevOk.ok) { const e = out(blocked("operation-evidence-invalid", { errors: oevOk.errors }), Object.assign({}, commonResult(true, true), of.fields, { residue })); e.persistedEvidence = persistBundle(of.oev); return e; }

    // Success.
    let res; try {
      res = P.buildResult(Object.assign({}, commonResult(true, true), of.fields, { operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, approvalStatus: policy.approvalId ? "referenced" : "none", toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: after.branch, finalHead: after.head, outcome: successOutcome, residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, processTerminationStatus: "TERMINATED-CONFIRMED", killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none", outputExcerpt: output, residue, workerDecision: successOutcome === "COMPLETED" ? "PROPOSED" : "FAILED" }));
    } catch (e) { const en = out(blocked("result-build-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, commonResult(true, true), { residue })); return en; }
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true, true), { residue }));
    const envlp = { ok: successOutcome === "COMPLETED", decision: successOutcome, output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
    envlp.persistedEvidence = persistBundle(of.oev);
    return envlp;
  }

  let handle = null;
  try {
    // Spawn via the provider-owned operation using the VERIFIED SANDBOX executable path (never the host path).
    try { handle = provider.spawnOperation({ bin: sandboxExePath, argv, cwd: workspace, env: P.buildMinimalEnv(process.platform, policy.envAllowlist), operationId: policy.operationId, preparedOperationId: prep.preparedOperationId }); }
    catch (e) { return postMat(blocked("operation-spawn-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({ processTerminationStatus: "NOT EXECUTED" }, evFields()), true); }
    // PID-handle rejection: teardown safely THROUGH the finaliser (terminate + confirm + dispose). Forbidden for
    // ANY non-mock provider (not only when realRun is set) — a bare, reusable OS PID can never own an operation.
    if (handle && handle.handleType === "pid" && (requireReal || provider.kind !== "mock")) return await finalize(handle, { forceKillNoRun: true, killedFor: "ownership-forced-kill", pidReject: true });
    return await finalize(handle);
  } catch (e) {
    // §9: an unexpected adapter exception once a handle exists is EMERGENCY-STOP (never NOT EXECUTED / plain BLOCKED).
    if (handle) return emergencyStop(handle, "unexpected-adapter-exception:" + String(e && e.message).slice(0, 80), opBaseFor(handle, Date.now(), null), "");
    return postMat(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({ processTerminationStatus: "NOT APPLICABLE" }, evFields()), true);
  } finally { if (!disposed && !preserve && !c.keepWorkspace) disposeAll(); }
}

module.exports = { runClaudeWorker, monitorSnapshot, monitorDrift, gitMetaDigest };

```

## projectos/bridge/invocation-detector.cjs

```javascript
"use strict";
/**
 * Real tool-restriction DETECTION contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§5).
 *
 * Replaces a self-declared `verified: true` invocation profile with a VERIFICATION RECORD produced by a
 * detector. The record binds the restriction to the EXACT executable (content hash + version), the operation
 * mode, the sandbox provider, and the policy version, and records a safe NEGATIVE-CAPABILITY test (attempts
 * to invoke forbidden shell / network / git-write capabilities, expecting "DENIED BY TECHNICAL CONTROL").
 *
 * A manually-supplied profile with plausible strings and `verified:true` (but no detector record, or a record
 * bound to a different executable / version, or expired) is REJECTED. This module defines + verifies the
 * contract; the real detection runs on an owner machine. Synthetic providers prove the verifier.
 */

const crypto = require("crypto");
const { canonicalJson } = require("./attestation.cjs");

const DETECTOR_VERSION = "detector-1.0";
const NEGATIVE_TESTS = ["shell", "network", "git-write"];
const DENIED = "DENIED BY TECHNICAL CONTROL";
// Tool names that grant a forbidden capability; a permitted-tools list may never contain any of them, and a
// forbidden-tools list must contain at least the shell/web/git ones.
const DANGEROUS_TOOLS = ["Bash", "Shell", "Execute", "Run", "WebFetch", "WebSearch", "Git", "GitWrite", "Provider", "Database", "Deploy"];
const MUST_FORBID = ["Bash", "Shell", "WebFetch", "Git"];
const RECORD_FIELDS = [
  "detectorVersion", "resolvedExecutablePath", "executableContentHash", "cliVersion", "restrictionMechanism",
  "permittedTools", "forbiddenTools", "permittedCommands", "shellDisabled", "gitWriteDisabled",
  "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled",
  "commandExecutionDisabled", "negativeTests", "operationMode", "sandboxProviderId", "policyVersion",
  "argumentTemplate", "promptArgPosition", "argTemplateHash", "shellPossible", "commandExecutionPossible",
  "timestamp", "expiry", "recordHash",
];
const MUST_DISABLE = ["shellDisabled", "gitWriteDisabled", "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled"];
// Invocation-restriction verification outcomes (§12).
const INVOCATION_STATUS = { NOT_VERIFIED: "NOT VERIFIED", VERIFIED_NOT_APPLIED: "VERIFIED BUT NOT APPLIED", APPLIED_VERIFIED: "APPLIED AND VERIFIED" };
// Token markers the argument template may contain; ProjectOS substitutes them — never a caller function.
const TPL_TOOLS = "{tools}", TPL_PROMPT = "{prompt}";
// The only literal (non-placeholder, non-mechanism) flags an argument template may carry for the first proof.
const ALLOWED_PRINT_FLAGS = ["-p", "--print"];
// Substrings that must NEVER appear in a final argv element.
const ARGV_BANNED = /^--?(dangerously-skip-permissions|no-sandbox|allow-all|yolo|permission-mode=bypass|shell|exec|command)/i;

// §7 — the supported restriction-mechanism REGISTRY for the first controlled-change proof. A mechanism outside
// this set (for the detected CLI version) is refused. The registry is BOUND to the executable content hash, the
// CLI version, the detector version, and the policy version (via `mechanismRegistry`), so a record cannot claim
// an unsupported/forged mechanism for a different CLI.
const SUPPORTED_MECHANISMS = ["--allowedTools"];

function hashObj(o) { return require("crypto").createHash("sha256").update(canonicalJson(o || {})).digest("hex"); }
function hashTemplate(tpl) { return require("crypto").createHash("sha256").update(canonicalJson(tpl || [])).digest("hex"); }

/** Supported mechanisms + a binding hash for (exe hash, CLI version, detector version, policy version). */
function mechanismRegistry(bindCtx) {
  const c = bindCtx || {};
  const mechanisms = SUPPORTED_MECHANISMS.slice();
  const registryHash = hashObj({ mechanisms, executableContentHash: c.executableContentHash || null, cliVersion: c.cliVersion || null, detectorVersion: DETECTOR_VERSION, policyVersion: c.policyVersion || null });
  return { mechanisms, registryHash };
}
function isSupportedMechanism(mech, bindCtx) { return mechanismRegistry(bindCtx).mechanisms.indexOf(mech) >= 0; }

/**
 * §7 EXACT INVOCATION GRAMMAR — for the first controlled-change proof accept ONE argument grammar only:
 *   [ VERIFIED_RESTRICTION_MECHANISM, EXACT_PERMITTED_TOOLS_VALUE, "-p", PROMPT ]
 * Requires exactly four arguments, each token exactly once (outside the prompt — the prompt is DATA and is never
 * scanned), the prompt as the final argument, no empty tool entry, deterministic (sorted) tool ordering, and a
 * mechanism that is in the supported registry for the detected CLI version. Returns { ok, errors, registryHash }.
 */
function verifyGrammar(argv, record, prompt, bindCtx) {
  const errors = [];
  const rec = record || {};
  const mech = rec.restrictionMechanism;
  const toolList = (rec.permittedTools || []).map(String);
  const tools = toolList.join(",");
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return { ok: false, errors: ["grammar: argv must be a string array"], registryHash: null };
  if (argv.length !== 4) errors.push("grammar: expected exactly 4 arguments, got " + argv.length);
  // positional form
  if (argv[0] !== mech) errors.push("grammar: arg0 must be the restriction mechanism");
  if (argv[1] !== tools) errors.push("grammar: arg1 must be the exact permitted-tools value");
  if (ALLOWED_PRINT_FLAGS.indexOf(argv[2]) < 0) errors.push("grammar: arg2 must be an approved print flag (-p/--print)");
  if (argv[argv.length - 1] !== String(prompt)) errors.push("grammar: the final argument must be the prompt");
  // single occurrence each, scanning only the NON-prompt positions (prompt is data, never scanned).
  const nonPrompt = argv.slice(0, Math.max(0, argv.length - 1));
  if (nonPrompt.filter((x) => x === mech).length !== 1) errors.push("grammar: restriction mechanism must appear exactly once");
  if (nonPrompt.filter((x) => x === tools).length !== 1) errors.push("grammar: tools value must appear exactly once");
  if (nonPrompt.filter((x) => ALLOWED_PRINT_FLAGS.indexOf(x) >= 0).length !== 1) errors.push("grammar: print flag must appear exactly once");
  // no empty tool entry + deterministic ordering
  if (toolList.some((t) => t.trim() === "")) errors.push("grammar: empty tool entry");
  const sorted = toolList.slice().sort();
  if (JSON.stringify(toolList) !== JSON.stringify(sorted)) errors.push("grammar: permitted tools are not in deterministic (sorted) order");
  // mechanism must be in the supported registry for the detected CLI version
  if (!isSupportedMechanism(mech, bindCtx)) errors.push("grammar: restriction mechanism '" + String(mech) + "' is not in the supported registry for this CLI version");
  return { ok: errors.length === 0, errors, registryHash: mechanismRegistry(bindCtx).registryHash };
}

function hashRecord(rec) { const c = Object.assign({}, rec); delete c.recordHash; return crypto.createHash("sha256").update(canonicalJson(c)).digest("hex"); }

/**
 * Verify a detection record against the current binding context. Returns { ok, errors }.
 * @param rec detection record (from a real detector, or syntheticRecord for tests)
 * @param ctx { executableContentHash, cliVersion, operationMode, sandboxProviderId, policyVersion, now, firstControlledChange }
 */
function verifyDetectionRecord(rec, ctx) {
  const errors = [];
  const c = ctx || {};
  if (!rec || typeof rec !== "object") return { ok: false, errors: ["detection: not a record (a bare verified:true profile fails)"] };
  for (const f of RECORD_FIELDS) if (!(f in rec)) errors.push("detection: missing '" + f + "'");
  if (rec.detectorVersion !== DETECTOR_VERSION) errors.push("detection: unknown detectorVersion");

  // binding — a missing ctx value is a failure (never a silently-skipped binding).
  const bind = ["executableContentHash", "cliVersion", "operationMode", "sandboxProviderId", "policyVersion"];
  for (const k of bind) { if (c[k] === undefined || c[k] === null) { errors.push("detection: incomplete verification context (missing " + k + ")"); continue; } if (rec[k] !== c[k]) errors.push("detection: " + k + " does not match (record bound to a different " + k + ")"); }
  if (!rec.executableContentHash) errors.push("detection: no executable content hash");

  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof rec.timestamp !== "number" || typeof rec.expiry !== "number") errors.push("detection: timestamp/expiry must be numbers");
  else if (rec.expiry <= now) errors.push("detection: verification record expired");

  // hard disables
  for (const k of MUST_DISABLE) if (rec[k] !== true) errors.push("detection: " + k + " is not proven true");

  // tool-LIST content must agree with the disable flags: no permitted tool may grant a forbidden capability,
  // and the forbidden list must include the dangerous ones (a self-contradictory record is refused).
  const permitted = Array.isArray(rec.permittedTools) ? rec.permittedTools.map(String) : [];
  const forbidden = Array.isArray(rec.forbiddenTools) ? rec.forbiddenTools.map(String) : [];
  for (const t of permitted) if (DANGEROUS_TOOLS.indexOf(t) >= 0) errors.push("detection: permittedTools contains a dangerous-capability tool '" + t + "'");
  for (const t of MUST_FORBID) if (forbidden.indexOf(t) < 0) errors.push("detection: forbiddenTools must include '" + t + "'");

  // negative-capability tests: each must be DENIED BY TECHNICAL CONTROL
  const nt = Array.isArray(rec.negativeTests) ? rec.negativeTests : [];
  for (const name of NEGATIVE_TESTS) {
    const t = nt.find((x) => x && x.capability === name);
    if (!t) { errors.push("detection: missing negative test for '" + name + "'"); continue; }
    if (t.result !== DENIED) errors.push("detection: negative test '" + name + "' did not report '" + DENIED + "'");
  }

  // first controlled-change: command execution disabled + no permitted commands
  if (c.firstControlledChange) {
    if (rec.commandExecutionDisabled !== true) errors.push("detection: commandExecutionDisabled must be true for the first proof");
    if (Array.isArray(rec.permittedCommands) && rec.permittedCommands.length > 0) errors.push("detection: permittedCommands must be empty for the first proof");
    if (rec.shellPossible !== false) errors.push("detection: shellPossible must be false for the first proof");
    if (rec.commandExecutionPossible !== false) errors.push("detection: commandExecutionPossible must be false for the first proof");
  }

  // the canonical argument template must be well-formed: an array that INCLUDES the restriction mechanism and
  // the {prompt} token, with a matching argTemplateHash. ProjectOS builds the final argv from this — a record
  // whose template omits the restriction mechanism cannot drive a restricted real run.
  if (typeof rec.restrictionMechanism !== "string" || !rec.restrictionMechanism.length) errors.push("detection: restrictionMechanism must be a non-empty string");
  if (!Array.isArray(rec.argumentTemplate)) errors.push("detection: argumentTemplate must be an array");
  else {
    // ALLOWLIST the template tokens: exactly the restriction mechanism, {tools}, an approved print flag, and
    // {prompt} — NOTHING else. This blocks smuggling a bypass/out-of-band flag as a space-separated element
    // (e.g. ["--permission-mode","bypassPermissions",…]) that a token-substring scan would miss.
    const allowed = new Set([rec.restrictionMechanism, "{tools}", "{prompt}"].concat(ALLOWED_PRINT_FLAGS));
    for (const tok of rec.argumentTemplate) if (!allowed.has(tok)) errors.push("detection: unrecognized argumentTemplate token '" + String(tok) + "' (only mechanism / {tools} / -p / {prompt} are allowed)");
    if (typeof rec.restrictionMechanism === "string" && rec.restrictionMechanism.length && rec.argumentTemplate.indexOf(rec.restrictionMechanism) < 0) errors.push("detection: argumentTemplate omits the restrictionMechanism");
    if (rec.argumentTemplate.indexOf("{tools}") < 0) errors.push("detection: argumentTemplate omits the {tools} token (restriction would not be applied)");
    const pIdx = rec.argumentTemplate.indexOf("{prompt}");
    if (pIdx < 0) errors.push("detection: argumentTemplate omits the {prompt} token");
    if (typeof rec.promptArgPosition === "number" && rec.promptArgPosition !== pIdx) errors.push("detection: promptArgPosition does not match the {prompt} token position");
    if (typeof rec.argTemplateHash !== "string" || rec.argTemplateHash !== hashTemplate(rec.argumentTemplate)) errors.push("detection: argTemplateHash mismatch (modified)");
  }

  // integrity — recordHash MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash
  // fails; it never skips). Integrity, not authenticity (see report trust boundary).
  if (typeof rec.recordHash !== "string" || !/^[0-9a-f]{64}$/.test(rec.recordHash)) errors.push("detection: recordHash missing/invalid");
  else if (hashRecord(rec) !== rec.recordHash) errors.push("detection: recordHash mismatch (modified)");

  return { ok: errors.length === 0, errors };
}

/** Build a SYNTHETIC detection record (labelled) bound to a context — proves the verifier accepts a good one. */
function syntheticRecord(ctx, opts) {
  const o = opts || {};
  const c = ctx || {};
  const now = typeof o.now === "number" ? o.now : Date.now();
  const neg = NEGATIVE_TESTS.map((cap) => ({ capability: cap, attempted: "invoke " + cap, expected: DENIED, result: o.negFail === cap ? "ALLOWED" : DENIED }));
  const rec = {
    detectorVersion: DETECTOR_VERSION,
    resolvedExecutablePath: o.resolvedExecutablePath || "/sandbox/bin/claude",
    executableContentHash: c.executableContentHash || "exe-hash",
    cliVersion: c.cliVersion || "1.9.0", restrictionMechanism: o.restrictionMechanism || "--allowedTools",
    permittedTools: (o.permittedTools || ["Read", "Edit"]).slice().sort(), forbiddenTools: o.forbiddenTools || ["Bash", "Shell", "WebFetch", "Git"],
    permittedCommands: o.permittedCommands || [],
    shellDisabled: o.shellDisabled !== false, gitWriteDisabled: o.gitWriteDisabled !== false, networkDisabled: o.networkDisabled !== false,
    providerToolsDisabled: o.providerToolsDisabled !== false, databaseToolsDisabled: o.databaseToolsDisabled !== false, deploymentToolsDisabled: o.deploymentToolsDisabled !== false,
    commandExecutionDisabled: o.commandExecutionDisabled !== false,
    negativeTests: neg, operationMode: c.operationMode || "first-controlled-change",
    sandboxProviderId: c.sandboxProviderId || null, policyVersion: c.policyVersion || "policy-1",
    argumentTemplate: o.argumentTemplate || ["--allowedTools", TPL_TOOLS, "-p", TPL_PROMPT],
    promptArgPosition: o.promptArgPosition === undefined ? 3 : o.promptArgPosition,
    shellPossible: o.shellPossible === true, commandExecutionPossible: o.commandExecutionPossible === true,
    timestamp: now, expiry: now + (o.ttlMs || 300000),
  };
  rec.argTemplateHash = hashTemplate(rec.argumentTemplate);
  rec.recordHash = hashRecord(rec);
  if (o.tamper) rec.cliVersion = "9.9.9"; // do NOT re-hash → mismatch
  return rec;
}

/**
 * ProjectOS constructs the FINAL argv itself from the verified record's canonical template — a caller function
 * is NEVER trusted to build a real-run argv. Substitutes {tools} → the exact permitted-tool list and {prompt}
 * → the approved prompt. Returns { argv, promptIndex }.
 */
function buildArgv(record, prompt) {
  const tpl = Array.isArray(record.argumentTemplate) ? record.argumentTemplate : [];
  const tools = (record.permittedTools || []).join(",");
  const argv = []; let promptIndex = -1;
  for (const tok of tpl) {
    if (tok === TPL_TOOLS) argv.push(tools);
    else if (tok === TPL_PROMPT) { promptIndex = argv.length; argv.push(String(prompt)); }
    else argv.push(String(tok));
  }
  return { argv, promptIndex };
}

/**
 * Verify a FINAL argv exactly encodes the record's restriction: the restriction mechanism is present, the
 * permitted-tool list is encoded exactly, no forbidden/shell/network/git-write/bypass token appears, the prompt
 * sits at the expected position, and no unknown argument exists. Returns { status, argvHash, errors }.
 *   APPLIED AND VERIFIED — restriction encoded + everything matches
 *   VERIFIED BUT NOT APPLIED — argv is well-formed but the restriction mechanism is absent (e.g. `-p prompt`)
 *   NOT VERIFIED — argv contradicts the record (forbidden token / unknown arg / wrong prompt position)
 */
function verifyInvocation(argv, record, prompt) {
  const errors = [];
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return { status: INVOCATION_STATUS.NOT_VERIFIED, argvHash: null, errors: ["argv-not-string-array"] };
  const argvHash = require("crypto").createHash("sha256").update(canonicalJson(argv)).digest("hex");
  const mech = record.restrictionMechanism;
  const tools = (record.permittedTools || []).join(",");
  const forbidden = (record.forbiddenTools || []).concat(["Bash", "Shell", "WebFetch", "WebSearch", "Git", "GitWrite", "Provider", "Database", "Deploy"]);
  const built = buildArgv(record, prompt);
  // The PROMPT is data (the `-p` value), not an argument — never scan it for tool/flag tokens (a benign prompt
  // like "Git" or "use Run,Deploy" must not falsely block). Scan only the NON-prompt argv positions.
  for (let i = 0; i < argv.length; i++) {
    if (i === built.promptIndex) continue;
    const a = argv[i];
    if (ARGV_BANNED.test(a)) errors.push("banned argv token: " + a);
    for (const f of forbidden) if (a === f || a.split(",").indexOf(f) >= 0) errors.push("forbidden tool encoded: " + f);
  }
  // prompt at the expected position
  if (built.promptIndex < 0 || argv[built.promptIndex] !== String(prompt)) errors.push("prompt not at the expected argument position");
  // no unknown argument: the argv must equal what ProjectOS itself would build from the template
  if (canonicalJson(argv) !== canonicalJson(built.argv)) errors.push("argv contains an unknown/altered argument (does not match the canonical template)");

  if (errors.length) return { status: INVOCATION_STATUS.NOT_VERIFIED, argvHash, errors };
  // restriction mechanism must be present AND carry exactly the permitted-tool list
  const mi = mech ? argv.indexOf(mech) : -1;
  const applied = mi >= 0 && argv[mi + 1] === tools;
  return { status: applied ? INVOCATION_STATUS.APPLIED_VERIFIED : INVOCATION_STATUS.VERIFIED_NOT_APPLIED, argvHash, errors: applied ? [] : ["restriction mechanism '" + mech + "' not applied in argv"] };
}

module.exports = {
  verifyDetectionRecord, syntheticRecord, hashRecord, buildArgv, verifyInvocation, verifyGrammar,
  mechanismRegistry, isSupportedMechanism, hashTemplate, DETECTOR_VERSION, NEGATIVE_TESTS, DENIED,
  RECORD_FIELDS, INVOCATION_STATUS, SUPPORTED_MECHANISMS,
};

```

## projectos/bridge/operation-evidence.cjs

```javascript
"use strict";
/**
 * Post-execution OPERATION EXECUTION EVIDENCE — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E (§8, §14, §15).
 *
 * Two-stage attestation splits (A) PROVIDER CAPABILITY ATTESTATION — proven up front, "the sandbox CAN deny
 * canonical/home/network and CAN terminate/clean" — from (B) OPERATION EXECUTION EVIDENCE — created AFTER the
 * exact operation ran and terminated. A capability canary must NEVER be presented as an operation-observed
 * result. This module (B) therefore keeps two clearly-labelled sections:
 *   • capabilityDerived  — what the sandbox CAN enforce (from the attestation canaries)
 *   • operationObserved  — what was ACTUALLY observed for THIS operation (identity, processes, termination,
 *                          disposal, residue; the first-proof run does not instrument the worker's syscalls, so
 *                          network/canonical/credential ATTEMPTS are honestly "NOT OBSERVABLE", never "denied")
 *
 * Operation-bound (operationId + workspaceId + providerId + argv/exe hash) with an always-checked evidenceHash.
 * Integrity, not authenticity (see report trust boundary).
 */

const { canonicalJson } = require("./attestation.cjs"); // reuse canonical serialisation

const SCHEMA_VERSION = "op-evidence-2.0";
const TERMINATION_STATUSES = ["NOT EXECUTED", "TERMINATED-CONFIRMED", "TERMINATION-UNCONFIRMED", "EMERGENCY-STOP-REQUIRED"];
const DISPOSAL_STATUSES = ["disposed", "disposal-failed", "not-disposed", "not-disposed-evidence-preserved", "not-disposed-evidence-preservation-failed"];
const OBSERVATION_VALUES = ["NOT OBSERVABLE", "OBSERVED", "NONE OBSERVED"];
const SUCCESS_OUTCOMES = ["COMPLETED", "FAILED"]; // outcomes that require a fully clean, disposed operation
const CAP_DERIVED_FIELDS = ["canonicalDenialCapability", "otherProjectDenialCapability", "credentialDenialCapability", "networkDenialCapability"];
const OBSERVED_FIELDS = [
  "actualWorkspaceIdentity", "actualExecutableIdentity", "actualArgvHash", "operationProcessObservations",
  "networkAttemptsObserved", "canonicalAccessAttemptsObserved", "credentialAccessAttemptsObserved",
  "terminationResult", "disposalResult", "residue",
];
const TOP_REQUIRED = [
  "schemaVersion", "operationId", "workspaceId", "providerId", "providerVersion", "preparedOperationId",
  "operationHandleType", "operationHandleIdRedacted", "executableContentHash", "argvHash", "startTimestamp",
  "exitTimestamp", "exitStatus", "outcome", "capabilityDerived", "operationObserved", "evidenceHash",
];
// Canary-flavoured tokens that must NEVER appear as an operation-OBSERVED termination value (a canary substituted
// for a real observation).
const CANARY_TOKENS = new Set(["denied", "allowed", "contained", "complete", "confirmed", "reachable", "escaped", "residue"]);

function hashEvidence(ev) { const c = Object.assign({}, ev); delete c.evidenceHash; return require("crypto").createHash("sha256").update(canonicalJson(c)).digest("hex"); }

function buildOperationEvidence(f) {
  const g = f || {};
  const processCount = g.operationProcessCount == null ? null : g.operationProcessCount;
  const ev = {
    schemaVersion: SCHEMA_VERSION,
    operationId: g.operationId || null, workspaceId: g.workspaceId || null, providerId: g.providerId || null,
    providerVersion: g.providerVersion || null, preparedOperationId: g.preparedOperationId || null,
    operationHandleType: g.operationHandleType || null, operationHandleIdRedacted: g.operationHandleIdRedacted || null,
    executableContentHash: g.executableContentHash || null, argvHash: g.argvHash || null,
    startTimestamp: g.startTimestamp == null ? null : g.startTimestamp,
    exitTimestamp: g.exitTimestamp == null ? null : g.exitTimestamp,
    exitStatus: g.exitStatus == null ? null : g.exitStatus,
    outcome: g.outcome || "unknown",
    // (A) what the sandbox CAN enforce — derived from the capability attestation canaries.
    capabilityDerived: {
      canonicalDenialCapability: g.canonicalDenialCapability || "not-evaluated",
      otherProjectDenialCapability: g.otherProjectDenialCapability || "not-evaluated",
      credentialDenialCapability: g.credentialDenialCapability || "not-evaluated",
      networkDenialCapability: g.networkDenialCapability || "not-evaluated",
    },
    // (B) what was ACTUALLY observed for THIS operation.
    operationObserved: {
      actualWorkspaceIdentity: g.workspaceId || null,
      actualExecutableIdentity: g.executableIdentityHash || null,
      actualArgvHash: g.argvHash || null,
      operationProcessObservations: { processCount, containedDescendants: Array.isArray(g.containedDescendants) ? g.containedDescendants : [] },
      networkAttemptsObserved: g.networkAttemptsObserved || "NOT OBSERVABLE",
      canonicalAccessAttemptsObserved: g.canonicalAccessAttemptsObserved || "NOT OBSERVABLE",
      credentialAccessAttemptsObserved: g.credentialAccessAttemptsObserved || "NOT OBSERVABLE",
      terminationResult: g.terminationStatus || "NOT EXECUTED",
      disposalResult: g.disposalStatus || "not-disposed",
      residue: Array.isArray(g.residue) ? g.residue : [],
    },
  };
  ev.evidenceHash = hashEvidence(ev);
  return ev;
}

/**
 * Verify operation evidence against the operation context. Returns { ok, errors }.
 * @param ev  the operation-evidence object
 * @param ctx { operationId, workspaceId, providerId, executableContentHash, argvHash }
 * @param opts { requireSuccess } — when the run is reported COMPLETED/FAILED, demand a fully clean, disposed op.
 */
function verifyOperationEvidence(ev, ctx, opts) {
  const errors = []; const c = ctx || {}; const o = opts || {};
  if (!ev || typeof ev !== "object") return { ok: false, errors: ["op-evidence: not an object"] };
  for (const f of TOP_REQUIRED) if (!(f in ev)) errors.push("op-evidence: missing '" + f + "'");
  if (ev.schemaVersion !== SCHEMA_VERSION) errors.push("op-evidence: bad schemaVersion");
  const cap = ev.capabilityDerived || {}; const obs = ev.operationObserved || {};
  if (!ev.capabilityDerived || typeof ev.capabilityDerived !== "object") errors.push("op-evidence: capabilityDerived missing/malformed");
  if (!ev.operationObserved || typeof ev.operationObserved !== "object") errors.push("op-evidence: operationObserved missing/malformed");
  for (const f of CAP_DERIVED_FIELDS) if (!(f in cap)) errors.push("op-evidence: capabilityDerived missing '" + f + "'");
  for (const f of OBSERVED_FIELDS) if (!(f in obs)) errors.push("op-evidence: operationObserved missing '" + f + "'");

  // binding — a missing ctx field is a failure (never silently skipped).
  for (const k of ["operationId", "workspaceId", "providerId", "executableContentHash", "argvHash"]) {
    if (c[k] === undefined || c[k] === null) { errors.push("op-evidence: incomplete context (missing " + k + ")"); continue; }
    if (ev[k] !== c[k]) errors.push("op-evidence: " + k + " does not match the operation");
  }
  // the OBSERVED identity/argv must echo the same operation (not borrowed from elsewhere).
  if (obs.actualWorkspaceIdentity !== ev.workspaceId) errors.push("op-evidence: operationObserved.actualWorkspaceIdentity does not match the operation workspace");
  if (obs.actualArgvHash !== ev.argvHash) errors.push("op-evidence: operationObserved.actualArgvHash does not match the operation argv");

  // timestamps ordered; evidence must not be generated before exit.
  if (typeof ev.startTimestamp !== "number" || typeof ev.exitTimestamp !== "number" || ev.exitTimestamp < ev.startTimestamp) errors.push("op-evidence: start/exit timestamps invalid (evidence generated before exit?)");

  // termination enum + a canary value must never be substituted for a real observation.
  if (TERMINATION_STATUSES.indexOf(obs.terminationResult) < 0) errors.push("op-evidence: operationObserved.terminationResult is not a valid termination status" + (CANARY_TOKENS.has(String(obs.terminationResult)) ? " (a capability canary was substituted)" : ""));
  if (DISPOSAL_STATUSES.indexOf(obs.disposalResult) < 0) errors.push("op-evidence: operationObserved.disposalResult is not a valid disposal status");
  for (const k of ["networkAttemptsObserved", "canonicalAccessAttemptsObserved", "credentialAccessAttemptsObserved"]) {
    if (CANARY_TOKENS.has(String(obs[k]))) errors.push("op-evidence: operationObserved." + k + " carries a capability-canary value (must be an observation, e.g. NOT OBSERVABLE)");
  }

  // contradictions (always checked):
  const procCount = obs.operationProcessObservations && obs.operationProcessObservations.processCount;
  if (obs.terminationResult === "TERMINATED-CONFIRMED" && !(procCount === 0)) errors.push("op-evidence: TERMINATED-CONFIRMED but operation process count is not 0");
  if (obs.disposalResult === "disposed" && Array.isArray(obs.residue) && obs.residue.length > 0) errors.push("op-evidence: disposalResult 'disposed' but residue is non-empty");

  // integrity
  if (typeof ev.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(ev.evidenceHash)) errors.push("op-evidence: evidenceHash missing/invalid");
  else if (hashEvidence(ev) !== ev.evidenceHash) errors.push("op-evidence: evidenceHash mismatch (modified)");

  // a reported success requires a fully clean, disposed operation with a concrete (non-NOT-OBSERVABLE) termination.
  if (o.requireSuccess || SUCCESS_OUTCOMES.indexOf(ev.outcome) >= 0) {
    if (obs.terminationResult !== "TERMINATED-CONFIRMED") errors.push("op-evidence: a completed operation requires TERMINATED-CONFIRMED");
    if (procCount !== 0) errors.push("op-evidence: a completed operation requires operation process count 0");
    if (obs.disposalResult !== "disposed") errors.push("op-evidence: a completed operation requires disposalResult 'disposed'");
    if (Array.isArray(obs.residue) && obs.residue.length > 0) errors.push("op-evidence: a completed operation requires empty residue");
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { buildOperationEvidence, verifyOperationEvidence, hashEvidence, SCHEMA_VERSION, TOP_REQUIRED, TERMINATION_STATUSES, DISPOSAL_STATUSES, CAP_DERIVED_FIELDS, OBSERVED_FIELDS };

```

## projectos/bridge/owner-capability-check.cjs

```javascript
"use strict";
/**
 * Owner-machine capability check — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§3, §10). SAFE + read-only.
 *
 * It loads the SAME trusted runtime configuration the worker adapter consumes and evaluates readiness via the
 * SINGLE shared path (`runtime-config.checkReadiness`). NO environment marker (PROJECTOS_SANDBOX_PROVIDER,
 * PROJECTOS_WORKER_PROFILE_VERIFIED, etc.) can make any security check PASS — readiness is technically
 * verified (concrete provider, operation-bound attestation, detection record, operation lifecycle) or BLOCKED.
 * It additionally probes Docker/Supabase (read-only). It never installs, connects, or reads a credential.
 */

const { execFileSync } = require("child_process");
const runtime = require("./runtime-config.cjs");

function tryExec(bin, args) {
  try { return { ok: true, out: String(execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 })).trim().split("\n")[0].slice(0, 80) }; }
  catch (e) { return { ok: false, out: null }; }
}
function onPath(bin) { return (process.platform === "win32" ? tryExec("where", [bin]) : tryExec("which", [bin])).ok; }
function detectDocker() { if (!onPath("docker")) return { status: "BLOCKED", how: "docker-not-installed" }; const i = tryExec("docker", ["info", "--format", "{{.ServerVersion}}"]); return i.ok ? { status: "PASS", how: "daemon-running", detail: i.out } : { status: "BLOCKED", how: "docker-not-running" }; }
function detectSupabase() { if (!onPath("supabase")) return { status: "BLOCKED", how: "supabase-cli-not-installed" }; const v = tryExec("supabase", ["--version"]); return v.ok ? { status: "PASS", how: "cli-present", detail: v.out } : { status: "BLOCKED", how: "supabase-cli-error" }; }

/**
 * Load the trusted runtime config the adapter will consume. On the owner machine this reads an approved,
 * signed config (provider instance + executable identity + detection record + policy). Absent here ⇒ empty ⇒
 * BLOCKED-SANDBOX-IMPLEMENTATION. NEVER derived from an environment marker. `injected` is for tests only.
 */
function loadRuntimeConfig(injected) {
  if (injected) return injected;
  // No approved runtime-config source is wired in this local phase → nothing is ready for a real run.
  return {};
}

function check(injectedConfig, ctx) {
  const config = loadRuntimeConfig(injectedConfig);
  const docker = detectDocker();
  const supabase = detectSupabase();
  const context = Object.assign({ operationId: "capability-probe", projectId: "probe", phaseId: "probe", workspaceId: "probe", providerId: config.sandboxProvider && config.sandboxProvider.providerId, executableResolvedPathInsideSandbox: config.sandboxProvider && config.sandboxProvider.kind === "mock" ? "/sandbox/bin/claude" : undefined }, ctx || {});
  const r = runtime.checkReadiness(config, context, { docker, supabase });
  return { platform: process.platform, node: process.version, checks: r.checks, overall: r.overall, realBlockReason: r.realBlockReason, docker, supabase };
}

// ── Owner-facing presentation (designed with ui-ux-pro-max guidance: security-first hierarchy, one clear next
//    action, NOT INSTALLED vs NOT RUNNING vs NOT SAFE distinguished, text badges not colour-only) ──
const CHECK_TITLES = {
  sandboxImplementationPresent: "OS sandbox implementation",
  sandboxAttestationPass: "Sandbox attestation (live canaries)",
  executableValidated: "Claude executable identity",
  toolRestrictionVerified: "Worker tool restriction (detected)",
  processOwnershipVerified: "Process ownership (operation handle)",
  processTerminationVerified: "Process termination (lifecycle proven)",
  networkDisabled: "Network disabled",
  dockerReady: "Docker (for local Supabase)",
  supabaseReady: "Supabase CLI",
};
const NEXT_ACTION = {
  "no-sandbox-provider": "Configure and approve a real OS sandbox provider (restricted account / VM / container). Until then only synthetic validation runs — the real worker is NOT SAFE.",
  "no-valid-provider": "Fix the sandbox provider first.",
  "pid-only-provider-forbidden-for-real-runs": "Use a provider that owns a stable operation handle (job object / container id), not a bare PID.",
  "ownership:pid-handle-forbidden-for-real-runs": "The provider returned a bare PID. Use a provider that owns a stable operation handle (job object / container id).",
  "ownership:pid-only-provider-forbidden-for-real-runs": "The provider only offers a bare PID. Use a provider that owns a stable operation handle.",
  "sandbox-executable-identity-mismatch": "The executable measured inside the sandbox does not match the approved detection record. Re-verify the sandbox image/executable.",
  "probe-cleanup-failed": "The readiness lifecycle probe left residue. Do NOT run the real worker — investigate the leftover, then re-run readiness.",
  "invocation-restriction-not-applied": "The restricted command was not APPLIED AND VERIFIED. Re-derive the detection record so the tool restriction is encoded.",
  "docker-not-installed": "Install Docker Desktop and start it.",
  "docker-not-running": "Open Docker Desktop and wait until it says Running.",
  "supabase-cli-not-installed": "Install the Supabase CLI.",
};
function present(res) {
  const L = [];
  const line = (name) => {
    const c = res.checks[name]; const ready = c.status === "PASS";
    L.push((ready ? "[ READY ]        " : "[ ACTION NEEDED ]") + " " + (CHECK_TITLES[name] || name));
    if (!ready) L.push("                  reason: " + (c.reason || "blocked"));
    return ready ? null : ((CHECK_TITLES[name] || name) + ": " + (NEXT_ACTION[c.reason] || "Resolve this technically-verified prerequisite."));
  };
  L.push("Owner-machine readiness for the Forge worker (read-only — installs nothing, connects nowhere, reads no password)");
  L.push("Readiness is TECHNICALLY VERIFIED — no environment variable can make any check pass.");
  L.push("");
  L.push("SECURITY readiness (required before ANY real worker run):");
  const actions = [];
  for (const n of ["sandboxImplementationPresent", "sandboxAttestationPass", "executableValidated", "toolRestrictionVerified", "processOwnershipVerified", "processTerminationVerified", "networkDisabled"]) { const a = line(n); if (a) actions.push(a); }
  L.push("");
  L.push("REAL-RUN infrastructure:");
  for (const n of ["dockerReady", "supabaseReady"]) { const a = line(n); if (a) actions.push(a); }
  L.push("");
  L.push("SYNTHETIC validation (offline safety proofs): READY");
  L.push("REAL worker run: " + res.realBlockReason);
  L.push("");
  if (res.realBlockReason === "READY-FOR-REAL-WORKER-PROOF") {
    L.push("RESULT: all security + infrastructure prerequisites are TECHNICALLY VERIFIED. A real worker proof is possible (still owner/ChatGPT-gated).");
  } else {
    L.push("RESULT: the real worker run is NOT permitted yet. Synthetic validation runs safely.");
    L.push("");
    L.push("What to do next (in order):");
    actions.forEach((a, i) => L.push("  " + (i + 1) + ". " + a));
    L.push("");
    L.push("Nothing was installed or changed. NOT INSTALLED / NOT RUNNING / NOT SAFE are distinguished above by reason.");
  }
  return L.join("\n");
}

if (require.main === module) {
  const res = check();
  if (process.argv.indexOf("--html") >= 0) console.log(require("./owner-readiness-report.cjs").renderReadinessHtml(res));
  else console.log(present(res));
}
module.exports = { check, present, loadRuntimeConfig, detectDocker, detectSupabase, CHECK_TITLES };

```

## projectos/bridge/owner-readiness-report.cjs

```javascript
"use strict";
/**
 * Owner-facing readiness REPORT renderer — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§12).
 *
 * Renders the technically-verified readiness result (from owner-capability-check.check()) as a self-contained,
 * OFFLINE HTML page (no external fonts/scripts/network). Design applied from ui-ux-pro-max guidance: technical
 * dark+light palette, monospace/sans system stack, security-first hierarchy, status badges that carry an SVG
 * icon AND text (never colour-only), 4.5:1 contrast, visible focus, reduced-motion respected. It NEVER shows a
 * false READY — a check is READY only when its status is PASS; the overall banner reflects the real block state.
 *
 * Pure string rendering; no I/O, no network. `esc()` HTML-escapes every dynamic value.
 */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CHECK_TITLES = {
  sandboxImplementationPresent: "OS sandbox implementation",
  sandboxAttestationPass: "Sandbox attestation (live canaries)",
  executableValidated: "Claude executable identity",
  toolRestrictionVerified: "Worker tool restriction (detected)",
  processOwnershipVerified: "Process ownership (operation handle)",
  processTerminationVerified: "Process termination (lifecycle proven)",
  networkDisabled: "Network disabled",
  dockerReady: "Docker (for local Supabase)",
  supabaseReady: "Supabase CLI",
};
const SECURITY = ["sandboxImplementationPresent", "sandboxAttestationPass", "executableValidated", "toolRestrictionVerified", "processOwnershipVerified", "processTerminationVerified", "networkDisabled"];
const INFRA = ["dockerReady", "supabaseReady"];
// Plain-language recovery step per reason (ordered by the state machine).
const RECOVERY = {
  "no-sandbox-provider": "Configure and approve a real OS sandbox provider (restricted account / VM / container). The real worker is NOT SAFE without it.",
  "pid-only-provider-forbidden-for-real-runs": "Use a provider that owns a stable operation handle (job object / container id), not a bare process id.",
  "ownership:pid-handle-forbidden-for-real-runs": "The provider returned a bare process id. Use a provider that owns a stable operation handle (job object / container id).",
  "ownership:pid-only-provider-forbidden-for-real-runs": "The provider only offers a bare process id. Use a provider that owns a stable operation handle.",
  "sandbox-executable-identity-mismatch": "The executable measured INSIDE the sandbox does not match the approved detection record. Re-verify the sandbox image / executable before any real run.",
  "probe-cleanup-failed": "The readiness lifecycle probe left residue (an operation or a temporary workspace could not be cleaned). Do NOT run the real worker — investigate the leftover, then re-run readiness.",
  "invocation-restriction-not-applied": "The restricted command ProjectOS built was not APPLIED AND VERIFIED. Re-derive the detection record so the tool restriction is actually encoded.",
  "docker-not-installed": "Install Docker Desktop and start it.",
  "docker-not-running": "Open Docker Desktop and wait until it shows Running.",
  "supabase-cli-not-installed": "Install the Supabase CLI.",
};
// SVG (24x24, currentColor) — no emoji.
const ICON = {
  ready: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  action: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
};

function badge(pass) {
  const cls = pass ? "b-ready" : "b-action";
  const label = pass ? "READY" : "ACTION NEEDED";
  return '<span class="badge ' + cls + '" role="status">' + (pass ? ICON.ready : ICON.action) + '<span>' + label + '</span></span>';
}

function checkRow(name, c) {
  const pass = c.status === "PASS";
  return '<li class="row ' + (pass ? "ok" : "warn") + '">'
    + '<div class="row-main"><span class="row-title">' + esc(CHECK_TITLES[name] || name) + '</span>' + badge(pass) + '</div>'
    + (pass ? "" : '<p class="row-reason"><span class="reason-k">why:</span> ' + esc(c.reason || "blocked") + (RECOVERY[c.reason] ? '<br><span class="reason-k">fix:</span> ' + esc(RECOVERY[c.reason]) : "") + '</p>')
    + '</li>';
}

/** Render the full readiness result as a self-contained HTML document (string). */
function renderReadinessHtml(res) {
  const r = res || { checks: {}, realBlockReason: "BLOCKED-SANDBOX-IMPLEMENTATION" };
  const checks = r.checks || {};
  const ready = r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF";
  const emergency = r.realBlockReason === "EMERGENCY-STOP-REQUIRED";
  const bannerCls = emergency ? "banner-emergency" : ready ? "banner-ready" : "banner-blocked";
  const bannerText = emergency ? "EMERGENCY STOP — a worker operation could not be confirmed terminated"
    : ready ? "READY FOR REAL WORKER PROOF (still owner / ChatGPT gated)"
      : "NOT SAFE for a real worker run — " + esc(r.realBlockReason);
  const actions = SECURITY.concat(INFRA).map((n) => checks[n]).filter((c) => c && c.status !== "PASS");

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Worker readiness</title><style>',
    ':root{--bg:#f4f6fb;--surface:#ffffff;--surface2:#eef1f7;--text:#0f172a;--muted:#475569;--line:#cbd5e1;--ready:#15803d;--ready-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--danger:#b91c1c;--danger-bg:#fee2e2;--accent:#1e293b}',
    '@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--surface:#1e293b;--surface2:#334155;--text:#f8fafc;--muted:#cbd5e1;--line:#475569;--ready:#4ade80;--ready-bg:#14532d;--warn:#fbbf24;--warn-bg:#4d3707;--danger:#f87171;--danger-bg:#4c1010;--accent:#e2e8f0}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,"Fira Sans",system-ui,sans-serif;line-height:1.6;padding:24px}',
    '.wrap{max-width:820px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);font-size:14px;margin:0 0 20px}',
    '.banner{border-radius:12px;padding:16px 18px;font-weight:600;margin-bottom:24px;border:1px solid var(--line)}',
    '.banner-ready{background:var(--ready-bg);color:var(--ready)}.banner-blocked{background:var(--warn-bg);color:var(--warn)}.banner-emergency{background:var(--danger-bg);color:var(--danger)}',
    'h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:24px 0 10px}',
    'ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
    '.row{background:var(--surface);border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:12px 14px}',
    '.row.ok{border-left-color:var(--ready)}.row.warn{border-left-color:var(--warn)}',
    '.row-main{display:flex;align-items:center;justify-content:space-between;gap:12px}.row-title{font-weight:600;font-family:ui-monospace,"Fira Code",monospace;font-size:14px}',
    '.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap}',
    '.b-ready{background:var(--ready-bg);color:var(--ready)}.b-action{background:var(--warn-bg);color:var(--warn)}',
    '.row-reason{margin:8px 0 0;font-size:13px;color:var(--muted);font-family:ui-monospace,"Fira Code",monospace}.reason-k{color:var(--accent);font-weight:700}',
    'ol.recovery{margin:8px 0 0;padding-left:22px;display:grid;gap:8px}ol.recovery li{color:var(--text)}',
    '.note{margin-top:24px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}',
    'a:focus-visible,li:focus-visible{outline:3px solid var(--warn);outline-offset:2px}@media (prefers-reduced-motion:reduce){*{transition:none!important}}',
    '</style></head><body><div class="wrap">',
    '<h1>Forge worker — readiness</h1>',
    '<p class="sub">Read-only. Installs nothing, connects nowhere, reads no password. Readiness is technically verified — no environment variable can make a check pass.</p>',
    '<div class="banner ' + bannerCls + '" role="alert">' + bannerText + '</div>',
    '<h2>Security readiness (required before any real worker run)</h2><ul>',
    SECURITY.map((n) => checkRow(n, checks[n] || { status: "BLOCKED", reason: "not-evaluated" })).join(""),
    '</ul><h2>Real-run infrastructure</h2><ul>',
    INFRA.map((n) => checkRow(n, checks[n] || { status: "BLOCKED", reason: "not-evaluated" })).join(""),
    '</ul>',
    ready ? "" : ('<h2>What to do next (in order)</h2><ol class="recovery">' + actions.map((c) => '<li>' + esc(CHECK_TITLES_lookup(checks, c)) + ': ' + esc(RECOVERY[c.reason] || "Resolve this technically-verified prerequisite.") + '</li>').join("") + '</ol>'),
    '<p class="note">Synthetic validation (offline safety proofs) runs safely regardless. NOT INSTALLED / NOT RUNNING / NOT SAFE are distinguished by each item’s <em>why</em> line above.</p>',
    '</div></body></html>',
  ].join("");
}
// resolve a check's title from its object identity
function CHECK_TITLES_lookup(checks, cObj) {
  for (const k of Object.keys(checks)) if (checks[k] === cObj) return CHECK_TITLES[k] || k;
  return "prerequisite";
}

// Execution-outcome owner guidance (§18). Each blocked/emergency state answers the SIX questions an owner needs:
// what failed · whether a process may still exist · whether evidence was preserved · whether cleanup occurred ·
// the single next action · what must NOT be done. Distinct from readiness ("can a real run even start").
const EXECUTION_STATES = {
  "BLOCKED-SANDBOX-EXECUTABLE-IDENTITY": { title: "Sandbox executable mismatch", what: "The executable measured INSIDE the sandbox does not match the approved detection record (or could not be resolved / hashed / versioned).", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Re-verify the sandbox image and the claude executable inside it, then re-derive the detection record.", doNot: "Do NOT run the worker against an unverified executable." },
  "BLOCKED-WORKSPACE-MOUNT": { title: "Workspace mount mismatch", what: "The provider did not mount ONLY the exact workspace (or the mount policy / identities / ledger did not match this operation).", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Fix the provider so it mounts only the prepared workspace with the network disabled.", doNot: "Do NOT proceed while the canonical repo / home / credentials could be visible." },
  "BLOCKED-PROVIDER-PREPARATION": { title: "Provider preparation failure", what: "The provider could not return a valid prepared-operation descriptor for this workspace/operation.", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Repair the provider's prepareOperation contract, then re-run.", doNot: "Do NOT skip preparation and spawn directly." },
  "BLOCKED-INVOCATION-GRAMMAR": { title: "Invalid invocation grammar", what: "The exact 4-argument restricted command could not be constructed/verified (wrong shape, extra argument, or unsupported mechanism).", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Re-derive the detection record so ProjectOS builds exactly [mechanism, tools, -p, prompt].", doNot: "Do NOT hand-edit or widen the command." },
  "INVOCATION-RESTRICTION-NOT-APPLIED": { title: "Tool restriction not applied", what: "The tool restriction was not actually encoded in the command that would run.", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Re-derive the detection record so the restriction is APPLIED AND VERIFIED, then re-run.", doNot: "Do NOT run an unrestricted worker." },
  "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT": { title: "Workspace not equivalent to baseline", what: "The disposable workspace did not exactly match the approved baseline (a symlink could not be reproduced).", processMayExist: false, evidencePreserved: false, cleanup: "Partial workspace removed; no substitute file was executed.", nextAction: "Use a host/provider that preserves the entry types (symlinks).", doNot: "Do NOT run against a regular-file substitute for a symlink." },
  "OPERATION-DISPOSAL-FAILED": { title: "Operation disposal failure", what: "The process was confirmed terminated, but the sandbox operation did not dispose cleanly (leftover operation state).", processMayExist: false, evidencePreserved: true, cleanup: "Process confirmed dead; operation residue remains — see operationResidue.", nextAction: "Investigate and dispose the leftover operation state before any further run.", doNot: "Do NOT treat the run as complete." },
  "WORKSPACE-DISPOSAL-FAILED": { title: "Workspace disposal failure", what: "The disposable source-tree workspace could not be deleted after the run.", processMayExist: false, evidencePreserved: true, cleanup: "Operation disposed; the host workspace directory remains — see residue.", nextAction: "Remove the leftover workspace directory manually.", doNot: "Do NOT reuse the leftover workspace for another run." },
  "EMERGENCY-STOP-REQUIRED": { title: "Emergency stop — operation not confirmed terminated", what: "A worker operation could NOT be confirmed terminated (unconfirmed, a termination contradiction, or an unexpected error while a handle existed).", processMayExist: true, evidencePreserved: true, cleanup: "NO destructive cleanup performed; operation + workspace evidence preserved.", nextAction: "Manually resolve the live/uncertain process, confirm it is gone, then re-run readiness.", doNot: "Do NOT reconcile, reuse, or delete the workspace, and do NOT start another run." },
  "BLOCKED-SANDBOX-ATTESTATION": { title: "Sandbox attestation failure", what: "The provider could not attest isolation for this exact prepared workspace/operation.", processMayExist: false, evidencePreserved: false, cleanup: "Workspace disposed; no operation was started.", nextAction: "Fix the provider's attestation (live canaries for the mounted workspace).", doNot: "Do NOT proceed without a passing attestation." },
  "BLOCKED-PROCESS-OWNERSHIP": { title: "Process ownership rejected", what: "The provider handle was a bare process id (forbidden for real runs); the operation was terminated and disposed safely.", processMayExist: false, evidencePreserved: true, cleanup: "Operation confirmed terminated and disposed.", nextAction: "Use a provider that owns a stable operation handle (job object / container id).", doNot: "Do NOT run with a bare-PID provider." },
};
// Back-compat: a flat reason→next-action map some callers still read.
const EXECUTION_RECOVERY = Object.keys(EXECUTION_STATES).reduce((m, k) => { m[k] = EXECUTION_STATES[k].nextAction; return m; }, {});

function executionStateFor(result, decisionReason) {
  const r = result || {}; const reason = decisionReason || r.reason || "";
  if (EXECUTION_STATES[reason]) return { key: reason, state: EXECUTION_STATES[reason] };
  if (r.processTerminationStatus === "EMERGENCY-STOP-REQUIRED") return { key: "EMERGENCY-STOP-REQUIRED", state: EXECUTION_STATES["EMERGENCY-STOP-REQUIRED"] };
  return null;
}

/** Multi-line execution-state summary for a run result (terminal/console). Never asserts success falsely. */
function renderExecutionState(result, decisionReason) {
  const r = result || {}; const found = executionStateFor(r, decisionReason);
  const emergency = r.processTerminationStatus === "EMERGENCY-STOP-REQUIRED";
  const lines = [];
  lines.push("Run outcome: " + (emergency ? "EMERGENCY STOP" : (r.outcome || "unknown")));
  lines.push("  invocation restriction: " + (r.invocationRestrictionStatus || "NOT VERIFIED"));
  lines.push("  invocation grammar:     " + (r.invocationGrammarStatus || "NOT VERIFIED"));
  lines.push("  sandbox executable id:  " + (r.sandboxExecutableIdentityHash ? "bound" : "not-bound"));
  lines.push("  process termination:    " + (r.processTerminationStatus || "NOT APPLICABLE"));
  lines.push("  operation disposal:     " + (r.operationDisposalStatus || "not-disposed"));
  if (Array.isArray(r.operationResidue) && r.operationResidue.length) lines.push("  operation residue:      " + r.operationResidue.join(", "));
  if (found) {
    const s = found.state;
    lines.push("");
    lines.push("[ " + s.title.toUpperCase() + " ]");
    lines.push("  what failed:            " + s.what);
    lines.push("  a process may exist:    " + (s.processMayExist ? "YES — treat as live until proven gone" : "no"));
    lines.push("  evidence preserved:     " + (s.evidencePreserved ? "yes" : "n/a (nothing ran)"));
    lines.push("  cleanup:                " + s.cleanup);
    lines.push("  next owner action:      " + s.nextAction);
    lines.push("  must NOT do:            " + s.doNot);
  }
  return lines.join("\n");
}

// Self-contained offline HTML for a single execution-state (reuses the readiness visual system; text+icon, not
// colour-only). Renders the six owner facts explicitly.
function renderExecutionHtml(result, decisionReason) {
  const r = result || {}; const found = executionStateFor(r, decisionReason);
  const emergency = r.processTerminationStatus === "EMERGENCY-STOP-REQUIRED";
  const title = found ? found.state.title : (r.outcome === "COMPLETED" ? "Run complete" : "Run outcome");
  const bannerCls = emergency ? "banner-emergency" : found ? "banner-blocked" : "banner-ready";
  const fact = (k, v, danger) => '<div class="fact' + (danger ? " fact-danger" : "") + '"><span class="fk">' + esc(k) + '</span><span class="fv">' + esc(v) + '</span></div>';
  const s = found && found.state;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Worker run — ' + esc(title) + '</title><style>',
    ':root{--bg:#f4f6fb;--surface:#fff;--text:#0f172a;--muted:#475569;--line:#cbd5e1;--ready:#15803d;--ready-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--danger:#b91c1c;--danger-bg:#fee2e2;--accent:#1e293b}',
    '@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--surface:#1e293b;--text:#f8fafc;--muted:#cbd5e1;--line:#475569;--ready:#4ade80;--ready-bg:#14532d;--warn:#fbbf24;--warn-bg:#4d3707;--danger:#f87171;--danger-bg:#4c1010;--accent:#e2e8f0}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6;padding:24px}.wrap{max-width:760px;margin:0 auto}',
    'h1{font-size:20px;margin:0 0 12px}.banner{border-radius:12px;padding:16px 18px;font-weight:600;margin-bottom:20px;border:1px solid var(--line)}',
    '.banner-ready{background:var(--ready-bg);color:var(--ready)}.banner-blocked{background:var(--warn-bg);color:var(--warn)}.banner-emergency{background:var(--danger-bg);color:var(--danger)}',
    '.facts{display:grid;gap:10px}.fact{display:grid;grid-template-columns:190px 1fr;gap:12px;background:var(--surface);border:1px solid var(--line);border-left-width:4px;border-left-color:var(--line);border-radius:10px;padding:12px 14px}',
    '.fact-danger{border-left-color:var(--danger)}.fk{font-weight:700;font-family:ui-monospace,monospace;font-size:13px;color:var(--accent)}.fv{font-size:14px;color:var(--text)}',
    '@media (max-width:560px){.fact{grid-template-columns:1fr}}@media (prefers-reduced-motion:reduce){*{transition:none!important}}',
    '</style></head><body><div class="wrap"><h1>Forge worker — run state</h1>',
    '<div class="banner ' + bannerCls + '" role="alert">' + esc(title) + '</div>',
    '<div class="facts">',
    fact("outcome", emergency ? "EMERGENCY STOP" : (r.outcome || "unknown")),
    fact("process termination", r.processTerminationStatus || "NOT APPLICABLE"),
    fact("operation disposal", r.operationDisposalStatus || "not-disposed"),
    s ? fact("what failed", s.what) : "",
    s ? fact("a process may exist", s.processMayExist ? "YES — treat as live until proven gone" : "no", s.processMayExist) : "",
    s ? fact("evidence preserved", s.evidencePreserved ? "yes" : "n/a (nothing ran)") : "",
    s ? fact("cleanup", s.cleanup) : "",
    s ? fact("next owner action", s.nextAction) : "",
    s ? fact("must NOT do", s.doNot, true) : "",
    '</div></div></body></html>',
  ].join("");
}

module.exports = { renderReadinessHtml, renderExecutionState, renderExecutionHtml, executionStateFor, esc, CHECK_TITLES, EXECUTION_STATES, EXECUTION_RECOVERY };

```

## projectos/bridge/runtime-config.cjs

```javascript
"use strict";
/**
 * Shared runtime-configuration validation — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E (§12, §13).
 *
 * The owner capability checker and the worker adapter share the SAME verifier functions (prepared-operation,
 * attestation, sandbox-executable identity, detection record, exact-invocation grammar) and this module's
 * readiness evaluation. NO environment marker can make any security check PASS — readiness is technically
 * verified or BLOCKED. A `kind:"mock"` provider can prove the verifiers work but can NEVER reach READY-FOR-REAL.
 *
 * §12/§13: readiness runs a REAL LIFECYCLE PROBE — it materialises a harmless temporary probe workspace, prepares
 * it through the provider, attests the real mounted probe, resolves+hashes the executable inside the provider,
 * builds the exact restricted argv, creates an actual stable operation handle, verifies the handle type, exercises
 * process-scope termination, then disposes the operation + probe workspace + sentinel in an UNCONDITIONAL finally.
 * There are NO placeholder workspace values and NO default-pass path — a null/malformed/crashed probe is BLOCKED,
 * and any inability to clean the probe blocks readiness and is shown in the readiness evidence.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const sandbox = require("./sandbox-provider.cjs");
const attestation = require("./attestation.cjs");
const detector = require("./invocation-detector.cjs");
const execcheck = require("./executable-check.cjs");
const ledger = require("./workspace-ledger.cjs");

const CHECKS = [
  "sandboxImplementationPresent", "sandboxAttestationPass", "executableValidated", "toolRestrictionVerified",
  "processOwnershipVerified", "processTerminationVerified", "networkDisabled", "dockerReady", "supabaseReady",
];
// A REAL, independently-verifiable sentinel for the process-scope probe (only for real providers): a genuine
// separate OS process whose liveness is checked via signal-0, so an over-broad provider terminate is caught.
function realSentinel() {
  let spawnFailed = false;
  const child = require("child_process").spawn(process.execPath, ["-e", "setTimeout(function(){}, 5000)"], { stdio: "ignore" });
  // A spawn failure is delivered asynchronously as an 'error' event; without a listener Node THROWS it and can
  // crash the host. Record it and report the sentinel as dead so the probe fails closed instead.
  child.on("error", () => { spawnFailed = true; });
  return { pid: child.pid, alive: () => { if (spawnFailed) return false; try { process.kill(child.pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } }, kill: () => { try { child.kill(); } catch (e) {} } };
}

function git(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }

/**
 * §12/§13 — run the full readiness lifecycle probe against a REAL temporary workspace. Returns a structured
 * result; ALL probe resources are torn down in the unconditional finally, and any residue blocks readiness.
 */
function realProbeLifecycle(provider, config) {
  const c = config || {};
  const st = {
    materialisedOk: false, preparedOk: false, exeIdentityOk: false, attestationOk: false, argvOk: false,
    handleType: null, ownershipOk: false, terminationOk: false, terminationReason: null,
    cleanup: { probeOperation: "n/a", sentinel: "n/a", preparedOperation: "n/a", providerResidue: [], hostWorkspaceResidue: [] },
    cleanupOk: false, errors: [],
  };
  let repo = null, workspace = null, handle = null, prep = null;
  try {
    // materialise a real, harmless probe workspace from a throwaway git repo
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "pos-rp-"));
    git(repo, ["init", "-q"]); git(repo, ["checkout", "-q", "-B", "probe"]); git(repo, ["config", "user.email", "p@p"]); git(repo, ["config", "user.name", "p"]);
    fs.mkdirSync(path.join(repo, "app"), { recursive: true }); fs.writeFileSync(path.join(repo, "app", "probe.txt"), "probe\n");
    git(repo, ["add", "-A"]); git(repo, ["commit", "-q", "-m", "probe"]);
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    const mat = ledger.materialize(repo, head, {}); // synthetic probe workspace (fine on a symlink-incapable host)
    workspace = mat.workspace; st.materialisedOk = true;
    const preLedger = ledger.hashSnapshot(ledger.snapshot(workspace));
    const mountPolicy = sandbox.MOUNT_POLICY_FIRST_PROOF; const mph = sandbox.mountPolicyHash(mountPolicy);

    // prepare + verify the prepared operation against the REAL probe workspace
    try { prep = provider.prepareOperation({ operationId: "readiness-probe-op", projectId: "readiness", phaseId: "readiness", workspaceId: mat.workspaceId, hostWorkspacePath: workspace, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash: preLedger, networkPolicy: provider.networkPolicy, executableIdentity: null, mountPolicy }); } catch (e) { prep = null; }
    const pv = sandbox.verifyPreparedOperation(prep, { operationId: "readiness-probe-op", workspaceId: mat.workspaceId, hostWorkspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, preExecutionLedgerHash: preLedger, mountPolicyHash: mph, providerId: provider.providerId });
    st.preparedOk = pv.ok; if (!pv.ok) st.errors.push("prepare:" + (pv.errors[0] || "failed"));

    // resolve/hash/version the executable inside the provider + verify identity
    let sp = null, sh = null, sv = null;
    if (prep) { try { sp = provider.resolveExecutable(prep, c.claudeBin); } catch (e) {} try { sh = sp ? provider.hashExecutable(prep, sp) : null; } catch (e) {} try { sv = sp ? provider.getExecutableVersion(prep, sp) : null; } catch (e) {} }
    const exeId = sandbox.buildExecutableIdentity({ hostRequestedExecutable: c.claudeBin, hostResolvedPath: sp, hostContentHash: null, sandboxResolvedPath: sp, sandboxContentHash: sh, sandboxReportedVersion: sv, providerId: provider.providerId, preparedOperationId: prep && prep.preparedOperationId });
    const eiv = sandbox.verifyExecutableIdentity(exeId, { expectedContentHash: c.executableContentHash, cliVersion: c.cliVersion, providerId: provider.providerId, preparedOperationId: prep && prep.preparedOperationId });
    st.exeIdentityOk = eiv.ok; if (!eiv.ok) st.errors.push("exe-identity:" + (eiv.errors[0] || "failed"));

    // attest the REAL mounted probe operation
    const attCtx = {
      providerId: provider.providerId, providerVersion: provider.providerVersion, providerImplementationHash: provider.providerImplementationHash,
      preparedOperationId: prep && prep.preparedOperationId, operationId: "readiness-probe-op", projectId: "readiness", phaseId: "readiness",
      workspaceId: mat.workspaceId, workspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash,
      workspacePathInsideSandbox: prep && prep.sandboxWorkspacePath, mountPolicyHash: mph, preExecutionLedgerHash: preLedger,
      executableResolvedPathInsideSandbox: sp, sandboxExecutablePath: sp, sandboxExecutableHash: sh, sandboxExecutableVersion: sv,
    };
    let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
    const av = attestation.verifyAttestation(att, attCtx); st.attestationOk = av.ok; if (!av.ok) st.errors.push("attest:" + (av.errors[0] || "failed"));

    // construct the exact restricted argv (proves the invocation constructs cleanly for the probe)
    try { if (c.detectionRecord) { const b = detector.buildArgv(c.detectionRecord, "readiness-probe"); st.argvOk = detector.verifyGrammar(b.argv, c.detectionRecord, "readiness-probe", { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, policyVersion: c.policyVersion }).ok && detector.verifyInvocation(b.argv, c.detectionRecord, "readiness-probe").status === detector.INVOCATION_STATUS.APPLIED_VERIFIED; } } catch (e) { st.argvOk = false; }

    // create an actual stable operation handle + verify the handle type (no default-pass)
    try { handle = provider.spawnOperation({ probe: true, operationId: "readiness-probe-op", bin: sp || "<probe>", argv: [], cwd: workspace, env: {} }); } catch (e) { handle = null; }
    if (!handle || !handle.handleType) { st.ownershipOk = false; st.errors.push("ownership:no-handle"); }
    else { st.handleType = handle.handleType; if (handle.handleType === "pid" && provider.kind !== "mock") { st.ownershipOk = false; st.errors.push("ownership:pid-handle-forbidden-for-real-runs"); } else if (provider.pidFallback === true && provider.kind !== "mock") { st.ownershipOk = false; st.errors.push("ownership:pid-only-provider-forbidden-for-real-runs"); } else st.ownershipOk = true; }

    // exercise process-scope termination (real sentinel for a non-mock provider)
    const probe = sandbox.probeProcessControl(provider, provider.kind === "mock" ? {} : { sentinelFn: realSentinel });
    st.terminationOk = probe.ok; st.terminationReason = probe.reason; if (!probe.ok) st.errors.push("termination:" + probe.reason);
    // sentinel cleanup reflects the ACTUAL kill outcome the probe reports (never a hardcoded literal).
    st.cleanup.sentinel = probe.sentinelCleaned === false ? "cleanup-failed" : "cleaned";
    if (probe.sentinelCleaned === false) st.errors.push("sentinel:cleanup-failed");
  } catch (e) { st.errors.push("probe-crashed:" + String(e && e.message).slice(0, 90)); st.ownershipOk = false; }
  finally {
    // §13 — unconditional teardown accounting for EVERY probe resource.
    try { if (handle) { try { provider.terminateOperation(handle); } catch (e) {} let d = null; try { d = provider.disposeOperation(handle); } catch (e) {} st.cleanup.probeOperation = d && d.disposed ? "disposed" : "dispose-failed"; if (d && Array.isArray(d.residue) && d.residue.length) st.cleanup.providerResidue = d.residue; } else st.cleanup.probeOperation = "none"; } catch (e) { st.cleanup.probeOperation = "cleanup-error"; }
    st.cleanup.preparedOperation = prep ? "released" : "none";
    try { if (workspace) { const res = ledger.dispose(workspace); if (res && res.length) st.cleanup.hostWorkspaceResidue = res; } } catch (e) { st.cleanup.hostWorkspaceResidue.push(String(workspace)); }
    try { if (repo) fs.rmSync(repo, { recursive: true, force: true }); } catch (e) { st.cleanup.hostWorkspaceResidue.push(String(repo)); }
  }
  st.cleanupOk = (st.cleanup.probeOperation === "disposed" || st.cleanup.probeOperation === "none") && st.cleanup.sentinel === "cleaned" && st.cleanup.providerResidue.length === 0 && st.cleanup.hostWorkspaceResidue.length === 0;
  if (!st.cleanupOk) st.errors.push("cleanup:probe-residue");
  return st;
}

function checkReadiness(config, ctx, opts) {
  const c = config || {}; const o = opts || {}; const context = ctx || {};
  const checks = {};
  const pass = (n) => { checks[n] = { status: "PASS" }; };
  const block = (n, reason, extra) => { checks[n] = Object.assign({ status: "BLOCKED", reason }, extra || {}); };
  const provider = c.sandboxProvider;
  const isMock = provider && provider.kind === "mock";

  // 1) sandbox implementation present (concrete provider, all contract methods)
  const provErrors = provider ? sandbox.validateProvider(provider) : ["no-sandbox-provider"];
  provErrors.length ? block("sandboxImplementationPresent", provErrors[0], { errors: provErrors }) : pass("sandboxImplementationPresent");

  // Resolve the HOST executable once (real providers only) — proves a real host binary exists (the CONTENT-HASH
  // + version binding is enforced against the SANDBOX executable identity in the lifecycle probe, not here).
  let ev = null;
  if (provider && !isMock) { try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { ev = { ok: false, reason: "executable-check-crashed" }; } }

  // §12/§13 — run the REAL lifecycle probe ONCE when a provider object exists (no default-pass path).
  const probe = provider ? realProbeLifecycle(provider, c) : null;

  // 2) sandbox attestation (structured, operation-bound, verified against the REAL probe workspace)
  if (checks.sandboxImplementationPresent.status !== "PASS") block("sandboxAttestationPass", "no-valid-provider");
  else if (!probe || !probe.attestationOk) block("sandboxAttestationPass", (probe && probe.errors.find((e) => e.startsWith("attest:"))) || "attestation-failed", { probeErrors: probe && probe.errors });
  else pass("sandboxAttestationPass");

  // 3) executable validated — mock attests synthetically; a real provider must resolve a host binary AND the
  //    SANDBOX executable identity must match the detection record (verified inside the probe).
  if (isMock) pass("executableValidated");
  else if (!ev || !ev.ok) block("executableValidated", (ev && ev.reason) || "not-validated");
  else if (Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) block("executableValidated", "not-in-provider-permitted-executables");
  else if (!probe || !probe.exeIdentityOk) block("executableValidated", (probe && probe.errors.find((e) => e.startsWith("exe-identity:"))) || "sandbox-executable-identity-mismatch");
  else pass("executableValidated");

  // 4) tool restriction verified (detection record bound to executable + version + provider + policy) AND the
  //    ProjectOS-built argv must be APPLIED AND VERIFIED under the exact grammar (§9 parity with the adapter).
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider && provider.providerId, policyVersion: c.policyVersion, now: context.now, firstControlledChange: true });
  let invOk = false; try { if (dv.ok) { const b = detector.buildArgv(c.detectionRecord, "readiness-probe"); invOk = detector.verifyGrammar(b.argv, c.detectionRecord, "readiness-probe", { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, policyVersion: c.policyVersion }).ok && detector.verifyInvocation(b.argv, c.detectionRecord, "readiness-probe").status === detector.INVOCATION_STATUS.APPLIED_VERIFIED; } } catch (e) { invOk = false; }
  if (!dv.ok) block("toolRestrictionVerified", dv.errors[0] || "no-detection-record", { errors: dv.errors });
  else if (!invOk) block("toolRestrictionVerified", "invocation-restriction-not-applied");
  else pass("toolRestrictionVerified");

  // 5) process OWNERSHIP — from the REAL probe: a stable operation handle (not a bare PID) AND a clean probe
  //    teardown. Allowed results are PASS or BLOCKED-PROCESS-OWNERSHIP; a null/crashed probe is BLOCKED.
  if (!provider || sandbox.OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) block("processOwnershipVerified", "no-operation-lifecycle");
  else if (!probe || !probe.ownershipOk) block("processOwnershipVerified", (probe && probe.errors.find((e) => e.startsWith("ownership:"))) || "ownership-probe-failed", { handleType: probe && probe.handleType });
  else if (!probe.cleanupOk) block("processOwnershipVerified", "probe-cleanup-failed", { cleanup: probe.cleanup });
  else pass("processOwnershipVerified");

  // 6) process TERMINATION — from the REAL probe (real sentinel for a real provider).
  if (!provider) block("processTerminationVerified", "no-provider");
  else if (!probe || !probe.terminationOk) block("processTerminationVerified", (probe && probe.terminationReason) || "termination-probe-failed");
  else if (!probe.cleanupOk) block("processTerminationVerified", "probe-cleanup-failed", { cleanup: probe.cleanup });
  else pass("processTerminationVerified");

  // 7) network disabled (first controlled-change proof requires disabled — no allowlist)
  (!provider || provider.networkPolicy !== "disabled") ? block("networkDisabled", provider ? "network-policy-not-disabled:" + provider.networkPolicy : "no-provider") : pass("networkDisabled");

  // 8/9) infra
  o.docker && o.docker.status === "PASS" ? pass("dockerReady") : block("dockerReady", (o.docker && o.docker.how) || "not-checked");
  o.supabase && o.supabase.status === "PASS" ? pass("supabaseReady") : block("supabaseReady", (o.supabase && o.supabase.how) || "not-checked");

  return { checks, overall: overallState(checks, isMock), realBlockReason: realBlockReason(checks, isMock), probeEvidence: probe ? { cleanup: probe.cleanup, cleanupOk: probe.cleanupOk, handleType: probe.handleType, materialisedOk: probe.materialisedOk } : null };
}

const STATE_ORDER = [
  ["sandboxImplementationPresent", "BLOCKED-SANDBOX-IMPLEMENTATION"],
  ["sandboxAttestationPass", "BLOCKED-SANDBOX-ATTESTATION"],
  ["executableValidated", "BLOCKED-EXECUTABLE"],
  ["toolRestrictionVerified", "BLOCKED-TOOL-RESTRICTION"],
  ["processOwnershipVerified", "BLOCKED-PROCESS-OWNERSHIP"],
  ["processTerminationVerified", "BLOCKED-PROCESS-CONTROL"],
  ["networkDisabled", "BLOCKED-NETWORK-POLICY"],
  ["dockerReady", "BLOCKED-DOCKER"],
  ["supabaseReady", "BLOCKED-SUPABASE"],
];
function realBlockReason(checks, isMock) {
  // A mock provider can never be READY for a REAL run, even if every verifier passes.
  if (isMock) return "BLOCKED-SANDBOX-IMPLEMENTATION";
  for (const [name, state] of STATE_ORDER) if (checks[name] && checks[name].status !== "PASS") return state;
  return "READY-FOR-REAL-WORKER-PROOF";
}
function overallState(checks, isMock) {
  const r = realBlockReason(checks, isMock);
  return r === "READY-FOR-REAL-WORKER-PROOF" ? "READY-FOR-REAL-WORKER-PROOF" : "READY-FOR-SYNTHETIC-VALIDATION";
}

module.exports = { checkReadiness, realProbeLifecycle, realBlockReason, overallState, CHECKS, STATE_ORDER };

```

## projectos/bridge/sandbox-provider.cjs

```javascript
"use strict";
/**
 * OS-level worker-containment contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§4, §6, §7).
 *
 * A sandbox PROVIDER attests an OS-enforced boundary AND owns the worker's execution via a STABLE operation
 * handle (Windows Job Object / container exec id / VM session / restricted-service op id) — never a bare,
 * reusable OS PID. It exposes an operation lifecycle (spawn/status/enumerate/terminate/confirm/preserve/
 * dispose) and a structured, operation-bound `attest(ctx)` (see attestation.cjs). Fails closed: no provider,
 * or a provider missing any contract method, or (for real runs) `kind:"mock"` ⇒ BLOCKED. No unrestricted
 * owner-account fallback. This phase installs no real sandbox; the mock proves the contract synthetically and
 * is refused for real runs.
 */

const crypto = require("crypto");
const attestation = require("./attestation.cjs");

const OPERATION_METHODS = ["spawnOperation", "readOperationOutput", "readOperationError", "waitForOperationExit", "operationStatus", "enumerateOperationProcesses", "terminateOperation", "confirmOperationTerminated", "preserveOperationEvidence", "disposeOperation"];
// §4/§5 — provider preparation + custody and ACTUAL sandbox-executable identity. A provider must MOUNT the exact
// workspace and be able to resolve/hash/version the executable INSIDE the sandbox (never assume host == sandbox).
const PREPARE_METHODS = ["prepareOperation", "resolveExecutable", "hashExecutable", "getExecutableVersion"];
const REQUIRED_FIELDS = [
  "name", "kind", "providerId", "providerVersion", "attest",
  "readablePaths", "writablePaths", "mountedWorkspace",
  "canonicalVisibility", "otherProjectVisibility", "homeVisibility", "credentialVisibility",
  "networkPolicy", "permittedExecutables", "processLimits", "childProcessPolicy",
  "cleanupPolicy", "emergencyTermination",
].concat(PREPARE_METHODS).concat(OPERATION_METHODS);

function verMatch(detected, want) { if (!detected || !want) return true; const w = String(want).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp("(^|[^0-9.])" + w + "([^0-9.]|$)").test(String(detected)); }
function hashObj(o) { return crypto.createHash("sha256").update(attestation.canonicalJson(o || {})).digest("hex"); }

// The canonical, fail-closed mount policy for the first controlled-change proof: nothing but the workspace is
// mounted, and the network is disabled. Both ProjectOS and the provider hash THIS exact object so a mount-policy
// mismatch is detectable — a caller-supplied hash alone is never accepted as proof (§4).
const MOUNT_POLICY_FIRST_PROOF = { canonicalMounted: false, otherProjectsMounted: false, homeMounted: false, credentialsMounted: false, networkPolicy: "disabled" };
function mountPolicyHash(mp) { return hashObj(mp || MOUNT_POLICY_FIRST_PROOF); }

function networkOk(p) {
  if (p.networkPolicy === "disabled") return true;
  if (p.networkPolicy === "allowlist") return Array.isArray(p.networkAllowlist) && p.networkAllowlist.length > 0 && !p.networkAllowlist.some((h) => String(h).includes("*") || String(h) === "0.0.0.0/0");
  return false;
}
function isReallyIsolated(p) {
  return p && p.canonicalVisibility === "not-mounted" && p.otherProjectVisibility === "not-mounted"
    && p.homeVisibility === "not-mounted" && p.credentialVisibility === "not-mounted"
    && networkOk(p) && Array.isArray(p.permittedExecutables);
}

function validateProvider(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["sandbox: no provider object"];
  for (const f of REQUIRED_FIELDS) if (!(f in p)) errors.push("sandbox: missing '" + f + "'");
  if (p && typeof p.attest !== "function") errors.push("sandbox: attest must be a function");
  for (const m of OPERATION_METHODS) if (p && typeof p[m] !== "function") errors.push("sandbox: operation method '" + m + "' must be a function");
  for (const m of PREPARE_METHODS) if (p && typeof p[m] !== "function") errors.push("sandbox: preparation method '" + m + "' must be a function");
  if (p && p.networkPolicy === "allowlist" && !networkOk(p)) errors.push("sandbox: networkPolicy 'allowlist' requires a concrete non-wildcard networkAllowlist");
  if (p && !isReallyIsolated(p)) errors.push("sandbox: provider does not attest full isolation (canonical/other/home/credential not-mounted; network disabled or concrete allowlist)");
  return errors;
}

/** @returns { ok:true, provider } | { ok:false, decision:"BLOCKED", reason } */
function resolveSandbox(config, opts) {
  const o = opts || {};
  const p = config && config.sandboxProvider;
  if (!p) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-NOT-CONFIGURED" };
  const errors = validateProvider(p);
  if (errors.length) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-INVALID", errors };
  if (o.requireReal && p.kind === "mock") return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-MOCK-NOT-ALLOWED-FOR-REAL-RUN" };
  return { ok: true, provider: p };
}

function policySummary(p) {
  if (!p) return null;
  return {
    provider: p.name, providerId: p.providerId, providerVersion: p.providerVersion, kind: p.kind,
    mountedWorkspace: p.mountedWorkspace, canonicalVisibility: p.canonicalVisibility,
    otherProjectVisibility: p.otherProjectVisibility, homeVisibility: p.homeVisibility,
    credentialVisibility: p.credentialVisibility, networkPolicy: p.networkPolicy,
    permittedExecutables: p.permittedExecutables, processLimits: p.processLimits,
    childProcessPolicy: p.childProcessPolicy, cleanupPolicy: p.cleanupPolicy, operationHandleType: p.operationHandleType || p.kind,
  };
}

// ── §4 PROVIDER PREPARATION AND WORKSPACE CUSTODY ────────────────────────────────────────────────────
const PREP_REQUIRED = [
  "preparedOperationId", "providerId", "providerVersion", "providerImplementationHash", "operationId",
  "workspaceId", "hostWorkspacePathHash", "sandboxWorkspacePath", "materialisationManifestHash",
  "preExecutionLedgerHash", "mountPolicyHash", "canonicalMounted", "otherProjectsMounted", "homeMounted",
  "credentialsMounted", "networkPolicy", "preparationTimestamp", "preparationExpiry", "preparationEvidenceHash",
];
// Context fields the caller MUST supply for binding — a missing one is a failure, never a skipped binding.
const PREP_CTX = ["operationId", "workspaceId", "hostWorkspacePathHash", "materialisationManifestHash", "preExecutionLedgerHash", "mountPolicyHash", "providerId"];
function hashPrepared(p) { const c = Object.assign({}, p); delete c.preparationEvidenceHash; return hashObj(c); }

/**
 * Verify a provider-returned prepared-operation descriptor against the CURRENT operation. Fails unless the
 * provider mounted NOTHING but the workspace (all mount flags false), disabled the network, and every identity
 * and hash matches this exact operation. A caller-supplied hash alone is never accepted — the descriptor must
 * echo the bindings AND carry a valid integrity hash of its own actual mount. Returns { ok, errors }.
 */
function verifyPreparedOperation(prep, ctx) {
  const errors = []; const c = ctx || {};
  if (!prep || typeof prep !== "object") return { ok: false, errors: ["prepared-operation: not an object"] };
  for (const f of PREP_REQUIRED) if (!(f in prep)) errors.push("prepared-operation: missing '" + f + "'");
  // mounts MUST all be false; network disabled.
  for (const [flag, label] of [["canonicalMounted", "canonical repo"], ["otherProjectsMounted", "other projects"], ["homeMounted", "home"], ["credentialsMounted", "credentials"]]) {
    if (prep[flag] !== false) errors.push("prepared-operation: " + flag + " must be false (" + label + " must NOT be mounted)");
  }
  if (prep.networkPolicy !== "disabled") errors.push("prepared-operation: networkPolicy must be 'disabled'");
  // identity + hash binding to THIS operation (ctx complete — a missing ctx field is a failure).
  for (const k of PREP_CTX) { if (c[k] === undefined || c[k] === null) { errors.push("prepared-operation: incomplete context (missing " + k + ")"); continue; } if (prep[k] !== c[k]) errors.push("prepared-operation: " + k + " does not match the current operation"); }
  // freshness
  const now = typeof c.now === "number" ? c.now : Date.now();
  if (typeof prep.preparationTimestamp !== "number" || typeof prep.preparationExpiry !== "number") errors.push("prepared-operation: timestamps must be numbers");
  else if (prep.preparationExpiry <= now) errors.push("prepared-operation: preparation expired");
  // integrity — always compared, well-formed sha256 hex required (integrity, not authenticity).
  if (typeof prep.preparationEvidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(prep.preparationEvidenceHash)) errors.push("prepared-operation: preparationEvidenceHash missing/invalid");
  else if (hashPrepared(prep) !== prep.preparationEvidenceHash) errors.push("prepared-operation: preparationEvidenceHash mismatch (modified)");
  return { ok: errors.length === 0, errors };
}

// ── §5 ACTUAL SANDBOX EXECUTABLE IDENTITY ────────────────────────────────────────────────────────────
const EXEID_REQUIRED = ["hostRequestedExecutable", "hostResolvedPath", "hostContentHash", "sandboxResolvedPath", "sandboxContentHash", "sandboxReportedVersion", "providerId", "preparedOperationId", "identityEvidenceHash"];
function hashExeIdentity(id) { const c = Object.assign({}, id); delete c.identityEvidenceHash; return hashObj(c); }
/** Build the executable-identity object from measured host + sandbox facts (adds its own integrity hash). */
function buildExecutableIdentity(f) {
  const id = {
    hostRequestedExecutable: f.hostRequestedExecutable == null ? null : f.hostRequestedExecutable,
    hostResolvedPath: f.hostResolvedPath == null ? null : f.hostResolvedPath,
    hostContentHash: f.hostContentHash == null ? null : f.hostContentHash,
    sandboxResolvedPath: f.sandboxResolvedPath == null ? null : f.sandboxResolvedPath,
    sandboxContentHash: f.sandboxContentHash == null ? null : f.sandboxContentHash,
    sandboxReportedVersion: f.sandboxReportedVersion == null ? null : f.sandboxReportedVersion,
    providerId: f.providerId == null ? null : f.providerId,
    preparedOperationId: f.preparedOperationId == null ? null : f.preparedOperationId,
  };
  id.identityEvidenceHash = hashExeIdentity(id);
  return id;
}
/**
 * Verify sandbox executable identity. Fails when the sandbox executable cannot be resolved / hashed / versioned,
 * when the SANDBOX content hash or version does not match what the detection record + attestation are bound to,
 * or when provider / prepared-operation identity drifts. The host path is a DISTINCT concept — it is never used
 * as the sandbox path. Returns { ok, errors }. Caller maps !ok ⇒ BLOCKED-SANDBOX-EXECUTABLE-IDENTITY.
 */
function verifyExecutableIdentity(id, ctx) {
  const errors = []; const c = ctx || {};
  if (!id || typeof id !== "object") return { ok: false, errors: ["exe-identity: not an object"] };
  for (const f of EXEID_REQUIRED) if (!(f in id)) errors.push("exe-identity: missing '" + f + "'");
  if (!id.sandboxResolvedPath) errors.push("exe-identity: sandbox executable could not be resolved");
  if (typeof id.sandboxContentHash !== "string" || !id.sandboxContentHash) errors.push("exe-identity: sandbox executable hash could not be measured");
  if (typeof id.sandboxReportedVersion !== "string" || !id.sandboxReportedVersion) errors.push("exe-identity: sandbox executable version could not be measured");
  // bind the SANDBOX facts to the detection record's executable hash + the required version + provider + prep op.
  // A MISSING ctx field is a hard failure (never a silently-skipped binding) — this function is exported and
  // must fail closed on its own, not rely on an earlier caller having re-bound the same value.
  for (const k of ["expectedContentHash", "cliVersion", "providerId", "preparedOperationId"]) if (c[k] === undefined || c[k] === null) errors.push("exe-identity: incomplete context (missing " + k + ")");
  if (c.expectedContentHash != null && id.sandboxContentHash && id.sandboxContentHash !== c.expectedContentHash) errors.push("exe-identity: sandbox executable hash does not match the detection record");
  if (c.cliVersion != null && id.sandboxReportedVersion && !verMatch(id.sandboxReportedVersion, c.cliVersion)) errors.push("exe-identity: sandbox executable version mismatch");
  if (c.providerId != null && id.providerId !== c.providerId) errors.push("exe-identity: providerId does not match the current operation");
  if (c.preparedOperationId != null && id.preparedOperationId !== c.preparedOperationId) errors.push("exe-identity: preparedOperationId does not match the current operation");
  // integrity
  if (typeof id.identityEvidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(id.identityEvidenceHash)) errors.push("exe-identity: identityEvidenceHash missing/invalid");
  else if (hashExeIdentity(id) !== id.identityEvidenceHash) errors.push("exe-identity: identityEvidenceHash mismatch (modified)");
  return { ok: errors.length === 0, errors };
}

/**
 * Process-control readiness probe (§7): exercise the provider's operation lifecycle with a harmless synthetic
 * contained process — create → verify handle → enumerate → terminate → confirm → no residue → unrelated
 * untouched. Returns { ok, reason, evidence }. No real Claude process needed.
 */
function probeProcessControl(provider, opts) {
  const o = opts || {};
  let sentinel = null, handle = null, handleDisposed = false;
  const result = { ok: false, reason: "unknown" };
  try {
    if (!provider || OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) { result.reason = "no-operation-lifecycle"; return result; }
    // §10: a contained operation AND an unrelated sentinel the probe owner controls separately.
    sentinel = typeof o.sentinelFn === "function" ? o.sentinelFn() : { pid: 2147480001, alive: () => true, kill: () => {} };
    handle = provider.spawnOperation({ probe: true, operationId: "probe-op", bin: "<probe>", argv: [], cwd: "<probe>", env: {} });
    if (!handle || !handle.handleType || !handle.operationId) { result.reason = "no-operation-handle"; return result; }
    const status = provider.operationStatus(handle);
    if (!status || (status.state !== "running" && status.state !== "exited")) { result.reason = "operation-status-malformed"; return result; }
    const before = provider.enumerateOperationProcesses(handle);
    if (!Array.isArray(before)) { result.reason = "enumeration-malformed"; return result; }
    // operation enumeration must NOT contain the unrelated sentinel
    if (before.indexOf(sentinel.pid) >= 0) { result.reason = "operation-enumeration-includes-unrelated-process"; return result; }
    provider.terminateOperation(handle);
    const conf = provider.confirmOperationTerminated(handle);
    if (!conf || conf.confirmed !== true) { result.reason = "termination-unconfirmed"; return result; }
    const after = provider.enumerateOperationProcesses(handle);
    if (!Array.isArray(after)) { result.reason = "enumeration-malformed-after-confirm"; return result; }
    if (after.length) { result.reason = "residual-processes-after-confirm"; return result; }
    // the unrelated sentinel must be UNAFFECTED by the operation termination
    if (!sentinel.alive()) { result.reason = "unrelated-sentinel-killed-by-operation-termination"; return result; }
    const disp = provider.disposeOperation(handle); handleDisposed = true;
    if (!disp || !Array.isArray(disp.residue)) { result.reason = "dispose-result-malformed"; return result; }
    if (disp.residue.length) { result.reason = "residue-after-dispose"; return result; }
    Object.assign(result, { ok: true, reason: "lifecycle-and-scope-demonstrated", evidence: { enumeratedBefore: before.length, processCountAtConfirm: conf.processCount, sentinelSurvived: true } });
    return result;
  } catch (e) { result.ok = false; result.reason = "probe-crashed"; result.detail = String(e && e.message).slice(0, 120); return result; }
  finally {
    // §13: ALWAYS tear down the probe operation + the unrelated sentinel — on EVERY path (success, early
    // failure, or crash). `sentinelCleaned` reflects the ACTUAL kill outcome, never a hardcoded assumption.
    if (handle && !handleDisposed) { try { provider.terminateOperation(handle); } catch (e) {} try { provider.disposeOperation(handle); } catch (e) {} }
    if (sentinel) { try { sentinel.kill(); result.sentinelCleaned = true; } catch (e) { result.sentinelCleaned = false; } } else result.sentinelCleaned = true;
  }
}

/**
 * MOCK provider — SYNTHETIC proofs only (`kind:"mock"`, refused for real runs). Implements the full operation
 * lifecycle over an in-process handle and generates a well-formed operation-bound attestation. `spawnFn` is
 * the synthetic worker stand-in. `pidFallback:true` labels a provider whose handle degrades to a PID (only
 * permitted for labelled synthetic tests, never real runs).
 */
function mockProvider(spawnFn, overrides) {
  const base = {
    name: "mock-sandbox", kind: "mock", providerId: "mock-provider", providerVersion: "mock-0", providerImplementationHash: "mock-impl-hash", operationHandleType: "mock-in-process",
    // Sandbox executable identity defaults (a REAL provider measures these INSIDE the sandbox). Chosen to match
    // the synthetic detection record's bound executableContentHash + cliVersion so the identity check passes.
    _sandboxExePath: "/sandbox/bin/claude", _sandboxExeHash: "exe-hash-1", _sandboxExeVersion: "1.9.0",
    attest: (ctx) => attestation.syntheticAttestation(Object.assign({ providerId: "mock-provider" }, ctx || {}), Object.assign({ providerImplementationHash: "mock-impl-hash", providerVersion: "mock-0" }, (overrides && overrides._attestOpts) || {})),
    // §4: MOUNT the exact workspace and return a prepared-operation descriptor bound to this operation. A real
    // provider actually mounts; the mock asserts the fail-closed mount policy and hashes its own descriptor.
    prepareOperation: function (req) {
      const r = req || {}; const now = Date.now(); const mp = r.mountPolicy || MOUNT_POLICY_FIRST_PROOF;
      const desc = {
        preparedOperationId: "prep-" + (r.operationId || "op") + "-" + (this.providerId || "mock"),
        providerId: this.providerId, providerVersion: this.providerVersion, providerImplementationHash: this.providerImplementationHash,
        operationId: r.operationId == null ? null : r.operationId, workspaceId: r.workspaceId == null ? null : r.workspaceId,
        hostWorkspacePathHash: r.hostWorkspacePathHash == null ? null : r.hostWorkspacePathHash,
        sandboxWorkspacePath: "/sandbox/workspace/" + (r.workspaceId || "ws"),
        materialisationManifestHash: r.materialisationManifestHash == null ? null : r.materialisationManifestHash,
        preExecutionLedgerHash: r.preExecutionLedgerHash == null ? null : r.preExecutionLedgerHash,
        mountPolicyHash: mountPolicyHash(mp),
        canonicalMounted: false, otherProjectsMounted: false, homeMounted: false, credentialsMounted: false,
        networkPolicy: r.networkPolicy || this.networkPolicy || "disabled",
        preparationTimestamp: now, preparationExpiry: now + 300000,
      };
      desc.preparationEvidenceHash = hashPrepared(desc);
      return desc;
    },
    // §5: resolve / hash / version the executable INSIDE the sandbox (never the host path).
    resolveExecutable: function (prep, requested) { return this._sandboxExePath; },
    hashExecutable: function (prep, sandboxPath) { return this._sandboxExeHash; },
    getExecutableVersion: function (prep, sandboxPath) { return this._sandboxExeVersion; },
    // The mock MAY use a Node ChildProcess internally, but the adapter communicates ONLY through these
    // provider methods — never handle.child / child.stdout / child.on("close").
    spawnOperation: function (req) {
      const child = spawnFn ? spawnFn(req.bin, req.argv, { cwd: req.cwd, shell: false, env: req.env }) : null;
      const handle = { handleType: this.pidFallback ? "pid" : "mock-in-process", operationId: req.operationId || "op", handleId: "H-" + (req.operationId || "op"), _child: child, _out: "", _err: "", _exit: null, _alive: true, _pids: new Set(child && child.pid ? [child.pid] : []), _disposed: false };
      if (child) {
        child.stdout && child.stdout.on("data", (d) => { handle._out += d.toString(); });
        child.stderr && child.stderr.on("data", (d) => { handle._err += d.toString(); });
        child.on && child.on("close", (code) => { handle._exit = code == null ? 0 : code; handle._alive = false; handle._pids = new Set(); });
        child.on && child.on("error", () => { handle._exit = handle._exit == null ? "error" : handle._exit; handle._alive = false; });
      }
      return handle;
    },
    readOperationOutput: (h, maxBytes) => { const s = (h && h._out) || ""; return maxBytes ? s.slice(0, maxBytes) : s; },
    readOperationError: (h, maxBytes) => { const s = (h && h._err) || ""; return maxBytes ? s.slice(0, maxBytes) : s; },
    // Bounded wait: resolves on exit, timeout, or output/stderr overflow — terminating the operation on any of
    // the latter. Returns { exitStatus, killedFor }. Never depends on the caller wiring the child.
    // §11: supports an AbortSignal cancellation token. When the host cancels (its timeout won the race) the wait
    // resolves promptly and tears down its own timer/interval + abort listener — no unresolved promise, no leak.
    waitForOperationExit: function (h, opts) {
      const o = opts || {}; const self = this; const signal = o.signal;
      return new Promise((resolve) => {
        let done = false, timer = null, iv = null, onAbort = null;
        const finish = (p) => { if (done) return; done = true; if (iv) clearInterval(iv); if (timer) clearTimeout(timer); if (signal && onAbort) { try { signal.removeEventListener("abort", onAbort); } catch (e) {} } resolve(p); };
        if (!h || !h._child) return finish({ exitStatus: null, killedFor: "spawn-error" });
        onAbort = () => finish({ exitStatus: null, killedFor: "host-cancelled" });
        if (signal) { if (signal.aborted) return finish({ exitStatus: null, killedFor: "host-cancelled" }); try { signal.addEventListener("abort", onAbort, { once: true }); } catch (e) {} }
        timer = setTimeout(() => { self.terminateOperation(h); finish({ exitStatus: null, killedFor: "timeout" }); }, o.timeoutMs || 120000);
        iv = setInterval(() => {
          if (o.maxOutputBytes && Buffer.byteLength(h._out, "utf8") > o.maxOutputBytes) { self.terminateOperation(h); return finish({ exitStatus: null, killedFor: "output-overflow" }); }
          if (o.maxOutputBytes && Buffer.byteLength(h._err, "utf8") > o.maxOutputBytes) { self.terminateOperation(h); return finish({ exitStatus: null, killedFor: "stderr-overflow" }); }
          if (!h._alive) finish(h._exit === "error" ? { exitStatus: null, killedFor: "worker-error" } : { exitStatus: h._exit, killedFor: null });
        }, 5);
      });
    },
    operationStatus: (h) => ({ state: h && h._alive ? "running" : "exited", exitStatus: h ? h._exit : null }),
    enumerateOperationProcesses: (h) => (h && h._pids ? Array.from(h._pids) : []),
    // A real provider MUST perform the actual OS kill of the whole operation; the mock kills its child too.
    terminateOperation: (h) => { if (h) { try { h._child && h._child.kill && h._child.kill(); } catch (e) {} h._alive = false; h._pids = new Set(); } },
    confirmOperationTerminated: (h) => ({ confirmed: !!h && h._alive === false && h._pids.size === 0, processCount: h ? h._pids.size : 0, evidence: "mock-handle" }),
    preserveOperationEvidence: (h) => ({ preserved: true, location: "in-memory:" + (h && h.handleId) }),
    disposeOperation: (h) => { if (h) h._disposed = true; return { disposed: true, residue: [] }; },
    readablePaths: ["<workspace>"], writablePaths: ["<workspace>"], mountedWorkspace: "<workspace>",
    canonicalVisibility: "not-mounted", otherProjectVisibility: "not-mounted", homeVisibility: "not-mounted", credentialVisibility: "not-mounted",
    networkPolicy: "disabled", networkAllowlist: [], permittedExecutables: ["<claude>"],
    processLimits: { cpuSeconds: 120, memoryMb: 2048, maxChildren: 32 }, childProcessPolicy: "contained",
    cleanupPolicy: "destroy-on-exit", emergencyTermination: "kill-operation", pidFallback: false,
  };
  return Object.assign(base, overrides || {});
}

module.exports = {
  resolveSandbox, validateProvider, policySummary, probeProcessControl, mockProvider, isReallyIsolated,
  verifyPreparedOperation, verifyExecutableIdentity, buildExecutableIdentity, mountPolicyHash, hashPrepared,
  REQUIRED_FIELDS, OPERATION_METHODS, PREPARE_METHODS, PREP_REQUIRED, PREP_CTX, EXEID_REQUIRED,
  MOUNT_POLICY_FIRST_PROOF,
};

```

## projectos/bridge/worker-policy.cjs

```javascript
"use strict";
/**
 * Worker trusted-policy binding, environment isolation, secret scanning, and the structured worker result
 * contract — the containment layer for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A (pure, I/O-free).
 *
 * The worker REQUEST carries only task CONTENT (prompt, project key, task id). Every SECURITY CONTROL —
 * repo root, expected remote/branch, clean-tree requirement, allowed/forbidden paths, permitted tools and
 * commands, timeout, output limits, environment allowlist, mode, and the operation/phase/approval ids —
 * comes ONLY from trusted ProjectOS configuration. A request that tries to define/widen any control is
 * refused, never merged.
 *
 * IMPORTANT (honesty): this layer + the orchestrator provide GIT- and FILESYSTEM-level containment plus a
 * minimal environment. They do NOT OS-sandbox a shell-capable worker. A worker granted shell/file tools can
 * read/write anything the owner account can. Real isolation of a fully-untrusted worker requires OS-level
 * enforcement (a container/VM or a restricted account) on the OWNER machine — see the adapter header.
 */

const crypto = require("crypto");
const OBSERVATION_STATUSES = ["OBSERVED", "PARTIALLY OBSERVED", "NOT OBSERVABLE", "NOT EXECUTED"];
const TERMINATION_STATUSES = ["NOT APPLICABLE", "NOT EXECUTED", "TERMINATED-CONFIRMED", "TERMINATION-UNCONFIRMED", "EMERGENCY-STOP-REQUIRED"];
const TOOL_VERIFIED_STATUSES = ["NOT VERIFIED", "VERIFIED BUT NOT APPLIED", "APPLIED AND VERIFIED"];

// --- Environment isolation ---------------------------------------------------------------------------
const ENV_ALLOW_COMMON = ["PATH", "Path"];
const ENV_ALLOW_WIN = ["SystemRoot", "windir", "ComSpec", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA"];
const ENV_ALLOW_POSIX = ["HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "SHELL"];

// A credential-bearing variable NAME is never forwarded, even if allowlisted.
const TOKENISH_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|SERVICE_ROLE|DATABASE_URL|DSN|SESSION|COOKIE|AUTH|BEARER|PRIVATE|ANTHROPIC|OPENAI|SUPABASE|VERCEL|GITHUB|STRIPE|RESEND|TWILIO|AWS_)/i;

// Control fields a REQUEST must never carry — they belong to trusted policy only.
const CONTROL_FIELDS = [
  "repoRoot", "expectedRemote", "expectedBranch", "requireClean", "allowedPaths", "forbiddenPaths",
  "tools", "commands", "timeoutMs", "maxOutputBytes", "maxPromptChars", "envAllowlist", "mode",
  "phaseId", "approvalId", "operationId",
];

// ONE shared secret-shape source (used for prompt rejection AND output scrubbing). Consolidated so the two
// call sites cannot drift.
const SECRET_SHAPE = new RegExp(
  [
    "-----BEGIN[\\s\\S]{0,64}?PRIVATE KEY-----",
    "sk-[A-Za-z0-9]{16,}",
    "eyJ[A-Za-z0-9_-]{20,}", // base64url JWT/JWS header blob (matches header-only or full token)
    "sb_secret_[A-Za-z0-9]{6,}",
    "service_role[\"'\\s:=]{0,4}eyJ",
    "AKIA[0-9A-Z]{12,}",
    "ghp_[A-Za-z0-9]{20,}",
    "xox[baprs]-[A-Za-z0-9-]{10,}",
    "AIza[0-9A-Za-z_-]{20,}",
  ].join("|"),
);
function secretShapeGlobal() { return new RegExp(SECRET_SHAPE.source, "g"); }

// Worker decisions that are NEVER authoritative gate outcomes.
const FORBIDDEN_WORKER_DECISIONS = ["APPROVED", "APPROVED_TO_PUSH", "CLOSED", "PLAN_READY", "PLAN READY"];
// Fields a worker result must never assert.
const FORBIDDEN_RESULT_FIELDS = ["authoritative", "planReady", "grantPlanReady", "ownerApproved", "trusted", "approved", "closed"];

// Executable shims that re-enter a shell on Windows (spawn routes .cmd/.bat/.ps1 through cmd.exe even with
// shell:false → argv re-parsing). The trusted CLI path must be a real executable, not a shim.
const UNSAFE_SHIM = /\.(cmd|bat|ps1)$/i;

const caseFold = () => (process.platform === "win32" || process.platform === "darwin");

/** Build the minimal child environment from the allowlist. Never spreads process.env. */
function buildMinimalEnv(platform, extraAllow) {
  const src = process.env;
  const allow = ENV_ALLOW_COMMON
    .concat(platform === "win32" ? ENV_ALLOW_WIN : ENV_ALLOW_POSIX)
    .concat(Array.isArray(extraAllow) ? extraAllow : []);
  const out = Object.create(null);
  for (const k of allow) {
    if (typeof src[k] !== "string") continue;
    if (TOKENISH_NAME.test(k)) continue;
    out[k] = src[k];
  }
  return out;
}

function isTokenishName(name) { return TOKENISH_NAME.test(String(name)); }
function promptHasRawSecret(text) { return SECRET_SHAPE.test(String(text || "")); }
function scrubSecrets(text) { return String(text == null ? "" : text).replace(secretShapeGlobal(), "«redacted»"); }
function isUnsafeShim(bin) { return UNSAFE_SHIM.test(String(bin || "")); }

/** Resolve the effective, trusted policy for a run. Returns { policy, violations }. */
function resolvePolicy(req, config) {
  const r = req || {};
  const c = config || {};
  const violations = CONTROL_FIELDS.filter((k) => Object.prototype.hasOwnProperty.call(r, k));

  const roots = c.projectRoots || {};
  const projectId = typeof r.projectId === "string" ? r.projectId : "";
  const repoRoot = Object.prototype.hasOwnProperty.call(roots, projectId) ? roots[projectId] : null;

  const p = c.policy || {};
  const op = c.operation || {};
  const policy = {
    repoRoot: repoRoot,
    expectedRemote: typeof p.expectedRemote === "string" ? p.expectedRemote : null,
    expectedBranch: typeof p.expectedBranch === "string" ? p.expectedBranch : null,
    requireClean: p.requireClean !== false,
    allowedPaths: Array.isArray(p.allowedPaths) ? p.allowedPaths.slice() : [],
    forbiddenPaths: Array.isArray(p.forbiddenPaths) ? p.forbiddenPaths.slice() : [],
    tools: Array.isArray(p.tools) ? p.tools.slice() : [],
    commands: Array.isArray(p.commands) ? p.commands.slice() : [],
    timeoutMs: Number.isFinite(p.timeoutMs) ? p.timeoutMs : 120000,
    maxOutputBytes: Number.isFinite(p.maxOutputBytes) ? p.maxOutputBytes : 2 * 1024 * 1024,
    maxPromptChars: Number.isFinite(p.maxPromptChars) ? p.maxPromptChars : 8000,
    envAllowlist: Array.isArray(p.envAllowlist) ? p.envAllowlist.slice() : [],
    monitorIgnoredContent: p.monitorIgnoredContent === true,
    mode: typeof p.mode === "string" ? p.mode : "propose",
    phaseId: typeof op.phaseId === "string" ? op.phaseId : null,
    approvalId: typeof op.approvalId === "string" ? op.approvalId : null,
    operationId: typeof op.operationId === "string" ? op.operationId : null,
  };
  return { policy, violations };
}

/** Normalise a repo-relative path for comparison (slash + optional case fold). */
function normPath(p) {
  const s = String(p).replace(/\\/g, "/");
  return caseFold() ? s.toLowerCase() : s;
}

/**
 * A change path is allowed only when relative, escape-free (no `..`, absolute, drive, UNC, NUL), matches
 * the allowlist, is not forbidden, is not ProjectOS source, and is not git metadata. Case-insensitive on
 * Windows/macOS so a re-cased new directory cannot slip a forbidden prefix.
 */
function isAllowedPath(p, policy) {
  if (typeof p !== "string" || !p) return false;
  if (p.includes("\0") || p.includes("..")) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:/.test(p) || /^\\\\/.test(p)) return false; // abs/UNC
  const norm = normPath(p);
  if (norm === ".git" || norm.startsWith(".git/")) return false;
  if (norm === "projectos" || norm.startsWith("projectos/")) return false;
  const pref = (list) => (list || []).some((a) => {
    const an = normPath(a);
    return norm === an || norm.startsWith(an.endsWith("/") ? an : an + "/");
  });
  return pref(policy.allowedPaths) && !pref(policy.forbiddenPaths);
}

/** Reject an allowlist that itself reaches ProjectOS source / the whole repo. */
function allowlistTouchesProjectos(policy) {
  return (policy.allowedPaths || []).some((a) => {
    const an = normPath(a);
    return an === "projectos" || an.startsWith("projectos/") || an === "." || an === "" || an === "/";
  });
}

/**
 * Build a frozen, schema-shaped worker result. THROWS on a forbidden gate decision or forbidden field —
 * a forbidden authority claim must be a hard error, never silently coerced.
 */
function buildResult(fields) {
  const f = fields || {};
  const decision = String(f.workerDecision || "PROPOSED").toUpperCase();
  if (FORBIDDEN_WORKER_DECISIONS.includes(decision)) throw new Error("buildResult: forbidden workerDecision '" + decision + "'");
  for (const k of FORBIDDEN_RESULT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(f, k)) throw new Error("buildResult: forbidden field '" + k + "'");
  }
  const arr = (v) => (Array.isArray(v) ? v : []);
  const controls = f.controls || {};
  const body = {
    schemaVersion: "2.0",
    operationId: f.operationId || null,
    projectId: f.projectId || null,
    phaseId: f.phaseId || null,
    approvalStatus: f.approvalStatus || "none",
    repository: { toplevel: f.toplevel || null, origin: f.origin || null },
    baselineBranch: f.baselineBranch || null,
    baselineHead: f.baselineHead || null,
    finalBranch: f.finalBranch || null,
    finalHead: f.finalHead || null,
    outcome: f.outcome || "unknown",
    reason: f.reason || null,
    // OS-containment evidence (honest names)
    sandboxProvider: f.sandboxProvider || null,
    sandboxPolicy: f.sandboxPolicy || null,
    canonicalVisibility: f.canonicalVisibility || "unknown",
    networkPolicy: f.networkPolicy || "unknown",
    processTerminationStatus: f.processTerminationStatus || "NOT APPLICABLE",
    operationHandleType: f.operationHandleType || null,
    operationHandleIdRedacted: f.operationHandleIdRedacted || null,
    operationProcessCountObserved: f.operationProcessCountObserved === undefined ? null : f.operationProcessCountObserved,
    processControlProvider: f.processControlProvider || null,
    processControlEvidenceHash: f.processControlEvidenceHash || null,
    terminationDetail: f.terminationDetail || null,
    // trusted filesystem ledger (NOT git-derived)
    residualDriftStatus: f.residualDriftStatus || "unknown", // "no-residual-drift-detected" | "residual-drift-detected" | "not-evaluated"
    filesChanged: arr(f.filesChanged),
    refusedPaths: arr(f.refusedPaths),
    filesInspectionStatus: f.filesInspectionStatus || "NOT OBSERVABLE",
    changeManifest: arr(f.changeManifest),
    ledgerSummary: f.ledgerSummary || null,
    materialiseWarnings: arr(f.materialiseWarnings),
    patchHash: f.patchHash || null,
    // command / tool observation (honest)
    projectOsCommandsExecuted: arr(f.projectOsCommandsExecuted),
    workerCommandsObserved: arr(f.workerCommandsObserved),
    workerCommandsObservationStatus: f.workerCommandsObservationStatus || "NOT OBSERVABLE",
    workerToolsPermitted: arr(f.workerToolsPermitted),
    workerToolsVerified: TOOL_VERIFIED_STATUSES.indexOf(f.workerToolsVerified) >= 0 ? f.workerToolsVerified : "NOT VERIFIED",
    // HARDEN1D exact-invocation + workspace + operation evidence
    workspaceId: f.workspaceId || null,
    materialisationManifestHash: f.materialisationManifestHash || null,
    preExecutionLedgerHash: f.preExecutionLedgerHash || null,
    // HARDEN1E provider preparation + ACTUAL sandbox executable identity + mount policy
    preparedOperationId: f.preparedOperationId || null,
    preparedOperationVerified: f.preparedOperationVerified === undefined ? null : !!f.preparedOperationVerified,
    mountPolicyHash: f.mountPolicyHash || null,
    sandboxWorkspacePath: f.sandboxWorkspacePath || null,
    sandboxExecutablePath: f.sandboxExecutablePath || null,
    sandboxExecutableHash: f.sandboxExecutableHash || null,
    sandboxExecutableVersion: f.sandboxExecutableVersion || null,
    sandboxExecutableIdentityHash: f.sandboxExecutableIdentityHash || null,
    invocationGrammarStatus: f.invocationGrammarStatus || "NOT VERIFIED",
    invocationArgvHash: f.invocationArgvHash || null,
    invocationRestrictionStatus: f.invocationRestrictionStatus || "NOT VERIFIED",
    providerCapabilityAttestationHash: f.providerCapabilityAttestationHash || null,
    operationEvidenceHash: f.operationEvidenceHash || null,
    operationDisposalStatus: f.operationDisposalStatus || "not-disposed",
    operationResidue: arr(f.operationResidue),
    actualOperationHandleType: f.operationHandleType || null,
    runtimeReadinessEvidenceHash: f.runtimeReadinessEvidenceHash || null,
    // controls, split by real enforcement status
    controls: {
      technicallyEnforced: arr(controls.technicallyEnforced),
      policyRequested: arr(controls.policyRequested),
      delegated: arr(controls.delegated),
      notVerified: arr(controls.notVerified),
      outOfScope: arr(controls.outOfScope),
    },
    timeoutStatus: f.timeoutStatus || "none",
    cancellationStatus: f.cancellationStatus || "none",
    killConfirmed: f.killConfirmed === undefined ? null : !!f.killConfirmed,
    outputRedactionStatus: f.outputRedactionStatus || "applied",
    envRedactionStatus: f.envRedactionStatus || "minimal-allowlist",
    outputExcerpt: typeof f.outputExcerpt === "string" ? f.outputExcerpt : "",
    residue: arr(f.residue),
    risks: arr(f.risks),
    workerDecision: decision,
    projectOsDecisionRequired: true,
  };
  const resultHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return deepFreeze(Object.assign(body, { resultHash }));
}

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

/** Validate a result against the v2 contract. `opts.real` requires non-null operation identity. */
function validateResult(result, opts) {
  const o = opts || {};
  const errors = [];
  const r = result || {};
  const required = [
    "schemaVersion", "operationId", "projectId", "phaseId", "approvalStatus", "repository", "baselineBranch",
    "baselineHead", "finalBranch", "finalHead", "outcome", "reason", "sandboxProvider", "sandboxPolicy",
    "canonicalVisibility", "networkPolicy", "processTerminationStatus", "operationHandleType",
    "operationProcessCountObserved", "processControlProvider", "processControlEvidenceHash",
    "workspaceId", "invocationRestrictionStatus", "invocationArgvHash", "operationDisposalStatus", "operationResidue",
    "preparedOperationId", "mountPolicyHash", "sandboxExecutableIdentityHash", "invocationGrammarStatus",
    "actualOperationHandleType", "materialisationManifestHash", "residualDriftStatus", "filesChanged",
    "refusedPaths", "filesInspectionStatus", "changeManifest", "ledgerSummary", "patchHash", "projectOsCommandsExecuted",
    "workerCommandsObserved", "workerCommandsObservationStatus", "workerToolsPermitted", "workerToolsVerified",
    "controls", "timeoutStatus", "cancellationStatus", "killConfirmed", "outputRedactionStatus",
    "envRedactionStatus", "outputExcerpt", "residue", "risks", "workerDecision", "projectOsDecisionRequired",
    "resultHash",
  ];
  for (const k of required) if (!Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: missing field '" + k + "'");
  if (r.schemaVersion !== "2.0") errors.push("result: bad schemaVersion");
  if (FORBIDDEN_WORKER_DECISIONS.includes(String(r.workerDecision).toUpperCase())) errors.push("result: workerDecision is an authoritative gate outcome (forbidden)");
  for (const k of FORBIDDEN_RESULT_FIELDS) if (Object.prototype.hasOwnProperty.call(r, k)) errors.push("result: forbidden field '" + k + "'");
  if (r.projectOsDecisionRequired !== true) errors.push("result: projectOsDecisionRequired must be true");
  if (OBSERVATION_STATUSES.indexOf(r.workerCommandsObservationStatus) < 0) errors.push("result: bad workerCommandsObservationStatus");
  if (Object.prototype.hasOwnProperty.call(r, "processTerminationStatus") && TERMINATION_STATUSES.indexOf(r.processTerminationStatus) < 0) errors.push("result: bad processTerminationStatus enum");
  if (Object.prototype.hasOwnProperty.call(r, "workerToolsVerified") && TOOL_VERIFIED_STATUSES.indexOf(r.workerToolsVerified) < 0) errors.push("result: bad workerToolsVerified enum");
  // termination control must not be overstated: process-termination-confirm only when CONFIRMED.
  if (r.controls && (r.controls.technicallyEnforced || []).indexOf("process-termination-confirm") >= 0 && r.processTerminationStatus !== "TERMINATED-CONFIRMED") errors.push("result: process-termination-confirm claimed enforced without TERMINATED-CONFIRMED");
  // workerToolsVerified must not be APPLIED unless the invocation-restriction control is actually enforced.
  if (r.workerToolsVerified === "APPLIED AND VERIFIED" && r.controls && (r.controls.technicallyEnforced || []).indexOf("exact-invocation-restriction-applied") < 0) errors.push("result: workerToolsVerified APPLIED without the exact-invocation-restriction-applied control");
  // A COMPLETED run must have disposed the operation, carry the central HARDEN1D evidence hashes, and have the
  // exact invocation restriction APPLIED — contract-level backstop for the adapter's control-flow ordering.
  if (r.outcome === "COMPLETED") {
    if (r.operationDisposalStatus !== "disposed") errors.push("result: COMPLETED without operationDisposalStatus 'disposed'");
    if (!r.operationEvidenceHash) errors.push("result: COMPLETED without operationEvidenceHash");
    if (!r.providerCapabilityAttestationHash) errors.push("result: COMPLETED without providerCapabilityAttestationHash");
    if (r.invocationRestrictionStatus !== "APPLIED AND VERIFIED") errors.push("result: COMPLETED without an APPLIED AND VERIFIED invocation restriction");
    // HARDEN1E: a completed real-model run must have prepared+mounted the workspace and bound the SANDBOX exe.
    if (!r.preparedOperationId) errors.push("result: COMPLETED without a verified preparedOperationId");
    if (!r.mountPolicyHash) errors.push("result: COMPLETED without a mountPolicyHash");
    if (!r.sandboxExecutableIdentityHash) errors.push("result: COMPLETED without a sandboxExecutableIdentityHash");
    if (r.invocationGrammarStatus !== "PASS") errors.push("result: COMPLETED without an exact-invocation-grammar PASS");
  }
  // controls integrity: a delegated / notVerified / out-of-scope control must NOT be claimed technically enforced.
  const c = r.controls || {};
  const te = new Set((c.technicallyEnforced || []).map(String));
  for (const bucket of ["delegated", "notVerified", "outOfScope"]) {
    for (const x of (c[bucket] || [])) if (te.has(String(x))) errors.push("result: control '" + x + "' is in both technicallyEnforced and " + bucket);
  }
  // result-hash integrity — MUST be a well-formed sha256 hex and is ALWAYS compared (a blanked/absent hash
  // fails; it never skips). Integrity, not authenticity (not an HMAC — see report trust boundary).
  if (typeof r.resultHash !== "string" || !/^[0-9a-f]{64}$/.test(r.resultHash)) errors.push("result: resultHash missing/invalid");
  else { const copy = Object.assign({}, r); delete copy.resultHash; if (crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex") !== r.resultHash) errors.push("result: resultHash integrity check failed (mutated or serialisation drift)"); }
  // real operations require non-null identity
  if (o.real) {
    for (const k of ["operationId", "phaseId", "projectId", "baselineHead"]) if (!r[k]) errors.push("result: real operation requires non-null " + k);
  }
  return errors;
}

module.exports = {
  buildMinimalEnv, isTokenishName, promptHasRawSecret, scrubSecrets, isUnsafeShim, resolvePolicy,
  isAllowedPath, allowlistTouchesProjectos, buildResult, validateResult, deepFreeze, normPath,
  CONTROL_FIELDS, FORBIDDEN_WORKER_DECISIONS, FORBIDDEN_RESULT_FIELDS, SECRET_SHAPE, ENV_ALLOW_COMMON,
  OBSERVATION_STATUSES, TERMINATION_STATUSES, TOOL_VERIFIED_STATUSES,
};

```

## projectos/bridge/workspace-ledger.cjs

```javascript
"use strict";
/**
 * Trusted disposable-workspace materialisation + filesystem ledger — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-
 * HARDEN1B (§5). Replaces the worker-controlled git diff entirely.
 *
 *   CANONICAL VERIFIED REPO → TRUSTED SOURCE MATERIALISATION (`git ls-tree` + per-blob `git show`, no `.git`)
 *     → DISPOSABLE WORKSPACE WITH **NO .git**
 *     → TRUSTED FS SNAPSHOT (before) → WORKER → TRUSTED FS SNAPSHOT (after) → TRUSTED FS DIFF
 *
 * The authoritative change manifest is derived ONLY from ProjectOS's own filesystem walk (lstat + content
 * hashing) — NEVER from `git status`/`git diff`/the git index/worker evidence/a worker-controlled `.git`.
 * Because the workspace is exported from a verified baseline and contains no `.git`, the worker has no git
 * state to manipulate; if it creates one, `.git` simply appears in the ledger as an added forbidden path.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const GIT_MAXBUF = 64 * 1024 * 1024;
function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

/**
 * Materialise the tracked tree at `baseHead` from the canonical repo into a fresh temp workspace with NO
 * `.git`. Dependency-free + cross-platform: enumerates the tree with `git ls-tree` and writes each blob via
 * `git show` (binary-safe), preserving symlinks (mode 120000) and the executable bit (mode 100755). No `tar`,
 * no shell, no Windows path pitfalls. ProjectOS-side, before the worker runs. Throws on failure (→ BLOCKED).
 * @returns { workspace, tarPath, files:[relpaths] }   (tarPath kept for API compatibility; unused)
 *
 * `opts.symlinkSync` is a DEPENDENCY-INJECTED symlink primitive (default `fs.symlinkSync`). A test can supply
 * one that throws to force the symlink-fallback branch DETERMINISTICALLY — proving the real-run equivalence
 * guard (§16) without depending on the host's symlink capability, so this security branch is NEVER env-skipped.
 */
function materialize(repoRoot, baseHead, opts) {
  const o = opts || {};
  const symlinkSync = typeof o.symlinkSync === "function" ? o.symlinkSync : fs.symlinkSync;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pos-ws-"));
  const files = [];
  const symlinkFallbacks = []; // symlinks we could NOT create as links (e.g. Windows without privilege) — flagged, never silent
  try {
    const raw = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "-z", baseHead], { encoding: "utf8", maxBuffer: GIT_MAXBUF });
    for (const rec of raw.split("\0").filter(Boolean)) {
      // "<mode> <type> <sha>\t<path>"
      const tab = rec.indexOf("\t");
      const meta = rec.slice(0, tab).split(/\s+/);
      const mode = meta[0];
      const rel = rec.slice(tab + 1);
      const dest = path.join(workspace, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const content = execFileSync("git", ["-C", repoRoot, "show", baseHead + ":" + rel], { maxBuffer: GIT_MAXBUF }); // Buffer
      if (mode === "120000") { // symlink: blob content is the target
        // For a REAL run, do NOT write a regular-file substitute at all — record the fallback intent and let the
        // post-loop equivalence guard fail closed. Only synthetic (non-real) runs may materialise the substitute.
        try { symlinkSync(content.toString("utf8"), dest); }
        catch (e) {
          symlinkFallbacks.push(rel); // recorded, not swallowed
          if (!o.realRun) fs.writeFileSync(dest, content); // synthetic mode only: keep a substitute for local proofs
        }
      } else {
        fs.writeFileSync(dest, content);
        if (mode === "100755" && process.platform !== "win32") { try { fs.chmodSync(dest, 0o755); } catch (e) { /* best effort */ } }
      }
      files.push(rel);
    }
  } catch (e) {
    // Never leak a half-materialised workspace: clean up our own temp dir, then rethrow (caller → BLOCKED).
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (er) { /* best effort */ }
    throw e;
  }
  // For a REAL run a symlink that could not be created as a link (would be a regular-file substitute) makes the
  // workspace NOT type-equivalent to the approved baseline — fail closed (§11/§16). The substitute was never
  // written for a real run, so removing the partial workspace leaves nothing executable behind.
  if (o.realRun && symlinkFallbacks.length) {
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (er) { /* best effort */ }
    const err = new Error("WORKSPACE-MATERIALISATION-NOT-EQUIVALENT"); err.symlinkFallbacks = symlinkFallbacks; throw err;
  }
  const sorted = files.sort();
  // Unique workspace identity, SEPARATE from the operation id (§5). Not from Date/Math (deterministic across
  // resume): derived from the host path + a per-materialisation nonce.
  const nonce = crypto.randomBytes(12).toString("hex");
  const workspaceId = "ws-" + crypto.createHash("sha256").update(workspace + "|" + baseHead + "|" + nonce).digest("hex").slice(0, 24);
  const hostWorkspacePathHash = crypto.createHash("sha256").update(workspace).digest("hex");
  const manifest = {}; for (const rel of sorted) { try { manifest[rel] = sha256File(path.join(workspace, rel)); } catch (e) { manifest[rel] = "MISSING"; } }
  const materialisationManifestHash = crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  return { workspace, workspaceId, hostWorkspacePathHash, materialisationManifestHash, tarPath: path.join(workspace, ".pos-nonexistent"), files: sorted, symlinkFallbacks, empty: sorted.length === 0 };
}

/**
 * Trusted filesystem snapshot of `root`: a Map(relPath -> entry). Uses lstat (never follows symlinks), hashes
 * file content, records symlink targets + real-path escapes, includes HIDDEN and ignore-style files (there is
 * no ignore semantics here — every entry is recorded). Never throws for a single bad entry: it records an
 * `unreadable` marker so tampering can never hide behind a read error.
 */
function snapshot(root) {
  const map = Object.create(null);
  const rootReal = safeReal(root) || path.resolve(root);
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { map[rel(root, dir)] = { type: "dir", unreadable: true }; return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      const r = rel(root, full);
      let st;
      try { st = fs.lstatSync(full); }
      catch (er) { map[r] = { type: "unknown", unreadable: true }; continue; }
      const hidden = e.name.startsWith(".");
      if (st.isSymbolicLink()) {
        let target = null, escapes = false;
        try { target = fs.readlinkSync(full); } catch (er) { /* dangling name still recorded */ }
        const real = safeReal(full);
        escapes = !real || !insideRoot(real, rootReal);
        map[r] = { type: "symlink", size: st.size, linkTarget: target, escapes, hidden };
      } else if (st.isDirectory()) {
        map[r] = { type: "dir", hidden };
        walk(full);
      } else if (st.isFile()) {
        let hash = null, unreadable = false;
        try { hash = sha256File(full); } catch (er) { unreadable = true; }
        map[r] = { type: "file", size: st.size, mode: st.mode & 0o777, hash, unreadable, hidden };
      } else {
        map[r] = { type: "special", hidden }; // fifo/socket/device — recorded, never silently skipped
      }
    }
  };
  walk(root);
  return map;
}

function rel(root, full) { return path.relative(root, full).split(path.sep).join("/"); }
function safeReal(p) { try { return fs.realpathSync(p); } catch (e) { return null; } }
function insideRoot(p, rootReal) {
  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return p === rootReal || p.startsWith(withSep);
}

/**
 * Trusted diff between two snapshots. Returns a structured ledger with every change class the phase requires,
 * plus the flat `changedPaths` (added ∪ modified ∪ deleted ∪ type-changed ∪ rename endpoints) for policy
 * enforcement. Rename is a best-effort heuristic (a deleted file + an added file with identical content hash).
 */
function diff(before, after) {
  const added = [], deleted = [], modified = [], typeChanged = [], sameSizeContentChange = [], symlinkChanged = [],
    permissionChanged = [], escapes = [], unreadable = [], hidden = [], special = [];
  const bKeys = Object.keys(before), aKeys = Object.keys(after);
  for (const k of aKeys) {
    const a = after[k]; const b = before[k];
    if (a.escapes) escapes.push(k);
    if (a.unreadable) unreadable.push(k);
    if (a.hidden) hidden.push(k);
    if (a.type === "special") special.push(k);
    if (!b) { added.push(k); continue; }
    if (a.type !== b.type) { typeChanged.push(k); modified.push(k); continue; }
    if (a.type === "file") {
      if (a.hash !== b.hash || a.unreadable || b.unreadable) {
        modified.push(k);
        if (a.size === b.size) sameSizeContentChange.push(k); // content change without size change
      }
      if (a.mode !== b.mode) { permissionChanged.push(k); if (modified.indexOf(k) < 0) modified.push(k); } // mode-only change
    } else if (a.type === "symlink") {
      if (a.linkTarget !== b.linkTarget) { symlinkChanged.push(k); modified.push(k); }
    } else if (a.type === "special") {
      modified.push(k); // a socket/fifo/device cannot be hashed — any presence is treated as changed
    }
  }
  for (const k of bKeys) if (!after[k]) deleted.push(k);
  // rename heuristic: deleted file whose content-hash reappears as an added file
  const renamed = [];
  const addedFileHash = {};
  for (const k of added) if (after[k].type === "file" && after[k].hash) addedFileHash[after[k].hash] = k;
  for (const k of deleted) {
    const b = before[k];
    if (b && b.type === "file" && b.hash && addedFileHash[b.hash]) renamed.push({ from: k, to: addedFileHash[b.hash] });
  }
  // Unreadable entries + escapes are folded into changedPaths so policy enforcement can never pass over them.
  const changedPaths = uniq([].concat(added, modified, deleted, unreadable, escapes, special));
  return {
    added, deleted, modified, typeChanged, sameSizeContentChange, symlinkChanged, permissionChanged, renamed,
    escapes, unreadable, hidden, special, changedPaths,
  };
}

function uniq(a) { return Array.from(new Set(a)); }

/** Manifest (path -> content sha256 / status) derived from the trusted after-snapshot + diff. */
function manifest(after, ledger) {
  const out = [];
  for (const p of ledger.changedPaths) {
    const e = after[p];
    if (!e) { out.push({ path: p, status: "deleted" }); continue; }
    if (e.type === "file") out.push({ path: p, status: "file", sha256: e.hash || "UNREADABLE", size: e.size });
    else if (e.type === "symlink") out.push({ path: p, status: "symlink", target: e.linkTarget, escapes: !!e.escapes });
    else out.push({ path: p, status: e.type });
  }
  return out;
}

function dispose(dir) {
  const residue = [];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* checked */ }
  try { if (fs.existsSync(dir)) residue.push(dir); } catch (e) { residue.push(dir); }
  return residue;
}

function hashSnapshot(snap) { return crypto.createHash("sha256").update(JSON.stringify(snap || {})).digest("hex"); }

module.exports = { materialize, snapshot, diff, manifest, dispose, sha256File, hashSnapshot };

```

## projectos/validators/validate-claude-worker.cjs

```javascript
"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1E (§17). Proves provider
 * preparation + workspace custody, ACTUAL sandbox-executable identity (host ≠ sandbox), attestation binding,
 * the exact 4-argument invocation grammar, the single fail-closed operation finaliser (§8/§9/§10), provider-wait
 * cancellation (§11), the readiness REAL-probe model (§12/§13), capability-derived vs operation-observed evidence
 * (§14/§15), persisted evidence, and the deterministic symlink-equivalence branch (§16) — using a MOCK sandbox
 * provider + synthetic records + REAL throwaway git repos. Real claude worker + real OS sandbox are owner-machine
 * steps. Opt-in — NOT part of `npm run validate`. 55 invariants (51 §17 + 4 ECC round-2 regressions).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const P = require("../bridge/worker-policy.cjs");
const ledger = require("../bridge/workspace-ledger.cjs");
const sandbox = require("../bridge/sandbox-provider.cjs");
const attestation = require("../bridge/attestation.cjs");
const detector = require("../bridge/invocation-detector.cjs");
const opEvidence = require("../bridge/operation-evidence.cjs");
const runtime = require("../bridge/runtime-config.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const ORIGIN = "https://example.invalid/acme/app.git";
const EXE_HASH = "exe-hash-1", CLI_VER = "1.9.0", POLICY_VER = "policy-1";
const MPH = sandbox.mountPolicyHash(sandbox.MOUNT_POLICY_FIRST_PROOF);
const SB_EXE = "/sandbox/bin/claude";
const IS = detector.INVOCATION_STATUS;
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }
function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]); g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]); g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true }); fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true }); fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
const errors = [];
const fail = (inv, m, got) => errors.push(inv + ": " + m + (got !== undefined ? " :: " + JSON.stringify(got) : ""));
async function withRepo(fn) { const repo = mkRepo(); try { await fn(repo); } catch (e) { errors.push("withRepo-crash: " + (e && e.message) + (e && e.stack ? " @" + e.stack.split("\n")[1] : "")); } finally { rmRepo(repo); } }
function cleanPreserved(a) { try { const p = (a.result && a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (p) rmRepo(p.slice("workspace-preserved:".length)); } catch (e) {} }

function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_b, _a, so) => {
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => { try { if (behavior) behavior(so.cwd); } catch (e) {} if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText)); if (o.hang) return; if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000))); ch.emit("close", o.exit == null ? 0 : o.exit); });
    return ch;
  };
}
const writeApp = (rel) => (cwd) => { fs.writeFileSync(path.join(cwd, "app", rel), "x\n"); };
function mkProvider(o) { o = o || {}; return sandbox.mockProvider(o.spawnFn !== undefined ? o.spawnFn : synthSpawn(o.behavior, o.stdout, o.spawnOpts), o.provOver); }
function mkRecord(providerId, o) { return detector.syntheticRecord({ executableContentHash: EXE_HASH, cliVersion: CLI_VER, operationMode: "first-controlled-change", sandboxProviderId: providerId, policyVersion: POLICY_VER }, o || {}); }
function baseCfg(repo, o) {
  o = o || {}; const provider = o.provider !== undefined ? o.provider : mkProvider(o);
  return { projectRoots: { acme: repo }, policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 2000, maxOutputBytes: 1 << 20 }, o.policy || {}), operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" }, claudeBin: "synthetic-claude", redactor: createRedactor(), sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts), executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER, realRun: o.realRun, keepWorkspace: o.keepWorkspace };
}
const REQ = { prompt: "add a file", projectId: "acme" };
// A full attestation binding context (all §6 REQUIRED_CTX fields).
const attCtx = { providerId: "mock-provider", providerVersion: "mock-0", providerImplementationHash: "mock-impl-hash", preparedOperationId: "prep-OP1-mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "ws-1", workspacePathHash: "wph", materialisationManifestHash: "mmh", workspacePathInsideSandbox: "/sandbox/workspace/ws-1", mountPolicyHash: MPH, preExecutionLedgerHash: "pelh", executableResolvedPathInsideSandbox: SB_EXE, sandboxExecutablePath: SB_EXE, sandboxExecutableHash: EXE_HASH, sandboxExecutableVersion: CLI_VER };
const attFull = () => attestation.syntheticAttestation(attCtx, { providerImplementationHash: "mock-impl-hash", providerVersion: "mock-0" });
const prepCtx = { operationId: "OP1", workspaceId: "ws-1", hostWorkspacePathHash: "hwph", materialisationManifestHash: "mmh", preExecutionLedgerHash: "pelh", mountPolicyHash: MPH, providerId: "mock-provider" };
const mkPrep = () => mkProvider().prepareOperation({ operationId: "OP1", workspaceId: "ws-1", hostWorkspacePathHash: "hwph", materialisationManifestHash: "mmh", preExecutionLedgerHash: "pelh", networkPolicy: "disabled", mountPolicy: sandbox.MOUNT_POLICY_FIRST_PROOF });

async function run() {
  errors.length = 0;
  const rec = mkRecord("mock-provider");
  const built = detector.buildArgv(rec, "the prompt");
  const bind = { executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER };

  // ── §5 host vs sandbox executable identity ──────────────────────────────────────────────────────────
  // 1 host and sandbox executable identities are DISTINCT concepts
  { const prov = mkProvider(); const prep = mkPrep(); const sp = prov.resolveExecutable(prep, "/host/bin/claude"); const id = sandbox.buildExecutableIdentity({ hostRequestedExecutable: "claude", hostResolvedPath: "/host/bin/claude", hostContentHash: "host-h", sandboxResolvedPath: sp, sandboxContentHash: prov.hashExecutable(prep, sp), sandboxReportedVersion: prov.getExecutableVersion(prep, sp), providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }); if (id.hostResolvedPath === id.sandboxResolvedPath) fail("inv1", "host and sandbox paths not distinct"); if (id.hostContentHash === id.sandboxContentHash && id.hostContentHash != null) fail("inv1", "host and sandbox hashes conflated"); }
  // 2 actual sandbox executable is resolved
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutablePath !== SB_EXE) fail("inv2", "sandbox executable not resolved", a.result.sandboxExecutablePath); });
  // 3 actual sandbox executable hash is bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutableHash !== EXE_HASH || !a.result.sandboxExecutableIdentityHash) fail("inv3", "sandbox exe hash not bound", a.result.sandboxExecutableHash); });
  // 4 actual sandbox executable version is bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.sandboxExecutableVersion !== CLI_VER) fail("inv4", "sandbox exe version not bound", a.result.sandboxExecutableVersion); });
  // 5 a DIFFERENT sandbox executable is refused
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { hashExecutable: () => "OTHER-HASH" } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.reason !== "BLOCKED-SANDBOX-EXECUTABLE-IDENTITY") fail("inv5", "different sandbox exe not refused", a.reason); });

  // ── §4 provider preparation + workspace custody ─────────────────────────────────────────────────────
  // 6 workspace is prepared BEFORE attestation (a prepare failure blocks before attestation is even reached)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { prepareOperation: (req) => { const b = mkProvider().prepareOperation(req); b.homeMounted = true; b.preparationEvidenceHash = sandbox.hashPrepared(b); return b; } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.reason !== "BLOCKED-WORKSPACE-MOUNT") fail("inv6", "prepare failure not surfaced before attestation", a.reason); });
  // 7 actual sandbox workspace path is bound (into the result + attestation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (!/^\/sandbox\/workspace\//.test(a.result.sandboxWorkspacePath || "")) fail("inv7", "sandbox workspace path not bound", a.result.sandboxWorkspacePath); });
  // 8 workspacePathInsideSandbox mismatch is refused (unit)
  if (attestation.verifyAttestation(attFull(), Object.assign({}, attCtx, { workspacePathInsideSandbox: "/other" })).ok) fail("inv8", "workspacePathInsideSandbox mismatch accepted");
  // 9 mount-policy mismatch is refused (unit)
  { const prep = mkPrep(); if (sandbox.verifyPreparedOperation(prep, Object.assign({}, prepCtx, { mountPolicyHash: "OTHER" })).ok) fail("inv9", "mount-policy mismatch accepted"); }
  // 10 pre-execution ledger mismatch is refused (unit)
  { const prep = mkPrep(); if (sandbox.verifyPreparedOperation(prep, Object.assign({}, prepCtx, { preExecutionLedgerHash: "OTHER" })).ok) fail("inv10", "pre-execution ledger mismatch accepted"); }
  // 11 spawn uses the ATTESTED prepared operation (operation evidence echoes the prepared-operation id)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const oe = a.persistedEvidence && a.persistedEvidence.operationEvidence; if (!oe || oe.preparedOperationId !== a.result.preparedOperationId || !a.result.preparedOperationId) fail("inv11", "spawn/evidence not bound to the prepared operation", oe && oe.preparedOperationId); });
  // 12 spawn uses the VERIFIED SANDBOX executable (not the host path)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt") }); let seenBin = null; const orig = prov.spawnOperation.bind(prov); prov.spawnOperation = (req) => { seenBin = req.bin; return orig(req); }; const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (seenBin !== SB_EXE) fail("inv12", "spawn did not use the sandbox executable path", seenBin); if (a.decision !== "COMPLETED") fail("inv12", "run failed", a.reason); });

  // ── §7 exact invocation grammar ─────────────────────────────────────────────────────────────────────
  // 13 exact four-argument grammar enforced (a 5-arg command refused)
  if (detector.verifyGrammar(built.argv.concat(["--x"]), rec, "the prompt", bind).ok) fail("inv13", "5-arg command accepted");
  // 14 duplicate restriction mechanism refused
  if (detector.verifyGrammar(["--allowedTools", "--allowedTools", "-p", "p"], rec, "p", bind).ok) fail("inv14", "duplicate mechanism accepted");
  // 15 duplicate prompt is refused (prompt must be the single final argument; a 5-arg form is rejected)
  if (detector.verifyGrammar(["--allowedTools", rec.permittedTools.join(","), "-p", "p", "p"], rec, "p", bind).ok) fail("inv15", "duplicate prompt accepted");
  // 16 unknown restriction mechanism refused
  { const r2 = mkRecord("mock-provider", { restrictionMechanism: "--yolo", argumentTemplate: ["--yolo", "{tools}", "-p", "{prompt}"] }); const b2 = detector.buildArgv(r2, "p"); if (detector.verifyGrammar(b2.argv, r2, "p", bind).ok) fail("inv16", "unknown mechanism accepted"); }

  // ── §8/§9/§10 single fail-closed finaliser ──────────────────────────────────────────────────────────
  // 17 provider error after handle creation ENTERS the finaliser (terminated+disposed, not bypassed)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.reject(new Error("wait boom")) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv17", "provider error did not enter finaliser", a.result.processTerminationStatus); });
  // 18 provider error cannot report NOT EXECUTED when an operation may exist
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.reject(new Error("wait boom")) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus === "NOT EXECUTED") fail("inv18", "provider error reported NOT EXECUTED"); });
  // 19 PID-handle rejection CONFIRMS termination; 20 disposes safely. (A real run needs a real host binary, so
  //    use the node executable; the mock sandbox still measures its own SANDBOX executable identity.)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { kind: "restricted-account", pidFallback: true, permittedExecutables: [process.execPath] } }); const cfg = baseCfg(repo, { provider: prov, behavior: writeApp("n.txt"), realRun: true }); cfg.claudeBin = process.execPath; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "BLOCKED-PROCESS-OWNERSHIP") fail("inv19", "pid handle not rejected", a.reason); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv19", "pid rejection did not confirm termination", a.result.processTerminationStatus); if (a.result.operationDisposalStatus !== "disposed") fail("inv20", "pid rejection did not dispose", a.result.operationDisposalStatus); });
  // 21 unexpected post-spawn error enters emergency stop when unconfirmed
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => { throw new Error("confirm boom"); } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv21", "unexpected error not emergency", a.decision); cleanPreserved(a); });
  // 22 confirmed=true plus non-empty enumeration is REJECTED (emergency)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [999] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (a.decision !== "EMERGENCY-STOP" || a.emergencyReason !== "termination-contradiction-processes-remain") fail("inv22", "confirm+processes not rejected", a); cleanPreserved(a); });
  // 23 malformed enumeration enters emergency stop
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { enumerateOperationProcesses: () => "not-an-array" } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv23", "malformed enumeration not emergency", a.decision); cleanPreserved(a); });
  // 24 provider terminal status is required (confirm true but status still running ⇒ emergency)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { operationStatus: () => ({ state: "running" }), confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (a.decision !== "EMERGENCY-STOP" || a.emergencyReason !== "provider-status-not-terminal") fail("inv24", "non-terminal status accepted", a); cleanPreserved(a); });
  // 25 operation disposal cannot occur before confirmed zero processes (contradiction ⇒ no dispose call)
  await withRepo(async (repo) => { let disposedCalled = false; const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [999], disposeOperation: () => { disposedCalled = true; return { disposed: true, residue: [] }; } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") })); if (disposedCalled) fail("inv25", "disposed before confirmed zero processes"); cleanPreserved(a); });

  // ── §11 provider wait cancellation ──────────────────────────────────────────────────────────────────
  // 26 host timeout cancels the provider wait (provider wait resolves only on abort)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: (h, opts) => new Promise((res) => { if (opts && opts.signal) opts.signal.addEventListener("abort", () => res({ exitStatus: null, killedFor: "host-cancelled" }), { once: true }); }) } }); const cfg = baseCfg(repo, { provider: prov }); cfg.policy.timeoutMs = 50; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "timeout") fail("inv26", "host timeout did not cancel provider wait", a.reason); });
  // 27 completed provider wait clears the host timeout (a benign run returns promptly, not after the backstop)
  await withRepo(async (repo) => { const t0 = Date.now(); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const dt = Date.now() - t0; if (a.decision !== "COMPLETED") fail("inv27", "benign run failed", a.reason); if (dt > 1500) fail("inv27", "benign run waited on the host backstop", dt); });
  // 28 no provider callback runs after disposal (an aborted wait settles; the operation is disposed cleanly)
  { const prov = mkProvider(); const h = prov.spawnOperation({ operationId: "x", bin: "b", argv: [], cwd: ".", env: {} }); h._child = {}; h._alive = true; const ac = new AbortController(); const wp = prov.waitForOperationExit(h, { timeoutMs: 60000, signal: ac.signal }); ac.abort(); const settled = await Promise.race([wp.then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]); if (settled !== true) fail("inv28", "aborted provider wait did not settle (callback would run after disposal)"); prov.disposeOperation(h); }

  // ── §12/§13 readiness real probe ────────────────────────────────────────────────────────────────────
  const rdy = (over) => runtime.checkReadiness({ sandboxProvider: mkProvider({ provOver: over || {} }), detectionRecord: mkRecord("mock-provider"), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, {});
  // 29 readiness materialises a real probe workspace
  { const r = rdy(); if (!r.probeEvidence || r.probeEvidence.materialisedOk !== true) fail("inv29", "readiness did not materialise a real probe workspace", r.probeEvidence); }
  // 30 readiness does not use placeholder workspace evidence
  { const r = rdy(); const s = JSON.stringify(r); if (s.indexOf("readiness-probe-ws") >= 0 || s.indexOf("readiness-probe-path") >= 0 || s.indexOf("readiness-probe-manifest") >= 0) fail("inv30", "readiness used placeholder workspace evidence"); }
  // 31 null ownership handle blocks readiness
  { const r = rdy({ spawnOperation: () => null }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv31", "null handle passed ownership", r.checks.processOwnershipVerified); }
  // 32 missing handleType blocks readiness
  { const r = rdy({ spawnOperation: () => ({ operationId: "x" }) }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv32", "missing handleType passed ownership"); }
  // 33 ownership probe crash blocks readiness
  { const r = rdy({ spawnOperation: () => { throw new Error("boom"); } }); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv33", "crashed probe passed ownership"); }
  // 34 probe operation is cleaned in finally
  { const r = rdy(); if (!r.probeEvidence || (r.probeEvidence.cleanup.probeOperation !== "disposed" && r.probeEvidence.cleanup.probeOperation !== "none")) fail("inv34", "probe operation not cleaned", r.probeEvidence && r.probeEvidence.cleanup); }
  // 35 sentinel is cleaned in finally
  { const r = rdy(); if (!r.probeEvidence || r.probeEvidence.cleanup.sentinel !== "cleaned") fail("inv35", "sentinel not cleaned", r.probeEvidence && r.probeEvidence.cleanup); }
  // 36 probe cleanup failure blocks readiness
  { const r = rdy({ disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) }); if (r.checks.processOwnershipVerified.status !== "BLOCKED" && r.checks.processTerminationVerified.status !== "BLOCKED") fail("inv36", "probe cleanup failure did not block readiness", r.checks.processOwnershipVerified); }

  // ── §14/§15 capability-derived vs operation-observed evidence ────────────────────────────────────────
  const oevGood = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "ws-1", providerId: "p", providerVersion: "v", preparedOperationId: "prep", operationHandleType: "mock", operationHandleIdRedacted: "op-x", executableContentHash: EXE_HASH, executableIdentityHash: "idh", argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, exitStatus: 0, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, disposalStatus: "disposed", residue: [], canonicalDenialCapability: "denied", networkDenialCapability: "denied" });
  const oevCtx = { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah" };
  // 37 capability-derived evidence is labelled
  if (!oevGood.capabilityDerived || !("canonicalDenialCapability" in oevGood.capabilityDerived) || !("networkDenialCapability" in oevGood.capabilityDerived)) fail("inv37", "capability-derived evidence not labelled");
  // 38 operation-observed evidence is labelled (and is not a capability canary)
  if (!oevGood.operationObserved || oevGood.operationObserved.terminationResult !== "TERMINATED-CONFIRMED" || !("residue" in oevGood.operationObserved)) fail("inv38", "operation-observed evidence not labelled");
  // 39 confirmed termination requires process count zero
  { const bad = opEvidence.buildOperationEvidence(Object.assign({}, { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 2, disposalStatus: "disposed", residue: [] })); if (opEvidence.verifyOperationEvidence(bad, oevCtx).ok) fail("inv39", "confirmed termination with processCount>0 accepted"); }
  // 40 disposed operation requires empty residue
  { const bad = opEvidence.buildOperationEvidence(Object.assign({}, { operationId: "OP1", workspaceId: "ws-1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "ah", startTimestamp: 1, exitTimestamp: 2, outcome: "COMPLETED", terminationStatus: "TERMINATED-CONFIRMED", operationProcessCount: 0, disposalStatus: "disposed", residue: ["leftover"] })); if (opEvidence.verifyOperationEvidence(bad, oevCtx).ok) fail("inv40", "disposed with residue accepted"); }
  // 41 complete evidence objects are persisted
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const p = a.persistedEvidence; if (!p || !p.providerPreparation || !p.executableIdentity || !p.operationEvidence || !p.capabilityAttestationHash || !p.detectionRecordHash) fail("inv41", "evidence objects not fully persisted", p && Object.keys(p)); });
  // 42 persisted evidence hashes recompute
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); const p = a.persistedEvidence; if (opEvidence.hashEvidence(p.operationEvidence) !== p.operationEvidence.evidenceHash) fail("inv42", "operation evidence hash does not recompute"); if (sandbox.hashPrepared(p.providerPreparation) !== p.providerPreparation.preparationEvidenceHash) fail("inv42", "prepared-operation hash does not recompute"); });

  // ── §16 deterministic symlink equivalence ───────────────────────────────────────────────────────────
  // 43 deterministic symlink failure blocks a real execution (injected failure — NO env skip)
  await withRepo(async (repo) => {
    const blob = execFileSync("git", ["-C", repo, "hash-object", "-w", "--stdin"], { input: "seed.txt" }).toString().trim();
    g(repo, ["update-index", "--add", "--cacheinfo", "120000," + blob + ",app/link"]); g(repo, ["commit", "-q", "-m", "link"]);
    const head = g(repo, ["rev-parse", "HEAD"]).trim();
    const failSym = () => { throw new Error("forced-symlink-fail"); };
    // synthetic mode records the fallback + writes a substitute
    const m1 = ledger.materialize(repo, head, { symlinkSync: failSym });
    if (!(m1.symlinkFallbacks || []).length || !fs.existsSync(path.join(m1.workspace, "app", "link"))) fail("inv43", "synthetic fallback not recorded/substituted");
    ledger.dispose(m1.workspace);
    // real mode fails closed, removes the partial workspace, writes NO substitute
    let threw = null, dest = null;
    try { ledger.materialize(repo, head, { realRun: true, symlinkSync: (t, d) => { dest = d; failSym(); } }); } catch (e) { threw = e.message; }
    if (!/NOT-EQUIVALENT/.test(String(threw))) fail("inv43", "real-run symlink failure did not block", threw);
    if (dest && fs.existsSync(dest)) fail("inv43", "a regular-file substitute was written in a real run");
    if (dest && fs.existsSync(path.dirname(dest))) fail("inv43", "partial workspace not removed");
  });
  // 44 workspace-ledger source is present in full for the review bundle
  { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", "workspace-ledger.cjs"), "utf8"); if (src.length < 2000 || src.indexOf("WORKSPACE-MATERIALISATION-NOT-EQUIVALENT") < 0) fail("inv44", "workspace-ledger source missing/short for the bundle"); }

  // ── governance + hygiene ────────────────────────────────────────────────────────────────────────────
  // 45 worker cannot self-approve or close
  { let a = false, cl = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { a = true; } try { P.buildResult({ workerDecision: "CLOSED" }); } catch (e) { cl = true; } if (!a || !cl) fail("inv45", "worker self-approve/close not rejected"); }
  // 46 no metered AI API; 47 no prod/provider/send/payment (source scan)
  { const m = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; const pr = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i;
    for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "operation-evidence", "runtime-config", "owner-capability-check", "owner-readiness-report", "executable-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (m.test(src)) fail("inv46", "metered API in " + f);
      if (f !== "worker-policy" && pr.test(src)) fail("inv47", "prod/provider/send/payment in " + f); } }
  // 48 canonical monitored state remains stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv48", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv48", "canonical drifted"); });
  // 49 all temporary residue is accounted for
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt") })); if (a.result.residue.length !== 0) fail("inv49", "benign residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("n.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv49", "kept workspace not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 50 working tree stays clean — the validator writes ONLY under the OS tmpdir
  { const self = fs.readFileSync(__filename, "utf8"); if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(self)) fail("inv50", "validator not tmpdir-only (could dirty the working tree)"); }
  // 51 remote remains frozen — the validator never references a real remote
  { if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv51", "validator references a real remote"); }

  // ── ECC round-2 regression invariants ───────────────────────────────────────────────────────────────
  // 52 a NON-MOCK provider's bare-PID handle is rejected even WITHOUT the realRun flag (security fix)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("n.txt"), provOver: { kind: "restricted-account", pidFallback: true, permittedExecutables: [process.execPath] } }); const cfg = baseCfg(repo, { provider: prov, behavior: writeApp("n.txt") }); cfg.claudeBin = process.execPath; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "BLOCKED-PROCESS-OWNERSHIP") fail("inv52", "non-mock pid handle not rejected without realRun", a.reason); });
  // 53 EMERGENCY-STOP reports preservation FAILED (not a fabricated "preserved") when preserve throws
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }), preserveOperationEvidence: () => { throw new Error("preserve boom"); } } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision !== "EMERGENCY-STOP") fail("inv53", "not emergency", a.decision); else if (a.result.operationDisposalStatus !== "not-disposed-evidence-preservation-failed") fail("inv53", "preservation failure fabricated as preserved", a.result.operationDisposalStatus); cleanPreserved(a); });
  // 54 verifyExecutableIdentity fails closed on an INCOMPLETE context (missing binding fields)
  { const prep = mkPrep(); const id = sandbox.buildExecutableIdentity({ hostRequestedExecutable: "c", hostResolvedPath: "/h", hostContentHash: "hh", sandboxResolvedPath: SB_EXE, sandboxContentHash: EXE_HASH, sandboxReportedVersion: CLI_VER, providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }); if (sandbox.verifyExecutableIdentity(id, {}).ok) fail("inv54", "exe-identity accepted an incomplete context"); if (!sandbox.verifyExecutableIdentity(id, { expectedContentHash: EXE_HASH, cliVersion: CLI_VER, providerId: "mock-provider", preparedOperationId: prep.preparedOperationId }).ok) fail("inv54", "exe-identity rejected a complete valid context"); }
  // 55 a workspace-disposal failure on a KILLED run escalates to the WORKSPACE-DISPOSAL-FAILED headline
  await withRepo(async (repo) => { const origDispose = ledger.dispose; ledger.dispose = (d) => { origDispose(d); return ["forced-residue:" + d]; }; try { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "WORKSPACE-DISPOSAL-FAILED") fail("inv55", "workspace disposal failure not escalated on a killed run", a.reason); } finally { ledger.dispose = origDispose; } });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV")); const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (55 invariants: 51 §17 + 4 ECC round-2" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };

```

---

*End of HARDEN1E review bundle. IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. No push. No real worker. Remote frozen at 4c3f076.*
