"use strict";
/**
 * Vercel provider adapter — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 * Policy:
 *  - ORGANISATION AND PROJECT IDS ARE PINNED per environment. A deploy or configuration change is
 *    evaluated against both; matching the project but not the organisation is still a mismatch.
 *  - IDENTITY BEFORE DEPLOY OR CONFIGURE. A missing observation is a mismatch, never a pass.
 *  - PRODUCTION DEPLOY REQUIRES A SPECIFIC OWNER PERMIT. Not a profile, not a flag, not an environment
 *    variable: a permit naming this project, this environment and the deploy action. Without one the
 *    answer is `PRODUCTION PROFILE REFUSED`.
 *  - THE TOKEN TRAVELS IN THE ENVIRONMENT, NEVER IN ARGV. `projectEnvironment` is the only way this
 *    adapter emits a token, and `assertCommandArgumentsClean` refuses any command line carrying one.
 *
 * No network call is made here.
 */

const NAME = "vercel";
const BLOCKER = "VERCEL PROJECT MISMATCH";

const ENV_VARS = Object.freeze(["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"]);
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_CREDENTIALS = Object.freeze([Object.freeze({ key: "token", credential: "vercel-token" })]);
/** Command-line shapes that would put a token in argv (and therefore in every process listing). */
const TOKEN_ARGUMENT_RE = /^(--token|-t|--token=.*)$/i;

function environmentBlock(connection, environment) {
  const vc = (connection && connection.vercel) || null;
  if (!vc || !vc.environments || typeof vc.environments !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(vc.environments, environment)) return null;
  return vc.environments[environment];
}

function validateConnection(connection) {
  const errors = [];
  const vc = (connection && connection.vercel) || null;
  if (!vc) return errors; // Vercel is optional for a project.
  if (typeof vc.organisationId !== "string" || !ID_RE.test(vc.organisationId)) errors.push("vercel: organisationId required");
  if (!vc.environments || typeof vc.environments !== "object") return errors.concat("vercel: environments block required");
  for (const [environment, block] of Object.entries(vc.environments)) {
    if (!block || typeof block !== "object") { errors.push("vercel: environment '" + environment + "' must be an object"); continue; }
    if (typeof block.projectId !== "string" || !ID_RE.test(block.projectId)) errors.push("vercel: environment '" + environment + "' projectId required");
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
          { id: "project-identity", description: "GET /v9/projects/" + block.projectId + " scoped to the pinned organisation; compare id", mutating: false },
          { id: "org-identity", description: "confirm the returned project's ownerId equals the pinned organisation id", mutating: false },
        ]
      : [],
  };
}

function evaluateObservation(connection, environment, observed) {
  const block = environmentBlock(connection, environment);
  if (!block) return { ok: false, blocker: BLOCKER, detail: "no Vercel configuration for environment '" + environment + "'" };
  const o = observed || {};
  if (typeof o.projectId !== "string" || !o.projectId || typeof o.organisationId !== "string" || !o.organisationId) {
    return { ok: false, blocker: BLOCKER, detail: "no Vercel project identity was observed" };
  }
  if (o.organisationId !== connection.vercel.organisationId) {
    return { ok: false, blocker: BLOCKER, detail: "observed organisation does not match the pinned organisation" };
  }
  if (o.projectId !== block.projectId) {
    return { ok: false, blocker: BLOCKER, detail: "observed project does not match the project pinned for '" + environment + "'" };
  }
  return { ok: true, blocker: null, detail: "Vercel organisation and project match the pinned ids for '" + environment + "'" };
}

function projectEnvironment(connection, environment, values) {
  const block = environmentBlock(connection, environment);
  const env = {};
  if (connection.vercel && typeof connection.vercel.organisationId === "string") env.VERCEL_ORG_ID = connection.vercel.organisationId;
  if (block) env.VERCEL_PROJECT_ID = block.projectId;
  if (typeof values.token === "string" && values.token) env.VERCEL_TOKEN = values.token;
  return env;
}

/**
 * Production deploy gate. Requires a permit naming this project, this environment and this action.
 * @returns { allowed, blocker, reason }
 */
function evaluateDeploy(connection, environment, permit) {
  if (environment !== "production") return { allowed: true, blocker: null, reason: "non-production deploy" };
  const p = permit || null;
  if (!p || p.action !== "vercel-production-deploy" || p.projectId !== connection.projectId || p.environment !== "production") {
    return { allowed: false, blocker: "PRODUCTION PROFILE REFUSED", reason: "a production deploy requires a specific owner permit for this project" };
  }
  if (p.ownerConfirmation !== true) {
    return { allowed: false, blocker: "OWNER PERMIT REQUIRED", reason: "the production deploy permit is not owner-confirmed" };
  }
  return { allowed: true, blocker: null, reason: "owner-permitted production deploy" };
}

/** Refuse a command line that carries a token as an argument. */
function assertCommandArgumentsClean(args) {
  const list = Array.isArray(args) ? args : [];
  for (const arg of list) {
    if (typeof arg === "string" && TOKEN_ARGUMENT_RE.test(arg)) {
      return { allowed: false, reason: "vercel: a token must travel in the environment, never as a command argument" };
    }
  }
  return { allowed: true, reason: null };
}

module.exports = {
  name: NAME,
  blocker: BLOCKER,
  envVars: ENV_VARS,
  sessionCredentials: SESSION_CREDENTIALS,
  validateConnection,
  buildVerificationPlan,
  evaluateObservation,
  projectEnvironment,
  evaluateDeploy,
  assertCommandArgumentsClean,
};
