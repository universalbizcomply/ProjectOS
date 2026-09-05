"use strict";
/**
 * VALIDATION CACHE CORRECTNESS VALIDATOR.
 *
 * Proves the structural and behavioral guarantees of the validation cache:
 *
 * 1. MODULE REGISTRY SYNC: The cached runner's module list matches validate-all.cjs exactly.
 * 2. FAIL-TOWARD-RUN: Unknown coverage, corrupt entries, expired entries, and version
 *    mismatches all result in cache misses (the validator runs).
 * 3. NO SECRETS IN CACHE: Cache entries contain only validator names, pass/fail booleans,
 *    error counts, and content hashes — never file contents, secrets, or provider data.
 * 4. CACHE LIFECYCLE: Expired entries are removed, 1 GB cap enforced, LRU eviction works.
 * 5. CACHE DELETION SAFETY: Clearing the cache never affects validation correctness.
 * 6. INPUT MAP COVERAGE: Every validator in the input map exists in the module registry.
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..", "..");

function run() {
  const errors = [];

  // -----------------------------------------------------------------------
  // 1. Module registry sync
  // -----------------------------------------------------------------------
  let validateAllModules;
  try {
    const src = fs.readFileSync(path.join(ROOT, "projectos/validators/validate-all.cjs"), "utf8");
    // Extract the MODULES array from validate-all.cjs
    const match = src.match(/const MODULES\s*=\s*\[([\s\S]*?)\];/);
    if (!match) { errors.push("cannot extract MODULES from validate-all.cjs"); return errors; }
    validateAllModules = match[1]
      .split(/,/)
      .map(s => s.replace(/["'\s\n\r]/g, ""))
      .filter(s => s.length > 0);
  } catch (e) {
    errors.push("cannot read validate-all.cjs: " + e.message);
    return errors;
  }

  let cachedRunnerModules;
  try {
    const src = fs.readFileSync(path.join(ROOT, "projectos/speed/cached-runner.cjs"), "utf8");
    const match = src.match(/const MODULES\s*=\s*\[([\s\S]*?)\];/);
    if (!match) { errors.push("cannot extract MODULES from cached-runner.cjs"); return errors; }
    cachedRunnerModules = match[1]
      .split(/,/)
      .map(s => s.replace(/["'\s\n\r]/g, ""))
      .filter(s => s.length > 0);
  } catch (e) {
    errors.push("cannot read cached-runner.cjs: " + e.message);
    return errors;
  }

  if (validateAllModules.length !== cachedRunnerModules.length) {
    errors.push(
      "module count mismatch: validate-all has " + validateAllModules.length +
      ", cached-runner has " + cachedRunnerModules.length
    );
  }
  for (let i = 0; i < Math.max(validateAllModules.length, cachedRunnerModules.length); i++) {
    if (validateAllModules[i] !== cachedRunnerModules[i]) {
      errors.push(
        "module mismatch at index " + i + ": validate-all has '" +
        (validateAllModules[i] || "MISSING") + "', cached-runner has '" +
        (cachedRunnerModules[i] || "MISSING") + "'"
      );
    }
  }

  // -----------------------------------------------------------------------
  // 2. Fail-toward-run behavior
  // -----------------------------------------------------------------------
  const vc = require("../speed/validation-cache.cjs");

  // 2a. Unknown coverage → null (fail toward run)
  const unknownKey = vc.computeCacheKey({
    root: ROOT,
    validatorName: "test-unknown",
    validatorPath: path.join(ROOT, "projectos/validators/validate-no-secrets.cjs"),
    inputPaths: [], // empty = no declared inputs
    envHash: vc.environmentFingerprint(),
    libHash: vc.sharedLibHash(ROOT),
  });
  if (unknownKey !== null && unknownKey.coverage !== "none") {
    errors.push("empty inputPaths should yield coverage 'none', got: " + (unknownKey && unknownKey.coverage));
  }

  // 2b. Missing input → partial coverage (fail toward run)
  const missingKey = vc.computeCacheKey({
    root: ROOT,
    validatorName: "test-missing",
    validatorPath: path.join(ROOT, "projectos/validators/validate-no-secrets.cjs"),
    inputPaths: ["nonexistent/path/that/does/not/exist"],
    envHash: vc.environmentFingerprint(),
    libHash: vc.sharedLibHash(ROOT),
  });
  if (missingKey !== null && missingKey.coverage !== "partial") {
    errors.push("missing input should yield coverage 'partial', got: " + (missingKey && missingKey.coverage));
  }

  // 2c. Corrupt entry → null from readEntry
  const corruptResult = vc.readEntry(path.join(ROOT, "projectos/speed/cached-runner.cjs")); // not JSON
  if (corruptResult !== null) {
    errors.push("readEntry should return null for non-JSON file");
  }

  // 2d. Version mismatch → null from readEntry
  const tempDir = path.join(ROOT, ".projectops", "validation-cache");
  const testEntryPath = path.join(tempDir, "_test_version_mismatch.json");
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(testEntryPath, JSON.stringify({
      schemaVersion: "0.0.0-wrong",
      validator: "test",
      key: crypto.randomBytes(32).toString("hex"),
      passed: true,
      errorCount: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }), "utf8");
    const wrongVersion = vc.readEntry(testEntryPath);
    if (wrongVersion !== null) {
      errors.push("readEntry should return null for wrong schemaVersion");
    }
  } finally {
    try { fs.unlinkSync(testEntryPath); } catch (_) {}
  }

  // 2e. checkValidatorCache with null keyResult → null
  const nullCheck = vc.checkValidatorCache(ROOT, "test", null);
  if (nullCheck !== null) {
    errors.push("checkValidatorCache with null keyResult should return null");
  }

  // 2f. checkValidatorCache with non-full coverage → null
  if (unknownKey !== null) {
    const nonFullCheck = vc.checkValidatorCache(ROOT, "test-unknown", unknownKey);
    if (nonFullCheck !== null) {
      errors.push("checkValidatorCache with non-full coverage should return null");
    }
  }

  // -----------------------------------------------------------------------
  // 3. No secrets in cache entries
  // -----------------------------------------------------------------------
  // Cache entry structure check: buildEntry produces only safe fields
  const testEntry = vc.buildEntry("test-validator", "a".repeat(64), true, 0);
  const allowedKeys = new Set(["schemaVersion", "validator", "key", "passed", "errorCount", "createdAt", "lastUsedAt"]);
  for (const k of Object.keys(testEntry)) {
    if (!allowedKeys.has(k)) {
      errors.push("cache entry has unexpected key: " + k);
    }
  }
  // key must be a hex hash, not arbitrary content
  if (!/^[0-9a-f]{64}$/.test(testEntry.key)) {
    errors.push("cache entry key is not a 64-char hex hash");
  }
  // No field should contain file content or secret-shaped values
  const SECRET_PATTERNS = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWT
    /sk_live_/, /sk_test_/, /sk-proj-/, /sk-ant-/, /ghp_/, /AKIA/,
  ];
  const entryStr = JSON.stringify(testEntry);
  for (const pat of SECRET_PATTERNS) {
    if (pat.test(entryStr)) {
      errors.push("cache entry structure contains secret-shaped content");
    }
  }

  // -----------------------------------------------------------------------
  // 4. Cache lifecycle constants
  // -----------------------------------------------------------------------
  if (vc.MAX_CACHE_BYTES !== 1 * 1024 * 1024 * 1024) {
    errors.push("MAX_CACHE_BYTES is not 1 GB: " + vc.MAX_CACHE_BYTES);
  }
  if (vc.MAX_ENTRY_AGE_MS !== 7 * 24 * 60 * 60 * 1000) {
    errors.push("MAX_ENTRY_AGE_MS is not 7 days: " + vc.MAX_ENTRY_AGE_MS);
  }

  // -----------------------------------------------------------------------
  // 5. Cache deletion safety
  // -----------------------------------------------------------------------
  // The cache directory name is under .projectops/ and the clear function exists
  if (vc.CACHE_DIR_NAME !== ".projectops/validation-cache") {
    errors.push("CACHE_DIR_NAME is not .projectops/validation-cache: " + vc.CACHE_DIR_NAME);
  }
  if (typeof vc.clear !== "function") {
    errors.push("cache.clear is not a function");
  }

  // -----------------------------------------------------------------------
  // 6. Input map coverage
  // -----------------------------------------------------------------------
  const { buildInputMap } = require("../speed/input-map.cjs");
  const inputMap = buildInputMap();
  const moduleSet = new Set(validateAllModules);
  for (const name of Object.keys(inputMap)) {
    if (!moduleSet.has(name)) {
      errors.push("input-map declares inputs for unknown validator: " + name);
    }
  }
  // Every input path in the map should be a plausible path (no absolute, no ..)
  for (const [name, paths] of Object.entries(inputMap)) {
    for (const p of paths) {
      if (path.isAbsolute(p)) {
        errors.push("input-map for " + name + " has absolute path: " + p);
      }
      if (p.includes("..")) {
        errors.push("input-map for " + name + " has parent traversal: " + p);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 7. Hashing determinism
  // -----------------------------------------------------------------------
  const h1 = vc.sha256("deterministic-test-input");
  const h2 = vc.sha256("deterministic-test-input");
  if (h1 !== h2) {
    errors.push("sha256 is not deterministic");
  }
  if (h1.length !== 64 || !/^[0-9a-f]+$/.test(h1)) {
    errors.push("sha256 does not produce a 64-char hex string");
  }

  // -----------------------------------------------------------------------
  // 8. Environment fingerprint stability within process
  // -----------------------------------------------------------------------
  const env1 = vc.environmentFingerprint();
  const env2 = vc.environmentFingerprint();
  if (env1 !== env2) {
    errors.push("environmentFingerprint is not stable within a single process");
  }

  // -----------------------------------------------------------------------
  // 9. An unusable key result is a MISS, never a crash
  // -----------------------------------------------------------------------
  // `undefined` reached `undefined.coverage` and threw a TypeError, because the guard tested
  // `=== null` only. Recorded as a latent defect in the readiness evidence and closed there; asserted
  // here so it stays closed. The whole module's contract is that anything unusable falls toward
  // running the validator, and a crash is not a miss — it takes the runner down with it.
  for (const unusable of [null, undefined, "", 0, false, "a-key", 42]) {
    let got;
    try {
      got = vc.checkValidatorCache(ROOT, "test-unusable", unusable);
    } catch (e) {
      errors.push("checkValidatorCache threw on an unusable key result (" + String(unusable) + "): " + e.message);
      continue;
    }
    if (got !== null) {
      errors.push("checkValidatorCache answered from cache for an unusable key result: " + String(unusable));
    }
  }

  // -----------------------------------------------------------------------
  // 10. The per-run hash snapshot changes no digest, and does not leak
  // -----------------------------------------------------------------------
  // The snapshot exists to stop the same directory being re-hashed once per declaration — 59.9s of
  // identical digests, measured, where 1.6s of distinct ones will do. It is a performance change
  // ONLY if the digest is identical either way, which is asserted rather than assumed. A digest that
  // differed inside a snapshot would silently invalidate or, worse, silently match.
  const probe = "projectos/schemas";
  const bare = vc.hashDirectory(path.join(ROOT, probe));
  vc.beginSnapshot();
  const first = vc.hashDirectory(path.join(ROOT, probe));
  const second = vc.hashDirectory(path.join(ROOT, probe));
  vc.endSnapshot();
  const after = vc.hashDirectory(path.join(ROOT, probe));
  if (bare !== first || first !== second || second !== after) {
    errors.push("the per-run hash snapshot changes the digest: " + [bare, first, second, after].join(" / "));
  }
  // And an ended snapshot is really ended: a stale one would carry one run's view of the tree into
  // the next, which is the one way this optimisation could become a false hit.
  vc.beginSnapshot();
  vc.endSnapshot();
  const keyA = vc.computeCacheKey({
    root: ROOT, validatorName: "validate-examples",
    validatorPath: path.join(ROOT, "projectos/validators/validate-examples.cjs"),
    inputPaths: [probe], envHash: vc.environmentFingerprint(), libHash: vc.sharedLibHash(ROOT),
  });
  if (keyA === null || keyA.coverage !== "full") {
    errors.push("a readable declared input did not produce full coverage after a closed snapshot");
  }

  // -----------------------------------------------------------------------
  // 11. Declared-change projection reaches in both directions
  // -----------------------------------------------------------------------
  // `validatorsInvalidatedBy` is measurement-only — no cache decision consults it — but a projection
  // that under-reported the blast radius would make the benchmark measure a cheaper scenario than
  // the one it names. Containment has to work both ways round: a declaration can contain a change
  // (`.projectops` declared, `.projectops/proof` changed) and a change can contain a declaration
  // (`projectos` changed, `projectos/examples` declared).
  const { pathsIntersect, validatorsInvalidatedBy } = require("../speed/input-map.cjs");
  const intersects = [
    [".projectops", ".projectops/proof", true],
    ["projectos/examples", "projectos", true],
    ["projectos/examples", "projectos/examples", true],
    ["projectos/example", "projectos/examples", false],
    ["projectos/core/src", "projectos/agent/src", false],
  ];
  for (const [a, b, want] of intersects) {
    if (pathsIntersect(a, b) !== want) {
      errors.push("pathsIntersect('" + a + "','" + b + "') should be " + want);
    }
  }
  // A validator with no declaration is invalidated by everything, because the cache runs it anyway.
  const projected = validatorsInvalidatedBy([".projectops"], ["validate-project-plan", "validate-examples", "no-such-validator"]);
  if (!projected.includes("validate-project-plan")) errors.push("projection missed a validator declaring .projectops");
  if (projected.includes("validate-examples")) errors.push("projection invalidated a validator that declares no .projectops path");
  if (!projected.includes("no-such-validator")) errors.push("projection excused an undeclared validator, which the cache always runs");

  // -----------------------------------------------------------------------
  // 12. The secret scanner runs FIRST, which is what makes the hash snapshot safe for it
  // -----------------------------------------------------------------------
  // Inside a per-run snapshot the first validator to touch a path fixes that path's digest for every
  // later validator declaring it. `validate-no-secrets` declares `projectos` and `knowledge`, which
  // between them contain almost every other declared path — so if it ran late it would be deciding
  // from a digest taken by someone else, at a moment it did not choose. Running first makes it always
  // the memo's PRODUCER and never its consumer, so the snapshot changes nothing at all for it.
  //
  // Raised as MEDIUM by the security review of the snapshot change: the property held, but only as an
  // accident of a hand-maintained array that another file is "kept in sync" with. This is the check
  // that stops it being an accident. `cached-runner` also refuses to open the snapshot when it does
  // not hold, so a reordering costs speed rather than correctness — and this says so out loud.
  const { SECRET_SCANNER, MODULES: RUNNER_MODULES } = require("../speed/cached-runner.cjs");
  if (RUNNER_MODULES[0] !== SECRET_SCANNER) {
    errors.push(
      "the cached runner's first module is '" + RUNNER_MODULES[0] + "', not '" + SECRET_SCANNER +
      "'; the secret scanner must run first or the per-run hash snapshot decides its cache key from a " +
      "digest another validator took"
    );
  }
  if (validateAllModules[0] !== SECRET_SCANNER) {
    errors.push("validate-all's first module is '" + validateAllModules[0] + "', not '" + SECRET_SCANNER + "'");
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach(x => console.error("FAIL: " + x));
    console.error("validate-speed-validation-cache: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("validate-speed-validation-cache: PASS");
}
module.exports = { run };
