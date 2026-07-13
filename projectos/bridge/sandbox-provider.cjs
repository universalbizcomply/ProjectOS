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
