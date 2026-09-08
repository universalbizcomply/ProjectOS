"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-D-E-C-CAPABILITY-B3 — boundary for the bounded Windows
// local named-pipe TRANSPORT. Proves: exact identity, publish=false, empty default features, an explicit
// `windows-live-ipc` feature gating dep:windows + host-authority/test-fixtures, a MINIMUM feature-gated
// windows dependency, a dependency on host-authority, no [[bin]], no Control Center dep; unsafe + windows
// FFI CONFINED to windows_ffi.rs; NO SCM / service / token / SID-lookup / registry / process / network
// API anywhere; fixed test endpoint prefix plus EXACTLY ONE fixed production endpoint
// (\\.\pipe\ProjectOS.Host — PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A amendment) and no arbitrary
// public endpoint; first-instance + remote
// refusal + message mode + single instance + bounded buffers; consumes host-authority's OPAQUE
// pipe-security (no SID/SDDL input, no local ACL builder / SID resolver, unresolved fails closed); fixed
// protocol version + closed message kinds + fixed-size nonce + replay/stale refusal + bounded framing;
// bounded timeouts + cancellation + residue classification; no live op in tests; sealed capability with
// no constructor; IPC alone cannot confirm; execution readiness false. Comments stripped; structural.
const fs = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-local-ipc");
const SRC = path.join(CRATE, "src");
const FFI = "windows_ffi.rs"; // the ONLY file permitted unsafe + windows FFI

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
function rsFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "target") continue;
        walk(full);
      } else if (e.name.endsWith(".rs")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// APIs forbidden ANYWHERE in the crate (including windows_ffi.rs). The transport needs none of these.
const FORBIDDEN_ANY = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /OpenSCManager|CreateServiceW?|OpenServiceW?|ChangeServiceConfig|StartServiceW?|QueryServiceStatus/, why: "SCM/service API" },
  { re: /OpenProcessToken|GetTokenInformation|LookupAccountName|ConvertSidToStringSid|ConvertStringSidToSid/, why: "token/SID-lookup API" },
  { re: /RegCreateKey|RegSetValue|RegOpenKey/, why: "registry API" },
  { re: /CreateProcess|ShellExecute|TerminateProcess|std::process::Command|Command::new/, why: "process launch/termination" },
  { re: /SetSecurityInfo|SetNamedSecurityInfo|InitializeAcl|AddAccessAllowedAce|ConvertStringSecurityDescriptor/, why: "ACL/SDDL builder" },
  { re: /TcpStream|TcpListener|std::net::|reqwest|hyper::/, why: "network API" },
  { re: /control-center/, why: "control-center reference" },
];
// Windows FFI markers permitted ONLY in windows_ffi.rs.
const WINDOWS_FFI = /use\s+windows(::|\s|;)|windows::Win32|windows_sys|CreateNamedPipeW|ConnectNamedPipe|CreateFileW|\bHANDLE\b|CloseHandle|OVERLAPPED/;
// Public raw endpoint fields the API must not expose.
const RAW_ENDPOINT_FIELD = /pub\s+\w+\s*:\s*(String|OsString|PathBuf|Vec<\s*u8\s*>)/;

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["windows-local-ipc crate missing: " + CRATE];

  // 1. Manifest.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-windows-local-ipc"/.test(toml)) errors.push("wrong package name");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("not publish=false");
  if (!/unsafe_code\s*=\s*"deny"/.test(toml)) errors.push("crate does not deny unsafe at the lint level");
  if (/^\s*\[\[bin\]\]/m.test(toml)) errors.push("has a binary target");
  if (!/windows-live-ipc\s*=\s*\[[^\]]*"dep:windows"[^\]]*\]/.test(toml)) errors.push("no windows-live-ipc feature gating dep:windows");
  // The normal live feature edge consumes the NON-fixture runtime feature — never host-authority test fixtures.
  if (!/windows-live-ipc\s*=\s*\[[^\]]*"projectos-host-authority\/windows-pipe-security-runtime"[^\]]*\]/.test(toml))
    errors.push("windows-live-ipc feature does not enable host-authority/windows-pipe-security-runtime");
  if (/"projectos-host-authority\/test-fixtures"/.test(toml))
    errors.push("windows-live-ipc must NOT enable host-authority/test-fixtures");
  if (/^\s*default\s*=/m.test(toml)) errors.push("declares non-empty default features");
  if (!/\[target\.'cfg\(windows\)'\.dependencies\]/.test(toml)) errors.push("windows dep not cfg(windows)-scoped");
  if (!/windows\s*=\s*\{[^}]*optional\s*=\s*true/.test(toml)) errors.push("windows dep not optional");
  // Dependency direction: service-identity-proof + host-authority only.
  const depBody = (stripComments(toml).split(/^\[dependencies\]/m)[1] || "").split(/\n\[/)[0];
  const deps = (depBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((s) => s.replace(/\s*=$/, "").trim());
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - AUTHORITY REACHABILITY, gate-authorised):
  // `projectos-host-identity` joins the closed list for ONE reason - the durable owner programme
  // delegation must be verified against the SAME embedded owner anchor the packaged trust manifest
  // uses. Re-embedding the anchor or writing a second ES256 verifier here was the alternative, and a
  // second opinion about what a valid owner signature is would be far worse than one more edge. The
  // list stays closed: nothing else may be added without a further ruling, and that crate exposes no
  // signing counterpart to import.
  //
  // THE EDGE HAS A TRANSITIVE COST, recorded here rather than discovered later: on a Windows target
  // `projectos-host-identity` links the `windows` crate, so this crate's DEFAULT build now pulls it
  // transitively where it previously pulled none.
  //
  // AND SOME OF IT RUNS. `verify_against_embedded_anchor` performs a bounded BCrypt ECDSA-P256
  // verification inside `host-identity` whenever a delegation is checked - so "nothing calls it"
  // would be false, and is not said. The two accurate statements are: the Authenticode /
  // WinVerifyTrust surface that edge also links is never reached, and no Windows call is added to
  // THIS crate's own sources outside the feature-gated `windows_ffi.rs` - which the scan below still
  // enforces. The Cargo.toml carries the same wording, so the crate claims no property it lost.
  //
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - §9B HOST-RESOLVED BINDING AUTHORITY,
  // gate-authorised, Option A): `sha2` joins the closed list for ONE reason - §9B computes one
  // deterministic SHA-256 digest over fixed-width, Host-resolved request-binding bytes, and that
  // exact algorithm is the only thing the crate uses it for. There is no generic or pluggable
  // crypto abstraction behind it; it has no network, process, credential, ACL or service effect;
  // it adds no Windows FFI to this crate (the unsafe scan below is unchanged); and it introduces no
  // signing or private-key capability. Same crate and version core and host-identity already pull,
  // so the lock graph gains an edge, not a package. The list remains CLOSED after this amendment:
  // nothing else may be added without a further ruling.
  //
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - §10B DURABLE DELEGATION STATE,
  // gate-authorised): `projectos-host-persistence` and
  // `projectos-host-windows-durable-protected-store` join the closed list for ONE reason - the
  // sealed `DurableDelegationStateStore` can only be implemented INSIDE this crate (its sealing
  // supertrait is private to the delegation module), so the real restart-safe lifecycle store has no
  // other home, and the alternative was writing a SECOND persistence framework here: another journal
  // state machine, another integrity framing, another atomic-replacement primitive, another lock.
  // Reusing the two accepted crates ProjectOS already reviewed is strictly the smaller change.
  //
  // THE EDGES HAVE A TRANSITIVE COST, recorded here rather than discovered later: the durable-store
  // crate confines `unsafe` to its own `windows_fs.rs` and really does call Win32 (LockFileEx,
  // MoveFileExW, FlushFileBuffers) whenever a store is opened or written, so this crate's default
  // build now reaches real filesystem primitives through it. What stays true, and the scan below
  // still enforces it: no `unsafe` and no Windows call is added to THIS crate's own sources outside
  // the feature-gated `windows_ffi.rs`, and neither edge adds a network, process, registry, SCM,
  // ACL-builder, credential or signing surface.
  //
  // The list remains CLOSED after this amendment: nothing else may be added without a further
  // ruling. RATIFIED at the §10B landing gate for EXACTLY these two crates and no others.
  //
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - §10D CANONICAL BUDGET ADAPTER):
  // ***PROPOSED - AWAITING CHATGPT RATIFICATION AT THE §10D GATE. NOT gate-authorised.***
  //
  // `projectos-host-gatekeeper-ledger` joins the closed list for ONE reason - the sealed
  // `CanonicalBudgetLedger` can only be implemented INSIDE this crate (its sealing supertrait is
  // private to the composition module), so the production budget adapter has no other home; and what
  // that adapter must NOT become is a SECOND source of spend truth. The way to stop it becoming one
  // is to put the canonical transaction - take `.projectops/gatekeeper-ledger.lock`, read
  // `.projectops/gatekeeper-ledger.json` fresh, apply the canonical policy, write the canonical
  // entry, unlock - in one small crate that does nothing else and is proven against the REAL
  // compiled TypeScript implementation of the same protocol. Writing that transaction inline here
  // would have put a filesystem ledger inside the IPC contract crate with no such proof.
  //
  // WHY IT IS NOT A SUBPROCESS INSTEAD. The obvious alternative - have the Host run the canonical
  // TypeScript through Node - is forbidden by this very validator (`std::process::Command` is on the
  // FORBIDDEN_ANY list below, and rightly), needs an installation-fixed Node identity that does not
  // exist, and could only ever return a REPORT of a transaction rather than take a decision. The
  // file, the lock and the schema are what the two implementations share.
  //
  // THE TRANSITIVE COST, recorded rather than discovered later: the new edge links `serde` and
  // `serde_json`, both already in this crate's lock graph through `projectos-host-persistence`, and
  // `std::fs`. It adds NO `unsafe`, NO Windows API call, NO network, NO process launch, NO registry,
  // NO SCM, NO ACL builder, NO credential and NO signing surface, and the scan below still enforces
  // every one of those for THIS crate's own sources.
  //
  // AND THE CLAIM IS CHECKED RATHER THAN ASSERTED — see the gatekeeper-ledger scan below. The ECC
  // code review for §10D pointed out that this amendment stated the new crate adds no process,
  // network, registry, SCM or ACL surface while nothing mechanically confirmed it: this validator's
  // capability scan walks `windows-local-ipc/src` only, so the sibling crate was outside every
  // automated check reachable from here. A future change to it could have added a forbidden
  // capability with nothing to catch it. It is now scanned with the same rules.
  //
  // AMENDMENT, §10E - THE TRUSTED HOST ROOTS.
  //
  // The three root capabilities this crate owns - HostOwnedDelegationStateRoot (§10B),
  // HostOwnedRequestReplayRoot (§10C) and HostOwnedGatekeeperProjectRoot (§10D) - each shipped with
  // NO production mint, because resolving a real root is installation composition. This edge IS that
  // composition. It is a SEPARATE crate rather than more code here because the resolution needs the
  // approved Known Folder resolver, the accepted handle-owned custody primitive and the canonical
  // installed-project registry, none of which belong in an IPC transport - and because the three
  // root types have private fields, so their production constructors must live HERE and take an
  // already-sealed value from THERE.
  //
  // IT GRANTS NO ACTIVATION. Those constructors require an ACTIVATED root, and the production mint
  // of the boundary acceptance that produces one is absent until the ProgramData ACL boundary is
  // accepted. The stores still fail closed - one level further along.
  //
  // THE TRANSITIVE COST, recorded rather than discovered later: `projectos-project-registry`
  // (serde/serde_json, already in this graph through `projectos-host-persistence`),
  // `projectos-host-windows-root-custody` (windows-sys, for a read-only CreateFileW +
  // GetFileInformationByHandleEx + GetFinalPathNameByHandleW handle open) and, on Windows,
  // `projectos-windows-runtime-primitives` (the `windows` crate's Win32_UI_Shell / Win32_System_Com,
  // for one read-only SHGetKnownFolderPath call). `projectos-host-identity` is already a dependency
  // and is reused rather than added. NO network, process launch, registry, SCM, ACL builder,
  // credential or signing surface is added.
  //
  // AND THE CLAIM IS CHECKED RATHER THAN ASSERTED - see the trusted-roots scan below, which applies
  // this crate's own FORBIDDEN_ANY set, its unsafe prohibition and an ambient-input prohibition to
  // the new crate's sources. That is the §10D lesson applied at the point it was learned.
  //
  // PROPOSED, §10E - AWAITING RATIFICATION AT THE §10E GATE, exactly as the §10D edge was.
  //
  // The list remains CLOSED after this amendment: nothing else may be added without a further ruling.
  for (const d of deps) {
    if (![
      "projectos-host-windows-service-identity-proof",
      "projectos-host-authority",
      "projectos-host-core",
      "projectos-host-identity",
      "sha2",
      "projectos-host-persistence",
      "projectos-host-windows-durable-protected-store",
      // PROPOSED, §10D - see the amendment note above. Not yet ratified.
      "projectos-host-gatekeeper-ledger",
      // PROPOSED, §10E - see the amendment note above. Not yet ratified.
      "projectos-host-trusted-roots",
    ].includes(d))
      errors.push("unexpected dependency: " + d);
  }
  if (!deps.includes("projectos-host-authority")) errors.push("missing host-authority dependency");
  if (!fs.existsSync(path.join(CRATE, "Cargo.lock"))) errors.push("missing Cargo.lock");

  // 2. Unsafe + windows-FFI confinement + forbidden APIs anywhere.
  for (const f of rsFiles(SRC)) {
    const base = path.basename(f);
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    const code = stripComments(read(f));
    if (/unsafe\s*(fn|\{)/.test(code) && base !== FFI) errors.push(rel + ": unsafe outside windows_ffi.rs");
    if (WINDOWS_FFI.test(code) && base !== FFI) errors.push(rel + ": windows FFI outside windows_ffi.rs");
    for (const { re, why } of FORBIDDEN_ANY) if (re.test(code)) errors.push(rel + ": " + why);
    if (RAW_ENDPOINT_FIELD.test(code)) errors.push(rel + ": public raw endpoint/byte field");
  }

  // 2b. THE §10D CANONICAL LEDGER CRATE, scanned with THIS crate's rules.
  //
  // PROPOSED - AWAITING CHATGPT RATIFICATION AT THE §10D GATE, with the dependency amendment above.
  //
  // It is a dependency of this crate and it performs the Host's budget transaction, so the
  // capability claims made for it are this contract's business. The rules applied are the same
  // FORBIDDEN_ANY set and the same unsafe prohibition; the difference is that this crate confines
  // unsafe to windows_ffi.rs, while the ledger crate is permitted NONE at all and says so at the
  // crate level.
  const LEDGER_CRATE = path.join(ROOT, "projectos", "host", "gatekeeper-ledger");
  if (!fs.existsSync(LEDGER_CRATE)) {
    errors.push("gatekeeper-ledger crate missing: " + LEDGER_CRATE);
  } else {
    const ledgerToml = read(path.join(LEDGER_CRATE, "Cargo.toml"));
    if (!/name\s*=\s*"projectos-host-gatekeeper-ledger"/.test(ledgerToml))
      errors.push("gatekeeper-ledger: wrong package name");
    if (!/publish\s*=\s*false/.test(ledgerToml)) errors.push("gatekeeper-ledger: not publish=false");
    if (!/unsafe_code\s*=\s*"forbid"/.test(ledgerToml))
      errors.push("gatekeeper-ledger: crate does not forbid unsafe at the lint level");
    if (/^\s*\[\[bin\]\]/m.test(ledgerToml)) errors.push("gatekeeper-ledger: has a binary target");
    // ITS OWN DEPENDENCY LIST IS CLOSED TOO. The transaction needs a JSON reader and nothing else;
    // anything further would be a capability arriving in this crate's graph by the back door.
    const ledgerDepBody = (stripComments(ledgerToml).split(/^\[dependencies\]/m)[1] || "")
      .split(/^\[/m)[0];
    const ledgerDeps = (ledgerDepBody.match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map((d) =>
      d.replace(/\s*=$/, "").trim(),
    );
    for (const d of ledgerDeps) {
      if (!["serde", "serde_json"].includes(d))
        errors.push("gatekeeper-ledger: unexpected dependency: " + d);
    }
    const ledgerSrc = path.join(LEDGER_CRATE, "src");
    for (const f of rsFiles(ledgerSrc)) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      const code = stripComments(read(f));
      if (/unsafe\s*(fn|\{)/.test(code)) errors.push(rel + ": unsafe in a crate that forbids it");
      if (WINDOWS_FFI.test(code)) errors.push(rel + ": windows FFI in the canonical ledger crate");
      for (const { re, why } of FORBIDDEN_ANY) if (re.test(code)) errors.push(rel + ": " + why);
      // NO AMBIENT INPUT MAY DECIDE WHICH LEDGER IS AUTHORITATIVE. The root arrives as an argument
      // from a Host-owned seam; a working directory or an environment variable would be a second,
      // forgeable answer to the only question that matters here.
      if (/std::env::(var|current_dir)|env!\(/.test(code))
        errors.push(rel + ": environment or working-directory input");
    }
  }

  // 2c. THE §10E TRUSTED-ROOTS CRATE, scanned with THIS crate's rules.
  //
  // PROPOSED - AWAITING RATIFICATION AT THE §10E GATE, with the dependency amendment above.
  //
  // It is a dependency of this crate and it decides WHICH DIRECTORY the Host's durable security state
  // and the canonical budget ledger live in, so the capability claims made for it are this contract's
  // business. The rules applied are the same FORBIDDEN_ANY set and the same ambient-input prohibition
  // the ledger crate is held to; the difference is that this crate confines unsafe to windows_ffi.rs,
  // while the trusted-roots crate is permitted NONE at all and says so at the crate level. Its
  // Windows work is done ENTIRELY by the accepted custody and known-folder primitives, so a
  // `use windows::` or `windows_sys` line in its own sources would mean it had started doing FFI of
  // its own.
  const ROOTS_CRATE = path.join(ROOT, "projectos", "host", "trusted-roots");
  if (!fs.existsSync(ROOTS_CRATE)) {
    errors.push("trusted-roots crate missing: " + ROOTS_CRATE);
  } else {
    const rootsToml = read(path.join(ROOTS_CRATE, "Cargo.toml"));
    if (!/name\s*=\s*"projectos-host-trusted-roots"/.test(rootsToml))
      errors.push("trusted-roots: wrong package name");
    if (!/publish\s*=\s*false/.test(rootsToml)) errors.push("trusted-roots: not publish=false");
    if (!/unsafe_code\s*=\s*"forbid"/.test(rootsToml))
      errors.push("trusted-roots: crate does not forbid unsafe at the lint level");
    if (/^\s*\[\[bin\]\]/m.test(rootsToml)) errors.push("trusted-roots: has a binary target");
    // THE FIXTURE GRAPH IS EXPLICIT AND NON-DEFAULT. A default feature list that enabled it would put
    // a disposable anchor and an arbitrary registry document into every shipped build.
    if (!/^test-fixtures\s*=\s*\[/m.test(rootsToml))
      errors.push("trusted-roots: no explicit test-fixtures feature is declared");
    if (/^\s*default\s*=\s*\[/m.test(rootsToml))
      errors.push("trusted-roots: declares a default feature list");
    // ITS OWN RUNTIME DEPENDENCY LIST IS CLOSED. `[dev-dependencies]` is excluded deliberately: a dev
    // dependency is in no consumer's graph, and the frozen-plan agreement proof needs one.
    const rootsDepBody = (stripComments(rootsToml).split(/^\[dependencies\]/m)[1] || "").split(
      /^\[/m,
    )[0];
    const rootsTargetBody = (
      stripComments(rootsToml).split(/^\[target\.'cfg\(windows\)'\.dependencies\]/m)[1] || ""
    ).split(/^\[/m)[0];
    const rootsDeps = ((rootsDepBody + rootsTargetBody).match(/^\s*([a-z0-9_-]+)\s*=/gim) || []).map(
      (d) => d.replace(/\s*=$/, "").trim(),
    );
    for (const d of rootsDeps) {
      if (
        ![
          "projectos-host-identity",
          "projectos-project-registry",
          "projectos-host-windows-root-custody",
          // PROPOSED, §10F - see the §10F amendment note in section 2d. Not yet ratified.
          //
          // §10E froze this list WITHOUT an ACL edge, deliberately: §10E resolved roots and was not
          // permitted to accept a boundary, so an ACL surface in the Host's runtime graph would have
          // been a capability it could not use. §10F is the phase that accepts the boundary, and the
          // acceptance is worth nothing unless the policy the Host VERIFIES is the same policy the
          // installer APPLIES. Depending on the accepted verifier and on the frozen plan is what
          // makes those one object rather than two spellings free to drift apart.
          "projectos-host-windows-acl-policy",
          "projectos-host-windows-activation-plan",
          "projectos-windows-runtime-primitives",
        ].includes(d)
      )
        errors.push("trusted-roots: unexpected dependency: " + d);
    }
    // ...AND THE §10F EDGES ARE REQUIRED, not merely tolerated. Their absence would mean the mint had
    // stopped consulting Windows, or had started restating the policy locally.
    for (const required of [
      "projectos-host-windows-acl-policy",
      "projectos-host-windows-activation-plan",
    ])
      if (!rootsDeps.includes(required))
        errors.push("trusted-roots: missing §10F dependency: " + required);
    const rootsSrc = path.join(ROOTS_CRATE, "src");
    let sawFixtureGate = false;
    for (const f of rsFiles(rootsSrc)) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      const code = stripComments(read(f));
      if (/unsafe\s*(fn|\{)/.test(code)) errors.push(rel + ": unsafe in a crate that forbids it");
      if (WINDOWS_FFI.test(code)) errors.push(rel + ": windows FFI in the trusted-roots crate");
      for (const { re, why } of FORBIDDEN_ANY) if (re.test(code)) errors.push(rel + ": " + why);
      // NO AMBIENT INPUT MAY DECIDE WHICH ROOT IS AUTHORITATIVE. An environment variable, the working
      // directory, argv and a compile-time environment value are exactly the forgeable answers to the
      // only question this crate exists to answer. `std::env::temp_dir` is not one of them and
      // appears only in the tests beside the sources.
      if (/std::env::(var|set_var|remove_var|current_dir|args)\b|env!\(/.test(code))
        errors.push(rel + ": environment, argv or working-directory input");
      // EVERY FIXTURE ITEM IS GATED. A fixture source, or the fixture boundary acceptance, reachable
      // from a default build would hand a caller the path authority the whole crate denies.
      const lines = code.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/\bpub\s+(fn|struct)\s+\w*[Ff]ixture/.test(line)) return;
        const window = lines.slice(Math.max(0, i - 6), i).join("\n");
        if (!/#\[cfg\(any\(test,\s*feature\s*=\s*"test-fixtures"\)\)\]/.test(window))
          errors.push(rel + ": an ungated fixture item at line " + (i + 1));
        else sawFixtureGate = true;
      });
    }
    if (!sawFixtureGate)
      errors.push("trusted-roots: no gated fixture item found (the scan matched nothing)");
    // NO PATH-TAKING PUBLIC CONSTRUCTOR ON EITHER TRUSTED ROOT, in any graph.
    for (const [file, ty] of [
      ["host_state.rs", "TrustedHostStateRoot"],
      ["governed_project.rs", "TrustedGovernedProjectRoot"],
    ]) {
      const code = stripComments(read(path.join(rootsSrc, file)));
      if (/pub\s+fn\s+\w+\s*\([^)]*:\s*&(?:std::path::)?Path\b/.test(code))
        errors.push(ty + ": a public constructor or method takes a caller-supplied path");
    }
    // THE ACTIVATION MODULE STILL HAS NO PRODUCTION MINT OF ITS OWN. §10F adds exactly one, and it
    // lives in `activation/boundary.rs` beside the verification sequence - a DESCENDANT of `activation`,
    // which is what lets `mint()` be visible to it and to nothing else. `activation.rs` itself must
    // continue to expose nothing but the gated fixture.
    const activation = stripComments(read(path.join(rootsSrc, "activation.rs")));
    const acceptImpl = (activation.match(
      /impl ProtectedInstallationBoundaryAcceptance \{[\s\S]*?\n\}/,
    ) || [""])[0];
    const mints = (acceptImpl.match(/pub\s+fn\s+\w+/g) || []).map((m) => m.trim());
    if (mints.length !== 1 || !/pub\s+fn\s+fixture/.test(mints[0]))
      errors.push("activation.rs exposes a mint other than the gated fixture: " + mints.join(", "));
    if (!/#\[cfg\(any\(test,\s*feature\s*=\s*"test-fixtures"\)\)\]/.test(acceptImpl))
      errors.push("the protected-boundary acceptance fixture mint is not feature-gated");
    // THE SEAL IS CONSTRUCTED IN EXACTLY ONE PLACE, AND `mint()` IS CALLED FROM EXACTLY TWO.
    //
    // The construction count alone was not enough, and the gap is worth naming. `mint()` is
    // `pub(in crate::activation)`, so the compiler already refuses a call from a sibling module -
    // but it does NOT refuse a second call added inside `activation.rs` or `boundary.rs` themselves,
    // and such a call would mint an acceptance without resolving a SID, composing a policy or
    // reading a descriptor. The two legitimate call sites are the gated fixture and the mint.
    if ((activation.match(/Self\s*\{\s*_seal:\s*Seal\s*\}/g) || []).length !== 1)
      errors.push("the boundary acceptance seal is not constructed in exactly one place");
    if (!/pub\(in crate::activation\)\s+fn\s+mint\s*\(/.test(activation))
      errors.push("mint() is not restricted to `pub(in crate::activation)`");
    {
      let mintCalls = 0;
      for (const f of rsFiles(rootsSrc)) {
        const rel = path.relative(ROOT, f).replace(/\\/g, "/");
        const hits = (stripComments(read(f)).match(/(?:Self|ProtectedInstallationBoundaryAcceptance)::mint\s*\(/g) || [])
          .length;
        if (!hits) continue;
        mintCalls += hits;
        if (!/\/activation\.rs$|\/activation\/boundary\.rs$/.test(rel))
          errors.push(rel + ": calls mint() outside activation.rs and activation/boundary.rs");
      }
      if (mintCalls !== 2)
        errors.push("mint() has " + mintCalls + " call sites; exactly two are permitted (the gated fixture and the mint)");
    }

    // 2d. THE §10F PRODUCTION MINT.
    //
    // PROPOSED - AWAITING RATIFICATION AT THE §10F GATE, with the dependency amendment above.
    //
    // §10E's rule here was "there must be NO production mint", and that rule was right for §10E.
    // Inverting it IS §10F, so the replacement has to be at least as specific as what it replaces:
    // not "a mint exists" - which any bool-returning stub satisfies - but a mint whose SHAPE forbids
    // the ways acceptance could be faked.
    const BOUNDARY = path.join(rootsSrc, "activation", "boundary.rs");
    if (!fs.existsSync(BOUNDARY)) {
      errors.push("trusted-roots: the §10F boundary module is missing");
    } else {
      const boundary = stripComments(read(BOUNDARY));
      // ONE MINT, TAKING A SEALED ROOT AND NOTHING ELSE. A second parameter is how a caller would
      // supply the policy, the path or the verdict that judges the boundary.
      if (
        !/pub\s+fn\s+verify\s*\(\s*root:\s*&TrustedHostStateRoot\s*\)\s*->\s*Result<Self,\s*BoundaryRefusal>/.test(
          boundary,
        )
      )
        errors.push(
          "the §10F mint is not `verify(root: &TrustedHostStateRoot) -> Result<Self, BoundaryRefusal>`",
        );
      const boundaryPubFns = (boundary.match(/pub\s+fn\s+\w+/g) || []).map((m) => m.trim());
      if (boundaryPubFns.length !== 1 || boundaryPubFns[0] !== "pub fn verify")
        errors.push(
          "boundary.rs exposes a route other than the single mint: " + boundaryPubFns.join(", "),
        );
      // THE POLICY IS THE ACCEPTED ONE, COMPOSED HERE - never restated, never caller-chosen.
      if (!/AclCompositionPlan::production\(\)/.test(boundary))
        errors.push("the mint does not compose the frozen production ACL plan");
      if (!/ServiceIdentityStrategy::VirtualServiceAccount/.test(boundary))
        errors.push("the mint does not bind the owner-decided service identity strategy");
      if (!/resolve_account_sid\(/.test(boundary))
        errors.push("the mint does not resolve the service SID authoritatively");
      if (!/from_resolved_sid\(/.test(boundary))
        errors.push("the mint binds a guessed principal instead of a RESOLVED sid");
      if (/AclPolicy::strict\(|AclPolicy\s*\{/.test(boundary))
        errors.push("the mint states an ACL policy of its own instead of composing the accepted one");
      // IT IS A VERIFIER, AND THE ROOT IS RECHECKED ON BOTH SIDES OF THE OBSERVATION.
      if (!/verify_directory\(/.test(boundary))
        errors.push("the mint does not perform an authoritative descriptor verification");
      if ((boundary.match(/root\.revalidate\(\)/g) || []).length < 2)
        errors.push("the mint does not revalidate the root on both sides of the observation");
    }
    // A MINT THAT COULD REPAIR THE BOUNDARY COULD ALSO CREATE THE STATE IT THEN ACCEPTS. No ACL
    // mutation entry point may be reachable from ANY source in this crate.
    for (const f of rsFiles(rootsSrc)) {
      const rel = path.relative(ROOT, f).replace(/\\/g, "/");
      const code = stripComments(read(f));
      if (/apply_directory_policy\(|apply_file_policy\(|apply_and_verify(_file)?\(/.test(code))
        errors.push(rel + ": an ACL mutation entry point is reachable from the trusted-roots crate");
    }
  }

  // 3. windows_ffi.rs: gated, unsafe-allowed, correct pipe configuration, opaque-lease consumption.
  const ffiPath = path.join(SRC, FFI);
  if (!fs.existsSync(ffiPath)) {
    errors.push("windows_ffi.rs missing");
  } else {
    const ffi = read(ffiPath);
    if (!/#!\[cfg\(all\(windows,\s*feature\s*=\s*"windows-live-ipc"\)\)\]/.test(ffi))
      errors.push("windows_ffi.rs is not gated to (windows + windows-live-ipc)");
    if (!/#!\[allow\(unsafe_code\)\]/.test(ffi)) errors.push("windows_ffi.rs does not locally allow unsafe");
    if (!/ProjectOS\.Test\.ServiceIdentityProof\./.test(ffi)) errors.push("fixed test endpoint prefix missing");
    // AMENDMENT (PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A, owner-authorised): B3 froze a
    // test-namespace-only endpoint rule. The evolved contract permits EXACTLY TWO endpoint families:
    // the retained run-scoped test prefix above, and ONE fixed production endpoint constant,
    // \\.\pipe\ProjectOS.Host, selected ONLY by the frozen installed-host run identifier — never by a
    // caller-supplied name. Everything else stays forbidden.
    if (!/const PRODUCTION_ENDPOINT: &str = r"\\\\\.\\pipe\\ProjectOS\.Host";/.test(ffi))
      errors.push("the single fixed production endpoint constant is missing");
    if (/ProjectOS\.HostAuthority\.v1/.test(ffi)) errors.push("the authority object name leaked into the transport");
    {
      const ffiNoComments = stripComments(ffi);
      // Every pipe-name token must be the production name or the run-scoped test prefix.
      const names = ffiNoComments.match(/pipe\\ProjectOS\.[A-Za-z][A-Za-z0-9.]*/g) || [];
      for (const n of names) {
        if (n !== "pipe\\ProjectOS.Host" && !n.startsWith("pipe\\ProjectOS.Test.ServiceIdentityProof"))
          errors.push("an alternate endpoint name is present: " + n);
      }
      if (!names.includes("pipe\\ProjectOS.Host"))
        errors.push("the production endpoint name is absent from the transport code");
      // The production binding is DERIVED from the frozen run identifier inside the constructor —
      // no caller-selectable endpoint, no second production family.
      if (!/run_id == crate::protocol::INSTALLED_HOST_STATUS_RUN_ID[\s\S]{0,200}?EndpointBinding::Production/.test(ffiNoComments))
        errors.push("the production binding is not derived from the frozen installed-host run identifier");
      if (!/EndpointBinding::TestProof/.test(ffiNoComments))
        errors.push("the test-namespace binding was removed (must be retained)");
      // The production endpoint uses the FOUR-PRINCIPAL production security; the proof namespace keeps
      // the accepted proof descriptor. Both fail closed with no weaker fallback.
      if (!/EndpointBinding::Production\s*=>\s*ProjectOsHostPipeSecurity::resolve_production\(\)/.test(ffiNoComments))
        errors.push("the production endpoint does not demand the production (configured-owner) security");
      if (!/EndpointBinding::TestProof\s*=>\s*ProjectOsHostPipeSecurity::resolve\(\)/.test(ffiNoComments))
        errors.push("the proof namespace no longer uses the accepted proof security");
    }
    if (!/FILE_FLAG_FIRST_PIPE_INSTANCE/.test(ffi)) errors.push("first-instance flag not used");
    if (!/PIPE_REJECT_REMOTE_CLIENTS/.test(ffi)) errors.push("remote clients not rejected");
    // AMENDMENT (PROJECTOSHOST-IPC-NON-ELEVATED-PIPE-ACCESS1A): token presence alone is satisfiable by
    // the import line — the flag must be IN the server's pipe-mode composition.
    if (!/let pipe_mode =\s*PIPE_TYPE_MESSAGE\s*\|\s*PIPE_READMODE_MESSAGE\s*\|\s*PIPE_WAIT\s*\|\s*PIPE_REJECT_REMOTE_CLIENTS/.test(stripComments(ffi)))
      errors.push("PIPE_REJECT_REMOTE_CLIENTS is not part of the server pipe-mode composition");
    if (!/PIPE_TYPE_MESSAGE/.test(ffi) || !/PIPE_READMODE_MESSAGE/.test(ffi)) errors.push("message mode not enforced");
    if (!/CreateNamedPipeW\([\s\S]*?\n\s*1,/.test(ffi)) errors.push("nMaxInstances is not 1 (single instance)");
    if (!/CloseHandle/.test(ffi)) errors.push("handles are not closed via CloseHandle");
    if (!/CancelIoEx/.test(ffi)) errors.push("no bounded cancellation (CancelIoEx)");
    if (!/WaitForSingleObject/.test(ffi)) errors.push("no bounded wait");
    // Consumes the OPAQUE host-authority security; never resolves a SID / builds an ACL itself.
    if (!/ProjectOsHostPipeSecurity/.test(ffi)) errors.push("does not consume the opaque host-authority security object");
    if (!/borrowed_security_attributes/.test(ffi)) errors.push("does not use the borrowed security-attributes lease");
    if (/from_bytes|OwnedSid|PSID/.test(ffi)) errors.push("raw SID material handled locally");

    // AMENDMENT1A: complete bounded overlapped transport (no structural stubs).
    const ffiCode = stripComments(ffi);
    if (!/FILE_FLAG_OVERLAPPED/.test(ffiCode)) errors.push("FILE_FLAG_OVERLAPPED not used");
    // Overlapped on BOTH ends: server open mode + client CreateFileW.
    if (!/PIPE_ACCESS_DUPLEX\s*\|\s*FILE_FLAG_FIRST_PIPE_INSTANCE\s*\|\s*FILE_FLAG_OVERLAPPED/.test(ffiCode))
      errors.push("server open mode does not include FILE_FLAG_OVERLAPPED");
    if (!/CreateFileW\([\s\S]*?FILE_FLAG_OVERLAPPED/.test(ffiCode))
      errors.push("client CreateFileW does not use FILE_FLAG_OVERLAPPED");
    if (!/SetNamedPipeHandleState\([\s\S]*?PIPE_READMODE_MESSAGE|PIPE_READMODE_MESSAGE;[\s\S]*?SetNamedPipeHandleState/.test(ffiCode))
      errors.push("client message-read mode is not enforced via SetNamedPipeHandleState");
    if (!/WaitNamedPipeW/.test(ffiCode)) errors.push("no bounded client availability wait (WaitNamedPipeW)");
    if (!/ConnectNamedPipe/.test(ffiCode)) errors.push("ConnectNamedPipe not implemented");
    if (!/ERROR_PIPE_CONNECTED/.test(ffiCode)) errors.push("ERROR_PIPE_CONNECTED not handled");
    if (!/ERROR_IO_PENDING/.test(ffiCode)) errors.push("ERROR_IO_PENDING not handled");
    if (!/GetOverlappedResult/.test(ffiCode)) errors.push("completion not confirmed via GetOverlappedResult");
    if (!/\bReadFile\b/.test(ffiCode)) errors.push("ReadFile not implemented");
    if (!/\bWriteFile\b/.test(ffiCode)) errors.push("WriteFile not implemented");
    // Exact byte-count verification on write; ERROR_MORE_DATA fails closed.
    if (!/transferred as usize\s*!=\s*(len|frame\.len\(\))/.test(ffiCode))
      errors.push("write byte count not verified exactly");
    if (!/ERROR_MORE_DATA/.test(ffiCode)) errors.push("ERROR_MORE_DATA not handled (must fail closed)");
    if (!/OversizedPayload/.test(ffiCode)) errors.push("ERROR_MORE_DATA does not fail closed to an oversize classification");
    // Shutdown request + acknowledgement; deterministic disconnect.
    if (!/MessageKind::ShutdownRequest/.test(ffiCode)) errors.push("shutdown request not sent");
    if (!/MessageKind::ShutdownAcknowledged/.test(ffiCode)) errors.push("shutdown acknowledgement not required");
    if (!/DisconnectNamedPipe/.test(ffiCode)) errors.push("DisconnectNamedPipe not implemented");
    // Address-stable pending-operation lifetime (heap-boxed OVERLAPPED kept alive until completion).
    if (!/struct PendingOp/.test(ffiCode) || !/Box<OVERLAPPED>/.test(ffiCode))
      errors.push("no address-stable heap-owned OVERLAPPED (pending-operation lifetime unprotected)");
    // No structural hard-coded refusal stubs for valid operations: the backend methods delegate to real
    // bounded helpers rather than returning a fixed failure/refusal.
    if (!/fn connect_unauthenticated\(&self\)[\s\S]*?accept_connection\(\)/.test(ffiCode))
      errors.push("connect_unauthenticated is a hard-coded stub (must accept a real bounded connection)");
    if (!/fn receive_frame\(&self\)[\s\S]*?read_frame/.test(ffiCode))
      errors.push("receive_frame is a hard-coded stub (must perform a real bounded read)");
    if (!/fn send_control\(&self[\s\S]*?write_frame/.test(ffiCode))
      errors.push("send_control is a hard-coded stub (must perform a real bounded write)");

    // AMENDMENT1B: bounded cancellation terminalization + quarantine of unconfirmed pending I/O.
    if (/GetOverlappedResult\s*\(/.test(ffiCode))
      errors.push("unbounded GetOverlappedResult used (must use the timeout-capable GetOverlappedResultEx)");
    if (!/GetOverlappedResultEx/.test(ffiCode))
      errors.push("no timeout-capable completion API (GetOverlappedResultEx)");
    if (!/CANCEL_GRACE_MS/.test(ffiCode)) errors.push("no fixed cancellation-grace timeout");
    if (/INFINITE/.test(ffiCode)) errors.push("an INFINITE wait is present");
    // CancelIoEx success alone must NOT be treated as cancellation proof: a terminalize() call must follow.
    if (!/CancelIoEx[\s\S]{0,400}?terminalize\(/.test(ffiCode))
      errors.push("CancelIoEx is not followed by a bounded terminalization query");
    if (!/CancellationTerminalState::CompletedBeforeCancellation/.test(ffiCode))
      errors.push("the operation-completed-before-cancellation race is not classified");
    if (!/CancellationTerminalState::CancelledConfirmed/.test(ffiCode))
      errors.push("confirmed cancellation is not classified");
    if (!/CancellationTerminalState::CancellationTerminalizationTimedOut/.test(ffiCode))
      errors.push("cancellation-grace timeout is not represented");
    // Unconfirmed terminalization must quarantine, retaining OVERLAPPED + event + buffer ownership.
    if (!/struct QuarantinedPendingIo/.test(ffiCode)) errors.push("no QuarantinedPendingIo state");
    if (!/QuarantinedPendingIo\s*\{[\s\S]*?op:\s*PendingOp/.test(ffiCode))
      errors.push("quarantine does not retain the pending operation (OVERLAPPED + event)");
    if (!/_buffer:\s*Option<Box<\[u8;\s*MAX_FRAME_SIZE\]>>/.test(ffiCode))
      errors.push("quarantine does not retain the I/O buffer");
    if (!/OpCompletion::Unterminalized[\s\S]{0,200}?install_into_quarantine\(\)/.test(ffiCode))
      errors.push("unconfirmed terminalization does not route into quarantine");
    // A quarantined operation forbids closing the handle as if cleanup succeeded and forbids Zero residue.
    if (!/managed_quarantine_counts\(\)\.has_outstanding\(\)/.test(ffiCode))
      errors.push("quarantine presence is not reported to the safe layer");
    if (!/fn close_residue[\s\S]{0,600}?IpcResidue::NonZero/.test(ffiCode))
      errors.push("quarantined I/O does not force non-zero residue / retain the handle");
    if (!/fn has_quarantined_io\(&self\)/.test(ffiCode)) errors.push("no quarantine reporting to the safe layer");
    if (!/QUARANTINE_TERMINALIZATION_ATTEMPTS/.test(ffiCode))
      errors.push("later quarantine terminalization has no bounded attempt ceiling");

    // AMENDMENT1C: quarantine OWNS the operation handle and survives backend destruction.
    if (!/struct QuarantinedPendingIo\s*\{[\s\S]*?handle:\s*OwnedHandle/.test(ffiCode))
      errors.push("quarantine does not own the operation handle");
    if (!/static MANAGED_QUARANTINE:\s*OnceLock<Mutex<ManagedQuarantine>>/.test(ffiCode))
      errors.push("no process-lifetime managed quarantine registry (would die with the backend)");
    if (!/fn drain_managed_quarantine\(\)/.test(ffiCode)) errors.push("no bounded managed-quarantine drain");
    if (!/fn managed_quarantine_unresolved\(\)\s*->\s*usize/.test(ffiCode))
      errors.push("managed quarantine exposes no closed unresolved count");
    // The registry must expose ONLY closed counts — never a handle/OVERLAPPED/buffer accessor.
    if (/pub fn\s+\w*(handle|overlapped|buffer|nonce|endpoint)\w*\s*\(/i.test(ffiCode))
      errors.push("a raw quarantine resource accessor is exposed");
    // Handle ownership is REMOVED from the backend on transfer (moved out of the Option, not copied).
    if (!/self\.server\.borrow_mut\(\)\.take\(\)/.test(ffiCode))
      errors.push("the handle is not moved out of backend ownership on quarantine transfer");
    if (!/BackendState::HandleTransferredToQuarantine/.test(ffiCode))
      errors.push("no transferred-to-quarantine backend state");
    // Disconnect must never run once the handle was transferred.
    if (!/HandleTransferredToQuarantine[\s\S]{0,400}?return\s+if unresolved == 0[\s\S]{0,200}?IpcResidue::NonZero/.test(ffiCode))
      errors.push("a transferred handle can still reach disconnect / zero residue");
    if (!/drain_managed_quarantine\(\)\s*!=\s*0[\s\S]{0,120}?IpcResidue::NonZero/.test(ffiCode))
      errors.push("disconnect is not ordered after confirmed terminalization");
    // No ownership escape hatches.
    if (/mem::forget|std::mem::forget/.test(ffiCode)) errors.push("mem::forget ownership workaround");
    if (/Box::leak|ManuallyDrop|into_raw\s*\(/.test(ffiCode))
      errors.push("unmanaged leak / raw ownership escape used");
    // Drop must never block: no wait call inside any Drop impl.
    const dropBlocks = ffiCode.match(/impl Drop for [\s\S]*?\n\}/g) || [];
    for (const d of dropBlocks) {
      if (/WaitForSingleObject|GetOverlappedResult|Sleep\s*\(/.test(d))
        errors.push("a Drop implementation performs a blocking wait");
    }

    // AMENDMENT1D: poison-resilient registry handoff.
    if (!/fn lock_managed_quarantine_recovering_poison\(\)\s*->\s*MutexGuard/.test(ffiCode))
      errors.push("no poison-recovering managed-registry lock helper");
    if (!/poisoned\.into_inner\(\)|PoisonError::into_inner/.test(ffiCode))
      errors.push("poison is not recovered via PoisonError::into_inner");
    // The managed registry must never be locked with unwrap/expect.
    if (/managed_quarantine\(\)\.lock\(\)\.(unwrap|expect)/.test(ffiCode))
      errors.push("managed registry locked with unwrap/expect (panics on poison)");
    if (/let Ok\(mut q\) = managed_quarantine\(\)\.lock\(\)/.test(ffiCode))
      errors.push("a fallible registry lock can skip the quarantine transfer");
    // Unresolved count and drain must both use the recovering lock (never report a poisoned registry
    // as empty / clean).
    if (!/fn managed_quarantine_unresolved\(\)[\s\S]{0,200}?lock_managed_quarantine_recovering_poison\(\)/.test(ffiCode))
      errors.push("unresolved count does not recover poison (could report empty)");
    if (!/fn drain_managed_quarantine\(\)[\s\S]{0,400}?lock_managed_quarantine_recovering_poison\(\)/.test(ffiCode))
      errors.push("drain does not recover poison");
    if (/usize::MAX/.test(ffiCode)) errors.push("a sentinel count replaces real poison recovery");
    // ORDERING: lock, then reserve capacity, then extract backend ownership, then push — no early return
    // between extraction and insertion, and no backend-local fallback.
    const handoff = (ffiCode.match(/fn install_into_quarantine\(&mut self\)[\s\S]*?\n    \}/) || [""])[0];
    if (!handoff) {
      errors.push("quarantine handoff block not found");
    } else {
      // Capacity was secured by the permit BEFORE the I/O was issued, so the handoff itself only extracts
      // ownership and installs into the already-reserved slot — no lock, no allocation, no fallible step.
      const takeAt = handoff.indexOf("self.permit.take()");
      const installAt = handoff.indexOf("permit.install(");
      if (takeAt < 0 || installAt < 0)
        errors.push("handoff is missing extract/install-into-reserved-slot steps");
      else if (!(takeAt < installAt))
        errors.push("handoff order must be extract ownership -> install into the reserved slot");
      if (takeAt >= 0 && installAt > takeAt && /return |\?;/.test(handoff.slice(takeAt, installAt)))
        errors.push("an early return exists in the ownership gap (extraction -> installation)");
      if (/\*self\.server\.borrow_mut\(\)\s*=\s*Some\(/.test(handoff))
        errors.push("a backend-local poison fallback re-parks pending ownership in the backend");
    }

    // AMENDMENT1E: FIXED-CAPACITY admission.
    if (!/const MAX_MANAGED_QUARANTINE_ENTRIES:\s*usize\s*=\s*\d+/.test(ffiCode))
      errors.push("no explicit fixed quarantine capacity");
    if (!/DERIVATION/.test(ffi)) errors.push("quarantine capacity is not documented/derived");
    // A fixed slot array — no Vec, no push, no reserve, no growth.
    if (!/slots:\s*\[QuarantineSlot;\s*MAX_MANAGED_QUARANTINE_ENTRIES\]/.test(ffiCode))
      errors.push("registry is not a fixed-capacity slot array");
    if (/Vec<QuarantinedPendingIo>/.test(ffiCode)) errors.push("an unbounded Vec registry remains");
    if (/q\.push\(|slots\.push\(/.test(ffiCode)) errors.push("an unrestricted registry push remains");
    if (/q\.reserve\(|slots\.reserve\(/.test(ffiCode)) errors.push("per-entry registry growth (reserve) remains");
    for (const s of ["QuarantineSlot::Empty", "QuarantineSlot::Reserved", "QuarantineSlot::Occupied"]) {
      if (!new RegExp(s.replace(/:/g, ":")).test(ffiCode)) errors.push("missing slot state: " + s);
    }
    // Non-cloneable, non-copyable admission permit with no public constructor.
    if (!/struct QuarantinePermit/.test(ffiCode)) errors.push("no QuarantinePermit admission type");
    if (/#\[derive\([^)]*(Clone|Copy)[^)]*\)\]\s*(pub )?struct QuarantinePermit/.test(ffiCode))
      errors.push("QuarantinePermit is Clone/Copy (a permit could be duplicated)");
    if (/pub struct QuarantinePermit|pub fn acquire\(\)/.test(ffiCode))
      errors.push("QuarantinePermit or its constructor is public");
    // ADMISSION BEFORE I/O: every overlapped call must be preceded by a permit acquisition + arm.
    for (const [op, call] of [
      ["accept_connection", "ConnectNamedPipe"],
      ["write_frame_owned", "WriteFile"],
      ["read_raw_owned", "ReadFile"],
    ]) {
      const body = (ffiCode.match(new RegExp("fn " + op + "\\([\\s\\S]*?\\n    \\}")) || [""])[0];
      if (!body) {
        errors.push("cannot locate operation body: " + op);
        continue;
      }
      const acquireAt = body.indexOf("QuarantinePermit::acquire()");
      const armAt = body.indexOf("mark_issued()");
      const callAt = body.indexOf(call + "(");
      if (acquireAt < 0) errors.push(op + ": no quarantine admission before I/O");
      else if (callAt >= 0 && !(acquireAt < callAt && armAt >= 0 && armAt < callAt))
        errors.push(op + ": permit is not acquired and armed before " + call);
      if (!/QuarantineCapacityUnavailable/.test(body))
        errors.push(op + ": capacity exhaustion does not fail closed");
    }
    // Permit lifecycle: released on terminal completion, consumed on quarantine install.
    if (!/fn release_after_terminal_completion/.test(ffiCode))
      errors.push("no permit release on terminal completion");
    if (!/fn install\(mut self, entry: QuarantinedPendingIo\)/.test(ffiCode))
      errors.push("quarantine install does not consume the permit");
    if (!/impl Drop for QuarantinePermit[\s\S]{0,400}?if self\.armed\s*\{\s*return/.test(ffiCode))
      errors.push("an armed (issued) permit can release its slot on drop");
    // Closed accounting with the capacity invariant; Reserved counts as outstanding.
    if (!/pub struct ManagedQuarantineCounts/.test(ffiCode)) errors.push("no closed capacity accounting");
    if (!/fn has_outstanding\(self\)[\s\S]{0,160}?reserved\s*!=\s*0\s*\|\|\s*self\.occupied\s*!=\s*0/.test(ffiCode))
      errors.push("a Reserved slot is not counted as outstanding");
    // Drain must not disturb Reserved slots.
    if (!/QuarantineSlot::Reserved\s*=>\s*outstanding \+= 1/.test(ffiCode))
      errors.push("drain does not retain//count Reserved slots untouched");

    // AMENDMENT1F: ISSUED-I/O UNWIND SAFETY — one guard owns the whole graph after the issue point.
    if (!/struct IssuedPendingOperation/.test(ffiCode)) errors.push("no issued-operation ownership guard");
    if (/pub struct IssuedPendingOperation/.test(ffiCode)) errors.push("the issued-operation guard is public");
    if (/#\[derive\([^)]*(Clone|Copy)[^)]*\)\]\s*struct IssuedPendingOperation/.test(ffiCode))
      errors.push("the issued-operation guard is Clone/Copy");
    // It must own permit + pending operation + handle + buffer together.
    for (const [field, why] of [
      ["permit:\\s*Option<QuarantinePermit>", "admission permit"],
      ["op:\\s*Option<PendingOp>", "pending operation (event + OVERLAPPED)"],
      ["handle:\\s*Option<OwnedHandle>", "operation handle"],
      ["buffer:\\s*Option<Box<\\[u8;\\s*MAX_FRAME_SIZE\\]>>", "I/O buffer"],
    ]) {
      if (!new RegExp("struct IssuedPendingOperation[\\s\\S]*?" + field).test(ffiCode))
        errors.push("the issued-operation guard does not own the " + why);
    }
    // Closed issue states.
    for (const st of [
      "ReservedNotIssued",
      "IssuedPending",
      "TerminalConfirmed",
      "InstalledInQuarantine",
    ]) {
      if (!new RegExp("IssueState[\\s\\S]{0,400}?" + st).test(ffiCode))
        errors.push("missing issue state: " + st);
    }
    // Post-issue Drop performs the quarantine handoff (an armed permit alone is NOT the mechanism).
    const guardDrop =
      (ffiCode.match(/impl Drop for IssuedPendingOperation[\s\S]*?\n\}/) || [""])[0];
    if (!guardDrop) {
      errors.push("the issued-operation guard has no Drop");
    } else {
      if (!/install_into_quarantine\(\)/.test(guardDrop))
        errors.push("post-issue Drop does not install into quarantine");
      if (!/IssueState::IssuedPending/.test(guardDrop))
        errors.push("post-issue Drop does not gate on the IssuedPending state");
      if (/WaitForSingleObject|GetOverlappedResult|Sleep\s*\(/.test(guardDrop))
        errors.push("the issued-operation guard Drop waits");
      if (/Box::new|Vec::|to_vec\(|String::/.test(guardDrop))
        errors.push("the issued-operation guard Drop allocates");
      if (/panic!|unwrap\(\)|expect\(/.test(guardDrop))
        errors.push("the issued-operation guard Drop can panic");
    }
    // The handoff itself must use the poison-recovering lock and its own pre-reserved slot, and must not
    // release capacity after issue.
    if (!/fn install\(mut self, entry: QuarantinedPendingIo\)[\s\S]{0,400}?lock_managed_quarantine_recovering_poison\(\)/.test(ffiCode))
      errors.push("quarantine installation does not use the poison-recovering lock");
    if (!/QuarantineSlot::Occupied\(_\)\s*=>/.test(ffiCode))
      errors.push("an invalid slot transition is not handled fail-closed");
    // Post-issue resources must NOT be independent stack locals: the Windows calls take the handle,
    // OVERLAPPED and buffer from the guard.
    for (const [op, call] of [
      ["accept_connection", "ConnectNamedPipe"],
      ["write_frame_owned", "WriteFile"],
      ["read_raw_owned", "ReadFile"],
    ]) {
      const body = (ffiCode.match(new RegExp("fn " + op + "\\([\\s\\S]*?\\n    \\}")) || [""])[0];
      if (body && !/issued\.raw_handle\(\)|issued\.overlapped_ptr\(\)|issued\.buffer/.test(body))
        errors.push(op + ": post-issue resources are not owned by the guard");
      if (body && !/IssuedPendingOperation::new/.test(body))
        errors.push(op + ": no issued-operation guard is constructed before the call");
    }
    // Terminal completion releases the permit; unconfirmed consumes it into Occupied.
    if (!/fn finish_terminal[\s\S]{0,400}?release_after_terminal_completion\(\)/.test(ffiCode))
      errors.push("terminal completion does not release the permit");
    if (!/fn install_into_quarantine[\s\S]{0,600}?permit\.install\(/.test(ffiCode))
      errors.push("unconfirmed completion does not consume the permit into Occupied");
    // Deterministic unwind / drop-counter tests must exist in the safe layer.
    const adapterTests = stripComments(read(path.join(SRC, "adapter.rs")));
    for (const [needle, why] of [
      ["struct TestIssuedOp", "issued-operation unwind model"],
      ["fn pre_issue_drop_returns_the_slot_but_post_issue_drop_installs_quarantine", "pre/post-issue drop test"],
      ["fn post_issue_unwind_under_a_poisoned_registry_still_installs_quarantine", "poisoned post-issue unwind test"],
      ["fn terminal_completion_releases_permit_and_resources_once", "terminal release test"],
      ["struct TrackedResource", "drop-counter fake"],
    ]) {
      if (!adapterTests.includes(needle)) errors.push("missing " + why);
    }
  }
  // lib gates the module.
  const lib = read(path.join(SRC, "lib.rs"));
  if (!/cfg\(all\(windows,\s*feature\s*=\s*"windows-live-ipc"\)\)\]\s*mod windows_ffi/.test(lib))
    errors.push("windows_ffi module not gated to the feature");

  // 4. Safe security decision: unresolved fails closed; no weaker fallback; no local ACL/SID builder.
  const security = stripComments(read(path.join(SRC, "security.rs")));
  if (!/evaluate_pipe_security/.test(security)) errors.push("no pipe-security evaluation");
  if (!/RequiresInstalledServiceProof/.test(security)) errors.push("does not handle RequiresInstalledServiceProof");
  if (/Everyone|AuthenticatedUsers|LocalSystem\s*=>|NullDacl|default_descriptor/.test(security))
    errors.push("a weaker security fallback appears in the security decision");

  // 5. Protocol: fixed version, closed kinds, fixed-size nonce, bounded framing, refusals.
  const proto = stripComments(read(path.join(SRC, "protocol.rs")));
  if (!/WIRE_PROTOCOL_VERSION:\s*u16\s*=\s*1/.test(proto)) errors.push("protocol version not fixed to 1");
  if (!/NONCE_LEN:\s*usize\s*=\s*32/.test(proto)) errors.push("nonce is not fixed-size (32)");
  if (!/MAX_FRAME_SIZE/.test(proto)) errors.push("no bounded frame size");
  for (const kind of ["ControllerHello", "ServiceReady", "ServiceEvidence", "AuthorityOutcome", "ShutdownRequest", "ShutdownAcknowledged", "TypedRefusal"]) {
    if (!new RegExp(kind).test(proto)) errors.push("missing message kind: " + kind);
  }
  for (const err of ["UnknownVersion", "UnknownMessageKind", "OversizedPayload", "TruncatedPayload", "TrailingData", "PayloadLengthMismatch", "BadMagic"]) {
    if (!new RegExp(err).test(proto)) errors.push("missing frame refusal: " + err);
  }
  if (/serde|serialize|deserialize|serde_json|Vec<u8>\s*\)/i.test(proto)) errors.push("protocol uses serde/arbitrary payload");
  // No public arbitrary-bytes nonce constructor.
  if (/pub fn from_fixed_bytes|pub fn from_bytes/.test(proto)) errors.push("public arbitrary-bytes nonce constructor exists");
  if (!/Nonce\(<redacted>\)|write_str\("Nonce/.test(proto)) errors.push("nonce Debug is not redacted");

  // 6. Verification: bounded retry, redaction, replay/stale/peer/residue classification.
  const verif = stripComments(read(path.join(SRC, "verification.rs")));
  if (!/MAX_ATTEMPTS_CEILING/.test(verif)) errors.push("no bounded retry ceiling");
  if (!/classify_ipc_error/.test(verif)) errors.push("no Win32 error redaction");
  if (!/is_non_retryable/.test(verif)) errors.push("no non-retryable classification");
  if (!/verify_zero_residue/.test(verif)) errors.push("no residue classification");
  if (!/verify_peer_role/.test(verif)) errors.push("no peer-role validation");

  // 7. Adapter: sealed capability with no constructor; IPC alone cannot confirm.
  const adapter = stripComments(read(path.join(SRC, "adapter.rs")));
  if (!/struct Sealed/.test(adapter) || !/LiveIpcOperationCapability/.test(adapter)) errors.push("sealed capability missing");
  if (/->\s*LiveIpcOperationCapability/.test(adapter)) errors.push("LiveIpcOperationCapability has a factory (must be unconstructible)");
  // CAPABILITY CONSTRUCTION — scoped rule (CD-B4-BINDING-CONSUMER-SURFACE1A-AMENDMENT1B).
  //
  // B3 froze a BLANKET ban: the capability was constructed nowhere. That was correct then. The
  // authorised amendment introduces construction in exactly one place — behind the explicit,
  // non-default `test-fixtures` feature — so the blanket ban becomes the STRONGER scoped rule below.
  // The historical section proves the frozen B3 commit still carries the original blanket state.
  const adapterNoDef = adapter.replace(/pub struct LiveIpcOperationCapability\s*\{[^}]*\}/, " ");
  const ipcFixtureImpl = adapterNoDef.match(
    /#\[cfg\(feature = "test-fixtures"\)\]\s*impl LiveIpcOperationCapability \{[\s\S]*?\n\}/
  );
  if (!ipcFixtureImpl)
    errors.push("no test-fixtures-gated impl provides the fixture-only IPC capability acquisition");
  // CD-B4-PROJECTOSHOST-FUNCTIONAL-PILOT1A added the SECOND — and only other — permitted acquisition:
  // the owner-approval route this crate's own comment anticipated. It is gated on its own non-default
  // feature and consumes a one-session approval transcribed from an exact phrase, scoped read-only.
  const ipcOwnerImpl = adapterNoDef.match(
    /#\[cfg\(feature = "owner-approved-status-read"\)\]\s*impl LiveIpcOperationCapability \{[\s\S]*?\n\}/
  );
  if (!ipcOwnerImpl)
    errors.push("no owner-approved-status-read-gated impl provides the owner-approval acquisition");
  else {
    if (!/from_owner_status_read_approval\(approval: OwnerStatusReadApproval\)/.test(ipcOwnerImpl[0]))
      errors.push("the owner-approved IPC acquisition does not consume an owner approval");
    if (!/REQUIRED_PHRASE/.test(adapter) || !/phrase != Self::REQUIRED_PHRASE/.test(adapter))
      errors.push("the IPC owner approval is not gated on the exact required phrase");
    if (/impl Default for OwnerStatusReadApproval/.test(adapter))
      errors.push("the IPC owner approval is defaultable");
    // The capability it yields must be scoped read-only, with exactly one scope value.
    if (!/ReadInstalledHostStatusLocalOnly/.test(adapter))
      errors.push("the owner-approved IPC capability is not scoped to the read-only status read");
  }

  let ipcOutside = ipcFixtureImpl ? adapterNoDef.replace(ipcFixtureImpl[0], " ") : adapterNoDef;
  if (ipcOwnerImpl) ipcOutside = ipcOutside.replace(ipcOwnerImpl[0], " ");
  // The approval type's own impl builds an `OwnerStatusReadApproval`, a DIFFERENT sealed type whose
  // exact-phrase gate is proven above; exclude it so it is not mistaken for a capability construction.
  ipcOutside = ipcOutside.replace(
    /#\[cfg\(feature = "owner-approved-status-read"\)\]\s*impl OwnerStatusReadApproval \{[\s\S]*?\n\}/,
    " "
  );
  if (/LiveIpcOperationCapability\s*\{/.test(ipcOutside))
    errors.push(
      "LiveIpcOperationCapability is constructed outside the two gated acquisition routes"
    );
  if (ipcFixtureImpl && !/pub fn synthetic_for_fixture\(\) -> Self/.test(ipcFixtureImpl[0]))
    errors.push("the fixture acquisition is not the expected narrow constructor");
  if (/impl Default for LiveIpcOperationCapability/.test(adapter))
    errors.push("LiveIpcOperationCapability gained a Default");
  if (/pub _sealed|_sealed:\s*\(\)/.test(adapter))
    errors.push("the capability's sealing field is public or unit-constructible");

  // The opaque confirmed-handshake proof: unforgeable, and NOT obtainable from the public outcome.
  if (!/pub struct ConfirmedIpcPeerHandshake\s*\{\s*_sealed: Sealed,?\s*\}/.test(adapter))
    errors.push("ConfirmedIpcPeerHandshake is not sealed by a private marker");
  if (/impl (Default|From<bool>|From<PeerRole>|From<HandshakeOutcome>) for ConfirmedIpcPeerHandshake/.test(adapter))
    errors.push("ConfirmedIpcPeerHandshake gained a forgeable conversion");
  if (/impl (std::)?fmt::Display for ConfirmedIpcPeerHandshake/.test(adapter))
    errors.push("ConfirmedIpcPeerHandshake implements Display");
  if (!/ConfirmedIpcPeerHandshake\(\[REDACTED\]\)/.test(adapter))
    errors.push("ConfirmedIpcPeerHandshake Debug is not redacted");
  // A confirmation may be minted ONLY for the accepting outcome, by the crate-private transition ctor.
  if (!/pub\(crate\) fn from_outcome/.test(adapter))
    errors.push("the transition constructor is not crate-private");
  if (!/if outcome\.is_peer_confirmed\(\)/.test(adapter))
    errors.push("a confirmation is not conditioned on the accepting outcome");
  if (!/pub fn into_confirmed\(self\)/.test(adapter))
    errors.push("the confirmation is not taken by consuming the transition (replay discipline)");
  // The fixture runner must reuse the REAL verification order, never assert success.
  if (!/pub\(crate\) fn verify_handshake_logic/.test(adapter))
    errors.push("the shared handshake verification logic is missing");
  if (!/verify_handshake_logic\(\s*observation,\s*MessageKind::ControllerHello,\s*PeerRole::Controller,?\s*\)/.test(adapter))
    errors.push("the fixture handshake runner does not drive the real verification order");

  // FEATURE CONTAINMENT: explicit, non-default, mutually independent of the live feature.
  if (!/test-fixtures\s*=\s*\[/.test(toml))
    errors.push("no explicit test-fixtures feature is declared");
  if (/^\s*default\s*=\s*\[[^\]]*(test-fixtures|windows-live-ipc)/m.test(toml))
    errors.push("a default feature enables fixtures or the live transport");
  const ipcLiveBlock = (toml.match(/windows-live-ipc\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  const ipcFixBlock = (toml.match(/^test-fixtures\s*=\s*\[[\s\S]*?\]/m) || [""])[0];
  if (/"[^"]*\/test-fixtures"|^\s*"test-fixtures"/m.test(ipcLiveBlock))
    errors.push("windows-live-ipc implies test-fixtures (live must not reach fixtures)");
  if (/windows-live-ipc|dep:windows\b/.test(ipcFixBlock))
    errors.push("test-fixtures implies the live transport or a Windows dependency");

  // HISTORICAL ACCEPTED STATE — read the FROZEN B3 commit directly so the evolved tree cannot rewrite
  // what was accepted at closure.
  {
    const B3_COMMIT = "bc93e3c7e3eb73f15f87e313d357a2c00f15049e";
    let histAdapter = null;
    let histToml = null;
    const show = (p) =>
      execFileSync("git", ["show", `${B3_COMMIT}:${p}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    try {
      const _unused = (p) =>
        execFileSync("git", ["show", `${B3_COMMIT}:${p}`], {
          cwd: ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      histAdapter = show("projectos/host/windows-local-ipc/src/adapter.rs");
      histToml = show("projectos/host/windows-local-ipc/Cargo.toml");
    } catch (e) {
      errors.push("cannot read the frozen B3 commit " + B3_COMMIT + " (historical evidence lost)");
    }
    if (histAdapter !== null && histToml !== null) {
      const histNoDef = histAdapter.replace(/pub struct LiveIpcOperationCapability\s*\{[^}]*\}/, " ");
      if (/LiveIpcOperationCapability\s*\{/.test(histNoDef))
        errors.push("the frozen B3 commit already constructed the capability (history misread)");
      if (!/pub struct LiveIpcOperationCapability/.test(histAdapter))
        errors.push("the frozen B3 commit does not define the sealed capability");
      if (/synthetic_for_fixture/.test(histAdapter))
        errors.push("the frozen B3 commit is being misreported as containing a fixture constructor");
      if (/ConfirmedIpcPeerHandshake/.test(histAdapter))
        errors.push("the frozen B3 commit is being misreported as containing the confirmation type");
      // A `test-fixtures` FEATURE DEFINITION must not have existed (the words may appear in a comment).
      if (/^\s*test-fixtures\s*=\s*\[/m.test(histToml))
        errors.push("the frozen B3 commit is being misreported as containing a fixture feature");
      const histLib = show("projectos/host/windows-local-ipc/src/lib.rs");
      if (!/LIVE_LOCAL_IPC_AUTHORISED:\s*bool\s*=\s*false/.test(histLib))
        errors.push("the frozen B3 commit did not keep live IPC unauthorised");
    }
  }
  if (!/fn ipc_alone_confirms_authority\(\)\s*->\s*bool\s*\{\s*false\s*\}/.test(adapter))
    errors.push("IPC alone must not confirm authority");

  // AMENDMENT1B: a connection is NEVER an authenticated peer; the peer is confirmed only by a bounded,
  // nonce-bound, role-bound handshake.
  if (!/TransportConnectedUnauthenticated/.test(adapter))
    errors.push("a raw connection does not yield an unauthenticated state");
  // The connect path must not produce any accepted/confirmed role directly.
  if (/fn accept_unauthenticated_logic[\s\S]{0,300}?ExpectedServiceFixturePeerConfirmed/.test(adapter))
    errors.push("connection success is classified as a confirmed peer");
  if (!/MessageKind::ControllerHello/.test(adapter)) errors.push("ControllerHello not implemented");
  if (!/MessageKind::ServiceReady/.test(adapter)) errors.push("ServiceReady not implemented");
  // The hello must be sent before any acceptance, and the reply verified.
  if (!/send_handshake\(\s*MessageKind::ControllerHello,\s*PeerRole::Controller\s*\)/.test(adapter))
    errors.push("ControllerHello is not sent with the Controller role");
  if (!/send_handshake\(\s*MessageKind::ServiceReady,\s*PeerRole::ServiceFixture\s*\)/.test(adapter))
    errors.push("ServiceReady is not answered with the ServiceFixture role");
  // Handshake verification order: kind, freshness, replay, nonce, role — each a typed refusal.
  if (!/fn verify_handshake/.test(adapter)) errors.push("no handshake verification");
  for (const check of [
    ["obs.kind != expected_kind", "RefusedWrongMessageKind"],
    ["verify_endpoint_fresh", "RefusedStale"],
    ["verify_not_replayed", "RefusedReplay"],
    ["obs.nonce_matches", "RefusedNonceMismatch"],
    ["verify_peer_role", "RefusedRole"],
  ]) {
    if (!adapter.includes(check[0]) || !adapter.includes(check[1]))
      errors.push("handshake does not verify/refuse: " + check[1]);
  }
  // Quarantined pending I/O forbids clean shutdown and zero residue in the SAFE layer too.
  if (!/fn confirm_shutdown_logic[\s\S]{0,200}?has_quarantined_io\(\)[\s\S]{0,60}?return false/.test(adapter))
    errors.push("quarantined I/O does not forbid a clean shutdown");
  if (!/fn close_and_classify_residue_logic[\s\S]{0,400}?has_quarantined_io\(\)[\s\S]{0,120}?IpcResidue::NonZero/.test(adapter))
    errors.push("quarantined I/O does not forbid Zero residue");

  // AMENDMENT1C: a backend whose handle was transferred is permanently unusable in the SAFE layer too.
  if (!/enum BackendState[\s\S]*?HandleTransferredToQuarantine/.test(adapter))
    errors.push("no closed transferred-to-quarantine backend state");
  if (!/fn state\(&self\)\s*->\s*BackendState/.test(adapter))
    errors.push("the backend seam does not report its lifecycle state");
  for (const guard of [
    ["fn accept_unauthenticated_logic", "no further peer acceptance"],
    ["fn receive_typed_frame_logic", "no further reads"],
    ["fn send_typed_frame_logic", "no further writes"],
  ]) {
    const re = new RegExp(guard[0] + "[\\s\\S]{0,300}?state\\(\\)\\.is_operational\\(\\)");
    if (!re.test(adapter)) errors.push("non-operational backend still permits: " + guard[1]);
  }
  if (!/fn confirm_shutdown_logic[\s\S]{0,260}?state\(\)\.is_operational\(\)/.test(adapter))
    errors.push("a transferred backend can still report clean shutdown");
  if (!/fn close_and_classify_residue_logic[\s\S]{0,200}?HandleTransferredToQuarantine[\s\S]{0,80}?IpcResidue::NonZero/.test(adapter))
    errors.push("a transferred handle is treated as clean closure");

  // 8. Tests: no live pipe/windows, no unsafe.
  const testFile = path.join(CRATE, "tests", "api_contract.rs");
  if (fs.existsSync(testFile)) {
    const t = stripComments(read(testFile));
    if (WINDOWS_FFI.test(t)) errors.push("integration test references windows/pipe (must be effect-free)");
    if (/unsafe\s*(fn|\{)/.test(t)) errors.push("integration test contains unsafe");
  }

  // 9. Truthful phase state: the Windows transport is IMPLEMENTED but compile-only — NOT contract-only.
  if (!/LOCAL_IPC_TRANSPORT_STATE\s*:\s*LocalIpcTransportState\s*=\s*LocalIpcTransportState::WindowsTransportImplementedCompileOnly/.test(lib))
    errors.push("current state is not truthfully WindowsTransportImplementedCompileOnly");
  if (!/LOCAL_IPC_IS_CONTRACT_ONLY:\s*bool\s*=\s*false/.test(lib))
    errors.push("crate must no longer claim to be entirely contract-only (a transport now exists)");
  if (!/LIVE_LOCAL_IPC_AUTHORISED:\s*bool\s*=\s*false/.test(lib)) errors.push("live IPC must be unauthorised");

  // 10. CROSS-SOURCE SERVICE-INSTANCE BINDING (CD-B4-CROSS-SOURCE-BINDING-CONTRACT1A).
  // A confirmed handshake proves only that the PEER holds the nonce. Binding that peer to the
  // SCM-observed service requires an OS-derived identity, which this crate must NOT own: it lends its
  // live server handle to the canonical identity-proof crate and receives a closed observation back.
  const featBlock = (toml.match(/windows-live-ipc\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (!/"projectos-host-windows-service-identity-proof\/windows-live-instance-observation"/.test(featBlock))
    errors.push("windows-live-ipc does not enable the canonical instance-observation feature");
  if (/identity-proof\/test-fixtures/.test(featBlock))
    errors.push("windows-live-ipc reaches a test-fixtures feature");

  // Since Contract1B the adapter contributes into an ATTEMPT it does not own. It may only do so from
  // the ScmBeforeObserved state, so the peer can never be observed before the SCM baseline, and the
  // attempt is consumed so it can never be observed twice.
  const ffiSrc = stripComments(read(path.join(SRC, FFI)));
  const obs = ffiSrc.match(
    /fn\s+contribute_ipc_peer\s*\(\s*&self,\s*attempt:\s*ServiceInstanceBindingAttempt<ScmBeforeObserved>,([\s\S]*?)\)\s*->\s*AttemptOutcome<IpcPeerObserved>/
  );
  if (!obs) errors.push("no attempt-scoped pipe-peer contribution from the ScmBeforeObserved state");
  else {
    // The DECLARED role gates the observation but must be supplied, not inferred here.
    if (!/handshake_confirmed:\s*bool/.test(obs[1]))
      errors.push("the peer contribution does not require a confirmed handshake");
    if (!/confirmed_peer_role:\s*PeerRole/.test(obs[1]))
      errors.push("the peer contribution does not require the confirmed peer role");
  }
  if (!/attempt\.observe_ipc_peer\(/.test(ffiSrc))
    errors.push("this crate does not delegate peer observation to the canonical owner");
  if (!/confirmed_peer_role\s*==\s*PeerRole::ServiceFixture/.test(ffiSrc))
    errors.push("the peer contribution does not require the ServiceFixture role");
  // This crate contributes the IPC peer ONLY — never an SCM observation, never the verdict.
  for (const bad of [
    /observe_scm_before/,
    /observe_scm_after/,
    /QueryServiceStatusEx/,
    /fn\s+finalise/,
    /bind_service_instance/,
  ]) {
    if (bad.test(ffiSrc)) errors.push("this crate performs a binding step it does not own");
  }
  // A backend that is not operational, or whose handle went to quarantine, can never be observed.
  if (!/state\.get\(\)\s*!=\s*BackendState::Operational\s*\|\|\s*self\.has_quarantined_io\(\)/.test(ffiSrc))
    errors.push("the peer observation does not refuse a non-operational or quarantined backend");
  // The identity must come from the canonical crate, never be assembled here.
  for (const bad of [
    /GetNamedPipeClientProcessId/,
    /GetNamedPipeServerProcessId/,
    /GetProcessTimes/,
    /OpenProcess\b/,
    /ServiceInstanceToken\s*\{/,
    /from_observed_parts/,
  ]) {
    if (bad.test(ffiSrc)) errors.push("this crate reads or assembles raw process identity itself");
  }
  if (!/pub\s+use\s+projectos_host_windows_service_identity_proof::\{[\s\S]*?ServiceInstanceToken,?[\s\S]*?\};/.test(lib))
    errors.push("the canonical instance identity is not re-exported from the owning crate");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-windows-local-ipc-capability-b3] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-windows-local-ipc-capability-b3: PASS");
}
