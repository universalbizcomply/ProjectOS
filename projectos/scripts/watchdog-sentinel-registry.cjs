"use strict";
// ProjectOS Watchdog — generate the outer sentinel registry.
//
//   node projectos/scripts/watchdog-sentinel-registry.cjs --sources <sources.json> --source-commit <sha> --out <registry.json>
//   node projectos/scripts/watchdog-sentinel-registry.cjs --verify <registry.json>
//
// The registry is GENERATED from ProjectOS-controlled configuration, never
// hand-written: each source pairs a product's project-config (identity + the
// environment URL it already owns) with its watchdog profile (health path,
// sentinel mode and check classes). Nothing is duplicated into ProjectOS.
//
// The output is committed into the separate sentinel repository through a
// reviewed change. The sentinel reads only that committed file at runtime; it
// never calls ProjectOS. It contains safe data only: identity, public https
// URL, health path, expected service, timeout, check classes. No credentials.
// It is stamped with the ProjectOS source commit and a content hash; --verify
// (and val-watchdog-core1a) fail on drift or tampering.
//
// sources.json: { "sources": [ { "project_config": "<path>", "profile": "<path>",
//                                "environment": "production", "timeout_ms": 5000 } ] }
// (paths relative to sources.json)

const fs = require("fs");
const path = require("path");
const lib = require("./_watchdog-lib.cjs");

function entryFor(src, baseDir) {
  const cfg = lib.readJson(path.resolve(baseDir, src.project_config));
  const prof = lib.readJson(path.resolve(baseDir, src.profile));
  const pe = lib.profileErrors(prof);
  if (pe.length) throw new Error("profile " + src.profile + ": " + pe.join("; "));
  if (prof.sentinel.mode === "none") return null;
  const env = cfg.environments && cfg.environments[src.environment];
  if (!env || !env.url) throw new Error(cfg.projectId + ": project-config has no environments." + src.environment + ".url");
  const classes = [...prof.sentinel.check_classes].sort();
  return {
    project: cfg.projectId,
    environment: src.environment,
    public_url: env.url,
    health_path: classes.includes("health") || classes.includes("release_identity") ? (prof.health.health_endpoint_path || null) : null,
    expected_service: cfg.projectId,
    expected_release: null,
    timeout_ms: src.timeout_ms || 5000,
    check_classes: classes,
  };
}

function generate(sourcesPath, sourceCommit) {
  const baseDir = path.dirname(path.resolve(sourcesPath));
  const doc = lib.readJson(sourcesPath);
  if (!Array.isArray(doc.sources)) throw new Error("sources must be an array");
  const entries = doc.sources.map((s) => entryFor(s, baseDir)).filter(Boolean)
    .sort((a, b) => (a.project + "/" + a.environment < b.project + "/" + b.environment ? -1 : 1));
  const reg = {
    registry_version: 1,
    generated_by: "projectos/scripts/watchdog-sentinel-registry.cjs",
    source_commit: sourceCommit,
    entries,
    content_sha256: lib.registryContentHash(entries),
  };
  const errors = lib.registryErrors(reg);
  if (errors.length) throw new Error("generated registry invalid: " + errors.join("; "));
  return reg;
}

function main() {
  const argv = process.argv.slice(2);
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    if (get("--verify")) {
      const errors = lib.registryErrors(lib.readJson(get("--verify")));
      if (errors.length) { errors.forEach((e) => console.error("FAIL: " + e)); process.exit(1); }
      console.log("watchdog-sentinel-registry --verify: PASS");
      return;
    }
    const reg = generate(get("--sources"), get("--source-commit"));
    fs.writeFileSync(get("--out"), lib.canonicalJson(reg), "utf8");
    console.log("watchdog-sentinel-registry: wrote " + reg.entries.length + " entries (" + reg.content_sha256 + ")");
  } catch (e) {
    console.error("watchdog-sentinel-registry: " + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { generate, entryFor };
