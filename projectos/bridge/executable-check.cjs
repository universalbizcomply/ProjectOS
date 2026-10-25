"use strict";
/**
 * ONE shared executable-validation function used by BOTH owner-capability-check and the worker adapter —
 * PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§7). It guarantees the capability check cannot report
 * READY for an executable the adapter would refuse. An existence-only check is NOT sufficient.
 *
 * Checks: resolved absolute path · supported file type · actual `--version` invocation · invocation timeout ·
 * shell:false compatibility · no unsafe shim (.cmd/.bat/.ps1 on Windows) · path never from task content.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const UNSAFE_SHIM = /\.(cmd|bat|ps1)$/i;

/** Resolve a bare command name to an absolute path via where/which; pass through an absolute path. */
function resolveAbsolute(bin) {
  if (!bin || typeof bin !== "string") return null;
  if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
  try {
    const tool = process.platform === "win32" ? "where" : "which";
    const out = execFileSync(tool, [bin], { encoding: "utf8", timeout: 6000, stdio: ["ignore", "pipe", "ignore"] });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first && fs.existsSync(first) ? first : null;
  } catch (e) { return null; }
}

/**
 * Validate an executable. `opts.invoke` (default true) actually runs `--version`.
 * @returns { ok, reason, resolvedPath, version, isShim }
 */
function validateExecutable(bin, opts) {
  const o = opts || {};
  if (typeof bin !== "string" || !bin) return { ok: false, reason: "not-configured" };
  if (process.platform === "win32" && UNSAFE_SHIM.test(bin)) return { ok: false, reason: "unsafe-shim", isShim: true };
  const resolved = resolveAbsolute(bin);
  if (!resolved) return { ok: false, reason: "not-found" };
  if (process.platform === "win32" && UNSAFE_SHIM.test(resolved)) return { ok: false, reason: "unsafe-shim", resolvedPath: resolved, isShim: true };
  // Also reject when the realpath target is a shim (a link named `claude` pointing at `claude.cmd`).
  if (process.platform === "win32") { try { const real = fs.realpathSync(resolved); if (UNSAFE_SHIM.test(real)) return { ok: false, reason: "unsafe-shim", resolvedPath: resolved, isShim: true }; } catch (e) { /* ignore */ } }
  // Supported file type: a real file (not a directory); on posix, must be executable.
  let st;
  try { st = fs.statSync(resolved); } catch (e) { return { ok: false, reason: "stat-failed", resolvedPath: resolved }; }
  if (!st.isFile()) return { ok: false, reason: "not-a-file", resolvedPath: resolved };
  if (process.platform !== "win32" && !(st.mode & 0o111)) return { ok: false, reason: "not-executable", resolvedPath: resolved };
  if (o.invoke === false) return { ok: true, reason: "resolved-not-invoked", resolvedPath: resolved };
  // Actual invocation with a bounded timeout, shell:false (execFile never uses a shell).
  try {
    const out = execFileSync(resolved, [o.versionArg || "--version"], { encoding: "utf8", timeout: o.timeoutMs || 8000, stdio: ["ignore", "pipe", "ignore"] });
    const version = String(out).trim().split("\n")[0].slice(0, 80);
    return { ok: true, reason: "invoked", resolvedPath: resolved, version };
  } catch (e) { return { ok: false, reason: "invocation-failed", resolvedPath: resolved }; }
}

module.exports = { validateExecutable, resolveAbsolute, UNSAFE_SHIM };
