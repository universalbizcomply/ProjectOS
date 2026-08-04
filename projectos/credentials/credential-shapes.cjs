"use strict";
/**
 * Secret-shape detection — PROJECTOS-MULTI-PROJECT-CREDENTIAL-ROUTER1A.
 *
 * One home for "does this text look like a credential?", shared by the MCP-config validator and the
 * metadata sidecar so the two cannot drift.
 *
 * This is a BACKSTOP, not a boundary. It recognises the token shapes that have a distinctive prefix; a
 * raw Vercel token, a database password, or a bare 32-character API key has no such shape and will not be
 * caught. The real controls are structural — credentials live in the OS store, configs carry placeholders
 * only, and credential-named keys must hold a bare `${VAR}`. Treat a hit here as "definitely refuse", never
 * a miss here as "definitely safe".
 */

const PATTERNS = Object.freeze([
  Object.freeze({ name: "jwt", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ }),
  Object.freeze({ name: "supabase-pat", re: /sbp_[a-f0-9]{40,}/ }),
  Object.freeze({ name: "github-pat", re: /gh[pousr]_[A-Za-z0-9]{36,}/ }),
  Object.freeze({ name: "stripe", re: /(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/ }),
  Object.freeze({ name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ }),
  Object.freeze({ name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ }),
]);

/** Names of every pattern that matches. Empty array means "nothing recognised", NOT "nothing present". */
function matchedShapes(text) {
  const hay = typeof text === "string" ? text : JSON.stringify(text || "");
  return PATTERNS.filter((p) => p.re.test(hay)).map((p) => p.name);
}

function looksLikeSecret(text) {
  return matchedShapes(text).length > 0;
}

module.exports = { PATTERNS, matchedShapes, looksLikeSecret };
