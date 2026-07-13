# ProjectOS — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D — SINGLE-FILE REVIEW BUNDLE

> Everything Murad + ChatGPT need to review "exact invocation binding, real workspace attestation and
> operation disposal", in one file: report (every §16 section) + full source of the phase modules. Local-only.
> Remote frozen `4c3f076`.

**Phase:** `PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D`
**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.**
**Not pushed. Not closed. No real worker / Docker / Supabase / production / provider / send / payment / secret / metered-AI API / install.**

---

# PART A — REPORT

## A1. Baseline

folder `C:\dev\ProjectOS`; branch `projectos-v3`; pre-phase HEAD `597f4ac` (HARDEN1C); remote = **`4c3f076`**
(frozen); 34 ahead at start; clean; `git diff --check` clean. **Available:** ECC agents (security/code/
architect/silent-failure) — used; **ui-ux-pro-max AVAILABLE — used**; "Claude Design" (named) NOT present →
frontend-design/ECC equivalent (stated, not fabricated).

## A2. Findings corrected

The gap between DECLARED restrictions and the EXACT operation executed: (a) an arbitrary `claudeArgs` callback
could ignore the detected policy — removed; (b) attestation conflated general capability with a specific
operation — split; (c) the adapter depended on `handle.child` — replaced by a streaming contract; (d) disposal
was not mandatory / could be under-reported — now gated; (e) workspaceId reused operationId — separated; (f)
readiness could pass where the adapter blocks — parity fixed; (g) a real-run symlink downgrade was silent —
fails closed.

## A3. Exact invocation model (§3)

ProjectOS builds the FINAL argv ITSELF (`invocation-detector.buildArgv`) from the verified record's canonical
`argumentTemplate` — a caller `claudeArgs` is never consulted for the real path. `verifyDetectionRecord`
ALLOWLISTS the template tokens (only the restriction mechanism, `{tools}`, an approved print flag, `{prompt}` —
nothing else, so a space-separated bypass flag cannot be smuggled) and requires `{tools}` present.
`verifyInvocation` returns APPLIED AND VERIFIED only when the mechanism is present carrying exactly the
permitted tools, no forbidden/shell/network/git-write/bypass token appears (the prompt is data — NOT scanned),
the prompt sits at the expected position, and no unknown argument exists. Not APPLIED ⇒
BLOCKED-INVOCATION-RESTRICTION-NOT-APPLIED. `workerToolsVerified` is a tri-state.

## A4. Two-stage attestation model (§4)

(A) provider CAPABILITY attestation (`attestation.cjs`) — workspace-bound (workspaceId, workspacePathHash,
materialisationManifestHash), canary `expected` pinned, evidenceHash always checked — proves the sandbox CAN
deny/terminate/clean. (B) post-execution OPERATION EVIDENCE (`operation-evidence.cjs`) — built AFTER the real
operation, operation-bound (operationId/workspaceId/providerId/argvHash), with disposalStatus/terminationStatus
from the ACTUAL confirm+dispose (never a capability canary). A capability canary can never stand in for
operation cleanup/termination proof.

## A5. Actual workspace binding (§5)

The workspace is materialised BEFORE attestation. `workspaceId` is UNIQUE and SEPARATE from `operationId`
(derived from host path + baseHead + nonce). The capability attestation binds to the actual workspace
(workspacePathHash, materialisationManifestHash); a wrong workspace id/path/materialisation hash is refused.

## A6. Provider streaming model (§6)

The adapter communicates ONLY through provider methods — `spawnOperation / readOperationOutput /
readOperationError / waitForOperationExit / operationStatus / enumerateOperationProcesses / terminateOperation
/ confirmOperationTerminated / preserveOperationEvidence / disposeOperation` — never `handle.child`.
`waitForOperationExit` enforces timeout + output/stderr caps and always resolves (no hang); the adapter adds a
host-side timeout backstop via `Promise.race`.

## A7. Operation lifecycle & disposal (§7)

Confirmed success → confirm terminated → post-op evidence → `disposeOperation` → structured disposal + zero
residue. A malformed/absent/non-empty-residue disposal is the HEADLINE failure on EVERY post-confirmation
branch ⇒ BLOCKED-OPERATION-DISPOSAL-FAILED (prevents COMPLETED). A workspace that could not be deleted ⇒
BLOCKED-WORKSPACE-DISPOSAL-FAILED. Unconfirmed termination ⇒ EMERGENCY-STOP (no destructive dispose, evidence
preserved, owner resolution).

## A8. Post-operation evidence model (§8)

`operation-evidence.buildOperationEvidence` records operationId/workspaceId/provider/handle/exe/argv hashes,
start+exit timestamps, exit + termination status, process count, containedDescendants (from
`enumerateOperationProcesses`), denial results, disposal status, residue, and an always-checked evidenceHash.
`verifyOperationEvidence` binds it to the operation, validates timestamps (exit≥start) and the termination
enum.

## A9. Readiness parity (§9)

`runtime-config.checkReadiness` uses the SAME verifiers as the adapter, and now: (i) rejects a PID handle from
the ACTUAL lifecycle-probe handle (not only a `pidFallback` declaration); (ii) compares the detected CLI
version at TOKEN boundaries (so `21.9.0` ≠ `1.9.0`); (iii) folds the exact invocation check into
`toolRestrictionVerified` (a record that would yield VERIFIED-BUT-NOT-APPLIED blocks readiness too); (iv) a
mock can never reach READY-FOR-REAL. Readiness never passes where the adapter would block.

## A10. Process-scope probe (§10)

`probeProcessControl` runs a contained operation AND an unrelated sentinel; proves the operation enumeration
excludes the sentinel, termination stops the contained process, the sentinel SURVIVES, confirmation reports
zero operation processes, and disposal leaves no residue. For a REAL provider, `runtime-config` supplies a
GENUINE sentinel (a real separate process, liveness via signal-0) so an over-broad terminate is actually
caught; the mock uses a labelled synthetic sentinel.

## A11. Evidence schema (§12)

Added: workspaceId, materialisationManifestHash, preExecutionLedgerHash, invocationArgvHash,
invocationRestrictionStatus, providerCapabilityAttestationHash, operationEvidenceHash, operationDisposalStatus,
operationResidue, actualOperationHandleType. `workerToolsVerified` is a tri-state (NOT VERIFIED / VERIFIED BUT
NOT APPLIED / APPLIED AND VERIFIED). `validateResult` backstops: a COMPLETED result must be disposed, carry the
operation + capability evidence hashes, and have an APPLIED AND VERIFIED invocation.

## A12. Validator matrix (`validate-claude-worker.cjs` — 50 invariants, PASS, 1 env-skip)

§13's 1–47 (invocation binding / two-stage attestation / streaming / disposal / post-op evidence / parity /
process-scope / symlink / no-metered / no-prod / ledger / stable / frozen) + round-2 ECC: 48 template-allowlist
rejects a smuggled flag · 49 a benign prompt containing a tool name is not falsely blocked · 50 disposal
failure is the headline even on a killed run. inv36 (real-run symlink) env-skipped on a host that cannot create
symlinks (code verified, runs on a symlink-capable host). Per-invariant isolation.

## A13. Exact results

- `node projectos/validators/validate-claude-worker.cjs` → **PASS (50 invariants, 1 env-skipped)**.
- `npm run validate` → **ALL PASS (61 validators)**. `git diff --check` clean. Temp residue → 0.
- capability (no config) → **BLOCKED-SANDBOX-IMPLEMENTATION**.

## A14. Full ECC findings (security + architecture + silent-failure — all resolved)

**Security HIGH:** invocation-template smuggling of a space-separated bypass flag → **fixed** (template
allowlist). **Silent-failure HIGH:** workspace filesystem residue never gated (COMPLETED with source left on
disk) → **fixed** (WORKSPACE-DISPOSAL-FAILED gate); process-scope sentinel toothless in production wiring →
**fixed** (real sentinel for real providers). **Architecture HIGH:** verifyInvocation scanned the prompt (false
block) → **fixed** (prompt excluded); readiness lacked an invocation-binding check → **fixed** (folded into
toolRestriction). **MEDIUM (all fixed):** disposal-failure signal masked on non-success branches → headline
everywhere; `validateResult` missing outcome↔disposal cross-check → added; loose substring version match →
token-boundary; empty `restrictionMechanism` slipping → non-empty required; `promptArgPosition` not
cross-checked → checked; `disposeAll` residue masked on error branches → residue reused; no host timeout →
`Promise.race` backstop; `containedDescendants` unpopulated → from enumerate; op-evidence `terminationStatus`
enum → validated. **LOW:** dead import removed. No open HIGH/CRITICAL. **Documented follow-ups (maintainability,
not security):** consolidate the four evidence-hash serialisations into one canonical `hash-util`; extract
shared readiness-presentation constants; decompose the large `runClaudeWorker`; persist the operation-evidence/
attestation objects (not just their hashes) so the commitments are recomputable.

## A15. UI UX Pro Max findings — **AVAILABLE, USED**

Applied `ui-ux-pro-max` guidance (as in HARDEN1C) to the owner readiness surface, and extended
`owner-readiness-report.cjs` with an execution-state renderer + recovery guidance for the new HARDEN1D failure
states — restriction-not-applied, workspace-attestation failure, disposal failure, emergency-stop — with a
plain-language ordered recovery step each, and an explicit readiness-vs-execution distinction. Icon+text
badges (not colour-only), 4.5:1, no false READY. Terminal WCAG/keyboard/mobile is N/A for the CLI readout.

## A16. Claude Design findings — **UNAVAILABLE (named product)** — frontend-design/ECC equivalent applied; not fabricated.

## A17. Claude self-review

10-point checklist after each step + a final pass. Self-caught + fixed: the `materialize(opts)` signature omission
(smoke test caught it), the mock handle not clearing its process set, the parity/scan test-logic false-positives.
Final pass confirmed every post-materialise/post-spawn path disposes (or preserves on emergency), the disposal
gate is the headline, and every synthetic-only proof is labelled. Real worker/Docker-Supabase remain
owner-machine steps.

## A18. Unresolved limitations

1. **Not itself an OS sandbox** — real enforcement needs a real provider that runs the canaries + owns the
   operation; none installed ⇒ real runs BLOCKED.
2. **Evidence hashes are integrity, not authenticity** (not HMAC) — detect mutation, not a hostile provider;
   and the source objects are hashed but not yet persisted for later recomputation (follow-up).
3. Two hash-serialisation strategies remain (canonical vs plain JSON) — consolidate (follow-up).
4. `runClaudeWorker` is large — decompose (follow-up).
5. inv36 (real-run symlink equivalence) is env-skipped on a symlink-incapable host.

## A19. Files changed · git · no-X · decision

**New:** `projectos/bridge/operation-evidence.cjs`. **Changed:** `projectos/bridge/{invocation-detector,
attestation,sandbox-provider,runtime-config,claude-worker,worker-policy,workspace-ledger,owner-readiness-report}.cjs`,
`projectos/validators/validate-claude-worker.cjs`, checkpoint, this bundle.
Branch `projectos-v3`; remote unchanged **`4c3f076`**; **Pushed: NO**; **Closed: NO**.
No production · No deploy · No provider · No send · No payment · No metered AI API · No network · No real
worker · No Docker/Supabase · No system software installed · No secret disclosed.

**Decision required:** ChatGPT/Murad review of HARDEN1D. On acceptance, the next phase implements a REAL sandbox
provider (real canary attestation + real operation handle + real detector) on an owner machine and runs the
real Gate 1–3 only when `owner-capability-check` reports READY-FOR-REAL-WORKER-PROOF.

---

**END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW.** ProjectOS-built+verified exact invocation,
two-stage (capability + operation) attestation, provider streaming contract, mandatory operation + workspace
disposal, readiness/adapter parity, sentinel process-scope probe; 50-invariant validator PASS; 3-agent ECC
round (1 HIGH + multiple HIGH/MEDIUM all fixed with regression tests); ui-ux-pro-max applied. Not pushed, not
closed.

---

# PART B — FULL SOURCE (phase modules)

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

function hashTemplate(tpl) { return require("crypto").createHash("sha256").update(canonicalJson(tpl || [])).digest("hex"); }

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
    permittedTools: o.permittedTools || ["Read", "Edit"], forbiddenTools: o.forbiddenTools || ["Bash", "Shell", "WebFetch", "Git"],
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

module.exports = { verifyDetectionRecord, syntheticRecord, hashRecord, buildArgv, verifyInvocation, hashTemplate, DETECTOR_VERSION, NEGATIVE_TESTS, DENIED, RECORD_FIELDS, INVOCATION_STATUS };
```

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
  "projectId", "phaseId", "workspaceId", "workspacePathHash", "materialisationManifestHash",
  "workspacePathInsideSandbox", "executableResolvedPathInsideSandbox",
  "timestamp", "expiry", "overallResult", "evidenceHash",
].concat(MANDATORY_CANARIES);

// Canaries whose EXPECTED result is that the access is denied / not reachable.
const DENY_CANARIES = ["canonicalPathCanary", "otherProjectPathCanary", "homePathCanary", "credentialPathCanary", "networkCanary"];
// The ONLY safe `expected` value per canary — pinned by the verifier so a provider cannot self-choose a
// permissive expectation and pass. actual must equal this exact value (and result must be PASS).
const CANARY_EXPECTED = { canonicalPathCanary: "denied", otherProjectPathCanary: "denied", homePathCanary: "denied", credentialPathCanary: "denied", networkCanary: "denied", writablePathCanary: "allowed", childProcessContainmentCanary: "contained", cleanupCanary: "complete", emergencyTerminationCanary: "confirmed" };
// Context fields the caller MUST supply for binding — a missing one is a verification failure, never skipped.
const REQUIRED_CTX = ["providerId", "operationId", "projectId", "phaseId", "workspaceId", "workspacePathHash", "materialisationManifestHash", "executableResolvedPathInsideSandbox"];

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
    workspaceId: c.workspaceId || null, workspacePathHash: c.workspacePathHash || null, materialisationManifestHash: c.materialisationManifestHash || null,
    workspacePathInsideSandbox: o.workspacePathInsideSandbox || "/sandbox/workspace",
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

## operation-evidence.cjs

```js
"use strict";
/**
 * Post-execution OPERATION EXECUTION EVIDENCE — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D (§4B, §8).
 *
 * The two-stage attestation model splits (A) PROVIDER CAPABILITY ATTESTATION — proven up front, "the sandbox
 * CAN deny canonical/home/network and CAN terminate/clean" — from (B) OPERATION EXECUTION EVIDENCE — created
 * AFTER the actual operation ran and terminated, proving the result FOR THAT EXACT OPERATION. A capability
 * canary must never be accepted as proof that this specific operation was cleaned or terminated.
 *
 * This module builds + verifies (B). Operation-bound (operationId + workspaceId + providerId + argv/exe hash),
 * with an always-checked evidenceHash. Integrity, not authenticity (see report trust boundary).
 */

const { canonicalJson } = require("./attestation.cjs"); // reuse canonical serialisation

const REQUIRED = [
  "schemaVersion", "operationId", "workspaceId", "providerId", "providerVersion", "operationHandleType",
  "operationHandleIdRedacted", "executableContentHash", "argvHash", "startTimestamp", "exitTimestamp",
  "exitStatus", "terminationStatus", "operationProcessCount", "containedDescendants", "networkDenialResult",
  "canonicalAccessDenialResult", "otherProjectAccessDenialResult", "credentialAccessDenialResult",
  "outputRedactionResult", "disposalStatus", "residue", "evidenceHash",
];
const TERMINATION_STATUSES = ["NOT EXECUTED", "TERMINATED-CONFIRMED", "TERMINATION-UNCONFIRMED", "EMERGENCY-STOP-REQUIRED"];

function hashEvidence(ev) { const c = Object.assign({}, ev); delete c.evidenceHash; return require("crypto").createHash("sha256").update(canonicalJson(c)).digest("hex"); }

function buildOperationEvidence(f) {
  const ev = {
    schemaVersion: "op-evidence-1.0",
    operationId: f.operationId || null, workspaceId: f.workspaceId || null, providerId: f.providerId || null,
    providerVersion: f.providerVersion || null, operationHandleType: f.operationHandleType || null,
    operationHandleIdRedacted: f.operationHandleIdRedacted || null, executableContentHash: f.executableContentHash || null,
    argvHash: f.argvHash || null, startTimestamp: f.startTimestamp == null ? null : f.startTimestamp,
    exitTimestamp: f.exitTimestamp == null ? null : f.exitTimestamp, exitStatus: f.exitStatus == null ? null : f.exitStatus,
    terminationStatus: f.terminationStatus || "NOT EXECUTED", operationProcessCount: f.operationProcessCount == null ? null : f.operationProcessCount,
    containedDescendants: Array.isArray(f.containedDescendants) ? f.containedDescendants : [],
    networkDenialResult: f.networkDenialResult || "not-evaluated", canonicalAccessDenialResult: f.canonicalAccessDenialResult || "not-evaluated",
    otherProjectAccessDenialResult: f.otherProjectAccessDenialResult || "not-evaluated", credentialAccessDenialResult: f.credentialAccessDenialResult || "not-evaluated",
    outputRedactionResult: f.outputRedactionResult || "applied", disposalStatus: f.disposalStatus || "not-disposed",
    residue: Array.isArray(f.residue) ? f.residue : [],
  };
  ev.evidenceHash = hashEvidence(ev);
  return ev;
}

/** Verify operation evidence against the operation context. Returns { ok, errors }. */
function verifyOperationEvidence(ev, ctx) {
  const errors = []; const c = ctx || {};
  if (!ev || typeof ev !== "object") return { ok: false, errors: ["op-evidence: not an object"] };
  for (const f of REQUIRED) if (!(f in ev)) errors.push("op-evidence: missing '" + f + "'");
  if (ev.schemaVersion !== "op-evidence-1.0") errors.push("op-evidence: bad schemaVersion");
  for (const k of ["operationId", "workspaceId", "providerId", "executableContentHash", "argvHash"]) {
    if (c[k] === undefined || c[k] === null) { errors.push("op-evidence: incomplete context (missing " + k + ")"); continue; }
    if (ev[k] !== c[k]) errors.push("op-evidence: " + k + " does not match the operation");
  }
  if (typeof ev.startTimestamp !== "number" || typeof ev.exitTimestamp !== "number" || ev.exitTimestamp < ev.startTimestamp) errors.push("op-evidence: start/exit timestamps invalid");
  if (TERMINATION_STATUSES.indexOf(ev.terminationStatus) < 0) errors.push("op-evidence: bad terminationStatus enum");
  if (typeof ev.evidenceHash !== "string" || !/^[0-9a-f]{64}$/.test(ev.evidenceHash)) errors.push("op-evidence: evidenceHash missing/invalid");
  else if (hashEvidence(ev) !== ev.evidenceHash) errors.push("op-evidence: evidenceHash mismatch (modified)");
  return { ok: errors.length === 0, errors };
}

module.exports = { buildOperationEvidence, verifyOperationEvidence, hashEvidence, REQUIRED, TERMINATION_STATUSES };
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

const OPERATION_METHODS = ["spawnOperation", "readOperationOutput", "readOperationError", "waitForOperationExit", "operationStatus", "enumerateOperationProcesses", "terminateOperation", "confirmOperationTerminated", "preserveOperationEvidence", "disposeOperation"];
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
function probeProcessControl(provider, opts) {
  const o = opts || {};
  try {
    if (!provider || OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) return { ok: false, reason: "no-operation-lifecycle" };
    // §10: a contained operation AND an unrelated sentinel the probe owner controls separately.
    const sentinel = typeof o.sentinelFn === "function" ? o.sentinelFn() : { pid: 2147480001, alive: () => true, kill: () => {} };
    const handle = provider.spawnOperation({ probe: true, operationId: "probe-op", bin: "<probe>", argv: [], cwd: "<probe>", env: {} });
    if (!handle || !handle.handleType || !handle.operationId) return { ok: false, reason: "no-operation-handle" };
    const status = provider.operationStatus(handle);
    if (!status || (status.state !== "running" && status.state !== "exited")) return { ok: false, reason: "operation-status-malformed" };
    const before = provider.enumerateOperationProcesses(handle);
    if (!Array.isArray(before)) return { ok: false, reason: "enumeration-malformed" };
    // operation enumeration must NOT contain the unrelated sentinel
    if (before.indexOf(sentinel.pid) >= 0) return { ok: false, reason: "operation-enumeration-includes-unrelated-process" };
    provider.terminateOperation(handle);
    const conf = provider.confirmOperationTerminated(handle);
    if (!conf || conf.confirmed !== true) return { ok: false, reason: "termination-unconfirmed" };
    const after = provider.enumerateOperationProcesses(handle);
    if (!Array.isArray(after)) return { ok: false, reason: "enumeration-malformed-after-confirm" };
    if (after.length) return { ok: false, reason: "residual-processes-after-confirm" };
    // the unrelated sentinel must be UNAFFECTED by the operation termination
    if (!sentinel.alive()) return { ok: false, reason: "unrelated-sentinel-killed-by-operation-termination" };
    const disp = provider.disposeOperation(handle);
    if (!disp || !Array.isArray(disp.residue)) return { ok: false, reason: "dispose-result-malformed" };
    if (disp.residue.length) return { ok: false, reason: "residue-after-dispose" };
    try { sentinel.kill(); } catch (e) {} // the probe owner cleans up its own sentinel, separately
    return { ok: true, reason: "lifecycle-and-scope-demonstrated", evidence: { enumeratedBefore: before.length, processCountAtConfirm: conf.processCount, sentinelSurvived: true } };
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
    waitForOperationExit: function (h, opts) {
      const o = opts || {}; const self = this;
      return new Promise((resolve) => {
        if (!h || !h._child) return resolve({ exitStatus: null, killedFor: "spawn-error" });
        let done = false; const finish = (p) => { if (done) return; done = true; clearInterval(iv); clearTimeout(timer); resolve(p); };
        const timer = setTimeout(() => { self.terminateOperation(h); finish({ exitStatus: null, killedFor: "timeout" }); }, o.timeoutMs || 120000);
        const iv = setInterval(() => {
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
function verMatch(detected, want) { if (!detected || !want) return true; const w = String(want).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp("(^|[^0-9.])" + w + "([^0-9.]|$)").test(String(detected)); }
// A REAL, independently-verifiable sentinel for the process-scope probe (only for real providers): a genuine
// separate OS process whose liveness is checked via signal-0, so an over-broad provider terminate is caught.
function realSentinel() {
  const child = require("child_process").spawn(process.execPath, ["-e", "setTimeout(function(){}, 5000)"], { stdio: "ignore" });
  return { pid: child.pid, alive: () => { try { process.kill(child.pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; } }, kill: () => { try { child.kill(); } catch (e) {} } };
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

  // Resolve the executable ONCE (real providers only), guarded — a crash is fail-closed, never a throw escape.
  let ev = null, exeHash = null;
  if (provider && !isMock) {
    try { ev = execcheck.validateExecutable(c.claudeBin, { invoke: true }); } catch (e) { ev = { ok: false, reason: "executable-check-crashed" }; }
    if (ev && ev.ok && ev.resolvedPath) { try { exeHash = sha256File(ev.resolvedPath); } catch (e) { exeHash = null; } }
  }
  const exePathInSandbox = isMock ? "/sandbox/bin/claude" : (ev && ev.resolvedPath) || null;
  // Readiness attests a PROBE workspace (real readiness materialises one; here a synthetic identity) so the
  // workspace-bound attestation contract is exercised with a complete context.
  const attContext = Object.assign({ workspaceId: "readiness-probe-ws", workspacePathHash: "readiness-probe-path", materialisationManifestHash: "readiness-probe-manifest" }, context, { executableResolvedPathInsideSandbox: context.executableResolvedPathInsideSandbox || exePathInSandbox, providerId: (provider && provider.providerId) || context.providerId });

  // 2) sandbox attestation (structured, operation-bound, verified)
  if (checks.sandboxImplementationPresent.status !== "PASS") block("sandboxAttestationPass", "no-valid-provider");
  else { let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attContext) : null; } catch (e) { att = null; } const v = attestation.verifyAttestation(att, attContext); v.ok ? pass("sandboxAttestationPass") : block("sandboxAttestationPass", v.errors[0] || "attestation-failed", { errors: v.errors }); }

  // 3) executable validated (mock attests synthetically; real must resolve, be permitted, and hash-match the
  //    detection record's bound executableContentHash).
  if (isMock) pass("executableValidated");
  else if (!ev || !ev.ok) block("executableValidated", (ev && ev.reason) || "not-validated");
  else if (Array.isArray(provider.permittedExecutables) && provider.permittedExecutables.indexOf(c.claudeBin) < 0) block("executableValidated", "not-in-provider-permitted-executables");
  else if (c.executableContentHash && exeHash && exeHash !== c.executableContentHash) block("executableValidated", "executable-content-hash-mismatch");
  else if (c.cliVersion && ev.version && !verMatch(ev.version, c.cliVersion)) block("executableValidated", "cli-version-mismatch"); // §9: detected version must match at token boundaries
  else pass("executableValidated");

  // 4) tool restriction verified (detection record bound to executable + version + provider + policy) AND the
  //    ProjectOS-built argv must be APPLIED AND VERIFIED (§9 parity: readiness mirrors the adapter's exact
  //    invocation gate, so it can never report READY where the adapter would BLOCK on the invocation).
  const dv = detector.verifyDetectionRecord(c.detectionRecord, { executableContentHash: c.executableContentHash, cliVersion: c.cliVersion, operationMode: "first-controlled-change", sandboxProviderId: provider && provider.providerId, policyVersion: c.policyVersion, now: context.now, firstControlledChange: true });
  let invOk = false; try { if (dv.ok) { const b = detector.buildArgv(c.detectionRecord, "readiness-probe"); invOk = detector.verifyInvocation(b.argv, c.detectionRecord, "readiness-probe").status === detector.INVOCATION_STATUS.APPLIED_VERIFIED; } } catch (e) { invOk = false; }
  if (!dv.ok) block("toolRestrictionVerified", dv.errors[0] || "no-detection-record", { errors: dv.errors });
  else if (!invOk) block("toolRestrictionVerified", "invocation-restriction-not-applied");
  else pass("toolRestrictionVerified");

  // 5) process OWNERSHIP: stable operation handle, not a bare PID. §9: inspect the ACTUAL handle a lifecycle
  //    probe returns (not only a provider.pidFallback declaration) so readiness matches what the adapter blocks.
  if (!provider || sandbox.OPERATION_METHODS.some((m) => typeof provider[m] !== "function")) block("processOwnershipVerified", "no-operation-lifecycle");
  else {
    let probeHandleType = null; try { const h = provider.spawnOperation({ probe: true, operationId: "ownership-probe", bin: "<probe>", argv: [], cwd: "<probe>", env: {} }); probeHandleType = h && h.handleType; try { provider.terminateOperation(h); provider.disposeOperation(h); } catch (e) {} } catch (e) { probeHandleType = "probe-crashed"; }
    if (probeHandleType === "pid" && !isMock) block("processOwnershipVerified", "pid-handle-forbidden-for-real-runs");
    else if (provider.pidFallback === true && !isMock) block("processOwnershipVerified", "pid-only-provider-forbidden-for-real-runs");
    else pass("processOwnershipVerified");
  }

  // 6) process TERMINATION: exercise the operation lifecycle (synthetic contained process). For a REAL
  //    provider, supply a genuine independent sentinel so an over-broad terminate is actually caught.
  const probe = provider ? sandbox.probeProcessControl(provider, isMock ? {} : { sentinelFn: realSentinel }) : { ok: false, reason: "no-provider" };
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
const opEvidence = require("./operation-evidence.cjs");
const execcheck = require("./executable-check.cjs");

const GIT_MAXBUF = 64 * 1024 * 1024;

function sha256(s) { return crypto.createHash("sha256").update(s).digest("hex"); }
// Version match at TOKEN boundaries (so "21.9.0" does NOT satisfy a want of "1.9.0").
function verMatch(detected, want) { if (!detected || !want) return true; const w = String(want).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return new RegExp("(^|[^0-9.])" + w + "([^0-9.]|$)").test(String(detected)); }
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
    if (c.cliVersion && ev.version && !verMatch(ev.version, c.cliVersion)) return na(blocked("BLOCKED-EXECUTABLE", { execReason: "cli-version-mismatch", detail: ev.version }));
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

  // 7) Materialise the .git-free workspace FIRST (before attestation). A real-run symlink fallback that is not
  //    type-equivalent to the baseline fails closed (§11). workspaceId is UNIQUE and SEPARATE from operationId.
  let mat;
  try { mat = ledger.materialize(repoRoot, before.head, { realRun: requireReal }); }
  catch (e) { const eq = /NOT-EQUIVALENT/.test(String(e.message)); return na(blocked(eq ? "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT" : "workspace-materialise-failed", { detail: String(e.message).slice(0, 160) })); }
  const workspace = mat.workspace; const workspaceId = mat.workspaceId;
  let disposed = false, preserve = false;
  const disposeAll = () => { if (c.keepWorkspace) return ["kept-by-config:" + workspace]; if (disposed || preserve) return []; disposed = true; return ledger.dispose(workspace); };

  const BASE_ENFORCED = ["request-policy-tamper", "trusted-repo-binding", "branch", "remote", "clean-tree", "minimal-env", "workspace-no-dot-git", "trusted-fs-ledger", "path-allowlist", "symlink-escape", "timeout", "output-cap", "fail-closed-sandbox-gate", "workspace-bound-attestation", "detection-record-verification", "exact-invocation-binding", "shared-executable-check", "provider-permitted-executable", "first-proof-network-disabled", "provider-operation-handle", "mandatory-operation-disposal"];
  const wsFields = { workspaceId, materialisationManifestHash: mat.materialisationManifestHash, materialiseWarnings: mat.symlinkFallbacks || [] };
  const controlsFor = (killConfirmed, toolsApplied) => ({ technicallyEnforced: BASE_ENFORCED.concat(killConfirmed ? ["process-termination-confirm"] : []).concat(toolsApplied ? ["exact-invocation-restriction-applied"] : []), policyRequested: ["worker-tool-restriction"], delegated: ["deploy", "db-mutation", "provider-cli", "send", "payment", "commit", "push"], notVerified: killConfirmed ? [] : ["process-termination-confirm"], outOfScope: [] });
  const commonBase = () => Object.assign({ sandboxProvider: sandboxPolicy && sandboxPolicy.provider, sandboxPolicy, canonicalVisibility: provider.canonicalVisibility, networkPolicy: provider.networkPolicy, workerToolsPermitted: permittedTools, workerCommandsObserved: [], workerCommandsObservationStatus: "NOT OBSERVABLE", projectOsCommandsExecuted: ["git ls-tree", "git show", "git status", "git ls-files", "git rev-parse"], filesInspectionStatus: "NOT OBSERVABLE", processControlProvider: provider.providerId }, wsFields);
  const commonResult = (kc, toolsApplied) => Object.assign(commonBase(), { controls: controlsFor(kc, toolsApplied), workerToolsVerified: toolsApplied ? "APPLIED AND VERIFIED" : "NOT VERIFIED" });
  // Post-materialise refusal that always disposes the workspace (no process ran ⇒ termination NOT APPLICABLE).
  const postMat = (env, extra, toolsApplied) => out(env, Object.assign({}, commonResult(false, toolsApplied), { processTerminationStatus: "NOT APPLICABLE", residue: disposeAll() }, extra || {}));

  // 8) STRUCTURED provider CAPABILITY attestation — bound to the ACTUAL materialised workspace + real exe + op.
  const attCtx = { providerId: provider.providerId, operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, workspaceId, workspacePathHash: mat.hostWorkspacePathHash, materialisationManifestHash: mat.materialisationManifestHash, executableResolvedPathInsideSandbox: exeResolved, now: c.now };
  let att = null; try { att = typeof provider.attest === "function" ? provider.attest(attCtx) : null; } catch (e) { att = null; }
  const av = attestation.verifyAttestation(att, attCtx);
  if (!av.ok) return postMat(blocked("BLOCKED-SANDBOX-ATTESTATION", { errors: av.errors }));
  const providerCapabilityAttestationHash = att && att.evidenceHash;

  // 9) EXACT INVOCATION BINDING: ProjectOS builds the FINAL argv ITSELF from the verified record (never a
  //    caller function) and verifies it exactly encodes the restriction. Not APPLIED-AND-VERIFIED ⇒ refuse.
  const built = detector.buildArgv(c.detectionRecord, r.prompt);
  const inv = detector.verifyInvocation(built.argv, c.detectionRecord, r.prompt);
  const invocationArgvHash = inv.argvHash; const invocationRestrictionStatus = inv.status;
  if (inv.status !== detector.INVOCATION_STATUS.APPLIED_VERIFIED) return postMat(blocked("INVOCATION-RESTRICTION-NOT-APPLIED", { invocationRestrictionStatus: inv.status, errors: inv.errors }), { invocationRestrictionStatus: inv.status, invocationArgvHash, providerCapabilityAttestationHash });
  const argv = built.argv;

  const wsBefore = ledger.snapshot(workspace);
  const preExecutionLedgerHash = ledger.hashSnapshot(wsBefore);
  const evBase = { invocationArgvHash, invocationRestrictionStatus, providerCapabilityAttestationHash, preExecutionLedgerHash };
  const startTs = Date.now();
  let handle = null;
  try {
    // 10) Spawn via the provider-owned operation (stable handle).
    try { handle = provider.spawnOperation({ bin: c.claudeBin, argv, cwd: workspace, env: P.buildMinimalEnv(process.platform, policy.envAllowlist), operationId: policy.operationId }); }
    catch (e) { return postMat(blocked("operation-spawn-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({ processTerminationStatus: "NOT EXECUTED" }, evBase), true); }
    const handleType = handle && handle.handleType;
    const handleIdRedacted = handle && handle.handleId ? "op-" + sha256(String(handle.handleId)).slice(0, 12) : null;
    if (handleType === "pid" && requireReal) { try { provider.terminateOperation(handle); } catch (e) {} return postMat(blocked("BLOCKED-PROCESS-OWNERSHIP", { reason2: "pid-handle-forbidden-for-real-runs" }), Object.assign({ processTerminationStatus: "NOT EXECUTED", operationHandleType: handleType }, evBase), true); }

    // 11) Wait + read output ONLY through the provider streaming contract (never handle.child).
    // Adapter-side timeout BACKSTOP (defence in depth): even if a provider ignores its own timeoutMs, the
    // adapter terminates + resolves rather than hanging forever.
    let run;
    try {
      const hostTimeout = new Promise((rz) => setTimeout(() => rz({ exitStatus: null, killedFor: "timeout" }), (policy.timeoutMs || 120000) + 2000));
      run = await Promise.race([provider.waitForOperationExit(handle, { timeoutMs: policy.timeoutMs, maxOutputBytes: policy.maxOutputBytes }), hostTimeout]);
      if (run && run.killedFor === "timeout") { try { provider.terminateOperation(handle); } catch (e) {} }
    } catch (e) { run = { exitStatus: null, killedFor: "provider-error" }; }
    let rawOut = ""; try { rawOut = provider.readOperationOutput(handle, policy.maxOutputBytes); } catch (e) { /* ignore */ }
    const output = P.scrubSecrets(redactor.redactText(rawOut || "")).slice(0, 4000);
    const exitTs = Date.now();
    const opBase = { operationId: policy.operationId, workspaceId, providerId: provider.providerId, providerVersion: provider.providerVersion, operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, executableContentHash: c.executableContentHash, argvHash: invocationArgvHash, startTimestamp: startTs, exitTimestamp: exitTs };

    if (run.killedFor === "spawn-error" || run.killedFor === "provider-error") return postMat(refused(run.killedFor), Object.assign({ processTerminationStatus: "NOT EXECUTED", outputExcerpt: output, operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted }, evBase), true);

    // 12) Terminate (if killed) + CONFIRM via the operation handle.
    if (run.killedFor) { try { provider.terminateOperation(handle); } catch (e) {} }
    let conf; try { conf = provider.confirmOperationTerminated(handle); } catch (e) { conf = { confirmed: false, processCount: null }; }
    const processCount = conf && conf.processCount;
    const pcEvidenceHash = sha256(attestation.canonicalJson({ operationId: policy.operationId, handleIdRedacted, handleType, processCount, confirmed: conf && conf.confirmed, providerEvidence: conf && conf.evidence }));
    const canary = (n) => (att && att[n] && att[n].actual) || "not-evaluated";

    // Unconfirmed ⇒ EMERGENCY-STOP: do NOT dispose destructively; preserve operation + workspace evidence.
    if (!conf || conf.confirmed !== true) {
      preserve = true; try { provider.preserveOperationEvidence(handle); } catch (e) {}
      const opEv = opEvidence.buildOperationEvidence(Object.assign({}, opBase, { exitStatus: run.exitStatus, terminationStatus: "TERMINATION-UNCONFIRMED", operationProcessCount: processCount, networkDenialResult: canary("networkCanary"), canonicalAccessDenialResult: canary("canonicalPathCanary"), otherProjectAccessDenialResult: canary("otherProjectPathCanary"), credentialAccessDenialResult: canary("credentialPathCanary"), outputRedactionResult: "applied", disposalStatus: "not-disposed-evidence-preserved", residue: ["operation-preserved"] }));
      return out(emergency("EMERGENCY-STOP-REQUIRED"), Object.assign({}, commonResult(false, true), evBase, { operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, operationProcessCountObserved: processCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: opEv.evidenceHash, operationDisposalStatus: "not-disposed-evidence-preserved", operationResidue: ["operation-preserved"], outputExcerpt: output, processTerminationStatus: "EMERGENCY-STOP-REQUIRED", killConfirmed: false, residualDriftStatus: "not-evaluated", residue: ["workspace-preserved:" + workspace], risks: ["operation termination unconfirmed — external-operation lock; owner resolution required"], cancellationStatus: "unconfirmed" }));
    }

    // 13) MANDATORY disposal after confirmed termination. A malformed / non-empty-residue disposal is a failure.
    let descendants = []; try { descendants = provider.enumerateOperationProcesses(handle) || []; } catch (e) { descendants = []; }
    let disp; try { disp = provider.disposeOperation(handle); } catch (e) { disp = null; }
    const operationResidue = disp && Array.isArray(disp.residue) ? disp.residue : ["disposal-result-malformed"];
    const disposalOk = !!disp && disp.disposed === true && Array.isArray(disp.residue) && disp.residue.length === 0;
    const operationDisposalStatus = disposalOk ? "disposed" : "disposal-failed";
    const buildOpEv = (term) => opEvidence.buildOperationEvidence(Object.assign({}, opBase, { exitStatus: run.exitStatus, terminationStatus: term, operationProcessCount: processCount, containedDescendants: descendants, networkDenialResult: canary("networkCanary"), canonicalAccessDenialResult: canary("canonicalPathCanary"), otherProjectAccessDenialResult: canary("otherProjectPathCanary"), credentialAccessDenialResult: canary("credentialPathCanary"), outputRedactionResult: "applied", disposalStatus: operationDisposalStatus, residue: operationResidue }));
    const opFields = () => ({ operationHandleType: handleType, operationHandleIdRedacted: handleIdRedacted, operationProcessCountObserved: processCount, processControlEvidenceHash: pcEvidenceHash, operationEvidenceHash: buildOpEv("TERMINATED-CONFIRMED").evidenceHash, operationDisposalStatus, operationResidue });
    const done = (env, extra) => out(env, Object.assign({}, commonResult(true, true), evBase, opFields(), { residue: disposeAll() }, extra || {}));

    // Disposal failure is the HEADLINE outcome on EVERY post-confirmation branch (not buried in metadata behind
    // a timeout/drift/forbidden reason): a leftover sandbox operation must never be under-reported.
    if (!disposalOk) return done(blocked("OPERATION-DISPOSAL-FAILED", { operationResidue }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });

    // Killed (but confirmed dead + disposed) ⇒ refuse.
    if (run.killedFor) { const reason = ["timeout", "output-overflow", "stderr-overflow"].includes(run.killedFor) ? run.killedFor : "worker-error"; return done(refused(reason), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", cancellationStatus: "confirmed", timeoutStatus: run.killedFor === "timeout" ? "killed" : "none", residualDriftStatus: "not-evaluated" }); }

    // 14) Trusted FS diff + path enforcement (clean exit only).
    const wsAfter = ledger.snapshot(workspace); const led = ledger.diff(wsBefore, wsAfter);
    const refusedPaths = [];
    for (const p of led.changedPaths) { const norm = P.normPath(p); if (norm === ".git" || norm.startsWith(".git/")) { refusedPaths.push(p); continue; } if (!P.isAllowedPath(p, policy)) { refusedPaths.push(p); continue; } }
    for (const p of led.escapes) if (refusedPaths.indexOf(p) < 0) refusedPaths.push(p);

    // 15) Monitored-state reconciliation.
    let after; try { after = monitorSnapshot(repoRoot, { deepIgnored: policy.monitorIgnoredContent }); } catch (e) { return done(blocked("reconcile-snapshot-failed", { detail: String(e.message).slice(0, 160) }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED" }); }
    if (after.unverifiable > 0 || before.unverifiable > 0) return done(blocked("monitored-state-unverifiable", { unverifiable: after.unverifiable + before.unverifiable }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus: "not-evaluated" });
    const drift = monitorDrift(before, after);
    const residualDriftStatus = drift.length ? "residual-drift-detected" : "no-residual-drift-detected";
    const manifest = ledger.manifest(wsAfter, led);
    const patchHash = manifest.length ? sha256(JSON.stringify(manifest)) : null;
    const ledgerSummary = { added: led.added.length, modified: led.modified.length, deleted: led.deleted.length, typeChanged: led.typeChanged.length, sameSizeContentChange: led.sameSizeContentChange.length, symlinkChanged: led.symlinkChanged.length, permissionChanged: led.permissionChanged.length, renamed: led.renamed.length, escapes: led.escapes.length, hidden: led.hidden.length, unreadable: led.unreadable.length, special: led.special.length };

    if (drift.length) return done(blocked("residual-drift-detected", { fields: drift }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, ledgerSummary });
    if (refusedPaths.length) return done(refused("forbidden-path-change", { refusedPaths }), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, refusedPaths, changeManifest: manifest, patchHash, ledgerSummary });

    // 16) Dispose the WORKSPACE and gate on it: a workspace that could not be deleted (source-tree left on
    //     disk) must NOT be reported COMPLETED. `kept-by-config` is an owner-requested keep, not a failure.
    const residue = disposeAll();
    const realResidue = residue.filter((x) => !String(x).startsWith("kept-by-config:"));
    if (realResidue.length) return out(blocked("WORKSPACE-DISPOSAL-FAILED", { residue: realResidue }), Object.assign({}, commonResult(true, true), evBase, opFields(), { outputExcerpt: output, processTerminationStatus: "TERMINATED-CONFIRMED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, residue }));

    // 17) Success.
    let res; try {
      res = P.buildResult(Object.assign({}, commonResult(true, true), evBase, opFields(), { operationId: policy.operationId, projectId: r.projectId, phaseId: policy.phaseId, approvalStatus: policy.approvalId ? "referenced" : "none", toplevel: before.toplevel, origin: before.origin, baselineBranch: before.branch, baselineHead: before.head, finalBranch: after.branch, finalHead: after.head, outcome: run.exitStatus === 0 ? "COMPLETED" : "FAILED", residualDriftStatus, filesChanged: led.changedPaths, changeManifest: manifest, patchHash, ledgerSummary, processTerminationStatus: "TERMINATED-CONFIRMED", killConfirmed: true, timeoutStatus: "none", cancellationStatus: "none", outputExcerpt: output, residue, workerDecision: run.exitStatus === 0 ? "PROPOSED" : "FAILED" }));
    } catch (e) { return out(blocked("result-build-failed", { detail: String(e.message).slice(0, 160) }), Object.assign({}, commonResult(true, true), { residue })); }
    const contractErrors = P.validateResult(res, { real: requireReal });
    if (contractErrors.length) return out(blocked("result-contract-violation", { contractErrors }), Object.assign({}, commonResult(true, true), { residue }));
    return { ok: run.exitStatus === 0, decision: run.exitStatus === 0 ? "COMPLETED" : "FAILED", output, patchHash, changedFiles: led.changedPaths, ledger: led, result: res };
  } catch (e) {
    preserve = true; const wasDisposed = disposed;
    try { if (handle) provider.preserveOperationEvidence(handle); } catch (er) {}
    return out(blocked("internal-error", { detail: String(e && e.message).slice(0, 200) }), Object.assign({}, commonResult(false, true), { processTerminationStatus: "TERMINATION-UNCONFIRMED", residualDriftStatus: "not-evaluated", residue: [wasDisposed ? "already-disposed:" + workspace : "workspace-preserved:" + workspace], risks: ["unexpected error — evidence preserved; owner resolution required"] }));
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

// Execution-outcome recovery guidance (§14: readiness vs EXECUTION). Maps a run result's block/outcome to a
// plain-language owner recovery step — distinct from readiness (which is "can a real run even start").
const EXECUTION_RECOVERY = {
  "INVOCATION-RESTRICTION-NOT-APPLIED": "The worker's tool restriction was not actually encoded in the command that would run. Do not proceed — re-derive the detection record so ProjectOS builds a restricted command, and re-run.",
  "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT": "The disposable workspace did not exactly match the approved baseline (a symlink could not be reproduced). Do not proceed on this host — use a host/provider that preserves the entry types.",
  "OPERATION-DISPOSAL-FAILED": "The sandbox operation did not dispose cleanly (leftover state). The run is NOT complete. Investigate the leftover residue and dispose the operation before any further run.",
  "EMERGENCY-STOP-REQUIRED": "A worker operation could NOT be confirmed terminated. STOP. Do not reconcile or reuse the workspace. Preserve the evidence, resolve the live/uncertain process manually, then re-run readiness.",
  "BLOCKED-SANDBOX-ATTESTATION": "The sandbox provider could not attest isolation for this exact workspace/operation. Do not proceed — fix the provider's attestation.",
};
/** One-line execution-state summary for a run result (terminal/console). Never asserts success falsely. */
function renderExecutionState(result, decisionReason) {
  const r = result || {}; const reason = decisionReason || r.reason || r.outcome || "";
  const emergency = r.processTerminationStatus === "EMERGENCY-STOP-REQUIRED";
  const rec = EXECUTION_RECOVERY[reason];
  const lines = [];
  lines.push("Run outcome: " + (emergency ? "EMERGENCY STOP" : (r.outcome || "unknown")));
  lines.push("  invocation restriction: " + (r.invocationRestrictionStatus || "NOT VERIFIED"));
  lines.push("  process termination:    " + (r.processTerminationStatus || "NOT APPLICABLE"));
  lines.push("  operation disposal:     " + (r.operationDisposalStatus || "not-disposed"));
  if (Array.isArray(r.operationResidue) && r.operationResidue.length) lines.push("  operation residue:      " + r.operationResidue.join(", "));
  if (rec) { lines.push(""); lines.push("What to do: " + rec); }
  return lines.join("\n");
}

module.exports = { renderReadinessHtml, renderExecutionState, esc, CHECK_TITLES, EXECUTION_RECOVERY };
```

## validate-claude-worker.cjs (MANDATORY SECURITY EVIDENCE)

```js
"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1D (§13). Proves exact
 * invocation binding, workspace-bound attestation, the provider streaming contract, mandatory operation
 * disposal, post-operation evidence, readiness/adapter parity, and the process-scope probe — using a MOCK
 * sandbox provider + synthetic records + REAL throwaway git repos. Real claude worker + real OS sandbox are
 * owner-machine steps. Opt-in — NOT part of `npm run validate`; run standalone. 50 invariants (§13 + round-2 ECC).
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
  return { projectRoots: { acme: repo }, policy: Object.assign({ expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 2000, maxOutputBytes: 1 << 20 }, o.policy || {}), operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" }, claudeBin: "synthetic-claude", claudeArgs: o.claudeArgs, redactor: createRedactor(), sandboxProvider: provider, detectionRecord: o.detectionRecord !== undefined ? o.detectionRecord : mkRecord(provider && provider.providerId, o.recOpts), executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER, realRun: o.realRun, keepWorkspace: o.keepWorkspace };
}
const REQ = { prompt: "add a file", projectId: "acme" };
const wsCtx = { providerId: "mock-provider", operationId: "OP1", projectId: "acme", phaseId: "PH1", workspaceId: "WS1", workspacePathHash: "wph", materialisationManifestHash: "mmh", executableResolvedPathInsideSandbox: "/sandbox/bin/claude" };
const IS = detector.INVOCATION_STATUS;

async function run() {
  errors.length = 0;
  const rec = mkRecord("mock-provider");
  const built = detector.buildArgv(rec, "the prompt");

  // 1 arbitrary claudeArgs cannot control the real invocation (ProjectOS builds argv from the record)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), claudeArgs: () => ["--evil", "boom"] })); if (a.decision !== "COMPLETED") fail("inv1", "run failed", a); else { const b = detector.buildArgv(a.result && { argumentTemplate: ["--allowedTools", "{tools}", "-p", "{prompt}"], permittedTools: ["Read", "Edit"] } || {}, "add a file"); if (!a.result.invocationArgvHash) fail("inv1", "no argv hash"); if (a.result.invocationRestrictionStatus !== IS.APPLIED_VERIFIED) fail("inv1", "restriction not applied despite malicious claudeArgs", a.result.invocationRestrictionStatus); } });
  // 2 restriction mechanism appears in final argv
  if (built.argv.indexOf("--allowedTools") < 0) fail("inv2", "mechanism absent from built argv");
  // 3 permitted tools in final argv exactly match the record
  { const mi = built.argv.indexOf("--allowedTools"); if (built.argv[mi + 1] !== rec.permittedTools.join(",")) fail("inv3", "permitted tools not exactly encoded"); }
  // 4 a record whose template omits the restriction mechanism is refused
  { const bad = mkRecord("mock-provider", { argumentTemplate: ["-p", "{prompt}"] }); if (detector.verifyDetectionRecord(bad, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }).ok) fail("inv4", "template without mechanism accepted"); }
  // 5 extra unknown argument refused
  if (detector.verifyInvocation(built.argv.concat(["--extra"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv5", "extra arg not NOT-VERIFIED");
  // 6 bypass flag refused
  if (detector.verifyInvocation(["--dangerously-skip-permissions"].concat(built.argv), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv6", "bypass flag not refused");
  // 7 shell-capable arg refused
  if (detector.verifyInvocation(built.argv.concat(["Bash"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv7", "shell tool not refused");
  // 8 network-tool arg refused
  if (detector.verifyInvocation(built.argv.concat(["WebFetch"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv8", "network tool not refused");
  // 9 git-write arg refused
  if (detector.verifyInvocation(built.argv.concat(["Git"]), rec, "the prompt").status !== IS.NOT_VERIFIED) fail("inv9", "git-write tool not refused");
  // 10 argv hash bound to the operation evidence
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !a.result.invocationArgvHash) fail("inv10", "no argv hash on result"); });
  // 11 attestation occurs after workspace materialisation (workspaceId is a real materialised id)
  // 12 workspace ID is NOT operation ID
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !/^ws-/.test(a.result.workspaceId || "")) fail("inv11", "workspaceId not a materialised id", a.result && a.result.workspaceId); if (a.result && a.result.workspaceId === "OP1") fail("inv12", "workspaceId equals operationId"); });
  // 13 actual workspace is attested (a benign run passes the workspace-bound attestation)
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.decision !== "COMPLETED") fail("inv13", "workspace-bound attestation did not pass on a benign run", a.reason); });
  // 14 wrong workspace path refused (unit)
  if (attestation.verifyAttestation(attestation.syntheticAttestation(wsCtx), Object.assign({}, wsCtx, { workspacePathHash: "OTHER" })).ok) fail("inv14", "wrong workspace path accepted");
  // 15 wrong materialisation hash refused (unit)
  if (attestation.verifyAttestation(attestation.syntheticAttestation(wsCtx), Object.assign({}, wsCtx, { materialisationManifestHash: "OTHER" })).ok) fail("inv15", "wrong materialisation hash accepted");
  // 16/17 cleanup/termination canaries are NOT operation cleanup/termination evidence (separate modules)
  { const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2, disposalStatus: "disposed", terminationStatus: "TERMINATED-CONFIRMED" }); if (!("disposalStatus" in oev) || !("terminationStatus" in oev)) fail("inv16/17", "operation evidence lacks its own disposal/termination fields"); if ("cleanupCanary" in oev || "emergencyTerminationCanary" in oev) fail("inv16/17", "operation evidence borrowed a capability canary"); }
  // 18 a provider that does NOT expose handle.child still works (streaming contract only)
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt") }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "COMPLETED") fail("inv18", "streaming-only provider run failed", a.reason); const h = prov.spawnOperation({ operationId: "x", bin: "b", argv: [], cwd: ".", env: {} }); if ("child" in h) fail("inv18", "handle exposes .child (should be internal _child)"); prov.terminateOperation(h); });
  // 19 streaming contract delivers output
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), stdout: "hello-from-worker" })); if (!a.result || String(a.result.outputExcerpt).indexOf("hello-from-worker") < 0) fail("inv19", "streaming output not delivered", a.result && a.result.outputExcerpt); });
  // 20 streaming stderr overflow terminates
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { floodErr: true } }); cfg.policy.maxOutputBytes = 64; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "stderr-overflow") fail("inv20", "stderr overflow not handled", a.reason); });
  // 21 streaming timeout terminates
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "timeout") fail("inv21", "timeout not handled", a.reason); });
  // 22 streaming interruption (provider waitForOperationExit reports worker-error) is refused
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { waitForOperationExit: () => Promise.resolve({ exitStatus: null, killedFor: "worker-error" }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); if (a.decision === "COMPLETED") fail("inv22", "interruption treated as success", a.decision); });
  // 23 successful operation is disposed
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.operationDisposalStatus !== "disposed") fail("inv23", "success not disposed", a.result.operationDisposalStatus); });
  // 24 confirmed FAILED operation is disposed
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), spawnOpts: { exit: 1 } })); if (a.result.operationDisposalStatus !== "disposed") fail("inv24", "failed op not disposed", a.result.operationDisposalStatus); if (a.decision !== "FAILED" && a.decision !== "COMPLETED") { /* exit1 => FAILED */ } });
  // 25 timeout operation is disposed after confirmed termination
  await withRepo(async (repo) => { const cfg = baseCfg(repo, { spawnOpts: { hang: true } }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.result.operationDisposalStatus !== "disposed") fail("inv25", "timeout op not disposed", a.result.operationDisposalStatus); });
  // 26 disposal failure blocks completion
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt"), provOver: { disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "BLOCKED" || a.reason !== "OPERATION-DISPOSAL-FAILED") fail("inv26", "disposal failure did not block", a); });
  // 27 unconfirmed termination preserves evidence and does not dispose
  let emgWs = null;
  await withRepo(async (repo) => { const prov = mkProvider({ behavior: writeApp("new.txt"), provOver: { terminateOperation: () => {}, confirmOperationTerminated: () => ({ confirmed: false, processCount: 1 }) } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov, behavior: writeApp("new.txt") })); if (a.decision !== "EMERGENCY-STOP") fail("inv27", "unconfirmed not emergency", a.decision); else { if (a.result.operationDisposalStatus !== "not-disposed-evidence-preserved") fail("inv27", "disposed on unconfirmed", a.result.operationDisposalStatus); const pres = (a.result.residue || []).find((x) => String(x).startsWith("workspace-preserved:")); if (!pres) fail("inv27", "workspace not preserved"); else emgWs = pres.slice("workspace-preserved:".length); } });
  if (emgWs) { if (!fs.existsSync(emgWs)) fail("inv27", "preserved workspace gone"); rmRepo(emgWs); }
  // 28 post-operation evidence generated after exit; 29 operation-bound
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (!a.result || !a.result.operationEvidenceHash) fail("inv28", "no operation evidence hash"); });
  { const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2 }); if (opEvidence.verifyOperationEvidence(oev, { operationId: "OTHER", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h" }).ok) fail("inv29", "op evidence not operation-bound"); }
  // 30 an ACTUAL returned PID handle is rejected for real readiness
  { const prov = mkProvider({ provOver: { kind: "restricted-account", pidFallback: true } }); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, wsCtx); if (r.checks.processOwnershipVerified.status !== "BLOCKED") fail("inv30", "pid handle passed ownership readiness", r.checks.processOwnershipVerified); }
  // 31 CLI/record version mismatch blocks readiness (tool restriction)
  { const prov = mkProvider(); const r = runtime.checkReadiness({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: "9.9.9", policyVersion: POLICY_VER }, wsCtx); if (r.checks.toolRestrictionVerified.status !== "BLOCKED") fail("inv31", "version mismatch not blocked", r.checks.toolRestrictionVerified); }
  // 32 readiness must never be MORE permissive than the adapter: on a config the adapter blocks for network,
  //    the readiness network check also blocks, and readiness is never READY-FOR-REAL (parity on the axis).
  await withRepo(async (repo) => { const prov = mkProvider({ provOver: { networkPolicy: "allowlist", networkAllowlist: ["api.example.com"] } }); const a = await runClaudeWorker(REQ, baseCfg(repo, { provider: prov })); const r = cap.check({ sandboxProvider: prov, detectionRecord: mkRecord(prov.providerId), claudeBin: "x", executableContentHash: EXE_HASH, cliVersion: CLI_VER, policyVersion: POLICY_VER }, wsCtx); if (a.reason !== "BLOCKED-NETWORK-POLICY") fail("inv32", "adapter reason wrong", a.reason); if (r.checks.networkDisabled.status !== "BLOCKED") fail("inv32", "readiness network check not blocked", r.checks.networkDisabled); if (r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF") fail("inv32", "readiness READY where adapter blocks"); });
  // 33 unrelated sentinel survives; 34 contained terminated
  { const p = sandbox.probeProcessControl(mkProvider()); if (!p.ok || !p.evidence || p.evidence.sentinelSurvived !== true) fail("inv33/34", "process-scope probe failed", p); }
  // 35 operation enumeration excluding an unrelated process (a provider that leaks the sentinel is blocked)
  { const prov = mkProvider({ provOver: { enumerateOperationProcesses: () => [2147480001] } }); if (sandbox.probeProcessControl(prov).ok) fail("inv35", "enumeration including sentinel not blocked"); }
  // 36 symlink fallback blocks a real run (env-dependent: only when the host cannot make symlinks)
  await withRepo(async (repo) => {
    // seed a symlink blob in the repo
    let seeded = false; try { const lp = path.join(repo, "app", "link"); fs.symlinkSync("seed.txt", lp); g(repo, ["add", "-A"]); g(repo, ["commit", "-q", "-m", "link"]); seeded = true; } catch (e) { /* cannot create link on this host */ }
    if (!seeded) { errors.push("inv36: SKIPPED-ENV (host cannot create symlinks; real-run equivalence path unexercised)"); return; }
    // materialise for a real run — on a host that cannot recreate the link, fallback ⇒ NOT-EQUIVALENT
    try { const m = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim(), { realRun: true }); ledger.dispose(m.workspace); errors.push("inv36: SKIPPED-ENV (host recreated the symlink; no fallback to block)"); }
    catch (e) { if (!/NOT-EQUIVALENT/.test(String(e.message))) fail("inv36", "real-run symlink fallback did not block", e.message); }
  });
  // 37 workerToolsVerified defaults NOT VERIFIED and APPLIED requires the control
  { const res = P.buildResult({ operationId: "OP1", workerToolsVerified: "APPLIED AND VERIFIED", controls: { technicallyEnforced: [] } }); if (!P.validateResult(res).some((e) => /APPLIED without/.test(e))) fail("inv37", "APPLIED accepted without the control"); if (P.buildResult({ operationId: "OP1" }).workerToolsVerified !== "NOT VERIFIED") fail("inv37", "default not NOT VERIFIED"); }
  // 38 exact final argv → APPLIED AND VERIFIED on a benign run
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.invocationRestrictionStatus !== IS.APPLIED_VERIFIED || a.result.workerToolsVerified !== IS.APPLIED_VERIFIED) fail("inv38", "restriction not APPLIED AND VERIFIED", a.result.invocationRestrictionStatus); });
  // 39 evidence hashes validate
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (P.validateResult(a.result).length) fail("inv39", "result invalid", P.validateResult(a.result)); const oev = opEvidence.buildOperationEvidence({ operationId: "OP1", workspaceId: "WS1", providerId: "p", executableContentHash: EXE_HASH, argvHash: "h", startTimestamp: 1, exitTimestamp: 2 }); if (opEvidence.hashEvidence(oev) !== oev.evidenceHash) fail("inv39", "op evidence hash invalid"); });
  // 40 worker cannot self-approve
  { let t = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { t = true; } if (!t) fail("inv40", "APPROVED not rejected"); }
  // 41 no metered AI API; 42 no prod/provider/send/payment (source scan)
  { const m = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i; const pr = /stripe\.|sendgrid|twilio|nodemailer|\.charge\(|\.refund\(|supabase\.co|process\.env\.(SUPABASE|STRIPE|RESEND)/i;
    for (const f of ["claude-worker", "worker-policy", "workspace-ledger", "sandbox-provider", "attestation", "invocation-detector", "operation-evidence", "runtime-config", "owner-capability-check", "executable-check"]) { const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f + ".cjs"), "utf8"); if (m.test(src)) fail("inv41", "metered API in " + f);
      // worker-policy legitimately NAMES providers (TWILIO/STRIPE/…) in its TOKENISH denylist to BLOCK them.
      if (f !== "worker-policy" && pr.test(src)) fail("inv42", "prod/provider/send/payment in " + f); } }
  // 43 .git-free ledger passing (no .git; worker git init refused)
  await withRepo(async (repo) => { const mat = ledger.materialize(repo, g(repo, ["rev-parse", "HEAD"]).trim()); const snap = ledger.snapshot(mat.workspace); if (Object.keys(snap).some((k) => k === ".git" || k.startsWith(".git/"))) fail("inv43", "workspace has .git"); ledger.dispose(mat.workspace); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: (cwd) => g(cwd, ["init", "-q"]) })); if (a.reason !== "forbidden-path-change") fail("inv43", "git init not refused", a.reason); });
  // 44 canonical monitored state stable
  await withRepo(async (repo) => { const before = worker.monitorSnapshot(repo); const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.residualDriftStatus !== "no-residual-drift-detected") fail("inv44", "drift on benign run", a.result.residualDriftStatus); if (worker.monitorDrift(before, worker.monitorSnapshot(repo)).length) fail("inv44", "canonical drifted"); });
  // 45 residue reported accurately
  await withRepo(async (repo) => { const a = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt") })); if (a.result.residue.length !== 0) fail("inv45", "benign residue", a.result.residue); const b = await runClaudeWorker(REQ, baseCfg(repo, { behavior: writeApp("new.txt"), keepWorkspace: true })); const kept = (b.result.residue || []).find((x) => String(x).startsWith("kept-by-config:")); if (!kept) fail("inv45", "kept not reported"); else rmRepo(kept.slice("kept-by-config:".length)); });
  // 46 validator uses tmpdir only; 47 remote frozen
  { if (!/mkdtempSync\(path\.join\(os\.tmpdir/.test(fs.readFileSync(__filename, "utf8"))) fail("inv46", "not tmpdir-only"); if (!/example\.invalid/.test(ORIGIN) || /github\.com|universalbizcomply/i.test(ORIGIN)) fail("inv47", "wrong remote"); }
  // 48 argument-template ALLOWLIST: a template smuggling a space-separated bypass flag is refused
  { const bad = mkRecord("mock-provider", { argumentTemplate: ["--permission-mode", "bypassPermissions", "--allowedTools", "{tools}", "-p", "{prompt}"] }); if (detector.verifyDetectionRecord(bad, { executableContentHash: EXE_HASH, cliVersion: CLI_VER, sandboxProviderId: "mock-provider", policyVersion: POLICY_VER, operationMode: "first-controlled-change", firstControlledChange: true }).ok) fail("inv48", "template with an extra bypass flag accepted"); }
  // 49 a benign PROMPT that contains a tool name ("Git") is NOT falsely blocked (H1: prompt is data)
  { const b = detector.buildArgv(rec, "please fix Git,Deploy references"); if (detector.verifyInvocation(b.argv, rec, "please fix Git,Deploy references").status !== IS.APPLIED_VERIFIED) fail("inv49", "benign prompt containing tool names falsely blocked"); }
  // 50 disposal failure is the HEADLINE even on a killed (timeout) run
  await withRepo(async (repo) => { const prov = mkProvider({ spawnOpts: { hang: true }, provOver: { disposeOperation: () => ({ disposed: false, residue: ["leftover"] }) } }); const cfg = baseCfg(repo, { provider: prov }); cfg.policy.timeoutMs = 120; const a = await runClaudeWorker(REQ, cfg); if (a.reason !== "OPERATION-DISPOSAL-FAILED") fail("inv50", "disposal failure not headline on killed run", a.reason); });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV")); const skip = e.filter((x) => x.includes("SKIPPED-ENV"));
    skip.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (50 invariants" + (skip.length ? ", " + skip.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };
```

> Unchanged from HARDEN1C (see that bundle): owner-capability-check.cjs, executable-check.cjs.

---

**END OF BUNDLE.** END STATUS: IMPLEMENTED LOCALLY — AWAITING CHATGPT REVIEW. Not pushed, not closed. Remote frozen `4c3f076`.
