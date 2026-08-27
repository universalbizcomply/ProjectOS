"use strict";
/**
 * Five secret detectors, one vocabulary — PROJECTOS-LIVE-PLAN-AUTHORING-AND-OWNER-DECISION1A.
 *
 * WHAT WENT WRONG AND WHY A VALIDATOR IS THE FIX. ProjectOS carries FIVE independent secret-shape
 * lists, in five languages-of-convenience across four packages, and every one of them missed OpenAI
 * and Anthropic keys for the same reason: each existing shape is delimited with an UNDERSCORE
 * (`sk_live_`, `ghp_`, `sbp_`, `AKIA`) and both providers delimit with a HYPHEN. Five lists drifted
 * to the same blind spot because nothing ever compared them.
 *
 * They CANNOT be collapsed into one module, and that is a real constraint rather than an excuse:
 *
 *   - `plan-discovery-engine.cjs` is a closed, accepted deliverable resolved from the agent package's
 *     own URL, and the packaged dependency-closure rules refuse a payload that reaches outside itself.
 *     A new `require("../credentials/...")` there is a source-tree escape.
 *   - the two `redact.ts` files are TypeScript in a browser bundle and in the daemon bundle; neither
 *     can require a `.cjs` from `projectos/credentials` without breaking its own packaging.
 *
 * So the duplication stays and the AGREEMENT is made mechanical instead. This validator does not care
 * how each file spells its list; it cares that every one of the five recognises every provider key
 * family. A sixth detector added later and not listed here is invisible to this check — which is why
 * the file list below is asserted to be exactly five, so adding one is a deliberate edit here too.
 *
 * IT ALSO PROVES THE SHAPES ACTUALLY MATCH. Asserting that a file "contains the text sk-proj-" is a
 * spelling test, and a spelling test passes on a comment. So the two `.cjs` detectors are LOADED and
 * run against synthetic fixtures, and the two `.ts` redactors have their pattern arrays extracted and
 * compiled. What is checked is behaviour.
 *
 * NO REAL KEY APPEARS HERE. Every fixture is a syntactically-shaped synthetic string built from a
 * fixed filler; none was ever issued by any provider and none would authenticate anywhere.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/** The five lists. Exactly five: a sixth must be added here deliberately, not discovered later. */
const DETECTORS = Object.freeze([
  "projectos/credentials/credential-shapes.cjs",
  "projectos/validators/validate-no-secrets.cjs",
  "projectos/validators/plan-discovery-engine.cjs",
  "projectos/control-center/src/daemon/redact.ts",
  "projectos/bridge/daemon/src/utils/redact.ts",
  // THE SIXTH, ADDED IN THE POST-LIVE-CALL CORRECTION. A paid provider reply is now written into the
  // governed repository as attempt evidence, so the text of an untrusted model response passes
  // through a redactor for the first time. A member of this family that this list does not name is a
  // member nothing checks, which is the whole reason the list is spelled out rather than discovered.
  "projectos/agent/src/authoringEvidence.ts",
]);

/**
 * Synthetic provider-key fixtures.
 *
 * Built from a repeated filler rather than typed out, so nobody reading this file can mistake one for
 * a credential and no scanner anywhere has to special-case it. Lengths are chosen to clear each
 * pattern's floor with room to spare.
 */
const FILLER = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const body = (n) => FILLER.repeat(Math.ceil(n / FILLER.length)).slice(0, n);

const FIXTURES = Object.freeze([
  Object.freeze({ family: "openai-project-key", value: "sk-proj-" + body(64) }),
  Object.freeze({ family: "openai-service-account-key", value: "sk-svcacct-" + body(64) }),
  Object.freeze({ family: "openai-admin-key", value: "sk-admin-" + body(64) }),
  Object.freeze({ family: "openai-legacy-key", value: "sk-" + body(48) }),
  Object.freeze({ family: "anthropic-key", value: "sk-ant-api03-" + body(95) }),
]);

/**
 * Text that must NOT be flagged.
 *
 * A detector that says yes to everything needs no maintenance and protects nothing. `sk-` followed by
 * ordinary hyphenated prose is the realistic false positive for the legacy bare pattern, which is
 * exactly why that one carries a 40-character floor and a hyphen-free body.
 */
const BENIGN = Object.freeze([
  "the sk-learning module",
  "sk-ant",
  "sk-proj",
  "skip-the-first-two-and-carry-on-with-a-long-hyphenated-sentence",
  "plain prose with no token in it at all",
]);

function readSource(errors, rel) {
  const abs = path.join(ROOT, rel.split("/").join(path.sep));
  if (!fs.existsSync(abs)) {
    errors.push("detector " + rel + " does not exist");
    return null;
  }
  try {
    return fs.readFileSync(abs, "utf8");
  } catch (e) {
    errors.push("detector " + rel + " could not be read: " + e.message);
    return null;
  }
}

/**
 * The regular expressions in a `readonly RegExp[]` array literal, compiled.
 *
 * NOT `eval`, and not a JS parser either. Both redactors write one regex literal per line inside a
 * single array, which is a shape a line scan reads exactly: `/<source>/<flags>` optionally followed by
 * a comment. Anything it cannot read is reported rather than skipped — a pattern this function fails
 * to see is a pattern this validator would silently stop checking.
 */
function compilePatterns(errors, rel, text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("/")) continue;
    // `/…/g,` — the trailing comma is what distinguishes an array element from a comment or a path.
    const m = /^\/(.*)\/([gimsuy]*),\s*(?:\/\/.*)?$/.exec(line);
    if (m === null) continue;
    try {
      out.push(new RegExp(m[1], m[2].replace("g", "")));
    } catch (e) {
      errors.push(rel + " carries a pattern this check cannot compile: " + e.message);
    }
  }
  if (out.length === 0) errors.push(rel + " exposes no readable pattern array, so nothing was checked");
  return out;
}

/** Does any pattern in `list` match `value`? */
function anyMatch(list, value) {
  return list.some((re) => {
    re.lastIndex = 0;
    return re.test(value);
  });
}

function run() {
  const errors = [];

  if (DETECTORS.length !== 6) {
    errors.push("the detector list is no longer the six this phase reconciled");
  }

  /** rel -> (value) => boolean */
  const probes = new Map();

  // ---- the two shared `.cjs` detectors: loaded and run ---------------------------------------
  const shapesRel = "projectos/credentials/credential-shapes.cjs";
  try {
    const shapes = require("../credentials/credential-shapes.cjs");
    probes.set(shapesRel, (v) => shapes.matchedShapes(v).length > 0);
  } catch (e) {
    errors.push(shapesRel + " could not be loaded: " + e.message);
  }

  const engineRel = "projectos/validators/plan-discovery-engine.cjs";
  try {
    const engine = require("./plan-discovery-engine.cjs");
    if (typeof engine.scanSecrets !== "function") {
      errors.push(engineRel + " no longer exposes scanSecrets, so owner objectives are unscanned");
    } else {
      probes.set(engineRel, (v) => engine.scanSecrets(v).length > 0);
    }
  } catch (e) {
    errors.push(engineRel + " could not be loaded: " + e.message);
  }

  // `validate-no-secrets` keeps its patterns private, so its list is read the same way the redactors'
  // are. It is a file scanner rather than a string API; the patterns are still what decide.
  const nsRel = "projectos/validators/validate-no-secrets.cjs";
  const nsText = readSource(errors, nsRel);
  if (nsText !== null) {
    const nsPatterns = [];
    for (const raw of nsText.split("\n")) {
      const m = /re:\s*\/(.*)\/([gimsuy]*)\s*\}/.exec(raw);
      if (m === null) continue;
      try {
        nsPatterns.push(new RegExp(m[1], m[2].replace("g", "")));
      } catch (e) {
        errors.push(nsRel + " carries a pattern this check cannot compile: " + e.message);
      }
    }
    if (nsPatterns.length === 0) errors.push(nsRel + " exposes no readable pattern list");
    else probes.set(nsRel, (v) => anyMatch(nsPatterns, v));
  }

  // ---- the three `.ts` redactors: patterns extracted and compiled -----------------------------
  for (const rel of [
    "projectos/control-center/src/daemon/redact.ts",
    "projectos/bridge/daemon/src/utils/redact.ts",
    "projectos/agent/src/authoringEvidence.ts",
  ]) {
    const text = readSource(errors, rel);
    if (text === null) continue;
    const patterns = compilePatterns(errors, rel, text);
    if (patterns.length > 0) probes.set(rel, (v) => anyMatch(patterns, v));
  }

  // ---- every detector recognises every family --------------------------------------------------
  for (const rel of DETECTORS) {
    const probe = probes.get(rel);
    if (probe === undefined) {
      errors.push("detector " + rel + " could not be exercised, so its agreement is unproven");
      continue;
    }
    for (const fixture of FIXTURES) {
      let hit;
      try {
        hit = probe(fixture.value);
      } catch (e) {
        errors.push(rel + " threw while scanning a " + fixture.family + " fixture: " + e.message);
        continue;
      }
      if (!hit) {
        errors.push(rel + " does not recognise " + fixture.family + ", so that shape can pass it unseen");
      }
    }
    for (const benign of BENIGN) {
      let hit;
      try {
        hit = probe(benign);
      } catch (e) {
        errors.push(rel + " threw while scanning benign text: " + e.message);
        continue;
      }
      if (hit) {
        errors.push(rel + " flags ordinary text (" + JSON.stringify(benign) + ") as a provider key");
      }
    }
  }

  // ---- the refusal must not repeat the value ----------------------------------------------------
  //
  // The one thing worse than not detecting a pasted key is detecting it and then quoting it into the
  // refusal, the log line and the record that refusal is written to. `credentialRefProblems` already
  // learned this once; these two report by FAMILY NAME and must keep doing so.
  try {
    const shapes = require("../credentials/credential-shapes.cjs");
    for (const fixture of FIXTURES) {
      const named = shapes.matchedShapes(fixture.value);
      if (named.some((n) => fixture.value.includes(n))) {
        errors.push("credential-shapes reports a name that contains the value it matched");
      }
      if (named.length === 0) continue;
      const joined = named.join(", ");
      if (joined.includes(fixture.value.slice(0, 24))) {
        errors.push("credential-shapes echoes matched credential material in its result");
      }
    }
    const engine = require("./plan-discovery-engine.cjs");
    if (typeof engine.scanSecrets === "function") {
      for (const fixture of FIXTURES) {
        const hits = engine.scanSecrets(fixture.value);
        if (hits.join(", ").includes(fixture.value.slice(0, 24))) {
          errors.push("the discovery engine echoes matched credential material in its result");
        }
      }
    }
  } catch {
    // Already reported above; a second copy of the same load failure helps nobody.
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-provider-key-shapes1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-provider-key-shapes1a: PASS");
}

module.exports = { run, DETECTORS, FIXTURES };
