"use strict";
/**
 * GitHub provider adapter — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 * Session-local GitHub identity. The machine-global `gh` account is never touched:
 *  - `GH_TOKEN` and `GH_REPO` are projected into the CHILD environment only;
 *  - `gh auth switch`, `gh auth login` and `gh auth logout` are refused by name — flipping the active
 *    account is machine-global and would break every other concurrently running project session;
 *  - the `gh` API identity and the raw `git push` credential are treated as SEPARATE facts. A token that
 *    authenticates the REST API does not imply the repository-local git credential helper will push as
 *    the same principal, so both are reported and neither is inferred from the other.
 *
 * Verification is planned here and evaluated here, but never performed here: `buildVerificationPlan`
 * describes the read-only calls a live phase would make, and `evaluateObservation` is a pure comparison
 * of an expected profile against an observation someone else supplied. This module makes no network call.
 */

const NAME = "github";
const BLOCKER = "GITHUB IDENTITY MISMATCH";

/** Commands that mutate machine-global GitHub auth state. Refused unconditionally. */
const FORBIDDEN_COMMANDS = Object.freeze(["gh auth switch", "gh auth login", "gh auth logout", "gh auth refresh"]);

const ENV_VARS = Object.freeze(["GH_TOKEN", "GH_REPO"]);

/**
 * Credentials this provider can take into a session, as (projection key → credential name). The session
 * router resolves each to `ProjectOS/<project>/<environment>/github/<credential>` and asks the vault; the
 * profile still has the final say on whether the credential may be projected at all.
 */
const SESSION_CREDENTIALS = Object.freeze([Object.freeze({ key: "token", credential: "gh-token" })]);

/** `owner/repo`, the only shape `GH_REPO` may take. */
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

function validateConnection(connection) {
  const errors = [];
  const gh = (connection && connection.github) || null;
  if (!gh) return ["github: connection profile has no github block"];
  if (typeof gh.repository !== "string" || !REPO_RE.test(gh.repository)) errors.push("github: repository must be 'owner/repo'");
  if (gh.credential !== undefined && typeof gh.credential !== "string") errors.push("github: credential must be a reference name");
  return errors;
}

/**
 * Read-only steps a live verification phase would run. Nothing here is executed by this module.
 * `environment` is accepted but unused: GitHub identity is per-repository, not per-environment. It is on
 * the signature so every adapter shares ONE call shape and no caller has to special-case this provider.
 */
function buildVerificationPlan(connection, environment) {
  const repository = connection.github.repository;
  return {
    provider: NAME,
    readOnly: true,
    steps: [
      { id: "api-identity", description: "GET /repos/" + repository + " with the session GH_TOKEN; compare full_name", mutating: false },
      { id: "api-viewer", description: "GET /user to record which principal the API token authenticates as", mutating: false },
      { id: "git-remote", description: "read the checkout's configured origin URL; compare owner/repo", mutating: false },
      { id: "git-push-principal", description: "record that the git push credential is resolved by the repository-local credential helper, independently of GH_TOKEN", mutating: false },
    ],
  };
}

/**
 * Pure comparison. `observed` is whatever a live phase measured; every field is optional and a MISSING
 * field is never treated as a match.
 * @returns { ok, blocker, detail }
 */
function evaluateObservation(connection, environment, observed) {
  const expected = connection.github.repository;
  const o = observed || {};
  if (typeof o.apiRepositoryFullName !== "string" || !o.apiRepositoryFullName) {
    return { ok: false, blocker: BLOCKER, detail: "no GitHub repository identity was observed" };
  }
  if (o.apiRepositoryFullName !== expected) {
    return { ok: false, blocker: BLOCKER, detail: "API repository '" + o.apiRepositoryFullName + "' does not match the profile's '" + expected + "'" };
  }
  // The configured remote must agree with the profile too — an API token pointed at the right repo while
  // the checkout pushes somewhere else is exactly the confusion this capability exists to stop.
  if (typeof o.remoteRepositoryFullName === "string" && o.remoteRepositoryFullName && o.remoteRepositoryFullName !== expected) {
    return { ok: false, blocker: "REPOSITORY MISMATCH", detail: "git remote '" + o.remoteRepositoryFullName + "' does not match the profile's '" + expected + "'" };
  }
  return { ok: true, blocker: null, detail: "GitHub identity matches " + expected };
}

/** Environment this provider contributes to a child session. Values come from the vault, never from here. */
function projectEnvironment(connection, environment, values) {
  const env = {};
  if (typeof values.token === "string" && values.token) env.GH_TOKEN = values.token;
  env.GH_REPO = connection.github.repository;
  return env;
}

/** Refuse any command that would change machine-global GitHub auth state. */
function assertCommandAllowed(command) {
  const text = String(command || "").toLowerCase().replace(/\s+/g, " ").trim();
  for (const forbidden of FORBIDDEN_COMMANDS) {
    if (text === forbidden || text.startsWith(forbidden + " ")) {
      return { allowed: false, reason: "github: '" + forbidden + "' mutates machine-global auth state and is refused" };
    }
  }
  return { allowed: true, reason: null };
}

module.exports = {
  name: NAME,
  blocker: BLOCKER,
  envVars: ENV_VARS,
  sessionCredentials: SESSION_CREDENTIALS,
  forbiddenCommands: FORBIDDEN_COMMANDS,
  validateConnection,
  buildVerificationPlan,
  evaluateObservation,
  projectEnvironment,
  assertCommandAllowed,
};
