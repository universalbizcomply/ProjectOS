"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-B. Prove the canonical identity/publisher-trust
// implementation lives EXACTLY ONCE in projectos-host-identity: the fifteen relocated source files
// and three relocated integration tests exist there and nowhere in the Control Center; unsafe FFI is
// confined to the two accepted files with SAFETY documentation; serde_json stays inside host-identity
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
  "authenticode.rs", "canonical.rs", "canonical_record.rs", "composite.rs", "errors.rs", "hash.rs",
  "install_root.rs", "manifest.rs", "mod.rs", "mode.rs", "paths.rs", "publisher_policy.rs",
  "running_executable.rs", "tests.rs", "types.rs", "verifier.rs",
];
const IDENTITY_TESTS = ["identity_authenticode.rs", "identity_composite.rs", "identity_installation.rs"];
const UNSAFE_ALLOWED = new Set(["authenticode.rs", "running_executable.rs"]);

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
  const idDir = path.join(HID, "src", "identity");
  for (const f of IDENTITY_FILES) {
    if (!fs.existsSync(path.join(idDir, f))) errors.push("missing relocated identity file: " + f);
  }
  const actualId = fs.existsSync(idDir) ? fs.readdirSync(idDir).filter((f) => f.endsWith(".rs")) : [];
  if (actualId.length !== IDENTITY_FILES.length)
    errors.push("host-identity identity file count " + actualId.length + " != " + IDENTITY_FILES.length);
  for (const t of IDENTITY_TESTS) {
    if (!fs.existsSync(path.join(HID, "tests", t))) errors.push("missing relocated identity test: " + t);
    if (fs.existsSync(path.join(CC, "tests", t))) errors.push("old Control Center identity test still exists: " + t);
  }
  if (fs.existsSync(path.join(CC, "src", "identity")))
    errors.push("old Control Center identity source directory still exists");

  // 3. Unsafe containment + SAFETY docs + serde_json confinement inside host-identity.
  for (const f of rsFiles(path.join(HID, "src"))) {
    const base = path.basename(f);
    const raw = read(f);
    const code = stripComments(raw);
    const unsafeUnits = count(/unsafe\s*(fn|\{)/g, code);
    if (unsafeUnits > 0 && !UNSAFE_ALLOWED.has(base))
      errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": unsafe outside the two accepted identity FFI files");
    if (unsafeUnits > 0 && count(/safety/gi, raw) < 1)
      errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": unsafe without SAFETY documentation");
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
