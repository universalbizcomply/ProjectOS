"use strict";
/**
 * Trusted disposable-workspace materialisation + filesystem ledger — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-
 * HARDEN1B (§5). Replaces the worker-controlled git diff entirely.
 *
 *   CANONICAL VERIFIED REPO → TRUSTED SOURCE MATERIALISATION (`git ls-tree` + per-blob `git show`, no `.git`)
 *     → DISPOSABLE WORKSPACE WITH **NO .git**
 *     → TRUSTED FS SNAPSHOT (before) → WORKER → TRUSTED FS SNAPSHOT (after) → TRUSTED FS DIFF
 *
 * The authoritative change manifest is derived ONLY from ProjectOS's own filesystem walk (lstat + content
 * hashing) — NEVER from `git status`/`git diff`/the git index/worker evidence/a worker-controlled `.git`.
 * Because the workspace is exported from a verified baseline and contains no `.git`, the worker has no git
 * state to manipulate; if it creates one, `.git` simply appears in the ledger as an added forbidden path.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const GIT_MAXBUF = 64 * 1024 * 1024;
function sha256File(p) { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); }

/**
 * Materialise the tracked tree at `baseHead` from the canonical repo into a fresh temp workspace with NO
 * `.git`. Dependency-free + cross-platform: enumerates the tree with `git ls-tree` and writes each blob via
 * `git show` (binary-safe), preserving symlinks (mode 120000) and the executable bit (mode 100755). No `tar`,
 * no shell, no Windows path pitfalls. ProjectOS-side, before the worker runs. Throws on failure (→ BLOCKED).
 * @returns { workspace, tarPath, files:[relpaths] }   (tarPath kept for API compatibility; unused)
 */
function materialize(repoRoot, baseHead) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pos-ws-"));
  const files = [];
  const symlinkFallbacks = []; // symlinks we could NOT create as links (e.g. Windows without privilege) — flagged, never silent
  try {
    const raw = execFileSync("git", ["-C", repoRoot, "ls-tree", "-r", "-z", baseHead], { encoding: "utf8", maxBuffer: GIT_MAXBUF });
    for (const rec of raw.split("\0").filter(Boolean)) {
      // "<mode> <type> <sha>\t<path>"
      const tab = rec.indexOf("\t");
      const meta = rec.slice(0, tab).split(/\s+/);
      const mode = meta[0];
      const rel = rec.slice(tab + 1);
      const dest = path.join(workspace, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const content = execFileSync("git", ["-C", repoRoot, "show", baseHead + ":" + rel], { maxBuffer: GIT_MAXBUF }); // Buffer
      if (mode === "120000") { // symlink: blob content is the target
        try { fs.symlinkSync(content.toString("utf8"), dest); }
        catch (e) { fs.writeFileSync(dest, content); symlinkFallbacks.push(rel); } // recorded, not swallowed
      } else {
        fs.writeFileSync(dest, content);
        if (mode === "100755" && process.platform !== "win32") { try { fs.chmodSync(dest, 0o755); } catch (e) { /* best effort */ } }
      }
      files.push(rel);
    }
  } catch (e) {
    // Never leak a half-materialised workspace: clean up our own temp dir, then rethrow (caller → BLOCKED).
    try { fs.rmSync(workspace, { recursive: true, force: true }); } catch (er) { /* best effort */ }
    throw e;
  }
  return { workspace, tarPath: path.join(workspace, ".pos-nonexistent"), files: files.sort(), symlinkFallbacks, empty: files.length === 0 };
}

/**
 * Trusted filesystem snapshot of `root`: a Map(relPath -> entry). Uses lstat (never follows symlinks), hashes
 * file content, records symlink targets + real-path escapes, includes HIDDEN and ignore-style files (there is
 * no ignore semantics here — every entry is recorded). Never throws for a single bad entry: it records an
 * `unreadable` marker so tampering can never hide behind a read error.
 */
function snapshot(root) {
  const map = Object.create(null);
  const rootReal = safeReal(root) || path.resolve(root);
  const walk = (dir) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { map[rel(root, dir)] = { type: "dir", unreadable: true }; return; }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, e.name);
      const r = rel(root, full);
      let st;
      try { st = fs.lstatSync(full); }
      catch (er) { map[r] = { type: "unknown", unreadable: true }; continue; }
      const hidden = e.name.startsWith(".");
      if (st.isSymbolicLink()) {
        let target = null, escapes = false;
        try { target = fs.readlinkSync(full); } catch (er) { /* dangling name still recorded */ }
        const real = safeReal(full);
        escapes = !real || !insideRoot(real, rootReal);
        map[r] = { type: "symlink", size: st.size, linkTarget: target, escapes, hidden };
      } else if (st.isDirectory()) {
        map[r] = { type: "dir", hidden };
        walk(full);
      } else if (st.isFile()) {
        let hash = null, unreadable = false;
        try { hash = sha256File(full); } catch (er) { unreadable = true; }
        map[r] = { type: "file", size: st.size, mode: st.mode & 0o777, hash, unreadable, hidden };
      } else {
        map[r] = { type: "special", hidden }; // fifo/socket/device — recorded, never silently skipped
      }
    }
  };
  walk(root);
  return map;
}

function rel(root, full) { return path.relative(root, full).split(path.sep).join("/"); }
function safeReal(p) { try { return fs.realpathSync(p); } catch (e) { return null; } }
function insideRoot(p, rootReal) {
  const withSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  return p === rootReal || p.startsWith(withSep);
}

/**
 * Trusted diff between two snapshots. Returns a structured ledger with every change class the phase requires,
 * plus the flat `changedPaths` (added ∪ modified ∪ deleted ∪ type-changed ∪ rename endpoints) for policy
 * enforcement. Rename is a best-effort heuristic (a deleted file + an added file with identical content hash).
 */
function diff(before, after) {
  const added = [], deleted = [], modified = [], typeChanged = [], sameSizeContentChange = [], symlinkChanged = [],
    permissionChanged = [], escapes = [], unreadable = [], hidden = [], special = [];
  const bKeys = Object.keys(before), aKeys = Object.keys(after);
  for (const k of aKeys) {
    const a = after[k]; const b = before[k];
    if (a.escapes) escapes.push(k);
    if (a.unreadable) unreadable.push(k);
    if (a.hidden) hidden.push(k);
    if (a.type === "special") special.push(k);
    if (!b) { added.push(k); continue; }
    if (a.type !== b.type) { typeChanged.push(k); modified.push(k); continue; }
    if (a.type === "file") {
      if (a.hash !== b.hash || a.unreadable || b.unreadable) {
        modified.push(k);
        if (a.size === b.size) sameSizeContentChange.push(k); // content change without size change
      }
      if (a.mode !== b.mode) { permissionChanged.push(k); if (modified.indexOf(k) < 0) modified.push(k); } // mode-only change
    } else if (a.type === "symlink") {
      if (a.linkTarget !== b.linkTarget) { symlinkChanged.push(k); modified.push(k); }
    } else if (a.type === "special") {
      modified.push(k); // a socket/fifo/device cannot be hashed — any presence is treated as changed
    }
  }
  for (const k of bKeys) if (!after[k]) deleted.push(k);
  // rename heuristic: deleted file whose content-hash reappears as an added file
  const renamed = [];
  const addedFileHash = {};
  for (const k of added) if (after[k].type === "file" && after[k].hash) addedFileHash[after[k].hash] = k;
  for (const k of deleted) {
    const b = before[k];
    if (b && b.type === "file" && b.hash && addedFileHash[b.hash]) renamed.push({ from: k, to: addedFileHash[b.hash] });
  }
  // Unreadable entries + escapes are folded into changedPaths so policy enforcement can never pass over them.
  const changedPaths = uniq([].concat(added, modified, deleted, unreadable, escapes, special));
  return {
    added, deleted, modified, typeChanged, sameSizeContentChange, symlinkChanged, permissionChanged, renamed,
    escapes, unreadable, hidden, special, changedPaths,
  };
}

function uniq(a) { return Array.from(new Set(a)); }

/** Manifest (path -> content sha256 / status) derived from the trusted after-snapshot + diff. */
function manifest(after, ledger) {
  const out = [];
  for (const p of ledger.changedPaths) {
    const e = after[p];
    if (!e) { out.push({ path: p, status: "deleted" }); continue; }
    if (e.type === "file") out.push({ path: p, status: "file", sha256: e.hash || "UNREADABLE", size: e.size });
    else if (e.type === "symlink") out.push({ path: p, status: "symlink", target: e.linkTarget, escapes: !!e.escapes });
    else out.push({ path: p, status: e.type });
  }
  return out;
}

function dispose(dir) {
  const residue = [];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* checked */ }
  try { if (fs.existsSync(dir)) residue.push(dir); } catch (e) { residue.push(dir); }
  return residue;
}

module.exports = { materialize, snapshot, diff, manifest, dispose, sha256File };
