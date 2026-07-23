"use strict";
// CD-B4-ELEVATION-OBSERVATION-ENGINE1A — boundary for the INTERNAL current-process elevation
// observation engine in host-authority.
//
// The engine is a private, feature-gated module: no dependent can reach it, it mints no witness, and
// its real Windows backend is compiled but never executed this phase. This validator proves the source
// boundary AND compiles disposable external consumers to prove — by rustc, not by text — that the
// module and its types are genuinely unreachable, and that the observation + fixture features refuse to
// co-compile.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CRATE = path.join(ROOT, "projectos", "host", "host-authority");
const CRATE_TOML = CRATE.replace(/\\/g, "/");
const SRC = path.join(CRATE, "src");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

let WORK = null;
function workdir() {
  if (!WORK) WORK = fs.mkdtempSync(path.join(os.tmpdir(), "projectos-b4-elevation-"));
  return WORK;
}

/** Compile a disposable external consumer of host-authority with the given features. */
function compileConsumer(name, features, body, run) {
  const dir = path.join(workdir(), name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const feat = features.length
    ? ", features = [" + features.map((f) => '"' + f + '"').join(", ") + "]"
    : "";
  fs.writeFileSync(
    path.join(dir, "Cargo.toml"),
    [
      "[workspace]",
      "",
      "[package]",
      'name = "' + name.replace(/[^a-z0-9_]/g, "_") + '"',
      'version = "0.0.0"',
      'edition = "2021"',
      "publish = false",
      "",
      "[dependencies]",
      'projectos-host-authority = { path = "' + CRATE_TOML + '"' + feat + " }",
      "",
    ].join("\n")
  );
  fs.writeFileSync(path.join(dir, "src", "main.rs"), body);
  const args = run ? ["run", "--offline", "--quiet"] : ["build", "--offline", "--quiet"];
  const r = spawnSync("cargo", args, {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CARGO_TARGET_DIR: path.join(workdir(), "target") },
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

const OBS = ["windows-elevation-observation"];

/** Every one MUST fail to compile, and MUST fail for one of the listed reasons. */
const NEGATIVES = [
  ["neg_default_module", [], "elevation module reachable in the DEFAULT graph",
   "fn main() { let _ = projectos_host_authority::elevation::observe; }",
   ["E0433", "E0603"]],
  ["neg_default_type", [], "observation type reachable in the DEFAULT graph",
   "use projectos_host_authority::elevation::ElevationObservation;\nfn main() { let _ = ElevationObservation::Elevated; }",
   ["E0432", "E0433", "E0603"]],
  ["neg_feature_module_private", OBS, "private module reachable even with the feature enabled",
   "fn main() { let _ = projectos_host_authority::elevation::observe; }",
   ["E0603", "E0433"]],
  ["neg_feature_type_private", OBS, "observation type constructible with the feature enabled",
   "use projectos_host_authority::elevation::ElevationObservation;\nfn main() { let _ = ElevationObservation::Elevated; }",
   ["E0603", "E0432", "E0433"]],
  ["neg_feature_real_source", OBS, "real Windows source reachable with the feature enabled",
   "fn main() { let _ = projectos_host_authority::elevation::WindowsElevationSource; }",
   ["E0603", "E0433"]],
  ["neg_feature_classify", OBS, "pure classifier reachable with the feature enabled",
   "fn main() { let _ = projectos_host_authority::elevation::classify; }",
   ["E0603", "E0433"]],
  // The observation + fixtures combination must refuse to compile via the crate's compile_error!.
  ["neg_feature_conflict", ["windows-elevation-observation", "effect-witness-fixtures"],
   "observation + fixtures compiled together",
   "fn main() {}",
   ["mutually exclusive"]],
];

function run() {
  const errors = [];
  if (!fs.existsSync(CRATE)) return ["host-authority crate missing: " + CRATE];

  // ---- 1. Path boundary: only the seven authorised paths differ from HEAD -----------------------
  // (Enforced by the commit gate; here we assert the elevation source exists and is not misnamed.)
  const elevationPath = path.join(SRC, "elevation.rs");
  if (!fs.existsSync(elevationPath)) return ["elevation.rs missing: " + elevationPath];
  for (const bad of ["token.rs", "elevation_token.rs", "process_token.rs"]) {
    if (fs.existsSync(path.join(SRC, bad)))
      errors.push("a gitignore-trapped filename exists: " + bad);
  }
  const elevationRaw = read(elevationPath);
  const elevation = stripComments(elevationRaw);

  // ---- 2. Feature declaration + default separation ----------------------------------------------
  const toml = read(path.join(CRATE, "Cargo.toml"));
  if (!/windows-elevation-observation\s*=\s*\["dep:windows",\s*"dep:projectos-windows-runtime-primitives"\]/.test(toml))
    errors.push("windows-elevation-observation must enable exactly the two existing optional deps");
  if (/^\s*default\s*=\s*\[[^\]]*windows-elevation-observation/m.test(toml))
    errors.push("default enables windows-elevation-observation");
  const tf = (toml.match(/^test-fixtures\s*=\s*\[[\s\S]*?\]/m) || [""])[0];
  const ewf = (toml.match(/effect-witness-fixtures\s*=\s*\[[\s\S]*?\]/) || [""])[0];
  if (/windows-elevation-observation/.test(tf) || /windows-elevation-observation/.test(ewf))
    errors.push("another feature implies windows-elevation-observation");

  // ---- 3. Module visibility + feature conflict --------------------------------------------------
  const lib = stripComments(read(path.join(SRC, "lib.rs")));
  if (!/#\[cfg\(all\(windows,\s*feature\s*=\s*"windows-elevation-observation"\)\)\]\s*mod elevation;/.test(lib))
    errors.push("elevation is not a private module gated to windows + the feature");
  if (/pub\s+mod elevation/.test(lib)) errors.push("elevation module is publicly exported");
  if (!/compile_error!/.test(lib))
    errors.push("no compile_error! guarding the feature conflict");

  // ---- 4. Windows-only containment: no elevation FFI outside elevation.rs -----------------------
  const otherSrc = fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith(".rs") && f !== "elevation.rs")
    .map((f) => stripComments(read(path.join(SRC, f))));
  for (const code of otherSrc) {
    if (/OpenProcessToken|GetTokenInformation|TokenElevation\b|TokenElevationType/.test(code))
      errors.push("an elevation-token API leaked outside elevation.rs");
  }

  // ---- 5. Current-process only, TOKEN_QUERY only, minimal allowlist, no forbidden API -----------
  if (!/GetCurrentProcess/.test(elevation)) errors.push("engine does not observe the current process");
  if (!/TOKEN_QUERY/.test(elevation)) errors.push("engine does not request TOKEN_QUERY");
  const API_FORBIDDEN = [
    "CheckTokenMembership", "IsUserAnAdmin", "TokenUser", "TokenGroups", "TokenPrivileges",
    "LookupAccountSid", "OpenProcess\\b", "DuplicateToken", "AdjustTokenPrivileges",
    "SetTokenInformation", "ImpersonateLoggedOnUser", "ShellExecute", "runas",
    "TOKEN_DUPLICATE", "TOKEN_ADJUST", "TOKEN_ALL_ACCESS", "CreateProcess", "std::process",
  ];
  for (const bad of API_FORBIDDEN) {
    if (new RegExp(bad).test(elevation)) errors.push("engine contains forbidden API/right: " + bad);
  }
  // No caller-supplied target: the engine takes no PID / handle / bool / legacy-enum parameter.
  // (classify_open_failure legitimately takes an access-denied bool, so exempt it.)
  if (/fn\s+(?!classify_open_failure)\w+\s*\([^)]*:\s*(u32|HANDLE|bool|Elevation)\b/.test(elevation))
    errors.push("engine accepts a caller-supplied PID/handle/bool/legacy-elevation parameter");

  // ---- 5b. Access-denied distinction: TokenOpenDenied must be REACHABLE from the real backend ----
  // The real backend must inspect the open error for access-denied (not collapse every failure) and
  // route it through the SAME shared classifier the tests exercise.
  const prodPart = elevation.replace(/#\[cfg\(test\)\][\s\S]*$/, "");
  const testPart = elevation.slice(prodPart.length);
  if (!/fn\s+classify_open_failure/.test(prodPart))
    errors.push("no shared classify_open_failure decision");
  // The shared classifier must genuinely branch on access-denied → Denied, else → Unavailable.
  const clfBody = /fn classify_open_failure[\s\S]*?\n\}/.exec(prodPart);
  if (!clfBody || !/access_denied[\s\S]*?TokenOpen::Denied/.test(clfBody[0]) ||
      !/TokenOpen::Unavailable/.test(clfBody[0]))
    errors.push("classify_open_failure does not map access-denied→Denied and other→Unavailable");
  // The real Windows open path must actually consult it, on the error, via ERROR_ACCESS_DENIED.
  if (!/ERROR_ACCESS_DENIED/.test(prodPart))
    errors.push("real backend does not distinguish ERROR_ACCESS_DENIED");
  if (!/classify_open_failure\(access_denied\)/.test(prodPart))
    errors.push("real backend does not route its open failure through the shared classifier");
  // It must NOT collapse every open failure straight to Unavailable (the defect being amended).
  if (/opened\.is_err\(\)\s*\{\s*return TokenOpen::Unavailable/.test(prodPart) ||
      /is_err\(\)[\s\S]{0,80}?return TokenOpen::Unavailable;/.test(prodPart))
    errors.push("real backend still collapses all open failures to Unavailable");
  // The raw error is transient only: it must not be stored in the observation, rendered or logged.
  if (/ElevationObservation::\w+\([^)]*err|enum[\s\S]*?:\s*windows::core::Error/.test(prodPart))
    errors.push("a raw error is carried into the observation");
  if (/println!|eprintln!|log::|tracing::|\.to_string\(\)|format!\([^)]*err/.test(prodPart))
    errors.push("the real backend renders or logs an error");
  // The tests must exercise the SAME classifier (both branches), not a disconnected copy.
  if (!/classify_open_failure/.test(testPart))
    errors.push("tests do not exercise the shared classify_open_failure");
  if (!/access_denied:\s*true/.test(testPart) || !/access_denied:\s*false/.test(testPart))
    errors.push("tests do not cover both access-denied and non-access-denied open failures");
  if (!/TokenOpenDenied/.test(testPart))
    errors.push("tests do not assert TokenOpenDenied is reachable");

  // ---- 6. Unsafe confinement + SAFETY on every unit ---------------------------------------------
  const unsafeUnits = (elevation.match(/unsafe\s*(fn|\{)/g) || []).length;
  const safety = (elevationRaw.match(/\/\/\s*SAFETY:/g) || []).length;
  if (unsafeUnits === 0) errors.push("engine has no unsafe unit — real backend missing");
  if (safety < unsafeUnits)
    errors.push("undocumented unsafe (SAFETY " + safety + " < unsafe " + unsafeUnits + ")");
  // Canonical handle adoption; no local handle wrapper/Drop/CloseHandle/FromRawHandle in production code.
  const prod = elevation.replace(/#\[cfg\(test\)\][\s\S]*$/, "");
  if (!/handles::adopt/.test(prod)) errors.push("engine does not adopt via handles::adopt");
  if (!/handles::win32/.test(prod)) errors.push("engine does not borrow via handles::win32");
  if (/from_raw_handle/.test(prod)) errors.push("engine adopts a handle directly (use handles::adopt)");
  if (/CloseHandle/.test(prod)) errors.push("engine closes a handle directly (OwnedHandle owns the close)");
  if (/impl\s+Drop\s+for\b/.test(prod)) errors.push("engine defines a Drop in production code");

  // ---- 7. No witness minting, no grant/capability production, no public observer ----------------
  if (/pub\s+fn\s+observe|pub\s+fn\s+classify/.test(elevation))
    errors.push("engine exposes a public observer/classifier");
  for (const bad of [
    "VerifiedElevationWitness", "synthetic_witnesses", "synthetic_owner_witness",
    "EffectContextBinding", "AuthorisedProofAttemptGrant", "into_typed_grants",
    "into_witness", "from_observation", "mint", "authorise", "from_bool", "from_legacy",
    "ScmEffectGrant", "IpcEffectGrant", "InstanceObservationEffectGrant",
  ]) {
    if (new RegExp("\\b" + bad + "\\b").test(elevation))
      errors.push("engine references a witness/grant/capability route: " + bad);
  }
  if (!/ElevationObservation::Elevated/.test(elevation))
    errors.push("engine lacks the closed Elevated classification");
  // Redaction: the observation renders no raw identity.
  if (!/ElevationObservation\(\[REDACTED\]\)/.test(elevation))
    errors.push("ElevationObservation Debug is not redacted");

  // ---- 8. Synthetic behavioural tests + drop-count proof ----------------------------------------
  const testBlock = /#\[cfg\(test\)\]\s*mod tests\{?[\s\S]*$/.exec(elevationRaw) ||
    /#\[cfg\(test\)\]\s*mod tests[\s\S]*$/.exec(elevationRaw);
  if (!testBlock) errors.push("no synthetic test module in elevation.rs");
  else {
    const t = testBlock[0];
    if (!/Scripted|scripted/.test(t)) errors.push("tests do not use a scripted/synthetic backend");
    if (/WindowsElevationSource/.test(t))
      errors.push("tests reference the REAL Windows source (must be synthetic only)");
    if (!/impl\s+Drop\s+for\s+\w*Guard/.test(t)) errors.push("no drop-counting guard in tests");
    if (!/assert_eq!\(drops(\.get\(\))?,\s*1/.test(t) && !/drops,\s*1/.test(t))
      errors.push("no exactly-once drop-count assertion");
    if (!/ELEVATION_OBSERVATION_ENGINE_OK/.test(t)) errors.push("missing positive marker in tests");
  }

  // ---- 9. Truthful phase state ------------------------------------------------------------------
  if (/EXECUTION_READY\s*:\s*bool\s*=\s*true/.test(lib)) errors.push("execution readiness became true");

  // ---- 10. Compile proofs -----------------------------------------------------------------------
  for (const [name, feats, why, body, reasons] of NEGATIVES) {
    const r = compileConsumer(name, feats, body, false);
    if (r.ok) {
      errors.push("REACHABLE — " + why + " (" + name + " compiled)");
      continue;
    }
    if (!reasons.some((c) => r.out.includes(c))) {
      const seen = (r.out.match(/error\[E\d+\]/g) || ["<no code>"]).slice(0, 3).join(",");
      errors.push(name + " failed for the WRONG reason: expected " + reasons.join("/") + ", saw " + seen);
    }
  }

  return errors;
}

function cleanup() {
  if (WORK && fs.existsSync(WORK)) {
    try {
      fs.rmSync(WORK, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a locked build artefact in the OS temp dir is not a validation failure */
    }
  }
}

module.exports = {
  run: () => {
    try {
      return run();
    } finally {
      cleanup();
    }
  },
};

if (require.main === module) {
  const errs = module.exports.run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-elevation-observation-engine1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-elevation-observation-engine1a: PASS");
}
