"use strict";
// PROJECTOS-RECOVERY-INSTALLED-APP1A. Protect the packaged-runtime invariants that are now part of
// the product's actual safety, using REPOSITORY facts only.
//
// It performs no installation, no network access, no signing and no machine mutation. Everything it
// checks is a committed file: the packaging contract, the Tauri bundle declaration, the release
// pipeline and the provenance evidence. Nothing here builds a payload or reads one — a validator
// that needed 91 MB of build output would simply be skipped, and a skipped validator protects
// nothing.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const CONTRACT = path.join(ROOT, "projectos", "host", "packaged-runtime-contract");
const CONTROL_CENTER = path.join(ROOT, "projectos", "control-center");
const GENERATOR = path.join(ROOT, "projectos", "host", "packaged-manifest-generator");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
// Strip comments so documentation prose cannot satisfy — or trip — a code-pattern check.
function stripRustComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
// Remove a trailing `#[cfg(test)] mod tests { … }` block. Deliberately crude and deliberately
// last-match: a test module is the final item in these files, so cutting from its attribute to the
// end removes it without needing to balance braces.
function stripTestModule(src) {
  const at = src.search(/#\[cfg\((?:all\()?test[\s\S]*?\)\]\s*mod\s+tests/);
  return at === -1 ? src : src.slice(0, at);
}
function constOf(src, name) {
  const m = src.match(new RegExp(`${name}\\s*:\\s*&str\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

// ---- 1. the packaging contract exists and is a contract, not a placeholder ----------------------
const contractSrc = read(path.join(CONTRACT, "src", "lib.rs"));
const contractCode = stripRustComments(contractSrc);

const NODE_VERSION = constOf(contractCode, "PACKAGED_NODE_VERSION");
const NODE_SHA = constOf(contractCode, "PACKAGED_NODE_SHA256");
const APP_ID = constOf(contractCode, "PACKAGED_APPLICATION_ID");
const PAYLOAD_ROOT = constOf(contractCode, "PAYLOAD_RELATIVE_ROOT");

check(NODE_VERSION && /^\d+\.\d+\.\d+$/.test(NODE_VERSION),
  "packaging contract: PACKAGED_NODE_VERSION must be an exact dotted release");
check(NODE_SHA && /^[0-9a-f]{64}$/.test(NODE_SHA),
  "packaging contract: PACKAGED_NODE_SHA256 must be 64 lower-case hex characters");
check(APP_ID && APP_ID.length > 0, "packaging contract: PACKAGED_APPLICATION_ID must be declared");
check(PAYLOAD_ROOT && !PAYLOAD_ROOT.includes("..") && !path.isAbsolute(PAYLOAD_ROOT),
  "packaging contract: PAYLOAD_RELATIVE_ROOT must be a relative, traversal-free segment");

// The placeholder this phase removed must never come back.
check(!contractCode.includes("22.11.0"),
  "packaging contract: the unprovisioned 22.11.0 runtime placeholder has returned");

// ---- 2. the runtime pin is the digest nodejs.org published --------------------------------------
const checksumsRel = constOf(contractCode, "UPSTREAM_CHECKSUMS_FILE");
check(checksumsRel, "packaging contract: UPSTREAM_CHECKSUMS_FILE must be declared");
if (checksumsRel) {
  const checksumsPath = path.join(CONTRACT, checksumsRel);
  if (!fs.existsSync(checksumsPath)) {
    failures.push(`provenance: committed upstream checksums missing at ${checksumsRel}`);
  } else {
    const bytes = fs.readFileSync(checksumsPath);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    check(digest === constOf(contractCode, "UPSTREAM_CHECKSUMS_SHA256"),
      "provenance: the committed upstream checksum file no longer matches its recorded digest");
    const entry = constOf(contractCode, "UPSTREAM_CHECKSUMS_ENTRY");
    const wanted = `${NODE_SHA}  ${entry}`;
    check(bytes.toString("utf8").split(/\r?\n/).some((l) => l.trimEnd() === wanted),
      "provenance: the pinned runtime digest is not the published digest for " + entry);
  }
}

// ---- 3. ONE application identity ----------------------------------------------------------------
const tauriConf = JSON.parse(read(path.join(CONTROL_CENTER, "src-tauri", "tauri.conf.json")));
check(tauriConf.identifier === APP_ID,
  `application identity drift: tauri.conf.json says ${tauriConf.identifier}, contract says ${APP_ID}`);

const authoritySrc = stripRustComments(
  read(path.join(CONTROL_CENTER, "src-tauri", "src", "process", "authority.rs")),
);
check(/PACKAGED_APPLICATION_ID\s*:\s*&str\s*=\s*projectos_packaged_runtime_contract::PACKAGED_APPLICATION_ID/
  .test(authoritySrc),
  "the Control Centre must DERIVE its packaged application id from the packaging contract");
check(/PACKAGED_RUNTIME_VERSION\s*:\s*&str\s*=\s*\n?\s*projectos_packaged_runtime_contract::PACKAGED_NODE_VERSION/
  .test(authoritySrc),
  "the Control Centre must DERIVE its packaged runtime version from the packaging contract");

// ---- 4. the bundle packages the accepted model, not the old loose tree --------------------------
const resources = tauriConf.bundle && tauriConf.bundle.resources;
check(resources && !Array.isArray(resources),
  "tauri bundle.resources must be the MAP form, so the payload keeps its directory structure");
if (resources && !Array.isArray(resources)) {
  const dests = Object.values(resources);
  check(dests.includes(PAYLOAD_ROOT),
    `tauri bundle.resources must place the payload at ${PAYLOAD_ROOT}`);
  for (const dest of dests) {
    check(!dest.includes(".."),
      `tauri bundle.resources destination ${dest} must not traverse (Tauri maps .. to _up_)`);
  }
  const FORBIDDEN_SOURCES = ["node-build", "sidecar/host.mjs", "node_modules", "validators", "schemas"];
  for (const source of Object.keys(resources)) {
    for (const forbidden of FORBIDDEN_SOURCES) {
      check(!source.includes(forbidden),
        `tauri bundle.resources must not package ${forbidden} — the daemon bundle is closed`);
    }
  }
}

// ---- 5. the release pipeline is explicit and generates its own inputs ---------------------------
const pkg = JSON.parse(read(path.join(CONTROL_CENTER, "package.json")));
check(typeof pkg.scripts["release:payload"] === "string",
  "package.json must expose release:payload");
check(typeof pkg.scripts["release:prepare"] === "string",
  "package.json must expose release:prepare");
check(tauriConf.build.beforeBuildCommand === "npm run release:prepare",
  "tauri beforeBuildCommand must run the release pipeline, so a fresh checkout can package");

const pipeline = read(path.join(CONTROL_CENTER, "packaging", "build-release-payload.mjs"));
check(pipeline.includes("build-daemon-bundle.mjs"),
  "the release pipeline must build the daemon bundle");
check(pipeline.includes("projectos-manifest-gen"),
  "the release pipeline must run the manifest generator, which enforces dependency closure");

// ---- 6. closure has no override, and the tooling holds no private key ---------------------------
const genMain = stripRustComments(read(path.join(GENERATOR, "src", "main.rs")));
check(!/allow[-_]open[-_]closure|skip[-_]closure|--force/i.test(genMain),
  "the generator must have no dependency-closure override flag");
check(/is_closed\(\)/.test(genMain),
  "the generator must gate manifest generation on dependency closure");

// The tool's OWN test enumerates the forbidden strings in order to assert their absence, so the
// test module has to come out before the scan — exactly as the comments do. A scan that reads the
// list of things being forbidden as evidence of them is the same mistake in a different costume.
const signSrc = stripTestModule(
  stripRustComments(read(path.join(GENERATOR, "src", "bin", "projectos-manifest-sign.rs"))),
);
for (const forbidden of ["--private-key", "private_key", "BEGIN EC PRIVATE", "NCryptSignHash"]) {
  check(!signSrc.includes(forbidden),
    `the signing tool must have no private-key surface, found ${forbidden}`);
}

// ---- 7. the packaged daemon may not be handed a development configuration ------------------------
const packagedSpec = authoritySrc.match(
  /impl VerifiedPackagedDaemonLaunchAuthority[\s\S]*?\n}/,
);
check(packagedSpec && !packagedSpec[0].includes("DAEMON_BRIDGE_CONFIG_VAR"),
  "the packaged launch spec must not carry the development bridge configuration");

// ---- report --------------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("val-projectos-packaged-runtime-contract1a FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("val-projectos-packaged-runtime-contract1a OK");
