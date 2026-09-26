"use strict";
// RUN-TO-COMPLETION HOST ATTESTATION §10H — SERVICE-HOST ACTIVATION WIRING.
//
// Fails closed. Proves the running Host reaches its durable state through exactly ONE production
// route, and that the route is the whole chain:
//   H1 the activation module exists, is Windows-gated, and its three items are re-exported;
//   H2 the production route takes no argument and composes ONLY the approved Known Folder anchor and
//      the §10F verifier; the chain-taking helper is private; the held state has no public field;
//   H3 the chain runs in order - resolve, verify, activate, both handoffs, both opens - and every
//      link's refusal is propagated;
//   H4 the module's production code names no fixture, environment, argv, working directory or
//      literal path;
//   H5 across every production source under projectos/host, `ActivatedHostStateRoot::activate`, both
//      store-root handoffs and both store opens are reached ONLY from the activation module, and no
//      fixture acceptance or fixture store root is reached from production code at all;
//   H6 service-host calls the route exactly once, from service_main, BEFORE it reports Running or
//      starts serving, returns on refusal, and names no root, store, acceptance, fixture or ambient
//      input; it has no direct edge to the trusted-roots crate through which it could bypass it;
//   H7 a refused start is reported to the SCM as a service-specific error, with one distinct non-zero
//      code per refusal class and no wildcard arm.
//
// Comments are stripped before every scan. Test files, `tests` directories and `#[cfg(test)]` module
// blocks are excluded from the production scans; the block removal is brace-matched, so production
// code after a test block is still scanned.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");
const IPC_SRC = path.join(HOST, "windows-local-ipc", "src");
const MODULE = path.join(IPC_SRC, "host_state_activation.rs");
const SH = path.join(HOST, "service-host");
const SH_SRC = path.join(SH, "src");

const read = (p) => fs.readFileSync(p, "utf8").replace(/^﻿/, "");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");

// Remove every `#[cfg(test)] mod <name> { ... }` block, matching braces while skipping string and
// char literals, so a test block in the middle of a file cannot hide the production code after it.
function stripTestBlocks(src) {
  const opener = /#\[cfg\(test\)\]\s*mod\s+\w+\s*\{/g;
  let out = "";
  let from = 0;
  let m;
  while ((m = opener.exec(src)) !== null) {
    out += src.slice(from, m.index);
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '"') {
        i++;
        while (i < src.length && src[i] !== '"') i += src[i] === "\\" ? 2 : 1;
      } else if (c === "'" && /^'(\\.|[^\\'])'/.test(src.slice(i, i + 4))) {
        i += src[i + 1] === "\\" ? 3 : 2;
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      i++;
    }
    from = i;
    opener.lastIndex = i;
  }
  return out + src.slice(from);
}

const production = (p) => stripTestBlocks(stripComments(read(p)));

// Every production Rust source under projectos/host: `src` trees only, no `tests` directories, no
// `tests.rs` files, no build output.
function productionSources() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "target" || e.name === "tests") continue;
        walk(full);
      } else if (e.name.endsWith(".rs") && e.name !== "tests.rs") out.push(full);
    }
  };
  for (const c of fs.readdirSync(HOST, { withFileTypes: true })) {
    const src = path.join(HOST, c.name, "src");
    if (c.isDirectory() && fs.existsSync(src)) walk(src);
  }
  // PROJECTOS-HOST-REVIEW-PATH1B, CRITERION 21 — DECLARED AMENDMENT of the production file set.
  //   OLD: every `src/**/*.rs` except `tests.rs` counted as production.
  //   NEW: a whole-file test module compiled ONLY under a cfg(test)-gated `mod` declaration in its
  //        parent is excluded — but only after this validator PROVES the gate is present, so
  //        removing the gate re-admits the file to every scan below. Exactly one file qualifies.
  const gatedTestFiles = [
    {
      file: path.join(IPC_SRC, "owner_programme_delegation", "service_entry_tests.rs"),
      parent: path.join(IPC_SRC, "owner_programme_delegation.rs"),
      gate: /#\[cfg\(all\(test,\s*feature = "test-fixtures",\s*windows\)\)\]\s*mod service_entry_tests;/,
    },
  ];
  return out.filter((f) => {
    const gated = gatedTestFiles.find((g) => path.resolve(g.file) === path.resolve(f));
    if (!gated) return true;
    return !gated.gate.test(stripComments(read(gated.parent)));
  });
}

const count = (s, re) => (s.match(re) || []).length;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  // ---- H1 ----
  if (!fs.existsSync(MODULE)) return ["H1 the activation module is missing: " + rel(MODULE)];
  const lib = stripComments(read(path.join(IPC_SRC, "lib.rs")));
  if (!/#\[cfg\(windows\)\]\s*mod\s+host_state_activation\s*;/.test(lib))
    E("H1 the activation module is not declared private and Windows-gated in lib.rs");
  const reexport = /#\[cfg\(windows\)\]\s*pub use host_state_activation::\{([^}]*)\}/.exec(lib);
  if (!reexport) E("H1 the activation items are not re-exported under cfg(windows)");
  else
    for (const item of [
      "activate_installed_host_state",
      "ActivatedHostDurableState",
      "HostStateActivationRefusal",
    ])
      if (!new RegExp("\\b" + item + "\\b").test(reexport[1])) E("H1 not re-exported: " + item);

  // ---- H2 ----
  const mod = production(MODULE);
  const route =
    /pub fn activate_installed_host_state\(\s*\)\s*->\s*Result<ActivatedHostDurableState,\s*HostStateActivationRefusal>\s*\{([\s\S]*?)\n\}/.exec(
      mod,
    );
  if (!route) E("H2 the production route is missing or takes an argument");
  else if (
    !/^\s*activate\(\s*&ApprovedKnownFolderAnchor,\s*ProtectedInstallationBoundaryAcceptance::verify,?\s*\)\s*$/.test(
      route[1],
    )
  )
    E("H2 the production route composes something other than the approved anchor and the §10F verifier");
  if (!/\nfn activate<S: InstallationAnchorSource>\(/.test(mod))
    E("H2 the chain-taking helper is missing or not private");
  if (/pub(\s*\([^)]*\))?\s+fn\s+activate\s*[<(]/.test(mod))
    E("H2 the chain-taking helper is visible outside its module");
  {
    // PROJECTOS-HOST-REVIEW-PATH1B, CRITERION 21 — DECLARED AMENDMENT of the H2 route list.
    //   OLD: exactly {activate_installed_host_state, stores_for_composition, revalidate}.
    //   NEW: three more, each still resolving authority INSIDE this module so service-host names no
    //        root, store, acceptance or trusted-roots type:
    //        - activate_delegation: forwards to the crate's governed Active-lifecycle writer over
    //          the store THIS activation opened (whole authority = two owner signatures; the store's
    //          own lifecycle rules bound it);
    //        - host_state_root: read-only path exposure of the activated root, for deriving the
    //          fixed activation-input leaves; it opens nothing and carries no custody;
    //        - activate_governed_project_ledger_root: the §10D governed-project ledger root, chained
    //          resolve→verify→activate→handoff here rather than letting service-host compose roots.
    const allowed = [
      "activate_installed_host_state",
      "stores_for_composition",
      "revalidate",
      "activate_delegation",
      "host_state_root",
      "activate_governed_project_ledger_root",
    ];
    for (const m of mod.matchAll(/pub(?:\s*\([^)]*\))?\s+fn\s+(\w+)/g))
      if (!allowed.includes(m[1])) E("H2 the activation module exposes an unexpected route: " + m[1]);
    // The three new routes keep their bounds: the forward, the read-only path, the in-module chain.
    if (!/pub fn activate_delegation\(\s*&mut self,\s*record: &crate::SignedOwnerProgrammeDelegation,\s*attested: &projectos_host_identity::AttestedInstallationProgramme,\s*\)[\s\S]{0,220}crate::activate_owner_programme_delegation\(&mut self\.delegation, record, attested\)/.test(mod))
      E("H2 activate_delegation no longer forwards, whole, to the governed Active-lifecycle writer");
    if (!/pub fn host_state_root\(&self\) -> &std::path::Path \{\s*self\.root\.path\(\)\s*\}/.test(mod))
      E("H2 host_state_root is no longer a read-only path exposure");
    const ledgerRoute = /pub fn activate_governed_project_ledger_root\(([\s\S]*?)\n\}/.exec(mod);
    if (!ledgerRoute) E("H2 the governed ledger-root route is missing");
    else {
      const body = ledgerRoute[1];
      for (const step of [
        "TrustedHostStateRoot::resolve(&ApprovedKnownFolderAnchor)",
        "ProtectedInstallationBoundaryAcceptance::verify(&trusted_state)",
        "TrustedGovernedProjectRoot::resolve(&CanonicalProjectRegistry, project_id)",
        "ActivatedGovernedProjectRoot::activate(trusted_project, &accepted)",
        "HostOwnedGatekeeperProjectRoot::from_activated(&activated)",
      ])
        if (!body.includes(step)) E("H2 the governed ledger-root chain is missing: " + step);
    }
  }
  {
    const s = /pub struct ActivatedHostDurableState\s*\{([\s\S]*?)\n\}/.exec(mod);
    if (!s) E("H2 the activated state type is missing");
    else if (/\bpub\b/.test(s[1])) E("H2 the activated state has a public field");
    if (/impl\s+(Default|Clone|From<[^>]*>)\s+for\s+ActivatedHostDurableState/.test(mod))
      E("H2 the activated state gained a forgeable or duplicating impl");
    if (/#\[derive\([^)]*\b(Clone|Default)\b[^)]*\)\]\s*pub struct ActivatedHostDurableState/.test(mod))
      E("H2 the activated state derives Clone or Default");
  }

  // ---- H3 ----
  {
    const helper = /\nfn activate<S: InstallationAnchorSource>\([\s\S]*?\n\}/.exec(mod);
    const body = helper ? helper[0] : "";
    if (!body) E("H3 the chain body cannot be located");
    const steps = [
      "TrustedHostStateRoot::resolve(anchor)",
      "verify(&trusted)",
      "ActivatedHostStateRoot::activate(trusted, &accepted)",
      "HostOwnedDelegationStateRoot::from_activated(&root)",
      "HostOwnedRequestReplayRoot::from_activated(&root)",
      "DurableDelegationStateFileStore::open(&delegation_root)",
      "DurableRequestReplayFileStore::open(&replay_root)",
    ];
    let at = -1;
    for (const step of steps) {
      const i = body.indexOf(step);
      if (i === -1) {
        E("H3 the chain is missing a link: " + step);
        break;
      }
      if (i < at) {
        E("H3 the chain runs out of order at: " + step);
        break;
      }
      at = i;
    }
    for (const v of [
      "RootUnresolved",
      "BoundaryNotAccepted",
      "RootChangedAfterAcceptance",
      "DelegationStoreUnavailable",
      "ReplayStoreUnavailable",
    ])
      if (!new RegExp("map_err\\(HostStateActivationRefusal::" + v + "\\)\\?").test(body))
        E("H3 a link's refusal is not propagated: " + v);
  }

  // ---- H4 ----
  for (const [re, why] of [
    [/[Ff]ixture/, "a fixture"],
    [/std::env|\benv::|env!\(/, "the environment"],
    [/current_dir|args\(\)/, "the working directory or argv"],
    [/PathBuf::from|Path::new|PathBuf::new/, "a literal path"],
  ])
    if (re.test(mod)) E("H4 the activation module's production code names " + why);

  // ---- H5 ----
  {
    const onlyInModule = [
      "ActivatedHostStateRoot::activate(",
      "HostOwnedDelegationStateRoot::from_activated(",
      "HostOwnedRequestReplayRoot::from_activated(",
      "DurableDelegationStateFileStore::open(",
      "DurableRequestReplayFileStore::open(",
    ];
    const forbidden = [
      "ProtectedInstallationBoundaryAcceptance::fixture(",
      "HostOwnedDelegationStateRoot::fixture(",
      "HostOwnedRequestReplayRoot::fixture(",
      "HostOwnedGatekeeperProjectRoot::fixture(",
      "FixtureInstallationAnchor::new(",
    ];
    const totals = Object.fromEntries(onlyInModule.map((n) => [n, 0]));
    for (const f of productionSources()) {
      const code = production(f);
      for (const needle of onlyInModule) {
        const n = count(code, new RegExp(escape(needle), "g"));
        if (!n) continue;
        totals[needle] += n;
        if (path.resolve(f) !== path.resolve(MODULE))
          E("H5 " + rel(f) + " reaches " + needle + " outside the activation module");
      }
      for (const needle of forbidden)
        if (code.includes(needle)) E("H5 " + rel(f) + " reaches a fixture from production code: " + needle);
    }
    for (const needle of onlyInModule)
      if (totals[needle] !== 1)
        E("H5 " + needle + " has " + totals[needle] + " production call sites; exactly one is permitted");
  }

  // ---- H6 ----
  {
    const shFiles = fs.readdirSync(SH_SRC).filter((n) => n.endsWith(".rs"));
    let routeCalls = 0;
    let routeFile = null;
    let serviceCalls = 0;
    for (const n of shFiles) {
      const code = production(path.join(SH_SRC, n));
      for (const [re, why] of [
        [/ActivatedHostStateRoot|TrustedHostStateRoot|ProtectedInstallationBoundaryAcceptance/, "a root or acceptance type"],
        [/from_activated|FileStore::open|HostOwned\w+Root/, "a store root or store"],
        [/[Ff]ixture/, "a fixture"],
        [/std::env::(var|vars|var_os|args|args_os|current_dir|set_var)\b|\benv::args|env!\(|current_dir\(/, "an ambient input"],
      ])
        if (re.test(code)) E("H6 service-host/src/" + n + " names " + why);
      const r = count(code, /(?<!fn\s)activate_installed_host_state\(/g);
      if (r) {
        routeCalls += r;
        routeFile = n;
      }
      serviceCalls += count(code, /(?<!fn\s)activate_for_service\(\)/g);
    }
    if (routeCalls !== 1 || routeFile !== "host_state.rs")
      E("H6 service-host calls the activation route " + routeCalls + " times (must be once, from host_state.rs)");
    if (serviceCalls !== 1) E("H6 activate_for_service is called " + serviceCalls + " times (must be once)");

    const scm = production(path.join(SH_SRC, "scm.rs"));
    const svc = /extern "system" fn service_main\(([\s\S]*?)\n\}/.exec(scm);
    const body = svc ? svc[1] : "";
    if (!body) E("H6 service_main cannot be located");
    else {
      const iAct = body.indexOf("crate::host_state::activate_for_service()");
      const iRun = body.indexOf("lifecycle.running()");
      // PROJECTOS-HOST-REVIEW-PATH1B, CRITERION 21 — DECLARED AMENDMENT of the serving entry.
      //   OLD: service_main starts `serve_installed_host_status_until_stop` on a side thread.
      //   NEW: service_main calls the ONE dispatcher `serve_resolved_until_stop(&STOP, &mut
      //        host_state)`, which decides — once, from durable activation inputs alone — between
      //        the governed review loop and that same status loop, and falls back to the status
      //        loop on ANY unavailability. Ordering unchanged: activation still precedes Running
      //        and serving.
      const iServe = body.indexOf("crate::serve::serve_resolved_until_stop(&STOP_SIGNALLED, &mut host_state)");
      if (iAct === -1) E("H6 service_main does not activate the Host's durable state");
      else if (!(iRun > iAct && iServe > iAct))
        E("H6 the service reports Running or starts serving before its durable state is activated");
      const refusal =
        /match crate::host_state::activate_for_service\(\) \{\s*Ok\(state\) => state,\s*Err\(code\) => \{([\s\S]*?)\}\s*\};/.exec(
          body,
        );
      if (!refusal) E("H6 the activation outcome is not matched as Ok(state) / Err(code)");
      else {
        if (!/START_REFUSAL\.store\(code,/.test(refusal[1])) E("H6 a refusal is not recorded for the SCM");
        if (!/lifecycle\.stopped\(\)/.test(refusal[1])) E("H6 a refusal does not stop the service");
        if (!/return;\s*$/.test(refusal[1])) E("H6 a refusal does not return before serving");
      }
      if (!/drop\(host_state\);\s*let _ = lifecycle\.stopped\(\);\s*$/.test(body))
        E("H6 the durable state is not released before the final Stopped is published");
    }
    const shToml = read(path.join(SH, "Cargo.toml")).replace(/#.*/g, "");
    if (/projectos-host-trusted-roots\s*=/.test(shToml))
      E("H6 service-host depends on trusted-roots directly and could bypass the activation route");
  }

  // ---- H7 ----
  {
    const scm = production(path.join(SH_SRC, "scm.rs"));
    const publish = /fn publish\(&mut self, state: ServiceRunState\) -> bool \{([\s\S]*?)\n    \}/.exec(scm);
    if (!publish) E("H7 the SCM status publication cannot be located");
    else {
      if (!/START_REFUSAL\.load\(/.test(publish[1])) E("H7 the published status ignores a refused start");
      if (!/state == ServiceRunState::Stopped && refusal != 0/.test(publish[1]))
        E("H7 the refusal is not scoped to the final Stopped publication");
      if (!/ERROR_SERVICE_SPECIFIC_ERROR\.0,\s*refusal/.test(publish[1]))
        E("H7 a refused start is not reported as a service-specific error carrying its code");
      if (!/dwWin32ExitCode:\s*win32_exit/.test(publish[1]) || !/dwServiceSpecificExitCode:\s*specific_exit/.test(publish[1]))
        E("H7 the computed exit codes are not what is published");
    }
    const dispatcher = /pub fn run_under_scm\(\)([\s\S]*?)\n\}/.exec(scm);
    if (!dispatcher || !/START_REFUSAL\.load\([\s\S]{0,80}ScmError::HostStateRefused/.test(dispatcher[1]))
      E("H7 run_under_scm reports a refused start as success");

    const hs = production(path.join(SH_SRC, "host_state.rs"));
    const codes = [...hs.matchAll(/pub const (EXIT_\w+): u32 = (\d+);/g)];
    const values = codes.map((m) => Number(m[2]));
    if (values.some((v) => v === 0)) E("H7 a refusal code is zero, which the SCM reads as a clean stop");
    if (new Set(values).size !== values.length) E("H7 two refusal classes share a code");
    const variants = [
      ...(/pub enum HostStateActivationRefusal \{([\s\S]*?)\n\}/.exec(mod) || ["", ""])[1].matchAll(/^\s*(\w+)\(/gm),
    ].map((m) => m[1]);
    if (variants.length === 0) E("H7 the refusal classes cannot be read");
    const mapper = /pub fn service_exit_code\([^)]*\) -> u32 \{([\s\S]*?)\n\}/.exec(hs);
    if (!mapper) E("H7 the refusal-to-code mapping is missing");
    else {
      if (/\b_\s*=>/.test(mapper[1])) E("H7 the refusal-to-code mapping has a wildcard arm");
      for (const v of variants)
        if (!new RegExp("HostStateActivationRefusal::" + v + "\\(_\\)\\s*=>\\s*\\{?\\s*EXIT_\\w+").test(mapper[1]))
          E("H7 refusal class " + v + " is not mapped to its own code");
      if (codes.length !== variants.length)
        E("H7 " + codes.length + " codes for " + variants.length + " refusal classes");
    }
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-host-state-activation-wiring-10h] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-host-state-activation-wiring-10h: PASS");
}
