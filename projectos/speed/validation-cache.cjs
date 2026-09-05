"use strict";
/**
 * LOCAL, REPOSITORY-SCOPED VALIDATION CACHE — version 1.
 *
 * Accelerates governed validation without reducing correctness. Every cache decision fails toward
 * running the validator: unknown, missing, corrupt, expired, version-mismatched, environment-
 * mismatched, and partially-covered entries are never treated as hits.
 *
 * TRUST PROPERTIES:
 * - Deleting the cache directory can reduce performance but NEVER validation correctness.
 * - No raw secrets, credentials, provider prompts, or provider responses are stored.
 * - Cache entries contain only: validator name, pass/fail, error count, content hashes.
 * - Full uncached validation (validate-all.cjs) remains authoritative and is never weakened.
 *
 * CACHE KEY: sha256 of (schemaVersion + nodeVersion + platform + validatorSourceHash +
 *            sharedLibHash + declaredInputsHash + inputCoverage).
 * A hit requires ALL components to match; ANY mismatch runs the validator.
 *
 * LIFECYCLE: 1 GB cap per repository, 7-day unused-entry expiry, LRU eviction over budget.
 *
 * Created in PROJECTOS-SPEED-VALIDATION-CACHE1A.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";
const CACHE_DIR_NAME = ".projectops/validation-cache";
const MAX_CACHE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days unused
const ENTRY_EXT = ".json";

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 hex of a string or buffer. */
function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** SHA-256 of a file's contents, or null if unreadable. */
function hashFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch (_) {
    return null;
  }
}

/**
 * SHA-256 of every file in a directory tree (sorted, deterministic).
 * Returns null if the directory does not exist or is unreadable.
 */
function hashDirectory(dirPath) {
  try {
    const files = [];
    walkDir(dirPath, files);
    if (files.length === 0) return null;
    files.sort();
    const h = crypto.createHash("sha256");
    for (const f of files) {
      // Include the relative path in the hash so renames invalidate.
      h.update(path.relative(dirPath, f).replace(/\\/g, "/"));
      h.update("\0");
      // A DIGEST PER FILE, NOT THE BYTES, so a file read for one declaration is not read again for
      // the declarations that contain it. `projectos` and `projectos/agent/src` are both declared;
      // every file under the second was previously read twice, and the sub-trees together cost
      // 578ms of the 1,768ms a full distinct pass takes. sha256-of-sha256 over the sorted path/digest
      // pairs is exactly as strong a fingerprint as sha256 over the concatenated bytes.
      h.update(fileDigest(f));
      h.update("\0");
    }
    return h.digest("hex");
  } catch (_) {
    return null;
  }
}

/** SHA-256 of one file's contents, memoised for the run's snapshot when one is open. */
function fileDigest(abs) {
  return snapshotHash("file:" + abs, () => sha256(fs.readFileSync(abs)));
}

/**
 * ONE SNAPSHOT PER RUN — the reason a data-only change cost 26 seconds.
 *
 * WHAT WAS ACTUALLY SLOW. 141 validators declare 15 distinct input paths between them:
 * `projectos/agent/src` is declared by 79 of them, `projectos/core/src` by 74, `projectos/host` by
 * 49. Every one of those declarations re-read and re-hashed the entire tree, from scratch, and a
 * missed validator did it TWICE — once to check the cache and once to save it. Measured on the
 * reference machine: computing all 141 keys takes 59,870 ms; hashing each distinct path exactly once
 * takes 1,768 ms. Thirty-four times the work, for identical bytes and identical digests.
 *
 * NO CACHE DECISION CHANGES. A memoised digest is the same digest — this is not a shortcut around
 * hashing, it is the same hash computed once instead of three hundred times. Coverage, key equality,
 * expiry and every fail-toward-run rule are untouched.
 *
 * IT MAKES THE RUN MORE COHERENT, NOT LESS. Without it a sweep is already non-atomic: the first
 * validator hashes a tree at t=0 and the last hashes it a minute later, so a file changed in between
 * is half-seen. With it, one run judges one snapshot of the tree, taken when the run began. A change
 * that lands mid-run is then simply not in this run's snapshot — it is caught by the next run, which
 * takes its own, exactly as a change landing after the run would be.
 *
 * AND IT FAILS TOWARD RUNNING. The saved key is now the digest the validator was JUDGED against
 * rather than a fresher one computed after it finished; a tree that moved under a running validator
 * therefore mismatches next time and the validator runs again. The old behaviour saved the post-run
 * digest, which would hit next time on the strength of a result produced before the change.
 *
 * OFF UNLESS ASKED FOR. `beginSnapshot`/`endSnapshot` are called by the cached runner around its
 * sweep. A caller that does not open one hashes exactly as before, so nothing acquires this
 * behaviour by accident.
 */
let hashSnapshot = null;

function beginSnapshot() {
  hashSnapshot = new Map();
}

function endSnapshot() {
  hashSnapshot = null;
}

/** The digest for one input path, from this run's snapshot when there is one. */
function snapshotHash(abs, compute) {
  if (hashSnapshot === null) return compute();
  if (hashSnapshot.has(abs)) return hashSnapshot.get(abs);
  const h = compute();
  hashSnapshot.set(abs, h);
  return h;
}

function walkDir(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "target" || ent.name === "validation-cache") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(p, out);
    else if (ent.isFile()) out.push(p);
  }
}

// ---------------------------------------------------------------------------
// Cache key computation
// ---------------------------------------------------------------------------

/**
 * Environment fingerprint: things that change the meaning of a validator's result.
 */
function environmentFingerprint() {
  return sha256([
    SCHEMA_VERSION,
    process.version,      // Node.js version
    process.platform,     // OS platform
    process.arch,         // CPU architecture
  ].join("\0"));
}

/**
 * Hash the shared validator library (projectos/validators/lib/).
 * All validators implicitly depend on these.
 */
function sharedLibHash(root) {
  const libDir = path.join(root, "projectos", "validators", "lib");
  return hashDirectory(libDir);
}

/**
 * Compute the full cache key for a single validator.
 *
 * @param {object} params
 * @param {string} params.root - Repository root
 * @param {string} params.validatorName - e.g. "validate-project-config"
 * @param {string} params.validatorPath - Absolute path to the .cjs file
 * @param {string[]} params.inputPaths - Declared input paths (files or directories, relative to root)
 * @param {string} params.envHash - Pre-computed environment hash
 * @param {string} params.libHash - Pre-computed shared lib hash
 * @returns {{ key: string, coverage: string, components: object } | null}
 */
function computeCacheKey(params) {
  const { root, validatorName, validatorPath, inputPaths, envHash, libHash } = params;

  // Validator source hash
  const srcHash = hashFile(validatorPath);
  if (srcHash === null) return null; // unreadable → fail toward run

  // Shared lib hash
  if (libHash === null) return null; // unreadable → fail toward run

  // Input hashes — EVERY declared input must be hashable
  const inputHashes = [];
  let coverage = "full";

  if (!inputPaths || inputPaths.length === 0) {
    // No declared inputs → coverage is unknown → fail toward run
    coverage = "none";
  }

  for (const rel of (inputPaths || [])) {
    const abs = path.resolve(root, rel);
    let h = null;
    try {
      // MEMOISED PER RUN. See `hashSnapshot`: the same directory is declared by up to 79 validators
      // and was re-hashed for every one of them. The digest is identical either way.
      h = snapshotHash("input:" + abs, () => {
        const st = fs.statSync(abs);
        if (st.isDirectory()) return hashDirectory(abs);
        if (st.isFile()) return hashFile(abs);
        return null;
      });
    } catch (_) {
      // Input missing or unreadable → fail toward run
      coverage = "partial";
    }
    if (h === null) {
      coverage = "partial";
    }
    inputHashes.push({ path: rel, hash: h });
  }

  // If coverage is not full, the key is still computed (for diagnostics) but the caller
  // must not use it as a cache hit.
  const keyData = [
    envHash,
    srcHash,
    libHash,
    ...inputHashes.map(ih => ih.hash || "MISSING"),
  ].join("\0");

  return {
    key: sha256(keyData),
    coverage,
    components: { envHash, srcHash, libHash, inputHashes, coverage },
  };
}

// ---------------------------------------------------------------------------
// Git HEAD fast path
// ---------------------------------------------------------------------------

/**
 * Get the current HEAD commit and working tree cleanliness.
 * Uses bound-git if available, falls back to child_process.
 *
 * The cache directory itself (.projectops/validation-cache/) is EXCLUDED from the cleanliness
 * check. Without this, the act of caching would make the tree dirty, which would invalidate the
 * cache — a self-defeating cycle. The cache is disposable runtime state, not governance evidence.
 */
function gitState(root) {
  try {
    const { boundGit } = require("../worker/bound-git.cjs");
    const git = boundGit(root);
    const head = git(["rev-parse", "HEAD"]);
    const status = git(["status", "--porcelain"]);
    if (head === null || !/^[0-9a-f]{40}$/.test(head)) {
      return { head: null, clean: false };
    }
    if (status === null) return { head, clean: false };
    if (status === "") return { head, clean: true };
    // Filter out the cache directory from the status check
    const lines = status.split(/\n/).filter(l => l.length > 0);
    const nonCacheLines = lines.filter(l => {
      // Porcelain format: XY <path> or XY <path> -> <path>
      const filePath = l.slice(3).split(" -> ")[0];
      return !filePath.startsWith(CACHE_DIR_NAME + "/") && filePath !== CACHE_DIR_NAME;
    });
    return {
      head,
      clean: nonCacheLines.length === 0,
    };
  } catch (_) {
    return { head: null, clean: false };
  }
}

// ---------------------------------------------------------------------------
// Cache storage
// ---------------------------------------------------------------------------

function cacheDir(root) {
  return path.join(root, CACHE_DIR_NAME);
}

function entryPath(root, validatorName) {
  // Use a safe filename derived from the validator name
  const safeName = validatorName.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(cacheDir(root), safeName + ENTRY_EXT);
}

/**
 * The full-suite fast-path entry, keyed on HEAD commit.
 */
function suiteEntryPath(root) {
  return path.join(cacheDir(root), "_suite" + ENTRY_EXT);
}

/**
 * Read a cache entry. Returns null on any failure (missing, corrupt, wrong schema).
 * Accepts both per-validator entries (have `passed`, `errorCount`) and suite entries
 * (have `kind: "suite"`, `head`, `results`).
 */
function readEntry(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const entry = JSON.parse(raw);
    if (entry === null || typeof entry !== "object") return null;
    if (entry.schemaVersion !== SCHEMA_VERSION) return null;
    if (typeof entry.key !== "string" || entry.key.length !== 64) return null;
    if (typeof entry.createdAt !== "string") return null;
    if (typeof entry.lastUsedAt !== "string") return null;
    // Suite entries carry results[], not passed/errorCount
    if (entry.kind === "suite") {
      if (typeof entry.head !== "string") return null;
      if (!Array.isArray(entry.results)) return null;
    } else {
      if (typeof entry.passed !== "boolean") return null;
      if (!Number.isInteger(entry.errorCount)) return null;
    }
    return entry;
  } catch (_) {
    return null;
  }
}

/**
 * Write a cache entry. Creates the cache directory if needed.
 * NEVER throws — a write failure is a performance loss, not a correctness loss.
 */
function writeEntry(filePath, entry) {
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2) + "\n", "utf8");
  } catch (_) {
    // Write failure is non-fatal
  }
}

/**
 * Touch an entry's lastUsedAt without rewriting the whole file.
 */
function touchEntry(filePath) {
  try {
    const entry = readEntry(filePath);
    if (entry === null) return;
    entry.lastUsedAt = new Date().toISOString();
    writeEntry(filePath, entry);
  } catch (_) {
    // Non-fatal
  }
}

/**
 * Build a cache entry object.
 */
function buildEntry(validatorName, key, passed, errorCount) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    validator: validatorName,
    key,
    passed,
    errorCount,
    createdAt: now,
    lastUsedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Full-suite fast path
// ---------------------------------------------------------------------------

/**
 * Build a suite-level cache entry capturing ALL validator results at a specific HEAD.
 */
function buildSuiteEntry(head, results) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "suite",
    head,
    key: sha256(SCHEMA_VERSION + "\0" + process.version + "\0" + process.platform + "\0" + head),
    results: results.map(r => ({
      name: r.name,
      passed: r.passed === true,
      errorCount: Number.isFinite(r.errorCount) ? r.errorCount : -1,
    })),
    createdAt: now,
    lastUsedAt: now,
  };
}

/**
 * Check the suite-level cache.
 *
 * @returns {object[]|null} Array of results if cache hit, null if miss.
 */
function checkSuiteCache(root) {
  const git = gitState(root);
  if (git.head === null || !git.clean) return null;

  const fp = suiteEntryPath(root);
  const entry = readEntry(fp);
  if (entry === null) return null;
  if (entry.kind !== "suite") return null;
  if (entry.head !== git.head) return null;

  // Check expiry
  const age = Date.now() - new Date(entry.lastUsedAt).getTime();
  if (age > MAX_ENTRY_AGE_MS || isNaN(age)) return null;

  // Verify key matches environment
  const expectedKey = sha256(SCHEMA_VERSION + "\0" + process.version + "\0" + process.platform + "\0" + git.head);
  if (entry.key !== expectedKey) return null;

  if (!Array.isArray(entry.results)) return null;

  // Touch to update LRU
  touchEntry(fp);

  return entry.results;
}

/**
 * Save a suite-level cache entry after a full uncached run.
 */
function saveSuiteCache(root, head, results) {
  const git = gitState(root);
  // Only cache suite results for clean trees
  if (!git.clean || git.head !== head) return;
  const entry = buildSuiteEntry(head, results);
  writeEntry(suiteEntryPath(root), entry);
}

// ---------------------------------------------------------------------------
// Per-validator cache
// ---------------------------------------------------------------------------

/**
 * Check a single validator's cache.
 *
 * @param {string} root
 * @param {string} validatorName
 * @param {object} keyResult - Output of computeCacheKey()
 * @returns {{ passed: boolean, errorCount: number } | null}
 */
function checkValidatorCache(root, validatorName, keyResult) {
  // Coverage must be full — unknown inputs fail toward run.
  //
  // `undefined` IS ALSO NO KEY. The guard tested `=== null` only, so a caller passing undefined got
  // a TypeError from `undefined.coverage` instead of a cache miss — a crash where the whole module's
  // contract is "anything unusable falls toward running the validator". Not reachable through
  // `computeCacheKey`, which returns null or an object, and recorded as latent in the readiness
  // evidence; closed here because a robustness note that is never acted on is just a known hole.
  if (keyResult === null || keyResult === undefined || typeof keyResult !== "object") return null;
  if (keyResult.coverage !== "full") return null;

  const fp = entryPath(root, validatorName);
  const entry = readEntry(fp);
  if (entry === null) return null;
  if (entry.validator !== validatorName) return null;
  if (entry.key !== keyResult.key) return null;

  // Check expiry
  const age = Date.now() - new Date(entry.lastUsedAt).getTime();
  if (age > MAX_ENTRY_AGE_MS || isNaN(age)) return null;

  // Touch to update LRU
  touchEntry(fp);

  return { passed: entry.passed, errorCount: entry.errorCount };
}

/**
 * Save a single validator's result after running it.
 */
function saveValidatorCache(root, validatorName, keyResult, passed, errorCount) {
  if (keyResult === null || keyResult.coverage !== "full") return;
  const entry = buildEntry(validatorName, keyResult.key, passed, errorCount);
  writeEntry(entryPath(root, validatorName), entry);
}

// ---------------------------------------------------------------------------
// Lifecycle management
// ---------------------------------------------------------------------------

/**
 * Expire old entries and enforce the 1 GB size cap via LRU eviction.
 * NEVER throws.
 */
function maintain(root) {
  const dir = cacheDir(root);
  try {
    if (!fs.existsSync(dir)) return { expired: 0, evicted: 0, totalBytes: 0 };
  } catch (_) {
    return { expired: 0, evicted: 0, totalBytes: 0 };
  }

  let entries = [];
  let expired = 0;
  const now = Date.now();

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(ENTRY_EXT)) continue;
      const fp = path.join(dir, name);
      try {
        const stat = fs.statSync(fp);
        const entry = readEntry(fp);
        const lastUsed = entry ? new Date(entry.lastUsedAt).getTime() : 0;
        const age = now - lastUsed;

        // Expire entries unused for MAX_ENTRY_AGE_MS
        if (age > MAX_ENTRY_AGE_MS || isNaN(age) || entry === null) {
          fs.unlinkSync(fp);
          expired++;
          continue;
        }

        entries.push({ path: fp, size: stat.size, lastUsed });
      } catch (_) {
        // Corrupt or unreadable → remove
        try { fs.unlinkSync(fp); expired++; } catch (_) {}
      }
    }
  } catch (_) {
    return { expired, evicted: 0, totalBytes: 0 };
  }

  // LRU eviction if over budget
  let totalBytes = entries.reduce((sum, e) => sum + e.size, 0);
  let evicted = 0;
  if (totalBytes > MAX_CACHE_BYTES) {
    // Sort by lastUsed ascending (oldest first)
    entries.sort((a, b) => a.lastUsed - b.lastUsed);
    while (totalBytes > MAX_CACHE_BYTES && entries.length > 0) {
      const oldest = entries.shift();
      try {
        fs.unlinkSync(oldest.path);
        totalBytes -= oldest.size;
        evicted++;
      } catch (_) {}
    }
  }

  return { expired, evicted, totalBytes };
}

/**
 * Delete the entire cache. Always safe — correctness is never affected.
 */
function clear(root) {
  const dir = cacheDir(root);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Cache statistics for diagnostics.
 */
function stats(root) {
  const dir = cacheDir(root);
  try {
    if (!fs.existsSync(dir)) return { entries: 0, totalBytes: 0 };
    let count = 0;
    let totalBytes = 0;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(ENTRY_EXT)) continue;
      try {
        totalBytes += fs.statSync(path.join(dir, name)).size;
        count++;
      } catch (_) {}
    }
    return { entries: count, totalBytes };
  } catch (_) {
    return { entries: 0, totalBytes: 0 };
  }
}

module.exports = {
  SCHEMA_VERSION,
  CACHE_DIR_NAME,
  MAX_CACHE_BYTES,
  MAX_ENTRY_AGE_MS,
  sha256,
  hashFile,
  hashDirectory,
  environmentFingerprint,
  sharedLibHash,
  computeCacheKey,
  beginSnapshot,
  endSnapshot,
  gitState,
  checkSuiteCache,
  saveSuiteCache,
  checkValidatorCache,
  saveValidatorCache,
  maintain,
  clear,
  stats,
  readEntry,
  buildEntry,
  cacheDir,
  entryPath,
};
