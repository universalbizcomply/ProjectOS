"use strict";
/**
 * OS-level worker-containment contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§4).
 *
 * The real Claude worker must NOT run with unrestricted access to the owner account. A sandbox PROVIDER
 * attests an OS-enforced boundary (restricted Windows account / Windows Sandbox / Hyper-V VM / WSL2 or
 * container / AppContainer restricted-token / another independently-enforced FS+network jail). This module
 * defines the contract, validates a provider, and FAILS CLOSED: with no approved provider, a real run is
 * BLOCKED — there is NO fallback to unrestricted owner-account execution.
 *
 * This phase does NOT install or activate any real sandbox. Synthetic proofs use a MOCK provider that
 * declares the same contract and runs the (synthetic) worker in-process; the mock explicitly attests that
 * the canonical repo, other projects, home, and credentials are NOT mounted and the network is disabled.
 */

const REQUIRED_FIELDS = [
  "name", "kind", "spawn", "attest",
  "readablePaths", "writablePaths", "mountedWorkspace",
  "canonicalVisibility", "otherProjectVisibility", "homeVisibility", "credentialVisibility",
  "networkPolicy", "permittedExecutables", "processLimits", "childProcessPolicy",
  "cleanupPolicy", "emergencyTermination",
];

// Values that make a provider acceptable for a REAL run. Anything weaker fails closed. A "disabled" network
// is the only acceptable network stance unless the provider carries a concrete, non-wildcard allowlist.
function networkOk(p) {
  if (p.networkPolicy === "disabled") return true;
  if (p.networkPolicy === "allowlist") return Array.isArray(p.networkAllowlist) && p.networkAllowlist.length > 0 && !p.networkAllowlist.some((h) => String(h).includes("*") || String(h) === "0.0.0.0/0");
  return false;
}
function isReallyIsolated(p) {
  return p
    && p.canonicalVisibility === "not-mounted"
    && p.otherProjectVisibility === "not-mounted"
    && p.homeVisibility === "not-mounted"
    && p.credentialVisibility === "not-mounted"
    && networkOk(p)
    && typeof p.spawn === "function"
    && Array.isArray(p.permittedExecutables);
}

function validateProvider(p) {
  const errors = [];
  if (!p || typeof p !== "object") return ["sandbox: no provider object"];
  for (const f of REQUIRED_FIELDS) if (!(f in p)) errors.push("sandbox: missing '" + f + "'");
  if (p && typeof p.spawn !== "function") errors.push("sandbox: spawn must be a function");
  if (p && typeof p.attest !== "function") errors.push("sandbox: attest must be a function (live enforcement canary)");
  if (p && p.networkPolicy === "allowlist" && !networkOk(p)) errors.push("sandbox: networkPolicy 'allowlist' requires a concrete non-wildcard networkAllowlist");
  if (p && !isReallyIsolated(p)) errors.push("sandbox: provider does not attest full isolation (canonical/other/home/credential must be not-mounted; network disabled or concrete allowlist)");
  return errors;
}

/**
 * Resolve the sandbox for a run. Fail-closed.
 * @returns { ok:true, provider } | { ok:false, decision:"BLOCKED", reason:"OS-SANDBOX-NOT-CONFIGURED"|... }
 */
function resolveSandbox(config, opts) {
  const o = opts || {};
  const p = config && config.sandboxProvider;
  if (!p) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-NOT-CONFIGURED" };
  const errors = validateProvider(p);
  if (errors.length) return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-INVALID", errors };
  if (o.requireReal && p.kind === "mock") return { ok: false, decision: "BLOCKED", reason: "OS-SANDBOX-MOCK-NOT-ALLOWED-FOR-REAL-RUN" };
  return { ok: true, provider: p };
}

/** A summary of the provider's policy for the evidence record (no secrets). */
function policySummary(p) {
  if (!p) return null;
  return {
    provider: p.name, kind: p.kind,
    mountedWorkspace: p.mountedWorkspace,
    canonicalVisibility: p.canonicalVisibility,
    otherProjectVisibility: p.otherProjectVisibility,
    homeVisibility: p.homeVisibility,
    credentialVisibility: p.credentialVisibility,
    networkPolicy: p.networkPolicy,
    permittedExecutables: p.permittedExecutables,
    processLimits: p.processLimits,
    childProcessPolicy: p.childProcessPolicy,
    cleanupPolicy: p.cleanupPolicy,
  };
}

/**
 * Build a MOCK provider for SYNTHETIC proofs only. It attests full isolation and runs the (synthetic) worker
 * via the supplied `spawnFn` bound to the workspace. It never grants real OS isolation — `kind:"mock"` is
 * refused for real runs.
 */
function mockProvider(spawnFn, overrides) {
  return Object.assign({
    name: "mock-sandbox", kind: "mock",
    spawn: (bin, argv, spawnOpts) => spawnFn(bin, argv, spawnOpts),
    // A REAL provider must implement attest(): spawn a canary that tries to read the canonical path / reach
    // the network and confirm failure. The mock declares (does not enforce) — it is refused for real runs.
    attest: () => ({ enforced: false, kind: "mock", note: "declared-only; not OS-enforced" }),
    readablePaths: ["<workspace>"], writablePaths: ["<workspace>"], mountedWorkspace: "<workspace>",
    canonicalVisibility: "not-mounted", otherProjectVisibility: "not-mounted",
    homeVisibility: "not-mounted", credentialVisibility: "not-mounted",
    networkPolicy: "disabled", networkAllowlist: [], permittedExecutables: ["<claude>"],
    processLimits: { cpuSeconds: 120, memoryMb: 2048, maxChildren: 32 },
    childProcessPolicy: "contained", cleanupPolicy: "destroy-on-exit",
    emergencyTermination: "kill-tree",
  }, overrides || {});
}

module.exports = { resolveSandbox, validateProvider, policySummary, mockProvider, isReallyIsolated, REQUIRED_FIELDS };
