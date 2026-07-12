"use strict";
/**
 * Governed local Claude Code worker adapter — PROJECTOS-FORGE-REAL-E2E-ACTIVATION (Gate 1 architecture).
 *
 * Invokes the owner's LOCALLY-AUTHENTICATED Claude Code CLI in non-interactive ("print") mode to perform a
 * bounded, allowlisted change inside a VERIFIED repository — with NO Anthropic/OpenAI API key, NO metered
 * API, NO credential copying, and NO raw broad-autonomy shell. It relies entirely on the CLI's own
 * existing session; this adapter never touches auth material.
 *
 * Hard safeguards, all BEFORE and AROUND the spawn:
 *  - repoRoot is resolved/verified INSIDE a trusted allowedRoot (never taken from the prompt/document);
 *  - the working branch must equal the expected branch;
 *  - a clean-tree policy is enforced when required;
 *  - the CLI binary path comes from TRUSTED config, never from the task/document;
 *  - the process is spawned with an argv array (no shell) → no shell injection;
 *  - a hard timeout kills the process (tree-kill on Windows);
 *  - stdout is capped (kills on overflow) so a runaway worker can't flood;
 *  - the response is redacted (secrets scrubbed) and validated;
 *  - after the run, the ACTUAL changed files are derived from git and checked against an allowlist —
 *    a change outside the allowed paths, or to ProjectOS's own source, is a failure.
 *  Claude cannot approve/close a phase; this adapter only executes a bounded task and returns evidence.
 *
 * NOTE: the REAL invocation requires the `claude` CLI on the machine. Where it is absent (e.g. this
 * sandbox) the adapter's guards are proven against a synthetic CLI stand-in; the real round-trip is an
 * owner-machine step. `spawnFn` is injectable for exactly this.
 */

const { execFileSync } = require("child_process");
const path = require("path");
const { createRedactor } = require("../security/redaction.cjs");

const DEFAULTS = Object.freeze({ timeoutMs: 120000, maxOutputBytes: 2 * 1024 * 1024, maxPromptChars: 8000 });
// Defence-in-depth: mask obvious secret shapes in worker output even if they were never registered for
// redaction (the CLI may echo secrets it read from files we don't know about).
const GENERIC_SECRET = /(-----BEGIN[\s\S]{0,64}?PRIVATE KEY-----|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9]{6,}|AKIA[0-9A-Z]{12,})/g;

function resolveInside(target, allowedRoot) {
  const root = path.resolve(allowedRoot);
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) return null;
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootSep)) return null;
  return resolved;
}

function gitIn(repoRoot, args) {
  return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" }).trim();
}

/**
 * Every path touched in the working tree — BOTH sides of a rename/copy — from NUL-delimited porcelain
 * (`-z` is unquoted, so no C-quoting can hide a path). A staged rename that moves a protected file out of
 * the allowlist must be caught on its ORIGIN, not only its destination.
 */
function changedFiles(repoRoot) {
  const out = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "-z"], { encoding: "utf8" });
  const tok = out.split("\0").filter((t) => t.length > 0);
  const paths = [];
  for (let i = 0; i < tok.length; i++) {
    const rec = tok[i];
    const xy = rec.slice(0, 2);
    paths.push(rec.slice(3)); // the record's path (dest for a rename)
    if (/[RC]/.test(xy) && i + 1 < tok.length) { paths.push(tok[i + 1]); i++; } // origin of a rename/copy
  }
  return paths;
}

function isAllowedPath(p, allowedPaths) {
  if (p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return allowedPaths.some((a) => p === a || p.startsWith(a.endsWith("/") ? a : a + "/"));
}

/**
 * Run one bounded worker task.
 * @param req    { prompt, projectId, expectedBranch, allowedPaths[], requireClean? }
 * @param config TRUSTED: { projectRoots:{[id]:absRoot}, claudeBin, claudeArgs?(prompt)->[], spawnFn?,
 *               timeoutMs?, maxOutputBytes?, maxPromptChars?, redactor? }
 * @returns { ok, decision, reason?, changedFiles?, refusedPaths?, output?, exitCode? }
 */
function runClaudeWorker(req, config) {
  const r = req || {};
  const c = config || {};
  const redactor = c.redactor || createRedactor();
  const timeoutMs = c.timeoutMs || DEFAULTS.timeoutMs;
  const maxOutputBytes = c.maxOutputBytes || DEFAULTS.maxOutputBytes;
  const maxPromptChars = c.maxPromptChars || DEFAULTS.maxPromptChars;

  if (typeof r.prompt !== "string" || !r.prompt.trim()) return { ok: false, decision: "REFUSED", reason: "empty-prompt" };
  if (r.prompt.length > maxPromptChars) return { ok: false, decision: "REFUSED", reason: "prompt-too-long" };
  if (typeof r.projectId !== "string" || !r.projectId) return { ok: false, decision: "REFUSED", reason: "no-project" };

  // Repo root ONLY from the trusted registry, never from the request/document.
  const roots = c.projectRoots || {};
  const rootBase = Object.prototype.hasOwnProperty.call(roots, r.projectId) ? roots[r.projectId] : null;
  if (!rootBase) return { ok: false, decision: "REFUSED", reason: "no-trusted-root" };
  const repoRoot = resolveInside(".", rootBase);
  if (!repoRoot) return { ok: false, decision: "REFUSED", reason: "root-escape" };

  // Branch verification.
  let branch;
  try { branch = gitIn(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]); }
  catch (e) { return { ok: false, decision: "REFUSED", reason: "not-a-git-repo" }; }
  if (r.expectedBranch && branch !== r.expectedBranch) return { ok: false, decision: "REFUSED", reason: "branch-mismatch:" + branch };

  // Clean-tree policy.
  if (r.requireClean) {
    const dirty = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
    if (dirty) return { ok: false, decision: "REFUSED", reason: "working-tree-dirty" };
  }

  // The CLI binary is trusted config; never derived from the task/document.
  if (typeof c.claudeBin !== "string" || !c.claudeBin) return { ok: false, decision: "BLOCKED", reason: "claude-cli-not-configured" };
  // Reject a prompt that starts with "-" so it can never be reinterpreted as a CLI flag (defence in depth
  // on top of `-p` consuming it as a value).
  if (r.prompt.trim().startsWith("-")) return { ok: false, decision: "REFUSED", reason: "prompt-looks-like-flag" };
  const argv = typeof c.claudeArgs === "function" ? c.claudeArgs(r.prompt) : ["-p", r.prompt];
  const spawnFn = c.spawnFn || require("child_process").spawn;
  const posix = process.platform !== "win32";

  // Spawn with an argv array (no shell), bounded output + timeout. On POSIX, detach into its own process
  // group so a tree-kill reaches grandchildren the real CLI may spawn.
  let stdout = "";
  let killedFor = null;
  const child = spawnFn(c.claudeBin, argv, { cwd: repoRoot, shell: false, detached: posix });
  const killTree = () => {
    try {
      if (!posix) execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else { try { process.kill(-child.pid, "SIGKILL"); } catch (e) { child.kill("SIGKILL"); } }
    } catch (e) { /* best effort */ }
  };
  const timer = setTimeout(() => { killedFor = "timeout"; killTree(); }, timeoutMs);

  return new Promise((resolve) => {
    child.stdout && child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (Buffer.byteLength(stdout, "utf8") > maxOutputBytes) { killedFor = "output-overflow"; killTree(); }
    });
    // Drain stderr (bounded) so a chatty worker can't block on a full stderr pipe.
    let stderrBytes = 0;
    child.stderr && child.stderr.on("data", (d) => { stderrBytes += d.length; if (stderrBytes > maxOutputBytes) { killedFor = "stderr-overflow"; killTree(); } });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, decision: "REFUSED", reason: "spawn-error:" + e.code }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killedFor) return resolve({ ok: false, decision: "REFUSED", reason: killedFor });
      // Derive the ACTUAL changed files (both sides of a rename) and enforce the allowlist (never
      // touching ProjectOS source).
      let changed = [];
      try { changed = changedFiles(repoRoot); } catch (e) { /* ignore */ }
      const allowed = Array.isArray(r.allowedPaths) ? r.allowedPaths : [];
      const refusedPaths = changed.filter((p) => !isAllowedPath(p, allowed) || p.startsWith("projectos/"));
      const output = redactor.redactText(stdout).replace(GENERIC_SECRET, "«redacted»").slice(0, 4000);
      if (refusedPaths.length) return resolve({ ok: false, decision: "REFUSED", reason: "forbidden-path-change", refusedPaths, changedFiles: changed, output, exitCode: code });
      resolve({ ok: code === 0, decision: code === 0 ? "COMPLETED" : "FAILED", changedFiles: changed, output, exitCode: code });
    });
  });
}

module.exports = { runClaudeWorker, resolveInside, isAllowedPath, DEFAULTS };
