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
