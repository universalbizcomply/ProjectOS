"use strict";
/**
 * Proves the Forge Local Provisioner invariants (PROJECTOS-FORGE-PROVISIONER1A / F3). Writes to an
 * isolated temp directory and cleans up. If any invariant regresses, `run()` returns a non-empty error
 * list and validate-all fails.
 *
 * Invariants:
 *  1  materialise writes every manifest file to disk with matching content
 *  2  deterministic: the same manifest materialises to identical file contents
 *  3  a manifest file path that escapes the project root is refused (fail closed)
 *  4  a target directory outside the allowed root is refused
 *  5  no secret-shaped value is ever written to disk
 *  6  planProvision marks file-write as auto and install/migrate/run as owner-approval; executed:false
 *  7  the provisioner has no execution/spawn capability (only fs+path required; no child_process)
 *  8  an approval-queue item is enqueued for the gated run when a queue is supplied
 *  9  a null byte in a file path is refused
 * 10  writing through a pre-existing symlinked directory component is refused (best-effort; needs privilege)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const provisioner = require("../forge/provisioner.cjs");
const { materializeManifest, planProvision } = provisioner;
const { buildBlueprint } = require("../forge/blueprint-engine.cjs");
const { buildScaffold } = require("../forge/scaffold-engine.cjs");
const { createApprovalQueue } = require("../approval/approval-queue.cjs");

const scratch = require("./lib/scratch.cjs");
let __SCRATCH_DIR = null;
const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}/;

function mkTemp() {
  return scratch.owned("forge-provisioner");
}
function rm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}
function readAll(root) {
  const out = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(root, p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
    }
  })(root);
  return out;
}

function run() {
  const errors = [];
  const scaffold = buildScaffold(buildBlueprint({ description: "a booking app for a salon with stripe payments and customer accounts" }));
  const base = mkTemp();
  try {
    // 1: materialise writes files with matching content.
    const projA = path.join(base, "a");
    const res = materializeManifest(scaffold, projA, { allowedRoot: base });
    const onDisk = readAll(res.root);
    for (const f of scaffold.files) {
      if (onDisk[f.path] !== f.content) errors.push("invariant 1: file content mismatch on disk for " + f.path);
    }
    if (res.count !== scaffold.files.length) errors.push("invariant 1: not all files written");

    // 2: deterministic.
    const projB = path.join(base, "b");
    materializeManifest(scaffold, projB, { allowedRoot: base });
    const onDiskB = readAll(path.resolve(projB));
    if (JSON.stringify(onDisk) !== JSON.stringify(onDiskB)) errors.push("invariant 2: materialisation is not deterministic");

    // 3: escaping file path refused.
    try {
      materializeManifest({ projectId: "x", files: [{ path: "../evil.txt", content: "x" }] }, path.join(base, "c"), { allowedRoot: base });
      errors.push("invariant 3: escaping manifest path was not refused");
    } catch (e) { /* expected */ }

    // 4: target outside allowed root refused.
    try {
      materializeManifest(scaffold, path.join(base, "..", "outside"), { allowedRoot: base });
      errors.push("invariant 4: target outside allowedRoot was not refused");
    } catch (e) { /* expected */ }

    // 5: no secret on disk.
    for (const [p, content] of Object.entries(onDisk)) {
      if (SECRET_RX.test(content)) errors.push("invariant 5: secret-shaped value written to disk in " + p);
    }

    // 6: run plan gating.
    const plan = planProvision(scaffold);
    if (plan.materialize.gate !== "auto") errors.push("invariant 6: materialise step not marked auto");
    if (plan.executed !== false) errors.push("invariant 6: plan marked executed");
    for (const op of ["install-deps", "run-migrations", "start-dev-server"]) {
      const s = plan.gatedSteps.find((x) => x.op === op);
      if (!s || s.gate !== "owner-approval") errors.push("invariant 6: step not owner-gated: " + op);
    }

    // 7: no execution capability.
    for (const k of Object.keys(provisioner)) {
      if (/exec|spawn|fork|child/i.test(k)) errors.push("invariant 7: provisioner exports an execution-capable symbol: " + k);
    }
    const src = fs.readFileSync(path.join(__dirname, "..", "forge", "provisioner.cjs"), "utf8");
    const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
    for (const r of requires) if (!["fs", "os", "path"].includes(r)) errors.push("invariant 7: provisioner requires an unexpected module: " + r);
    // The strict require-allowlist above already proves no child_process; assert the call forms too.
    if (/\.spawn\(|\.exec\(|execSync\(|execFile/.test(src)) errors.push("invariant 7: provisioner references process execution");

    // 8: approval item enqueued for the gated run.
    const q = createApprovalQueue();
    const plan2 = planProvision(scaffold, { approvalQueue: q });
    if (!plan2.approvalItemId || q.pendingCount() !== 1) errors.push("invariant 8: gated run did not enqueue an approval item");

    // 9: a null byte in a file path is refused.
    try {
      materializeManifest({ projectId: "x", files: [{ path: "foo" + String.fromCharCode(0) + ".txt", content: "x" }] }, path.join(base, "nb"), { allowedRoot: base });
      errors.push("invariant 9: null-byte file path was not refused");
    } catch (e) { /* expected */ }

    // 10: writing THROUGH a pre-existing symlink component is refused (best-effort: needs symlink privilege).
    const symRoot = path.join(base, "sym");
    fs.mkdirSync(symRoot, { recursive: true });
    const outside = path.join(base, "outside-target");
    fs.mkdirSync(outside, { recursive: true });
    let symlinkOk = true;
    try { fs.symlinkSync(outside, path.join(symRoot, "link"), "dir"); }
    catch (e) { symlinkOk = false; } // no symlink privilege (e.g. Windows without dev mode) → skip
    if (symlinkOk) {
      try {
        materializeManifest({ projectId: "x", files: [{ path: "link/evil.txt", content: "x" }] }, symRoot, { allowedRoot: base });
        errors.push("invariant 10: write through a symlinked directory was not refused");
      } catch (e) { /* expected */ }
      if (fs.existsSync(path.join(outside, "evil.txt"))) errors.push("invariant 10: a file was written outside the root via a symlink");
    }
  } catch (e) {
    errors.push("provisioner run crashed: " + e.message);
  } finally {
    rm(base);
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-provisioner: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-provisioner: PASS");
}
module.exports = { run };
