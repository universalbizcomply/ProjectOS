"use strict";
// PROJECTOS-HOST-REVIEW-PATH1B — the FIVE production boundaries closed by the owner ruling G1-G5,
// and the complete service composition they make reachable.
//
// WHAT THIS PINS, in one sentence each:
//   G1  ONE VERIFICATION, AND ITS RESULT TRAVELS. The service-host canonical read returns the exact
//       `VerifiedCanonicalInstallation` that `verify_record` produced, never a record-derived
//       substitute and never a second opinion, and a verified value exists only with a Verified report.
//   G2  A FEATURE COMPILES THE CLOCK ROUTE; IT NEVER MINTS TIME. The production clock-binding grant is
//       reachable only from a ONE-SHOT authority that demands a service-runtime-confirmed machine
//       authority; the fixture grant stays fixture-only; the default graph has no route at all.
//   G3  THE SAME-CONNECTION EVIDENCE IS ASSEMBLED FROM REAL TRANSPORT FACTS, inside the live IPC
//       boundary, from the verifier's own identity and the ONE audited kernel capture — no fixture
//       assembler in production and no caller-selected identifier.
//   G4  THE RUNTIME OBSERVATION IS THE HOST'S OWN, AND STAYS EVIDENCE. The installed-service producer
//       carries its own process as service evidence and mints nothing; the sealed core verifier
//       remains the authority boundary.
//   G5  THE GOVERNED REVIEW SCOPE IS DISTINCT FROM THE STATUS READ, minted from the owner-signed
//       programme delegation, and neither scope substitutes for the other in either direction.
//   S   THE SERVICE COMPOSITION IS THE PRODUCTION ROUTE. One acquisition, one clock lineage, one
//       lease, one capability set, many per-connection verifiers; and no fixture in the chain.
//
// STRUCTURAL, comments stripped, and every check is proven non-vacuous by a mutation in the phase
// record.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const P = (...s) => path.join(ROOT, "projectos", ...s);
const HOST = (...s) => P("host", ...s);

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
/** Strip block and line comments so prose can never satisfy a check. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ");
}
function count(src, re) {
  return (src.match(re) || []).length;
}

function run() {
  const e = [];
  const need = (p, label) => {
    if (!fs.existsSync(p)) {
      e.push(label + " is missing: " + path.relative(ROOT, p).replace(/\\/g, "/"));
      return false;
    }
    return true;
  };

  // ---- G1 ONE VERIFICATION, AND ITS RESULT TRAVELS ---------------------------------------------
  {
    const p = HOST("service-host", "src", "status.rs");
    if (need(p, "G1 the service-host status module")) {
      const x = strip(read(p));
      // The read RETURNS the verified value. `Ok(_verified)` — the defect this closed — must be gone.
      if (/Ok\(_verified\)/.test(x))
        e.push("G1 the successful verification result is discarded again");
      if (!/verified:\s*Some\(verified\)/.test(x))
        e.push("G1 the read does not carry the verified canonical installation");
      if (!/pub fn verified_canonical_installation\(\)\s*->\s*Option<VerifiedCanonicalInstallation>/.test(x))
        e.push("G1 there is no single production source of the verified canonical installation");
      // EXACTLY ONE verification call in the module: a second would be a second opinion.
      const verifies = count(x, /verify_record\(/g);
      if (verifies !== 1)
        e.push("G1 verify_record is called " + verifies + " times; exactly 1 is allowed");
      // The public source reads it off that one call, never rebuilds it from the record.
      if (!/pub fn verified_canonical_installation\(\)[\s\S]{0,200}read_and_verify\(\)\.verified/.test(x))
        e.push("G1 the production source does not read the one verification's own result");
      // EVERY non-Verified site fails closed. Counting is the point: an earlier version matched ONE
      // Refused site and let a second carry a verified value, which is exactly the hole G1 closes.
      const reports = [...x.matchAll(/report:\s*IdentityVerificationReport::(\w+),\s*record:[^,]*,\s*verified:\s*(\w+)/g)];
      if (reports.length < 4)
        e.push("G1 the canonical read has " + reports.length + " outcome sites; at least 4 are expected");
      for (const [, report, verified] of reports) {
        if (report === "Verified" && verified !== "Some")
          e.push("G1 a Verified report carries no verified value");
        if (report !== "Verified" && verified !== "None")
          e.push("G1 a " + report + " report carries a verified value — it must fail closed");
      }
      if (reports.filter(([, r]) => r === "Verified").length !== 1)
        e.push("G1 there is not exactly one Verified outcome site");
    }
  }

  // ---- G2 A FEATURE COMPILES THE CLOCK ROUTE; IT NEVER MINTS TIME ------------------------------
  {
    const p = HOST("core", "src", "authority_time.rs");
    const tomlP = HOST("core", "Cargo.toml");
    if (need(p, "G2 the core authority-time module") && need(tomlP, "G2 the core manifest")) {
      const x = strip(read(p));
      const toml = read(tomlP);

      // The feature exists, is NON-DEFAULT, and pulls no fixture surface with it.
      if (!/^production-clock-binding = \[\]$/m.test(toml))
        e.push("G2 production-clock-binding is missing or is not an empty (non-default) feature");
      if (/^default = \[[^\]]*production-clock-binding/m.test(toml))
        e.push("G2 production-clock-binding is enabled by default");

      // THE GRANT'S OWN MINT STAYS CRATE-PRIVATE. Nothing else may reach it.
      if (!/pub\(crate\) fn mint\(\) -> Self/.test(x))
        e.push("G2 the clock-binding grant's mint is no longer crate-private");
      // Exactly TWO callers of that mint: the fixture one and the production one.
      const mints = count(x, /ProductionClockBindingGrant::mint\(\)/g);
      if (mints !== 2)
        e.push("G2 the grant mint has " + mints + " call sites; exactly 2 (fixture + production) are allowed");
      // The fixture mint stays fixture-only and is NOT reachable from the production feature.
      if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*#\[must_use\]\s*pub fn fixture_production_clock_binding_grant/.test(x))
        e.push("G2 the fixture grant mint is no longer confined to test-fixtures");
      if (/production-clock-binding[\s\S]{0,160}fixture_production_clock_binding_grant/.test(toml))
        e.push("G2 the production feature can reach the fixture grant");

      // THE PRODUCTION MINT IS GATED, AND ITS ONLY INPUT IS THE CONFIRMED SERVICE-RUNTIME AUTHORITY.
      const est = /pub fn establish_production_clock_authority\([\s\S]*?\n\}/.exec(x);
      if (!est) e.push("G2 the production clock authority is missing");
      else {
        const m = est[0];
        if (
          !/establish_production_clock_authority\(\s*confirmed: &projectos_host_authority::model::ConfirmedAuthorityGuard,?\s*\)/.test(
            m
          )
        )
          e.push("G2 the clock authority takes something other than exactly one borrowed confirmed guard");
        if (!/AuthorityPeerState::ServiceRuntimeConfirmed => \{\}/.test(m))
          e.push("G2 the clock authority does not require the SERVICE-RUNTIME confirmed state");
        if (!/_ => return Err\(ProductionClockAuthorityRefusal::NotServiceRuntime\)/.test(m))
          e.push("G2 the clock authority does not EXHAUSTIVELY refuse every other peer state");
        // ONE-SHOT, claimed atomically BEFORE anything is produced.
        if (!/compare_exchange\(false, true/.test(m))
          e.push("G2 the one-shot latch is not claimed with a compare-and-exchange");
        if (!/ProductionClockAuthorityRefusal::AlreadyEstablished/.test(m))
          e.push("G2 a second establishment is not refused");
        // NOTHING A CALLER CAN WRITE DOWN.
        for (const bad of ["bool", "&str", "String", "std::env", "VerifiedCanonicalInstallation"]) {
          if (m.includes(bad)) e.push("G2 the clock authority names a forbidden source: " + bad);
        }
      }
      // The whole route is behind the feature — with it off, there is no authority type at all.
      for (const item of [
        "pub struct ProductionClockAuthority",
        "pub fn establish_production_clock_authority",
        "pub enum ProductionClockAuthorityRefusal",
      ]) {
        const at = x.indexOf(item);
        if (at === -1) {
          e.push("G2 missing " + item);
          continue;
        }
        // IMMEDIATELY preceding, not merely nearby: a lookback wide enough to catch the previous
        // item's attribute would pass for an item that carries no gate of its own.
        const before = x.slice(Math.max(0, at - 260), at);
        if (!/#\[cfg\(feature = "production-clock-binding"\)\]\s*(#\[[^\]]*\]\s*)*$/.test(before))
          e.push("G2 " + item + " is not gated to production-clock-binding");
      }
      // The grant is produced by CONSUMING the authority, so one authority binds one lineage.
      if (!/pub fn into_clock_binding_grant\(self\) -> ProductionClockBindingGrant/.test(x))
        e.push("G2 the authority does not consume itself to produce the grant");
      // The latch reset is cfg(test) ALONE — never reachable from a fixture graph.
      if (/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\][\s\S]{0,120}reset_production_clock_latch/.test(x))
        e.push("G2 the one-shot latch can be reset from a fixture graph");
    }
    // The observation capability that feeds the clock is gated on the SAME authority.
    const clkP = HOST("windows-clock", "src", "lib.rs");
    if (need(clkP, "G2 the windows-clock crate")) {
      const c = strip(read(clkP));
      if (
        !/pub fn for_production_clock_authority\(\s*_authority: &projectos_host_core::ProductionClockAuthority,?\s*\) -> Self/.test(
          c
        )
      )
        e.push("G2 the live clock observation capability is not gated on the one-shot clock authority");
      const at = c.indexOf("pub fn for_production_clock_authority");
      if (
        at !== -1 &&
        !/#\[cfg\(feature = "production-clock-observation"\)\]\s*(#\[[^\]]*\]\s*)*$/.test(
          c.slice(Math.max(0, at - 200), at)
        )
      )
        e.push("G2 the production clock observation acquisition is not feature-gated");
    }
  }

  // ---- G3 THE SAME-CONNECTION EVIDENCE IS ASSEMBLED FROM REAL TRANSPORT FACTS -------------------
  {
    const p = HOST("windows-local-ipc", "src", "production_peer_evidence.rs");
    const libP = HOST("windows-local-ipc", "src", "lib.rs");
    if (need(p, "G3 the production peer-evidence assembler") && need(libP, "G3 the ipc crate root")) {
      const x = strip(read(p));
      const lib = strip(read(libP));
      // It lives in the LIVE graph only — the trusted transport — and nowhere else.
      if (!/#\[cfg\(all\(windows, feature = "windows-live-ipc"\)\)\]\s*pub mod production_peer_evidence;/.test(lib))
        e.push("G3 the production assembler is not confined to the live IPC graph");
      // The connection identity comes from the VERIFIER, never from a parameter.
      if (!/verifier\.connection_id\(\),\s*verifier\.handshake_generation\(\),/.test(x))
        e.push("G3 the assembler does not take its connection identity from the sealed verifier");
      for (const bad of ["connection_id:", "handshake_generation:"]) {
        if (new RegExp("fn assemble_production_same_connection_evidence[\\s\\S]{0,600}" + bad).test(x))
          e.push("G3 the assembler accepts a caller-supplied " + bad.replace(":", ""));
      }
      // The confirmation is MOVED IN, so one handshake attests at most one bundle.
      if (!/confirmed: ConfirmedIpcPeerHandshake,/.test(x))
        e.push("G3 the assembler does not consume the confirmation by value");
      // The peer identity is the ONE audited capture, and the class is the admission's own answer.
      if (!/client\.pid\(\),\s*client\.creation_tick\(\),/.test(x))
        e.push("G3 the assembler does not bind the admitted client's own process identity");
      if (!/PeerUserClass::Owner,/.test(x))
        e.push("G3 the assembler does not record the admitted configured-owner class");
      // The window comes from the trusted clock, and cannot wrap.
      if (!/let observed_at = now\.reading\(\);/.test(x))
        e.push("G3 the observation time is not the trusted clock reading");
      if (!/observed_at\.saturating_add\(window\)/.test(x))
        e.push("G3 the validity window can wrap into the past");
      // NO FIXTURE IN PRODUCTION.
      const prod = x.replace(/#\[cfg\(all\(test, feature = "test-fixtures"\)\)\][\s\S]*$/, "");
      for (const bad of ["synthetic_for_fixture", "assemble_same_connection_ipc_peer_fixture", "for_local_proof"]) {
        if (prod.includes(bad)) e.push("G3 the production assembler reaches a fixture route: " + bad);
      }
      // The FIXTURE assembler must NOT be reachable in the live graph.
      const adapter = strip(read(HOST("windows-local-ipc", "src", "adapter.rs")));
      if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*mod fixture_handshake/.test(adapter))
        e.push("G3 the fixture assembler is no longer confined to test-fixtures");
      // The bounded process projection exists and is BOUNDED — two scalars, no SID, no session.
      const ca = strip(read(HOST("windows-service-identity-proof", "src", "client_admission.rs")));
      if (!/pub struct AdmittedClientProcess \{\s*_sealed: Sealed,\s*pid: u32,\s*creation_tick: u64,\s*\}/.test(ca))
        e.push("G3 the admitted-client projection is not exactly the two bounded scalars");
      if (!/pub fn observed_client_process\(&self\) -> Option<AdmittedClientProcess>/.test(ca))
        e.push("G3 the admitted-client projection is not read off the completed attempt");
      if (/impl\s+(Default|From<)/.test(ca.slice(ca.indexOf("pub struct AdmittedClientProcess"), ca.indexOf("pub struct AdmittedClientProcess") + 1200)))
        e.push("G3 the admitted-client projection gained a Default or a From");
    }
  }

  // ---- G4 THE RUNTIME OBSERVATION IS THE HOST'S OWN, AND STAYS EVIDENCE -------------------------
  {
    const p = HOST("windows-runtime-observation", "src", "lib.rs");
    if (need(p, "G4 the windows-runtime-observation crate")) {
      const x = strip(read(p));
      const fn = /pub fn installed_service_observation\([\s\S]*?\n\}/.exec(x);
      if (!fn) e.push("G4 the installed-service observation producer is missing");
      else {
        const m = fn[0];
        if (!/role: projectos_host_core::HostRole::InstalledService,/.test(m))
          e.push("G4 the installed-service observation does not claim the installed-service role");
        if (!/source: projectos_host_core::RuntimeSource::WindowsService,/.test(m))
          e.push("G4 the installed-service observation does not declare the Windows-service source");
        // The corroborating evidence IS this process — never a second, independently fallible read.
        if (!/ServiceInstanceEvidence::new\(observation\.pid, observation\.creation_time\)\?/.test(m))
          e.push("G4 the service evidence is not this process's own identity");
        if (!/service_evidence: Some\(evidence\)/.test(m))
          e.push("G4 the installed-service observation ships without service evidence");
        // It MINTS NOTHING.
        for (const bad of ["VerifiedRuntimeInstance", "VerifiedAuthorityTime", "ProductionClockBindingGrant"]) {
          if (m.includes(bad)) e.push("G4 the observation producer names an authority type: " + bad);
        }
      }
      // The production observation capability is gated on the SAME confirmed service-runtime authority.
      if (
        !/pub fn for_confirmed_service_runtime\(\s*confirmed: &projectos_host_authority::model::ConfirmedAuthorityGuard,?\s*\) -> Option<Self>/.test(
          x
        )
      )
        e.push("G4 the live observation capability is not gated on the confirmed machine authority");
      if (!/AuthorityPeerState::ServiceRuntimeConfirmed => Some\(Self \{/.test(x))
        e.push("G4 the observation capability does not require the SERVICE-RUNTIME confirmed state");
      const at = x.indexOf("pub fn for_confirmed_service_runtime");
      if (
        at !== -1 &&
        !/#\[cfg\(feature = "production-runtime-observation"\)\]\s*(#\[[^\]]*\]\s*)*$/.test(
          x.slice(Math.max(0, at - 200), at)
        )
      )
        e.push("G4 the production observation acquisition is not feature-gated");
    }
  }

  // ---- G5 THE GOVERNED REVIEW SCOPE IS DISTINCT FROM THE STATUS READ ----------------------------
  {
    const adapterP = HOST("windows-local-ipc", "src", "adapter.rs");
    const reviewP = HOST("windows-local-ipc", "src", "review_exchange.rs");
    const ffiP = HOST("windows-local-ipc", "src", "windows_ffi.rs");
    if (
      need(adapterP, "G5 the ipc adapter") &&
      need(reviewP, "G5 the review exchange") &&
      need(ffiP, "G5 the live ipc facade")
    ) {
      const a = strip(read(adapterP));
      const r = strip(read(reviewP));
      const f = strip(read(ffiP));

      // TWO distinct scopes, and the capability CARRIES the one it was minted at.
      if (!/GovernedHostReviewLocalOnly,/.test(a) || !/ReadInstalledHostStatusLocalOnly,/.test(a))
        e.push("G5 the two capability scopes are not both present");
      if (!/pub struct LiveIpcOperationCapability \{[\s\S]*?scope: CapabilityScope,[\s\S]*?\}/.test(a))
        e.push("G5 the capability does not carry its minted scope");

      // THE REVIEW CAPABILITY IS NOT MINTED FROM THE STATUS READ, in any form.
      for (const bad of ["OwnerStatusReadApproval", "REQUIRED_PHRASE"]) {
        if (r.includes(bad))
          e.push("G5 the review exchange names the status-read approval: " + bad);
      }
      // ...nor from a handshake, an Agent request, a SID or elevation.
      const mint = /pub fn from_owner_programme_delegation\([\s\S]*?\n    \}/.exec(r);
      if (!mint) e.push("G5 the governed-review mint is missing");
      else {
        for (const bad of [
          "ConfirmedIpcPeerHandshake",
          "ProtectedOperationRequest",
          "configured_owner",
          "elevat",
          "std::env",
        ]) {
          if (mint[0].includes(bad))
            e.push("G5 the governed-review mint names a forbidden source: " + bad);
        }
      }

      // NEITHER SCOPE SUBSTITUTES FOR THE OTHER — checked in BOTH directions.
      if (!/cap\.scope\(\) != crate::adapter::CapabilityScope::ReadInstalledHostStatusLocalOnly/.test(f))
        e.push("G5 the status facade does not refuse a non-status scope");
      if (!/cap\.scope\(\) != crate::adapter::CapabilityScope::GovernedHostReviewLocalOnly/.test(f))
        e.push("G5 the review facade does not refuse a non-review scope");
      if (!/transport\.scope\(\) != crate::adapter::CapabilityScope::GovernedHostReviewLocalOnly/.test(f))
        e.push("G5 the governed-review facade does not refuse a non-review scope");
      if (!/cap\.scope\(\) != CapabilityScope::GovernedHostReviewLocalOnly/.test(r))
        e.push("G5 the review-half primitive does not refuse a non-review scope");

      // A REVIEW CAPABILITY IS NOT A PROVIDER OR SPEND AUTHORITY, and reaches no other operation.
      for (const bad of [
        "ProviderCapabilitySet",
        "ProviderAuthorityLease",
        "CanonicalBudgetLedger",
        "credential",
        "ShutdownRequest",
        "OpenSCManager",
      ]) {
        const sliceStart = r.indexOf("pub struct HostReviewIpcCapability");
        const seg = sliceStart === -1 ? r : r.slice(sliceStart, sliceStart + 6000);
        if (seg.includes(bad))
          e.push("G5 the review capability surface reaches beyond its scope: " + bad);
      }
    }
  }

  // ---- S THE SERVICE COMPOSITION IS THE PRODUCTION ROUTE ---------------------------------------
  {
    const p = HOST("service-host", "src", "trusted_startup.rs");
    const servP = HOST("service-host", "src", "serve.rs");
    const tomlP = HOST("service-host", "Cargo.toml");
    if (
      need(p, "S the trusted startup composition") &&
      need(servP, "S the service serve module") &&
      need(tomlP, "S the service manifest")
    ) {
      const x = strip(read(p));
      const sv = strip(read(servP));
      const toml = read(tomlP);

      // THE ORDER IS THE CONTROL. Each link appears, once, after the one before it.
      const order = [
        "status::verified_canonical_installation()",
        "acquire_service_runtime_authority(&installation)",
        "establish_production_clock_authority(&guard)",
        "LiveRuntimeObservationCapability::for_confirmed_service_runtime(&guard)",
        "clock_authority.into_clock_binding_grant()",
        "bind_production_clock(grant, source",
        "open_provider_authority(guard,",
        "into_provider_capabilities(&consumed)",
      ];
      let at = -1;
      for (const step of order) {
        const i = x.indexOf(step);
        if (i === -1 || i < at) {
          e.push("S the trusted startup chain is missing or out of order at: " + step);
          break;
        }
        at = i;
      }
      // ONE of each. A second acquisition, lease or capability set is a second authority.
      for (const [name, re] of [
        ["acquisition", /acquire_service_runtime_authority\(/g],
        ["clock binding", /bind_production_clock\(/g],
        ["lease", /open_provider_authority\(/g],
        ["capability set", /into_provider_capabilities\(/g],
      ]) {
        const n = count(x, re);
        if (n !== 1) e.push("S the startup composition has " + n + " " + name + " sites; exactly 1 is allowed");
      }
      // NO FIXTURE ANYWHERE IN THE CHAIN.
      const prod = x.replace(/#\[cfg\(test\)\][\s\S]*$/, "");
      for (const bad of [
        "fixture_production_clock_binding_grant",
        "fixture_bind_production_clock",
        "synthetic_for_fixture",
        "for_local_proof",
        "FixtureMonotonicTickSource",
        "test-fixtures",
      ]) {
        if (prod.includes(bad)) e.push("S the trusted startup composition reaches a fixture: " + bad);
      }
      // The service graph enables the PRODUCTION features and never a fixture one.
      for (const feat of [
        "windows-authority-acquisition",
        "production-clock-binding",
        "production-clock-observation",
        "windows-live-clock",
        "production-runtime-observation",
        "windows-live-runtime-observation",
      ]) {
        if (!toml.includes(feat)) e.push("S the service graph does not enable " + feat);
      }
      if (/"test-fixtures"/.test(toml))
        e.push("S the installed service graph enables a fixture feature");

      // THE PER-CONNECTION CHAIN. A fresh verifier per connection, a fresh clock reading per
      // connection, and the transport capability issued by the REVIEW authority — not the status one.
      if (!/let transport = review\.issue_transport_capability\(\);/.test(sv))
        e.push("S the governed loop does not take its transport capability from the review authority");
      if (!/let now = runtime\.now\(\);/.test(sv))
        e.push("S the governed loop caches a clock reading instead of taking one per connection");
      if (!/runtime\.capabilities\(\)\.begin_connection\(\)/.test(sv))
        e.push("S the governed loop does not derive a fresh per-connection verifier");
      if (!/serve_one_governed_review_exchange\(/.test(sv))
        e.push("S the governed loop does not run the complete per-connection exchange");
      // The governed loop must not transcribe the owner status phrase.
      const loopAt = sv.indexOf("pub fn serve_governed_reviews_until_stop");
      if (loopAt !== -1 && sv.slice(loopAt).includes("OwnerStatusReadApproval"))
        e.push("S the governed loop transcribes the owner status-read approval");
    }

    // THE PER-CONNECTION TRUST CHAIN, in the live facade, in the ruling's order.
    const ffi = strip(read(HOST("windows-local-ipc", "src", "windows_ffi.rs")));
    const fn = ffi.slice(ffi.indexOf("pub fn serve_one_governed_review_exchange"));
    if (!fn) e.push("S the complete governed-review exchange facade is missing");
    else {
      const chain = [
        "prepare_server(",
        "accept_unauthenticated(",
        "complete_service_handshake_confirmed(",
        "send_installed_host_status(",
        "ClientPeerAdmissionAttempt::begin(",
        "admit_governed_client(",
        "reconcile_governed_client(",
        "observed_client_process()",
        "assemble_production_same_connection_evidence(",
        "bind_canonical_client_to_session_evidence(",
        "IpcSessionVerifier::verify(",
        "TrustedPeerContext::from_verified_peer_admission(",
        "serve_review_request(",
      ];
      let k = -1;
      for (const step of chain) {
        const i = fn.indexOf(step);
        if (i === -1 || i < k) {
          e.push("S the per-connection trust chain is missing or out of order at: " + step);
          break;
        }
        k = i;
      }
      // NO FIXTURE IN THE CHAIN.
      for (const bad of ["synthetic_for_fixture", "for_local_proof", "assemble_same_connection_ipc_peer_fixture"]) {
        if (fn.includes(bad)) e.push("S the per-connection chain reaches a fixture: " + bad);
      }
    }
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((m) => console.error("[val-projectos-host-review-path1b] FAIL: " + m));
    process.exit(1);
  }
  console.log("val-projectos-host-review-path1b: PASS");
}
