"use strict";
/**
 * THE CONTROL CENTER CSP — PROJECTOS-TENANT-CSP1A (plan v1.31, V4 Stage 2).
 *
 * The window had no policy (`csp: null`). The owner approved a strict one with the exact Supabase address
 * and no wildcard, because a wildcard would let injected script post data to any Supabase project. Every
 * way of softening a policy reads reasonably in a diff:
 *
 *   CSP-1  "one more source is harmless"            — and the policy is no longer the one approved
 *   CSP-2  "a wildcard is just shorter"             — and injected script posts to any Supabase project
 *   CSP-3  "a library wants eval"                   — and injected text runs as code
 *   CSP-4  "the app has no forms or plugins anyway" — and the four locks are gone the day one is injected
 *   CSP-5  "the project moved"                      — and the only remote host is a different one
 *   CSP-6  "put unsafe-inline back, to be safe"     — and the tightening is undone in one word
 *   CSP-7  "Tauri has a switch for that"            — and the policy holds on paper only
 *   CSP-8  "dev can have a bit more"                — and devCsp drifts past the two things Vite needs
 *   CSP-9  "core:default is the default"            — and the window can call what it never uses
 *   CSP-10 "the frontend might need it"             — and a capability is widened for nothing, or the app
 *                                                     starts needing what the capability no longer grants
 *   CSP-11 "one inline style is fine"               — and style-src 'self' blanks that screen
 *   CSP-12 "a quick fetch"                          — and a connection appears the policy never saw
 *   CSP-13 "the window opened, so it passed"        — and a blank app reports no violations
 *   CSP-14 "the control failed, near enough"        — and a proof that cannot fail counts
 *   CSP-15 "one more try at signing in"             — and the proof sends a second request to Supabase
 *   CSP-16 "the evidence is from this morning"      — and it proves a policy no longer in the file
 *   CSP-17 "the run was fine"                       — and a run that proved nothing is on record
 *   CSP-18 "signing in was proved"                  — and a failed sign-in is reported as a successful one
 *   CSP-19 "the installed app is protected now"     — and it is not, until the MSI is rebuilt
 *   CSP-20 "register it later"                      — and nothing ever runs this file
 *   CSP-T  "the tests exist"                        — and `.skip` keeps the proof while dropping the run
 *
 * `selfTest` applies each named mutation in memory and counts it killed only when ITS OWN rule fires.
 * Comments are stripped from code before anything is judged. Reads files; runs nothing.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-tenant-csp1a";

const CC = "projectos/control-center";
const CONF_REL = `${CC}/src-tauri/tauri.conf.json`;
const CAP_REL = `${CC}/src-tauri/capabilities/default.json`;
const VERDICT_REL = `${CC}/test/csp-webview/verdict.mjs`;
const RUN_REL = `${CC}/test/csp-webview/run-proof.mjs`;
const VARIANTS_REL = `${CC}/test/csp-webview/variants.mjs`;
const BUILD_REL = `${CC}/test/csp-webview/build-variant.mjs`;
const TEST_REL = `${CC}/test/cspPolicy.test.ts`;
const EVIDENCE_REL = "docs/finish/PROJECTOS-TENANT-CSP1A.webview-evidence.json";
const FINISH_REL = "docs/finish/PROJECTOS-TENANT-CSP1A.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const SRC_ROOT = `${CC}/src`;
const SOURCES = [CONF_REL, CAP_REL, VERDICT_REL, RUN_REL, VARIANTS_REL, BUILD_REL, TEST_REL, EVIDENCE_REL, FINISH_REL, VA_REL, CR_REL];

const HOST = "vzbzkziksxvyfqrdrwqx.supabase.co";
/** The policy the owner approved, with style-src tightened as the delta allows. */
const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ipc: http://ipc.localhost https://${HOST} wss://${HOST}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
];
const LOCKS = ["object-src", "base-uri", "form-action", "frame-ancestors"];
/** The two things Vite needs, and nothing else separates devCsp from the built policy. */
const DEV_ONLY = { "style-src": ["'unsafe-inline'"], "connect-src": ["ws://localhost:5178"] };
const PERMISSIONS = ["core:event:allow-listen", "core:event:allow-unlisten"];
const TAURI_MODULES = ["@tauri-apps/api/core", "@tauri-apps/api/event"];
const REMOVED_DANGERS = ["dangerousDisableAssetCspModification", "dangerousRemoteDomainIpcAccess", "assetProtocol", "pattern"];

const INLINE_ROUTES = /<style[\s>]|dangerouslySetInnerHTML|setAttribute\(\s*['"]style|document\.write|\binsertAdjacentHTML\b|\.innerHTML\s*=|\beval\(|new Function\(/;
const OWN_CONNECTIONS = /\bfetch\(|new WebSocket\(|new EventSource\(|new XMLHttpRequest\(|navigator\.sendBeacon\(/;

/** The check each rule removal has to break. `strict` runs must pass every one of these. */
const CONTROLS = {
  "control-no-policy": { at: "served-policy", stillPass: ["app-loaded", "bundled-fonts", "sidecar-reached", "no-violation"] },
  "control-loose-script-style": {
    at: "eval-blocked",
    stillPass: ["served-policy", "app-loaded", "sidecar-reached", "foreign-fetch-blocked", "inline-script-blocked"],
    alsoFails: ["inline-style-blocked", "style-attribute-blocked"],
  },
  "control-no-ipc": { at: "no-violation", stillPass: ["served-policy", "app-loaded", "sidecar-reached"], alsoFails: ["ipc-native"] },
  "control-no-fonts": { at: "bundled-fonts", stillPass: ["served-policy", "app-loaded", "sidecar-reached"] },
  "control-no-script": { at: "app-loaded", stillPass: ["served-policy"] },
  "control-no-supabase": { at: "supabase-reached", stillPass: ["served-policy", "app-loaded", "bundled-fonts"] },
  "control-wide-capability": { at: "capability-narrow", stillPass: ["served-policy", "app-loaded", "sidecar-reached", "inline-script-blocked"] },
};
const MUST_PASS = {
  "strict-shell": [
    "served-policy", "app-loaded", "bundled-fonts", "no-violation", "sidecar-reached", "ipc-native", "screens-walked", "capability-narrow",
    "inline-script-blocked", "eval-blocked", "foreign-fetch-blocked", "sibling-project-blocked", "foreign-image-blocked",
    "inline-style-blocked", "style-attribute-blocked", "cssom-style-works", "base-uri-blocked", "object-blocked", "form-action-blocked",
  ],
  "strict-login": ["served-policy", "app-loaded", "bundled-fonts", "no-violation", "supabase-reached", "exactly-one-request"],
  "dev-policy-shell": ["served-policy", "app-loaded", "bundled-fonts", "no-violation", "sidecar-reached", "ipc-native", "screens-walked"],
};

/** A pin: this text, in this file. */
const JUDGE_PINS = [
  ["blocked probes need both halves", "probe?.attempted === true && probe.effect === false && violated(obs, directive)"],
  ["a blank window is a failure", "['app-loaded', obs.loaded?.rendered === true,"],
  ["silence is not clean", "obs.normalUseRan === true && (obs.violations ?? []).length === 0 && (obs.consoleViolations ?? []).length === 0"],
  ["fonts need the bundled file", "obs.fonts?.bundledLoaded === true && obs.fonts?.widthDiffers === true"],
  ["no policy cannot match", "samePolicy(obs.servedPolicy, variant.csp) && variant.csp !== null"],
  ["only script-src may carry a bundle hash", "directives['script-src'] = directives['script-src'].filter((source) => !BUNDLE_HASH.test(source));"],
  ["the sidecar answers", "obs.sidecar?.state === 'RUNNING_READ_ONLY' && (obs.sidecar?.messages ?? 0) > 0"],
  ["the IPC really used the custom protocol", "['ipc-native', (obs.ipcNative ?? 0) > 0,"],
  ["a foreign request must not arrive", "blocked(p.foreignFetch, 'connect-src', obs) && p.foreignFetch?.hits === 0"],
  ["a control fails where it says", "return verdict.pass === false && named !== undefined && named.ok === false && leftAlone;"],
  ["a control names what it leaves alone", "const leftAlone = untouched.length > 0 &&"],
  ["every check must hold", "return { pass: checks.every((check) => check.ok), checks };"],
];
const RUN_PINS = [
  ["the page is reloaded, so boot is seen", "await cdp.send('Page.reload', { ignoreCache: true });"],
  ["the listener is in before the document", "await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LISTENER });"],
  ["the reload waits for the first load", "location.href.startsWith('http://tauri.localhost') && document.readyState === 'complete'"],
  ["only a line from before the new document is excused", "if (!reloaded && /IPC custom protocol failed/.test(line)) {"],
  ["no run shares the fixed debug port", "await requirePortClosed(DEBUG_PORT);"],
  ["a surviving helper is stopped and checked", "await stopProfile(profile);"],
  ["eval is judged under the page's policy", "allowUnsafeEvalBlockedByCSP: false,"],
  ["only this run's process tree is stopped", "spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });"],
  ["the profile stays away from any installed app", "WEBVIEW2_USER_DATA_FOLDER: profile,"],
];
const SIGN_IN_PINS = [
  ["the latch", "if (existsSync(LATCH)) throw new Error('the one live sign-in has already been used');"],
  ["the latch is written before the click", "writeFileSync(LATCH, `${new Date().toISOString()}\\n`);"],
  ["live needs the flag", "const mayLeave = variant.signIn === true && live;"],
  ["the control may not name Supabase", "if (blockedControl && String(obs.servedPolicy).includes('supabase.co')) {"],
  ["an invented address", "const INVENTED_ADDRESS = 'csp-proof-no-such-user@example.com';"],
];
/** Where the MSI line and the owner check must be stated. */
const FINISH_CLAIMS = {
  msi: "The installed app gets this policy only when the MSI is next rebuilt.",
  bundleBroken: "`npm run build` fails at `b0768486`",
  ownerCheck: "A successful sign-in remains an owner check.",
  realtime: "The `wss://` source is allowed by the policy and was not exercised.",
  devCsp: "`tauri dev` serves pages from Vite, so `devCsp` is not applied there.",
};

const FORBIDDEN_IN_EVIDENCE = /apikey|authorization|bearer|eyJ[A-Za-z0-9_-]{10,}|VITE_SUPABASE_ANON_KEY/i;

/** A proof that does not run proves nothing, and its name still satisfies a needle. */
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;
const TESTS = [
  "has no wildcard host and no unsafe-eval, in either policy",
  "locks object-src, base-uri, form-action and frame-ancestors, in either policy",
  "names the exact Supabase project and no other remote host",
  "style-src runs without unsafe-inline in the built app; only the dev policy allows it, for Vite",
  "the window holds exactly the two event permissions",
  "the frontend imports only the Tauri core and event modules, so nothing it uses was narrowed away",
  "the frontend has no route that writes inline style or script as markup",
  "the frontend opens no connection of its own: Supabase and the IPC are the only callers",
  "a blank window fails, though it reports no violation at all",
  "a probe that never ran fails rather than counting as blocked",
  "a probe with no effect but no violation fails: something else may have stopped it",
  "a violation with the effect still present fails: the thing happened",
  "a foreign request that arrived fails, whatever the page said",
  "a second sign-in request fails: one was allowed",
  "failing somewhere else does not",
  "a blank window fails the named check for the wrong reason, and that proves nothing",
  "a control naming nothing it leaves alone proves nothing",
  "IPC that fell back to postMessage fails, though the app still works",
  "exactly one variant may reach Supabase",
];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
}

function sourceTree(rel) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const next = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) out[next] = read(next);
    }
  };
  walk(rel);
  return out;
}

/** Strip comments outside strings: the same walk `val-projectos-tenant-contract1a` uses. */
function code(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const jsonOf = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

function directives(policy) {
  const out = {};
  for (const part of String(policy).split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources;
  }
  return out;
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  if (start < 0) return null;
  const end = text.indexOf("];", start);
  return end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  for (const rel of SOURCES) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("CSP-0", `${rel} is missing`);
      return errors;
    }
  }
  const conf = jsonOf(raw[CONF_REL]);
  const security = conf?.app?.security;
  if (security === undefined) {
    E("CSP-0", "tauri.conf.json has no app.security");
    return errors;
  }
  const csp = String(security.csp);
  const dev = String(security.devCsp);
  const built = directives(csp);
  const devBuilt = directives(dev);

  // CSP-1: exactly the approved policy, directive by directive, both ways.
  const approved = directives(POLICY.join("; "));
  for (const [name, sources] of Object.entries(approved)) {
    if (JSON.stringify(built[name]) !== JSON.stringify(sources)) E("CSP-1", `${name} is not the approved source list`);
  }
  for (const name of Object.keys(built)) {
    if (!(name in approved)) E("CSP-1", `the policy gained a directive the owner did not approve: ${name}`);
  }
  // CSP-2: no wildcard in either, anywhere, and no scheme-only remote source.
  for (const [label, policy] of [["csp", csp], ["devCsp", dev]]) {
    if (policy.includes("*")) E("CSP-2", `${label} has a wildcard`);
    for (const [name, sources] of Object.entries(directives(policy))) {
      for (const source of sources) {
        if (/^(https?|wss?):$/.test(source)) E("CSP-2", `${label} ${name} allows a whole scheme: ${source}`);
      }
    }
  }
  // CSP-3: no eval in either.
  for (const [label, policy] of [["csp", csp], ["devCsp", dev]]) {
    if (/unsafe-eval|wasm-unsafe-eval|unsafe-hashes/.test(policy)) E("CSP-3", `${label} allows eval`);
  }
  // CSP-4: the four locks, in both.
  for (const [label, parsed] of [["csp", built], ["devCsp", devBuilt]]) {
    for (const name of LOCKS) {
      if (JSON.stringify(parsed[name]) !== JSON.stringify(["'none'"])) E("CSP-4", `${label} no longer locks ${name}`);
    }
  }
  // CSP-5: the only remote hosts are the exact project, https and wss, in both.
  for (const [label, parsed] of [["csp", built], ["devCsp", devBuilt]]) {
    const connect = parsed["connect-src"] ?? [];
    const remote = connect.filter((s) => /^(https|wss):\/\//.test(s));
    if (JSON.stringify(remote) !== JSON.stringify([`https://${HOST}`, `wss://${HOST}`])) {
      E("CSP-5", `${label} connect-src names remote hosts other than the exact project`);
    }
  }
  // CSP-6: style-src stays tightened in the built app.
  if (csp.includes("unsafe-inline")) E("CSP-6", "the built policy allows inline script or style");
  // CSP-7: no switch that hollows the policy out.
  for (const key of REMOVED_DANGERS) {
    if (key in security) E("CSP-7", `tauri.conf.json sets app.security.${key}`);
  }
  if (conf.app.withGlobalTauri === true) E("CSP-7", "tauri.conf.json enables withGlobalTauri");
  if ((conf.app.windows ?? []).some((w) => "additionalBrowserArgs" in w)) E("CSP-7", "tauri.conf.json carries browser arguments, which belong to proof builds only");
  // CSP-8: devCsp is the built policy plus exactly what Vite needs.
  for (const [name, sources] of Object.entries(approved)) {
    const expected = [...sources];
    for (const extra of DEV_ONLY[name] ?? []) expected.push(extra);
    if (JSON.stringify([...(devBuilt[name] ?? [])].sort()) !== JSON.stringify(expected.sort())) {
      E("CSP-8", `devCsp ${name} is not the built policy plus what Vite needs`);
    }
  }
  if (Object.keys(devBuilt).length !== Object.keys(approved).length) E("CSP-8", "devCsp has a different set of directives");

  // CSP-9: the window holds exactly two permissions.
  const capability = jsonOf(raw[CAP_REL]);
  if (JSON.stringify(capability?.permissions) !== JSON.stringify(PERMISSIONS) || JSON.stringify(capability?.windows) !== JSON.stringify(["main"]) ||
      "remote" in (capability ?? {})) {
    E("CSP-9", "the window capability is not exactly the two event permissions on the main window");
  }
  // CSP-10: nothing in the frontend reaches past what the window was left with.
  const srcCode = Object.entries(raw).filter(([rel]) => rel.startsWith(`${SRC_ROOT}/`)).map(([rel, text]) => [rel, code(text)]);
  if (srcCode.length === 0) E("CSP-10", "the frontend source was not read");
  for (const [rel, text] of srcCode) {
    for (const m of text.matchAll(/['"](@tauri-apps\/[^'"]+)['"]/g)) {
      if (!TAURI_MODULES.includes(m[1])) E("CSP-10", `${rel} imports ${m[1]}, which the narrowed window may not use`);
    }
    if (/['"`]plugin:/.test(text)) E("CSP-10", `${rel} calls a plugin directly`);
    // CSP-11: inline markup would be refused by style-src 'self' and script-src 'self'.
    if (INLINE_ROUTES.test(text)) E("CSP-11", `${rel} writes inline style or script: ${INLINE_ROUTES.exec(text)[0]}`);
    // CSP-12: the policy names Supabase and the IPC, so nothing else may open a connection.
    if (OWN_CONNECTIONS.test(text)) E("CSP-12", `${rel} opens its own connection: ${OWN_CONNECTIONS.exec(text)[0]}`);
  }

  // CSP-13: the judge cannot pass silence, and the harness watches boot under the real policy.
  const verdict = code(raw[VERDICT_REL]);
  for (const [why, pin] of JUDGE_PINS) {
    if (!verdict.includes(pin)) E(why.startsWith("a control") ? "CSP-14" : "CSP-13", `the judge lost: ${why}`);
  }
  const run = code(raw[RUN_REL]);
  for (const [why, pin] of RUN_PINS) {
    if (!run.includes(pin)) E("CSP-13", `the harness lost: ${why}`);
  }
  // CSP-14: each rule removal has a control, naming the check it must break.
  const variantsCode = code(raw[VARIANTS_REL]);
  for (const [name, { at, stillPass }] of Object.entries(CONTROLS)) {
    const start = variantsCode.indexOf(`'${name}'`);
    const span = start < 0 ? "" : variantsCode.slice(start, variantsCode.indexOf("},\n    '", start + 1) < 0 ? undefined : variantsCode.indexOf("},\n    '", start + 1));
    if (!span.includes(`mustFailAt: '${at}'`)) E("CSP-14", `${name} no longer names ${at} as the check it breaks`);
    const leftAlone = `mustStillPass: [${stillPass.map((id) => `'${id}'`).join(", ")}]`;
    if (!span.includes(leftAlone)) E("CSP-14", `${name} no longer names what it must leave alone`);
  }
  // CSP-15: one request to Supabase.
  for (const [why, pin] of SIGN_IN_PINS) {
    if (!run.includes(pin)) E("CSP-15", `the harness lost: ${why}`);
  }
  if ((variantsCode.match(/signIn: true/g) || []).length !== 1) E("CSP-15", "more than one variant may reach Supabase");
  if (run.indexOf("writeFileSync(LATCH") > run.indexOf("await submitLogin(")) E("CSP-15", "the latch is written after the click");

  // CSP-16..18: the evidence.
  const evidence = jsonOf(raw[EVIDENCE_REL]);
  if (evidence === null || !Array.isArray(evidence.runs)) {
    E("CSP-16", "the webview evidence does not parse");
  } else {
    if (evidence.policySha256 !== sha256(security.csp) || evidence.devPolicySha256 !== sha256(security.devCsp) ||
        evidence.capabilityPermissionsSha256 !== sha256(JSON.stringify(capability?.permissions))) {
      E("CSP-16", "the webview evidence was taken under a different policy or capability");
    }
    const byName = Object.fromEntries(evidence.runs.map((r) => [r.variant, r]));
    for (const [name, checks] of Object.entries(MUST_PASS)) {
      const r = byName[name];
      if (r === undefined || r.proved !== true || r.failed?.length !== 0 || !checks.every((c) => r.passed?.includes(c))) {
        E("CSP-17", `${name} did not pass every check it must`);
      }
      // A passing run may not lean on the one console line the harness excuses.
      if (r?.abortedByReload !== 0) E("CSP-17", `${name} relied on an excused IPC failure`);
    }
    for (const [name, { at, stillPass, alsoFails = [] }] of Object.entries(CONTROLS)) {
      const r = byName[name];
      if (r === undefined || r.proved !== true || r.expect !== "fail" || r.mustFailAt !== at || !r.failed?.includes(at)) {
        E("CSP-17", `${name} did not fail at ${at}`);
      }
      // A control that failed everywhere proves nothing: a blank window fails every check.
      if (!stillPass.every((id) => r?.passed?.includes(id))) E("CSP-17", `${name} broke more than the rule it removed`);
      if (!alsoFails.every((id) => r?.failed?.includes(id))) E("CSP-17", `${name} did not also fail ${alsoFails.join(", ")}`);
    }
    const shell = byName["strict-shell"];
    if ((shell?.elements ?? 0) < 50 || shell?.sidecar?.state !== "RUNNING_READ_ONLY" || !(shell?.sidecar?.messages > 0) || shell?.violationsInUse !== 0 || shell?.consoleRefusalsInUse !== 0) {
      E("CSP-17", "strict-shell does not show a rendered app that reached the sidecar with no violation");
    }
    const hits = shell?.arrivedAtListener;
    if (hits === null || hits === undefined || Object.keys(hits).length !== 0) E("CSP-17", "a deliberate violation reached the listener under the strict policy");
    const noPolicy = byName["control-no-policy"]?.arrivedAtListener;
    if (!(noPolicy?.["/fetch"] > 0)) E("CSP-17", "the no-policy control does not show the probe getting through, so the probe proves nothing");
    // CSP-18: the sign-in is reported as what it was.
    const signIn = byName["strict-login"]?.signIn;
    if (signIn?.host !== HOST || signIn?.method !== "POST" || signIn?.path !== "/auth/v1/token" || signIn?.status !== 400 || signIn?.requests !== 1 || signIn?.otherOnHost !== 0) {
      E("CSP-18", "the evidence does not show exactly one failed sign-in at the exact host");
    }
    const blocked = byName["control-no-supabase"]?.signIn;
    if (blocked?.status !== null || blocked?.requests !== 0) E("CSP-18", "the no-Supabase control shows a response, so something left the machine");
    if (FORBIDDEN_IN_EVIDENCE.test(raw[EVIDENCE_REL])) E("CSP-18", "the evidence carries a key or a header");
  }
  // CSP-19: what this does not do, stated.
  const finish = raw[FINISH_REL].replace(/\s+/g, " ");
  for (const [key, claim] of Object.entries(FINISH_CLAIMS)) {
    if (!finish.includes(claim)) E("CSP-19", `the finish record no longer states '${key}'`);
  }
  // CSP-20: both runners.
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(code(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("CSP-20", `${THIS_VALIDATOR} is not registered in ${name}`);
  }
  // CSP-T: every proof exists, and every proof runs.
  const test = code(raw[TEST_REL]);
  for (const needle of TESTS) if (!test.includes(needle)) E("CSP-T", `cspPolicy.test.ts no longer proves "${needle}"`);
  if (NOT_RUN.test(test)) E("CSP-T", `cspPolicy.test.ts skips or isolates a test: ${NOT_RUN.exec(test)[0]}`);
  return errors;
}

const SRC_PROBE = `${SRC_ROOT}/main.tsx`;
const MUTATIONS = [
  { name: "the policy gains a directive", rule: "CSP-1", rel: CONF_REL, from: "frame-ancestors 'none'\",\n      \"devCsp\"", to: "frame-ancestors 'none'; worker-src 'self'\",\n      \"devCsp\"" },
  { name: "img-src gains a source", rule: "CSP-1", rel: CONF_REL, from: "img-src 'self' data:;", to: "img-src 'self' data: https://example.com;" },
  { name: "a wildcard Supabase host", rule: "CSP-2", rel: CONF_REL, from: `https://${HOST} wss://${HOST}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",\n      "devCsp"`, to: `https://*.supabase.co wss://${HOST}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",\n      "devCsp"` },
  { name: "a whole scheme in connect-src", rule: "CSP-2", rel: CONF_REL, from: "connect-src 'self' ipc: http://ipc.localhost https:", to: "connect-src 'self' ipc: http://ipc.localhost https: https:" },
  { name: "unsafe-eval in script-src", rule: "CSP-3", rel: CONF_REL, from: "script-src 'self'; style-src 'self'; img-src", to: "script-src 'self' 'unsafe-eval'; style-src 'self'; img-src" },
  { name: "unsafe-eval in devCsp only", rule: "CSP-3", rel: CONF_REL, from: "script-src 'self'; style-src 'self' 'unsafe-inline';", to: "script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';" },
  { name: "object-src unlocked", rule: "CSP-4", rel: CONF_REL, from: "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\",\n      \"devCsp\"", to: "object-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'\",\n      \"devCsp\"" },
  { name: "base-uri dropped", rule: "CSP-4", rel: CONF_REL, from: "base-uri 'none'; form-action 'none'; frame-ancestors 'none'\",\n      \"devCsp\"", to: "form-action 'none'; frame-ancestors 'none'\",\n      \"devCsp\"" },
  { name: "form-action opened", rule: "CSP-4", rel: CONF_REL, from: "form-action 'none'; frame-ancestors 'none'\",\n      \"devCsp\"", to: "form-action 'self'; frame-ancestors 'none'\",\n      \"devCsp\"" },
  { name: "frame-ancestors unlocked in devCsp", rule: "CSP-4", rel: CONF_REL, from: "form-action 'none'; frame-ancestors 'none'\"\n", to: "form-action 'none'; frame-ancestors 'self'\"\n" },
  { name: "another Supabase project", rule: "CSP-5", rel: CONF_REL, from: `https://${HOST} wss://${HOST}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",\n      "devCsp"`, to: `https://aaaaaaaaaaaaaaaaaaaa.supabase.co wss://${HOST}; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",\n      "devCsp"` },
  { name: "unsafe-inline back in style-src", rule: "CSP-6", rel: CONF_REL, from: "style-src 'self'; img-src", to: "style-src 'self' 'unsafe-inline'; img-src" },
  { name: "Tauri's CSP modification switched off", rule: "CSP-7", rel: CONF_REL, from: "\"security\": {", to: "\"security\": {\n      \"dangerousDisableAssetCspModification\": true," },
  { name: "the global Tauri object switched on", rule: "CSP-7", rel: CONF_REL, from: "\"windows\": [\n      {", to: "\"withGlobalTauri\": true,\n    \"windows\": [\n      {" },
  { name: "the proof's debug port in the shipped config", rule: "CSP-7", rel: CONF_REL, from: "\"minHeight\": 600", to: "\"minHeight\": 600,\n        \"additionalBrowserArgs\": \"--remote-debugging-port=19517\"" },
  { name: "devCsp gains a source Vite does not need", rule: "CSP-8", rel: CONF_REL, from: "ws://localhost:5178 ", to: "ws://localhost:5178 http://localhost:9999 " },
  { name: "devCsp loses a directive", rule: "CSP-8", rel: CONF_REL, from: "font-src 'self'; connect-src 'self' ipc: http://ipc.localhost ws:", to: "connect-src 'self' ipc: http://ipc.localhost ws:" },
  { name: "core:default back in the window", rule: "CSP-9", rel: CAP_REL, from: "\"core:event:allow-listen\",", to: "\"core:default\",\n    \"core:event:allow-listen\"," },
  { name: "the opener back in the window", rule: "CSP-9", rel: CAP_REL, from: "\"core:event:allow-unlisten\"", to: "\"core:event:allow-unlisten\",\n    \"opener:allow-open-url\"" },
  { name: "the frontend imports the opener", rule: "CSP-10", rel: SRC_PROBE, from: "import React from 'react';", to: "import { openUrl } from '@tauri-apps/plugin-opener';\nimport React from 'react';" },
  { name: "the frontend calls a plugin by name", rule: "CSP-10", rel: SRC_PROBE, from: "import React from 'react';", to: "const x = 'plugin:window|close';\nimport React from 'react';" },
  { name: "an inline style element", rule: "CSP-11", rel: SRC_PROBE, from: "<App />", to: "<style>{'a{}'}</style>" },
  { name: "markup written as html", rule: "CSP-11", rel: SRC_PROBE, from: "<App />", to: "<div dangerouslySetInnerHTML={{ __html: '' }} />" },
  { name: "a fetch of its own", rule: "CSP-12", rel: SRC_PROBE, from: "import React from 'react';", to: "void fetch('/x');\nimport React from 'react';" },
  { name: "a blocked probe needs one half only", rule: "CSP-13", rel: VERDICT_REL, from: "probe?.attempted === true && probe.effect === false && violated(obs, directive)", to: "probe?.effect === false || violated(obs, directive)" },
  { name: "a blank window passes app-loaded", rule: "CSP-13", rel: VERDICT_REL, from: "['app-loaded', obs.loaded?.rendered === true,", to: "['app-loaded', true,", },
  { name: "silence counts as clean", rule: "CSP-13", rel: VERDICT_REL, from: "obs.normalUseRan === true && (obs.violations ?? []).length === 0", to: "(obs.violations ?? []).length === 0" },
  { name: "a font fallback counts as bundled", rule: "CSP-13", rel: VERDICT_REL, from: "obs.fonts?.bundledLoaded === true && obs.fonts?.widthDiffers === true", to: "obs.fonts?.widthDiffers === true" },
  { name: "no reload, so boot goes unwatched", rule: "CSP-13", rel: RUN_REL, from: "await cdp.send('Page.reload', { ignoreCache: true });", to: "" },
  { name: "the reload no longer waits for the first load", rule: "CSP-13", rel: RUN_REL, from: "location.href.startsWith('http://tauri.localhost') && document.readyState === 'complete'", to: "true" },
  { name: "every IPC fallback is excused", rule: "CSP-13", rel: RUN_REL, from: "if (!reloaded && /IPC custom protocol failed/.test(line)) {", to: "if (/IPC custom protocol failed/.test(line)) {" },
  { name: "IPC fallback passes unnoticed", rule: "CSP-13", rel: VERDICT_REL, from: "['ipc-native', (obs.ipcNative ?? 0) > 0,", to: "['ipc-native', true," },
  { name: "eval waved through by the debugger", rule: "CSP-13", rel: RUN_REL, from: "allowUnsafeEvalBlockedByCSP: false,", to: "allowUnsafeEvalBlockedByCSP: true," },
  { name: "the app killed by name", rule: "CSP-13", rel: RUN_REL, from: "spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });", to: "spawnSync('taskkill', ['/IM', 'projectos-control-center.exe', '/F'], { stdio: 'ignore' });" },
  { name: "a control passes by failing anywhere", rule: "CSP-14", rel: VERDICT_REL, from: "return verdict.pass === false && named !== undefined && named.ok === false && leftAlone;", to: "return verdict.pass === false;" },
  { name: "a blank window counts as a control failing", rule: "CSP-14", rel: VERDICT_REL, from: "named.ok === false && leftAlone;", to: "named.ok === false;" },
  { name: "a control stops naming what it leaves alone", rule: "CSP-14", rel: VARIANTS_REL, from: "mustStillPass: ['served-policy', 'app-loaded', 'bundled-fonts'],", to: "mustStillPass: ['served-policy']," },
  { name: "a control drops its named check", rule: "CSP-14", rel: VARIANTS_REL, from: "mustFailAt: 'bundled-fonts'", to: "mustFailAt: 'app-loaded'" },
  { name: "the latch is gone", rule: "CSP-15", rel: RUN_REL, from: "if (existsSync(LATCH)) throw new Error('the one live sign-in has already been used');", to: "" },
  { name: "a second variant may sign in", rule: "CSP-15", rel: VARIANTS_REL, from: "'dev-policy-shell': {\n      profile: 'shell',", to: "'dev-policy-shell': {\n      signIn: true,\n      profile: 'shell'," },
  { name: "the sign-in needs no flag", rule: "CSP-15", rel: RUN_REL, from: "const mayLeave = variant.signIn === true && live;", to: "const mayLeave = variant.signIn === true;" },
  { name: "the control may name Supabase", rule: "CSP-15", rel: RUN_REL, from: "if (blockedControl && String(obs.servedPolicy).includes('supabase.co')) {", to: "if (false) {" },
  { name: "evidence from another policy", rule: "CSP-16", rel: EVIDENCE_REL, from: "\"policySha256\": \"", to: "\"policySha256\": \"0" },
  { name: "evidence from another capability", rule: "CSP-16", rel: EVIDENCE_REL, from: "\"capabilityPermissionsSha256\": \"", to: "\"capabilityPermissionsSha256\": \"0" },
  { name: "the strict run is recorded as unproved", rule: "CSP-17", rel: EVIDENCE_REL, from: "\"variant\": \"strict-shell\",\n      \"expect\": \"pass\",\n      \"mustFailAt\": null,\n      \"proved\": true", to: "\"variant\": \"strict-shell\",\n      \"expect\": \"pass\",\n      \"mustFailAt\": null,\n      \"proved\": false" },
  { name: "a control is recorded as failing elsewhere", rule: "CSP-17", rel: EVIDENCE_REL, from: "\"mustFailAt\": \"bundled-fonts\"", to: "\"mustFailAt\": \"app-loaded\"" },
  { name: "a passing run leans on the excuse", rule: "CSP-17", rel: EVIDENCE_REL, from: "\"abortedByReload\": 0,", to: "\"abortedByReload\": 1," },
  { name: "a deliberate violation arrived", rule: "CSP-17", rel: EVIDENCE_REL, from: "\"arrivedAtListener\": {},", to: "\"arrivedAtListener\": { \"/fetch\": 1 }," },
  { name: "the sign-in is recorded as a success", rule: "CSP-18", rel: EVIDENCE_REL, from: "\"status\": 400", to: "\"status\": 200" },
  { name: "a second sign-in on record", rule: "CSP-18", rel: EVIDENCE_REL, from: "\"requests\": 1,", to: "\"requests\": 2," },
  { name: "a key in the evidence", rule: "CSP-18", rel: EVIDENCE_REL, from: "\"phase\":", to: "\"apikey\": \"x\",\n  \"phase\":" },
  { name: "the MSI line is dropped", rule: "CSP-19", rel: FINISH_REL, from: "The installed app gets this policy only when the MSI is next rebuilt.", to: "The installed app has this policy." },
  { name: "the owner check is dropped", rule: "CSP-19", rel: FINISH_REL, from: "A successful sign-in remains an owner check.", to: "Sign-in works." },
  { name: "the runner drops it", rule: "CSP-20", rel: VA_REL, from: `"${THIS_VALIDATOR}"`, to: `"${THIS_VALIDATOR}-retired"` },
  { name: "the cached runner drops it", rule: "CSP-20", rel: CR_REL, from: `"${THIS_VALIDATOR}"`, to: `"${THIS_VALIDATOR}-retired"` },
  { name: "a test is skipped", rule: "CSP-T", rel: TEST_REL, from: "it('a blank window fails, though it reports no violation at all'", to: "it.skip('a blank window fails, though it reports no violation at all'" },
  { name: "a test is removed", rule: "CSP-T", rel: TEST_REL, from: "it('a second sign-in request fails: one was allowed'", to: "it('renamed'" },
];

/** Every named mutation must be killed by its own rule. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`CSP-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`CSP-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("CSP-M: two mutations share a name");
  const rules = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of [...Array.from({ length: 20 }, (_, i) => `CSP-${i + 1}`), "CSP-T"]) {
    if (!rules.has(rule)) errors.push(`CSP-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

function run() {
  const raw = { ...sourceTree(SRC_ROOT) };
  for (const rel of SOURCES) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error(`${THIS_VALIDATOR}: ${e.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
