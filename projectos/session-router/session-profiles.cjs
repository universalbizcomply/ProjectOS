"use strict";
/**
 * Session capability profiles — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3).
 *
 * A profile is the answer to "what is this session allowed to be?". It is chosen BEFORE any credential
 * is looked up, and it decides three things independently:
 *
 *   1. WHICH ENVIRONMENTS the session may bind to (a staging profile can never bind production);
 *   2. WHICH CREDENTIALS may be projected into the child environment (an allowlist of credential names,
 *      never a class or a wildcard — an operation-class credential appears on no profile);
 *   3. WHICH CAPABILITIES the session claims (repository write, provider write, deploy, migrate), which
 *      is what read/write separation and the one-writer-per-checkout lease key off.
 *
 * The table is frozen at module load so no in-process code can widen a profile at runtime.
 *
 * `production-operation` is deliberately NOT auto-loadable: `autoLoadable:false` means the session router
 * refuses to start it from an ordinary request, and it additionally requires an owner permit. It exists so
 * production work has a named, gated shape — not so it can be selected conveniently.
 */

const crypto = require("crypto");
const { classifyRisk } = require("../credentials/reference.cjs");

const DEFAULT_PERMIT_TTL_MS = 10 * 60 * 1000;

const PROFILES = {
  "readonly-reviewer": {
    name: "readonly-reviewer",
    description: "Read-only review of code and provider configuration. Cannot write anything, anywhere.",
    environments: ["development", "staging"],
    credentials: ["gh-token"],
    capabilities: { repositoryWrite: false, providerWrite: false, deploy: false, migrate: false },
    mcpServers: ["github"],
    autoLoadable: true,
    requiresOwnerPermit: false,
    requiresWriteLease: false,
  },
  "staging-writer": {
    name: "staging-writer",
    description: "Writes code and staging provider state. Holds the checkout's single writer lease.",
    environments: ["development", "staging"],
    credentials: ["gh-token", "supabase-access-token", "vercel-token"],
    capabilities: { repositoryWrite: true, providerWrite: true, deploy: false, migrate: true },
    mcpServers: ["github", "supabase", "vercel"],
    autoLoadable: true,
    requiresOwnerPermit: false,
    requiresWriteLease: true,
  },
  "proof-runner": {
    name: "proof-runner",
    description: "Runs local builds, tests and proofs. Reads the repository; writes nothing external.",
    environments: ["development", "staging"],
    credentials: ["gh-token"],
    capabilities: { repositoryWrite: false, providerWrite: false, deploy: false, migrate: false },
    mcpServers: ["github"],
    autoLoadable: true,
    requiresOwnerPermit: false,
    requiresWriteLease: false,
  },
  "production-readonly": {
    name: "production-readonly",
    description: "Reads production configuration and logs. Cannot deploy, migrate or mutate anything.",
    environments: ["production"],
    credentials: ["gh-token"],
    capabilities: { repositoryWrite: false, providerWrite: false, deploy: false, migrate: false },
    // Production Supabase MCP is disabled by policy — see providers/supabase.provider.cjs.
    mcpServers: ["github"],
    autoLoadable: true,
    requiresOwnerPermit: false,
    requiresWriteLease: false,
  },
  "production-operation": {
    name: "production-operation",
    description: "One owner-gated production operation. Never auto-loaded; never projects a credential.",
    environments: ["production"],
    // Deliberately empty: a production operation obtains its credential through the operation gate for a
    // single command, not through the session environment.
    credentials: [],
    capabilities: { repositoryWrite: true, providerWrite: true, deploy: true, migrate: true },
    mcpServers: [],
    autoLoadable: false,
    requiresOwnerPermit: true,
    requiresWriteLease: true,
  },
};

// The profile tables and the fail-closed risk classification in credentials/reference.cjs express the
// same "may this credential enter a session?" rule. Assert they agree AT LOAD, so the two lists cannot
// drift into a state where a profile offers a credential the vault will then refuse mid-session.
for (const profile of Object.values(PROFILES)) {
  for (const credential of profile.credentials) {
    if (classifyRisk(credential) !== "session") {
      throw new Error("session-profiles: profile '" + profile.name + "' lists operation-class credential '" + credential + "'");
    }
  }
}

for (const profile of Object.values(PROFILES)) {
  Object.freeze(profile.capabilities);
  Object.freeze(profile.environments);
  Object.freeze(profile.credentials);
  Object.freeze(profile.mcpServers);
  Object.freeze(profile);
}
Object.freeze(PROFILES);

const PROFILE_NAMES = Object.freeze(Object.keys(PROFILES));

/** Look up a profile by name. Own-property only, so `__proto__`/`constructor` cannot resolve a profile. */
function getProfile(name) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(PROFILES, name)) return null;
  return PROFILES[name];
}

/** True when this profile may bind the given environment. Unknown profile or environment → false. */
function permitsEnvironment(name, environment) {
  const profile = getProfile(name);
  return !!profile && profile.environments.includes(environment);
}

/** True when this profile may project the given credential name into a child environment. */
function permitsCredential(name, credentialName) {
  const profile = getProfile(name);
  return !!profile && profile.credentials.includes(credentialName);
}

/** A session is "modifying" — and therefore needs the checkout's writer lease — per its own profile. */
function isWriter(name) {
  const profile = getProfile(name);
  return !!profile && profile.requiresWriteLease === true;
}

/**
 * Mint the permit a non-auto-loadable profile (today: `production-operation`) needs before the preflight
 * will admit it. This is a SESSION permit — it names a project, an environment and a profile — and is a
 * different thing from the operation gate's action-scoped credential permit. Owner-confirmed only:
 * automation must never plumb `ownerConfirmation` through from its own input.
 */
function mintProfilePermit(input) {
  const req = input || {};
  if ((req.capability || {}).ownerConfirmation !== true) throw new Error("OWNER PERMIT REQUIRED");
  const profile = getProfile(req.profile);
  if (!profile) throw new Error("session-profiles: unknown profile");
  if (!profile.environments.includes(req.environment)) throw new Error("session-profiles: profile may not bind that environment");
  if (typeof req.projectId !== "string" || !req.projectId) throw new Error("session-profiles: projectId required");
  const ttl = Number.isFinite(req.ttlMs) && req.ttlMs > 0 ? req.ttlMs : DEFAULT_PERMIT_TTL_MS;
  const nowMs = typeof req.nowMs === "function" ? req.nowMs() : Date.now();
  return Object.freeze({
    permitId: "sessionpermit_" + crypto.randomBytes(9).toString("hex"),
    projectId: req.projectId,
    environment: req.environment,
    profile: profile.name,
    phaseId: typeof req.phaseId === "string" ? req.phaseId : null,
    ownerConfirmation: true,
    expiresAtMs: nowMs + ttl,
  });
}

module.exports = { PROFILES, PROFILE_NAMES, getProfile, permitsEnvironment, permitsCredential, isWriter, mintProfilePermit, DEFAULT_PERMIT_TTL_MS };
