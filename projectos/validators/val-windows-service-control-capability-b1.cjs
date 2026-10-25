"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B1 — HISTORICAL (evergreen) validator.
//
// CD-B1 froze windows-service-control as an EFFECT-FREE contract-only crate at commit 35d357b. CD-B2
// then implemented the bounded live SCM adapter on top of that frozen contract, so the CURRENT tree is
// no longer forbid-unsafe / windows-free / feature-free — and is governed instead by
// val-windows-service-control-capability-b2.cjs.
//
// This validator therefore no longer inspects the working tree. It permanently asserts the HISTORICAL
// fact that the crate WAS contract-only at its CD-B1 freeze commit, reading the frozen blobs via
// `git show` (read-only, execFileSync — no shell). It FAILS (never silently skips) if the freeze commit
// or its expected paths cannot be read, and it verifies the current history contains the freeze commit.
const { execFileSync } = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");

const FREEZE_COMMIT = "35d357b9901e60a677ea6fba73c10003133fa99c";
const CRATE = "projectos/host/windows-service-control";
const B1_PATHS = {
  toml: `${CRATE}/Cargo.toml`,
  lib: `${CRATE}/src/lib.rs`,
  contracts: `${CRATE}/src/contracts.rs`,
};

// No shell: git is invoked via execFileSync with an argument array. All arguments are fixed constants.
function gitShow(rev, file) {
  return execFileSync("git", ["show", `${rev}:${file}`], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function run() {
  const errors = [];

  // 1. The freeze commit MUST exist (never silently skip).
  try {
    execFileSync("git", ["cat-file", "-e", `${FREEZE_COMMIT}^{commit}`], { cwd: ROOT, stdio: "ignore" });
  } catch (_) {
    return ["frozen CD-B1 commit " + FREEZE_COMMIT + " is not present in this repository"];
  }
  // 2. The current history MUST contain the freeze commit (HEAD descends from / includes it).
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", FREEZE_COMMIT, "HEAD"], { cwd: ROOT, stdio: "ignore" });
  } catch (_) {
    errors.push("current HEAD history does not contain the CD-B1 freeze commit");
  }

  // 3. Read the frozen B1 blobs. A missing path FAILS (never falls back to the working tree).
  let toml;
  let lib;
  let contracts;
  try {
    toml = gitShow(FREEZE_COMMIT, B1_PATHS.toml);
    lib = gitShow(FREEZE_COMMIT, B1_PATHS.lib);
    contracts = gitShow(FREEZE_COMMIT, B1_PATHS.contracts);
  } catch (e) {
    errors.push("a frozen CD-B1 path could not be read at " + FREEZE_COMMIT + ": " + (e && e.message));
    return errors;
  }

  // 4. Assert the CD-B1 contract-only invariants AT THE FROZEN COMMIT.
  if (!/name\s*=\s*"projectos-host-windows-service-control"/.test(toml)) errors.push("B1: wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("B1: not publish=false");
  if (!/unsafe_code\s*=\s*"forbid"/.test(toml)) errors.push("B1: crate did not forbid unsafe");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("B1: had a binary target");
  if (/^\s*\[features\]/m.test(toml)) errors.push("B1: declared features (contract-only had none)");
  if (/\bwindows\s*=|windows-sys\s*=/.test(toml)) errors.push("B1: had a windows dependency");
  // Dependency direction: only the installation contract.
  const depBody = (stripComments(toml).split(/^\[dependencies\]/m)[1] || "").split(/\n\[/)[0];
  for (const d of (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim())) {
    if (d !== "projectos-host-windows-service-installation-contract") errors.push("B1: unexpected dependency " + d);
  }
  // lib forbids unsafe; no windows FFI / unsafe anywhere in the frozen contract files.
  if (!/#!\[forbid\(unsafe_code\)\]/.test(lib)) errors.push("B1: lib did not #![forbid(unsafe_code)]");
  for (const [name, blob] of [["lib.rs", lib], ["contracts.rs", contracts]]) {
    const c = stripComments(blob);
    if (/unsafe\s*(fn|\{)/.test(c)) errors.push("B1: unsafe in " + name);
    if (/use\s+windows(::|\s|;)|windows::Win32|OpenSCManager|CreateServiceW?/.test(c)) errors.push("B1: windows FFI in " + name);
  }
  // Contract-only behaviour: fixed ProjectOSHost identity, VirtualServiceAccount-only, demand-start,
  // NotAuthorised, no live route.
  const cc = stripComments(contracts);
  if (!/VirtualServiceAccountNoPassword/.test(cc)) errors.push("B1: no VirtualServiceAccount-no-password policy");
  if (/\bLocalSystem\b|\bLocalService\b|\bNetworkService\b/.test(cc)) errors.push("B1: alternate identity representable");
  if (!/DemandStartOnly/.test(cc)) errors.push("B1: no demand-start-only policy");
  if (!/NotAuthorised/.test(cc)) errors.push("B1: effect authority not NotAuthorised");
  if (!/is_approved_name/.test(cc)) errors.push("B1: no exact-name check");
  if (!/SERVICE_CONTROL_IS_CONTRACT_ONLY:\s*bool\s*=\s*true/.test(lib)) errors.push("B1: not contract-only");
  if (!/LIVE_SERVICE_CONTROL_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("B1: live control was authorised");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-service-control-capability-b1] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-service-control-capability-b1: PASS (historical @ CD-B1 freeze)");
}
