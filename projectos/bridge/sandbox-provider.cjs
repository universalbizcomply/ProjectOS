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
