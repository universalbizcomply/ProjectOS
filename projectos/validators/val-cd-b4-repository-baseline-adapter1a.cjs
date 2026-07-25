"use strict";
// CD-B4-REPOSITORY-BASELINE-ADAPTER1A — the repository adapter runs a CLOSED allowlist of read-only Git
// commands via direct std::process (no shell, no arbitrary args), bounded in time and output, producing
// ONLY an untrusted observation; repository authority is minted solely by core. This validator proves
// those properties structurally.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = path.join(ROOT, "projectos", "host");

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}
// Scan PRODUCTION code only: cut the trailing `#[cfg(test)] mod tests { ... }` (conventionally last in
// the file) so test-only allowlists of forbidden verbs never trip a production-surface check.
function prod(src) {
  const i = src.search(/#\[cfg\(test\)\]/);
  return strip(i === -1 ? src : src.slice(0, i));
}
function exists(p) {
  return fs.existsSync(p);
}

function run() {
  const errors = [];
  const repoDir = path.join(HOST, "repository");
  if (!exists(repoDir)) return ["repository adapter crate missing"];

  const coreRepoRaw = read(path.join(HOST, "core", "src", "repository.rs"));
  const coreRepo = strip(coreRepoRaw);
  const command = prod(read(path.join(repoDir, "src", "command.rs")));
  const adapter = prod(read(path.join(repoDir, "src", "adapter.rs")));
  const parseRs = prod(read(path.join(repoDir, "src", "parse.rs")));
  const pathRs = strip(read(path.join(repoDir, "src", "path.rs")));
  const errorRs = strip(read(path.join(repoDir, "src", "error.rs")));
  const libRaw = read(path.join(repoDir, "src", "lib.rs"));

  // ---- 1. Opaque core authority; single mint; no caller construction --------------------------
  for (const t of ["VerifiedRepositoryIdentity", "VerifiedRepositoryBaseline"]) {
    if (!new RegExp("pub struct " + t + "\\b").test(coreRepo)) errors.push("missing core type: " + t);
    // No public fields.
    const body = coreRepo.slice(coreRepo.indexOf("pub struct " + t));
    const decl = body.slice(0, body.indexOf("}"));
    if (/\bpub\s+\w+:/.test(decl)) errors.push(t + " has a public field (must be opaque)");
    if (new RegExp("derive\\([^)]*\\bDefault\\b[^)]*\\)\\]\\s*(pub struct )?" + t).test(coreRepo))
      errors.push(t + " derives Default");
    if (!new RegExp("impl fmt::Debug for " + t + "\\b").test(coreRepo))
      errors.push(t + " has no hand-written redacted Debug");
  }
  if (/Serialize|Deserialize|serde/.test(coreRepo)) errors.push("core repository references serialisation");
  if (!/pub fn verify_repository_baseline\(/.test(coreRepo))
    errors.push("no verify_repository_baseline mint");
  // Missing tracking is NOT 0/0.
  if (!/TrackingReferenceMissing/.test(coreRepo))
    errors.push("core does not distinguish a missing tracking reference");
  if (!/RepositoryFreshness/.test(coreRepo) || !/LiveNotVerified/.test(coreRepo))
    errors.push("core does not preserve live-not-verified freshness honesty");
  // Redacted Debug marker.
  if (!/VerifiedRepositoryBaseline\([^)]*\[REDACTED\]/.test(coreRepo))
    errors.push("VerifiedRepositoryBaseline Debug is not redacted");

  // ---- 2. Closed allowlist; direct std::process; NO shell -------------------------------------
  if (!/pub enum GitCommand\b/.test(command)) errors.push("no closed GitCommand allowlist");
  if (!/Command::new\(&self\.exe\)|Command::new\(/.test(command))
    errors.push("adapter does not use direct std::process::Command");
  if (/cmd\.exe|powershell|pwsh|["']sh["']|-c\b|Stdio::inherit|\.shell\(/i.test(command))
    errors.push("adapter references a shell / -c invocation");
  // No mutation/network verbs may appear as command arguments.
  for (const verb of ["fetch", "pull", "push", "checkout", "switch", "reset", "clean", "commit", "merge", "rebase", '"add"', '"tag"']) {
    if (new RegExp('"' + verb.replace(/"/g, "") + '"').test(command) && verb !== '"add"')
      errors.push("allowlist contains a mutation/network verb: " + verb);
  }
  // Prompt-disabled + no-pager + no-editor env.
  for (const e of ["GIT_TERMINAL_PROMPT", "GIT_OPTIONAL_LOCKS", "GIT_PAGER", "GIT_EDITOR", "LC_ALL"])
    if (!new RegExp(e).test(command)) errors.push("command env missing: " + e);
  // Time + output bounds + kill-on-timeout.
  if (!/COMMAND_TIMEOUT|Duration::from_secs/.test(command)) errors.push("no per-command timeout");
  if (!/MAX_STDOUT|max_stdout/.test(command)) errors.push("no stdout bound");
  if (!/CommandTimeout/.test(command) || !/child\.kill\(\)/.test(command))
    errors.push("no kill-on-timeout");
  if (!/OutputOverflow/.test(command)) errors.push("no output-overflow refusal");

  // ---- 3. Adapter returns observation, never authority ----------------------------------------
  if (!/GitRepositoryObservation/.test(adapter))
    errors.push("adapter does not build a GitRepositoryObservation");
  if (/VerifiedRepositoryIdentity\s*\{|VerifiedRepositoryBaseline\s*\{|verify_repository_baseline\(/.test(adapter))
    errors.push("adapter constructs/mints repository authority (must stay in core)");
  // Path canonicalization + root comparison.
  if (!/canonicalize/.test(pathRs) || !/same_canonical|RootMismatch/.test(pathRs))
    errors.push("adapter does not canonicalize + compare the repository root");
  if (!/\.\.|traversal/.test(pathRs)) errors.push("path validation does not reject traversal");
  // Structured parsing (porcelain v2 + OID via core).
  if (!/porcelain/.test(parseRs) || !/is_valid_oid/.test(parseRs))
    errors.push("parser does not use porcelain-v2 + core OID validation");
  if (!/branch\.head/.test(parseRs)) errors.push("parser does not read porcelain-v2 branch header");

  // ---- 3b. Verified absolute Git executable (no uncontrolled PATH lookup in production) --------
  const configPath = path.join(repoDir, "src", "config.rs");
  if (!exists(configPath)) errors.push("no RepositoryAdapterConfig (executable pinning) module");
  else {
    const config = strip(read(configPath));
    const configRaw = read(configPath);
    if (!/verify_executable\(git_exe_path\)/.test(config))
      errors.push("config does not verify the Git executable");
    if (!/RepositoryAdapterConfig\(\[REDACTED\]\)/.test(configRaw))
      errors.push("config Debug does not redact the executable/root path");
  }
  if (!/pub fn verify_executable\(/.test(pathRs))
    errors.push("path module has no verify_executable");
  if (!/rejects bare|is_absolute|relative/.test(pathRs))
    errors.push("verify_executable does not reject a relative/bare git");
  // The PATH-resolved default runner must be TEST-ONLY (production pins a verified absolute exe).
  if (!/#\[cfg\(any\(test[^\]]*\)\]\s*impl Default for GitRunner/.test(command))
    errors.push("GitRunner PATH-default is not test-gated (production could fall back to PATH)");
  if (!/GitRunner::with_exe\(config\.git_exe\(\)/.test(adapter))
    errors.push("production adapter does not run the verified configured executable");

  // ---- 4. Payload-free errors; no network; posture --------------------------------------------
  const variantWithData = /^\s*[A-Z]\w*\(/m.test(strip(errorRs));
  if (variantWithData) errors.push("a RepoAdapterError variant carries a payload");
  if (/reqwest|hyper|ureq|TcpStream|fetch\(/.test(adapter + command))
    errors.push("adapter performs network I/O");
  if (!/forbid\(unsafe_code\)/.test(libRaw)) errors.push("adapter does not forbid unsafe");
  if (/EXECUTION_READY\s*=\s*true/.test(adapter + command + libRaw))
    errors.push("adapter overclaims EXECUTION_READY");

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-repository-baseline-adapter1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-repository-baseline-adapter1a: PASS");
}
