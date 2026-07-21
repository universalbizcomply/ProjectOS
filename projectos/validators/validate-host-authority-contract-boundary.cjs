"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-B — HISTORICAL (evergreen) validator.
//
// 3K-I-D-B froze the host-authority crate as an EFFECT-FREE typed contract at commit 823fd26. 3K-I-D-C
// then implemented the SYNTHETIC Windows authority on top of that frozen contract, so the CURRENT tree
// is no longer zero-dependency / forbid-unsafe / windows-free — and is governed instead by
// validate-host-authority-windows-boundary.cjs.
//
// This validator therefore no longer inspects the working tree. It permanently asserts the HISTORICAL
// fact that the contract crate WAS effect-free at its freeze commit: zero dependencies and
// forbid(unsafe_code). It reads the frozen blobs via `git show` (read-only) and never touches HEAD. If
// the freeze commit is unreachable (e.g. a shallow clone), it degrades to a skip rather than a false
// failure.
const { execFileSync } = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

const FREEZE_COMMIT = "823fd262b8cc4c93a45644380daa24465df77a3f";
const CRATE = "projectos/host/host-authority";

// No shell: git is invoked via execFileSync with an argument array, so nothing is interpolated into a
// command string. All arguments here are fixed constants regardless.
function gitShow(rev, file) {
  return execFileSync("git", ["show", `${rev}:${file}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function run() {
  const errors = [];

  // If the freeze commit is not present (shallow clone / detached history), skip rather than fail.
  try {
    execFileSync("git", ["cat-file", "-e", `${FREEZE_COMMIT}^{commit}`], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch (_) {
    return []; // freeze commit unreachable in this checkout — nothing to assert.
  }

  let toml;
  let lib;
  try {
    toml = gitShow(FREEZE_COMMIT, `${CRATE}/Cargo.toml`);
    lib = gitShow(FREEZE_COMMIT, `${CRATE}/src/lib.rs`);
  } catch (e) {
    errors.push("cannot read frozen contract blobs at " + FREEZE_COMMIT + ": " + e.message);
    return errors;
  }

  // The frozen crate forbade unsafe.
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml) && !/#!\[forbid\(unsafe_code\)\]/.test(lib)) {
    errors.push("frozen contract (823fd26) did not forbid unsafe — historical invariant broken");
  }

  // The frozen crate declared ZERO dependencies (contract-only).
  const depSection = stripComments(toml).split(/\[dependencies\]/)[1] || "";
  const depBody = depSection.split(/\n\[/)[0];
  if (/=\s*\{|=\s*"/.test(depBody)) {
    errors.push("frozen contract (823fd26) declared a dependency — historical invariant broken");
  }
  if (/\[target\./.test(stripComments(toml))) {
    errors.push("frozen contract (823fd26) declared a target dependency — historical invariant broken");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-host-authority-contract-boundary] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-host-authority-contract-boundary: PASS");
}
