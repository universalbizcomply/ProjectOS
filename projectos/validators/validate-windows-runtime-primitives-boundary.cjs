"use strict";
// WINDOWS-PACKAGED-HOST-TRUST-ENFORCEMENT3K-I-C-A. Prove the extracted low-level primitive crate is
// exactly a Win32 owned-handle RAII wrapper + a build-mode classifier, and nothing else: no policy,
// no effect route, unsafe confined to handles.rs + system_random.rs with SAFETY docs, exactly one AppMode/detect_app_mode
// production definition, the old Control Center process/handles.rs gone, and no duplicate/handle or
// AppMode implementation left behind in the Control Center. Comments stripped; structural checks.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "windows-runtime-primitives");
const CC = path.join(ROOT, "projectos", "control-center", "src-tauri");

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
function count(re, s) {
  const m = s.match(re);
  return m ? m.length : 0;
}

// Effect / policy routes the primitive must NEVER contain.
const FORBIDDEN = [
  { re: /\btauri\b/i, why: "tauri reference" },
  { re: /std::process|Command::new|CreateProcess|ShellExecute|powershell|cmd\.exe|sc\.exe/, why: "process-launch route" },
  { re: /CreateNamedPipe|ConnectNamedPipe/, why: "named-pipe route" },
  { re: /CreateMutex|OpenMutex/, why: "mutex/instance route" },
  { re: /OpenSCManager|CreateServiceW?|StartServiceW?|DeleteService|ChangeServiceConfig/, why: "service-management route" },
  { re: /RegCreate|RegSetValue|RegOpenKey/, why: "registry-mutation route" },
  { re: /ProgramData/, why: "ProgramData route" },
  { re: /SetNamedSecurityInfo|SetSecurityDescriptorDacl|InitializeAcl|AddAccessAllowedAce|SDDL/, why: "ACL/DACL policy route" },
  { re: /LookupAccountName|LookupAccountSid|ConvertSidToStringSid/, why: "SID-lookup route" },
  { re: /CredRead|CredWrite|CryptProtectData|CryptUnprotectData|\bGCM\b|\bPAT\b/, why: "credential/GCM/PAT route" },
  { re: /\bgithub\b/i, why: "GitHub route" },
  { re: /TcpStream|reqwest|hyper::|ureq/, why: "network-client route" },
  { re: /CertCreateSelfSign|CryptSignMessage|SignerSign/, why: "signing/cert-generation route" },
  { re: /DaemonLaunchAuthority|resolve_launch_authority/, why: "launch-authority definition leaked into primitive" },
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["primitive crate directory missing: " + CRATE];

  // 1. Manifest identity.
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/name\s*=\s*"projectos-windows-runtime-primitives"/.test(toml))
    errors.push("Cargo.toml package name is not projectos-windows-runtime-primitives");
  if (!/publish\s*=\s*false/.test(toml)) errors.push("Cargo.toml is not publish=false");
  if (/\btauri\b/i.test(toml)) errors.push("Cargo.toml references tauri");

  // 2. Primitive source: forbidden routes + unsafe containment.
  // Exactly these two modules may contain unsafe, each for one documented primitive: the owned-handle
  // RAII wrapper, and (CLOSEOUT1B) the single system-preferred CSPRNG fill. Every other file must be
  // unsafe-free, and BOTH allowed modules must document every unsafe unit they contain.
  const UNSAFE_MODULES = ["handles.rs", "system_random.rs"];
  const files = rsFiles(path.join(CRATE, "src"));
  const unsafeUnitsBy = {};
  const safetyMentionsBy = {};
  let appModeEnumDefs = 0;
  let detectFnDefs = 0;
  for (const f of files) {
    const base = path.basename(f);
    const raw = read(f);
    const code = stripComments(raw);
    for (const { re, why } of FORBIDDEN) {
      if (re.test(code)) errors.push(path.relative(ROOT, f).replace(/\\/g, "/") + ": " + why);
    }
    const unsafeUnits = count(/unsafe\s*(fn|\{)/g, code);
    if (UNSAFE_MODULES.includes(base)) {
      unsafeUnitsBy[base] = unsafeUnits;
      safetyMentionsBy[base] = count(/safety/gi, raw); // include comments: SAFETY docs
    } else if (unsafeUnits > 0) {
      errors.push(
        path.relative(ROOT, f).replace(/\\/g, "/") +
          ": unsafe outside " +
          UNSAFE_MODULES.join(" / ")
      );
    }
    if (base === "app_mode.rs") {
      appModeEnumDefs += count(/enum\s+AppMode\b/g, code);
      detectFnDefs += count(/fn\s+detect_app_mode\b/g, code);
    }
  }
  for (const m of UNSAFE_MODULES) {
    const units = unsafeUnitsBy[m];
    if (units === undefined) {
      errors.push(m + " is missing — the primitive it holds is not in this crate");
      continue;
    }
    if (units === 0) errors.push(m + " has no unsafe unit — primitive move incomplete");
    if (safetyMentionsBy[m] < units)
      errors.push(
        m +
          " has undocumented unsafe (safety mentions " +
          safetyMentionsBy[m] +
          " < unsafe units " +
          units +
          ")"
      );
  }

  // 3. Exactly one production AppMode + detect_app_mode definition, and it is in the primitive.
  if (appModeEnumDefs !== 1) errors.push("expected exactly one AppMode enum in the primitive, found " + appModeEnumDefs);
  if (detectFnDefs !== 1) errors.push("expected exactly one detect_app_mode fn in the primitive, found " + detectFnDefs);

  // 4. Old Control Center handles.rs gone; no duplicate handle/AppMode implementation in the CC.
  if (fs.existsSync(path.join(CC, "src", "process", "handles.rs")))
    errors.push("old Control Center process/handles.rs still exists");
  for (const f of rsFiles(path.join(CC, "src"))) {
    const code = stripComments(read(f));
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    if (/enum\s+AppMode\b/.test(code)) errors.push(rel + ": duplicate AppMode definition in Control Center");
    if (/fn\s+detect_app_mode\b/.test(code)) errors.push(rel + ": duplicate detect_app_mode definition in Control Center");
    if (/super::handles|crate::process::handles/.test(code)) errors.push(rel + ": stale handles module reference");
    if (/mod\s+handles\b/.test(code)) errors.push(rel + ": stale handles module declaration");
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[validate-windows-runtime-primitives-boundary] FAIL: " + e));
    process.exit(1);
  }
  console.log("validate-windows-runtime-primitives-boundary: PASS");
}
