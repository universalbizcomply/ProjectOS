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
 * THE MSVC TOOLCHAIN, DERIVED — because resolving cargo is not enough to build anything.
 *
 * FOUND BY RUNNING IT, NOT BY READING IT. With cargo bound, the validators still failed on the
 * INSTALLED application while passing in a hand-built reproduction. The reproduction was wrong: the
 * real daemon carries FIVE variables (SystemRoot, LOCALAPPDATA, PROJECTOS_GIT_EXE,
 * CLAUDE_CODE_GIT_BASH_PATH, PROJECTOS_DAEMON_INSTANCE_ID) and no TEMP, no windir, no PATH. Under
 * that environment cargo runs and rustc runs, and then linking dies with:
 *
 *     `link.exe` not found ... the msvc targets depend on the msvc linker
 *
 * Rust's msvc target needs the Visual Studio linker and its INCLUDE/LIB search paths, and those are
 * published through the environment — exactly the thing the daemon does not have.
 *
 * HOW THIS STAYS A DERIVATION. Every step starts from a variable the daemon already carries and
 * ends at a validated absolute path. Nothing ambient is read and nothing machine-specific is
 * committed:
 *
 *   SystemRoot -> its drive -> <drive>\Program Files (x86)\...\Installer\vswhere.exe
 *              -> vswhere reports the VS installation root
 *              -> <root>\VC\Auxiliary\Build\vcvars64.bat
 *              -> run it under a MINIMAL environment and keep FOUR things:
 *                 the directories it added to PATH, and INCLUDE, LIB, LIBPATH.
 *
 * The batch file inherits only the minimal environment given to it, so what it prints is what the
 * Microsoft toolchain says it needs — not what this machine happens to have lying around. Every
 * directory kept is checked: absolute, not UNC, real, and NOT INSIDE THE GOVERNED CHECKOUT.
 *
 * ABSENT IS NOT FATAL. A machine with no Visual Studio yields null and cargo runs anyway; the build
 * then fails with the linker's own message, which is the truth. Nothing here is required for cargo
 * to be RESOLVED — only for what it builds to link.
 */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (_) {
    return false;
  }
}

/**
 * The ordinary Windows locations, DERIVED from the two variables the daemon already carries.
 *
 * `vswhere` reads the Visual Studio instance registry under `%ProgramData%`, and `vcvars64.bat`
 * needs the Program Files roots and a temp directory. None of those reach the daemon. Every value
 * here is computed — `%LOCALAPPDATA%` is `<profile>\AppData\Local`, so the profile is two levels up
 * and the user temp is a sibling; `%SystemRoot%` gives the system drive. Nothing is read from the
 * ambient environment, and nothing machine-specific is written down anywhere.
 *
 * Returns null when the two inputs are not both present, in which case no toolchain is derived and
 * the caller says so rather than guessing.
 */
function derivedWindowsEnv(env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir;
  const localApp = env.LOCALAPPDATA;
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || !isDir(systemRoot)) return null;
  if (typeof localApp !== "string" || !path.isAbsolute(localApp)) return null;
  const drive = path.parse(path.resolve(systemRoot)).root;
  const profile = path.dirname(path.dirname(localApp));
  const temp = path.join(localApp, "Temp");
  return {
    SystemRoot: systemRoot,
    SystemDrive: drive.replace(/[\\/]$/, ""),
    windir: systemRoot,
    ProgramData: path.join(drive, "ProgramData"),
    ProgramFiles: path.join(drive, "Program Files"),
    "ProgramFiles(x86)": path.join(drive, "Program Files (x86)"),
    USERPROFILE: profile,
    LOCALAPPDATA: localApp,
    TEMP: temp,
    TMP: temp,
  };
}

let MSVC_CACHE;

function resolveMsvc(root, env, basePath) {
  if (MSVC_CACHE !== undefined) return MSVC_CACHE;
  MSVC_CACHE = null;
  let bat = null;
  try {
    const base = derivedWindowsEnv(env);
    if (base === null) return MSVC_CACHE;
    const drive = path.parse(path.resolve(base.SystemRoot)).root;
    const askEnv = { ...base, PATH: basePath, PATHEXT: ".COM;.EXE;.BAT;.CMD" };

    const vswhere = path.join(drive, "Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
    if (!isFile(vswhere) || isInside(root, vswhere)) return MSVC_CACHE;

    const found = spawnSync(
      vswhere,
      ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"],
      { encoding: "utf8", shell: false, env: askEnv },
    );
    if (found.status !== 0) return MSVC_CACHE;
    const vsRoot = String(found.stdout || "").trim().split(/\r?\n/)[0];
    if (!vsRoot || !path.isAbsolute(vsRoot) || isUnc(vsRoot) || isInside(root, vsRoot)) return MSVC_CACHE;

    const vcvars = path.join(vsRoot, "VC", "Auxiliary", "Build", "vcvars64.bat");
    const cmdExe = path.join(base.SystemRoot, "System32", "cmd.exe");
    if (!isFile(vcvars) || !isFile(cmdExe)) return MSVC_CACHE;

    // A BATCH FILE, not an inline `cmd /c "..."`. cmd.exe's own quote-stripping rules mangle a
    // command line carrying a quoted path AND a `&&`, and it fails SILENTLY: exit 1, no output, no
    // error -- which reads exactly like "this machine has no Visual Studio". Measured, not guessed.
    bat = path.join(base.TEMP, `projectos-vcenv-${process.pid}-${Math.abs(hashString(vsRoot))}.bat`);
    fs.writeFileSync(bat, `@echo off\r\ncall "${vcvars}" >nul 2>&1\r\nset\r\n`, "utf8");
    const dumped = spawnSync(cmdExe, ["/c", bat], { encoding: "utf8", shell: false, env: askEnv });
    if (dumped.status !== 0) return MSVC_CACHE;

    const vars = new Map();
    for (const line of String(dumped.stdout || "").split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq > 0) vars.set(line.slice(0, eq).toUpperCase(), line.slice(eq + 1));
    }

    // ONLY what the toolchain ADDED, and only what survives the same gate every other path passes.
    const already = new Set(String(basePath).split(path.delimiter).map((d) => d.toLowerCase()));
    const added = String(vars.get("PATH") || "")
      .split(path.delimiter)
      .filter((d) => d && !already.has(d.toLowerCase()))
      .filter((d) => path.isAbsolute(d) && !isUnc(d) && !isInside(root, d) && isDir(d));
    if (added.length === 0) return MSVC_CACHE;

    MSVC_CACHE = {
      base,
      pathDirs: added,
      INCLUDE: vars.get("INCLUDE") || "",
      LIB: vars.get("LIB") || "",
      LIBPATH: vars.get("LIBPATH") || "",
    };
  } catch (_) {
    MSVC_CACHE = null;
  } finally {
    if (bat !== null) {
      try {
        fs.unlinkSync(bat);
      } catch (_) {}
    }
  }
  return MSVC_CACHE;
}

/** A small stable hash, so two concurrent validators do not collide on the same scratch name. */
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
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
    const withTool = existing === "" ? exeDir : exeDir + path.delimiter + existing;

    // The linker and the ordinary Windows locations cargo expects, when this machine has them.
    // Absent, cargo still runs and the build fails with the linker's OWN message rather than one
    // this module invented. The derived base goes UNDER the caller's own values, never over them.
    const msvc = resolveMsvc(root, env || process.env, withTool);
    const finalEnv = msvc === null ? { ...childEnv } : { ...msvc.base, ...childEnv };
    finalEnv.PATH = withTool;
    if (msvc !== null) {
      finalEnv.PATH = msvc.pathDirs.join(path.delimiter) + path.delimiter + withTool;
      if (msvc.INCLUDE) finalEnv.INCLUDE = msvc.INCLUDE;
      if (msvc.LIB) finalEnv.LIB = msvc.LIB;
      if (msvc.LIBPATH) finalEnv.LIBPATH = msvc.LIBPATH;
    }
    return spawnSync(exe, args, { ...opts, env: finalEnv, shell: false });
  };
  run.executable = exe;
  return run;
}

module.exports = { CARGO_NAME, resolveCargo, boundCargo, isInside };
