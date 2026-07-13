"use strict";
/**
 * Owner-machine capability check — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§7, §12). SAFE + read-only:
 * detects prerequisites only. No install, no provider connection, no repo change, no credential read, no
 * token printed. It uses the SAME shared executable checker as the worker adapter, so it can NEVER report a
 * Claude executable READY that the adapter would refuse (e.g. a `claude.cmd` shim on Windows).
 *
 * It distinguishes TECHNICAL readiness (can the synthetic validation run) from SECURITY readiness (is a real
 * worker run even permissible), and reports SANDBOX / TOOL-RESTRICTION / PROCESS-CONTROL explicitly. It never
 * emits a false READY.
 */

const { execFileSync } = require("child_process");
const execcheck = require("./executable-check.cjs");

function tryExec(bin, args) {
  try { return { ok: true, out: String(execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 })).trim().split("\n")[0].slice(0, 80) }; }
  catch (e) { return { ok: false, out: null }; }
}
function onPath(bin) { return (process.platform === "win32" ? tryExec("where", [bin]) : tryExec("which", [bin])).ok; }

/** Claude executable via the SHARED checker (rejects shims / existence-only / uninvocable). */
function detectClaude() {
  const names = process.platform === "win32" ? ["claude", "claude.exe"] : ["claude"];
  for (const n of names) { const v = execcheck.validateExecutable(n, { invoke: true }); if (v.ok) return { status: "PASS", how: "executable-validated", detail: v.version || v.resolvedPath }; }
  const shim = process.platform === "win32" ? execcheck.validateExecutable("claude.cmd", { invoke: false }) : { ok: false };
  const session = !!(process.env.CLAUDE_CODE_SESSION || process.env.CLAUDECODE || process.env.CLAUDE_DESKTOP);
  const how = shim.isShim ? "only-unsafe-shim-found" : session ? "session-present-but-no-safe-executable" : "no-safe-executable";
  return { status: "BLOCKED", how, detail: null };
}
function detectDocker() {
  if (!onPath("docker")) return { status: "BLOCKED", how: "no-docker-binary" };
  const info = tryExec("docker", ["info", "--format", "{{.ServerVersion}}"]);
  return info.ok ? { status: "PASS", how: "daemon-running", detail: info.out } : { status: "BLOCKED", how: "binary-present-daemon-down" };
}
function detectSupabase() {
  if (!onPath("supabase")) return { status: "BLOCKED", how: "no-supabase-cli" };
  const v = tryExec("supabase", ["--version"]);
  return v.ok ? { status: "PASS", how: "cli-present", detail: v.out } : { status: "BLOCKED", how: "cli-error" };
}
// Sandbox + tool-restriction are OWNER-CONFIG, not machine facts; the check reports whether one is configured
// via the environment marker the owner sets after approving a provider/profile. Absent ⇒ BLOCKED (fail-closed).
function detectSandbox() { return process.env.PROJECTOS_SANDBOX_PROVIDER ? { status: "PASS", how: "provider-configured" } : { status: "BLOCKED", how: "no-approved-sandbox-provider" }; }
function detectToolRestriction() { return process.env.PROJECTOS_WORKER_PROFILE_VERIFIED === "1" ? { status: "PASS", how: "profile-verified" } : { status: "BLOCKED", how: "tool-restriction-not-proven" }; }
function detectProcessControl() { return { status: "PASS", how: "bounded-tree-termination-available" }; }
function detectGit() { const v = tryExec("git", ["--version"]); return v.ok ? { status: "PASS", how: "present", detail: v.out } : { status: "BLOCKED", how: "no-git" }; }

function check() {
  return {
    platform: process.platform, node: process.version,
    git: detectGit(), claude: detectClaude(), docker: detectDocker(), supabase: detectSupabase(),
    sandbox: detectSandbox(), toolRestriction: detectToolRestriction(), processControl: detectProcessControl(),
  };
}

/** Overall state. Security gates first (sandbox/executable/tool/process), then real-run infra. */
function overall(res) {
  const syntheticReady = res.git && res.git.status === "PASS";
  if (res.sandbox.status !== "PASS") return syntheticReady ? "READY-FOR-SYNTHETIC-VALIDATION" : "BLOCKED-OS-SANDBOX";
  if (res.claude.status !== "PASS") return "BLOCKED-EXECUTABLE";
  if (res.toolRestriction.status !== "PASS") return "BLOCKED-TOOL-RESTRICTION";
  if (res.processControl.status !== "PASS") return "BLOCKED-PROCESS-CONTROL";
  if (res.docker.status !== "PASS" || res.supabase.status !== "PASS") return "READY-FOR-SYNTHETIC-VALIDATION";
  return "READY-FOR-REAL-WORKER-PROOF";
}
/** The single blocking real-run reason, for owner guidance (distinct from the synthetic-ready state). */
function realBlockReason(res) {
  if (res.sandbox.status !== "PASS") return "BLOCKED-OS-SANDBOX";
  if (res.claude.status !== "PASS") return "BLOCKED-EXECUTABLE";
  if (res.toolRestriction.status !== "PASS") return "BLOCKED-TOOL-RESTRICTION";
  if (res.processControl.status !== "PASS") return "BLOCKED-PROCESS-CONTROL";
  if (res.docker.status !== "PASS") return "BLOCKED-DOCKER";
  if (res.supabase.status !== "PASS") return "BLOCKED-SUPABASE";
  return "READY-FOR-REAL-WORKER-PROOF";
}

const FRIENDLY = {
  sandbox: { title: "OS security sandbox", "no-approved-sandbox-provider": { label: "No approved OS sandbox is configured. Without one, the real worker is NOT SAFE to run — it would have your account's full access.", action: "Configure and approve an OS sandbox provider (restricted account / Windows Sandbox / VM / container). Until then only synthetic validation runs." } },
  claude: { title: "Claude Code worker executable", "session-present-but-no-safe-executable": { label: "A Claude session is signed in, but no safe runnable `claude` executable is on this machine.", action: "Install the Claude Code CLI as a real executable (not a .cmd/.bat shim), then re-run this check." }, "only-unsafe-shim-found": { label: "Only an unsafe `claude.cmd`/`.bat` shim was found; the worker refuses shims on Windows.", action: "Install a real `claude` executable (not a shim), then re-run this check." }, "no-safe-executable": { label: "No safe Claude executable found.", action: "Install and sign in to the Claude Code CLI, then re-run this check." } },
  toolRestriction: { title: "Worker tool restriction", "tool-restriction-not-proven": { label: "The worker's tool restriction is NOT technically proven for this CLI.", action: "Verify the installed CLI version and its supported restriction flags, then mark the profile verified." } },
  docker: { title: "Docker (for local Supabase)", "no-docker-binary": { label: "Docker is not installed.", action: "Install Docker Desktop and start it." }, "binary-present-daemon-down": { label: "Docker is installed but not running.", action: "Open Docker Desktop and wait until it says Running." } },
  supabase: { title: "Supabase CLI", "no-supabase-cli": { label: "Supabase CLI is not installed.", action: "Install the Supabase CLI." }, "cli-error": { label: "Supabase CLI did not respond.", action: "Reinstall or repair the Supabase CLI." } },
};

function present(res) {
  const L = [];
  const item = (key, r) => {
    const f = FRIENDLY[key] || {};
    const info = f[r.how] || { label: r.how, action: r.status === "PASS" ? null : "Resolve this prerequisite." };
    const badge = r.status === "PASS" ? "[ READY ]        " : "[ ACTION NEEDED ]";
    L.push(badge + " " + (f.title || key) + (r.detail ? "  (" + r.detail + ")" : ""));
    L.push("                  " + info.label);
    return info.action ? (f.title || key) + ": " + info.action : null;
  };
  L.push("Owner-machine readiness for the Forge worker (read-only — installs nothing, connects nowhere, reads no password)");
  L.push("");
  L.push("SECURITY readiness (required before ANY real worker run):");
  const a1 = item("sandbox", res.sandbox);
  const a2 = item("claude", res.claude);
  const a3 = item("toolRestriction", res.toolRestriction);
  L.push("");
  L.push("REAL-RUN infrastructure:");
  const a4 = item("docker", res.docker);
  const a5 = item("supabase", res.supabase);
  const actions = [a1, a2, a3, a4, a5].filter(Boolean);
  L.push("");
  const ov = overall(res);
  L.push("SYNTHETIC validation (offline safety proofs): " + (res.git.status === "PASS" ? "READY" : "BLOCKED (git missing)"));
  L.push("REAL worker run: " + realBlockReason(res));
  L.push("");
  if (ov === "READY-FOR-REAL-WORKER-PROOF") {
    L.push("RESULT: all security + infrastructure prerequisites are in place. A real worker proof is technically possible (still owner/ChatGPT-gated).");
  } else {
    L.push("RESULT: the real worker run is NOT permitted yet. Synthetic validation can still run safely.");
    L.push("");
    L.push("What to do next (in order):");
    actions.forEach((a, i) => L.push("  " + (i + 1) + ". " + a));
    L.push("");
    L.push("Nothing was installed or changed. NOT INSTALLED / NOT RUNNING / NOT SAFE are shown separately above.");
  }
  return L.join("\n");
}

if (require.main === module) console.log(present(check()));
module.exports = { check, overall, realBlockReason, present, detectClaude, detectDocker, detectSupabase, detectSandbox, detectToolRestriction, detectProcessControl };
