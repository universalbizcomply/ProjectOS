"use strict";
/**
 * Supabase provider adapter — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 * Policy, in order of severity:
 *  - PROJECT REF IS PINNED. The environment's project ref comes from the connection profile. A session
 *    binds exactly one ref, and any observation naming a different ref is a hard blocker — a swapped ref
 *    is the single most damaging confusion available across six concurrent sessions.
 *  - PRODUCTION MCP IS DISABLED. The Supabase MCP server may be enabled for development and staging only.
 *    There is no flag, permit or profile that turns it on for production; the answer is structural.
 *  - THE ACCESS TOKEN IS SESSION-SCOPED; THE DATABASE PASSWORD AND SERVICE-ROLE KEY ARE NOT. The CLI
 *    access token may be projected into a session environment. The database password and the service-role
 *    key are operation-class: they are released for one owner-gated command and never enter a session.
 *  - IDENTITY BEFORE WRITE. `evaluateObservation` must return ok before any migration or write; a missing
 *    observation is a mismatch, never a pass.
 *
 * No network call is made here. Verification is planned and evaluated; performing it is a later phase.
 */

const NAME = "supabase";
const BLOCKER = "SUPABASE PROJECT MISMATCH";

const ENV_VARS = Object.freeze(["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"]);
/** Supabase project refs are 20 lowercase letters; pinning the shape blocks obvious substitutions. */
const REF_RE = /^[a-z]{20}$/;

/** The only Supabase credential a session may hold. The password and service-role key are absent by design. */
const SESSION_CREDENTIALS = Object.freeze([Object.freeze({ key: "accessToken", credential: "supabase-access-token" })]);

/** Credentials that must never be projected into a session environment. */
const OPERATION_ONLY_CREDENTIALS = Object.freeze(["db-password", "service-role-key"]);

/** Environments in which the Supabase MCP server may be enabled. Production is absent by design. */
const MCP_ENVIRONMENTS = Object.freeze(["development", "staging"]);

function environmentBlock(connection, environment) {
  const sb = (connection && connection.supabase) || null;
  if (!sb || !sb.environments || typeof sb.environments !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(sb.environments, environment)) return null;
  return sb.environments[environment];
}

function validateConnection(connection) {
  const errors = [];
  const sb = (connection && connection.supabase) || null;
  if (!sb) return errors; // Supabase is optional for a project.
  if (!sb.environments || typeof sb.environments !== "object") return ["supabase: environments block required"];
  for (const [environment, block] of Object.entries(sb.environments)) {
    if (!block || typeof block !== "object") { errors.push("supabase: environment '" + environment + "' must be an object"); continue; }
    if (typeof block.projectRef !== "string" || !REF_RE.test(block.projectRef)) {
      errors.push("supabase: environment '" + environment + "' projectRef must be 20 lowercase letters");
    }
  }
  return errors;
}

function buildVerificationPlan(connection, environment) {
  const block = environmentBlock(connection, environment);
  return {
    provider: NAME,
    readOnly: true,
    steps: block
      ? [
          { id: "project-identity", description: "GET /v1/projects/" + block.projectRef + " with the session access token; compare id and region", mutating: false },
          { id: "environment-agreement", description: "confirm the returned project's name/environment tag matches '" + environment + "'", mutating: false },
        ]
      : [],
  };
}

/**
 * Pure comparison against the pinned ref. Fail-closed: an absent observation is a mismatch.
 */
function evaluateObservation(connection, environment, observed) {
  const block = environmentBlock(connection, environment);
  if (!block) return { ok: false, blocker: BLOCKER, detail: "no Supabase configuration for environment '" + environment + "'" };
  const o = observed || {};
  if (typeof o.projectRef !== "string" || !o.projectRef) {
    return { ok: false, blocker: BLOCKER, detail: "no Supabase project identity was observed" };
  }
  if (o.projectRef !== block.projectRef) {
    return { ok: false, blocker: BLOCKER, detail: "observed project ref does not match the ref pinned for '" + environment + "'" };
  }
  return { ok: true, blocker: null, detail: "Supabase project ref matches the pinned ref for '" + environment + "'" };
}

function projectEnvironment(connection, environment, values) {
  const block = environmentBlock(connection, environment);
  const env = {};
  if (block) env.SUPABASE_PROJECT_REF = block.projectRef;
  if (typeof values.accessToken === "string" && values.accessToken) env.SUPABASE_ACCESS_TOKEN = values.accessToken;
  return env;
}

/** Structural: there is no argument that makes this true for production. */
function mcpEnabledFor(environment) {
  return MCP_ENVIRONMENTS.includes(environment);
}

/** Guard used by the session router: refuse to project a credential that must stay operation-scoped. */
function assertCredentialProjectable(credentialName) {
  if (OPERATION_ONLY_CREDENTIALS.includes(credentialName)) {
    return { allowed: false, reason: "supabase: '" + credentialName + "' is operation-scoped and must never enter a session environment" };
  }
  return { allowed: true, reason: null };
}

module.exports = {
  name: NAME,
  blocker: BLOCKER,
  envVars: ENV_VARS,
  sessionCredentials: SESSION_CREDENTIALS,
  operationOnlyCredentials: OPERATION_ONLY_CREDENTIALS,
  mcpEnvironments: MCP_ENVIRONMENTS,
  validateConnection,
  buildVerificationPlan,
  evaluateObservation,
  projectEnvironment,
  mcpEnabledFor,
  assertCredentialProjectable,
};
