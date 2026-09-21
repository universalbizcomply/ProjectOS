"use strict";
// ProjectOS Watchdog — sync a reviewed Watchdog Core release into a product.
//
//   node projectos/scripts/watchdog-sync.cjs --target <product checkout> --tag watchdog-core/vX.Y.Z
//        [--source <ProjectOS checkout>] [--install-path supabase/functions/_shared/watchdog-core] [--check]
//
// What it does (and only this):
//   * resolves the tag to an exact commit in the ProjectOS repository and
//     reads the release files FROM THAT COMMIT (never the working tree)
//   * verifies the tag version equals the core's declared version, and that
//     the declared schema version equals the highest shipped migration
//   * refuses if the product's vendored copy was modified or contains files
//     the previous lock does not list (a product adapter must never live in,
//     or be overwritten by, the vendored core)
//   * writes the vendored files (LF) and watchdog-core.lock.json, removing
//     only files the previous lock listed
//   * reports any schema upgrade the product must add as NEW timestamped
//     product migrations
// It never commits, never deploys, never applies a migration and never
// touches anything outside the install path and the lock file. The result is
// a reviewable diff in the product repository. --check writes nothing and
// exits 1 if the product is not exactly at the requested release.

const fs = require("fs");
const path = require("path");
const lib = require("./_watchdog-lib.cjs");

function parseArgs(argv) {
  const a = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--check") a.check = true;
    else if (["--target", "--tag", "--source", "--install-path"].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error("unknown argument " + k);
  }
  return a;
}

function releaseFiles(sourceRepo, commit) {
  const listed = lib.git(sourceRepo, ["ls-tree", "-r", "--name-only", commit, "--", "projectos/watchdog/core/src", "projectos/watchdog/sql"])
    .split(/\r?\n/).filter(Boolean);
  const out = new Map();
  for (const p of listed) {
    for (const root of lib.RELEASE_ROOTS) {
      const isDirRoot = root.from.endsWith("/");
      if (isDirRoot ? p.startsWith(root.from) : p === root.from) {
        if (!root.test(p)) continue;
        const rel = isDirRoot ? root.to + p.slice(root.from.length) : root.to;
        if (rel.includes("/test/")) continue;
        out.set(rel, lib.canonicalText(lib.git(sourceRepo, ["show", commit + ":" + p], { binary: true })));
      }
    }
  }
  return new Map([...out.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
}

function plan(opts) {
  const sourceRepo = path.resolve(opts.source || path.join(__dirname, "..", ".."));
  const target = path.resolve(opts.target || "");
  if (!opts.target || !fs.existsSync(target)) throw new Error("--target must be an existing product checkout");
  const m = lib.TAG_RE.exec(opts.tag || "");
  if (!m) throw new Error("--tag must be watchdog-core/vX.Y.Z");
  lib.git(sourceRepo, ["show-ref", "--verify", "--quiet", "refs/tags/" + opts.tag]);
  const commit = lib.git(sourceRepo, ["rev-parse", "--verify", opts.tag + "^{commit}"]).trim();

  const files = releaseFiles(sourceRepo, commit);
  const versionTs = files.get("src/version.ts");
  if (!versionTs) throw new Error("release has no src/version.ts");
  const v = lib.parseCoreVersions(versionTs);
  if (v.core !== m[1]) throw new Error("tag " + opts.tag + " does not match core version " + v.core + " at " + commit);
  const pkg = JSON.parse(lib.git(sourceRepo, ["show", commit + ":projectos/watchdog/core/package.json"]));
  if (pkg.version !== v.core) throw new Error("core package.json version " + pkg.version + " != " + v.core);
  const migrations = [...files.keys()].filter((f) => f.startsWith("sql/migrations/")).map(lib.migrationNumber);
  if (migrations.some((n) => n === null)) throw new Error("release contains a badly named migration");
  if (Math.max(...migrations) !== v.schema) throw new Error("REQUIRED_SCHEMA_VERSION " + v.schema + " != highest migration " + Math.max(...migrations));

  const lockPath = path.join(target, "watchdog-core.lock.json");
  const prev = fs.existsSync(lockPath) ? lib.readJson(lockPath) : null;
  const installPath = opts["install-path"] || (prev && prev.install_path) || lib.DEFAULT_INSTALL_PATH;
  if (!lib.isSafeRelative(installPath)) throw new Error("install path must be a safe relative path");
  if (prev) {
    const le = lib.lockErrors(prev);
    if (le.length) throw new Error("existing lock invalid: " + le.join("; "));
    if (prev.install_path !== installPath) throw new Error("install path change is not supported by sync; move it in a reviewed product change first");
  }
  const base = path.join(target, installPath);
  if (prev) {
    const drift = lib.verifyInstall(target, prev);
    if (drift.length) throw new Error("vendored core does not match its lock, refusing to overwrite:\n  " + drift.join("\n  "));
  } else if (lib.listFilesRecursive(base).length > 0) {
    throw new Error("install path " + installPath + " already contains files but there is no lock; refusing to overwrite");
  }

  const lock = {
    lock_version: 1,
    watchdog_core_version: v.core,
    schema_version: v.schema,
    source_repository: lib.CANONICAL_SOURCE,
    tag: opts.tag,
    commit,
    install_path: installPath,
    files: Object.fromEntries([...files.entries()].map(([rel, text]) => [rel, lib.sha256Canonical(Buffer.from(text, "utf8"))])),
  };
  const fromSchema = prev ? prev.schema_version : 0;
  const upgrade = [...files.keys()]
    .filter((f) => f.startsWith("sql/migrations/") && lib.migrationNumber(f) > fromSchema)
    .map((f) => installPath + "/" + f);
  const removed = prev ? Object.keys(prev.files).filter((f) => !files.has(f)) : [];
  return { target, base, lockPath, lock, files, prev, upgrade, removed };
}

function apply(p) {
  for (const f of p.removed) fs.rmSync(path.join(p.base, f), { force: true });
  for (const [rel, text] of p.files) {
    const out = path.join(p.base, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text, "utf8");
  }
  fs.writeFileSync(p.lockPath, lib.canonicalJson(p.lock), "utf8");
}

function isCurrent(p) {
  if (!p.prev) return false;
  return lib.canonicalJson(p.prev) === lib.canonicalJson(p.lock) && lib.verifyInstall(p.target, p.lock).length === 0;
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  let p;
  try { p = plan(opts); } catch (e) { console.error("watchdog-sync: REFUSED: " + e.message); process.exit(1); }
  if (opts.check) {
    const ok = isCurrent(p);
    console.log("watchdog-sync --check: " + (ok ? "product is at " + p.lock.tag + " (" + p.lock.commit + ")" : "product is NOT at " + p.lock.tag));
    process.exit(ok ? 0 : 1);
  }
  apply(p);
  console.log("watchdog-sync: wrote " + p.files.size + " files + watchdog-core.lock.json for " + p.lock.tag + " (" + p.lock.commit + ")");
  console.log("  core " + p.lock.watchdog_core_version + ", schema " + p.lock.schema_version + (p.prev ? " (was core " + p.prev.watchdog_core_version + ", schema " + p.prev.schema_version + ")" : " (new install)"));
  if (p.upgrade.length) {
    console.log("  SCHEMA UPGRADE REQUIRED — add as NEW timestamped product migrations via the product's approved route (not applied by this tool):");
    for (const f of p.upgrade) console.log("    " + f);
  } else {
    console.log("  no schema upgrade required");
  }
  console.log("  nothing was committed, deployed or applied. Review the diff in the product repository.");
}

if (require.main === module) main();
module.exports = { plan, apply, isCurrent, releaseFiles };
