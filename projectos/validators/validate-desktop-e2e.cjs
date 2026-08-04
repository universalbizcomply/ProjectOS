"use strict";
/**
 * Proves the Control Centre is a render-ready Tauri DESKTOP application, not merely a browser app
 * (PROJECTOS-V3-DESKTOP-E2E-PROOF1A). Checks 1-4 are static, deterministic assertions over COMMITTED
 * files. Check 5 requires a real production build: `dist/` is a gitignored artifact, and since
 * 2026-08-04 its absence is a FAILURE rather than a skip — source alone cannot prove what actually
 * ships. Build the Control Centre before validating a fresh checkout. `src-tauri/target/` is still
 * not required.
 *
 * Checks:
 *  1  tauri.conf.json parses; frontendDist points at the Vite build (../dist); productName/identifier set;
 *     identifier is NOT the isolated-fixture identifier
 *  2  the Rust desktop shell exists (src-tauri/Cargo.toml + src-tauri/src/main.rs)
 *  3  package.json wires the desktop toolchain (a "tauri" script + @tauri-apps/cli dependency)
 *  4  the owner-surface source modules exist and App.tsx registers the control/chat/safety views
 *  5  the production bundle carries all three owner-surface labels somewhere across ALL its chunks
 */

const fs = require("fs");
const path = require("path");

const CC = path.resolve(__dirname, "..", "control-center");
const FIXTURE_IDENTIFIER = "com.projectos.control-center.fixture";
// Repo-relative label used in check-5 failure evidence.
const DIST_ASSETS_REL = "projectos/control-center/dist/assets";

function exists(rel) { return fs.existsSync(path.join(CC, rel)); }
function read(rel) { return fs.readFileSync(path.join(CC, rel), "utf8"); }

function run() {
  const errors = [];

  // 1: tauri.conf.json render-ready.
  let conf;
  try { conf = JSON.parse(read("src-tauri/tauri.conf.json")); }
  catch (e) { return ["tauri.conf.json not readable/parseable: " + e.message]; }
  if (!conf.build || conf.build.frontendDist !== "../dist") errors.push("check 1: frontendDist is not '../dist'");
  if (typeof conf.productName !== "string" || !conf.productName) errors.push("check 1: productName missing");
  if (typeof conf.identifier !== "string" || !conf.identifier) errors.push("check 1: identifier missing");
  if (conf.identifier === FIXTURE_IDENTIFIER) errors.push("check 1: production identifier collides with the fixture identifier");
  if (!conf.app || !Array.isArray(conf.app.windows) || conf.app.windows.length === 0) errors.push("check 1: no desktop window configured");

  // 2: Rust desktop shell present.
  if (!exists("src-tauri/Cargo.toml")) errors.push("check 2: src-tauri/Cargo.toml missing");
  if (!exists("src-tauri/src/main.rs")) errors.push("check 2: src-tauri/src/main.rs missing");

  // 3: desktop toolchain wired in package.json.
  let pkg;
  try { pkg = JSON.parse(read("package.json")); }
  catch (e) { errors.push("check 3: package.json not readable: " + e.message); pkg = null; }
  if (pkg) {
    if (!pkg.scripts || typeof pkg.scripts.tauri !== "string") errors.push("check 3: no 'tauri' script");
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (!deps["@tauri-apps/cli"]) errors.push("check 3: @tauri-apps/cli not a dependency");
  }

  // 4: owner-surface modules + App wiring.
  const modules = [
    "src/owner/OwnerControlPlane.tsx", "src/owner/OwnerChat.tsx",
    "src/owner/SafetyProviders.tsx", "src/owner/governedChain.ts",
  ];
  for (const m of modules) if (!exists(m)) errors.push("check 4: missing owner surface module " + m);
  if (exists("src/App.tsx")) {
    const app = read("src/App.tsx");
    for (const token of ["'control'", "'chat'", "'safety'"]) {
      if (!app.includes(token)) errors.push("check 4: App.tsx does not register view " + token);
    }
  } else {
    errors.push("check 4: src/App.tsx missing");
  }

  // 5: the built production bundle must carry the owner surfaces.
  //
  // Vite code-splits, so `dist/assets` holds SEVERAL .js chunks and a label may land in any of them.
  // This check previously read only the first file matching /^index-.*\.js$/ in directory order,
  // which is alphabetical — with two index chunks present it inspected a small bootstrap stub and
  // reported the surfaces missing from a bundle that in fact contained them. The corpus, not one
  // arbitrarily chosen member of it, is the evidence: every production chunk is read and the labels
  // are required somewhere across the combined corpus.
  //
  // Fail-closed: absent, empty or unreadable production output is a FAILURE, not a skip. Proving a
  // desktop shell from source alone would not be proof, so this check needs a real build. Run the
  // repository's production build before validating a fresh checkout.
  const distAssets = path.join(CC, "dist", "assets");
  const OWNER_SURFACE_LABELS = ["Owner Control", "Owner Chat", "Safety &"];
  if (!fs.existsSync(distAssets)) {
    errors.push("check 5: no production bundle at " + DIST_ASSETS_REL + " — build the Control Centre before validating");
  } else {
    let chunkNames;
    try {
      chunkNames = fs.readdirSync(distAssets).filter((f) => f.endsWith(".js")).sort();
    } catch (x) {
      chunkNames = [];
      errors.push("check 5: production bundle directory unreadable: " + x.message);
    }
    if (chunkNames.length === 0) {
      if (!errors.some((m) => m.indexOf("unreadable") !== -1)) {
        errors.push("check 5: production bundle directory " + DIST_ASSETS_REL + " contains no .js chunk");
      }
    } else {
      const corpus = [];
      for (const name of chunkNames) {
        try {
          corpus.push(fs.readFileSync(path.join(distAssets, name), "utf8"));
        } catch (x) {
          errors.push("check 5: production chunk unreadable: " + name + ": " + x.message);
        }
      }
      const inspected = chunkNames.join(", ");
      for (const label of OWNER_SURFACE_LABELS) {
        if (!corpus.some((txt) => txt.includes(label))) {
          errors.push(
            "check 5: owner surface '" + label + "' is in no production chunk (" +
            chunkNames.length + " inspected in " + DIST_ASSETS_REL + ": " + inspected + ")",
          );
        }
      }
    }
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-desktop-e2e: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-desktop-e2e: PASS");
}
module.exports = { run };
