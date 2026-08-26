"use strict";
/**
 * One absolute, validated `cargo` — never a bare command name, and never an ambient PATH.
 *
 * WHY THIS EXISTS. Thirty validators built Rust fixtures with `spawnSync("cargo", ...)`. That works
 * in a developer terminal and cannot work where it actually matters: the governed daemon is launched
 * with NO PATH AT ALL — the host allowlist omits it, and `validate()` rejects it by name — so a bare
 * `cargo` resolves to nothing and every one of those validators died on ENOENT with an empty error.
 * The loop then reported `validate-all` as FAILING when, run by hand, it passes 131/131. A check that
 * reports a false failure is worse than a check that does not run: it makes the owner distrust a gate
 * that is working.
 *
 * The same defect, in the same shape, as the bare `git` this repository closed in
 * `worker/bound-git.cjs` — and this deliberately mirrors that module rather than inventing a second
 * idea of what "trusted executable" means.
 *
 * RESOLUTION ORDER. All absolute, none of it searching the working directory, none of it a name:
 *   1. `CARGO_HOME/bin/cargo` — rustup's own documented relocation variable. It names a DIRECTORY
 *      whose canonical binary is then validated like any other candidate; it is not, and must not
 *      become, a way to hand this function an arbitrary executable to run. There is deliberately no
 *      `PROJECTOS_CARGO_EXE`: an executable path taken straight from the environment is exactly the
 *      caller-supplied binary this module exists to refuse.
 *   2. DERIVED FROM `LOCALAPPDATA` — rustup's default install location under the user profile.
 *      `%LOCALAPPDATA%` is `<profile>\AppData\Local`, so the profile is two levels up and the
 *      toolchain sits at `<profile>\.cargo\bin`. This is the branch that makes the daemon work, and
 *      it needs no new environment surface: LOCALAPPDATA is ALREADY allowlisted, for the governed
 *      loop's own state directory. Deriving a path from a variable the daemon already carries is the
 *      same move `bash.exe` makes from a resolved `git.exe` — not an inheritance, a derivation.
 *   3. The first absolute PATH entry holding a cargo, SKIPPING anything inside the governed root, for
 *      the developer terminal where a PATH does exist. A repository that can put itself on PATH is
 *      not a repository that gets to choose the compiler deciding whether its own phase passes.
 *
 * EVERY branch is validated identically: absolute, not UNC, named exactly `cargo`, a real file, and
 * NOT INSIDE THE GOVERNED CHECKOUT. That last one is applied to the environment branch too — a
 * stricter contract than the env branch in `bound-git.cjs`, which does not check it.
 *
 * Nothing here weakens the daemon's PATH prohibition. The daemon still receives no PATH; what a
 * spawned cargo receives is COMPOSED from the executable this module resolved, never inherited.
 *
 * Created in PROJECTOS-PRODUCT-COMPLETION1A under the gatekeeper's Route B ruling.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CARGO_NAME = process.platform === "win32" ? "cargo.exe" : "cargo";
const CARGO_BASENAME = process.platform === "win32" ? /^cargo\.exe$/i : /^cargo$/;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (_) {
    return false;
  }
}

/** A UNC path names a host, and a host is not something this machine's trust extends to. */
function isUnc(p) {
  return p.startsWith("\\\\") || p.startsWith("//");
}

/**
 * The real location of a path, or its lexical form when it does not exist.
 *
 * A path that is not there cannot be a link to anywhere, so falling back is not failing open.
 */
function realPath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch (_) {
    return path.resolve(p);
  }
}

/**
 * Is `child` the same as, or beneath, `parent`? RESOLVED THROUGH THE FILESYSTEM, NOT LEXICALLY.
 *
 * `path.resolve` only normalises text. It cannot see a directory junction or a symlink, so a link
 * that lives OUTSIDE the governed checkout but points INTO it compares as "outside" and this guard
 * waves it through — which is precisely how a cargo inside the tree being governed would get to
 * decide whether that tree passes. On Windows an unprivileged user can create a junction, so this
 * is not theoretical. Both sides are resolved to their real locations before they are compared.
 *
 * The earlier version of this function was lexical AND its docstring said "compared as the
 * filesystem resolves them" — a claim the code did not earn, which is worse than the gap itself.
 * Found by the gatekeeper's security review of this module (SEC-003); `worker/bound-git.cjs`
 * carried the identical gap and is corrected in the same way.
 */
function isInside(parent, child) {
  if (typeof parent !== "string" || parent.length === 0) return false;
  const r = realPath(parent);
  const d = realPath(child);
  if (process.platform === "win32") {
    const rl = r.toLowerCase();
    const dl = d.toLowerCase();
    return dl === rl || dl.startsWith(rl.endsWith(path.sep) ? rl : rl + path.sep);
  }
  return d === r || d.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** The one gate every candidate passes, wherever it came from. */
function acceptable(candidate, root) {
  return (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    path.isAbsolute(candidate) &&
    !isUnc(candidate) &&
    CARGO_BASENAME.test(path.basename(candidate)) &&
    isFile(candidate) &&
    !isInside(root, candidate)
  );
}

/** Resolve the absolute cargo executable, or null. Pure apart from `fs.statSync`. */
function resolveCargo(root, env) {
  const e = env || process.env;

  const cargoHome = e.CARGO_HOME;
  if (typeof cargoHome === "string" && cargoHome.length > 0 && path.isAbsolute(cargoHome)) {
    const candidate = path.join(cargoHome, "bin", CARGO_NAME);
    if (acceptable(candidate, root)) return candidate;
  }

  // The daemon branch. `%LOCALAPPDATA%` is `<profile>\AppData\Local`; rustup installs to
  // `<profile>\.cargo`. On a POSIX host there is no LOCALAPPDATA, so HOME plays the same role.
  const local = e.LOCALAPPDATA;
  const home = e.HOME;
  const profile =
    typeof local === "string" && local.length > 0 && path.isAbsolute(local)
      ? path.dirname(path.dirname(local))
      : typeof home === "string" && home.length > 0 && path.isAbsolute(home)
        ? home
        : null;
  if (profile !== null) {
    const candidate = path.join(profile, ".cargo", "bin", CARGO_NAME);
    if (acceptable(candidate, root)) return candidate;
  }

  for (const dir of String(e.PATH === undefined ? "" : e.PATH).split(path.delimiter)) {
    if (typeof dir !== "string" || dir.length === 0) continue;
    if (!path.isAbsolute(dir) || isUnc(dir)) continue;
    if (isInside(root, dir)) continue;
    const candidate = path.join(dir, CARGO_NAME);
    if (acceptable(candidate, root)) return candidate;
  }
  return null;
}

/**
 * A cargo runner bound to one absolute executable.
 *
 * Returns `cargo(args, options) -> spawnSync result`. When nothing resolved it returns a SYNTHETIC
 * failure rather than throwing, so a validator reports a refusal with a readable reason instead of
 * crashing the whole `validate-all` run — and so the reason names the toolchain rather than reading
 * like a fixture that would not compile. Failing closed is correct; failing closed illegibly is not.
 *
 * THE CHILD PATH IS COMPOSED, NOT INHERITED. `cargo.exe` under `.cargo\bin` is a rustup shim that
 * resolves `rustc` as a sibling, so the child needs that ONE directory reachable. It is the directory
 * of the executable this module just validated — derived from the resolution, not from the ambient
 * environment — and it is prepended to whatever PATH the caller already had (in the daemon, none).
 */
function boundCargo(root, env) {
  const exe = resolveCargo(root, env);
  const run = (args, options) => {
    if (exe === null) {
      return {
        status: 127,
        stdout: "",
        stderr:
          "ProjectOS could not bind a cargo executable, so this Rust fixture was not built. " +
          "Looked at CARGO_HOME/bin, the rustup default under the user profile derived from LOCALAPPDATA, " +
          "and absolute PATH entries outside the governed checkout. No fact about the code was established.",
        error: new Error("cargo not bound"),
      };
    }
    const opts = options || {};
    const childEnv = opts.env || process.env;
    const exeDir = path.dirname(exe);
    const existing = typeof childEnv.PATH === "string" && childEnv.PATH.length > 0 ? childEnv.PATH : "";
    return spawnSync(exe, args, {
      ...opts,
      env: { ...childEnv, PATH: existing === "" ? exeDir : exeDir + path.delimiter + existing },
      shell: false,
    });
  };
  run.executable = exe;
  return run;
}

module.exports = { CARGO_NAME, resolveCargo, boundCargo, isInside };
