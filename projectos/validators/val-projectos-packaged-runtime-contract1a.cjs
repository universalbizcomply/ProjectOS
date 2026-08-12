"use strict";
// PROJECTOS-RECOVERY-INSTALLED-APP1A. Protect the packaged-runtime invariants that are now part of
// the product's actual safety, using REPOSITORY facts only.
//
// It performs no installation, no network access, no signing and no machine mutation. Everything it
// checks is a committed file: the packaging contract, the Tauri bundle declaration, the release
// pipeline and the provenance evidence. Nothing here builds a payload or reads one — a validator
// that needed 91 MB of build output would simply be skipped, and a skipped validator protects
// nothing.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const CONTRACT = path.join(ROOT, "projectos", "host", "packaged-runtime-contract");
const CONTROL_CENTER = path.join(ROOT, "projectos", "control-center");
const GENERATOR = path.join(ROOT, "projectos", "host", "packaged-manifest-generator");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
// Strip comments so documentation prose cannot satisfy — or trip — a code-pattern check.
function stripRustComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
// Remove a trailing `#[cfg(test)] mod tests { … }` block. Deliberately crude and deliberately
// last-match: a test module is the final item in these files, so cutting from its attribute to the
// end removes it without needing to balance braces.
function stripTestModule(src) {
  const at = src.search(/#\[cfg\((?:all\()?test[\s\S]*?\)\]\s*mod\s+tests/);
  return at === -1 ? src : src.slice(0, at);
}
function constOf(src, name) {
  const m = src.match(new RegExp(`${name}\\s*:\\s*&str\\s*=\\s*"([^"]*)"`));
  return m ? m[1] : null;
}

// ---- 1. the packaging contract exists and is a contract, not a placeholder ----------------------
const contractSrc = read(path.join(CONTRACT, "src", "lib.rs"));
const contractCode = stripRustComments(contractSrc);

const NODE_VERSION = constOf(contractCode, "PACKAGED_NODE_VERSION");
const NODE_SHA = constOf(contractCode, "PACKAGED_NODE_SHA256");
const APP_ID = constOf(contractCode, "PACKAGED_APPLICATION_ID");
const PAYLOAD_ROOT = constOf(contractCode, "PAYLOAD_RELATIVE_ROOT");

check(NODE_VERSION && /^\d+\.\d+\.\d+$/.test(NODE_VERSION),
  "packaging contract: PACKAGED_NODE_VERSION must be an exact dotted release");
check(NODE_SHA && /^[0-9a-f]{64}$/.test(NODE_SHA),
  "packaging contract: PACKAGED_NODE_SHA256 must be 64 lower-case hex characters");
check(APP_ID && APP_ID.length > 0, "packaging contract: PACKAGED_APPLICATION_ID must be declared");
check(PAYLOAD_ROOT && !PAYLOAD_ROOT.includes("..") && !path.isAbsolute(PAYLOAD_ROOT),
  "packaging contract: PAYLOAD_RELATIVE_ROOT must be a relative, traversal-free segment");

// The placeholder this phase removed must never come back.
check(!contractCode.includes("22.11.0"),
  "packaging contract: the unprovisioned 22.11.0 runtime placeholder has returned");

// ---- 2. the runtime pin is the digest nodejs.org published --------------------------------------
const checksumsRel = constOf(contractCode, "UPSTREAM_CHECKSUMS_FILE");
check(checksumsRel, "packaging contract: UPSTREAM_CHECKSUMS_FILE must be declared");
if (checksumsRel) {
  const checksumsPath = path.join(CONTRACT, checksumsRel);
  if (!fs.existsSync(checksumsPath)) {
    failures.push(`provenance: committed upstream checksums missing at ${checksumsRel}`);
  } else {
    const bytes = fs.readFileSync(checksumsPath);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    check(digest === constOf(contractCode, "UPSTREAM_CHECKSUMS_SHA256"),
      "provenance: the committed upstream checksum file no longer matches its recorded digest");
    const entry = constOf(contractCode, "UPSTREAM_CHECKSUMS_ENTRY");
    const wanted = `${NODE_SHA}  ${entry}`;
    check(bytes.toString("utf8").split(/\r?\n/).some((l) => l.trimEnd() === wanted),
      "provenance: the pinned runtime digest is not the published digest for " + entry);
  }
}

// ---- 3. ONE application identity ----------------------------------------------------------------
const tauriConf = JSON.parse(read(path.join(CONTROL_CENTER, "src-tauri", "tauri.conf.json")));
check(tauriConf.identifier === APP_ID,
  `application identity drift: tauri.conf.json says ${tauriConf.identifier}, contract says ${APP_ID}`);

const authoritySrc = stripRustComments(
  read(path.join(CONTROL_CENTER, "src-tauri", "src", "process", "authority.rs")),
);
check(/PACKAGED_APPLICATION_ID\s*:\s*&str\s*=\s*projectos_packaged_runtime_contract::PACKAGED_APPLICATION_ID/
  .test(authoritySrc),
  "the Control Centre must DERIVE its packaged application id from the packaging contract");
check(/PACKAGED_RUNTIME_VERSION\s*:\s*&str\s*=\s*\n?\s*projectos_packaged_runtime_contract::PACKAGED_NODE_VERSION/
  .test(authoritySrc),
  "the Control Centre must DERIVE its packaged runtime version from the packaging contract");

// ---- 4. the bundle packages the accepted model, not the old loose tree --------------------------
const resources = tauriConf.bundle && tauriConf.bundle.resources;
check(resources && !Array.isArray(resources),
  "tauri bundle.resources must be the MAP form, so the payload keeps its directory structure");
if (resources && !Array.isArray(resources)) {
  const dests = Object.values(resources);
  check(dests.includes(PAYLOAD_ROOT),
    `tauri bundle.resources must place the payload at ${PAYLOAD_ROOT}`);
  for (const dest of dests) {
    check(!dest.includes(".."),
      `tauri bundle.resources destination ${dest} must not traverse (Tauri maps .. to _up_)`);
  }
  const FORBIDDEN_SOURCES = ["node-build", "sidecar/host.mjs", "node_modules", "validators", "schemas"];
  for (const source of Object.keys(resources)) {
    for (const forbidden of FORBIDDEN_SOURCES) {
      check(!source.includes(forbidden),
        `tauri bundle.resources must not package ${forbidden} — the daemon bundle is closed`);
    }
  }
}

// ---- 5. the release pipeline is explicit and generates its own inputs ---------------------------
const pkg = JSON.parse(read(path.join(CONTROL_CENTER, "package.json")));
check(typeof pkg.scripts["release:payload"] === "string",
  "package.json must expose release:payload");
check(typeof pkg.scripts["release:prepare"] === "string",
  "package.json must expose release:prepare");
check(tauriConf.build.beforeBuildCommand === "npm run release:prepare",
  "tauri beforeBuildCommand must run the release pipeline, so a fresh checkout can package");

const pipeline = read(path.join(CONTROL_CENTER, "packaging", "build-release-payload.mjs"));
check(pipeline.includes("build-daemon-bundle.mjs"),
  "the release pipeline must build the daemon bundle");
check(pipeline.includes("projectos-manifest-gen"),
  "the release pipeline must run the manifest generator, which enforces dependency closure");

// ---- 6. closure has no override, and the tooling holds no private key ---------------------------
const genMain = stripRustComments(read(path.join(GENERATOR, "src", "main.rs")));
check(!/allow[-_]open[-_]closure|skip[-_]closure|--force/i.test(genMain),
  "the generator must have no dependency-closure override flag");
check(/is_closed\(\)/.test(genMain),
  "the generator must gate manifest generation on dependency closure");

// The tool's OWN test enumerates the forbidden strings in order to assert their absence, so the
// test module has to come out before the scan — exactly as the comments do. A scan that reads the
// list of things being forbidden as evidence of them is the same mistake in a different costume.
const signSrc = stripTestModule(
  stripRustComments(read(path.join(GENERATOR, "src", "bin", "projectos-manifest-sign.rs"))),
);
for (const forbidden of ["--private-key", "private_key", "BEGIN EC PRIVATE", "NCryptSignHash"]) {
  check(!signSrc.includes(forbidden),
    `the signing tool must have no private-key surface, found ${forbidden}`);
}

// ---- 7. the packaged daemon may not be handed a development configuration ------------------------
const packagedSpec = authoritySrc.match(
  /impl VerifiedPackagedDaemonLaunchAuthority[\s\S]*?\n}/,
);
check(packagedSpec && !packagedSpec[0].includes("DAEMON_BRIDGE_CONFIG_VAR"),
  "the packaged launch spec must not carry the development bridge configuration");

// ---- 8. the installer authors the canonical installation record ---------------------------------
//
// The runtime requires installer-owned evidence. If the MSI stops shipping the record, an
// installation silently loses its per-machine corroboration and its governed system root, and fails
// closed for a reason nobody changed on purpose. These checks make that a build failure instead.
const wix = (tauriConf.bundle.windows || {}).wix || {};
check(Array.isArray(wix.fragmentPaths) && wix.fragmentPaths.length > 0,
  "tauri wix.fragmentPaths must reference the installation-record fragment");
check(Array.isArray(wix.componentGroupRefs) &&
      wix.componentGroupRefs.includes("ProjectOSInstallationRecord"),
  "tauri wix.componentGroupRefs must include ProjectOSInstallationRecord, or the fragment is compiled but never installed");

const fragmentTemplate = read(path.join(CONTROL_CENTER, "packaging", "installation-record.wxs.template"));
check(fragmentTemplate.includes("CommonAppDataFolder"),
  "the record must be installed beneath ProgramData via CommonAppDataFolder, not a literal path");
for (const segment of ["ProjectOS", "host", "installation", "application.v1.json"]) {
  check(fragmentTemplate.includes(segment),
    `the record fragment must use the canonical path segment ${segment}`);
}
// Uninstall ownership: without these the trust record outlives the product that vouched for it.
//
// Deliberately NOT a regex. The first attempt used `[\s\S]` inside a JS TEMPLATE LITERAL, where the
// backslashes are consumed by the string before the RegExp ever sees them — the pattern became
// `[sS]` and matched nothing, so a correct fragment was reported broken. Two plain substring checks
// say the same thing and cannot be mis-escaped.
check(fragmentTemplate.split("<RemoveFolder").length - 1 === 3,
  "the record fragment must declare exactly three RemoveFolder entries");
for (const dir of ["PROJECTOS_INSTALLATION_DIR", "PROJECTOS_HOST_STATE_DIR", "PROJECTOS_PROGRAMDATA_DIR"]) {
  check(fragmentTemplate.includes(`Directory="${dir}"`),
    `the record fragment must remove ${dir} on uninstall`);
}
check(/KeyPath="yes"/.test(fragmentTemplate),
  "the record file must be its component KeyPath, so uninstall and rollback own it");

// The record's CONTENT comes from the canonical model, never hand-written JSON in XML.
check(!/schemaVersion|recordDigest/.test(fragmentTemplate),
  "the record fragment must not author record JSON; the canonical model emits it");
const recordTool = stripTestModule(stripRustComments(
  read(path.join(GENERATOR, "src", "bin", "projectos-install-record.rs"))));
check(/InstalledApplicationRecordV1/.test(recordTool) &&
      /compute_application_record_digest/.test(recordTool),
  "the record generator must build the record from the canonical model and digest");
check(/verify_application_record/.test(recordTool),
  "the record generator must verify with the real reader before writing");
// What the record may CARRY is a property of the MODEL, not of the tool's help text. The first
// version scanned the tool's source and tripped on the line that says the record carries no trust
// anchor — forbidding the word rather than the field. The fields are what matter.
const recordModel = stripTestModule(stripRustComments(read(
  path.join(ROOT, "projectos", "host", "host-identity", "src", "identity", "installed_application.rs"),
)));
const structBody = (recordModel.match(/pub struct InstalledApplicationRecordV1 \{[\s\S]*?\n\}/) || [""])[0];
check(structBody.length > 0, "the installed-application record model must be present");
for (const forbidden of ["private", "secret", "password", "anchor", "public_key", "signature", "algorithm"]) {
  check(!structBody.includes(forbidden),
    `the installation record model must have no ${forbidden} field`);
}
check(!recordTool.includes("--private-key") && !recordTool.includes("private_key"),
  "the record generator must have no private-key surface");

const pipelineRecord = read(path.join(CONTROL_CENTER, "packaging", "build-release-payload.mjs"));
check(pipelineRecord.includes("projectos-install-record"),
  "the release pipeline must generate the installation record");
check(pipelineRecord.includes("@RECORD_SOURCE@"),
  "the release pipeline must expand the installation-record fragment template");

// ---- 9. the install root is FIXED, and cannot drift back ----------------------------------------
//
// The canonical record names ONE install root and the runtime refuses a mismatch, so an installer
// that lets a user pick a different directory offers a choice that produces an installation
// ProjectOS will not run. The custom WiX template exists solely to remove that choice; these checks
// exist so it cannot be silently undone.
check(typeof wix.template === "string" && wix.template.length > 0,
  "tauri wix.template must point at the ProjectOS WiX template that fixes the install root");
const templatePath = path.join(CONTROL_CENTER, "src-tauri", wix.template);
if (!fs.existsSync(templatePath)) {
  failures.push(`the WiX template is missing at ${wix.template}`);
} else {
  const template = read(templatePath);
  // TWO VIEWS, DELIBERATELY. The DELTA markers live in XML comments, so the marker check needs the
  // full text. The forbidden-token checks must NOT read those same comments: each delta explains
  // what it removed, and naming the removed thing is exactly how a comment-blind scan reports a
  // correct template as broken. Markup is what ships; prose is not.
  const markup = template.replace(/<!--[\s\S]*?-->/g, " ");

  // The three intentional differences from Tauri's own template, each marked so a reviewer can find
  // them and a silent revert is visible.
  for (const delta of ["PROJECTOS DELTA 1 of 3", "PROJECTOS DELTA 2 of 3", "PROJECTOS DELTA 3 of 3"]) {
    check(template.includes(delta), `the WiX template must retain ${delta}`);
  }

  // DELTA 1: a UI set that does not CONTAIN a directory dialog, rather than one that merely hides it.
  // An absent dialog is readable from the MSI's own Dialog table; an unreachable one is not.
  check(markup.includes('<UIRef Id="WixUI_Minimal" />'),
    "the WiX template must use WixUI_Minimal, which contains no InstallDirDlg");
  check(!markup.includes("WixUI_InstallDir"),
    "the WiX template must not reference WixUI_InstallDir");
  check(!markup.includes("InstallDirDlg"),
    "the WiX template must not name InstallDirDlg in markup");
  check(!markup.includes("WIXUI_INSTALLDIR"),
    "the WiX template must not set WIXUI_INSTALLDIR; there is no directory dialog to point at");

  // DELTA 2: no feature may be redirected.
  check(!markup.includes("ConfigurableDirectory"),
    "no feature may declare ConfigurableDirectory, or INSTALLDIR becomes selectable again");

  // DELTA 3: no previous-install registry value may move the install root. A stale key left by an
  // earlier install would relocate the installation without the installer ever asking.
  check(!markup.includes("PrevInstallDir"),
    "the WiX template must not search the registry for a previous install directory");
  check(!/<RegistrySearch[^>]*INSTALLDIR/.test(markup) && !/Property Id="INSTALLDIR"/.test(markup),
    "nothing may set the INSTALLDIR property from a search or a property default");

  // ---- the UI surface itself, constrained POSITIVELY -------------------------------------------
  //
  // WHY THE CHECKS ABOVE ARE NOT ENOUGH. They deny the specific names WixUI's own directory dialog
  // uses. That makes them a denylist, and a denylist only stops the author who reuses those names.
  // A hand-written dialog with any other Id, holding a PathEdit control bound to INSTALLDIR and
  // reached by a NewDialog publish, satisfies every check above while restoring exactly the choice
  // this template exists to remove. Naming forbidden things cannot establish that no unnamed thing
  // exists — only a positive constraint on what the template may contain can.
  //
  // So: this template declares NO dialogs and NO controls of its own. Every dialog in the built MSI
  // comes from the referenced WixUI library set, which is what makes "WixUI_Minimal contains no
  // InstallDirDlg" a complete statement rather than a partial one. Any dialog or control authored
  // here is outside the reviewed surface and must fail, whatever it is called.
  const dialogElements = (markup.match(/<Dialog[\s>]/g) || []).length;
  const controlElements = (markup.match(/<Control[\s>]/g) || []).length;
  check(dialogElements === 0,
    `the WiX template must author no dialogs of its own (found ${dialogElements}); ` +
    "all dialogs must come from the referenced WixUI set, or the InstallDirDlg argument is void");
  check(controlElements === 0,
    `the WiX template must author no controls of its own (found ${controlElements}); ` +
    "a control bound to INSTALLDIR reintroduces the directory chooser under any name");

  // Exactly ONE UI set may be referenced, and only one that contains no directory dialog.
  const uiRefs = markup.match(/<UIRef\s+Id="([^"]+)"/g) || [];
  check(uiRefs.length === 1, `exactly one UIRef is expected, found ${uiRefs.length}`);
  const UI_SETS_WITHOUT_A_DIRECTORY_DIALOG = ["WixUI_Minimal"];
  for (const ref of uiRefs) {
    const id = ref.match(/Id="([^"]+)"/)[1];
    check(UI_SETS_WITHOUT_A_DIRECTORY_DIALOG.includes(id),
      `UI set ${id} is not known to be free of a directory dialog`);
  }

  // The only publish this template may author is the launch-app checkbox. A NewDialog publish is
  // how a custom dialog would be reached, and SetTargetPath is how one would move the install root.
  const publishes = markup.match(/<Publish\b[^>]*>/g) || [];
  check(publishes.length === 1,
    `the WiX template must author exactly one Publish (the launch-app checkbox), found ${publishes.length}`);
  for (const p of publishes) {
    check(!/Event="NewDialog"/.test(p), "no Publish may route to another dialog");
    check(!/Event="SetTargetPath"/.test(p), "no Publish may set the target path");
  }
  check(!markup.includes("SetTargetPath"),
    "nothing in the template may set the install target path");
  for (const controlType of ["PathEdit", "DirectoryCombo", "DirectoryList", "SelectionTree"]) {
    check(!markup.includes(controlType),
      `the WiX template must contain no ${controlType} control`);
  }

  // The install root itself: derived from the platform Program Files folder, never a literal path.
  check(/<Directory Id="INSTALLDIR"/.test(markup),
    "the WiX template must declare INSTALLDIR");
  check(markup.includes("PlatformProgramFilesFolder") || markup.includes("ProgramFiles64Folder"),
    "INSTALLDIR must sit beneath the platform Program Files folder");
  // Per-machine, or the record's per-machine scope is a lie the runtime will refuse. WiX compiles
  // InstallScope="perMachine" to ALLUSERS=1; the source form is what this file controls.
  check(/InstallScope="perMachine"/.test(markup),
    "the MSI must be per-machine to match the record's installation scope");
}

// ---- 10. the vendored template is pinned to the Tauri that produced it --------------------------
//
// The template above is a SNAPSHOT of Tauri's own, taken from the CLI that was installed when this
// increment was written, with three marked deltas. That freezes it: a later Tauri release can fix
// its template — new required properties, WiX-toolset compatibility, escaping — and this build will
// keep succeeding against the stale copy, silently, because the copy is what Tauri is told to use.
// Nothing about a successful build would reveal the drift.
//
// This does not diff the two templates, which would need the CLI's native binary unpacked. It does
// the one thing that makes the drift IMPOSSIBLE TO MISS: pins the CLI version the snapshot was taken
// from. A Tauri bump fails here, and the fix is to re-extract the template, re-apply the three
// deltas, and re-inspect the built MSI — not to raise this number.
const TEMPLATE_SNAPSHOT_TAURI_CLI = "2.11.4";
const cliPkgPath = path.join(CONTROL_CENTER, "node_modules", "@tauri-apps", "cli", "package.json");
if (!fs.existsSync(cliPkgPath)) {
  // Dependencies not installed. Not a drift signal, and not something to fail a repository check on.
  console.error("  note: @tauri-apps/cli is not installed; template pin not checked");
} else {
  const cliVersion = JSON.parse(read(cliPkgPath)).version;
  check(cliVersion === TEMPLATE_SNAPSHOT_TAURI_CLI,
    `the vendored WiX template was taken from @tauri-apps/cli ${TEMPLATE_SNAPSHOT_TAURI_CLI} but ` +
    `${cliVersion} is installed — re-extract the template, re-apply the three deltas, and ` +
    "re-inspect the built MSI before updating this pin");
}

// THE INVARIANT ITSELF. The installer is fixed to <ProgramFiles>\<ProductName>; the record it writes
// must name that same directory, because the runtime compares the record against the directory the
// executable actually runs from and refuses a mismatch. These are two halves of one equality — if
// they diverge, the installer produces an installation ProjectOS will not launch.
const productName = String(tauriConf.productName || "").trim();
check(productName.length > 0, "tauri productName must be set; it names the install directory");
check(pipelineRecord.includes("Program Files") && pipelineRecord.includes("PRODUCT_NAME"),
  "the record's install root must be composed from Program Files and the product name");
check(pipelineRecord.includes("--install-root"),
  "the release pipeline must pass the fixed install root to the record generator");

// ---- report --------------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("val-projectos-packaged-runtime-contract1a FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("val-projectos-packaged-runtime-contract1a OK");
