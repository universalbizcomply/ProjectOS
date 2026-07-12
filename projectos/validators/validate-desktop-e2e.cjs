"use strict";
/**
 * Proves the Control Centre is a render-ready Tauri DESKTOP application, not merely a browser app
 * (PROJECTOS-V3-DESKTOP-E2E-PROOF1A). Static, deterministic checks over COMMITTED files only — the built
 * `dist/` bundle and `src-tauri/target/` binary are gitignored build artifacts, so their absence on a
 * fresh checkout is tolerated (if present, extra assertions run). This keeps validate-all green anywhere
 * while still proving the desktop shell + owner surfaces are wired.
 *
 * Checks:
 *  1  tauri.conf.json parses; frontendDist points at the Vite build (../dist); productName/identifier set;
 *     identifier is NOT the isolated-fixture identifier
 *  2  the Rust desktop shell exists (src-tauri/Cargo.toml + src-tauri/src/main.rs)
 *  3  package.json wires the desktop toolchain (a "tauri" script + @tauri-apps/cli dependency)
 *  4  the owner-surface source modules exist and App.tsx registers the control/chat/safety views
 *  5  (only if built) the production dist bundle contains all three owner-surface labels
 */

const fs = require("fs");
const path = require("path");

const CC = path.resolve(__dirname, "..", "control-center");
const FIXTURE_IDENTIFIER = "com.projectos.control-center.fixture";

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

  // 5: built bundle (optional — gitignored). If present, it must carry the owner surfaces.
  const distAssets = path.join(CC, "dist", "assets");
  if (fs.existsSync(distAssets)) {
    const mainBundle = fs.readdirSync(distAssets).find((f) => /^index-.*\.js$/.test(f));
    if (!mainBundle) {
      errors.push("check 5: dist/ present but no main index bundle found");
    } else {
      const txt = fs.readFileSync(path.join(distAssets, mainBundle), "utf8");
      for (const label of ["Owner Control", "Owner Chat", "Safety &"]) {
        if (!txt.includes(label)) errors.push("check 5: production bundle missing owner surface '" + label + "'");
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
