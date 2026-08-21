"use strict";
// val-projectos-gatekeeper-contract1a — the properties the gatekeeper loop's unit tests cannot hold.
//
// WHAT THE UNIT TESTS ALREADY DO. They prove each contract refuses what it should: a decision bound
// to another phase, a replayed grant, a verdict answering the wrong stop. Those live in
// projectos/core/test and projectos/agent/test and are mutation-proven.
//
// WHAT THEY CANNOT DO, AND WHY THIS EXISTS. Three properties are about the SHAPE OF THE SOURCE, not
// about any one function's behaviour, so no test that calls a function can defend them:
//
//   1. PURITY / STRUCTURAL READ-ONLINESS. The whole safety argument is that these contracts decide
//      and never act. A later edit adding `fs`, `child_process`, a network client or `process.env` to
//      one of them would keep every existing test green while destroying that argument. So the
//      permitted imports are enumerated here and everything else fails.
//
//   2. ROUTING COMPLETENESS. `decideContinuation` and the routing table live in different files. A
//      new stop code added to one and not the other is a real drift: the compiler catches a missing
//      key, but nothing catches a stop code being QUIETLY RE-ROUTED from the owner to the gatekeeper,
//      which is the change that would matter most.
//
//   3. THE OWNER'S STOPS, PINNED. PROTECTED_EFFECT, OWNER_GATE and SCOPE_DECISION are the owner's by
//      policy, not by implementation detail. They are named here so that changing the source alone is
//      not enough to change who decides them — the change has to be made twice, in two files, and the
//      second one is this policy statement.
//
// WHAT IT CANNOT CHECK, stated rather than implied: it reads source text, so it cannot prove runtime
// behaviour, and it cannot stop anyone editing this file too. ProjectOS is MANUAL_GOVERNANCE_APPROVAL
// with tamperProof false throughout; the backstop is the owner's commit and push gate, where every
// one of these files is a visible diff.
//
// Created in PROJECTOS-AUTONOMOUS-GATEKEEPER-LOOP1A.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SELF = "val-projectos-gatekeeper-contract1a";

const CORE_SRC = path.join(ROOT, "projectos", "core", "src");
const AGENT_LOOP = path.join(ROOT, "projectos", "agent", "src", "loop");

const CONTRACT_MODULES = [
  path.join(CORE_SRC, "gatekeeperDecision.ts"),
  path.join(CORE_SRC, "gatekeeperTransport.ts"),
  path.join(CORE_SRC, "gatekeeperCostLedger.ts"),
  path.join(CORE_SRC, "gatekeeperDegradedMode.ts"),
  path.join(CORE_SRC, "gatekeeperThread.ts"),
  path.join(CORE_SRC, "gatekeeperBridge.ts"),
  path.join(CORE_SRC, "gatekeeperModelPolicy.ts"),
  path.join(CORE_SRC, "ownerGateReceipt.ts"),
  path.join(AGENT_LOOP, "gatekeeperRouting.ts"),
  // The orchestration and the transport reach the world only through INJECTED ports, so they belong
  // under the same purity rule as the contracts: a direct fs, child_process or network import here
  // would be the whole safety argument leaking away one convenience at a time. The vault resolver is
  // deliberately NOT in this list - executing the credential store is its entire job.
  path.join(AGENT_LOOP, "gatekeeperTurn.ts"),
  path.join(AGENT_LOOP, "transports", "openaiResponses.ts"),
];

// --- The owner's rulings of 2026-08-17, pinned in a second file ---------------------------------
// Each of these is a sentence the owner said. Restating them here means changing the source alone is
// not enough to repeal one: the change has to be made twice, and the second place is this list.

/** "ChatGPT / OpenAI MUST NOT impersonate Murad." */
const OPERATION_THE_OWNER_REMOVED = "record-owner-decision";
const PROVENANCE_FIELD_THAT_MUST_BE_REFUSED = "decidedBy";

/** The approved pilot commercial limits, in micro-USD. Auto-recharge OFF is checked separately. */
const APPROVED_BUDGET = {
  initialCreditMicroUsd: 5000000,
  warnAtMicroUsd: 2000000,
  hardStopAtMicroUsd: 5000000,
};

/** "GPT-5.6 Sol: NOT part of the default pilot route." */
const MODEL_EXCLUDED_FROM_THE_PILOT = "gpt-5.6-sol";

/** The only module specifiers a decision contract may depend on. */
const ALLOWED_IMPORTS = [
  "node:crypto",
  "@projectos/core",
  "./gatekeeperTransport.js",
  "./outcome.js",
  "./credentialResolver.js",
  "./gatekeeperRouting.js",
  "./transports/openaiResponses.js",
  "../credentialResolver.js",
  // The trusted credential boundary. It is a gatekeeper TRANSPORT like the one above it — the
  // difference is that the raw credential is resolved on the trusted side and never returned here —
  // so it belongs in this list for the same reason `openaiResponses.js` does. Added when the boundary
  // landed; the list had simply not been told about it, and the suite refused every run until it was.
  "./transports/brokeredHttpPort.js",
  "./brokeredHttpPort.js",
];

/** Capabilities that would make a "decide only" module able to act. */
const EFFECT_TOKENS = [
  "child_process",
  "node:fs",
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:worker_threads",
  "readFileSync",
  "writeFileSync",
  "execSync",
  "spawnSync",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "process.env",
  "globalThis",
];

/** Stops that belong to the owner as a matter of policy, restated here on purpose. */
const OWNER_STOPS = ["PROTECTED_EFFECT", "OWNER_GATE", "SCOPE_DECISION"];

/**
 * Strip comments and blank string literals in one pass.
 *
 * BOTH OUTPUTS ARE NEEDED AND NEITHER SUBSTITUTES FOR THE OTHER. Scanning raw text for a token like
 * "fetch" hits every prose mention of the word in a header comment — a validator has been fooled that
 * way in this repository before. Scanning with strings blanked loses the import specifiers. So the
 * scanner returns code-without-comments (for reading imports) and code-without-comments-or-string-
 * contents (for reading identifiers).
 */
function scan(src) {
  let noComments = "";
  let blanked = "";
  let i = 0;
  // Whether a `/` here starts a REGEX or is a division operator. A regex literal can contain quotes
  // — `/["']/` is real code in this repository — and lexing it as a string desynchronises everything
  // after it, silently disabling the checks downstream. The rule is the standard one: a `/` that
  // follows a value is division; anything else starts a regex.
  let prevSignificant = "";
  const startsRegex = () => prevSignificant === "" || !/[A-Za-z0-9_$)\]]$/.test(prevSignificant);

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === "/" && startsRegex()) {
      // Consume the whole regex literal, including a character class that may contain `/`.
      let literal = "/";
      let inClass = false;
      i += 1;
      while (i < src.length) {
        const ch = src[i];
        if (ch === "\\") { literal += ch + (src[i + 1] || ""); i += 2; continue; }
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        else if (ch === "/" && !inClass) break;
        else if (ch === "\n") break;
        literal += ch;
        i += 1;
      }
      literal += "/";
      i += 1;
      while (i < src.length && /[a-z]/.test(src[i])) { literal += src[i]; i += 1; }
      noComments += literal;
      blanked += literal;
      prevSignificant = literal;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let literal = c;
      // TEMPLATE INTERPOLATIONS ARE CODE, NOT TEXT. Blanking a whole template literal erased any
      // `${...}` inside it, so `${process.env.KEY}` and `${require("child_process").execSync(x)}`
      // were invisible to the purity checks — the one construct the scanner could not see through.
      let blankedLiteral = quote;
      i += 1;
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "\\") {
          literal += src[i] + (src[i + 1] || "");
          if (depth > 0) blankedLiteral += src[i] + (src[i + 1] || "");
          i += 2;
          continue;
        }
        if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
          depth += 1;
          literal += "${"; blankedLiteral += "${"; i += 2;
          continue;
        }
        if (depth > 0 && src[i] === "}") {
          depth -= 1;
          literal += "}"; blankedLiteral += "}"; i += 1;
          continue;
        }
        if (src[i] === quote && depth === 0) break;
        literal += src[i];
        if (depth > 0) blankedLiteral += src[i];
        i += 1;
      }
      literal += quote;
      blankedLiteral += quote;
      i += 1;
      noComments += literal;
      blanked += blankedLiteral;
      prevSignificant = "x";
      continue;
    }
    noComments += c;
    blanked += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i += 1;
  }
  return { noComments, blanked };
}

function readSource(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; }
}

/** Property 1 — every contract module decides and cannot act. */
function judgePurity(file, src) {
  const e = [];
  const { noComments, blanked } = scan(src);

  const importRe = /\bimport\s+(?:type\s+)?[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(noComments)) !== null) {
    if (!ALLOWED_IMPORTS.includes(m[1])) {
      e.push(path.basename(file) + " imports '" + m[1] + "', which is not one of the permitted dependencies (" + ALLOWED_IMPORTS.join(", ") + ")");
    }
  }
  if (/\brequire\s*\(/.test(blanked)) {
    e.push(path.basename(file) + " uses require(), which can reach a capability the import list does not declare");
  }
  // A DYNAMIC IMPORT IS AN UNDECLARED DEPENDENCY. The static import allowlist above cannot see it,
  // which makes it the obvious way round the whole check.
  if (/\bimport\s*\(/.test(blanked)) {
    e.push(path.basename(file) + " uses a dynamic import(), which the static import allowlist cannot see");
  }
  // A CONTROL CHARACTER MAKES THE FILE BINARY TO GIT, and the owner's commit-gate diff — the entire
  // trust backstop of this project — then shows `Bin 0 -> N bytes` instead of the code. This module
  // once contained a raw NUL as a digest separator and looked perfectly normal in every editor.
  const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.exec(src);
  if (control !== null) {
    e.push(
      path.basename(file) + " contains a control character (U+" +
      control[0].charCodeAt(0).toString(16).padStart(4, "0").toUpperCase() +
      "), which makes the file binary to git and hides it from the owner's commit-gate diff",
    );
  }
  for (const token of EFFECT_TOKENS) {
    if (blanked.includes(token)) {
      e.push(path.basename(file) + " references '" + token + "'; a contract that decides must not be able to act");
    }
  }
  return e;
}

/** The stop codes `decideContinuation` can produce, read from its own union type. */
function declaredStopCodes(outcomeSrc) {
  const { noComments } = scan(outcomeSrc);
  const block = /export\s+type\s+LoopStopCode\s*=([\s\S]*?);/.exec(noComments);
  if (block === null) return null;
  return (block[1].match(/'([A-Z_]+)'/g) || []).map((x) => x.replace(/'/g, ""));
}

/** The routing table's entries, with the audience each one declares. */
function declaredRoutes(routingSrc) {
  const { noComments } = scan(routingSrc);
  const table = /export\s+const\s+STOP_ROUTES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(noComments);
  if (table === null) return null;
  const routes = {};
  const entryRe = /([A-Z_]+):\s*\{([\s\S]*?)\n  \}/g;
  let m;
  while ((m = entryRe.exec(table[1])) !== null) {
    const body = m[2];
    const audience = /audience:\s*'([a-z]+)'/.exec(body);
    const verdicts = /applicableVerdicts:\s*\[([^\]]*)\]/.exec(body);
    routes[m[1]] = {
      audience: audience === null ? null : audience[1],
      applicableVerdicts: verdicts === null ? null : (verdicts[1].match(/'([A-Z_]+)'/g) || []).map((x) => x.replace(/'/g, "")),
    };
  }
  return routes;
}

/** The verdicts core says are owner-gated. */
function ownerGatedVerdicts(decisionSrc) {
  const { noComments } = scan(decisionSrc);
  const block = /OWNER_GATED_VERDICTS[^=]*=\s*\[([\s\S]*?)\]/.exec(noComments);
  if (block === null) return null;
  return (block[1].match(/'([A-Z_]+)'/g) || []).map((x) => x.replace(/'/g, ""));
}

function run() {
  const e = [];

  // --- Property 1: the contracts decide and cannot act -------------------------------------------
  for (const file of CONTRACT_MODULES) {
    const src = readSource(file);
    if (src === null) {
      e.push("gatekeeper contract module is missing: " + path.relative(ROOT, file));
      continue;
    }
    e.push(...judgePurity(file, src));
  }

  // --- Properties 2 and 3: routing completeness and who decides ----------------------------------
  const outcomeSrc = readSource(path.join(AGENT_LOOP, "outcome.ts"));
  const routingSrc = readSource(path.join(AGENT_LOOP, "gatekeeperRouting.ts"));
  const decisionSrc = readSource(path.join(CORE_SRC, "gatekeeperDecision.ts"));

  const codes = outcomeSrc === null ? null : declaredStopCodes(outcomeSrc);
  const routes = routingSrc === null ? null : declaredRoutes(routingSrc);
  const gated = decisionSrc === null ? null : ownerGatedVerdicts(decisionSrc);

  if (codes === null) e.push("could not read the LoopStopCode union from loop/outcome.ts");
  if (routes === null) e.push("could not read STOP_ROUTES from loop/gatekeeperRouting.ts");
  if (gated === null) e.push("could not read OWNER_GATED_VERDICTS from core gatekeeperDecision.ts");

  if (codes !== null && routes !== null) {
    for (const code of codes) {
      if (!Object.prototype.hasOwnProperty.call(routes, code)) {
        e.push("stop code " + code + " can end a run but is not routed; an unrouted stop has no audience");
      }
    }
    for (const code of Object.keys(routes)) {
      if (!codes.includes(code)) {
        e.push("STOP_ROUTES routes " + code + ", which decideContinuation cannot produce");
      }
    }
  }

  if (routes !== null) {
    // THE OWNER'S STOPS, PINNED. Re-routing one of these needs a change here as well as in the source.
    for (const code of OWNER_STOPS) {
      const route = routes[code];
      if (route === undefined) {
        e.push("owner-only stop " + code + " has no route at all");
      } else if (route.audience !== "owner") {
        e.push(
          "stop " + code + " is routed to '" + String(route.audience) + "'; it is the owner's by policy and " +
          "no reviewer holds that authority",
        );
      } else if (route.applicableVerdicts !== null && route.applicableVerdicts.length > 0) {
        e.push("owner-only stop " + code + " offers verdicts (" + route.applicableVerdicts.join(", ") + "); no verdict can answer it");
      }
    }
  }

  if (routes !== null && gated !== null) {
    for (const [code, route] of Object.entries(routes)) {
      // FAIL CLOSED. A route whose verdict list the regex could not read used to become `null` and
      // then `[]`, which reads as "offers nothing" — the safest-looking possible answer to the most
      // dangerous possible state.
      if (route.applicableVerdicts === null) {
        e.push("stop " + code + " declares a verdict list this validator could not read, so it cannot be checked");
        continue;
      }
      if (route.audience === null) {
        e.push("stop " + code + " declares an audience this validator could not read, so it cannot be checked");
        continue;
      }
      const offered = route.applicableVerdicts.filter((v) => gated.includes(v));
      if (offered.length > 0) {
        e.push(
          "stop " + code + " offers owner-gated verdict(s) " + offered.join(", ") +
          "; the loop would then perform a gate the verdict itself reserves to the owner",
        );
      }
    }
  }

  // --- Property 4: the bridge cannot impersonate the owner --------------------------------------
  const bridgeSrc = readSource(path.join(CORE_SRC, "gatekeeperBridge.ts"));
  if (bridgeSrc === null) {
    e.push("the bridge contract is missing");
  } else {
    const { noComments, blanked } = scan(bridgeSrc);
    const ops = /BRIDGE_GOVERNANCE_OPERATIONS\s*=\s*\[([\s\S]*?)\]/.exec(noComments);
    if (ops === null) {
      e.push("could not read BRIDGE_GOVERNANCE_OPERATIONS from the bridge contract");
    } else if (ops[1].includes("'" + OPERATION_THE_OWNER_REMOVED + "'")) {
      e.push(
        "the bridge exposes '" + OPERATION_THE_OWNER_REMOVED + "' again; the owner's ruling of 2026-08-17 " +
        "is that ChatGPT may transport owner intent but may never manufacture owner provenance",
      );
    }
    const provenance = /PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT[^=]*=\s*\[([\s\S]*?)\]/.exec(noComments);
    if (provenance === null || !provenance[1].includes("'" + PROVENANCE_FIELD_THAT_MUST_BE_REFUSED + "'")) {
      e.push(
        "the bridge does not refuse a request asserting '" + PROVENANCE_FIELD_THAT_MUST_BE_REFUSED +
        "'; removing the operation is not sufficient while the field can still be carried",
      );
    }
    // The refusal must be REACHED, not merely declared. A list nothing reads is decoration.
    if (!blanked.includes("PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT") ||
        blanked.split("PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT").length < 3) {
      e.push("PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT is declared but never checked against a request");
    }
  }

  // --- Property 5: the commercial ruling ---------------------------------------------------------
  const policySrc = readSource(path.join(CORE_SRC, "gatekeeperModelPolicy.ts"));
  if (policySrc === null) {
    e.push("the model/budget policy is missing");
  } else {
    const { noComments, blanked } = scan(policySrc);
    const budget = /APPROVED_PILOT_BUDGET\s*=\s*\{([\s\S]*?)\}/.exec(noComments);
    if (budget === null) {
      e.push("could not read APPROVED_PILOT_BUDGET from the policy contract");
    } else {
      for (const [field, expected] of Object.entries(APPROVED_BUDGET)) {
        const found = new RegExp(field + ":\\s*([0-9_]+)").exec(budget[1]);
        const actual = found === null ? null : Number(found[1].replace(/_/g, ""));
        if (actual !== expected) {
          e.push(
            "approved pilot " + field + " is " + String(actual) + " micro-USD; the owner approved " +
            expected + " and any increase needs a new owner decision",
          );
        }
      }
    }
    // "Auto-recharge must remain OFF" — the check must exist, not merely the intention.
    if (!/autoRecharge\s*!==\s*false/.test(blanked)) {
      e.push("the policy does not refuse auto-recharge being anything other than false");
    }
    // SEARCHED IN `noComments`, NOT `blanked`. A model identifier only ever appears INSIDE a string
    // literal, and `blanked` is the copy with string contents removed — so this check could never
    // have fired, whatever the policy said.
    if (noComments.includes(MODEL_EXCLUDED_FROM_THE_PILOT)) {
      e.push(
        "the policy names '" + MODEL_EXCLUDED_FROM_THE_PILOT + "', which the owner excluded from the " +
        "default pilot route",
      );
    }
  }

  // --- Property 6: an owner gate has no delegated form -------------------------------------------
  // The owner's ruling distinguishes a DELEGATED gatekeeper decision from a GENUINE owner decision.
  // Every other authority record in ProjectOS asks "does a delegation cover this?" — this one must
  // never grow that question, because the artefact exists to carry owner provenance specifically.
  const receiptSrc = readSource(path.join(CORE_SRC, "ownerGateReceipt.ts"));
  if (receiptSrc === null) {
    e.push("the owner gate receipt contract is missing");
  } else {
    const { blanked } = scan(receiptSrc);
    if (/delegat/i.test(blanked)) {
      e.push(
        "ownerGateReceipt.ts contains delegation logic; an owner gate has no delegated form, and a " +
        "delegated owner receipt is the exact impersonation the owner's ruling forbids",
      );
    }
    // The committed-tree requirement is the whole separation. Without it a receipt is just a file.
    if (!/readFromCommittedTree\s*!==\s*true/.test(blanked)) {
      e.push("ownerGateReceipt.ts does not require the receipt to have been read from the committed tree");
    }
    // THE FIELD THE RECEIPT ACTUALLY READS must be one the bridge already refuses to assert. Merely
    // declaring `ownerChoice` in an interface proves nothing if the code reads a different field, so
    // the check is on the READ, and it is cross-checked against the bridge's own list.
    if (!/receipt\.ownerChoice/.test(blanked)) {
      e.push(
        "ownerGateReceipt.ts does not read 'receipt.ownerChoice'; the owner's answer must live in a " +
        "field the bridge is already forbidden to assert, or the bridge could supply it",
      );
    }
    if (bridgeSrc !== null) {
      const provenance = /PROVENANCE_FIELDS_THE_BRIDGE_MAY_NOT_ASSERT[^=]*=\s*\[([\s\S]*?)\]/.exec(scan(bridgeSrc).noComments);
      if (provenance === null || !provenance[1].includes("'ownerChoice'")) {
        e.push("the bridge does not refuse 'ownerChoice', the field an owner gate receipt is answered with");
      }
    }
  }

  return e;
}

module.exports = { run, scan, judgePurity, declaredStopCodes, declaredRoutes, ownerGatedVerdicts };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[" + SELF + "] FAIL: " + x));
    process.exit(1);
  }
  console.log(SELF + ": PASS");
}
