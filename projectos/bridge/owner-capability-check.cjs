"use strict";
/**
 * Owner-machine capability check for the real Forge E2E (PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A,
 * §10). SAFE + read-only: it only DETECTS whether the prerequisites exist. It:
 *   - reveals NO credentials and prints NO token values,
 *   - performs NO installation and NO provider connection,
 *   - makes NO repository change,
 *   - does NOT assume the Claude executable path (probes PATH + common locations + a desktop/session hint).
 *
 * Output: a PASS/BLOCKED capability matrix. Run on the owner machine BEFORE requesting the real round-trip.
 * This module never launches the worker; it is a gate for whether the real run is even possible.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function tryExec(bin, args) {
  try {
    const out = execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 });
    return { ok: true, out: String(out).trim().split("\n")[0].slice(0, 80) };
  } catch (e) { return { ok: false, out: null }; }
}

function onPath(bin) {
  const probe = process.platform === "win32" ? tryExec("where", [bin]) : tryExec("which", [bin]);
  return probe.ok;
}

/** Detect a spawnable Claude CLI without assuming its path. Never reads its config/credentials. */
function detectClaude() {
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude"] : ["claude"];
  for (const n of names) {
    if (onPath(n)) { const v = tryExec(n, ["--version"]); if (v.ok) return { status: "PASS", how: "cli-on-path", detail: n }; }
  }
  // Common local install dirs (existence only — no content read).
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [
    path.join(home, ".claude", "local", "claude"),
    path.join(home, "AppData", "Local", "Programs", "claude", "claude.exe"),
    path.join(home, ".local", "bin", "claude"),
  ];
  for (const p of candidates) { try { if (fs.existsSync(p)) return { status: "PASS", how: "cli-file", detail: path.basename(p) }; } catch (e) { /* ignore */ } }
  // No spawnable CLI. Report a desktop/session hint WITHOUT reading any auth material.
  const desktopHint = !!(process.env.CLAUDE_CODE_SESSION || process.env.CLAUDECODE || process.env.CLAUDE_DESKTOP);
  return { status: "BLOCKED", how: desktopHint ? "session-present-but-no-spawnable-cli" : "no-cli", detail: null };
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

function check() {
  return {
    platform: process.platform,
    node: process.version,
    claude: detectClaude(),
    docker: detectDocker(),
    supabase: detectSupabase(),
  };
}

function overall(res) {
  return res.claude.status === "PASS" && res.docker.status === "PASS" && res.supabase.status === "PASS"
    ? "READY-FOR-REAL-E2E" : "BLOCKED-OWNER-MACHINE-CAPABILITY";
}

// Owner-facing presentation: plain language, one clear next action per item, no machine jargon, no secrets.
// Each entry maps a machine `how` code to { label, action }. `label` says what the owner has; `action` is
// the single next step when it is not ready.
const FRIENDLY = {
  claude: {
    title: "Claude Code worker",
    "cli-on-path": { label: "Ready — Claude command found.", action: null },
    "cli-file": { label: "Ready — Claude app found.", action: null },
    "session-present-but-no-spawnable-cli": { label: "A Claude session is signed in, but no runnable `claude` command is on this machine.", action: "Install the Claude Code CLI so a `claude` command exists, then re-run this check." },
    "no-cli": { label: "No Claude Code worker found.", action: "Install and sign in to the Claude Code CLI on this machine, then re-run this check." },
  },
  docker: {
    title: "Docker (for local Supabase)",
    "daemon-running": { label: "Ready — Docker is installed and running.", action: null },
    "no-docker-binary": { label: "Docker is not installed.", action: "Install Docker Desktop and start it, then re-run this check." },
    "binary-present-daemon-down": { label: "Docker is installed but not running.", action: "Open Docker Desktop and wait until it says Running, then re-run this check." },
  },
  supabase: {
    title: "Supabase CLI",
    "cli-present": { label: "Ready — Supabase CLI found.", action: null },
    "no-supabase-cli": { label: "Supabase CLI is not installed.", action: "Install the Supabase CLI, then re-run this check." },
    "cli-error": { label: "Supabase CLI did not respond.", action: "Reinstall or repair the Supabase CLI, then re-run this check." },
  },
};

function present(res) {
  const lines = [];
  const items = [["claude", res.claude], ["docker", res.docker], ["supabase", res.supabase]];
  const actions = [];
  lines.push("Owner-machine readiness check for the real Forge end-to-end test");
  lines.push("(read-only — this does not install anything, connect anywhere, or read any password)");
  lines.push("");
  for (const [key, r] of items) {
    const f = FRIENDLY[key] || {};
    const info = f[r.how] || { label: r.how, action: r.status === "PASS" ? null : "Resolve this prerequisite, then re-run this check." };
    const badge = r.status === "PASS" ? "[ READY ]        " : "[ ACTION NEEDED ]";
    lines.push(badge + " " + (f.title || key) + (r.detail ? "  (" + r.detail + ")" : ""));
    lines.push("                  " + info.label);
    if (info.action) actions.push((f.title || key) + ": " + info.action);
  }
  lines.push("");
  const ready = overall(res) === "READY-FOR-REAL-E2E";
  if (ready) {
    lines.push("RESULT: READY — all prerequisites are in place. The real Forge worker + Supabase test can run.");
  } else {
    lines.push("RESULT: NOT READY — the real Forge worker + Supabase test cannot run on this machine yet.");
    lines.push("");
    lines.push("What to do next (in order):");
    actions.forEach((a, i) => lines.push("  " + (i + 1) + ". " + a));
    lines.push("");
    lines.push("Nothing was installed or changed. Re-run this check after each step until every item says READY.");
  }
  return lines.join("\n");
}

if (require.main === module) {
  console.log(present(check()));
}

module.exports = { check, overall, present, detectClaude, detectDocker, detectSupabase };
