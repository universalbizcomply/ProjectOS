"use strict";
/**
 * Project identity preflight — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3 gate).
 *
 * Answers exactly one question: may this session be declared READY? It returns either `READY` or ONE
 * blocker from a closed set. There is no partial success, no warning tier, and no continue-anyway path —
 * the caller stops at the first blocker.
 *
 *   REPOSITORY MISMATCH        the checkout is not the repository this profile names
 *   GITHUB IDENTITY MISMATCH   the observed GitHub repository is not the pinned one
 *   SUPABASE PROJECT MISMATCH  the observed Supabase project ref is not the pinned one
 *   VERCEL PROJECT MISMATCH    the observed Vercel org/project is not the pinned one
 *   CREDENTIAL MISSING         a credential this profile needs is not provisioned
 *   CREDENTIAL EXPIRED         a credential this profile needs is past its recorded expiry
 *   WRITE LEASE CONFLICT       another modifying session already holds this checkout
 *   OWNER PERMIT REQUIRED      this profile requires a permit and none was presented
 *   PRODUCTION PROFILE REFUSED this profile may not be loaded for this environment / not automatically
 *
 * The function is PURE: every fact — repository observation, provider observations, credential status,
 * permit, lease outcome — is supplied by the caller. That is what lets validators drive all nine blockers
 * deterministically without a checkout, a provider or a credential store.
 *
 * Ordering is deliberate. Cheap structural facts (profile, environment, repository) are checked before
 * credential facts, which are checked before provider identity, which is checked before the permit and
 * the lease. A session that fails on its repository never reaches a state where it would have needed a
 * credential at all.
 */

const { getProfile, permitsEnvironment } = require("./session-profiles.cjs");

const READY = "READY";
const BLOCKERS = Object.freeze([
  "REPOSITORY MISMATCH",
  "GITHUB IDENTITY MISMATCH",
  "SUPABASE PROJECT MISMATCH",
  "VERCEL PROJECT MISMATCH",
  "CREDENTIAL MISSING",
  "CREDENTIAL EXPIRED",
  "WRITE LEASE CONFLICT",
  "OWNER PERMIT REQUIRED",
  "PRODUCTION PROFILE REFUSED",
]);

function blocked(blocker, detail, checks) {
  return { status: blocker, ready: false, blocker, detail, checks };
}

/**
 * @param input {
 *   connection, environment, profileName, repository, observations, credentials, permit, lease, registry
 * }
 *   repository   { canonicalRoot, branch, remoteRepositoryFullName } as observed
 *   observations { github?, supabase?, vercel? } raw provider observations (may be absent)
 *   credentials  [{ reference, credential, present, expired }] for the credentials this profile needs
 *   permit       owner permit object, or null
 *   lease        { ok:true } | { ok:false, reason:"WRITE LEASE CONFLICT", heldBy } | null (not required)
 */
function evaluatePreflight(input) {
  const req = input || {};
  const checks = [];
  const record = (name, ok, detail) => { checks.push({ name, ok, detail: detail || null }); return ok; };

  const connection = req.connection || null;
  const environment = req.environment;
  const profile = getProfile(req.profileName);

  if (!connection || typeof connection.projectId !== "string" || !connection.projectId) {
    return blocked("REPOSITORY MISMATCH", "no connection profile was supplied for this session", checks);
  }
  if (!profile) {
    return blocked("PRODUCTION PROFILE REFUSED", "unknown session profile '" + String(req.profileName) + "'", checks);
  }
  record("profile", true, profile.name);

  // Environment binding. A profile that does not list the environment can never be coerced into it, and a
  // profile marked non-auto-loadable requires an explicit owner permit before anything else is considered.
  if (!permitsEnvironment(profile.name, environment)) {
    return blocked("PRODUCTION PROFILE REFUSED", "profile '" + profile.name + "' may not bind environment '" + String(environment) + "'", checks);
  }
  record("environment", true, environment);

  if (profile.autoLoadable !== true || profile.requiresOwnerPermit === true) {
    const permit = req.permit || null;
    const nowMs = typeof req.nowMs === "function" ? req.nowMs() : Date.now();
    const unexpired = !!permit && (typeof permit.expiresAtMs !== "number" || permit.expiresAtMs > nowMs);
    const matches = permit && unexpired && permit.ownerConfirmation === true && permit.projectId === connection.projectId && permit.environment === environment && permit.profile === profile.name;
    if (!matches) {
      return blocked("OWNER PERMIT REQUIRED", "profile '" + profile.name + "' is not automatically loadable and requires an owner permit for this project and environment", checks);
    }
    record("owner-permit", true, permit.permitId || "(unnamed permit)");
  }

  // Repository identity: canonical root and, when the profile pins them, branch and remote.
  const repository = req.repository || null;
  if (!repository || typeof repository.canonicalRoot !== "string" || !repository.canonicalRoot) {
    return blocked("REPOSITORY MISMATCH", "the checkout could not be observed", checks);
  }
  const expectedRoot = typeof connection.canonicalRepositoryRoot === "string" ? connection.canonicalRepositoryRoot : null;
  if (!expectedRoot || repository.canonicalRoot !== expectedRoot) {
    return blocked("REPOSITORY MISMATCH", "the checkout's canonical root is not the root recorded for project '" + connection.projectId + "'", checks);
  }
  record("repository-root", true, repository.canonicalRoot);

  // THE TRUST ANCHOR. Everything above compares the checkout against a file inside that same checkout,
  // which a forged checkout controls on both sides. The owner registry lives outside every repository and
  // is written only under owner confirmation, so this is the first check whose other side the checkout
  // cannot choose. A project with no registry entry is refused (fail closed), not admitted by default.
  const projectRegistry = req.projectRegistry || null;
  if (!projectRegistry || typeof projectRegistry.verify !== "function") {
    return blocked("REPOSITORY MISMATCH", "no owner project registry was supplied — a session cannot be admitted on a checkout's own say-so", checks);
  }
  const anchored = projectRegistry.verify({ connection, environment, canonicalRoot: repository.canonicalRoot });
  if (!anchored.ok) return blocked(anchored.blocker, anchored.detail, checks);
  record("owner-registry", true, "project and pinned provider identities match the owner registry");

  if (Array.isArray(connection.allowedBranches) && connection.allowedBranches.length > 0) {
    if (typeof repository.branch !== "string" || !connection.allowedBranches.includes(repository.branch)) {
      return blocked("REPOSITORY MISMATCH", "branch '" + String(repository.branch) + "' is not permitted for this project", checks);
    }
    record("branch", true, repository.branch);
  }

  // Credentials. Presence before expiry, so a missing credential is never reported as an expired one.
  const credentials = Array.isArray(req.credentials) ? req.credentials : [];
  const missing = credentials.find((c) => c && c.present !== true);
  if (missing) return blocked("CREDENTIAL MISSING", "credential '" + String(missing.credential) + "' is not provisioned for this project and environment", checks);
  const expired = credentials.find((c) => c && c.expired === true);
  if (expired) return blocked("CREDENTIAL EXPIRED", "credential '" + String(expired.credential) + "' is past its recorded expiry", checks);
  record("credentials", true, String(credentials.length) + " required credential(s) present");

  // Provider identity. Each adapter is asked only when the project declares that provider AND an
  // observation exists; a declared provider with NO observation is a mismatch, never a pass.
  const registry = req.registry || null;
  const observations = req.observations || {};
  const declared = Array.isArray(connection.providers) ? connection.providers : [];
  for (const providerName of declared) {
    const adapter = registry ? registry.get(providerName) : null;
    if (!adapter) return blocked("REPOSITORY MISMATCH", "project declares unknown provider '" + String(providerName) + "'", checks);
    const observed = Object.prototype.hasOwnProperty.call(observations, providerName) ? observations[providerName] : null;
    const verdict = adapter.evaluateObservation(connection, environment, observed);
    if (!verdict.ok) return blocked(verdict.blocker || (adapter.blocker || "REPOSITORY MISMATCH"), verdict.detail, checks);
    record("provider:" + adapter.name, true, verdict.detail);
  }

  // Writer lease last: it is the only check that consumes a shared resource, so nothing acquires it until
  // every identity fact has already agreed.
  if (profile.requiresWriteLease === true) {
    const lease = req.lease || null;
    if (!lease || lease.ok !== true) {
      const heldBy = lease && lease.heldBy ? lease.heldBy : null;
      return blocked(
        "WRITE LEASE CONFLICT",
        heldBy
          ? "session '" + String(heldBy.sessionId) + "' (pid " + String(heldBy.pid) + ") already holds this checkout — use a separate git worktree for a second writer"
          : "the writer lease for this checkout could not be acquired",
        checks
      );
    }
    record("writer-lease", true, "held");
  }

  return { status: READY, ready: true, blocker: null, detail: null, checks };
}

module.exports = { evaluatePreflight, READY, BLOCKERS };
