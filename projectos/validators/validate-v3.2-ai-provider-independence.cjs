// Validator: PROJECTOS-V3.2-AI-PROVIDER-INDEPENDENCE
//
// Fails closed. Proves the owner-approved V3.2 AI-provider-independence amendment is persisted correctly
// and cannot silently: mutate the immutable v1.0 master plan, renumber historical phases, make VS Code
// mandatory, drop a required provider phase, allow VS Code credential extraction, reorder the PolyGo
// pilot before the dual-agent proof, authorise provider implementation, claim a full VS Code IDE
// replacement, or publish an overall percentage. Structural, bounded assertions only.
//
// EXECUTION READINESS (rebaselined 2026-08-08, PROJECTOS-V3-EXECUTION-READY-RECORD1A). V15 used to pin
// `EXECUTION_READY = false`. The owner/gatekeeper ruling moved programme/LOCAL readiness to TRUE, so the
// control MOVES rather than weakens: the amendment must now record programme/local readiness TRUE, must
// NOT regress to the `= false` form, and must explicitly state that readiness authorises NO provider.
// V14 (provider implementation NotAuthorised) and V16 (installation NotAuthorised) are unchanged and are
// what stop local readiness being read as provider or installation authority.
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
// The ACTIVE machine-readable plan record version — a different artefact from the master-plan document
// hashed above. Superseded v1.0 -> v1.1 on the bounded owner approval of 2026-08-09 (crosswalk §5e),
// v1.1 -> v1.2 on 2026-08-09, and v1.2 -> v1.3 on 2026-08-10 (zero-relay Phase-17 acceptance criterion).
const ACTIVE_PLAN_VERSION = "1.3";

// The accepted next programme phase, per current-state and the owner/gatekeeper sequencing decision.
// Rebaseline this deliberately when the programme sequence changes — it is a frozen accepted fact, not a
// moving pointer. 2026-08-04: the multi-project credential router. 2026-08-08: the router track is
// delivered and merged, the execution-readiness ruling is persisted, so the accepted next substantive
// delivery phase is the PolyGo pilot (numbered Phase 16). 2026-08-09: Phase 16 is CLOSED, so the accepted
// next substantive phase is the Control Centre integration (numbered Phase 12) — the remaining
// definition-of-complete gap. Recording it here authorises NO Phase-12 implementation.
// 2026-08-10: Phase 12 CLOSED by the canonical runtime under the G4 gate (evidence subject
// 7e65fe5), so the accepted next numbered phase moves to reliability hardening. Phase 17 depends on
// BOTH Phase 12 and Phase 16 in plan v1.2, and both are now closed.
// 2026-08-10: Phase 17 CLOSED by the G4 gate at evidence subject 2b362eb, so the accepted next
// numbered phase is the final closure phase. Recording it here authorises NO Phase-18 work: Phase 18
// closes the programme and needs a fresh owner-led gate.
// 2026-08-10: the numbered ProjectOS V3 programme is CLOSED at 19 of 19, so there is no next
// numbered phase and current-state records none. Empty is the canonical completed value; it is NOT
// a relaxation, because the check still fails if current-state names any phase as next — which is
// what a silent reopen or an unapproved continuation would look like.
const ACCEPTED_NEXT_PHASE = "";
// Sequenced after the router, still OPEN, still recorded in the amendment. `a43898d` stays OPEN.
const WINDOWS_ADAPTER_PREFLIGHT = "CD-B4-WINDOWS-USER-VERIFICATION-ADAPTER-PREFLIGHT1A";

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

  // V13 — programme sequencing.
  //
  // This check used to pin current-state's nextRecommendedPhase to the Windows adapter preflight.
  // That was the accepted next phase when the V3.2 amendment was written; the owner/gatekeeper has
  // since sequenced the multi-project credential router ahead of it. current-state is the
  // authoritative record of what comes next, so the validator yields to it rather than the reverse.
  //
  // Two things are still load-bearing and are asserted separately below:
  //   a) current-state must match the ACCEPTED next phase — an unrelated value still fails;
  //   b) the amendment must STILL record the Windows adapter preflight, so resequencing cannot
  //      quietly drop it. It remains an OPEN carry-forward and `a43898d` stays OPEN; nothing here
  //      closes it or infers any windows-future dependency authority.
  if (st.nextRecommendedPhase !== ACCEPTED_NEXT_PHASE)
    e.push("V13 current-state nextRecommendedPhase is not the accepted next phase " + ACCEPTED_NEXT_PHASE + ": " + st.nextRecommendedPhase);
  if (amend.indexOf(WINDOWS_ADAPTER_PREFLIGHT) === -1)
    e.push("V13 amendment no longer records the Windows adapter preflight carry-forward " + WINDOWS_ADAPTER_PREFLIGHT);

  // V14 — provider implementation NotAuthorised.
  if (!/NOT YET AUTHORISED FOR IMPLEMENTATION/.test(amend)) e.push("V14 amendment does not mark provider implementation NOT AUTHORISED");

  // V15 — programme/LOCAL EXECUTION_READY true, scoped, and explicitly not provider authority.
  const readinessLine = amend.split("\n").find((l) => /Programme\/local `?EXECUTION_READY\s*=\s*true/.test(l));
  if (!readinessLine) e.push("V15 amendment does not record programme/local EXECUTION_READY = true");
  // V15-i the live statement must not be struck through — this document supersedes prose in place, so a
  // presence check alone would accept a RETRACTED assertion.
  else if (readinessLine.indexOf("~~") !== -1)
    e.push("V15 amendment records programme/local EXECUTION_READY = true only inside struck-through (superseded) text");
  // V15-ii no UNQUALIFIED overclaim: a bare `EXECUTION_READY = true` would read as provider/live readiness.
  if (/(?<![Pp]rogramme\/local `?)EXECUTION_READY\s*=\s*true/.test(amend))
    e.push("V15 amendment contains an UNQUALIFIED EXECUTION_READY = true (the programme/local scope qualifier is mandatory)");
  // V15a anti-regression: the superseded `= false` form must not reappear.
  if (/EXECUTION_READY\s*=\s*false/.test(amend))
    e.push("V15a amendment re-records EXECUTION_READY = false (superseded by the 2026-08-08 ruling)");
  // V15b readiness must NOT be inferrable as provider/live authority. This is the check that keeps V14
  // meaningful now that the readiness flag is true.
  if (!/Execution readiness does not authorise a provider/i.test(amend))
    e.push("V15b amendment does not state that execution readiness authorises no provider");
  if (!/different flag/i.test(amend))
    e.push("V15b amendment does not distinguish the programme flag from the host/live constants");

  // V16 — installation NotAuthorised.
  if (!/Installation authority:\s*\*?\*?NotAuthorised/i.test(amend) && !/installation[^\n]*NotAuthorised/i.test(amend))
    e.push("V16 amendment does not record installation authority NotAuthorised");

  // V17 — docs/governance only (no product source/manifest/lockfile in the change).
  if (!/no product source[^\n]*manifest[^\n]*lockfile/i.test(amend)) e.push("V17 amendment does not declare docs/governance-only (no product source/manifest/lockfile)");

  // V18 — no overall completion percentage in the amendment.
  if (/\d+(?:\.\d+)?\s*%/.test(amend)) e.push("V18 amendment contains a percentage token (prohibited)");

  // V19 — the amendment must carry the accepted numbered-phase position and the OPEN set, so the
  // governance documents cannot drift apart on the counter. Asserted as text (no percentage token,
  // which V18 forbids); the authoritative numbers live in current-state and are checked by the
  // crosswalk validator.
  if (!/Numbered V3 phase closure:\s*\*?\*?16 of 19/.test(amend))
    e.push("V19 amendment does not record the accepted numbered-phase position 16 of 19");
  if (!/OPEN:\s*\*?\*?12,\s*17,\s*18/.test(amend))
    e.push("V19 amendment does not record the OPEN phase set 12, 17, 18");
  if (!/V3 is \*?\*?not\*?\*? complete/i.test(amend))
    e.push("V19 amendment does not state that V3 is not complete");

  // Active machine plan version. V1 above already pins the HUMAN-READABLE master plan by SHA-256, and
  // that is the immutability this validator exists to protect. The machine plan RECORD is a separate
  // artefact the owner may supersede: on the bounded owner approval of 2026-08-09 it moved to v1.1
  // (crosswalk §5e). Pinning the record here is still a real control — an unapproved drift fails — but
  // it must name the ACTIVE version, not a frozen "1.0" that would now be false.
  if (st.activePlanVersion !== ACTIVE_PLAN_VERSION)
    e.push("current-state activePlanVersion is not the active approved plan version " + ACTIVE_PLAN_VERSION + ": " + st.activePlanVersion);

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) { errs.forEach((x) => console.error("[validate-v3.2-ai-provider-independence] FAIL: " + x)); process.exit(1); }
  console.log("validate-v3.2-ai-provider-independence: PASS");
}
