"use strict";
/**
 * Proves the governed Claude Code worker adapter's SAFEGUARDS (Gate 1 architecture) using a SYNTHETIC CLI
 * stand-in + a real throwaway git repo. The REAL `claude` CLI invocation is an owner-machine step; here we
 * prove the wrapper's guards. Opt-in (creates a temp git repo + drives process control) — NOT part of
 * `npm run validate`; run standalone for evidence.
 *
 * Invariants:
 *  1  empty prompt refused                     2  unknown project (no trusted root) refused
 *  3  wrong branch refused                      4  dirty tree + requireClean refused
 *  5  unconfigured CLI → BLOCKED (not a fake)   6  allowed-path change → COMPLETED, change reported
 *  7  forbidden-path change (or projectos/) refused, path listed
 *  8  timeout kills + refuses                   9  output overflow kills + refuses
 * 10  secret in worker output is redacted      11  no metered AI API / spawns with shell:false (source)
 * 12  a staged rename of protected source out of the allowlist is caught on its ORIGIN (two-sided)
 * 13  an unregistered secret shape in worker output is generically scrubbed
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");
const worker = require("../bridge/claude-worker.cjs");
const { runClaudeWorker } = worker;
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-worker-secret-9k8j7h";

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-repo-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "checkout", "-q", "-B", "work"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(dir, "app"), { recursive: true });
  fs.writeFileSync(path.join(dir, "app", "seed.txt"), "seed\n");
  fs.mkdirSync(path.join(dir, "projectos"), { recursive: true });
  fs.writeFileSync(path.join(dir, "projectos", "core.txt"), "core\n");
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "seed"]);
  return dir;
}

// Synthetic `claude` stand-in: a fake child that (optionally) edits a file then closes / floods / hangs.
function fakeSpawn(behavior) {
  return (_bin, _argv, opts) => {
    const ch = new EventEmitter();
    ch.stdout = new EventEmitter();
    ch.pid = 2147480000; // non-existent pid; taskkill is a harmless no-op
    process.nextTick(() => behavior(ch, opts.cwd));
    return ch;
  };
}
const writeThenClose = (relPath, stdoutText) => (ch, cwd) => {
  fs.mkdirSync(path.dirname(path.join(cwd, relPath)), { recursive: true });
  fs.writeFileSync(path.join(cwd, relPath), "changed\n");
  if (stdoutText) ch.stdout.emit("data", Buffer.from(stdoutText));
  ch.emit("close", 0);
};

async function run() {
  const errors = [];
  const repo = mkRepo();
  try {
    const base = { projectId: "acme", allowedPaths: ["app"] };
    const cfg = (extra) => ({ projectRoots: { acme: repo }, claudeBin: "synthetic-claude", spawnFn: fakeSpawn(writeThenClose("app/new.txt")), redactor: createRedactor(), timeoutMs: 1000, maxOutputBytes: 1 << 20, ...extra });

    const a1 = await runClaudeWorker({ ...base, prompt: "" }, cfg());
    if (a1.decision !== "REFUSED" || a1.reason !== "empty-prompt") errors.push("inv1: empty prompt not refused");

    const a2 = await runClaudeWorker({ ...base, prompt: "x", projectId: "ghost" }, cfg());
    if (a2.decision !== "REFUSED" || a2.reason !== "no-trusted-root") errors.push("inv2: unknown project not refused");

    const a3 = await runClaudeWorker({ ...base, prompt: "x", expectedBranch: "main" }, cfg());
    if (a3.decision !== "REFUSED" || !String(a3.reason).startsWith("branch-mismatch")) errors.push("inv3: wrong branch not refused");

    fs.writeFileSync(path.join(repo, "app", "dirty.txt"), "dirty\n");
    const a4 = await runClaudeWorker({ ...base, prompt: "x", requireClean: true }, cfg());
    if (a4.decision !== "REFUSED" || a4.reason !== "working-tree-dirty") errors.push("inv4: dirty tree not refused");
    fs.rmSync(path.join(repo, "app", "dirty.txt"));

    const a5 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ claudeBin: "" }));
    if (a5.decision !== "BLOCKED" || a5.reason !== "claude-cli-not-configured") errors.push("inv5: unconfigured CLI not BLOCKED");

    const a6 = await runClaudeWorker({ ...base, prompt: "add file" }, cfg());
    if (a6.decision !== "COMPLETED" || !(a6.changedFiles || []).some((p) => p === "app/new.txt")) errors.push("inv6: allowed-path change not COMPLETED/reported: " + JSON.stringify(a6));
    execFileSync("git", ["-C", repo, "checkout", "-q", "--", "."]); execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const a7 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ spawnFn: fakeSpawn(writeThenClose("projectos/hack.txt")) }));
    if (a7.decision !== "REFUSED" || a7.reason !== "forbidden-path-change" || !(a7.refusedPaths || []).some((p) => p.startsWith("projectos/"))) errors.push("inv7: forbidden-path change not refused: " + JSON.stringify(a7));
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const a8 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ timeoutMs: 120, spawnFn: fakeSpawn((ch) => { setTimeout(() => ch.emit("close", 0), 500); }) }));
    if (a8.decision !== "REFUSED" || a8.reason !== "timeout") errors.push("inv8: timeout not enforced: " + JSON.stringify(a8));

    const a9 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ maxOutputBytes: 64, spawnFn: fakeSpawn((ch) => { ch.stdout.emit("data", Buffer.from("x".repeat(500))); setTimeout(() => ch.emit("close", 0), 20); }) }));
    if (a9.decision !== "REFUSED" || a9.reason !== "output-overflow") errors.push("inv9: output overflow not enforced: " + JSON.stringify(a9));

    const rd = createRedactor(); rd.register(SECRET, "ref_w");
    const a10 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ redactor: rd, spawnFn: fakeSpawn(writeThenClose("app/ok.txt", "leaked " + SECRET)) }));
    if (String(a10.output || "").includes(SECRET)) errors.push("inv10: secret leaked in worker output");
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    // inv12: a STAGED RENAME that moves ProjectOS source out of the allowlist must be caught on its ORIGIN.
    const renameWorker = fakeSpawn((ch, cwd) => {
      execFileSync("git", ["-C", cwd, "mv", "projectos/core.txt", "app/renamed.txt"]);
      ch.emit("close", 0);
    });
    const a12 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ spawnFn: renameWorker }));
    if (a12.decision !== "REFUSED" || a12.reason !== "forbidden-path-change" || !(a12.refusedPaths || []).some((p) => p === "projectos/core.txt")) {
      errors.push("inv12: staged rename of protected source not caught on its origin: " + JSON.stringify(a12));
    }
    execFileSync("git", ["-C", repo, "reset", "-q", "--hard"]); execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    // inv13: an UNREGISTERED secret shape in worker output is generically scrubbed.
    const a13 = await runClaudeWorker({ ...base, prompt: "x" }, cfg({ redactor: createRedactor(), spawnFn: fakeSpawn(writeThenClose("app/ok.txt", "jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")) }));
    if (/eyJ[A-Za-z0-9_-]{12,}/.test(String(a13.output || ""))) errors.push("inv13: unregistered secret shape not scrubbed from output");
    execFileSync("git", ["-C", repo, "clean", "-fdq"]);

    const src = fs.readFileSync(path.join(__dirname, "..", "bridge", "claude-worker.cjs"), "utf8");
    // Real-usage patterns only (not the words "Anthropic/OpenAI" in the docstring that DISCLAIMS them).
    if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|api\.(anthropic|openai)\.com|require\(["'](openai|@anthropic)|\bfetch\(|https?:\/\//i.test(src)) errors.push("inv11: adapter references a metered API / network");
    if (!/shell:\s*false/.test(src)) errors.push("inv11: adapter does not spawn with shell:false");
  } catch (e) {
    errors.push("claude-worker validator crashed: " + e.message);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  return errors;
}

if (require.main === module) {
  run().then((e) => {
    if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-claude-worker: " + e.length + " error(s)"); process.exit(1); }
    console.log("validate-claude-worker: PASS");
  });
}
module.exports = { run };
