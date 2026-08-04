"use strict";
/**
 * Provider registry — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 * The extension point. A new provider is added by registering an adapter that satisfies the contract
 * below; nothing in the vault, the session router or the operation gate changes. The registry also
 * publishes the UNION of every provider's environment variable names, which the session router uses as
 * the scrub list when it builds a child environment — that union is why a JD Testing session cannot
 * inherit a PolyGo session's `SUPABASE_ACCESS_TOKEN` simply by being started from the same shell.
 *
 * Adapter contract (all synchronous, all pure except where noted):
 *   name                       string, unique
 *   envVars                    string[] — every variable this provider may place in a child environment
 *   validateConnection(conn)   -> string[] of errors ([] = valid)
 *   buildVerificationPlan(...) -> { provider, readOnly:true, steps:[...] }   (describes; never performs)
 *   evaluateObservation(...)   -> { ok, blocker, detail }                    (pure comparison)
 *   projectEnvironment(...)    -> { VAR: value }                             (values supplied by caller)
 */

const github = require("./github.provider.cjs");
const supabase = require("./supabase.provider.cjs");
const vercel = require("./vercel.provider.cjs");

const REQUIRED_METHODS = ["validateConnection", "buildVerificationPlan", "evaluateObservation", "projectEnvironment"];

function assertAdapter(adapter) {
  if (!adapter || typeof adapter.name !== "string" || !adapter.name) throw new Error("provider-registry: adapter name required");
  if (!Array.isArray(adapter.envVars) || adapter.envVars.some((v) => typeof v !== "string" || !v)) {
    throw new Error("provider-registry: adapter '" + adapter.name + "' must declare envVars");
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== "function") throw new Error("provider-registry: adapter '" + adapter.name + "' is missing " + method + "()");
  }
  return adapter;
}

function createRegistry(extraAdapters) {
  const adapters = new Map();
  const register = (adapter) => {
    assertAdapter(adapter);
    if (adapters.has(adapter.name)) throw new Error("provider-registry: adapter already registered: " + adapter.name);
    adapters.set(adapter.name, adapter);
    return adapter.name;
  };

  for (const adapter of [github, supabase, vercel]) register(adapter);
  for (const adapter of Array.isArray(extraAdapters) ? extraAdapters : []) register(adapter);

  const get = (name) => (typeof name === "string" && adapters.has(name) ? adapters.get(name) : null);
  const names = () => [...adapters.keys()].sort();

  /** Union of every provider variable name — the scrub list for a freshly built child environment. */
  const allEnvVars = () => {
    const set = new Set();
    for (const adapter of adapters.values()) for (const v of adapter.envVars) set.add(v);
    return [...set].sort();
  };

  /**
   * Validate a connection profile against every adapter it claims to support. Returns a flat error list;
   * an unknown provider name is an error, not a silent skip.
   */
  const validateConnection = (connection) => {
    const errors = [];
    // The project id becomes the second segment of every credential reference this session builds, so it
    // must satisfy the reference charset HERE — otherwise `formatReference` throws deep inside the router
    // and a malformed profile escapes the closed set of preflight blockers as an unhandled exception.
    const projectId = connection && connection.projectId;
    if (typeof projectId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(projectId)) {
      errors.push("connection: projectId is missing or not a valid reference segment");
    }
    const declared = Array.isArray(connection && connection.providers) ? connection.providers : [];
    for (const name of declared) {
      const adapter = get(name);
      if (!adapter) { errors.push("connection: unknown provider '" + String(name) + "'"); continue; }
      errors.push(...adapter.validateConnection(connection));
    }
    return errors;
  };

  return { register, get, names, allEnvVars, validateConnection };
}

module.exports = { createRegistry, assertAdapter };
