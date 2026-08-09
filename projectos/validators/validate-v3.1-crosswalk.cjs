// Validator: PROJECTOS-V3.1-CROSSWALK
//
// Fails closed. Proves the V3.1 status crosswalk + refreshed current-state + CD-B4 closure ledger stay
// internally consistent and cannot silently: renumber a historical phase, drop a CD-B4 closure, mark
// Forge formally closed, publish a merged overall percentage, or stale the head.
// Structural, bounded assertions only — the legitimate scoped ratio and the historical 97.5% host
// estimate are permitted.
//
// EXECUTION READINESS (rebaselined 2026-08-08, PROJECTOS-V3-EXECUTION-READY-RECORD1A). This validator
// used to pin `EXECUTION_READY = false`. The owner/gatekeeper ruling moved programme/LOCAL execution
// readiness to TRUE, so the control MOVES rather than weakens: the crosswalk must now record
// programme/local readiness TRUE, must NOT regress to the `= false` form, and must still record every
// protected authority as NotAuthorised. Two distinct flags share the name and MUST NOT be conflated:
//   - the PROGRAMME/LOCAL record, asserted here, now true;
//   - the Rust host/live per-crate truthfulness constants, asserted here to still be FALSE.
// A change that flips the host constant to true, or that quietly re-reads the programme flag as false,
// fails this validator.
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
// 3. THE ACCEPTED PROGRAMME BASELINE. current-state records the last ACCEPTED head, not every commit,
//    so this is deliberately not the live HEAD — `validate-plan-staleness` already treats an advancing
//    head as ordinary progress. Rebaselined 2026-08-04 from the Phase 13 closure `4d36eea` to the
//    credential-router merge `cea095d`, then 2026-08-08 to `ec20512` — the current clean, pushed,
//    gate-accepted repository state, which contains the accepted validator scratch-lifecycle fix.
//    Deliberate rebaseline of an accepted fact, not a moving pointer: it advances only when a gate
//    formally accepts a new baseline, and it must stay distinct from the two constants above.
//    NOTE: `d9035b4` is the accepted EVIDENCE commit for PROJECTOS-V3-FINAL-RUNTIME-E2E1A. That is a
//    third, separate meaning — do not collapse it into this constant, which is the repository baseline.
const ACCEPTED_HEAD = "ec20512944be4fff7cc6ee740781fe95b41cf120";

// The accepted numbered-roadmap position. The percentage is DERIVED, never independently asserted.
// 2026-08-08: 4 -> 15 on the owner/gatekeeper closure of phases 3-11, 14, 15 (crosswalk v1.6 §5/§5a),
// taken on the read-only PROJECTOS-V3-19-PHASE-CLOSURE-RECONCILE1A audit.
// 2026-08-09: 15 -> 16 on the owner/gatekeeper closure of numbered Phase 16 PROJECTOS-V3-POLYGO-PILOT1A
// (crosswalk v1.7), the first real ProjectOS-governed PolyGo phase.
const ACCEPTED_PHASE_COUNT = 16;
const TOTAL_PHASE_COUNT = 19;
const ACCEPTED_PERCENTAGE = Math.round((ACCEPTED_PHASE_COUNT / TOTAL_PHASE_COUNT) * 1000) / 10;
const CROSSWALK_VERSION = "1.8";
// The ACTIVE machine-readable plan version. This pin used to read "1.0" under the label "plan must
// stay immutable". Two different artefacts were collapsed into that one word: the human-readable
// master plan, which IS byte-immutable and is pinned by SHA-256 in validate-v3.2, and the machine
// plan RECORD, which the owner may supersede. On the bounded owner approval of 2026-08-09 the record
// moved to v1.1 (crosswalk §5e), so this control MOVES rather than weakens: the immutability that
// actually mattered is still asserted, cross-file, by the v3.2 master-plan hash. An unapproved drift
// away from the active version still fails here.
const ACTIVE_PLAN_VERSION = "1.2";
// The superseded version must remain retrievable, byte-identical, at this archive path.
const ARCHIVED_PLAN_V1_0 = path.join(ROOT, "projectos", "state", "versions", "projectos-v3.plan.v1.0.json");
const PHASE_13_ID = "PROJECTOS-V3-DESKTOP-E2E-PROOF1A";

// The accepted per-phase position of the numbered roadmap. Asserted row-by-row against the §5 ledger so
// that neither an accidental closure nor an accidental reopen can pass. Scoped to the §5 ledger section
// because §3's build-order table also has small integers in its first column.
const LEDGER_CLOSED = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16];
const LEDGER_OPEN = [12, 17, 18];
// Phase 18 is OPEN, not retired: only its July completion CLAIM was superseded.
const OPEN_PHASE_CRITERIA = [
  ["Phase 12", "PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A"],
  ["Phase 17", "PROJECTOS-V3-RELIABILITY-HARDENING1A"],
  ["Phase 18", "PROJECTOS-V3-FINAL-E2E-CLOSURE1A"],
];
// The gate that moved programme/local execution readiness to true. Frozen accepted fact.
const RUNTIME_E2E_ID = "PROJECTOS-V3-FINAL-RUNTIME-E2E1A";
const RUNTIME_E2E_COMMIT = "d9035b4";
// Host/live readiness lives in Rust and stays FALSE. Asserted here so the programme flag going true can
// never be read as, or drift into, host/live readiness. BOTH crates that declare the constant are
// checked: the documents' prose vouches for the whole host set, so checking only one would leave the
// other flippable behind a control that claims to cover it.
const HOST_READINESS_LIBS = [
  path.join(ROOT, "projectos", "host", "shared-host-runtime", "src", "lib.rs"),
  path.join(ROOT, "projectos", "host", "windows-service-identity-proof-runner", "src", "lib.rs"),
];

// Rust comments are stripped before the host constants are read. A raw-text scan would let a leftover
// comment carrying the literal `EXECUTION_READY: bool = false` keep this control green while the real
// declaration had been flipped to true — the exact failure mode recorded in the repository's own
// comment-scanning lesson. The match also requires `pub const`, so only a real declaration satisfies it.
function stripRustComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
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

  // 9c the §5 numbered ledger, row by row. Scoped to the ledger section: §3's build-order table reuses
  // small integers in column 1, so an unscoped `^| N |` scan would read the wrong table. Every phase
  // must appear exactly once and carry its accepted CLOSED/OPEN state — this is the machine-checked
  // authority for the per-phase position, and it fails on an accidental closure AND on a reopen.
  const ledgerStart = cw.indexOf("## 5. Original V3 Phase");
  const ledgerEnd = cw.indexOf("### 5a.");
  if (ledgerStart === -1 || ledgerEnd === -1 || ledgerEnd < ledgerStart) {
    e.push("cannot locate the §5 numbered phase ledger section");
  } else {
    const ledger = cw.slice(ledgerStart, ledgerEnd).split("\n");
    const rowFor = (n) => ledger.filter((l) => new RegExp("^\\|\\s*" + n + "\\s*\\|").test(l));
    for (const n of LEDGER_CLOSED.concat(LEDGER_OPEN)) {
      const rows = rowFor(n);
      if (rows.length !== 1) { e.push("§5 ledger has " + rows.length + " rows for phase " + n + " (expected exactly 1)"); continue; }
      const row = rows[0];
      // Phases 0-2 predate the bold convention and read "CLOSED AND PUSHED", so match the word, not the
      // emphasis. The exclusivity check runs in BOTH directions: a row must not claim CLOSED and OPEN
      // simultaneously, whichever state it is supposed to be in. Enforcing it only on the OPEN side
      // would let "**CLOSED**, still OPEN pending review" pass as a closure.
      const closed = /\bCLOSED\b/.test(row);
      const open = /\bOPEN\b/.test(row);
      if (LEDGER_CLOSED.indexOf(n) !== -1 && (!closed || open)) e.push("§5 ledger phase " + n + " is not unambiguously CLOSED: " + row.slice(0, 90));
      if (LEDGER_OPEN.indexOf(n) !== -1 && (!open || closed)) e.push("§5 ledger phase " + n + " is not unambiguously OPEN: " + row.slice(0, 90));
    }
    if (!/Numbered V3 closure ratio = 16 \/ 19/.test(cw)) e.push("crosswalk does not state the accepted ratio 16 / 19");
  }

  // 9d Phase 18 is OPEN and explicitly NOT retired — only its July completion claim was superseded.
  // Without this, "SUPERSEDED" could quietly stand in for a closure that was never granted.
  if (!/NOT RETIRED/.test(cw)) e.push("crosswalk does not record that Phase 18 is NOT retired");

  // 9e the OPEN phases must each carry explicit acceptance criteria (§5b). The audit found phases 3-18
  // never had any, which is why closure was unmeasurable; this stops the same gap reopening.
  if (cw.indexOf("### 5b.") === -1) e.push("crosswalk is missing §5b acceptance criteria for the OPEN phases");
  else {
    const critStart = cw.indexOf("### 5b.");
    const critEnd = cw.indexOf("### 5c.");
    const crit = critEnd > critStart ? cw.slice(critStart, critEnd) : cw.slice(critStart);
    for (let i = 0; i < OPEN_PHASE_CRITERIA.length; i++) {
      const [label, id] = OPEN_PHASE_CRITERIA[i];
      if (crit.indexOf(label) === -1 || crit.indexOf(id) === -1) {
        e.push("§5b is missing acceptance criteria for " + label + " " + id);
        continue;
      }
      // Presence of a heading is not criteria. Take this phase's block up to the next phase heading and
      // require real enumerated content — otherwise "Phase 12 — <id>: TBD" would satisfy the check and
      // the structural gap this section exists to close would quietly reopen.
      const from = crit.indexOf(label);
      const next = i + 1 < OPEN_PHASE_CRITERIA.length ? crit.indexOf(OPEN_PHASE_CRITERIA[i + 1][0], from + 1) : -1;
      const block = crit.slice(from, next === -1 ? undefined : next);
      const items = (block.match(/(?:^|\s)\d+\.\s+\S/g) || []).length;
      if (items < 5) e.push("§5b acceptance criteria for " + label + " has only " + items + " enumerated items (expected at least 5)");
      if (/\bTBD\b|\bTODO\b|\bplaceholder\b/i.test(block)) e.push("§5b acceptance criteria for " + label + " contain a placeholder");
    }
  }

  // 9f the two-stack ruling must stay recorded: the canonical runtime is core/agent, and Phase 12 must
  // not spawn a third governance runtime.
  if (cw.indexOf("### 5c.") === -1) e.push("crosswalk is missing the §5c two-stack architecture ruling");
  else if (!/third runtime/i.test(cw)) e.push("§5c does not prohibit building a third runtime");

  // 9g Phase 12 / Phase 13 dependency reconciliation. The roadmap is sequential (master plan §16), so
  // Phase 13 CLOSED while Phase 12 is OPEN inverts the declared order. That is an accepted, SPECIFIC
  // later-authority exception — but only while it is explained. This check fires exactly on that
  // combination, so it costs nothing once Phase 12 closes, and it demands every load-bearing meaning
  // rather than the mere presence of a heading. It is NOT a general dependency engine and must not
  // grow into one.
  const p12Open = LEDGER_OPEN.indexOf(12) !== -1;
  const p13Closed = LEDGER_CLOSED.indexOf(13) !== -1;
  if (p12Open && p13Closed) {
    if (cw.indexOf("### 5d.") === -1) {
      e.push("§5d Phase 12/13 dependency reconciliation is missing while Phase 13 is CLOSED and Phase 12 is OPEN");
    } else {
      const dStart = cw.indexOf("### 5d.");
      const dEnd = cw.indexOf("\n## ", dStart);
      const rec = cw.slice(dStart, dEnd === -1 ? undefined : dEnd);
      for (const [why, re] of [
        ["Phase 13 remains CLOSED", /Phase 13 remains CLOSED/i],
        ["Phase 12 remains OPEN", /Phase 12 remains OPEN/i],
        ["Phase 13 closure does not imply Phase 12 completion", /does NOT imply Phase 12 completion/i],
        ["Phase 12 still required before final Phase 18 closure", /Phase 12 must still close before final Phase 18 closure/i],
        ["the exception is specific, not a general dependency bypass", /does not create a general right to bypass roadmap dependencies/i],
      ]) if (!re.test(rec)) e.push("§5d does not record: " + why);
    }
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

  // 13 readiness — programme/LOCAL scope only, and it must be scoped in the text, not bare. The
  // qualifier is load-bearing: an unqualified "EXECUTION_READY = true" is exactly the overclaim this
  // check exists to prevent, so the phrase must carry its scope.
  const readinessLine = cw.split("\n").find((l) => /Programme\/local EXECUTION_READY\s*=\s*true/.test(l));
  if (!readinessLine) e.push("crosswalk does not record programme/local EXECUTION_READY = true");
  // 13a-i the live statement must not be struck through. This document supersedes prose by wrapping it
  // in ~~…~~ rather than deleting it, so a presence check alone would accept a RETRACTED assertion.
  else if (readinessLine.indexOf("~~") !== -1)
    e.push("crosswalk records programme/local EXECUTION_READY = true only inside struck-through (superseded) text");
  // 13a-ii no UNQUALIFIED overclaim anywhere: every `EXECUTION_READY = true` must carry its scope. The
  // qualifier is the whole point — a bare claim would read as host/live/provider readiness.
  // (Either case of the qualifier is accepted — the prose uses it mid-sentence as well as to open one.)
  if (/(?<![Pp]rogramme\/local `?)EXECUTION_READY\s*=\s*true/.test(cw))
    e.push("crosswalk contains an UNQUALIFIED EXECUTION_READY = true (the programme/local scope qualifier is mandatory)");
  // 13a anti-regression: the superseded `= false` form must not reappear. Historical change notes state
  // it as prose ("EXECUTION_READY remains false"), which is retained and does not match this form.
  if (/EXECUTION_READY\s*=\s*false/.test(cw))
    e.push("crosswalk re-records EXECUTION_READY = false (superseded by the 2026-08-08 ruling)");
  // 13b the readiness flag must be tied to its discharging evidence, so it cannot float free of proof.
  if (cw.indexOf(RUNTIME_E2E_ID) === -1) e.push("crosswalk does not name the gating phase " + RUNTIME_E2E_ID);
  if (cw.indexOf(RUNTIME_E2E_COMMIT) === -1) e.push("crosswalk does not record the accepted runtime-E2E commit " + RUNTIME_E2E_COMMIT);

  // 14 installation + every other protected authority stays NotAuthorised. Local readiness must never
  // be readable as installation, production, provider or credential authority.
  if (!/Installation authority\s*=\s*NotAuthorised/.test(cw)) e.push("crosswalk does not record Installation authority = NotAuthorised");
  if (!/Live\/production\/provider\/credential authority\s*=\s*NotAuthorised/.test(cw))
    e.push("crosswalk does not record live/production/provider/credential authority = NotAuthorised");

  // 14a HOST/LIVE readiness is a DIFFERENT flag and stays false, in Rust. Asserted cross-file so the two
  // can never be conflated by a document edit alone.
  for (const lib of HOST_READINESS_LIBS) {
    const crate = path.basename(path.dirname(path.dirname(lib)));
    if (!fs.existsSync(lib)) { e.push("missing " + crate + " lib.rs (host readiness unassertable)"); continue; }
    if (!/pub const EXECUTION_READY:\s*bool\s*=\s*false/.test(stripRustComments(fs.readFileSync(lib, "utf8"))))
      e.push("host/live execution readiness is no longer false in " + crate + " — the programme flag must never move it");
  }
  if (!/different flag/i.test(cw)) e.push("crosswalk does not distinguish the programme flag from the host/live constants");

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
      // The IDS must match the §5 ledger's CLOSED set exactly, not merely the count. A length-only
      // check would accept fifteen arbitrary or duplicated IDs and let current-state drift away from
      // the ledger while both still "agreed" numerically — an artificially correct-looking counter.
      const expectedClosed = LEDGER_CLOSED.map((n) => V3_PHASE_IDS[n]);
      for (const id of expectedClosed)
        if (done.indexOf(id) === -1) e.push("current-state completedPhases is missing the CLOSED phase " + id);
      for (const id of done)
        if (expectedClosed.indexOf(id) === -1) e.push("current-state completedPhases contains a phase the §5 ledger does not record CLOSED: " + id);
      // And the OPEN set must not be claimed as complete.
      for (const n of LEDGER_OPEN)
        if (done.indexOf(V3_PHASE_IDS[n]) !== -1) e.push("current-state completedPhases contains the OPEN phase " + V3_PHASE_IDS[n]);

      // pendingPhases must be exactly the OPEN set. Without this, a phase could be recorded CLOSED and
      // STILL sit in pendingPhases — the counters would agree while the file contradicted itself. Found
      // by the Phase-16 closure mutation matrix, where re-adding a closed phase to pendingPhases passed.
      const pend = Array.isArray(st.pendingPhases) ? st.pendingPhases : [];
      const expectedOpen = LEDGER_OPEN.map((n) => V3_PHASE_IDS[n]);
      if (pend.length !== expectedOpen.length)
        e.push("current-state pendingPhases length " + pend.length + " != the " + expectedOpen.length + " OPEN phases");
      for (const id of expectedOpen)
        if (pend.indexOf(id) === -1) e.push("current-state pendingPhases is missing the OPEN phase " + id);
      for (const id of pend)
        if (expectedOpen.indexOf(id) === -1) e.push("current-state pendingPhases contains a phase the §5 ledger does not record OPEN: " + id);

      if (st.activePlanVersion !== ACTIVE_PLAN_VERSION)
        e.push("current-state activePlanVersion is not the active approved plan version " + ACTIVE_PLAN_VERSION + ": " + st.activePlanVersion);
    }
  }

  // 19a the superseded plan version must stay retrievable. A supersession that deletes its
  // predecessor destroys version history, which is the one thing plan versioning exists to keep.
  if (!fs.existsSync(ARCHIVED_PLAN_V1_0)) {
    e.push("superseded plan v1.0 is not retained at projectos/state/versions/projectos-v3.plan.v1.0.json");
  } else {
    let archived = null;
    try { archived = JSON.parse(fs.readFileSync(ARCHIVED_PLAN_V1_0, "utf8")); }
    catch (x) { e.push("archived plan v1.0 is not valid JSON: " + x.message); }
    if (archived && archived.planVersion !== "1.0") e.push("archived plan is not v1.0: " + archived.planVersion);
    // And the live record must declare what it supersedes, so the chain is explicit rather than
    // inferred. GENERALISED at the v1.2 activation: the first version of this check hardcoded
    // "supersedes v1.0", which was true of v1.1 and false of every version after it — a check that
    // only holds for one supersession is a check that breaks the moment the mechanism is used again.
    // It now asserts the CHAIN: the live record names its immediate predecessor, and every superseded
    // version is still retrievable under versions/.
    const LIVE = path.join(ROOT, "projectos", "state", "projectos-v3.plan.json");
    try {
      const live = JSON.parse(fs.readFileSync(LIVE, "utf8"));
      if (live.planVersion !== ACTIVE_PLAN_VERSION) e.push("live plan version is not " + ACTIVE_PLAN_VERSION + ": " + live.planVersion);
      const supersedes = live.approval && live.approval.supersedesPlanVersion;
      if (typeof supersedes !== "string" || !/^[0-9]+\.[0-9]+$/.test(supersedes))
        e.push("live plan does not record which version it supersedes");
      else {
        if (supersedes === live.planVersion) e.push("live plan supersedes itself: " + supersedes);
        const priorPath = path.join(ROOT, "projectos", "state", "versions", "projectos-v3.plan.v" + supersedes + ".json");
        if (!fs.existsSync(priorPath))
          e.push("superseded plan v" + supersedes + " is not retained at " + path.relative(ROOT, priorPath).replace(/\\/g, "/"));
        else {
          try {
            const prior = JSON.parse(fs.readFileSync(priorPath, "utf8"));
            if (prior.planVersion !== supersedes) e.push("retained predecessor is not v" + supersedes + ": " + prior.planVersion);
          } catch (x) { e.push("retained predecessor v" + supersedes + " is not valid JSON: " + x.message); }
        }
      }
      // The delegation must stay ProjectOS-scoped and must never carry protected authority.
      const del = (live.governance || {}).closureDelegation;
      if (del) {
        if (del.projectScope !== live.projectId) e.push("closureDelegation.projectScope escapes this project: " + del.projectScope);
        if (del.excludesProtectedActions !== true) e.push("closureDelegation no longer excludes protected actions");
        if (del.delegatedBy !== "Murad") e.push("closureDelegation.delegatedBy is not the owner: " + del.delegatedBy);
      }
    } catch (x) { e.push("live plan not readable: " + x.message); }
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
