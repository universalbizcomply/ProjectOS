"use strict";
/**
 * Forge Local Provisioner — PROJECTOS-FORGE-PROVISIONER1A (F3).
 *
 * Two responsibilities, both governed:
 *  1. `materializeManifest(scaffold, targetRoot, { allowedRoot })` — writes an F2 file manifest to a LOCAL
 *     project directory. This is a safe, reversible, LOCAL-ONLY action (no network). It is path-guarded:
 *     the target must resolve inside a trusted allowedRoot, and every file must resolve inside the target
 *     — nothing can escape (defence in depth on top of F2's own path guard). No secret values are written
 *     (the manifest carries none).
 *  2. `planProvision(scaffold)` — returns a RUN PLAN describing the steps that would follow (install deps,
 *     run migrations, start the dev server). These touch the network / a database and are therefore
 *     **owner-gated** — this module NEVER runs them. Materialising files is auto; everything else is
 *     surfaced for owner approval (approval queue / provider guards).
 *
 * Zero dependencies beyond Node built-ins. No network, no process spawning, no metered API.
 */

const fs = require("fs");
const path = require("path");

/** Resolve `target` and require it to sit inside `allowedRoot` (lexical + case-sensitive prefix). */
function resolveInside(target, allowedRoot) {
  if (typeof target !== "string" || !target) throw new Error("provisioner: target directory required");
  if (typeof allowedRoot !== "string" || !allowedRoot) throw new Error("provisioner: allowedRoot required");
  const root = path.resolve(allowedRoot);
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) throw new Error("provisioner: target escapes allowedRoot");
  const rootSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootSep)) throw new Error("provisioner: target escapes allowedRoot");
  return resolved;
}

function assertSafeRelPath(p) {
  if (typeof p !== "string" || !p) throw new Error("provisioner: empty file path");
  if (p.includes("\0")) throw new Error("provisioner: null byte in file path");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\\")) throw new Error("provisioner: unsafe file path " + p);
  if (p.split("/").some((s) => s === ".." || s === ".")) throw new Error("provisioner: path traversal " + p);
}

/**
 * Reject writing through a pre-existing symlink component (defeats symlink/TOCTOU escape that lexical
 * checks cannot see). Walks each path segment from the trusted root down to `dest` and refuses if any
 * existing component is a symbolic link.
 */
function assertNoSymlinkEscape(root, dest) {
  const rel = path.relative(root, dest);
  let cur = root;
  for (const seg of rel.split(path.sep)) {
    if (!seg) continue;
    cur = path.join(cur, seg);
    let st;
    try { st = fs.lstatSync(cur); } catch (e) { continue; } // does not exist yet → safe to create
    if (st.isSymbolicLink()) throw new Error("provisioner: refusing to write through a symlink: " + cur);
  }
}

/**
 * Write the manifest to disk under targetRoot (inside allowedRoot). Reversible local action.
 * @returns { root, written: string[], count }
 */
function materializeManifest(scaffold, targetRoot, opts) {
  const options = opts || {};
  if (!scaffold || !Array.isArray(scaffold.files)) throw new Error("provisioner: a scaffold with a files[] is required");
  const root = resolveInside(targetRoot, options.allowedRoot);

  const written = [];
  for (const f of scaffold.files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") throw new Error("provisioner: malformed manifest file entry");
    assertSafeRelPath(f.path);
    const dest = path.resolve(root, f.path);
    // Belt-and-braces: the resolved destination must still be inside the project root.
    const rel = path.relative(root, dest);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("provisioner: file escapes target root: " + f.path);
    assertNoSymlinkEscape(root, path.dirname(dest));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    assertNoSymlinkEscape(root, dest); // dest itself must not be an existing symlink
    fs.writeFileSync(dest, f.content, "utf8");
    written.push(f.path);
  }
  written.sort();
  return { root, written, count: written.length };
}

// Steps that must never auto-run: they hit the network (registry), a database, or start a server.
const GATED_STEPS = Object.freeze([
  { op: "install-deps", why: "downloads packages from the network", gate: "owner-approval" },
  { op: "run-migrations", why: "applies schema to a database", gate: "owner-approval" },
  { op: "start-dev-server", why: "runs the app process", gate: "owner-approval" },
]);

/**
 * Produce a run plan. Materialising files is auto (local + reversible); the follow-on steps are all
 * owner-gated and are NOT executed here. If an approval queue is supplied, one item is enqueued for the
 * gated run so the owner can approve it.
 */
function planProvision(scaffold, deps) {
  if (!scaffold || typeof scaffold.projectId !== "string") throw new Error("provisioner: scaffold with projectId required");
  const d = deps || {};
  const plan = {
    projectId: scaffold.projectId,
    materialize: { op: "write-files-local", gate: "auto", note: "reversible local file write; no network" },
    gatedSteps: GATED_STEPS.map((s) => ({ ...s })),
    executed: false,
    note: "Provisioner writes files locally only. Installing deps, running migrations, and starting the server require owner approval and are never auto-run.",
  };
  if (d.approvalQueue && typeof d.approvalQueue.enqueue === "function") {
    const item = d.approvalQueue.enqueue({
      kind: "launch-approval",
      summary: "Provision + run '" + scaffold.projectId + "': install deps, run migrations, start dev server (owner approval required)",
      payload: { projectId: scaffold.projectId, steps: GATED_STEPS.map((s) => s.op) },
    });
    plan.approvalItemId = item.id;
  }
  return plan;
}

module.exports = { materializeManifest, planProvision, GATED_STEPS };
