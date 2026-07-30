// Validator: PROJECTOS-V3.2-AI-PROVIDER-INDEPENDENCE
//
// Fails closed. Proves the owner-approved V3.2 AI-provider-independence amendment is persisted correctly
// and cannot silently: mutate the immutable v1.0 master plan, renumber historical phases, make VS Code
// mandatory, drop a required provider phase, allow VS Code credential extraction, reorder the PolyGo
// pilot before the dual-agent proof, authorise provider implementation, enable EXECUTION_READY, claim a
// full VS Code IDE replacement, or publish an overall percentage. Structural, bounded assertions only.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const AMEND = path.join(ROOT, "docs", "architecture", "projectos-v3.2-ai-provider-independence-amendment.md");
const CW = path.join(ROOT, "docs", "architecture", "projectos-v3.1-crosswalk.md");
const MASTER = path.join(ROOT, "docs", "architecture", "projectos-v3-master-plan.md");
const STATE = path.join(ROOT, "projectos", "state", "projectos-v3.current-state.json");

// Pinned byte-hash of the immutable approved plan v1.0 (working-tree bytes). Any edit changes it.
const MASTER_PLAN_SHA256 = "7bd6235f5f5d948c720d8e386a18df69cb1d41ed6e6f820bcccd2f24a5675eaf";

const V3_PHASE_IDS = [
  "PROJECTOS-V3-BASELINE-RECONCILE1A", "PROJECTOS-V3-MASTER-PLAN-MEMORY1A", "PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A",
  "PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A", "PROJECTOS-V3-LOCAL-SECRET-BROKER1A", "PROJECTOS-V3-SECRET-OPERATION-BROKER1A",
  "PROJECTOS-V3-OWNER-CHAT1A", "PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A", "PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A",
  "PROJECTOS-V3-E2E-RUNNER1A", "PROJECTOS-V3-APPROVAL-QUEUE1A", "PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A",
  "PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A", "PROJECTOS-V3-DESKTOP-E2E-PROOF1A", "PROJECTOS-V3-POLYGO-BASELINE-RECONCILE1A",
  "PROJECTOS-V3-POLYGO-INSTALL-REENTRY1A", "PROJECTOS-V3-POLYGO-PILOT1A", "PROJECTOS-V3-RELIABILITY-HARDENING1A",
  "PROJECTOS-V3-FINAL-E2E-CLOSURE1A",
];

function run() {
  const e = [];
  for (const [p, l] of [[AMEND, "amendment"], [CW, "crosswalk"], [MASTER, "master-plan"], [STATE, "current-state"]])
    if (!fs.existsSync(p)) { e.push("missing " + l + " (" + p + ")"); }
  if (e.length) return e;

  const amend = fs.readFileSync(AMEND, "utf8");
  const cw = fs.readFileSync(CW, "utf8");
  const state = fs.readFileSync(STATE, "utf8");
  let st; try { st = JSON.parse(state); } catch (x) { e.push("current-state not JSON: " + x.message); st = {}; }

  // V1 — master plan v1.0 byte-unchanged.
  const mpHash = crypto.createHash("sha256").update(fs.readFileSync(MASTER)).digest("hex");
  if (mpHash !== MASTER_PLAN_SHA256) e.push("V1 master plan v1.0 is NOT byte-unchanged (sha256 " + mpHash + ")");

  // V2 — historical phase IDs 0–18 present + amendment declares no renumbering.
  for (const id of V3_PHASE_IDS) if (cw.indexOf(id) === -1) e.push("V2 crosswalk missing historical phase ID (renumber?): " + id);
  if (!/not renumber/i.test(amend) || !/0[–-]18/.test(amend)) e.push("V2 amendment does not declare historical phases 0-18 are not renumbered");

  // V3 — Track D relabel.
  if (amend.indexOf("AI provider, worker and project-session control") === -1) e.push("V3 amendment missing Track D rename");
  if (cw.indexOf("AI provider, worker and project-session control") === -1) e.push("V3 crosswalk Track D not relabelled");

  // V4 — VS Code optional, not mandatory. ("without a mandatory VS Code dependency" is the CORRECT
  // statement, so only an AFFIRMATIVE mandatory/required claim is forbidden.)
  if (!/VS Code[^\n]{0,40}optional specialist editor/i.test(amend))
    e.push("V4 amendment does not label VS Code an optional specialist editor");
  if (/VS Code (is|becomes|remains|must be|will be) (mandatory|required)/i.test(amend) || /mandatory VS Code (runtime|dependency) is required/i.test(amend))
    e.push("V4 amendment makes VS Code mandatory/required");
  if (cw.indexOf("optional specialist editor") === -1) e.push("V4 crosswalk Track D does not state VS Code optional");

  // V5-V8 — required provider phases present.
  for (const [v, id] of [["V5", "PROJECTOS-CLAUDE-CODE-LOCAL-ADAPTER1A"], ["V6", "PROJECTOS-CODEX-APP-SERVER-ADAPTER1A"], ["V7", "PROJECTOS-AI-PROVIDER-BROKER1A"], ["V8", "PROJECTOS-AI-ACCOUNTS-CONTROL-CENTRE1A"]])
    if (amend.indexOf(id) === -1) e.push(v + " amendment missing required phase: " + id);

  // V9 — dual-agent proof precedes the PolyGo pilot in the DEPENDENCY ORDER (scoped to the §K list, so
  // the Phase-16 amendment mention of the pilot id does not confound it) + the explicit statement.
  if (amend.indexOf("PROJECTOS-DUAL-AGENT-LOCAL-PROOF1A") === -1) e.push("V9 amendment missing dual-agent proof phase");
  const iKDual = amend.indexOf("**dual-agent local proof**");
  const iKPilot = amend.indexOf("**PolyGo governed pilot**");
  if (iKDual === -1 || iKPilot === -1) e.push("V9 dependency-order list missing dual-agent proof or PolyGo governed pilot");
  else if (iKDual > iKPilot) e.push("V9 dependency order places the PolyGo pilot before the dual-agent proof");
  if (!/dual-agent proof \(step 12\) precedes the PolyGo pilot/i.test(amend)) e.push("V9 amendment lacks the explicit dual-agent-precedes-pilot statement");
  if (amend.indexOf("12. **dual-agent local proof**") === -1) e.push("V9 dual-agent proof is not step 12 in the dependency order");
  if (amend.indexOf("15. **PolyGo governed pilot**") === -1) e.push("V9 PolyGo governed pilot is not step 15 in the dependency order");

  // V10 — provider-owned credentials required.
  if (!/provider-owned/i.test(amend) || !/official provider runtime or the operating-system/i.test(amend))
    e.push("V10 amendment does not require provider-owned/official credential storage");

  // V11 — VS Code extension credential extraction prohibited.
  if (amend.indexOf("must not read or import credentials from VS Code extensions") === -1)
    e.push("V11 amendment does not prohibit VS Code extension credential extraction");

  // V12 — no full VS Code IDE replacement claim.
  if (!/full VS Code replacement is explicitly outside/i.test(amend)) e.push("V12 amendment does not scope out a full VS Code replacement");
  if (/ProjectOS (replaces|is a replacement for) the full VS Code/i.test(amend)) e.push("V12 amendment claims a full VS Code IDE replacement");

  // V13 — current technical next remains the Windows adapter preflight.
  if (st.nextRecommendedPhase !== "CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A")
    e.push("V13 current-state nextRecommendedPhase is not the Windows adapter preflight: " + st.nextRecommendedPhase);
  if (amend.indexOf("CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A") === -1) e.push("V13 amendment does not record the current next phase");

  // V14 — provider implementation NotAuthorised.
  if (!/NOT YET AUTHORISED FOR IMPLEMENTATION/.test(amend)) e.push("V14 amendment does not mark provider implementation NOT AUTHORISED");

  // V15 — EXECUTION_READY false.
  if (!/EXECUTION_READY\s*=\s*false/.test(amend)) e.push("V15 amendment does not record EXECUTION_READY = false");
  if (/EXECUTION_READY\s*=\s*true/.test(amend)) e.push("V15 amendment records EXECUTION_READY = true");

  // V16 — installation NotAuthorised.
  if (!/Installation authority:\s*\*?\*?NotAuthorised/i.test(amend) && !/installation[^\n]*NotAuthorised/i.test(amend))
    e.push("V16 amendment does not record installation authority NotAuthorised");

  // V17 — docs/governance only (no product source/manifest/lockfile in the change).
  if (!/no product source[^\n]*manifest[^\n]*lockfile/i.test(amend)) e.push("V17 amendment does not declare docs/governance-only (no product source/manifest/lockfile)");

  // V18 — no overall completion percentage in the amendment.
  if (/\d+(?:\.\d+)?\s*%/.test(amend)) e.push("V18 amendment contains a percentage token (prohibited)");

  // Plan version unchanged.
  if (st.activePlanVersion !== "1.0") e.push("current-state activePlanVersion changed from 1.0 (plan must stay immutable)");

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) { errs.forEach((x) => console.error("[validate-v3.2-ai-provider-independence] FAIL: " + x)); process.exit(1); }
  console.log("validate-v3.2-ai-provider-independence: PASS");
}
