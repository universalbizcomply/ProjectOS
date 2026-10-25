"use strict";
// PROJECTOS-RECOVERY-INSTALLED-APP1A. The canonical release path must OWN the workspace build output
// it links, rather than trusting whatever `dist` happens to exist on the building machine.
//
// WHY THIS IS A SAFETY CHECK AND NOT A BUILD PREFERENCE. `@projectos/core`, `@projectos/agent` and
// `@projectos/bridge-daemon` are `file:` dependencies, so the daemon bundle links each package's
// BUILD OUTPUT, never its source. Nothing downstream rebuilt them. A stale `dist` therefore shipped
// old runtime behaviour inside a payload whose trust manifest — and the owner's signature over it —
// attest to current source. The attestation stays cryptographically valid while describing code that
// is not what was reviewed, which is the one failure a signed release must never have.
//
// REPOSITORY FACTS ONLY. It reads committed files. No build, no install, no network, no signing.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PIPELINE = path.join(ROOT, "projectos", "control-center", "packaging", "build-release-payload.mjs");

/**
 * validate-all requires every registered module to expose `run(): string[]`. This file printed its
 * own result and called process.exit at import time instead, so requiring it CRASHED the aggregate
 * run ("require(...).run is not a function") while still passing when executed directly -- a
 * validator that looks green standalone and protects nothing in the suite.
 *
 * The checks below are unchanged in text and order; they are only enclosed. `failures` is now a
 * fresh local per call, so calling run() twice cannot inherit the first run's errors.
 */
function run() {
  const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}

// TWO VIEWS OF THE SAME FILE, and the distinction has caught a bug in this repository six times: a
// validator that scans raw text reads its own explanatory comments as evidence and passes on prose.
// Presence checks run against `code`; only the ordering check needs raw offsets, and it derives them
// from `code` too.
const raw = read(PIPELINE);
const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// ---- 1. the three packages are named, and rebuilt from their own directories --------------------
const PACKAGES = [
  { name: "@projectos/core", segments: "'core'" },
  { name: "@projectos/agent", segments: "'agent'" },
  { name: "@projectos/bridge-daemon", segments: "'bridge', 'daemon'" },
];
for (const pkg of PACKAGES) {
  check(
    code.includes(`name: '${pkg.name}'`),
    `the release pipeline does not declare ${pkg.name} among the packages it rebuilds`,
  );
  check(
    code.includes(`join(PROJECTOS_ROOT, ${pkg.segments})`),
    `${pkg.name} is not resolved from PROJECTOS_ROOT with segments ${pkg.segments}`,
  );
}

// ---- 2. each dist is REMOVED before it is rebuilt ------------------------------------------------
// `tsc` overwrites but never deletes, so output for a source file that has since been deleted or
// renamed survives every subsequent build and travels into the signed payload.
check(
  /rmSync\(dist,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\)/.test(code),
  "the release pipeline does not remove each package's dist before rebuilding it; tsc overwrites but does not delete",
);
check(
  /runNode\(\s*join\(pkg\.dir,\s*'node_modules',\s*'typescript',\s*'bin',\s*'tsc'\)/.test(code),
  "packages are not built with their own TypeScript from their own directory",
);
check(
  /\['-p',\s*'tsconfig\.json'\]/.test(code),
  "packages are not built with -p tsconfig.json, the same project their own build script uses",
);

// ---- 3. a build that produced nothing must FAIL, not proceed -------------------------------------
check(
  /existsSync\(join\(dist,\s*'index\.js'\)\)/.test(code),
  "the release pipeline does not verify each rebuilt package actually produced dist/index.js",
);

// ---- 4. THE ORDER. Rebuilding after the link would prove nothing ---------------------------------
const rebuildAt = code.indexOf("WORKSPACE_PACKAGES");
const sidecarAt = code.indexOf("tsconfig.node.json");
const bundleAt = code.indexOf("build-daemon-bundle.mjs");
check(rebuildAt !== -1, "the release pipeline has no WORKSPACE_PACKAGES rebuild step");
check(
  rebuildAt !== -1 && sidecarAt !== -1 && rebuildAt < sidecarAt,
  "the workspace rebuild does not precede the sidecar compile",
);
check(
  rebuildAt !== -1 && bundleAt !== -1 && rebuildAt < bundleAt,
  "the workspace rebuild does not precede the daemon bundle link — a rebuild after the link changes nothing that ships",
);

// ---- 5. still no shell -------------------------------------------------------------------------
// The pipeline spawns real executables with argument arrays. Developer paths contain spaces and
// ampersands; a shell would concatenate them into one command line and split them wrongly.
check(!/shell:\s*true/.test(code), "the release pipeline introduced shell: true");

// ---- 6. the linked packages really are build output, so freshness is what matters ----------------
// If these ever became source-resolved, this whole validator would be guarding a dead concern — and
// silently passing. Assert the premise rather than assume it.
for (const dir of [["core"], ["agent"], ["bridge", "daemon"]]) {
  const pkgPath = path.join(ROOT, "projectos", ...dir, "package.json");
  const pkg = JSON.parse(read(pkgPath));
  check(
    typeof pkg.main === "string" && pkg.main.includes("dist/"),
    `${pkg.name} no longer resolves through dist/ (main = ${pkg.main}); the release freshness guarantee is about build output`,
  );
  check(
    pkg.scripts && pkg.scripts.build === "tsc -p tsconfig.json",
    `${pkg.name} build script changed (${pkg.scripts && pkg.scripts.build}); the release pipeline reproduces it directly and would now diverge`,
  );
}

  return failures;
}

module.exports = { run };

if (require.main === module) {
  const failures = run();
  if (failures.length > 0) {
    console.error("FAIL val-projectos-release-workspace-freshness1a");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("PASS val-projectos-release-workspace-freshness1a");
  console.log("  the canonical release path removes and rebuilds core, agent and bridge-daemon before linking");
}
