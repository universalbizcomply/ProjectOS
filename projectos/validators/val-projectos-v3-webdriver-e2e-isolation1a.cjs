"use strict";
// Validator: PROJECTOS-V3-WEBDRIVER-E2E-ISOLATION1A
//
// Fails closed. The embedded WebDriver server must be reachable ONLY through the explicit
// `webdriver-e2e` Cargo feature, and must never become part of an ordinary ProjectOS build.
//
// WHY THIS EXISTS. The genuine desktop proof needs a WebDriver server inside the app, because the
// raw `tauri-driver` route and the WDIO external provider both failed to establish a session. A
// WebDriver server is remote control of the application: it can drive the Control Centre's governed
// surface. That is acceptable in a test binary and unacceptable in a shipped one, and the only thing
// standing between those two outcomes is a Cargo feature and a `#[cfg]`. Both are one careless edit
// from being removed, and the removal would not break any test — the E2E build would still work.
// Nothing else in the repository would notice. This validator is what notices.
//
// WHAT IT DOES NOT DO. It is not a general Cargo linter. It asserts exactly the facts that keep the
// server out of production, so that a later change which quietly widens the boundary fails here
// rather than shipping.
//
// Registered in validate-all by PROJECTOS-V3-CONTROL-CENTRE-INTEGRATION1A.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const TAURI_DIR = path.join(ROOT, "projectos", "control-center", "src-tauri");
const CARGO_TOML = path.join(TAURI_DIR, "Cargo.toml");
const TAURI_CONF = path.join(TAURI_DIR, "tauri.conf.json");
const CAPABILITIES = path.join(TAURI_DIR, "capabilities");
const SRC = path.join(TAURI_DIR, "src");
const CC = path.join(ROOT, "projectos", "control-center");

const FEATURE = "webdriver-e2e";
const EMBEDDED_CRATE = "tauri-plugin-wdio-webdriver";
// The Rust symbol form of the crate name.
const EMBEDDED_SYMBOL = "tauri_plugin_wdio_webdriver";
// The far more powerful general plugin: arbitrary JS execution, Tauri-command mocking and invoke
// interception. Deliberately NOT adopted. If a future phase genuinely needs it, that is a decision
// requiring its own review — so its mere appearance must fail here rather than pass silently.
const GENERAL_CRATE = "tauri-plugin-wdio";

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}

/** Every `.rs` file under the Tauri crate. */
function rustFiles(dir, out) {
  out = out || [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) rustFiles(full, out);
    else if (entry.name.endsWith(".rs")) out.push(full);
  }
  return out;
}

/** Strip Rust line/block comments so a mention inside a comment is not read as code. */
function stripRustComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function run() {
  const e = [];

  // ---- Cargo manifest: the packaging boundary -----------------------------------------------
  const cargo = read(CARGO_TOML);

  // The dependency must be OPTIONAL. Without this the crate joins the default graph and every
  // release build contains the server.
  const depLine = cargo
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(EMBEDDED_CRATE + " ") || l.trim().startsWith(EMBEDDED_CRATE + "="));
  if (depLine === undefined) {
    e.push(EMBEDDED_CRATE + " is not declared in Cargo.toml; the embedded proof route is missing");
  } else if (!/optional\s*=\s*true/.test(depLine)) {
    e.push(
      EMBEDDED_CRATE +
        " is not declared `optional = true`; a non-optional dependency is present in the DEFAULT " +
        "build graph, so ordinary release builds would contain the WebDriver server",
    );
  }

  // The feature must exist and must enable ONLY the embedded server.
  const featureLine = cargo.split(/\r?\n/).find((l) => l.trim().startsWith(FEATURE + " "));
  if (featureLine === undefined) {
    e.push("the `" + FEATURE + "` feature is not declared in Cargo.toml");
  } else {
    const enabled = (featureLine.match(/"([^"]+)"/g) || []).map((s) => s.slice(1, -1));
    const unexpected = enabled.filter((x) => x !== "dep:" + EMBEDDED_CRATE);
    if (!enabled.includes("dep:" + EMBEDDED_CRATE)) {
      e.push("the `" + FEATURE + "` feature does not enable dep:" + EMBEDDED_CRATE);
    }
    if (unexpected.length) {
      e.push(
        "the `" + FEATURE + "` feature enables more than the embedded server: " +
          unexpected.join(", ") + " — the test feature must not widen beyond WebDriver",
      );
    }
  }

  // A `default` feature list that includes the E2E feature would defeat `optional = true` entirely.
  const defaultLine = cargo.split(/\r?\n/).find((l) => /^\s*default\s*=/.test(l));
  if (defaultLine !== undefined && defaultLine.includes(FEATURE)) {
    e.push("`" + FEATURE + "` is enabled by the DEFAULT feature set; it must be opt-in only");
  }

  // The powerful general plugin must be absent from the Rust manifest AND the frontend package.
  if (new RegExp("^\\s*" + GENERAL_CRATE + "\\s*[=\\s]", "m").test(cargo)) {
    e.push(
      GENERAL_CRATE +
        " has been added to Cargo.toml. It provides JavaScript execution, command mocking and " +
        "invoke interception — it can fake the governed chain the desktop proof exists to prove. " +
        "Adopting it requires its own security review, not a silent dependency addition",
    );
  }
  const ccPkg = JSON.parse(read(path.join(CC, "package.json")));
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = ccPkg[field] || {};
    if (Object.prototype.hasOwnProperty.call(deps, "@wdio/tauri-plugin")) {
      e.push(
        "@wdio/tauri-plugin is present in " + field + "; its frontend bootstrap installs invoke " +
          "interception and mocking. It has not been reviewed for this boundary",
      );
    }
  }

  // ---- Registration must be compile-time gated ------------------------------------------------
  // Every mention of the plugin symbol in Rust source must be immediately preceded by the cfg
  // attribute. A registration that is merely runtime-conditional (an env var, a debug assertion) is
  // NOT equivalent: the code would still be present in the shipped binary.
  const files = rustFiles(SRC);
  let registrations = 0;
  for (const file of files) {
    const lines = stripRustComments(read(file)).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes(EMBEDDED_SYMBOL)) return;
      registrations += 1;
      // Look back over blank lines for the gate.
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j -= 1;
      const guard = j >= 0 ? lines[j] : "";
      const gated =
        guard.includes("cfg(feature") && guard.includes(FEATURE) ||
        line.includes("cfg(feature") && line.includes(FEATURE);
      if (!gated) {
        e.push(
          path.relative(ROOT, file) + ":" + (i + 1) +
            " references " + EMBEDDED_SYMBOL + " without an immediately preceding " +
            '#[cfg(feature = "' + FEATURE + '")] gate',
        );
      }
    });
  }
  if (registrations === 0) {
    e.push("no gated registration of " + EMBEDDED_SYMBOL + " found in Rust source");
  }

  // ---- Ordinary build configuration must not enable the feature --------------------------------
  const conf = read(TAURI_CONF);
  if (conf.includes(FEATURE)) {
    e.push("tauri.conf.json references `" + FEATURE + "`; the ordinary build config must not enable it");
  }
  // `withGlobalTauri` exposes the Tauri API to any script in the WebView. The WDIO documentation's
  // advanced examples turn it on; production must not, and the minimum embedded server does not need it.
  if (/"withGlobalTauri"\s*:\s*true/.test(conf)) {
    e.push("tauri.conf.json enables withGlobalTauri; that must never be turned on for production");
  }
  for (const [name, script] of Object.entries(ccPkg.scripts || {})) {
    // The E2E build script is allowed to name the feature; ordinary build/dev scripts are not.
    if (script.includes(FEATURE) && !/e2e/i.test(name)) {
      e.push("package.json script `" + name + "` enables `" + FEATURE + "`; only an explicit E2E script may");
    }
  }

  // ---- Capabilities: no production authority for the test surface ------------------------------
  if (fs.existsSync(CAPABILITIES)) {
    for (const f of fs.readdirSync(CAPABILITIES).filter((x) => x.endsWith(".json"))) {
      const cap = JSON.parse(read(path.join(CAPABILITIES, f)));
      const perms = (cap.permissions || []).map((p) => (typeof p === "string" ? p : p && p.identifier) || "");
      const offending = perms.filter((p) => p.startsWith("wdio:") || p.includes("webdriver"));
      if (offending.length) {
        e.push(
          "capability " + f + " grants " + offending.join(", ") +
            "; the WebDriver test surface must not hold a production capability",
        );
      }
    }
  }

  // ---- The proof must not be able to fake itself ------------------------------------------------
  // Mock-based results do not demonstrate the real governed chain, so the acceptance specs must not
  // reach for the mocking API even if the general plugin is adopted later.
  const specDir = path.join(CC, "test-desktop", "e2e");
  if (fs.existsSync(specDir)) {
    for (const f of fs.readdirSync(specDir).filter((x) => x.endsWith(".ts"))) {
      const src = read(path.join(specDir, f));
      const banned = ["browser.tauri.mock", "mockReturnValue", "mockResolvedValue", "mockRejectedValue"];
      for (const token of banned) {
        if (src.includes(token)) {
          e.push(
            "acceptance spec " + f + " uses " + token + "; the desktop proof must exercise the real " +
              "governed chain, and a mocked result is not evidence for it",
          );
        }
      }
    }
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectos-v3-webdriver-e2e-isolation1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectos-v3-webdriver-e2e-isolation1a: PASS");
}
