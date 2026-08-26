"use strict";
/**
 * One absolute, validated `git` — never a bare command name.
 *
 * WHY. On Windows an unqualified executable name is resolved against the spawning process's CURRENT
 * DIRECTORY before it falls through to PATH. Every one of these components runs with `cwd` set to
 * the governed checkout, and the governed checkout is UNTRUSTED CONTENT until the owner has reviewed
 * it — that is the entire premise of the commit gate. So a file named `git.exe` sitting in the
 * repository would be executed in place of Git, by the process that holds the ownership lock and
 * writes governance records. It would not even need to run code to do damage: returning a forged
 * HEAD, branch, or "clean" status is enough to make the closure gate believe facts that are not
 * true.
 *
 * This repository already learned this once. `control-center/sidecar/gitBoundSystem.mjs` binds one
 * absolute `git.exe` for the daemon and refuses to fall back to an ambient PATH, on exactly this
 * reasoning. The worker and validator paths were spawning `"git"` by name; this closes that.
 *
 * RESOLUTION ORDER, all absolute, none of it searching the working directory:
 *   1. `PROJECTOS_GIT_EXE`, if it is absolute and named like git — the host's binding, same contract
 *      as the sidecar's.
 *   2. The first absolute PATH entry containing a git executable, SKIPPING any directory inside the
 *      governed root. A repository that can add itself to PATH is not a repository that gets to
 *      choose the binary deciding whether its own phase may close.
 *
 * There is no third step. When nothing resolves, every caller gets a failure and every fact derived
 * from git fails closed — which refuses, and refusing is correct.
 *
 * Created in PROJECTOS-V3-RELIABILITY-HARDENING1A after a security review found the bare-name calls.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GIT_NAMES = process.platform === "win32" ? ["git.exe"] : ["git"];
const GIT_BASENAME = process.platform === "win32" ? /^git\.exe$/i : /^git$/;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * Is `dir` inside `root`? Used to refuse a git found within the governed checkout itself.
 *
 * RESOLVED THROUGH THE FILESYSTEM, NOT LEXICALLY. `path.resolve` only normalises text, so a
 * directory junction or symlink living outside the checkout but pointing into it compared as
 * "outside" and this guard waved it through — the one thing it exists to stop. On Windows an
 * unprivileged user can create a junction, so it is not theoretical. A path that does not exist
 * cannot be a link to anywhere, so it falls back to the lexical form rather than failing open.
 *
 * Found by the gatekeeper's security review of the sibling `validators/lib/bound-cargo.cjs`
 * (SEC-003), which named this file as carrying the identical gap. Corrected identically.
 */
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch (_) {
    return path.resolve(p);
  }
}

function isInside(root, dir) {
  if (typeof root !== "string" || root.length === 0) return false;
  const r = realPath(root);
  const d = realPath(dir);
  if (d === r) return true;
  return d.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** Resolve the absolute git executable, or null. Pure apart from `fs.statSync`. */
function resolveGit(root, env) {
  const e = env || process.env;
  const bound = e.PROJECTOS_GIT_EXE;
  if (typeof bound === "string" && bound.length > 0 && path.isAbsolute(bound) && GIT_BASENAME.test(path.basename(bound)) && isFile(bound)) {
    return bound;
  }
  const entries = String(e.PATH === undefined ? "" : e.PATH).split(path.delimiter);
  for (const dir of entries) {
    if (typeof dir !== "string" || dir.length === 0) continue;
    if (!path.isAbsolute(dir)) continue; // a relative PATH entry resolves against cwd — refuse it
    if (isInside(root, dir)) continue; // never a binary from the tree being governed
    for (const name of GIT_NAMES) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A git runner bound to one absolute executable. Returns `git(args) -> string | null`, where null is
 * ANY failure — including "no git could be bound" — so callers that already treat null as
 * "fact not established" keep failing closed without a second error path.
 */
function boundGit(root, env) {
  const exe = resolveGit(root, env);
  const run = (args) => {
    if (exe === null) return null;
    try {
      return execFileSync(exe, ["-C", root].concat(args), {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
      }).trim();
    } catch (_) {
      return null;
    }
  };
  run.executable = exe;
  return run;
}

module.exports = { GIT_NAMES, resolveGit, boundGit, isInside };
