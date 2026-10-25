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
