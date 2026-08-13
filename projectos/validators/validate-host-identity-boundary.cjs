"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B. Prove the canonical identity/publisher-trust
// implementation lives EXACTLY ONCE in projectos-host-identity: the governed set of identity source
// files and three relocated integration tests exist there and nowhere in the Control Center; unsafe
// FFI is confined to the accepted FFI files with SAFETY documentation; serde_json stays inside
// host-identity
// (the shared runtime keeps forbid(unsafe_code) and a serde_json-free src); the dependency direction
// is acyclic; the publisher policy remains empty and fail-closed with no bypass route; and no
// process/IPC/authority/service/credential/signing route exists. Evergreen structural checks —
// comments are stripped before code-pattern matching; no line numbers.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const HID = path.join(ROOT, "projectos", "host", "host-identity");
const SHARED = path.join(ROOT, "projectos", "host", "shared-host-runtime");
const CC = path.join(ROOT, "projectos", "control-center", "src-tauri");
const PRIM = path.join(ROOT, "projectos", "host", "windows-runtime-primitives");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
// TOML: comments explain the architecture and legitimately NAME sibling crates; only real
// dependency lines count.
function stripTomlComments(src) {
  return src.replace(/#.*$/gm, " ");
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
function count(re, s) {
  const m = s.match(re);
  return m ? m.length : 0;
}

// The exact identity file set. The count is pinned deliberately, so a new file cannot be added to this
// crate without a governed decision. `canonical_record.rs` was added by
// CD-B4-CANONICAL-INSTALLATION-IDENTITY-WIRING1A: the versioned canonical installation identity record
// and its read-only provider, which replaced the all-zero placeholder. It contains no unsafe, performs
// no filesystem access, and is bound by the FORBIDDEN_ROUTES scan below like every other file here.
const IDENTITY_FILES = [
  "anchor.rs", "authenticode.rs", "canonical.rs", "canonical_record.rs", "composite.rs", "errors.rs",
  "es256.rs", "hash.rs", "install_root.rs", "installed_application.rs", "manifest.rs", "mod.rs",
  "mode.rs", "packaged_authority.rs", "paths.rs", "production_verifier.rs", "publisher_policy.rs",
  "running_executable.rs", "tests.rs", "types.rs", "verifier.rs",
];
const IDENTITY_TESTS = ["identity_authenticode.rs", "identity_composite.rs", "identity_installation.rs"];

/**
 * The identity files permitted to contain `unsafe`, each a dedicated FFI boundary and nothing else.
 *
 * `es256.rs` was ADDED DELIBERATELY, after reading it, not to make this validator green. It holds
 * exactly ONE production `unsafe` block, inside `#[cfg(windows)] verify_es256`, plus three inside a
 * `#[cfg(all(test, windows))]` module that generates an ephemeral key so the genuine / altered-message
 * / wrong-key / altered-signature controls can exist at all. What was checked against the code rather
 * than against its comments:
 *   * key length, the 0x04 uncompressed tag and signature length are all rejected BEFORE any FFI call,
 *     so malformed input never reaches the provider;
 *   * every handle is closed on all three exits — provider-open failure opens none, import failure
 *     closes the algorithm, and the success path destroys the key and closes the algorithm BEFORE the
 *     verification result is even examined;
 *   * production verifies and never signs: `BCryptSignHash`, `BCryptGenerateKeyPair` and
 *     `BCryptFinalizeKeyPair` appear only under `cfg(all(test, windows))`, and no private-key or
 *     key-store route exists in this crate at all;
 *   * no pointer or buffer escapes the function — it returns `Result<(), IdentityError>`;
 *   * non-Windows builds return `ManifestSignatureInvalid` rather than pretending to verify;
 *   * every failure returns the SAME error, so a forger learns nothing about which part was wrong.
 *
 * Adding a path here is a trust decision. The per-unit SAFETY check below still applies to these
 * files, and the count check above still refuses any file that is not on the governed list.
 *
 * PATHS, NOT FILENAMES — relative to `host-identity/src`, forward-slashed, matched whole. The
 * acceptance is of these reviewed files at these locations, and of nothing that merely shares a name
 * with them.
 */
const UNSAFE_ALLOWED = new Set([
  "identity/authenticode.rs",
  "identity/es256.rs",
  "identity/running_executable.rs",
]);

// Effect/policy routes the identity crate must never contain.
const FORBIDDEN_ROUTES = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute|powershell|cmd\.exe|sc\.exe/, why: "process-launch route" },
  { re: /CreateNamedPipe|ConnectNamedPipe/, why: "IPC/named-pipe route" },
  { re: /CreateMutex|OpenMutex/, why: "instance-authority route" },
  { re: /OpenSCManager|CreateServiceW?|StartServiceW?|DeleteService|ChangeServiceConfig/, why: "service-management route" },
  { re: /RegCreate|RegSetValue|RegOpenKey/, why: "registry route" },
  { re: /CredRead|CredWrite|CryptProtectData|CryptUnprotectData|\bGCM\b|\bPAT\b/, why: "credential/GCM/PAT route" },
  { re: /\bgithub\b/i, why: "GitHub route" },
  { re: /TcpStream|reqwest|hyper::|ureq/, why: "network-client route" },
  { re: /CertCreateSelfSign|CryptSignMessage|SignerSign|PFXImport/, why: "signing/cert-generation route" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(HID)) return ["host-identity crate directory missing: " + HID];

  // 1. Crate identity.
  const toml = read(path.join(HID, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-host-identity"/.test(toml)) errors.push("Cargo.toml package name is not projectos-host-identity");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("Cargo.toml is not publish=false");
  if (/\btauri\b/i.test(toml)) errors.push("host-identity Cargo.toml references tauri");
  if (!/projectos-windows-runtime-primitives/.test(toml)) errors.push("host-identity does not depend on windows-runtime-primitives");
  if (/projectos-control-center|projectos-shared-host-runtime/.test(toml)) errors.push("host-identity depends on control-center or shared-host-runtime (cycle)");

  // 2. Exact relocated file sets.
  // THE INVENTORY IS RECURSIVE AND IS A SET, not a count of one directory's direct children.
  //
  // `readdirSync` saw only the top level, so `identity/anything/helper.rs` was invisible: a whole
  // subtree could be added to the governed crate and this check would still report the expected
  // number of files. A count is also the wrong comparison — one file removed and one added scores
  // equal and passes. Compare exact forward-slashed paths relative to `src/identity` against the
  // approved set, and say which side each difference is on. The approved entries are flat filenames,
  // so any nested path is by construction absent from the set and fails.
  const idDir = path.join(HID, "src", "identity");
  const approved = new Set(IDENTITY_FILES);
  const actualId = fs.existsSync(idDir)
    ? rsFiles(idDir).map((f) => path.relative(idDir, f).replace(/\\/g, "/")).sort()
    : [];
  const actualSet = new Set(actualId);
  for (const f of IDENTITY_FILES) {
    if (!actualSet.has(f)) errors.push("missing approved identity file: " + f);
  }
  for (const f of actualId) {
    if (!approved.has(f))
      errors.push(
        "identity file '" + f + "' is not in the approved inventory of " +
          IDENTITY_FILES.length + " files",
      );
  }
  for (const t of IDENTITY_TESTS) {
    if (!fs.existsSync(path.join(HID, "tests", t))) errors.push("missing relocated identity test: " + t);
    if (fs.existsSync(path.join(CC, "tests", t))) errors.push("old Control Center identity test still exists: " + t);
  }
  if (fs.existsSync(path.join(CC, "src", "identity")))
    errors.push("old Control Center identity source directory still exists");

  // 3. Unsafe containment + SAFETY docs + serde_json confinement inside host-identity.
  for (const f of rsFiles(path.join(HID, "src"))) {
    const raw = read(f);
    const code = stripComments(raw);
    const unsafeUnits = count(/unsafe\s*(fn|\{)/g, code);
    // THE WHOLE PATH, never the basename. Matching on `path.basename` meant any file called
    // `es256.rs` anywhere under src/ inherited the exemption — `src/anything/es256.rs` would have
    // been waved through exactly like the reviewed `src/identity/es256.rs`. The acceptance is of a
    // specific reviewed file at a specific location, so the comparison has to be the specific
    // location. Relative to the crate's `src`, forward-slashed, compared whole: no suffix match, no
    // directory prefix, nothing that a new file could satisfy by being named well.
    const relToSrc = path.relative(path.join(HID, "src"), f).replace(/\\/g, "/");
    if (unsafeUnits > 0 && !UNSAFE_ALLOWED.has(relToSrc))
      errors.push(
        path.relative(ROOT, f).replace(/\\/g, "/") +
          ": unsafe at '" + relToSrc + "', which is not an accepted FFI path (" +
          [...UNSAFE_ALLOWED].join(", ") + ")",
      );
    // ONE SAFETY EXPLANATION PER UNSAFE UNIT. The old rule accepted a single case-insensitive
    // "safety" anywhere in the file, so a file with five unsafe blocks and one leftover mention of
    // the word passed — and a NEW unsafe block added beside documented ones needed no justification
    // at all. Count the markers exactly, and report both numbers so a failure says which side moved.
    const safetyMarkers = count(/SAFETY:/g, raw);
    if (unsafeUnits > 0 && safetyMarkers < unsafeUnits)
      errors.push(
        path.relative(ROOT, f).replace(/\\/g, "/") +
          ": " + unsafeUnits + " unsafe unit(s) but only " + safetyMarkers +
          " SAFETY: marker(s) — every unsafe unit needs its own justification",
      );
    for (const { re, why } of FORBIDDEN_ROUTES) {
      if (re.test(code)) errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + why);
    }
    // A ProgramData MUTATION route: the identity tests legitimately use a ProgramData path string as
    // read-only classification INPUT, so the name alone is not an effect — only the name combined
    // with a filesystem-mutation call in the same file is.
    if (/ProgramData/.test(code) && /fs::(create|write|remove)|OpenOptions|create_dir/.test(code))
      errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": ProgramData mutation route");
  }

  // 4. Exactly-one canonical implementations (production source only).
  const ccFiles = rsFiles(path.join(CC, "src"));
  const sharedFiles = rsFiles(path.join(SHARED, "src"));
  for (const f of [...ccFiles, ...sharedFiles]) {
    const code = stripComments(read(f));
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (/fn\s+capture_startup_identity\s*\(/.test(code) && !/pub(\(crate\))?\s+use/.test(code))
      errors.push(rel + ": duplicate capture_startup_identity implementation");
    if (/struct\s+PublisherPolicy\b/.test(code)) errors.push(rel + ": duplicate publisher policy");
    if (/struct\s+Win32Authenticode\b/.test(code)) errors.push(rel + ": duplicate Authenticode verifier");
    if (/struct\s+CompositeIdentity\b/.test(code)) errors.push(rel + ": duplicate composite evaluator");
    if (/WinVerifyTrust/.test(code)) errors.push(rel + ": Authenticode FFI outside host-identity");
  }
  const hidCode = rsFiles(path.join(HID, "src")).map((f) => stripComments(read(f))).join("\n");
  if (count(/struct\s+PublisherPolicy\b/g, hidCode) !== 1) errors.push("expected exactly one PublisherPolicy in host-identity");

  // 5. Fail-closed publisher policy: production policy empty, no approved publisher.
  const pp = read(path.join(idDir, "publisher_policy.rs"));
  if (!/approved:\s*Vec::new\(\)/.test(pp)) errors.push("production publisher policy no longer constructs an EMPTY approved set");

  // 6. Shared runtime stays safe: forbid(unsafe_code), no serde_json in src, facade only.
  const sharedLib = read(path.join(SHARED, "src", "lib.rs"));
  if (!/#!\[forbid\(unsafe_code\)\]/.test(sharedLib)) errors.push("shared-host-runtime lost #![forbid(unsafe_code)]");
  for (const f of sharedFiles) {
    const code = stripComments(read(f));
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (/serde_json/.test(code)) errors.push(rel + ": serde_json inside shared-host-runtime src");
    if (/unsafe\s*(fn|\{)/.test(code)) errors.push(rel + ": unsafe inside shared-host-runtime");
  }
  if (!/projectos-host-identity/.test(read(path.join(SHARED, "Cargo.toml"))))
    errors.push("shared-host-runtime does not depend on projectos-host-identity");

  // 7. The existing raw-event validator must remain intact (not weakened, no identity exclusion).
  const rawEv = read(path.join(__dirname, "validate-runtime-no-raw-string-events.cjs"));
  if (!/serde_json/.test(rawEv)) errors.push("raw-event validator lost its serde_json rule");
  if (/host-identity|identity\*\*|exclude.*identity/i.test(rawEv)) errors.push("raw-event validator gained an identity exclusion");

  // 8. Control Center: compatibility module only — no identity implementation, no direct
  //    host-identity dependency (must go through the shared runtime).
  const ccToml = stripTomlComments(read(path.join(CC, "Cargo.toml")));
  if (/projectos-host-identity/.test(ccToml)) errors.push("Control Center depends directly on host-identity (must use the shared facade)");
  if (!/projectos-shared-host-runtime/.test(ccToml)) errors.push("Control Center does not depend on the shared runtime");
  const ccLib = stripComments(read(path.join(CC, "src", "lib.rs")));
  if (!/projectos_shared_host_runtime::identity/.test(ccLib)) errors.push("Control Center compatibility module does not re-export the shared identity facade");
  const app = read(path.join(CC, "src", "app.rs"));
  if (!/use crate::identity::\{self, composite::IdentityStatusView\};/.test(app)) errors.push("app.rs identity call sites changed");
  if (/projectos_host_identity/.test(app)) errors.push("app.rs bypasses the compatibility boundary");
  const key = read(path.join(CC, "src", "instance", "key.rs"));
  if (!/use crate::identity::hash::sha256_hex;/.test(key)) errors.push("instance/key.rs identity call site changed");

  // 9. Primitives crate untouched by identity concerns (no reverse dependency).
  if (/projectos-host-identity/.test(read(path.join(PRIM, "Cargo.toml"))))
    errors.push("windows-runtime-primitives depends on host-identity (reverse edge)");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-host-identity-boundary] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-host-identity-boundary: PASS");
}
