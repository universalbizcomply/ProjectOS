"use strict";
/**
 * MANDATORY security evidence for PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1A. Proves the SAFEGUARDS of
 * the hardened, clone-isolated worker adapter using a SYNTHETIC CLI stand-in + REAL throwaway git repos.
 * The REAL `claude` CLI round-trip is an owner-machine step; here we prove the containment + fail-safe
 * behaviour. Opt-in (creates git repos + drives process control) — NOT part of `npm run validate`; run
 * standalone. All 38 invariants must pass (a symlink-based inv is env-skipped only if the host cannot make
 * links unprivileged).
 *
 * Coverage (owner §8 + the ChatGPT/ECC review round):
 *  1 request policy-tamper refused            2 empty prompt refused
 *  3 raw-secret prompt refused                4 unknown project refused
 *  5 allowlist-touches-projectos refused      6 CLI not configured → BLOCKED
 *  7 unsafe .cmd/.bat shim on win32 → BLOCKED 8 no claudeArgs (tool restriction) → BLOCKED
 *  9 root != git toplevel refused            10 wrong remote refused
 * 11 wrong branch refused                    12 dirty canonical baseline refused
 * 13 parent-env secret not inherited (unit+spawn)
 * 14 allowed change → COMPLETED, manifest + patchHash, valid result
 * 15 forbidden-path (projectos/) refused     16 protected rename origin+dest caught
 * 17 DIRECT write to canonical detected (fs proof)      18 canonical hook-CONTENT edit detected
 * 19 canonical ref/tag creation detected     20 canonical config edit detected
 * 21 fake clone/.git cannot hide a canonical mutation   22 timeout kills + confirmed
 * 23 stdout overflow kills                   24 stderr overflow kills
 * 25 registered secret redacted             26 generic secret redacted
 * 27 buildResult THROWS on forbidden decision (no silent coerce)
 * 28 validateResult catches a tampered result           29 no metered AI API (source scan)
 * 30 canonical byte-identical on a benign run (fs proof)
 * 31 case-insensitive forbidden-path bypass refused (win/mac) / documented on posix
 * 32 absolute/UNC path rejected (unit)       33 capability overall() logic
 * 34 capability presentation owner-friendly + no jargon leak
 * 35 .git/info/exclude tamper detected (metaHash)       36 SYMLINKED canonical hook detected (metaHash)
 * 37 dangerous CLI flag from args builder refused        38 canonical file drop matching a pre-existing
 *    ignore rule detected (ignoredInventory)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const P = require("../bridge/worker-policy.cjs");
const cap = require("../bridge/owner-capability-check.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-worker-secret-9k8j7h";
const ORIGIN = "https://example.invalid/acme/app.git";

function g(dir, args) { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }); }
function commonDir(repo) { return path.resolve(repo, g(repo, ["rev-parse", "--git-common-dir"]).trim()); }

function mkRepo(opts) {
  const o = opts || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-can-"));
  g(dir, ["init", "-q"]); g(dir, ["checkout", "-q", "-B", "work"]);
  g(dir, ["config", "user.email", "t@t"]); g(dir, ["config", "user.name", "t"]);
  g(dir, ["remote", "add", "origin", ORIGIN]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  if (o.gitignore) fs.writeFileSync(path.join(dir, ".gitignore"), o.gitignore + "\n");
  g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}
function rmRepo(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ } }

function baseCfg(repo, extra) {
  return Object.assign({
    projectRoots: { acme: repo },
    policy: { expectedRemote: ORIGIN, expectedBranch: "work", requireClean: true, allowedPaths: ["app"], timeoutMs: 3000, maxOutputBytes: 1 << 20 },
    operation: { phaseId: "PH1", approvalId: "AP1", operationId: "OP1" },
    claudeBin: "synthetic-claude", claudeArgs: (p) => ["-p", p], redactor: createRedactor(),
  }, extra || {});
}

let lastSpawnEnv = null;
function synthSpawn(behavior, stdoutText, opts) {
  const o = opts || {};
  return (_bin, _argv, spawnOpts) => {
    lastSpawnEnv = spawnOpts.env;
    const ch = new EventEmitter(); ch.stdout = new EventEmitter(); ch.stderr = new EventEmitter();
    ch.pid = 2147480000; ch.kill = () => {};
    process.nextTick(() => {
      try { if (behavior) behavior(spawnOpts.cwd); } catch (e) { /* worker may fail */ }
      if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText));
      if (o.hang) return;
      if (o.floodOut) ch.stdout.emit("data", Buffer.from("x".repeat(5000)));
      if (o.floodErr) ch.stderr.emit("data", Buffer.from("e".repeat(5000)));
      ch.emit("close", 0);
    });
    return ch;
  };
}
const writeIn = (rel, content) => (cwd) => { const abs = path.join(cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content || "changed\n"); };
const REQ = { prompt: "add a file", projectId: "acme" };

async function withRepo(fn, opts) {
  const repo = mkRepo(opts);
  try { await fn(repo); } finally { rmRepo(repo); }
}

async function run() {
  const errors = [];
  const fail = (inv, msg, got) => errors.push(inv + ": " + msg + (got !== undefined ? " :: " + JSON.stringify(got) : ""));

  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, allowedPaths: ["projectos"] }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "request-policy-tamper") fail("inv1", "policy tamper not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, prompt: " " }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "empty-prompt") fail("inv2", "empty prompt not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, prompt: "key sk-ABCDEFGHIJKLMNOP01234567 here" }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "prompt-contains-raw-secret") fail("inv3", "raw-secret prompt not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker({ ...REQ, projectId: "ghost" }, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "no-trusted-root") fail("inv4", "unknown project not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.allowedPaths = ["projectos"];
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "allowlist-touches-projectos") fail("inv5", "projectos allowlist not refused", a);
  });
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { claudeBin: "", spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.decision !== "BLOCKED" || a.reason !== "claude-cli-not-configured") fail("inv6", "unconfigured CLI not BLOCKED", a);
  });
  await withRepo(async (repo) => {
    if (process.platform === "win32") {
      const a = await runClaudeWorker(REQ, baseCfg(repo, { claudeBin: "claude.cmd", spawnFn: synthSpawn(writeIn("app/x.txt")) }));
      if (a.decision !== "BLOCKED" || a.reason !== "unsafe-cli-shim-on-windows") fail("inv7", "unsafe shim not BLOCKED", a);
    } else { errors.push("inv7: SKIPPED-ENV (win32-only shim check)"); }
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); delete cfg.claudeArgs;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "BLOCKED" || a.reason !== "no-tool-restriction-configured") fail("inv8", "missing tool restriction not BLOCKED", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.projectRoots.acme = path.join(repo, "app");
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "root-not-git-toplevel") fail("inv9", "non-toplevel root not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.expectedRemote = "https://example.invalid/other.git";
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "remote-mismatch") fail("inv10", "wrong remote not refused", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }); cfg.policy.expectedBranch = "main";
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "branch-mismatch") fail("inv11", "wrong branch not refused", a);
  });
  await withRepo(async (repo) => {
    fs.writeFileSync(path.join(repo, "app", "dirty.txt"), "dirty\n");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (a.reason !== "working-tree-dirty") fail("inv12", "dirty baseline not refused", a);
  });

  // inv13 parent-env secret not inherited (unit + spawn)
  process.env.PLANTED_SECRET_TOKEN = "should-never-reach-child";
  const env = P.buildMinimalEnv(process.platform, []);
  if (Object.prototype.hasOwnProperty.call(env, "PLANTED_SECRET_TOKEN") || Object.values(env).some((v) => String(v).includes("should-never-reach-child"))) fail("inv13", "planted secret in minimal env (unit)");
  await withRepo(async (repo) => {
    lastSpawnEnv = null;
    await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/x.txt")) }));
    if (!lastSpawnEnv || Object.prototype.hasOwnProperty.call(lastSpawnEnv, "PLANTED_SECRET_TOKEN")) fail("inv13", "planted secret reached child env (spawn)", lastSpawnEnv && Object.keys(lastSpawnEnv));
  });
  delete process.env.PLANTED_SECRET_TOKEN;

  // inv14 allowed change → COMPLETED + manifest + valid result
  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/new.txt", "hello\n")) }));
    if (a.decision !== "COMPLETED") fail("inv14", "allowed change not COMPLETED", a);
    else if (!a.patchHash || !(a.result.changeManifest || []).some((m) => m.path === "app/new.txt" && /^[0-9a-f]{64}$/.test(m.sha256))) fail("inv14", "manifest/patchHash wrong", a.result && a.result.changeManifest);
    else if (P.validateResult(a.result).length) fail("inv14", "result invalid", P.validateResult(a.result));
    else if (a.result.workerDecision !== "PROPOSED" || a.result.projectOsDecisionRequired !== true) fail("inv14", "result decision wrong", a.result.workerDecision);
  });

  await withRepo(async (repo) => {
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("projectos/hack.txt")) }));
    if (a.reason !== "forbidden-path-change" || !(a.refusedPaths || []).some((p) => P.normPath(p).startsWith("projectos/"))) fail("inv15", "forbidden-path not refused", a);
  });
  await withRepo(async (repo) => {
    const mv = (cwd) => g(cwd, ["mv", "projectos/core.txt", "app/renamed.txt"]);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(mv) }));
    if (a.reason !== "forbidden-path-change" || !(a.refusedPaths || []).some((p) => P.normPath(p) === "projectos/core.txt")) fail("inv16", "rename origin not caught", a);
  });

  // inv17 DIRECT write to canonical (absolute path, bypassing the clone) is detected by the fs proof
  await withRepo(async (repo) => {
    const attack = () => fs.writeFileSync(path.join(repo, "app", "seed.txt"), "TAMPERED-DIRECT\n");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("filesHash")) fail("inv17", "direct canonical write not detected", a);
  });
  // inv18 canonical hook-CONTENT edit detected (content, not just filename)
  await withRepo(async (repo) => {
    const attack = () => { const h = path.join(commonDir(repo), "hooks"); fs.mkdirSync(h, { recursive: true }); fs.writeFileSync(path.join(h, "pre-commit"), "#!/bin/sh\nevil\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv18", "hook-content edit not detected", a);
  });
  // inv19 canonical ref/tag creation detected
  await withRepo(async (repo) => {
    const attack = () => { const rd = path.join(commonDir(repo), "refs", "heads"); fs.mkdirSync(rd, { recursive: true }); fs.writeFileSync(path.join(rd, "backdoor"), g(repo, ["rev-parse", "HEAD"]).trim() + "\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv19", "ref creation not detected", a);
  });
  // inv20 canonical config edit detected
  await withRepo(async (repo) => {
    const attack = () => g(repo, ["config", "--local", "sneak.flag", "1"]);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv20", "config edit not detected", a);
  });
  // inv21 a FAKE clone/.git cannot hide a real canonical mutation (the fs proof does not trust clone git)
  await withRepo(async (repo) => {
    const attack = (cwd) => {
      try { fs.rmSync(path.join(cwd, ".git"), { recursive: true, force: true }); execFileSync("git", ["-C", cwd, "init", "-q"]); } catch (e) { /* clone git wrecked either way */ }
      fs.writeFileSync(path.join(repo, "app", "seed.txt"), "TAMPERED-BEHIND-FAKE-GIT\n"); // real canonical mutation
    };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated") fail("inv21", "canonical mutation hidden by fake clone .git", a);
  });

  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { hang: true }) }); cfg.policy.timeoutMs = 150;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "timeout") fail("inv22", "timeout not enforced", a);
    else if (a.result && a.result.killConfirmed !== true) fail("inv22", "kill not confirmed", a.result.killConfirmed);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { floodOut: true }) }); cfg.policy.maxOutputBytes = 64;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "output-overflow") fail("inv23", "stdout overflow not enforced", a);
  });
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(null, null, { floodErr: true }) }); cfg.policy.maxOutputBytes = 64;
    const a = await runClaudeWorker(REQ, cfg);
    if (a.reason !== "stderr-overflow") fail("inv24", "stderr overflow not enforced", a);
  });
  await withRepo(async (repo) => {
    const rd = createRedactor(); rd.register(SECRET, "ref_w");
    const a = await runClaudeWorker(REQ, baseCfg(repo, { redactor: rd, spawnFn: synthSpawn(writeIn("app/ok.txt"), "leaked " + SECRET) }));
    if (String(a.output || "").includes(SECRET) || String((a.result && a.result.outputExcerpt) || "").includes(SECRET)) fail("inv25", "registered secret leaked", a.output);
  });
  await withRepo(async (repo) => {
    // Build a JWT-shaped blob at runtime so no literal secret-pattern sits in this source file.
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: "1234567890" }) + ".c2ln";
    const hdr = jwt.slice(0, 3);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/ok.txt"), "jwt=" + jwt) }));
    const excerpt = String((a.result && a.result.outputExcerpt) || "");
    if (excerpt.includes(jwt.slice(0, 24)) || new RegExp(hdr + "[A-Za-z0-9_-]{16,}").test(excerpt)) fail("inv26", "generic secret not scrubbed", excerpt);
  });

  // inv27 buildResult THROWS on a forbidden decision (no silent coerce)
  {
    let threw = false; try { P.buildResult({ workerDecision: "APPROVED" }); } catch (e) { threw = true; }
    if (!threw) fail("inv27", "buildResult did not throw on APPROVED");
    let threw2 = false; try { P.buildResult({ approved: true }); } catch (e) { threw2 = true; }
    if (!threw2) fail("inv27", "buildResult did not throw on forbidden field");
  }
  // inv28 validateResult catches a tampered result
  {
    const good = P.buildResult({ projectId: "acme", baselineHead: "a", finalHead: "a" });
    if (P.validateResult(good).length) fail("inv28", "valid result rejected", P.validateResult(good));
    const bad = Object.assign({}, good); delete bad.patchHash; bad.trusted = true;
    const be = P.validateResult(bad);
    if (!be.some((e) => e.includes("patchHash")) || !be.some((e) => e.includes("trusted"))) fail("inv28", "tampered result not caught", be);
  }
  // inv29 no metered AI API (source scan)
  {
    const rx = /ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\/[^\s"']*\/(v1|chat|completions)/i;
    for (const f of ["claude-worker.cjs", "worker-policy.cjs"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "bridge", f), "utf8");
      if (rx.test(src)) fail("inv29", "metered API/network reference in " + f);
    }
    if (!/shell:\s*false/.test(fs.readFileSync(path.join(__dirname, "..", "bridge", "claude-worker.cjs"), "utf8"))) fail("inv29", "adapter not shell:false");
  }
  // inv30 canonical byte-identical on a benign run
  await withRepo(async (repo) => {
    const before = worker.canonicalSnapshot(repo);
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/new.txt")) }));
    if (a.decision !== "COMPLETED") fail("inv30", "benign run not COMPLETED", a);
    if (worker.driftFields(before, worker.canonicalSnapshot(repo)).length) fail("inv30", "canonical drifted on benign run", worker.driftFields(before, worker.canonicalSnapshot(repo)));
  });
  // inv31 case-insensitive forbidden-path bypass (win/mac); documented no-op on posix
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { spawnFn: synthSpawn(writeIn("app/Secrets/leak.txt")) });
    cfg.policy.allowedPaths = ["app"]; cfg.policy.forbiddenPaths = ["app/secrets"];
    const a = await runClaudeWorker(REQ, cfg);
    if (process.platform === "win32" || process.platform === "darwin") {
      if (a.reason !== "forbidden-path-change") fail("inv31", "re-cased forbidden path not refused", a);
    } else if (a.decision !== "COMPLETED") { errors.push("inv31: SKIPPED-ENV (posix is case-sensitive; app/Secrets != app/secrets by design)"); }
  });
  // inv32 absolute/UNC path rejected (unit)
  {
    const pol = { allowedPaths: ["app"], forbiddenPaths: [] };
    for (const bad of ["/etc/passwd", "C:/win", "\\\\srv\\share\\x", "app/../projectos/x", "app\0x"]) {
      if (P.isAllowedPath(bad, pol)) fail("inv32", "unsafe path allowed: " + bad);
    }
    if (!P.isAllowedPath("app/ok.txt", pol)) fail("inv32", "legit path rejected");
  }
  // inv33 capability overall() logic
  {
    const all = { claude: { status: "PASS" }, docker: { status: "PASS" }, supabase: { status: "PASS" } };
    const one = { claude: { status: "PASS" }, docker: { status: "BLOCKED" }, supabase: { status: "PASS" } };
    if (cap.overall(all) !== "READY-FOR-REAL-E2E") fail("inv33", "all-PASS not READY");
    if (cap.overall(one) !== "BLOCKED-OWNER-MACHINE-CAPABILITY") fail("inv33", "one-BLOCKED not BLOCKED");
  }
  // inv34 capability presentation owner-friendly + no machine jargon leak
  {
    const blk = cap.present({ platform: "win32", node: "v24", claude: { status: "BLOCKED", how: "session-present-but-no-spawnable-cli" }, docker: { status: "BLOCKED", how: "no-docker-binary" }, supabase: { status: "BLOCKED", how: "cli-error" } });
    if (!/ACTION NEEDED/.test(blk) || !/NOT READY/.test(blk) || !/What to do next/.test(blk)) fail("inv34", "blocked presentation missing guidance");
    if (/session-present-but-no-spawnable-cli|no-docker-binary|cli-error/.test(blk)) fail("inv34", "raw jargon leaked");
    const rdy = cap.present({ platform: "win32", node: "v24", claude: { status: "PASS", how: "cli-on-path" }, docker: { status: "PASS", how: "daemon-running" }, supabase: { status: "PASS", how: "cli-present" } });
    if (!/RESULT: READY/.test(rdy)) fail("inv34", "ready presentation missing READY");
  }

  // inv35 canonical .git/info/exclude tampering detected (metaHash) — a hidden-file plant cannot escape
  await withRepo(async (repo) => {
    const attack = () => { const info = path.join(commonDir(repo), "info"); fs.mkdirSync(info, { recursive: true }); fs.appendFileSync(path.join(info, "exclude"), "\npayload.js\n"); };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv35", "info/exclude tamper not detected", a);
  });
  // inv36 SYMLINKED canonical hook detected (metaHash) — symlink entries are not skipped
  await withRepo(async (repo) => {
    const targ = fs.mkdtempSync(path.join(os.tmpdir(), "cw-hooktarget-")); fs.writeFileSync(path.join(targ, "evil.sh"), "evil\n");
    let made = false;
    const attack = () => { const h = path.join(commonDir(repo), "hooks"); fs.mkdirSync(h, { recursive: true }); try { fs.symlinkSync(path.join(targ, "evil.sh"), path.join(h, "pre-commit"), "file"); made = true; } catch (e) { /* unprivileged */ } };
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    rmRepo(targ);
    if (!made) errors.push("inv36: SKIPPED-ENV (file symlink creation unprivileged on this host)");
    else if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("metaHash")) fail("inv36", "symlinked hook not detected", a);
  });
  // inv37 a dangerous CLI flag from the args builder is refused (defence in depth on tool restriction)
  await withRepo(async (repo) => {
    const cfg = baseCfg(repo, { claudeArgs: (p) => ["--dangerously-skip-permissions", "-p", p], spawnFn: synthSpawn(writeIn("app/x.txt")) });
    const a = await runClaudeWorker(REQ, cfg);
    if (a.decision !== "BLOCKED" || a.reason !== "dangerous-cli-flag") fail("inv37", "dangerous flag not refused", a);
  });
  // inv38 a file dropped into canonical that matches a PRE-EXISTING ignore rule is still detected
  await withRepo(async (repo) => {
    const attack = () => fs.writeFileSync(path.join(repo, "app", "planted.log"), "hidden\n"); // matches *.log
    const a = await runClaudeWorker(REQ, baseCfg(repo, { spawnFn: synthSpawn(attack) }));
    if (a.decision !== "BLOCKED" || a.reason !== "canonical-mutated" || !(a.fields || []).includes("ignoredInventory")) fail("inv38", "ignored-file drop into canonical not detected", a);
  }, { gitignore: "*.log" });

  return errors;
}

if (require.main === module) {
  run().then((e) => {
    const real = e.filter((x) => !x.includes("SKIPPED-ENV"));
    const skipped = e.filter((x) => x.includes("SKIPPED-ENV"));
    skipped.forEach((x) => console.error("SKIP: " + x));
    if (real.length) { real.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + real.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS (38 invariants" + (skipped.length ? ", " + skipped.length + " env-skipped" : "") + ")");
  }).catch((e) => { console.error("validate-claude-worker CRASHED: " + e.stack); process.exit(1); });
}
module.exports = { run };
