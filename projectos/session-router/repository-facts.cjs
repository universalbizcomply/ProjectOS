"use strict";
/**
 * Repository facts — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3 observation).
 *
 * Read-only observation of the checkout a session is about to bind: its canonical root, its branch and
 * its configured origin. Every command is a plain `git` read (`rev-parse`, `symbolic-ref`, `remote
 * get-url`); nothing here fetches, writes, or authenticates, so it never touches provider state and never
 * needs a credential.
 *
 * The canonical root is resolved through `fs.realpathSync.native`, so a junction, a symlink or a
 * differently-cased spelling of the same checkout produces the same answer — that is what makes the
 * repository-root comparison in the preflight meaningful rather than cosmetic.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

/** `owner/repo` from any of the URL forms git will hand back. Returns null when it is not a GitHub remote. */
function parseGitHubRemote(url) {
  if (typeof url !== "string" || !url) return null;
  const trimmed = url.trim().replace(/\.git$/, "");
  const ssh = /^git@github\.com:([^/]+)\/(.+)$/.exec(trimmed);
  if (ssh) return ssh[1] + "/" + ssh[2];
  const https = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+)$/.exec(trimmed);
  if (https) return https[1] + "/" + https[2];
  const sshProto = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/.exec(trimmed);
  if (sshProto) return sshProto[1] + "/" + sshProto[2];
  return null;
}

function canonicalise(dir) {
  const resolver = fs.realpathSync.native ? fs.realpathSync.native : fs.realpathSync;
  const real = resolver(path.resolve(dir));
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function createRepositoryReader(opts) {
  const options = opts || {};
  // Injectable so validators can drive the preflight from synthetic facts without a real checkout.
  const spawnSync = typeof options.spawnSync === "function" ? options.spawnSync : childProcess.spawnSync;

  function git(cwd, args) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) return null;
    return typeof result.stdout === "string" ? result.stdout.trim() : null;
  }

  /**
   * @returns { ok, facts } | { ok:false, reason }
   * facts = { checkoutPath, canonicalRoot, branch, remoteUrl, remoteRepositoryFullName }
   */
  function read(checkoutPath) {
    if (typeof checkoutPath !== "string" || !checkoutPath) return { ok: false, reason: "checkout path required" };
    if (!fs.existsSync(checkoutPath)) return { ok: false, reason: "checkout path does not exist" };
    const top = git(checkoutPath, ["rev-parse", "--show-toplevel"]);
    if (!top) return { ok: false, reason: "not a git checkout" };
    const remoteUrl = git(checkoutPath, ["remote", "get-url", "origin"]);
    return {
      ok: true,
      facts: {
        checkoutPath: path.resolve(checkoutPath),
        canonicalRoot: canonicalise(top),
        branch: git(checkoutPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
        remoteUrl: remoteUrl || null,
        remoteRepositoryFullName: parseGitHubRemote(remoteUrl),
      },
    };
  }

  return { read };
}

module.exports = { createRepositoryReader, parseGitHubRemote, canonicalise };
