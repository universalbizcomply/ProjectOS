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
