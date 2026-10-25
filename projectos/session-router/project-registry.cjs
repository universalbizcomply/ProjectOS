"use strict";
/**
 * Owner project registry — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L1 trust anchor).
 *
 * WHY THIS EXISTS. `.projectops/connections.json` lives INSIDE the checkout it describes. On its own it
 * is a self-assertion: any directory can `git init`, point `origin` at a public repository, and declare
 * `projectId: "polygo"`. If the vault's project binding were checked only against that file, both sides
 * of the comparison would be attacker-chosen and the cross-project isolation guarantee would be
 * decorative.
 *
 * This registry is the out-of-checkout half of that comparison. It lives beside the credentials
 * (`%LOCALAPPDATA%\ProjectOS\projects.json`, `~/.projectos/projects.json` elsewhere), is written ONLY
 * through an owner-confirmed registration, and pins for each project:
 *
 *   - the canonical checkout roots that may claim the project id (one per worktree);
 *   - the GitHub repository;
 *   - the Supabase project ref per environment;
 *   - the Vercel organisation and project id per environment.
 *
 * A session is admitted only when the in-checkout connection profile AGREES with this registry on every
 * pinned fact. A forged checkout can still say whatever it likes — it simply will not match, and an
 * unregistered project has no entry to match at all (fail closed).
 *
 * ProjectOS cannot register a project for itself: `register` requires the owner-confirmation capability,
 * exactly as credential release does.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const FILE_NAME = "projects.json";
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function defaultStateDir() {
  if (process.platform === "win32" && typeof process.env.LOCALAPPDATA === "string" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "ProjectOS");
  }
  return path.join(os.homedir(), ".projectos");
}

/** Same canonicalisation the writer lease uses, so "the same checkout" means the same thing everywhere. */
function canonicalise(dir) {
  const resolver = fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync;
  const real = resolver(path.resolve(dir));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function createProjectRegistry(opts) {
  const options = opts || {};
  const stateDir = typeof options.stateDir === "string" && options.stateDir ? options.stateDir : defaultStateDir();
  const filePath = path.join(stateDir, FILE_NAME);
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();

  function readAll() {
    if (!fs.existsSync(filePath)) return Object.create(null);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      // A registry we cannot parse must not silently become an empty (permissive-looking) registry.
      throw new Error("project-registry: registry file is not valid JSON — refusing to guess");
    }
    const out = Object.create(null);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) if (PROJECT_ID_RE.test(key)) out[key] = parsed[key];
    }
    return out;
  }

  function writeAll(records) {
    fs.mkdirSync(stateDir, { recursive: true });
    const ordered = {};
    for (const key of Object.keys(records).sort()) ordered[key] = records[key];
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(ordered, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  }

  function get(projectId) {
    if (typeof projectId !== "string" || !PROJECT_ID_RE.test(projectId)) return null;
    const all = readAll();
    return Object.prototype.hasOwnProperty.call(all, projectId) ? all[projectId] : null;
  }

  function list() {
    const all = readAll();
    return Object.keys(all).map((projectId) => ({ ...all[projectId], projectId }));
  }

  /**
   * Register (or extend) a project. Owner-confirmed only. Pinned facts are taken from the connection
   * profile the owner is looking at when they run the command — the owner, not the file, is the authority.
   */
  function register(input) {
    const req = input || {};
    const capability = req.capability || {};
    if (capability.ownerConfirmation !== true) throw new Error("OWNER PERMIT REQUIRED");
    const connection = req.connection || {};
    const projectId = connection.projectId;
    if (typeof projectId !== "string" || !PROJECT_ID_RE.test(projectId)) throw new Error("project-registry: invalid projectId");
    const root = canonicalise(req.checkoutPath);

    const all = readAll();
    const existing = Object.prototype.hasOwnProperty.call(all, projectId) ? all[projectId] : null;
    const roots = new Set(existing && Array.isArray(existing.canonicalRepositoryRoots) ? existing.canonicalRepositoryRoots : []);
    roots.add(root);

    all[projectId] = {
      projectId,
      canonicalRepositoryRoots: [...roots].sort(),
      github: connection.github ? { repository: connection.github.repository } : (existing ? existing.github : null),
      supabase: connection.supabase ? pinSupabase(connection) : (existing ? existing.supabase : null),
      vercel: connection.vercel ? pinVercel(connection) : (existing ? existing.vercel : null),
      registeredAt: existing && existing.registeredAt ? existing.registeredAt : now(),
      updatedAt: now(),
      ownerConfirmed: true,
    };
    writeAll(all);
    return { ...all[projectId] };
  }

  function pinSupabase(connection) {
    const out = {};
    for (const [environment, block] of Object.entries(connection.supabase.environments || {})) out[environment] = block.projectRef;
    return out;
  }

  function pinVercel(connection) {
    const environments = {};
    for (const [environment, block] of Object.entries(connection.vercel.environments || {})) environments[environment] = block.projectId;
    return { organisationId: connection.vercel.organisationId, environments };
  }

  /** Remove a single checkout root, or the whole project when no root is given. Owner-confirmed only. */
  function unregister(input) {
    const req = input || {};
    if ((req.capability || {}).ownerConfirmation !== true) throw new Error("OWNER PERMIT REQUIRED");
    const all = readAll();
    const record = Object.prototype.hasOwnProperty.call(all, req.projectId) ? all[req.projectId] : null;
    if (!record) return false;
    if (typeof req.checkoutPath === "string" && req.checkoutPath) {
      const root = canonicalise(req.checkoutPath);
      record.canonicalRepositoryRoots = record.canonicalRepositoryRoots.filter((r) => r !== root);
      if (record.canonicalRepositoryRoots.length) { all[req.projectId] = record; writeAll(all); return true; }
    }
    delete all[req.projectId];
    writeAll(all);
    return true;
  }

  /**
   * The admission check. Compares the in-checkout connection profile and the observed checkout root
   * against the owner-pinned registry entry.
   * @returns { ok:true } | { ok:false, blocker, detail }
   */
  function verify(input) {
    const req = input || {};
    const connection = req.connection || {};
    const environment = req.environment;
    const record = get(connection.projectId);
    if (!record) {
      return { ok: false, blocker: "REPOSITORY MISMATCH", detail: "project '" + String(connection.projectId) + "' is not registered — run 'projectos projects register' as the owner first" };
    }
    if (!Array.isArray(record.canonicalRepositoryRoots) || !record.canonicalRepositoryRoots.includes(req.canonicalRoot)) {
      return { ok: false, blocker: "REPOSITORY MISMATCH", detail: "this checkout is not a registered root for project '" + connection.projectId + "'" };
    }
    if (record.github && connection.github && record.github.repository !== connection.github.repository) {
      return { ok: false, blocker: "GITHUB IDENTITY MISMATCH", detail: "the checkout declares a GitHub repository the owner did not register for this project" };
    }
    if (record.supabase && connection.supabase) {
      const declared = (connection.supabase.environments || {})[environment];
      const pinned = record.supabase[environment];
      if (declared && pinned && declared.projectRef !== pinned) {
        return { ok: false, blocker: "SUPABASE PROJECT MISMATCH", detail: "the checkout declares a Supabase project ref the owner did not register for '" + String(environment) + "'" };
      }
    }
    if (record.vercel && connection.vercel) {
      if (record.vercel.organisationId && connection.vercel.organisationId !== record.vercel.organisationId) {
        return { ok: false, blocker: "VERCEL PROJECT MISMATCH", detail: "the checkout declares a Vercel organisation the owner did not register" };
      }
      const declared = (connection.vercel.environments || {})[environment];
      const pinned = (record.vercel.environments || {})[environment];
      if (declared && pinned && declared.projectId !== pinned) {
        return { ok: false, blocker: "VERCEL PROJECT MISMATCH", detail: "the checkout declares a Vercel project the owner did not register for '" + String(environment) + "'" };
      }
    }
    return { ok: true, blocker: null, detail: null };
  }

  return { filePath, stateDir, get, list, register, unregister, verify, canonicalise };
}

module.exports = { createProjectRegistry, defaultStateDir, canonicalise, FILE_NAME, PROJECT_ID_RE };
