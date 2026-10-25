// Validator: PROJECTOSHOST-BUILD-PROVENANCE-CAPTURE1A
//
// Fails closed. Pins the committed deterministic production-build contract for ProjectOSHost so that a
// later change cannot silently make the service binary non-reproducible, cannot drop the Windows feature
// graph the binary depends on, and cannot pull the fixture graph into a production build.
//
// Background: two clean release builds were byte-identical in code and data but differed in 28 bytes —
// the PE COFF TimeDateStamp, three debug-directory TimeDateStamps and the CodeView PDB GUID. All five
// are MSVC linker output, so `-Cdebuginfo=0` does not affect them. `/Brepro` makes the link
// deterministic, and with it two independent builds are byte-identical.
//
// What this asserts:
//   B1  the deterministic build config exists at the committed path
//   B2  it carries the `/Brepro` link argument
//   B3  the flag is target-scoped to x86_64-pc-windows-msvc, not applied to every target
//   B4  a committed production build command (cargo alias) exists and pins the release profile
//   B5  the recorded command passes NO `--features` — the Windows graph must come from the manifest
//   B6  the `[target.'cfg(windows)'.dependencies]` block still supplies `windows-live-ipc`
//   B7  `test-fixtures` is NOT enabled anywhere in the service-host manifest
//
// It deliberately does NOT run cargo, hash a binary or touch the installed service: this is a static
// contract check. The byte-identity evidence lives in the phase report.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SERVICE_HOST = path.join(ROOT, "projectos", "host", "service-host");
const BUILD_CONFIG = path.join(SERVICE_HOST, ".cargo", "config.toml");
const MANIFEST = path.join(SERVICE_HOST, "Cargo.toml");

/** The exact linker argument that makes the MSVC link deterministic. */
const REPRO_FLAG = "-Clink-arg=/Brepro";
/** The target the flag must be scoped to. `/Brepro` is not valid for non-MSVC linkers. */
const MSVC_TARGET = "[target.x86_64-pc-windows-msvc]";
/** The committed production build command. */
const ALIAS_SECTION = "[alias]";
const ALIAS_NAME = "production";

/** Strip TOML comments so a commented-out flag can never satisfy an assertion. */
function stripComments(toml) {
  return toml
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("#");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

function run() {
  const e = [];

  // B1 — the config must exist.
  if (!fs.existsSync(BUILD_CONFIG)) {
    e.push("B1 deterministic build config missing: projectos/host/service-host/.cargo/config.toml");
    return e;
  }
  const raw = fs.readFileSync(BUILD_CONFIG, "utf8");
  const cfg = stripComments(raw);

  // B2 — the /Brepro link argument must be present in live (non-comment) configuration.
  if (!cfg.includes(REPRO_FLAG)) {
    e.push("B2 the deterministic link flag " + REPRO_FLAG + " is not in effect in .cargo/config.toml");
  }

  // B3 — it must be target-scoped. A bare [build] rustflags would apply /Brepro to every target,
  // including non-MSVC ones where it is not a valid linker argument.
  const msvcAt = cfg.indexOf(MSVC_TARGET);
  if (msvcAt === -1) {
    e.push("B3 the deterministic flag is not scoped to " + MSVC_TARGET);
  } else {
    // The flag must appear inside the MSVC table, i.e. after its header and before the next table.
    const rest = cfg.slice(msvcAt + MSVC_TARGET.length);
    const nextTable = rest.search(/\n\s*\[/);
    const section = nextTable === -1 ? rest : rest.slice(0, nextTable);
    if (!section.includes(REPRO_FLAG)) {
      e.push("B3 " + REPRO_FLAG + " is not inside the " + MSVC_TARGET + " table");
    }
  }

  // B4 — a committed production build command must exist and pin the release profile.
  if (!cfg.includes(ALIAS_SECTION)) {
    e.push("B4 no " + ALIAS_SECTION + " table: the production build command is not committed");
  }
  const alias = new RegExp(ALIAS_NAME + "\\s*=\\s*\"([^\"]*)\"").exec(cfg);
  if (!alias) {
    e.push("B4 the committed production build alias '" + ALIAS_NAME + "' is missing");
  } else {
    if (!/\brelease\b/.test(alias[1])) {
      e.push("B4 the production build command does not pin the release profile: " + alias[1]);
    }
    // B5 — the Windows feature graph must come from the manifest, never from the command line.
    if (/--features/.test(alias[1])) {
      e.push("B5 the production build command passes --features; the Windows graph must come from Cargo.toml: " + alias[1]);
    }
  }

  // B6/B7 — the manifest contract the deterministic build depends on.
  if (!fs.existsSync(MANIFEST)) {
    e.push("B6 service-host Cargo.toml missing");
    return e;
  }
  const manifest = stripComments(fs.readFileSync(MANIFEST, "utf8"));

  // B6 — the cfg(windows) dependency block must still supply windows-live-ipc. This is the block whose
  // absence from an earlier partial read produced a false "not reproducible" finding; pin it so the
  // Windows feature graph cannot be dropped silently.
  const winBlock = manifest.indexOf("[target.'cfg(windows)'.dependencies]");
  if (winBlock === -1) {
    e.push("B6 the [target.'cfg(windows)'.dependencies] block is gone; the Windows feature graph is no longer supplied");
  } else {
    const rest = manifest.slice(winBlock);
    const nextTable = rest.slice(1).search(/\n\s*\[[a-zA-Z\[]/);
    const section = nextTable === -1 ? rest : rest.slice(0, nextTable + 1);
    if (!section.includes("windows-live-ipc")) {
      e.push("B6 the cfg(windows) dependency block no longer enables windows-live-ipc");
    }
  }

  // B7 — the fixture graph must never reach a production build of the service.
  if (/["']test-fixtures["']/.test(manifest)) {
    e.push("B7 service-host enables test-fixtures; the fixture graph must stay out of the production binary");
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectoshost-build-provenance1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectoshost-build-provenance1a: PASS");
}
