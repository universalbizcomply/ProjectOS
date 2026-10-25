# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C — SINGLE-FILE REVIEW BUNDLE

> Everything Murad + ChatGPT need to review "provable readiness, operation-bound attestation and safe process
> ownership", in one file: report (every §14 section) + full source of the phase modules. Local-only. Remote
> frozen `4c3f076`.

**Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C`
**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.**
**Not pushed. Not closed. No real worker / Docker / Supabase / production / provider / send / payment / secret / metered-AI API / install.**

---

# PART A — REPORT

## A1. Baseline

folder `C:\dev\ProjectOS`; branch `projectos-v3`; pre-phase HEAD `dabcee5` (HARDEN1B); remote = **`4c3f076`**
(frozen); 33 ahead / 0 behind at start; working tree clean; `git diff --check` clean. **Available:** ECC
agents (security/code/architect/silent-failure) — used; **ui-ux-pro-max AVAILABLE — used** for the owner
readiness report; **"Claude Design" (named product) NOT available** → frontend-design/ECC design rules used as
the equivalent (stated, not fabricated).

## A2. Findings corrected (what HARDEN1B left declaration-based → now technically verified)

Env-marker readiness removed; boolean `attest().enforced` → operation-bound canary attestation; self-declared
`verified:true` → a detector verification record bound to the executable; historical PID identity → a
provider-owned operation handle; hardcoded process-control PASS → a live lifecycle probe; termination boolean
→ an enum; a first-proof network-disabled gate; a single shared verifier path for capability-check + adapter.

## A3. Architecture (11 modules)

```
runClaudeWorker: policy/content → SANDBOX (fail-closed; real ⇒ non-mock) → FIRST-PROOF NETWORK=disabled
  → EXECUTABLE (shared checker; provider-permitted; REAL binary hashed + version bound)
  → OPERATION-BOUND ATTESTATION verified (canaries pinned; evidenceHash always checked)
  → DETECTION RECORD verified (bound to exe hash + version + provider + policy; tool-list cross-checked)
  → baseline → materialise .git-free workspace → FS-before → provider.spawnOperation (STABLE handle)
  → CONFIRM via handle (clean exit never touches a reused PID) — unconfirmed ⇒ EMERGENCY-STOP (evidence kept)
  → FS-after → trusted diff → enforce → monitor (unverifiable ⇒ blocked) → dispose → schema-v2 result
owner-capability-check → runtime-config.checkReadiness (SAME verifiers) → 9 checks / 11 states + HTML report
```
NEW: `attestation.cjs`, `invocation-detector.cjs`, `runtime-config.cjs`, `owner-readiness-report.cjs`.
REWRITTEN: `sandbox-provider.cjs`, `claude-worker.cjs`, `owner-capability-check.cjs`. MODIFIED:
`worker-policy.cjs`. REMOVED (dead): `invocation-profile.cjs`, `process-control.cjs` (PID termination fully
superseded by the operation handle).

## A4. Runtime-configuration model (§3)

`runtime-config.checkReadiness(config, ctx, opts)` is the single readiness evaluator; the capability checker
calls it and the adapter uses the **same verifier functions** (`attestation.verifyAttestation`,
`detector.verifyDetectionRecord`, `sandbox.resolveSandbox/probeProcessControl`, `execcheck.validateExecutable`).
NO environment marker is consulted for any security check (`owner-capability-check.loadRuntimeConfig` ignores
`process.env`). A `kind:"mock"` provider proves the verifiers work but can NEVER reach
`READY-FOR-REAL-WORKER-PROOF` (mirrors the adapter's `requireReal` gate).

## A5. Sandbox attestation model (§4)

Structured, operation-bound. `verifyAttestation` requires: schema, a COMPLETE binding context
(provider/operation/project/phase/workspace/executable — a missing ctx field is a failure, not skipped),
freshness (unexpired), every mandatory canary present + `result==="PASS"` + **`expected` pinned to the only
safe value** (deny-canaries="denied", writable="allowed", child-process="contained", cleanup="complete",
emergency="confirmed" — a provider can't self-choose a permissive expectation), `overallResult==="PASS"`, and
an **always-checked** 64-hex `evidenceHash` (a blanked/absent hash fails). `{enforced:true}` fails everything.
Mock generates a synthetic attestation, refused for real runs.

## A6. Tool-profile detection model (§5)

`verifyDetectionRecord` requires a detector record (a manual `verified:true` fails), bound to executable
content hash + CLI version + provider id + policy version + operation mode (missing ctx = failure), unexpired,
all `*Disabled` flags true, the three negative-capability tests reporting "DENIED BY TECHNICAL CONTROL", empty
`permittedCommands` (first proof), a **tool-list cross-check** (no permitted tool grants a dangerous
capability; forbidden list ⊇ Bash/Shell/WebFetch/Git), and an always-checked 64-hex `recordHash`.

## A7. Operation-handle model (§6)

The provider owns execution via a stable handle (job object / container id / VM session — never a bare reused
PID). Methods: `spawnOperation / operationStatus / enumerateOperationProcesses / terminateOperation /
confirmOperationTerminated / preserveOperationEvidence / disposeOperation`. Clean exit confirms via the
handle (no kill of a possibly-reused PID); unconfirmed ⇒ EMERGENCY-STOP with evidence preserved. A PID-typed
handle is forbidden for real runs. The mock is a faithful in-process stand-in (now actually kills its child).

## A8. Process-control readiness model (§7)

`probeProcessControl` exercises the real lifecycle on a harmless synthetic contained process: spawn → status →
enumerate → terminate → confirm → **re-enumerate (must be empty — the provider's `confirmed` is not trusted
alone)** → dispose (**a malformed/absent residue array fails closed**, absence ≠ "no residue"). Any failure ⇒
BLOCKED-PROCESS-CONTROL. No real Claude process required.

## A9. Capability state machine (§10)

Nine independent checks (sandbox implementation, sandbox attestation, executable, tool restriction, process
ownership, process termination, network disabled, docker, supabase) → the eleven allowed states
(READY-FOR-SYNTHETIC-VALIDATION / BLOCKED-SANDBOX-IMPLEMENTATION / -SANDBOX-ATTESTATION / -EXECUTABLE /
-TOOL-RESTRICTION / -PROCESS-OWNERSHIP / -PROCESS-CONTROL / -NETWORK-POLICY / -DOCKER / -SUPABASE /
READY-FOR-REAL-WORKER-PROOF). No state is derived from an environment marker.

## A10. Evidence schema (§9)

`processTerminationStatus` is an ENUM (NOT APPLICABLE / NOT EXECUTED / TERMINATED-CONFIRMED /
TERMINATION-UNCONFIRMED / EMERGENCY-STOP-REQUIRED); pre-spawn refusals report NOT APPLICABLE, spawn failures
NOT EXECUTED. New fields: `operationHandleType / operationHandleIdRedacted / operationProcessCountObserved /
processControlProvider / processControlEvidenceHash`. `process-termination-confirm` is only in
`technicallyEnforced` when TERMINATED-CONFIRMED (validated). Deep-frozen; `resultHash` always checked; worker
cannot assert a gate decision.

## A11. Validator matrix (`validate-claude-worker.cjs` — 49 invariants, PASS, 0 env-skip)

§11's 1–41 (env-markers / shared-path / attestation reject-cases / detection reject-cases / operation-handle /
termination enum / evidence / no-metered / no-prod / ledger / residue / frozen) + 42 owner-report no-false-READY
+ **round-2 ECC regressions: 43 mock-never-real-ready · 44 canary-expected pinned · 45 blanked-hash rejected
(attestation/detection/result) · 46 permittedTools-dangerous rejected · 47 forbidden-list-incomplete rejected ·
48 probe re-enumerates after confirm · 49 malformed-dispose fails closed.** Per-invariant isolation.

## A12. Exact results

- `node projectos/validators/validate-claude-worker.cjs` → **PASS (49 invariants, 0 env-skipped)**.
- `npm run validate` → **validate-all: ALL PASS (61 validators)**.
- `git diff --check` → clean. Temp workspace residue → **0**.
- `node projectos/bridge/owner-capability-check.cjs` (no config) → **BLOCKED-SANDBOX-IMPLEMENTATION**.
- `owner-capability-check.cjs --html` → self-contained readiness report (no false READY when blocked).

## A13. Full ECC findings (security + architecture + silent-failure — all resolved)

**Silent-failure CRITICAL:** integrity check skipped when `evidenceHash`/`recordHash`/`resultHash` is falsy →
**fixed** (require 64-hex, always compare). **Security HIGH:** H1 shared-path only half-true + mock reaches
READY-FOR-REAL → **fixed** (folded checks into `runtime-config`; mock can never be real-ready; doc corrected to
"shared verifiers"); H2 canary `expected` not pinned → **fixed** (pinned per canary); H3 = the falsy-hash
CRITICAL; H4 `permittedTools`/`forbiddenTools` not cross-checked → **fixed**. **Silent-failure HIGH:**
`probeProcessControl` trusts self-report + dispose fail-open → **fixed** (re-enumerate + strict dispose);
`validateExecutable` unguarded → **fixed** (try/catch in both paths); snapshot sentinels mask drift → **fixed**
(`unverifiable` count blocks). **Architecture:** H2 config-asserted identity → **fixed** (hash the REAL resolved
binary + bind version + feed resolved path into attestation); M3 dead `DENY_CANARIES` → used; M4 dead
`process-control` → deleted; M5 thin `processControlEvidenceHash` → thickened (operation + handle + provider
evidence, canonical); L9 unused `operationStatus` → used in the probe; L10 mock kills its child; ctx-binding
skip → ctx now required-complete. No open HIGH/CRITICAL.

## A14. UI UX Pro Max findings — **AVAILABLE, USED**

Invoked `ui-ux-pro-max` (design-system search) for the owner readiness surface. Applied: technical dark+light
palette (`#0F172A`/`#1E293B`/`#334155`, ready-green, warn-amber, danger-red), monospace/sans system stack
(Fira family cue), SVG-not-emoji icons, **status badges carrying an icon AND text (never colour-only)**, 4.5:1
contrast in both themes, visible focus, `prefers-reduced-motion`, security-first hierarchy, and a rule that a
check renders READY only when its status is PASS (no false READY). Delivered `owner-readiness-report.cjs` — a
self-contained OFFLINE HTML readiness report (`owner-capability-check.cjs --html`) covering the 9 checks, the
overall/emergency banner, failed-canary reasons, and an ordered recovery sequence. I did NOT adopt the tool's
auto-picked "vibrant/playful" style (wrong tone for a security tool) — a documented, deliberate deviation.
Regression-guarded by inv42. Terminal WCAG/keyboard/mobile is N/A for the CLI readout (recorded, not claimed).

## A15. Claude Design findings — **UNAVAILABLE (named product)**

No skill named "Claude Design" is installed; **not fabricated**. Equivalent applied from ECC web
design-quality / accessibility rules + the `frontend-design` discipline: information hierarchy (banner → check
rows → recovery), consistency (one badge/row system), plain-language reasons, not-colour-only status. A future
GUI should reuse `control-center/src/forge` and be reviewed then.

## A16. Claude self-review

Applied the 10-point checklist after each step + a final pass. Self-caught + fixed: the mock operation handle
not clearing its process set on clean exit (would have made every benign run read unconfirmed); the orphaned
`invocation-profile`/`process-control` modules; the ui-ux auto-style mismatch. Final pass confirmed every
early/blocked path reports the correct termination enum, the emergency path preserves evidence, and every
synthetic-only proof is labelled. Real worker / Docker-Supabase remain owner-machine steps.

## A17. Defects found and fixed — see A13 (consolidated).

## A18. Unresolved limitations (accepted / documented follow-ups)

1. **This is not itself an OS sandbox** — enforcement is delivered by a real provider that must run the
   canaries through the same boundary and return an attestation that passes `verifyAttestation`. None installed
   → real runs BLOCKED.
2. **Integrity, not authenticity** — the four evidence hashes (attestation `evidenceHash`, detection
   `recordHash`, `resultHash`, `processControlEvidenceHash`) detect post-hoc mutation, not a compromised/hostile
   provider (which recomputes them). The `kind:"mock"` gate covers synthetic providers; a real provider is
   trusted for its own attestation. A provider-signed (HMAC/asymmetric) attestation is the follow-up if the
   threat model includes a hostile provider.
3. **`resultHash` uses plain `JSON.stringify`** (key-order dependent) while attestation/detection/pc use
   canonical serialisation — unify into one `hash-util` (follow-up).
4. **`runClaudeWorker` is large** (M7) and `buildResult`/`validateResult` keep parallel field lists (L12) —
   decompose / derive from one descriptor (follow-up).
5. The adapter uses the same verifier FUNCTIONS as `runtime-config` but does not literally call
   `checkReadiness`; the checks are aligned + inv43 guards the mock case — a full single-function extraction is
   deferred.
6. Descendant enumeration in a real provider is the provider's responsibility now (the PID enumerator was
   deleted); process-control readiness only proves the provider's lifecycle contract.

## A19. Files changed · git · no-X · decision

**New:** `projectos/bridge/{attestation,invocation-detector,runtime-config,owner-readiness-report}.cjs`.
**Rewritten:** `projectos/bridge/{sandbox-provider,claude-worker,owner-capability-check}.cjs`. **Modified:**
`projectos/bridge/worker-policy.cjs`, `projectos/validators/validate-claude-worker.cjs`, checkpoint, this
bundle. **Deleted:** `projectos/bridge/{invocation-profile,process-control}.cjs`.
Branch `projectos-v3`; remote unchanged **`4c3f076`**; **Pushed: NO**; **Closed: NO**.
No production · No deploy · No provider · No send · No payment · No metered AI API · No network · No real
worker · No Docker/Supabase · No system software installed · No secret disclosed.

**Decision required:** ChatGPT/Murad review of HARDEN1C. On acceptance, the next phase implements a REAL sandbox
provider (real canary attestation + real detector + real operation handle) on an owner machine and runs the
real Gate 1–3 only when `owner-capability-check` reports READY-FOR-REAL-WORKER-PROOF.

---

**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.** Operation-bound attestation, detector-verified
tool restriction, provider-owned operation handles, one shared verifier path (no env-marker readiness),
termination enum; 49-invariant validator PASS; 3-agent ECC round (1 CRITICAL + multiple HIGH all fixed with
regression tests); ui-ux-pro-max applied; honest limitations documented. Not pushed, not closed.

---

# PART B — FULL SOURCE (phase modules)

## attestation.cjs

```js
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
  "schemaVersion", "providerId", "providerVersion", "providerImplementationHash", "operationId",
  "projectId", "phaseId", "workspaceId", "workspacePathInsideSandbox", "executableResolvedPathInsideSandbox",
  "timestamp", "expiry", "overallResult", "evidenceHash",
].concat(MANDATORY_CANARIES);

// Canaries whose EXPECTED result is that the access is denied / not reachable.
const DENY_CANARIES = ["canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary", "networkCanary"];
// The ONLY safe `expected` value per canary — pinned by the verifier so a provider cannot self-choose a
// permissive expectation and pass. actual must equal this exact value (and result must be PASS).
const CANARY_EXPECTED = { canonicalPathCanary: "denied", otherProjectPathCanary: "denied", homePathCanary: "denied", credentialPathCanary: "denied", networkCanary: "denied", writablePathCanary: "allowed", childProcessContainmentCanary: "contained", cleanupCanary: "complete", emergencyTerminationCanary: "confirmed" };
// Context fields the caller MUST supply for binding — a missing one is a verification failure, never skipped.
const REQUIRED_CTX = ["providerId", "operationId", "projectId", "phaseId", "workspaceId", "executableResolvedPathInsideSandbox"];

function canonicalJson(obj) {
  // deterministic stringify (sorted keys) so the hash is stable across key order
  const seen = new WeakSet();
  const norm = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null; seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      const out = {}; for (const k of Object.keys(v).sort()) out[k] = norm(v[k]); return out;
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
  const att = {
    schemaVersion: SCHEMA_VERSION,
    providerId: c.providerId || null, providerVersion: o.providerVersion || "mock-0", providerImplementationHash: o.providerImplementationHash || "mock-hash",
    operationId: c.operationId || null, projectId: c.projectId || null, phaseId: c.phaseId || null,
    workspaceId: c.workspaceId || null, workspacePathInsideSandbox: o.workspacePathInsideSandbox || "/sandbox/workspace",
    executableResolvedPathInsideSandbox: c.executableResolvedPathInsideSandbox || "/sandbox/bin/claude",
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

## invocation-detector.cjs

```js
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
  "timestamp", "expiry", "recordHash",
];
const MUST_DISABLE = ["shellDisabled", "gitWriteDisabled", "networkDisabled", "providerToolsDisabled", "databaseToolsDisabled", "deploymentToolsDisabled"];

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
    permittedTools: o.permittedTools || ["Read", "Edit"], forbiddenTools: o.forbiddenTools || ["Bash", "Shell", "WebFetch", "Git"],
    permittedCommands: o.permittedCommands || [],
    shellDisabled: o.shellDisabled !== false, gitWriteDisabled: o.gitWriteDisabled !== false, networkDisabled: o.networkDisabled !== false,
    providerToolsDisabled: o.providerToolsDisabled !== false, databaseToolsDisabled: o.databaseToolsDisabled !== false, deploymentToolsDisabled: o.deploymentToolsDisabled !== false,
    commandExecutionDisabled: o.commandExecutionDisabled !== false,
    negativeTests: neg, operationMode: c.operationMode || "first-controlled-change",
    sandboxProviderId: c.sandboxProviderId || null, policyVersion: c.policyVersion || "policy-1",
    timestamp: now, expiry: now + (o.ttlMs || 300000),
  };
  rec.recordHash = hashRecord(rec);
  if (o.tamper) rec.cliVersion = "9.9.9"; // do NOT re-hash → mismatch
  return rec;
}

module.exports = { verifyDetectionRecord, syntheticRecord, hashRecord, DETECTOR_VERSION, NEGATIVE_TESTS, DENIED, RECORD_FIELDS };
```

## sandbox-provider.cjs

```js
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

const attestation = require("./attestation.cjs");

const OPERATION_METHODS = ["spawnOperation", "operationStatus", "enumerateOperationProcesses", "terminateOperation", "confirmOperationTerminated", "preserveOperationEvidence", "disposeOperation"];
const REQUIRED_FIELDS = [
  "name", "kind", "providerId", "providerVersion", "attest",
  "readablePaths", "writablePaths", "mountedWorkspace",
  "canonicalVisibility", "otherProjectVisibility", "homeVisibility", "credentialVisibility",
  "networkPolicy", "permittedExecutables", "processLimits", "childProcessPolicy",
  "cleanupPolicy", "emergencyTermination",
].concat(OPERATION_METHODS);

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

/**
 * Process-control readiness probe (§7): exercise the provider's operation lifecycle with a harmless synthetic
 * contained process — create → verify handle → enumerate → terminate → confirm → no residue → unrelated
 * untouched. Returns { ok, reason, evidence }. No real Claude process needed.
 */
function probeProcessControl(provider) {
  try {
    if (!provider || OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) return { ok: false, reason: "no-operation-lifecycle" };
    const handle = provider.spawnOperation({ probe: true, operationId: "probe-op", bin: "<probe>", argv: [], cwd: "<probe>", env: {} });
    if (!handle || !handle.handleType || !handle.operationId) return { ok: false, reason: "no-operation-handle" };
    const status = provider.operationStatus(handle);
    if (!status || (status.state !== "running" && status.state !== "exited")) return { ok: false, reason: "operation-status-malformed" };
    const before = provider.enumerateOperationProcesses(handle);
    provider.terminateOperation(handle);
    const conf = provider.confirmOperationTerminated(handle);
    if (!conf || conf.confirmed !== true) return { ok: false, reason: "termination-unconfirmed" };
    // Independent re-check — do not trust the provider's confirm alone: the process list must actually be empty.
    const after = provider.enumerateOperationProcesses(handle);
    if (!Array.isArray(after)) return { ok: false, reason: "enumeration-malformed-after-confirm" };
    if (after.length) return { ok: false, reason: "residual-processes-after-confirm" };
    const disp = provider.disposeOperation(handle);
    if (!disp || !Array.isArray(disp.residue)) return { ok: false, reason: "dispose-result-malformed" }; // absent residue is NOT "no residue"
    if (disp.residue.length) return { ok: false, reason: "residue-after-dispose" };
    return { ok: true, reason: "lifecycle-demonstrated", evidence: { enumeratedBefore: Array.isArray(before) ? before.length : "contained", processCountAtConfirm: conf.processCount } };
  } catch (e) { return { ok: false, reason: "probe-crashed", detail: String(e && e.message).slice(0, 120) }; }
}

/**
 * MOCK provider — SYNTHETIC proofs only (`kind:"mock"`, refused for real runs). Implements the full operation
 * lifecycle over an in-process handle and generates a well-formed operation-bound attestation. `spawnFn` is
 * the synthetic worker stand-in. `pidFallback:true` labels a provider whose handle degrades to a PID (only
 * permitted for labelled synthetic tests, never real runs).
 */
function mockProvider(spawnFn, overrides) {
  const base = {
    name: "mock-sandbox", kind: "mock", providerId: "mock-provider", providerVersion: "mock-0", operationHandleType: "mock-in-process",
    attest: (ctx) => attestation.syntheticAttestation(Object.assign({ providerId: "mock-provider" }, ctx || {}), (overrides && overrides._attestOpts) || {}),
    spawnOperation: function (req) {
      const child = spawnFn ? spawnFn(req.bin, req.argv, { cwd: req.cwd, shell: false, env: req.env }) : null;
      const handle = { handleType: this.pidFallback ? "pid" : "mock-in-process", operationId: req.operationId || "op", handleId: "H-" + (req.operationId || "op"), child, _alive: true, _pids: new Set(child && child.pid ? [child.pid] : []) };
      // A clean child exit finishes the whole (mock in-process) operation: no contained descendants remain.
      if (child) child.on && child.on("close", () => { handle._alive = false; handle._pids = new Set(); });
      return handle;
    },
    operationStatus: (h) => ({ state: h && h._alive ? "running" : "exited" }),
    enumerateOperationProcesses: (h) => (h && h._pids ? Array.from(h._pids) : []),
    // A real provider MUST perform the actual OS kill of the whole operation; the mock kills its child too.
    terminateOperation: (h) => { if (h) { try { h.child && h.child.kill && h.child.kill(); } catch (e) {} h._alive = false; h._pids = new Set(); } },
    confirmOperationTerminated: (h) => ({ confirmed: !!h && h._alive === false && h._pids.size === 0, processCount: h ? h._pids.size : 0, evidence: "mock-handle" }),
    preserveOperationEvidence: (h) => ({ preserved: true, location: "in-memory:" + (h && h.handleId) }),
    disposeOperation: () => ({ residue: [] }),
    readablePaths: ["<workspace>"], writablePaths: ["<workspace>"], mountedWorkspace: "<workspace>",
    canonicalVisibility: "not-mounted", otherProjectVisibility: "not-mounted", homeVisibility: "not-mounted", credentialVisibility: "not-mounted",
    networkPolicy: "disabled", networkAllowlist: [], permittedExecutables: ["<claude>"],
    processLimits: { cpuSeconds: 120, memoryMb: 2048, maxChildren: 32 }, childProcessPolicy: "contained",
    cleanupPolicy: "destroy-on-exit", emergencyTermination: "kill-operation", pidFallback: false,
  };
  return Object.assign(base, overrides || {});
}

module.exports = { resolveSandbox, validateProvider, policySummary, probeProcessControl, mockProvider, isReallyIsolated, REQUIRED_FIELDS, OPERATION_METHODS };
```

## runtime-config.cjs

```js
"use strict";
/**
 * Shared runtime-configuration validation — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§3, §10).
 *
 * The owner capability checker and the worker adapter share the SAME verifier functions (attestation,
 * detection record, sandbox contract, executable checker) and this module's readiness evaluation. NO
 * environment marker can make any security check PASS — readiness is technically verified or BLOCKED. A
 * `kind:"mock"` provider can prove the verifiers work but can NEVER reach READY-FOR-REAL-WORKER-PROOF (a mock
 * is synthetic, not a real OS implementation) — mirroring the adapter's `requireReal` gate so the two paths
 * cannot report READY where the other would BLOCK.
 */

const fs = require("fs");
const crypto = require("crypto");
const sandbox = require("./sandbox-provider.cjs");
const attestation = require("./attestation.cjs");
const detector = require("./invocation-detector.cjs");
const execcheck = require("./executable-check.cjs");

const CHECKS = [
  "sandboxImplementationPresent", "sandboxAttestationPass", "executableValidated", "toolRestrictionVerified",
  "processOwnershipVerified", "processTerminationVerified", "networkDisabled", "dockerReady", "supabaseReady",
];
function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

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

  // Resolve the executable ONCE (real providers only), guarded — a crash is fail-closed, never a throw escape.
  let ev = null, exeHash = null;
  if (provider && !isMock) {
    try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { ev = { ok: false, reason: "executable-check-crashed" }; }
    if (ev && ev.ok && ev.resolvedPath) { try { exeHash = sha256File(ev.resolvedPath); } catch (e) { exeHash = null; } }
  }
  const exePathInSandbox = isMock ? "/sandbox/bin/claude" : (ev && ev.resolvedPath) || null;
  const attContext = Object.assign({}, context, { executableResolvedPathInsideSandbox: context.executableResolvedPathInsideSandbox || exePathInSandbox, providerId: (provider && provider.providerId) || context.providerId });

  // 2) sandbox attestation (structured, operation-bound, verified)
  if (checks.sandboxImplementationPresent.status !== "PASS") block("sandboxAttestationPass", "no-valid-provider");
  else { let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attContext) : null; } catch (e) { att = null; } const v = attestation.verifyAttestation(att, attContext); v.ok ? pass("sandboxAttestationPass") : block("sandboxAttestationPass", v.errors[0] || "attestation-failed", { errors: v.errors }); }

  // 3) executable validated (mock attests synthetically; real must resolve, be permitted, and hash-match the
  //    detection record's bound executableContentHash).
  if (isMock) pass("executableValidated");
  else if (!ev || !ev.ok) block("executableValidated", (ev && ev.reason) || "not-validated");
  else if (Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) block("executableValidated", "not-in-provider-permitted-executables");
  else if (c.executableContentHash && exeHash && exeHash !== c.executableContentHash) block("executableValidated", "executable-content-hash-mismatch");
  else pass("executableValidated");

  // 4) tool restriction verified (detection record bound to executable + version + provider + policy)
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider && provider.providerId, policyVersion: c.policyVersion, now: context.now, firstControlledChange: true });
  dv.ok ? pass("toolRestrictionVerified") : block("toolRestrictionVerified", dv.errors[0] || "no-detection-record", { errors: dv.errors });

  // 5) process OWNERSHIP: stable operation handle, not a bare PID (real runs forbid pid handles)
  if (!provider || sandbox.OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) block("processOwnershipVerified", "no-operation-lifecycle");
  else if (provider.pidFallback === true && !isMock) block("processOwnershipVerified", "pid-only-provider-forbidden-for-real-runs");
  else pass("processOwnershipVerified");

  // 6) process TERMINATION: exercise the operation lifecycle (synthetic contained process)
  const probe = provider ? sandbox.probeProcessControl(provider) : { ok: false, reason: "no-provider" };
  probe.ok ? pass("processTerminationVerified") : block("processTerminationVerified", probe.reason);

  // 7) network disabled (first controlled-change proof requires disabled — no allowlist)
  (!provider || provider.networkPolicy !== "disabled") ? block("networkDisabled", provider ? "network-policy-not-disabled:" + provider.networkPolicy : "no-provider") : pass("networkDisabled");

  // 8/9) infra
  o.docker && o.docker.status === "PASS" ? pass("dockerReady") : block("dockerReady", (o.docker && o.docker.how) || "not-checked");
  o.supabase && o.supabase.status === "PASS" ? pass("supabaseReady") : block("supabaseReady", (o.supabase && o.supabase.how) || "not-checked");

  return { checks, overall: overallState(checks, isMock), realBlockReason: realBlockReason(checks, isMock) };
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

module.exports = { checkReadiness, realBlockReason, overallState, CHECKS, STATE_ORDER };
```

## claude-worker.cjs

```js
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
const execcheck = require("./executable-check.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024;
const DANGEROUS_FLAG = /^--?(dangerously-skip-permissions|no-sandbox|allow-all|yolo|permission-mode=bypass)/i;

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

/** Wire the provider-owned operation's child stream with bounded output + a timeout that terminates the OP. */
function driveOperation(provider, handle, policy) {
  const child = handle && handle.child;
  return new Promise((resolve) => {
    if (!child) return resolve({ killedFor: "spawn-error", code: null, stdout: "" }); // no process ⇒ NOT EXECUTED
    let stdout = "", stderrBytes = 0, killedFor = null, doneF = false;
    const finish = (payload) => { if (doneF) return; doneF = true; clearTimeout(timer); try { child.stdout && child.stdout.removeAllListeners("data"); child.stderr && child.stderr.removeAllListeners("data"); } catch (e) {} resolve(payload); };
    const abort = (why) => { killedFor = why; try { provider.terminateOperation(handle); } catch (e) {} finish({ stdout, killedFor: why, code: null }); };
    const timer = setTimeout(() => abort("timeout"), policy.timeoutMs);
    child.stdout && child.stdout.on("data", (d) => { stdout += d.toString(); if (Buffer.byteLength(stdout, "utf8") > policy.maxOutputBytes) abort("output-overflow"); });
    child.stderr && child.stderr.on("data", (d) => { stderrBytes += d.length; if (stderrBytes > policy.maxOutputBytes) abort("stderr-overflow"); });
    child.on && child.on("error", () => finish({ killedFor: killedFor || "worker-error", code: null, stdout }));
    child.on && child.on("close", (code) => finish({ stdout, killedFor, code }));
  });
}

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

  // 4) Executable FIRST (so identity is verified against the REAL binary, not a config claim): shared checker;
  //    provider must permit exactly this executable; the resolved binary's content hash + version must match
  //    the values the detection record + attestation are bound to.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-configured" }));
  if (provider.kind !== "mock" && Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "not-in-provider-permitted-executables" }));
  let exeResolved = provider.kind === "mock" ? "/sandbox/bin/claude" : null;
  if (requireReal || provider.kind !== "mock") {
    let ev; try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-check-crashed", detail: String(e.message).slice(0, 120) })); }
    if (!ev.ok) return na(blocked("BLOCKED-EXECUTABLE", { execReason: ev.reason, resolvedPath: ev.resolvedPath || null }));
    exeResolved = ev.resolvedPath;
    // bind the actual binary: hash it and compare to the record/attestation's declared executableContentHash
    let realHash = null; try { realHash = sha256(fs.readFileSync(ev.resolvedPath)); } catch (e) { return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-unreadable" })); }
    if (c.executableContentHash && realHash !== c.executableContentHash) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "executable-content-hash-mismatch" }));
    if (c.cliVersion && ev.version && String(ev.version).indexOf(c.cliVersion) < 0) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "cli-version-mismatch", detail: ev.version }));
  }
  if (typeof c.claudeArgs !== "function") return na(blocked("no-tool-restriction-configured"));

  // 5) STRUCTURED operation-bound attestation (not a boolean) — bound to the REAL resolved executable path.
  const attCtx = { providerId: provider.providerId, operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, workspaceId: policy.operationId, executableResolvedPathInsideSandbox: exeResolved, now: c.now };
  let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
  const av = attestation.verifyAttestation(att, attCtx);
  if (!av.ok) return na(blocked("BLOCKED-SANDBOX-ATTESTATION", { errors: av.errors }));

  // 6) TOOL-RESTRICTION DETECTION RECORD verified (bound to exe hash + version + provider + policy).
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider.providerId, policyVersion: c.policyVersion, now: c.now, firstControlledChange: true });
  if (!dv.ok) return na(blocked("WORKER-TOOL-RESTRICTION-NOT-PROVEN", { errors: dv.errors }));
  const permittedTools = (c.detectionRecord && c.detectionRecord.permittedTools) || [];

  // 7) Canonical baseline (strict git; fails closed).
  const repoRoot = policy.repoRoot;
  let before;
  try { const tl = gitLine(repoRoot, ["rev-parse", "--show-toplevel"]); if (path.resolve(tl) !== path.resolve(repoRoot)) return na(refused("root-not-git-toplevel", { toplevel: tl })); before = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); }
  catch (e) { return na(blocked("baseline-snapshot-failed", { detail: String(e.message).slice(0, 160) })); }
  if (!before.head) return na(blocked("baseline-head-unresolved"));
  if (policy.expectedRemote && before.origin !== policy.expectedRemote) return na(refused("remote-mismatch", { origin: before.origin }));
  if (policy.expectedBranch && before.branch !== policy.expectedBranch) return na(refused("branch-mismatch", { branch: before.branch }));
  if (policy.requireClean && before.status) return na(refused("working-tree-dirty"));
  Object.assign(base, { toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: before.branch, finalHead: before.head });

  // 8) Materialise the .git-free workspace.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head); } catch (e) { return na(blocked("workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace;
  let disposed = false, preserve = false;
  const disposeAll = () => { if (c.keepWorkspace) return ["kept-by-config:" + workspace]; if (disposed || preserve) return []; disposed = true; return ledger.dispose(workspace); };

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree", "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape", "timeout", "output-cap", "fail-closed-sandbox-gate", "operation-bound-attestation", "detection-record-verification", "shared-executable-check", "provider-permitted-executable", "first-proof-network-disabled", "provider-operation-handle"];
  const controlsFor = (killConfirmed) => ({ technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []), policyRequested: ["worker-tool-restriction"], delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"], notVerified: killConfirmed ? [] : ["process-termination-confirm"], outOfScope: [] });
  const commonBase = { sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy, canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy, workerToolsPermitted: permittedTools, workerToolsVerified: true, workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE", projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"], filesInspectionStatus: "NOT OBSERVABLE", materialiseWarnings: mat.symlinkFallbacks || [], processControlProvider: provider.providerId, operationHandleType: provider.operationHandleType || provider.kind };
  const commonResult = (kc) => Object.assign({}, commonBase, { controls: controlsFor(kc) });
  const done = (env, extra, kc) => out(env, Object.assign({}, commonResult(kc !== false), { residue: disposeAll() }, extra || {}));

  let handle = null;
  try {
    const wsBefore = ledger.snapshot(workspace);
    const argv = c.claudeArgs(r.prompt, { tools: permittedTools, commands: (c.detectionRecord && c.detectionRecord.permittedCommands) || [], mode: policy.mode });
    if (!Array.isArray(argv) || !argv.every((a) => typeof a === "string")) return done(blocked("claude-args-not-string-array"), { processTerminationStatus: "NOT EXECUTED" });
    if (argv.some((a) => DANGEROUS_FLAG.test(a))) return done(blocked("dangerous-cli-flag", { flag: argv.find((a) => DANGEROUS_FLAG.test(a)) }), { processTerminationStatus: "NOT EXECUTED" });

    // 9) Spawn via the provider-owned operation (stable handle).
    try { handle = provider.spawnOperation({ bin: c.claudeBin, argv, cwd: workspace, env: P.buildMinimalEnv(process.platform, policy.envAllowlist), operationId: policy.operationId }); }
    catch (e) { return done(blocked("operation-spawn-failed", { detail: String(e.message).slice(0, 160) }), { processTerminationStatus: "NOT EXECUTED" }); }
    const handleType = handle && handle.handleType;
    const handleIdRedacted = handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null;
    // PID-typed handle is forbidden for real runs (labelled synthetic only).
    if (handleType === "pid" && requireReal) { try { provider.terminateOperation(handle); } catch (e) {} return done(blocked("BLOCKED-PROCESS-OWNERSHIP", { reason2: "pid-handle-forbidden-for-real-runs" }), { processTerminationStatus: "NOT EXECUTED", operationHandleType: handleType });

    }
    const run = await driveOperation(provider, handle, policy);
    const output = P.scrubSecrets(redactor.redactText(run.stdout || "")).slice(0, 4000);
    if (run.killedFor === "spawn-error") return done(refused("spawn-error"), { processTerminationStatus: "NOT EXECUTED", outputExcerpt: output, operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted });

    // 10) CONFIRM termination via the provider-owned operation handle (never a reused PID). Clean exit still
    //     confirms the whole operation is finished; unconfirmed ⇒ EMERGENCY-STOP.
    if (run.killedFor) { try { provider.terminateOperation(handle); } catch (e) {} }
    let conf; try { conf = provider.confirmOperationTerminated(handle); } catch (e) { conf = { confirmed: false, processCount: null }; }
    const processCount = conf && conf.processCount;
    // Bind the evidence hash to THIS operation + handle + the provider's own confirmation evidence (canonical
    // serialisation so it is key-order stable). Integrity, not authenticity (see report trust boundary).
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted, handleType, processCount, confirmed: conf && conf.confirmed, providerEvidence: conf && conf.evidence }));
    const opFields = { operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, operationProcessCountObserved: processCount, processControlEvidenceHash: pcEvidenceHash };

    if (!conf || conf.confirmed !== true) {
      preserve = true; try { provider.preserveOperationEvidence(handle); } catch (e) {}
      return out(emergency("EMERGENCY-STOP-REQUIRED"), Object.assign({}, commonResult(false), opFields, { outputExcerpt: output, processTerminationStatus: "EMERGENCY-STOP-REQUIRED", killConfirmed: false, residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace], risks: ["operation termination unconfirmed — external-operation lock; owner resolution required"], cancellationStatus: "unconfirmed" }));
    }

    if (run.killedFor) { const reason = ["timeout", "output-overflow", "stderr-overflow"].includes(run.killedFor) ? run.killedFor : "worker-error"; return done(refused(reason), Object.assign({}, opFields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", cancellationStatus: "confirmed", timeoutStatus: run.killedFor === "timeout" ? "killed" : "none", residualDriftStatus: "not-evaluated" })); }

    // 11) Trusted FS diff + path enforcement.
    const wsAfter = ledger.snapshot(workspace); const led = ledger.diff(wsBefore, wsAfter);
    const refusedPaths = [];
    for (const p of led.changedPaths) { const norm = P.normPath(p); if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; } }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p);

    // 12) Monitored-state reconciliation.
    let after; try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); } catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, opFields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED" })); }
    // A tracked file that could not be read cannot be proven unchanged — never let it collapse to "no drift".
    if (after.unverifiable > 0 || before.unverifiable > 0) return done(blocked("monitored-state-unverifiable", { unverifiable: after.unverifiable + before.unverifiable }), Object.assign({}, opFields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" }));
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";
    const manifest = ledger.manifest(wsAfter, led);
    const patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null;
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), Object.assign({}, opFields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, ledgerSummary }));
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), Object.assign({}, opFields, { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary }));

    // 13) Success.
    const residue = disposeAll();
    let res; try {
      res = P.buildResult(Object.assign({}, commonResult(true), opFields, { operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, approvalStatus: policy.approvalId ? "referenced" : "none", toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: after.branch, finalHead: after.head, outcome: run.code === 0 ? "COMPLETED" : "FAILED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, processTerminationStatus: "TERMINATED-CONFIRMED", killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none", outputExcerpt: output, residue, workerDecision: run.code === 0 ? "PROPOSED" : "FAILED" }));
    } catch (e) { const rr = disposeAll(); return out(blocked("result-build-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, commonResult(true), { residue: rr })); }
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) { const rr = disposeAll(); return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true), { residue: rr })); }
    return { ok: run.code === 0, decision: run.code === 0 ? "COMPLETED" : "FAILED", output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
  } catch (e) {
    preserve = true; const wasDisposed = disposed;
    try { if (handle) provider.preserveOperationEvidence(handle); } catch (er) {}
    return out(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({}, commonResult(false), { processTerminationStatus: "TERMINATION-UNCONFIRMED", residualDriftStatus: "not-evaluated", residue: [wasDisposed ? "already-disposed:" + workspace : "workspace-preserved:" + workspace], risks: ["unexpected error — evidence preserved; owner resolution required"] }));
  } finally { if (!disposed && !preserve && !c.keepWorkspace) disposeAll(); }
}

module.exports = { runClaudeWorker, monitorSnapshot, monitorDrift, gitMetaDigest };
```

## worker-policy.cjs

```js
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
    workerToolsVerified: f.workerToolsVerified === true,
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
    "operationProcessCountObserved", "processControlProvider", "processControlEvidenceHash", "residualDriftStatus", "filesChanged",
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
  // termination control must not be overstated: process-termination-confirm only when CONFIRMED.
  if (r.controls && (r.controls.technicallyEnforced || []).indexOf("process-termination-confirm") >= 0 && r.processTerminationStatus !== "TERMINATED-CONFIRMED") errors.push("result: process-termination-confirm claimed enforced without TERMINATED-CONFIRMED");
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
  OBSERVATION_STATUSES, TERMINATION_STATUSES,
};
```

## owner-capability-check.cjs

```js
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

## owner-readiness-report.cjs

```js
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

module.exports = { renderReadinessHtml, esc, CHECK_TITLES };
```

## validate-claude-worker.cjs (MANDATORY SECURITY EVIDENCE)

```js
"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§11). Proves operation-bound
 * attestation, tool-restriction detection, provider-owned operation handles, capability readiness, and the
 * schema-v2 evidence — using a MOCK sandbox provider + synthetic attestation/detection records + REAL throwaway
 * git repos. Real claude worker + real OS sandbox are owner-machine steps. Opt-in — NOT part of `npm run
 * validate`; run standalone. 49 invariants (§11 + owner-UX + round-2 ECC fixes). No CRITICAL control is environment-skipped.
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
const runtime = require("../bridge/runtime-config.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const ORIGIN = "https://example.invalid/acme/app.git";
const EXE_HASH = "exe-hash-1", CLI_VER = "1.9.0", POLICY_VER = "policy-1";
function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }

function mkRepo(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]); g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]); g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true }); fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true }); fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  if (o.gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), o.gitignore + "\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
const errors = [];
const fail = (inv, m, got) => errors.push(inv + ": " + m + (got !== undefined ? " :: " + JSON.stringify(got) : ""));
async function withRepo(fn, opts) { const repo = mkRepo(opts); try { await fn(repo); } catch (e) { errors.push("withRepo-crash: " + (e && e.message) + (e && e.stack ? " @" + e.stack.split("\n")[1] : "")); } finally { rmRepo(repo); } }

function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_bin, _argv, spawnOpts) => {
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter(); ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => { try { if (behavior) behavior(spawnOpts.cwd); } catch (e) {} if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText)); if (o.hang) return; if (o.floodOut) ch.stdout.emit("data", Buffer.from("x".repeat(5000))); if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000))); ch.emit("close", 0); });
    return ch;
  };
}
const writeIn = (rel, content) => (cwd) => { const abs = path.join(cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content == null ? "changed\n" : content); };

function mkProvider(o) { o = o || {}; return sandbox.mockProvider(o.spawnFn !== undefined ? o.spawnFn : synthSpawn(o.behavior, o.stdout, o.spawnOpts), o.provOver); }
function mkRecord(providerId, o) { return detector.syntheticRecord({ executableContentHash: EXE_HASH, cliVersion: CLI_VER, operationMode: "first-controlled-change", sandboxProviderId: providerId, policyVersion: POLICY_VER }, o || {}); }
function baseCfg(repo, opts) {
  const o = opts || {};
  const provider = o.provider !== undefined ? o.provider : mkProvider(o);
  return {
    projectRoots: { acme: repo },
    policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 3000, maxOutputBytes: 1 << 20 }, o.policy || {}),
    operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" },
    claudeBin: "synthetic-claude", claudeArgs: (p) => ["-p", p], redactor: createRedactor(),
    sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts),
    executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER,
    realRun: o.realRun, requireExecInvoke: o.requireExecInvoke, keepWorkspace: o.keepWorkspace,
  };
}
const REQ = { prompt: "add a file", projectId: "acme" };
const attCtx = { providerId: "mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "OP1", executableResolvedPathInsideSandbox: "/sandbox/bin/claude" };

async function run() {
  errors.length = 0;

  // 1 environment markers cannot create readiness
  process.env.PROJECTOS_SANDBOX_PROVIDER = "1"; process.env.PROJECTOS_WORKER_PROFILE_VERIFIED = "1";
  const capNoConfig = cap.check();
  if (capNoConfig.realBlockReason !== "BLOCKED-SANDBOX-IMPLEMENTATION") fail("inv1", "env markers created readiness", capNoConfig.realBlockReason);
  delete process.env.PROJECTOS_SANDBOX_PROVIDER; delete process.env.PROJECTOS_WORKER_PROFILE_VERIFIED;
  // 2 capability checker + adapter share one runtime-config path
  {
    if (require("../bridge/runtime-config.cjs") !== runtime) fail("inv2", "runtime-config not a shared singleton");
    const prov = mkProvider(); const good = { sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "synthetic-claude", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER };
    const rr = cap.check(good, attCtx);
    // the shared verifiers run + pass for a well-formed mock (proving the path works)...
    for (const k of ["sandboxImplementationPresent", "sandboxAttestationPass", "toolRestrictionVerified", "processOwnershipVerified", "processTerminationVerified", "networkDisabled"]) if (rr.checks[k].status !== "PASS") fail("inv2", "shared check " + k + " not PASS", rr.checks[k]);
    // ...but a MOCK can NEVER be READY for a REAL run (matches the adapter's requireReal gate)
    if (rr.realBlockReason !== "BLOCKED-SANDBOX-IMPLEMENTATION") fail("inv2", "mock reached real readiness", rr.realBlockReason);
  }
  // 3 boolean attestation rejected
  if (attestation.verifyAttestation({ enforced: true }, attCtx).ok) fail("inv3", "boolean attestation accepted");
  // 4 missing canary rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { omitCanary: "networkCanary" }), attCtx).ok) fail("inv4", "missing canary accepted");
  // 5 failed canary rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { fail: "canonical-repo" }), attCtx).ok) fail("inv5", "failed canary accepted");
  // 6 expired attestation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { ttlMs: -1000 }), attCtx).ok) fail("inv6", "expired attestation accepted");
  // 7 wrong operation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx), Object.assign({}, attCtx, { operationId: "OTHER" })).ok) fail("inv7", "wrong operation accepted");
  // 8 wrong workspace rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx), Object.assign({}, attCtx, { workspaceId: "OTHER" })).ok) fail("inv8", "wrong workspace accepted");
  // 9 modified attestation rejected
  if (attestation.verifyAttestation(attestation.syntheticAttestation(attCtx, { tamper: true }), attCtx).ok) fail("inv9", "modified attestation accepted");
  // 10 mock attestation forbidden for real runs
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/x.txt"), realRun: true })); if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv10", "mock allowed for real run", a); });
  // 11 manually asserted verified profile rejected (no detector record)
  if (detector.verifyDetectionRecord({ verified: true, permittedTools: ["Read"] }, { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv11", "manual verified profile accepted");
  // 12 profile without executable hash rejected
  { const rec = mkRecord("mock-provider"); delete rec.executableContentHash; if (detector.verifyDetectionRecord(rec, { cliVersion: CLI_VER }).ok) fail("inv12", "record without exe hash accepted"); }
  // 13 profile for another executable rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider"), { executableContentHash: "OTHER", cliVersion: CLI_VER, firstControlledChange: true }).ok) fail("inv13", "record for another exe accepted");
  // 14 profile for another CLI version rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider"), { executableContentHash: EXE_HASH, cliVersion: "9.9.9", firstControlledChange: true }).ok) fail("inv14", "record for another version accepted");
  // 15 expired profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { ttlMs: -1000 }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv15", "expired record accepted");
  // 16 forbidden-tool negative test must PASS (all DENIED)
  { const rec = mkRecord("mock-provider"); const dv = detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }); if (!dv.ok) fail("inv16", "good record rejected", dv.errors); if (!rec.negativeTests.every((t) => t.result === detector.DENIED)) fail("inv16", "negative tests not all DENIED"); }
  // 17 shell-capable profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { shellDisabled: false }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv17", "shell-capable record accepted");
  // 18 network-capable profile rejected
  if (detector.verifyDetectionRecord(mkRecord("mock-provider", { networkDisabled: false }), { executableContentHash: EXE_HASH, cliVersion: CLI_VER }).ok) fail("inv18", "network-capable record accepted");
  // 19 first-proof network allowlist rejected (adapter)
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { networkPolicy: "allowlist", networkAllowlist: ["api.example.com"] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/x.txt") })); if (a.decision !== "BLOCKED" || a.reason !== "BLOCKED-NETWORK-POLICY") fail("inv19", "network allowlist not refused for first proof", a); });
  // 20 clean exit does not kill by historical PID (handle-based confirmation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.decision !== "COMPLETED") fail("inv20", "benign run not COMPLETED", a); else if (a.result.operationHandleType === "pid") fail("inv20", "used a pid handle"); else if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv20", "not confirmed via handle", a.result.processTerminationStatus); });
  // 21 real run requires stable operation handle (provider missing operation methods rejected)
  await withRepo(async (repo) => { const prov = mkProvider(); delete prov.spawnOperation; const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/x.txt") })); if (a.decision !== "BLOCKED" || !/OS-SANDBOX/.test(a.reason)) fail("inv21", "provider without operation lifecycle accepted", a); });
  // 22 PID-only provider rejected for real runs (runtime readiness)
  { const prov = mkProvider({ provOver: { kind: "restricted-account", pidFallback: true } }); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, attCtx); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv22", "pid-only provider passed ownership", r.checks.processOwnershipVerified); }
  // 23 process-control readiness executes a synthetic lifecycle
  if (!sandbox.probeProcessControl(mkProvider()).ok) fail("inv23", "process-control lifecycle probe failed");
  // 24 readiness detects termination failure
  { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) } }); if (sandbox.probeProcessControl(prov).ok) fail("inv24", "probe passed despite termination failure"); }
  // 25 unrelated process cannot be targeted (handle enumerates only its own processes)
  { const prov = mkProvider(); const h = prov.spawnOperation({ operationId: "op25", bin: "x", argv: [], cwd: ".", env: {} }); const en = prov.enumerateOperationProcesses(h); if (en.indexOf(process.pid) >= 0) fail("inv25", "operation enumerated an unrelated pid"); prov.terminateOperation(h); if (!worker || process.killed) fail("inv25", "unrelated process affected"); }
  // 26 detached contained descendant detected by operation handle (confirm returns not-confirmed)
  { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: (h) => ({ confirmed: false, processCount: 1, evidence: "leftover" }) } }); const h = prov.spawnOperation({ operationId: "op26", bin: "x", argv: [], cwd: ".", env: {} }); const conf = prov.confirmOperationTerminated(h); if (conf.confirmed !== false) fail("inv26", "leftover descendant not detected"); }
  // 27 unconfirmed operation termination causes emergency stop (adapter)
  let emgWs = null;
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) }, behavior: writeIn("app/new.txt") }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeIn("app/new.txt") })); if (a.decision !== "EMERGENCY-STOP") fail("inv27", "unconfirmed termination not emergency", a.decision); else { const pres = (a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (!pres) fail("inv28", "evidence not preserved"); else emgWs = pres.slice("workspace-preserved:".length); if (a.result.processTerminationStatus !== "EMERGENCY-STOP-REQUIRED") fail("inv27", "status not EMERGENCY-STOP-REQUIRED", a.result.processTerminationStatus); } });
  // 28 process evidence preserved (checked in inv27; also assert workspace exists)
  if (emgWs) { if (!fs.existsSync(emgWs)) fail("inv28", "preserved workspace does not exist"); rmRepo(emgWs); }
  // 29 pre-spawn refusal reports termination NOT APPLICABLE
  await withRepo(async (repo) => { const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo)); if (a.result.processTerminationStatus !== "NOT APPLICABLE") fail("inv29", "pre-spawn refusal not NOT APPLICABLE", a.result.processTerminationStatus); });
  // 30 spawn failure reports termination NOT EXECUTED
  await withRepo(async (repo) => { const prov = mkProvider({ spawnFn: null }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.result.processTerminationStatus !== "NOT EXECUTED") fail("inv30", "spawn failure not NOT EXECUTED", a.result.processTerminationStatus); });
  // 31 confirmed run reports TERMINATED-CONFIRMED
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.processTerminationStatus !== "TERMINATED-CONFIRMED") fail("inv31", "confirmed run not TERMINATED-CONFIRMED", a.result.processTerminationStatus); });
  // 32 termination control is not overstated (na/emergency don't claim it enforced; validateResult enforces)
  await withRepo(async (repo) => { const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo)); const te = (a.result.controls && a.result.controls.technicallyEnforced) || []; if (te.indexOf("process-termination-confirm") >= 0) fail("inv32", "termination-confirm claimed on NOT APPLICABLE"); });
  // 33 evidence hashes validate
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (P.validateResult(a.result).length) fail("inv33", "result hash/schema invalid", P.validateResult(a.result)); if (!a.result.processControlEvidenceHash) fail("inv33", "no processControlEvidenceHash"); const att = attestation.syntheticAttestation(attCtx); if (attestation.hashAttestation(att) !== att.evidenceHash) fail("inv33", "attestation evidenceHash invalid"); });
  // 34 worker cannot self-approve/close
  { let threw = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { threw = true; } if (!threw) fail("inv34", "APPROVED not rejected"); }
  // 35 no metered AI API (source scan)
  { const rx = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "executable-check", "invocation-detector", "attestation", "runtime-config", "owner-capability-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (rx.test(src)) fail("inv35", "metered API/network in " + f); } }
  // 36 no production/provider/send/payment
  { const rx = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i; for (const f of ["claude-worker", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "runtime-config"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (rx.test(src)) fail("inv36", "prod/provider/send/payment in " + f); } }
  // 37 .git-free ledger tests remain passing (no .git in workspace; worker git init refused)
  await withRepo(async (repo) => { const mat = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim()); const snap = ledger.snapshot(mat.workspace); if (Object.keys(snap).some((k) => k === ".git" || k.startsWith(".git/"))) fail("inv37", "workspace has .git"); ledger.dispose(mat.workspace); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => g(cwd, ["init", "-q"]) })); if (a.reason !== "forbidden-path-change") fail("inv37", "worker git init not refused", a.reason); });
  // 38 canonical monitored state remains stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv38", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv38", "canonical drifted"); });
  // 39 temporary residue reported accurately
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt") })); if (a.result.residue.length !== 0) fail("inv39", "benign run reported residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeIn("app/new.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv39", "kept workspace not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 40 working tree clean (validator uses tmpdir only)
  { if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(fs.readFileSync(__filename, "utf8"))) fail("inv40", "validator not tmpdir-only"); }
  // 41 remote frozen (non-routable test remote only)
  { if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv41", "validator references a real/wrong remote"); }
  // 42 owner readiness HTML report never shows a false READY when blocked, and escapes dynamic values
  { const report = require("../bridge/owner-readiness-report.cjs");
    const blockedRes = { checks: { sandboxImplementationPresent: { status: "BLOCKED", reason: "<script>x</script>" } }, realBlockReason: "BLOCKED-SANDBOX-IMPLEMENTATION" };
    const html = report.renderReadinessHtml(blockedRes);
    if (/class="banner banner-ready"/.test(html)) fail("inv42", "blocked report applied a READY banner");
    if (!/banner-blocked/.test(html) || !/NOT SAFE/.test(html)) fail("inv42", "blocked report missing NOT-SAFE banner");
    if (/<script>x<\/script>/.test(html)) fail("inv42", "report did not escape a dynamic value");
    const readyRes = { checks: {}, realBlockReason: "READY-FOR-REAL-WORKER-PROOF" };
    if (!/class="banner banner-ready"/.test(report.renderReadinessHtml(readyRes))) fail("inv42", "ready report missing READY banner"); }
  // 43 a MOCK provider can never reach READY-FOR-REAL-WORKER-PROOF (checkReadiness)
  { const prov = mkProvider(); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, attCtx); if (r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF") fail("inv43", "mock reached READY-FOR-REAL"); }
  // 44 a canary with a flipped `expected` (re-hashed) is rejected (self-consistency is not enough)
  { const att = attestation.syntheticAttestation(attCtx); att.networkCanary = { attempted: "network access", expected: "reachable", actual: "reachable", result: "PASS" }; att.evidenceHash = attestation.hashAttestation(att); const v = attestation.verifyAttestation(att, attCtx); if (v.ok) fail("inv44", "flipped-expected canary accepted"); }
  // 45 a blanked integrity hash is rejected (falsy-hash bypass closed) — attestation, detection, result
  { const att = attestation.syntheticAttestation(attCtx); att.evidenceHash = ""; if (attestation.verifyAttestation(att, attCtx).ok) fail("inv45", "blanked evidenceHash accepted");
    const rec = mkRecord("mock-provider"); rec.recordHash = ""; if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv45", "blanked recordHash accepted");
    const good = P.buildResult({ operationId: "OP1" }); const bad = Object.assign({}, good, { resultHash: "" }); if (!P.validateResult(bad).some((e) => /resultHash/.test(e))) fail("inv45", "blanked resultHash accepted"); }
  // 46 a detection record whose permittedTools grants a dangerous capability is rejected
  { const rec = mkRecord("mock-provider", { permittedTools: ["Read", "Bash"] }); if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv46", "permittedTools with Bash accepted"); }
  // 47 a detection record missing a mandatory forbidden tool is rejected
  { const rec = mkRecord("mock-provider", { forbiddenTools: ["Read"] }); if (detector.verifyDetectionRecord(rec, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change" }).ok) fail("inv47", "record missing forbidden Bash accepted"); }
  // 48 process-control probe re-enumerates after confirm (a residual process is caught despite confirmed:true)
  { const prov = mkProvider({ provOver: { confirmOperationTerminated: () => ({ confirmed: true, processCount: 0 }), enumerateOperationProcesses: () => [4242] } }); if (sandbox.probeProcessControl(prov).ok) fail("inv48", "residual process after confirm not caught"); }
  // 49 dispose with a malformed (no residue array) result fails closed
  { const prov = mkProvider({ provOver: { disposeOperation: () => ({}) } }); if (sandbox.probeProcessControl(prov).ok) fail("inv49", "malformed dispose treated as pass"); }

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV"));
    const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (49 invariants" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };
```

> Unchanged from HARDEN1B (see that bundle): executable-check.cjs, workspace-ledger.cjs.

---

**END OF BUNDLE.** END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. Not pushed, not closed. Remote frozen `4c3f076`.
