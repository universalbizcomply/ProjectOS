"use strict";
/**
 * Trusted Claude invocation-profile contract — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§8).
 *
 * Tool/command restrictions are only "enforced" when TECHNICALLY VERIFIED. This contract must FAIL CLOSED
 * when the installed CLI version or its supported restriction flags cannot be verified. For the first real
 * controlled-change proof the profile permits ONLY bounded file inspection + editing: no shell, no git-write,
 * no provider CLI, no database CLI, no deployment CLI, no network-capable tool.
 *
 * This module does NOT run the real CLI. It defines the profile shape, a fail-closed verifier, and the
 * first-controlled-change profile. Real detection of the CLI version + supported flags is an owner-machine
 * step; absent that, `verifyProfile` returns BLOCKED — WORKER-TOOL-RESTRICTION-NOT-PROVEN.
 */

const REQUIRED = [
  "cliVersion", "restrictionMechanism", "permittedTools", "forbiddenTools", "permittedCommands",
  "forbiddenCommands", "shellPermitted", "networkPermitted", "providerCliPermitted", "gitWritePermitted",
  "verified",
];

// For the FIRST controlled-change proof, all of these must be forbidden.
const MUST_FORBID_TOOLS = ["Bash", "Shell", "Execute", "WebFetch", "WebSearch"];
const MUST_BE_FALSE = ["shellPermitted", "networkPermitted", "providerCliPermitted", "gitWritePermitted"];

/** The mandatory profile for the first controlled-change proof: inspect + bounded edit only. */
function firstControlledChangeProfile(extra) {
  return Object.assign({
    cliVersion: null, // must be filled by real detection on the owner machine
    restrictionMechanism: null, // e.g. "--allowedTools" — must be a verified, supported mechanism
    permittedTools: ["Read", "Edit"],
    forbiddenTools: MUST_FORBID_TOOLS.concat(["Git", "GitWrite", "Provider", "Database", "Deploy"]),
    permittedCommands: [],
    forbiddenCommands: ["git", "gh", "supabase", "psql", "vercel", "npm", "curl", "wget", "ssh"],
    shellPermitted: false, networkPermitted: false, providerCliPermitted: false, gitWritePermitted: false,
    verified: false,
  }, extra || {});
}

/**
 * Fail-closed verification of a profile.
 * @returns { ok:true, profile } | { ok:false, decision:"BLOCKED", reason:"WORKER-TOOL-RESTRICTION-NOT-PROVEN", errors }
 */
function verifyProfile(profile, opts) {
  const o = opts || {};
  const errors = [];
  if (!profile || typeof profile !== "object") return blocked(["no profile"]);
  for (const k of REQUIRED) if (!(k in profile)) errors.push("missing '" + k + "'");
  if (profile.verified !== true) errors.push("profile.verified is not true (CLI version / supported flags not confirmed)");
  if (!profile.cliVersion) errors.push("cliVersion not detected");
  if (!profile.restrictionMechanism) errors.push("restrictionMechanism not a verified supported flag");
  if (!Array.isArray(profile.permittedTools)) errors.push("permittedTools must be an array");
  if (!Array.isArray(profile.permittedCommands)) errors.push("permittedCommands must be an array");
  if (o.firstControlledChange) {
    for (const f of MUST_BE_FALSE) if (profile[f] !== false) errors.push(f + " must be false for the first controlled-change proof");
    const permitted = new Set((Array.isArray(profile.permittedTools) ? profile.permittedTools : []).map(String));
    for (const t of MUST_FORBID_TOOLS) if (permitted.has(t)) errors.push("tool '" + t + "' must not be permitted");
    if (Array.isArray(profile.permittedCommands) && profile.permittedCommands.length > 0) errors.push("permittedCommands must be empty for the first controlled-change proof (inspect + edit only)");
  }
  if (errors.length) return blocked(errors);
  return { ok: true, profile: profile };
}
function blocked(errors) { return { ok: false, decision: "BLOCKED", reason: "WORKER-TOOL-RESTRICTION-NOT-PROVEN", errors }; }

/** Summary for the evidence record (booleans + lists, no secrets). */
function profileSummary(profile) {
  if (!profile) return null;
  return {
    cliVersion: profile.cliVersion, restrictionMechanism: profile.restrictionMechanism,
    permittedTools: profile.permittedTools, forbiddenTools: profile.forbiddenTools,
    permittedCommands: profile.permittedCommands, forbiddenCommands: profile.forbiddenCommands,
    shellPermitted: profile.shellPermitted, networkPermitted: profile.networkPermitted,
    providerCliPermitted: profile.providerCliPermitted, gitWritePermitted: profile.gitWritePermitted,
    verified: profile.verified,
  };
}

module.exports = { firstControlledChangeProfile, verifyProfile, profileSummary, REQUIRED, MUST_FORBID_TOOLS };
