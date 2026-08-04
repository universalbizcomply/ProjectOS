// Validator: PROJECTOS-V3.1-CROSSWALK
//
// Fails closed. Proves the V3.1 status crosswalk + refreshed current-state + CD-B4 closure ledger stay
// internally consistent and cannot silently: renumber a historical phase, drop a CD-B4 closure, mark
// Forge formally closed, publish a merged overall percentage, enable EXECUTION_READY, or stale the head.
// Structural, bounded assertions only — the legitimate scoped 3/19 ratio and the historical 97.5% host
// estimate are permitted.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CROSSWALK = path.join(ROOT, "docs", "architecture", "projectos-v3.1-crosswalk.md");
const STATE = path.join(ROOT, "projectos", "state", "projectos-v3.current-state.json");
const INDEX = path.join(ROOT, "knowledge", "ProjectOS Reports Index.md");
const LEDGER = path.join(ROOT, "knowledge", "reports", "2026-07-29_ProjectOS_CD-B4-PRODUCTION-CLOSURES-LEDGER1A_CLOSED.md");

// Three commit-shaped constants that were previously collapsed into one. Conflating them was the
// defect: advancing the accepted head silently rewrote a CD-B4 closure-ledger assertion, and the
// document's own provenance had no separate identity at all.
//
// 1. A CLOSURE-LEDGER FACT. The accepted commit for CD-B4-PRODUCTION-IPC-PROVIDER1A. Frozen forever;
//    it must never track the repository head.
const CD_B4_IPC_PROVIDER_COMMIT = "e1749ccd2ca7a6348c5ece7bc97b18643de4e8ee";
// 2. DOCUMENT PROVENANCE. The commit the crosswalk itself declares it was written against.
const CROSSWALK_PROVENANCE = "fdee3d341e0c43ae2d62a256e0b755196599139b";
// 3. THE ACCEPTED PROGRAMME BASELINE. Phase 13 closure (PROJECTOS-V3-DESKTOP-AUTH-RECOVERY-PROOF1A).
//    current-state records the last ACCEPTED head, not every commit, so this is deliberately not the
//    live HEAD — `validate-plan-staleness` already treats an advancing head as ordinary progress.
const ACCEPTED_HEAD = "4d36eea110b120c1043d65a19fb8814cf381f268";

// The accepted numbered-roadmap position. The percentage is DERIVED, never independently asserted.
const ACCEPTED_PHASE_COUNT = 4;
const TOTAL_PHASE_COUNT = 19;
const ACCEPTED_PERCENTAGE = Math.round((ACCEPTED_PHASE_COUNT / TOTAL_PHASE_COUNT) * 1000) / 10;
const CROSSWALK_VERSION = "1.4";
const PHASE_13_ID = "PROJECTOS-V3-DESKTOP-E2E-PROOF1A";
// CD-B4 phases the owner ruling left OPEN. Flipping either to CLOSED here must fail.
const OPEN_CD_B4 = ["86ae19c", "a43898d"];

const V3_PHASE_IDS = [
  "PROJECTOS-V3-BASELINE-RECONCILE1A", "PROJECTOS-V3-MASTER-PLAN-MEMORY1A", "PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A",
  "PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A", "PROJECTOS-V3-LOCAL-SECRET-BROKER1A", "PROJECTOS-V3-SECRET-OPERATION-BROKER1A",
  "PROJECTOS-V3-OWNER-CHAT1A", "PROJECTOS-V3-PROJECT-SESSION-LAUNCHER1A", "PROJECTOS-V3-CLAUDE-DESKTOP-BRIDGE1A",
  "PROJECTOS-V3-E2E-RUNNER1A", "PROJECTOS-V3-APPROVAL-QUEUE1A", "PROJECTOS-V3-PROVIDER-CONTEXT-GUARDS1A",
  "PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A", "PROJECTOS-V3-DESKTOP-E2E-PROOF1A", "PROJECTOS-V3-POLYGO-BASELINE-RECONCILE1A",
  "PROJECTOS-V3-POLYGO-INSTALL-REENTRY1A", "PROJECTOS-V3-POLYGO-PILOT1A", "PROJECTOS-V3-RELIABILITY-HARDENING1A",
  "PROJECTOS-V3-FINAL-E2E-CLOSURE1A",
];

const CD_B4_CLOSURES = [
  ["CD-B4-IPC-SESSION-AUTHORITY1A", "e77ce3e"],
  ["CD-B4-RUNTIME-IPC-PERMIT-INTEGRATION1A", "4812f7f"],
  ["CD-B4-PRODUCTION-TRUSTED-CLOCK1A", "a5f8ac5"],
  ["CD-B4-PRODUCTION-RUNTIME-PROVIDER1A", "2a438b8"],
  ["CD-B4-PRODUCTION-IPC-PROVIDER1A", CD_B4_IPC_PROVIDER_COMMIT],
];

function run() {
  const e = [];
  if (!fs.existsSync(CROSSWALK)) { e.push("missing V3.1 crosswalk document"); return e; }
  const cw = fs.readFileSync(CROSSWALK, "utf8");

  // 2-7 header identity.
  if (!/Document ID:\*?\*?\s*PROJECTOS-V3\.1-CROSSWALK/.test(cw)) e.push("crosswalk missing exact Document ID PROJECTOS-V3.1-CROSSWALK");
  if (!new RegExp("Version:\\*?\\*?\\s*" + CROSSWALK_VERSION.replace(".", "\\.") + "\\b").test(cw))
    e.push("crosswalk version is not " + CROSSWALK_VERSION);
  if (!/AUTHORITATIVE CURRENT STATUS CROSSWALK/.test(cw)) e.push("crosswalk status does not identify it as a current-status crosswalk");
  if (!/ProjectOS V3 Master Plan v1\.0/.test(cw)) e.push("crosswalk missing approved-plan reference v1.0");
  if (!/1aa36b9/.test(cw)) e.push("crosswalk missing approved-plan source commit 1aa36b9");
  if (!new RegExp("Crosswalk source baseline:\\*?\\*?\\s*" + CROSSWALK_PROVENANCE).test(cw))
    e.push("crosswalk source baseline is not the declared provenance commit " + CROSSWALK_PROVENANCE);

  // 18 non-plan self-statement.
  if (!/replace, amend or version the approved ProjectOS V3 Master Plan v1\.0/i.test(cw))
    e.push("crosswalk does not clearly state it does not replace/amend/version the v1.0 plan");

  // 8 + 22 historical IDs unchanged (all 19 present).
  for (const id of V3_PHASE_IDS) if (cw.indexOf(id) === -1) e.push("crosswalk missing historical V3 phase ID (renumber/omission?): " + id);

  // 9 the ratio is scoped to the numbered roadmap. The RATIO ITSELF is asserted against the
  // authoritative record (current-state, check 19) rather than by regex over prose: the crosswalk
  // legitimately retains historical "3 / 19" text inside its superseded v1.2/v1.3 change notes, so a
  // prose scan cannot distinguish a historical quotation from the live figure.
  if (!/numbered/i.test(cw)) e.push("crosswalk does not scope the ratio to the numbered roadmap");

  // 9a Phase 13 is CLOSED in the phase matrix, stated exactly once. Guards both a silent reopen and a
  // duplicate closure row.
  const phase13Rows = cw.split("\n").filter((l) => /^\|\s*13\s*\|/.test(l));
  if (phase13Rows.length !== 1) e.push("crosswalk phase matrix has " + phase13Rows.length + " rows for phase 13 (expected exactly 1)");
  else {
    if (phase13Rows[0].indexOf(PHASE_13_ID) === -1) e.push("crosswalk phase-13 row is not " + PHASE_13_ID);
    if (!/\*\*CLOSED\*\*/.test(phase13Rows[0])) e.push("crosswalk phase-13 row is not CLOSED: " + phase13Rows[0].slice(0, 80));
  }

  // 9b the two CD-B4 phases the owner ruling left OPEN must still read OPEN, not CLOSED.
  for (const id of OPEN_CD_B4) {
    const row = cw.split("\n").find((l) => l.indexOf("`" + id + "`") !== -1 && /^\|/.test(l));
    if (!row) e.push("crosswalk missing the CD-B4 authority row for " + id);
    else if (!/\bOPEN\b/.test(row) || /\bCLOSED\b/.test(row)) e.push("crosswalk no longer records " + id + " as OPEN");
  }

  // 10 five CD-B4 closures with commits.
  for (const [id, commit] of CD_B4_CLOSURES) {
    if (cw.indexOf(id) === -1) e.push("crosswalk missing CD-B4 closure: " + id);
    if (cw.indexOf(commit) === -1) e.push("crosswalk missing CD-B4 accepted commit for " + id + ": " + commit);
  }

  // 11 Forge not formally closed.
  if (!/IMPLEMENTED AND PUSHED — FORMAL PROGRAMME CLOSURE NOT VERIFIED/.test(cw)) e.push("crosswalk does not record Forge as FORMAL PROGRAMME CLOSURE NOT VERIFIED");
  if (/Forge[^\n]{0,40}\bis formally closed\b/i.test(cw)) e.push("crosswalk asserts Forge is formally closed");

  // 12 Tracks A-G.
  for (const t of ["Track A", "Track B", "Track C", "Track D", "Track E", "Track F", "Track G"])
    if (cw.indexOf(t) === -1) e.push("crosswalk missing " + t);

  // 12b Track A-G authority status: approved directional structure, NOT awaiting approval, NOT
  // implementation authority. Checks the precise relationship, not broad words.
  if (cw.indexOf("APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE") === -1)
    e.push("crosswalk does not record the APPROVED DIRECTIONAL V3.1 ROADMAP STRUCTURE");
  if (!/Track A–G structure has been approved by the owner\/gatekeeper/.test(cw))
    e.push("crosswalk does not confirm Track A-G was approved by the owner/gatekeeper");
  if (/AWAITING FINAL ROADMAP APPROVAL/i.test(cw) || /awaiting final owner roadmap approval/i.test(cw))
    e.push("crosswalk still contains stale 'awaiting roadmap approval' authority status");
  if (!/(Directional-roadmap approval is \*?\*?not\*?\*? implementation authority|Roadmap approval is not implementation authority)/i.test(cw))
    e.push("crosswalk does not distinguish directional-roadmap approval from implementation authority");

  // 13-14 readiness / installation.
  if (!/EXECUTION_READY\s*=\s*false/.test(cw)) e.push("crosswalk does not record EXECUTION_READY = false");
  if (/EXECUTION_READY\s*=\s*true/.test(cw)) e.push("crosswalk records EXECUTION_READY = true");
  if (!/Installation authority\s*=\s*NotAuthorised/.test(cw)) e.push("crosswalk does not record Installation authority = NotAuthorised");

  // 15-17 metric separation: NOT YET CALCULABLE x2; the only % permitted is the historical 97.5%.
  if (!/Product capability implemented:\*?\*?\s*NOT YET CALCULABLE/i.test(cw)) e.push("crosswalk does not record product capability implemented = NOT YET CALCULABLE");
  if (!/Shipping readiness:\*?\*?\s*NOT YET CALCULABLE/i.test(cw)) e.push("crosswalk does not record shipping readiness = NOT YET CALCULABLE");
  const pctMatches = cw.match(/\d+(?:\.\d+)?\s*%/g) || [];
  for (const m of pctMatches) if (!/^97\.5\s*%$/.test(m.trim())) e.push("crosswalk contains a non-historical percentage token (merged overall % is prohibited): " + m.trim());

  // 19 current-state head == baseline; 3/19 unchanged.
  if (!fs.existsSync(STATE)) e.push("missing current-state file");
  else {
    let st;
    try { st = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (x) { e.push("current-state not valid JSON: " + x.message); st = null; }
    if (st) {
      // Head: current-state records the last ACCEPTED baseline, and local/remote must be reconciled.
      if (st.currentHead !== ACCEPTED_HEAD) e.push("current-state currentHead is not the accepted baseline " + ACCEPTED_HEAD + ": " + st.currentHead);
      if (st.currentRemoteHead !== ACCEPTED_HEAD) e.push("current-state currentRemoteHead is not the accepted baseline " + ACCEPTED_HEAD + ": " + st.currentRemoteHead);

      // Ratio: frozen accepted position AND internally derived, so neither can drift alone.
      if (st.acceptedPhaseCount !== ACCEPTED_PHASE_COUNT)
        e.push("current-state acceptedPhaseCount is not the accepted " + ACCEPTED_PHASE_COUNT + ": " + st.acceptedPhaseCount);
      if (st.totalPhaseCount !== TOTAL_PHASE_COUNT)
        e.push("current-state totalPhaseCount is not " + TOTAL_PHASE_COUNT + ": " + st.totalPhaseCount);
      if (st.completionPercentage !== ACCEPTED_PERCENTAGE)
        e.push("current-state completionPercentage is not the accepted " + ACCEPTED_PERCENTAGE + ": " + st.completionPercentage);
      const derived = Math.round((st.acceptedPhaseCount / st.totalPhaseCount) * 1000) / 10;
      if (st.completionPercentage !== derived)
        e.push("current-state completionPercentage " + st.completionPercentage + " is not derived from " + st.acceptedPhaseCount + "/" + st.totalPhaseCount + " (" + derived + ")");

      // Cross-source agreement: the closed phase list must match the count and contain Phase 13.
      const done = Array.isArray(st.completedPhases) ? st.completedPhases : [];
      if (done.length !== st.acceptedPhaseCount)
        e.push("current-state completedPhases length " + done.length + " != acceptedPhaseCount " + st.acceptedPhaseCount);
      if (done.indexOf(PHASE_13_ID) === -1)
        e.push("current-state completedPhases does not contain the closed phase 13 " + PHASE_13_ID);

      if (st.activePlanVersion !== "1.0") e.push("current-state activePlanVersion changed from 1.0 (plan must stay immutable)");
    }
  }

  // 20 ledger exists.
  if (!fs.existsSync(LEDGER)) e.push("missing consolidated CD-B4 closure ledger");
  else {
    const led = fs.readFileSync(LEDGER, "utf8");
    for (const [id, commit] of CD_B4_CLOSURES) {
      if (led.indexOf(id) === -1) e.push("closure ledger missing " + id);
      if (led.indexOf(commit) === -1) e.push("closure ledger missing accepted commit for " + id);
    }
    if (!/Status:\*?\*?\s*CLOSED/.test(led)) e.push("closure ledger status is not CLOSED");
  }

  // 21 reports index has the exact ledger row.
  if (!fs.existsSync(INDEX)) e.push("missing ProjectOS Reports Index");
  else {
    const idx = fs.readFileSync(INDEX, "utf8");
    const row = (idx.split("\n").find((l) => l.indexOf("CD-B4-PRODUCTION-CLOSURES-LEDGER1A") !== -1)) || "";
    if (!row) e.push("Reports Index missing the CD-B4 closures ledger row");
    else if (row.indexOf("CLOSED") === -1) e.push("CD-B4 closures ledger index row is not CLOSED");
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) { errs.forEach((x) => console.error("[validate-v3.1-crosswalk] FAIL: " + x)); process.exit(1); }
  console.log("validate-v3.1-crosswalk: PASS");
}
