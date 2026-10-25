"use strict";
/**
 * Child-environment projection — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A (L3).
 *
 * Builds the environment ONE session's child process will see. Three rules make concurrent sessions safe:
 *
 *  1. NOTHING GLOBAL IS MUTATED. `process.env` is read, never written. The returned object is a fresh
 *     null-prototype object; the caller hands it to `spawn` and drops it.
 *  2. INHERITED PROVIDER STATE IS SCRUBBED FIRST. Every variable any registered provider could set is
 *     removed from the inherited copy before this session's own values are added. A shell that already
 *     carries another project's `GH_TOKEN` therefore cannot leak it into this session — the scrub is
 *     unconditional, so it also removes variables this session will not set.
 *  3. ONLY DECLARED CONTRIBUTIONS ARE ADDED. A contribution key that no registered provider declares is
 *     refused rather than passed through, so a malformed adapter cannot smuggle an extra variable in.
 *
 * The `.mcp.json` helpers enforce the matching rule for MCP servers: a project's MCP config may contain
 * `${VAR}` placeholders only. A literal secret-shaped value in an MCP config is a hard error, and a
 * placeholder with no corresponding variable in the projected environment is a hard error too — an MCP
 * server started with an unresolved placeholder would silently act as an anonymous or wrong principal.
 */

const { matchedShapes, PATTERNS: LITERAL_SECRET_PATTERNS } = require("../credentials/credential-shapes.cjs");

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Keys whose value must be a bare `${VAR}` placeholder. This is the structural half of the literal-secret
 * check: a regex zoo can only recognise token shapes someone thought to add (a raw Vercel token, for one,
 * has no distinctive prefix), whereas "the value of a key called *_TOKEN is not a placeholder" catches
 * every provider, including ones added later.
 */
// Suffix match for the short, ambiguous words (KEY, PAT — `PATHEXT` must not match), anywhere-match for
// the unambiguous ones, so `apiKeyId` and `tokenValue` are covered too.
const CREDENTIAL_KEY_RE = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|APIKEY)|(KEY|PAT)$/i;
const BARE_PLACEHOLDER_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * @param input { baseEnv, providerEnvVars, contributions }
 *   baseEnv          the environment to inherit from (defaults to a copy of process.env)
 *   providerEnvVars  every variable name any provider may set — the unconditional scrub list
 *   contributions    { VAR: value } this session is adding
 * @returns { env, scrubbed, added }
 */
function buildChildEnvironment(input) {
  const req = input || {};
  const base = req.baseEnv && typeof req.baseEnv === "object" ? req.baseEnv : process.env;
  const providerEnvVars = Array.isArray(req.providerEnvVars) ? req.providerEnvVars : [];
  const contributions = req.contributions && typeof req.contributions === "object" ? req.contributions : {};

  const scrubSet = new Set(providerEnvVars);
  const env = Object.create(null);
  const scrubbed = [];
  for (const key of Object.keys(base)) {
    if (scrubSet.has(key)) { scrubbed.push(key); continue; }
    const value = base[key];
    if (typeof value === "string") env[key] = value;
  }

  const added = [];
  for (const key of Object.keys(contributions)) {
    if (!scrubSet.has(key)) {
      throw new Error("env-projection: refusing to set undeclared provider variable '" + key + "'");
    }
    const value = contributions[key];
    if (typeof value !== "string" || !value) continue;
    env[key] = value;
    added.push(key);
  }
  return { env, scrubbed: scrubbed.sort(), added: added.sort() };
}

/** Every `${VAR}` name referenced anywhere in a JSON-serialisable config. */
function extractPlaceholders(config) {
  const text = typeof config === "string" ? config : JSON.stringify(config || {});
  const names = new Set();
  let match;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(text)) !== null) names.add(match[1]);
  return [...names].sort();
}

/**
 * Validate an MCP config against a projected environment.
 * @returns { ok, missingPlaceholders, disallowedServers, literalSecrets }
 */
function validateMcpConfig(input) {
  const req = input || {};
  const config = req.mcpConfig || {};
  const env = req.env || {};
  const allowedServers = Array.isArray(req.allowedServers) ? req.allowedServers : null;
  const text = JSON.stringify(config);

  const literalSecrets = matchedShapes(text);
  // Structural check: any credential-named key anywhere in the config must hold a bare placeholder.
  // `underKey` carries the nearest credential-shaped ancestor DOWN through nested objects and arrays —
  // without it, `{"GH_TOKEN": {"raw": "<secret>"}}` would skip the check entirely because the value at the
  // matching key is not itself a string.
  const walk = (node, trail, underKey) => {
    if (typeof node === "string") {
      if (underKey && !BARE_PLACEHOLDER_RE.test(node)) {
        literalSecrets.push("non-placeholder value for credential key '" + underKey + "'" + (trail ? " at " + trail : ""));
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, trail + "[" + i + "]", underKey)); return; }
    for (const [key, value] of Object.entries(node)) {
      const nextUnderKey = CREDENTIAL_KEY_RE.test(key) ? key : underKey;
      walk(value, trail ? trail + "." + key : key, nextUnderKey);
    }
  };
  walk(config, "", null);

  const servers = config.mcpServers && typeof config.mcpServers === "object" ? Object.keys(config.mcpServers) : [];
  const disallowedServers = allowedServers ? servers.filter((s) => !allowedServers.includes(s)) : [];

  const missingPlaceholders = extractPlaceholders(config).filter((name) => typeof env[name] !== "string" || !env[name]);

  return {
    ok: literalSecrets.length === 0 && disallowedServers.length === 0 && missingPlaceholders.length === 0,
    missingPlaceholders,
    disallowedServers,
    literalSecrets,
  };
}

module.exports = { buildChildEnvironment, extractPlaceholders, validateMcpConfig, LITERAL_SECRET_PATTERNS };
