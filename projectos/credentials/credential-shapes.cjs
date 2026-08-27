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
 *
 * PROVIDER MODEL KEYS, ADDED IN PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 *
 * WHY THEY WERE MISSING AND WHY IT MATTERED. Every shape above is delimited with an UNDERSCORE, and
 * OpenAI and Anthropic both delimit with a HYPHEN — so `(sk|rk)_(live|test)_` never came close to
 * `sk-proj-…` or `sk-ant-…`, and this detector reported "nothing recognised" for the two providers
 * ProjectOS itself spends money with. That was tolerable while the only provider credential lived
 * inside the trusted broker and never met an owner-facing surface. It stopped being tolerable when the
 * owner gained a box to type an objective into: an objective is validated, digested and PERSISTED, and
 * the check standing between a pasted key and that durable write is a secret-shape scan.
 *
 * A MISS IS STILL NOT "SAFE". The paragraph above holds unchanged: these prefixes are recognisable,
 * a bare provider key without one is not, and structural controls remain the real boundary.
 */

const PATTERNS = Object.freeze([
  Object.freeze({ name: "jwt", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ }),
  Object.freeze({ name: "supabase-pat", re: /sbp_[a-f0-9]{40,}/ }),
  Object.freeze({ name: "github-pat", re: /gh[pousr]_[A-Za-z0-9]{36,}/ }),
  Object.freeze({ name: "stripe", re: /(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/ }),
  Object.freeze({ name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ }),
  // OPENAI. The three prefixed families first, then the legacy bare form. `sk-proj-`, `sk-svcacct-`
  // and `sk-admin-` are self-delimiting, so they need no length floor beyond "long enough not to be a
  // sentence". The legacy form has no prefix to lean on, so it takes a 40-character floor: real keys
  // are 48, and a shorter floor would start matching ordinary hyphenated prose.
  Object.freeze({ name: "openai-project-key", re: /sk-proj-[A-Za-z0-9_-]{20,}/ }),
  Object.freeze({ name: "openai-service-account-key", re: /sk-svcacct-[A-Za-z0-9_-]{20,}/ }),
  Object.freeze({ name: "openai-admin-key", re: /sk-admin-[A-Za-z0-9_-]{20,}/ }),
  // NO HYPHEN IN THE BODY, AND THAT IS WHAT KEEPS THE FAMILIES APART. `sk-ant-api03-…` and
  // `sk-proj-…` both stop this pattern after three or four characters, far below the floor, so the
  // prefixed families are matched by their own rules and never by this one.
  Object.freeze({ name: "openai-legacy-key", re: /sk-[A-Za-z0-9]{40,}/ }),
  // ANTHROPIC. Deliberately variant-agnostic: `api03` is today's tag and `admin01`, `sid01` and
  // whatever replaces them are the same secret with a different label, so the tag is matched as
  // ordinary body rather than pinned.
  Object.freeze({ name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ }),
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
