// THE GOVERNED VALIDATOR SCRATCH-DIRECTORY LIFECYCLE.
//
// Validators copy crates into %TEMP% and run Cargo there. Before this helper, 17 of 26 creation routes
// never deleted anything, which leaked tens of GB. Every scratch directory is now OWNED: created here,
// tracked here, and deleted here — on success, failure, expected compile failure, mutation caught or
// missed, child-process non-zero exit, and thrown exception.
//
// It deletes ONLY directories it created itself. A caller-supplied arbitrary path is refused, so no
// repository path, TEMP sibling, reparse point or containment escape can be removed through it.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

/// Every path this process created, and may therefore delete. Membership is the delete authority.
const OWNED = new Set();
let exitHookInstalled = false;

/// The resolved current-user TEMP directory. Resolved (not just joined) so a symlinked TEMP still
/// compares correctly against candidate paths.
function tempRoot() {
  return fs.realpathSync(os.tmpdir());
}

/// Whether `p` is a direct child of TEMP, prefixed `projectos-`, and not a reparse point.
function isSafeOwnedShape(p) {
  const root = tempRoot();
  const resolved = path.resolve(p);
  if (path.dirname(resolved) !== root) return false;
  if (!path.basename(resolved).startsWith("projectos-")) return false;
  if (!resolved.startsWith(root + path.sep)) return false;
  try {
    // lstat, not stat: a reparse point must be detected, not followed.
    if (fs.lstatSync(resolved).isSymbolicLink()) return false;
  } catch {
    return false;
  }
  return true;
}

/// Delete every still-owned directory. Installed as a process-exit hook so an uncaught exception, a
/// `process.exit()` from a failing validator, or an early return still cleans up.
function cleanupAll() {
  for (const p of [...OWNED]) {
    try {
      cleanup(p);
    } catch {
      // cleanupAll is best-effort by design; `cleanup` already reported the failure.
    }
  }
}

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Synchronous rmSync works inside an exit handler; async cleanup would not run.
  process.on("exit", cleanupAll);
  // `exit` does NOT fire when the process is terminated by a signal, so an interrupted suite left
  // its whole Cargo scratch tree behind — the observed multi-hundred-MB leak. Clean up, then drop
  // our own handler and re-raise, so the default disposition still decides the exit status and the
  // interrupt is not swallowed.
  // 128 + signal number is the conventional shell exit status, used when a signal cannot be re-raised.
  const CONVENTIONAL_EXIT = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143, SIGBREAK: 149 };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    const onSignal = () => {
      cleanupAll();
      process.removeListener(sig, onSignal);
      try {
        // Re-raise so the default disposition decides the status and the interrupt is not swallowed.
        process.kill(process.pid, sig);
      } catch {
        // Windows rejects re-raising some signals (SIGBREAK/SIGHUP throw ENOSYS). Terminating with the
        // conventional status is required: an uncaught throw here would turn cleanup into a crash.
        process.exit(CONVENTIONAL_EXIT[sig] || 1);
      }
    };
    try {
      process.on(sig, onSignal);
    } catch {
      // Not every signal name exists on every platform; the remaining ones still install.
    }
  }
}

/// Create an OWNED scratch directory beneath TEMP and return its exact absolute path.
///
/// `tag` names the validator; the real directory gets a random suffix, so concurrent runs never collide
/// and one run can never delete another's directory.
function owned(tag) {
  if (typeof tag !== "string" || !/^[a-z0-9-]+$/.test(tag)) {
    throw new Error("scratch: tag must be lower-case kebab-case");
  }
  const dir = fs.mkdtempSync(path.join(tempRoot(), "projectos-" + tag + "-"));
  const resolved = path.resolve(dir);
  if (!isSafeOwnedShape(resolved)) {
    // Refuse to hand back anything we could not safely delete later.
    try {
      fs.rmSync(resolved, { recursive: true, force: true });
    } catch {
      /* nothing further we can safely do */
    }
    throw new Error("scratch: created path failed the containment/shape check");
  }
  OWNED.add(resolved);
  installExitHook();
  return resolved;
}

/// Delete one owned scratch directory.
///
/// Refuses any path this process did not create — that single check is what makes a repository path,
/// a TEMP sibling or an escaped path impossible to remove here, regardless of what a caller passes.
///
/// Returns `null` on success, or a `{ path, category }` report on failure. It NEVER throws and never
/// alters a validation result: a cleanup failure is reported alongside the result, never instead of it.
function cleanup(p) {
  const resolved = path.resolve(p);
  if (!OWNED.has(resolved)) {
    return { path: resolved, category: "not-owned-by-this-process" };
  }
  if (!isSafeOwnedShape(resolved)) {
    OWNED.delete(resolved);
    return { path: resolved, category: "containment-or-shape-check-failed" };
  }
  try {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    OWNED.delete(resolved);
    return null;
  } catch (e) {
    // Left owned on purpose: the exit hook retries once more.
    return { path: resolved, category: e && e.code ? String(e.code) : "remove-failed" };
  }
}

/// Run `fn(dir)` with an owned scratch directory, deleting it in a `finally` regardless of outcome.
///
/// This is the preferred entry point: cleanup is structural, so it survives an early return, a thrown
/// exception, a caught mutation and a failing child process alike. A cleanup failure is written to
/// stderr and never changes what `fn` returned or threw.
function withScratch(tag, fn) {
  const dir = owned(tag);
  try {
    return fn(dir);
  } finally {
    const failure = cleanup(dir);
    if (failure) {
      console.error(
        "[scratch] cleanup failed: " + failure.path + " (" + failure.category + ")"
      );
    }
  }
}

/// Test-only view of the owned set.
function ownedPathsForTest() {
  return [...OWNED];
}

module.exports = { owned, cleanup, cleanupAll, withScratch, ownedPathsForTest, isSafeOwnedShape };
