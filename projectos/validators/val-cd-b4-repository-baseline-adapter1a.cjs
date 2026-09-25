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

  // ---- 5. THE REPOSITORY READER AMENDMENT — RATIFIED WITH PLAN v1.6, PROJECTOS-HOST-REVIEW-PATH1B --
  //   OLD INVARIANT: the closed repository command vocabulary contains exactly the existing read-only
  //     commands, its only content read is the committed blob at one path of one exact commit, and
  //     its fixed environment does not disable replacement references, grafts or repository-local
  //     configuration.
  //   NEW INVARIANT: the vocabulary additionally contains exactly ONE read-only recursive
  //     endpoint-tree difference between two exact commits (status, modes, full-length identities,
  //     rename detection disabled) and exactly ONE read-only ancestry check between two exact
  //     commits, both taking validated commit identities only; and EVERY command runs with
  //     replacement references and grafts disabled and with no repository-local, user-level or
  //     system-level configuration able to alter the result or run a program.
  // Nothing above this line is weakened.

  // 5a. THE VOCABULARY IS EXACTLY THESE VERBS. A thirteenth variant is a new capability.
  const enumBody = (command.match(/pub enum GitCommand\s*\{([\s\S]*?)\n\}/) || ["", ""])[1];
  const variants = (enumBody.match(/^ {4}([A-Z]\w*)\s*(?:\{|,)/gm) || []).map((v) => v.trim().replace(/\s*[{,]$/, ""));
  const spelled = variants.slice().sort().join(",");
  if (spelled !== GIT_VOCABULARY.slice().sort().join(","))
    errors.push("the repository command vocabulary is [" + variants.join(", ") + "], not the ratified closed set");

  // 5b. THE TWO ADDITIONS, SPELLED EXACTLY, TAKING COMMIT IDENTITIES ONLY.
  const armOf = (name) => (command.match(new RegExp("GitCommand::" + name + "\\s*\\{[^}]*\\}\\s*=>\\s*vec!\\[([\\s\\S]*?)\\],")) || ["", ""])[1];
  const literalsOf = (arm) => (arm.match(/"[^"]*"/g) || []).map((s) => s.slice(1, -1));
  const diffArgs = literalsOf(armOf("DiffTreeEndpoints")).join(" ");
  if (diffArgs !== "diff-tree -r --raw -z --no-abbrev --no-renames --no-ext-diff --end-of-options")
    errors.push("the tree difference is spelled '" + diffArgs + "', not the ratified deterministic spelling");
  const ancestryArgs = literalsOf(armOf("IsAncestor")).join(" ");
  if (ancestryArgs !== "merge-base --is-ancestor")
    errors.push("the ancestry check is spelled '" + ancestryArgs + "', not the ratified spelling");
  for (const [variant, fields] of [["DiffTreeEndpoints", ["base", "candidate"]], ["IsAncestor", ["ancestor", "descendant"]]]) {
    const decl = (enumBody.match(new RegExp(variant + "\\s*\\{([\\s\\S]*?)\\n {4}\\}")) || ["", ""])[1];
    const typed = (decl.match(/^\s*(\w+):\s*([\w:<>]+),/gm) || []).map((f) => f.trim());
    const want = fields.map((f) => f + ": CommitId,");
    if (typed.join("|") !== want.join("|"))
      errors.push(variant + " must take exactly two CommitId operands and nothing else (found: " + typed.join(" ") + ")");
    const arm = armOf(variant);
    if ((arm.match(/\.as_str\(\)\.to_string\(\)/g) || []).length !== 2 || /format!/.test(arm))
      errors.push(variant + " must put exactly its two validated commit identities on the command line, uninterpolated");
  }
  // Exactly one content read, and no second way to take a difference or walk history.
  for (const [verb, max] of [["cat-file", 1], ["diff-tree", 1], ["merge-base", 1]])
    if ((command.match(new RegExp('"' + verb + '"', "g")) || []).length !== max)
      errors.push("the vocabulary must spell '" + verb + "' exactly " + max + " time(s)");
  for (const verb of ["diff", "diff-index", "diff-files", "log", "show", "ls-tree", "rev-list --all", "for-each-ref", "-M", "-C", "--find-renames", "--textconv", "--filters", "--ext-diff"])
    if (new RegExp('"' + verb.replace(/[-]/g, "\\-") + '"').test(command))
      errors.push("the vocabulary contains '" + verb + "', which the amendment does not ratify");

  // 5c. THE ENVIRONMENT IS FIXED BY THE HOST, IN FULL, FOR EVERY COMMAND.
  if (!/\.env_clear\(\)/.test(command)) errors.push("the runner inherits the Host's environment instead of clearing it");
  if ((command.match(/Command::new\(/g) || []).length !== 1)
    errors.push("the repository crate must spawn Git from exactly one place, so one environment covers every command");
  if (!/\.envs\(fixed_environment\(root\)\)/.test(command)) errors.push("the runner does not apply the fixed environment");
  const passthrough = (command.match(/const ENV_PASSTHROUGH: &\[&str\] = &\[([^\]]*)\]/) || ["", ""])[1];
  const passed = (passthrough.match(/"[^"]+"/g) || []).map((s) => s.slice(1, -1));
  if (passed.join(",") !== ENV_PASSTHROUGH.join(","))
    errors.push("the environment passthrough is [" + passed.join(", ") + "], not the ratified closed list");
  for (const [name, value] of FIXED_ENV)
    if (!new RegExp('\\("' + name + '",\\s*' + value + "\\)").test(command))
      errors.push("the fixed environment no longer sets " + name);
  for (const [key, value] of CONFIG_OVERRIDES)
    if (!new RegExp('\\("' + key.replace(/\./g, "\\.") + '",\\s*' + value + "\\)").test(command))
      errors.push("repository-local configuration is no longer overridden for " + key);
  if (/\.env\(\s*"GIT_(DIR|WORK_TREE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|INDEX_FILE|NAMESPACE|CONFIG_PARAMETERS)"/.test(command))
    errors.push("the runner sets a variable that re-points the repository being read");

  // 5d. THE READER REFUSES BEFORE IT DIFFERENCES, AND A FAILED DIFFERENCE IS NOT AN EMPTY ONE.
  const changes = (adapter.match(/pub fn changes_since\([\s\S]*?\n {4}\}/) || [""])[0];
  if (changes === "") errors.push("the committed reader has no changes_since");
  else {
    if (!/pub fn changes_since\(&self, baseline: &CommitId\)/.test(changes))
      errors.push("changes_since must take the baseline commit and NOTHING else — the candidate is the pinned commit");
    const order = ["BaselineUnavailable", "CandidateUnavailable", "BaselineNotAncestor", "DiffTreeEndpoints"].map((t) => changes.indexOf(t));
    if (order.some((i) => i < 0) || order.some((v, i) => i > 0 && v < order[i - 1]))
      errors.push("changes_since no longer refuses an absent baseline, an absent candidate and a non-ancestor BEFORE taking the difference");
    if (!/candidate: self\.commit\.clone\(\)/.test(changes))
      errors.push("changes_since no longer differences against the commit the reader pinned at open");
    if (!/if out\.code != Some\(0\) \{\s*return Err\(RepoAdapterError::UnexpectedExit\);/.test(changes))
      errors.push("changes_since no longer refuses a failed tree difference");
  }
  if (!/Ok\(out\.code == Some\(0\)\)/.test(adapter)) errors.push("an ancestry answer other than exit 0 can be read as yes");

  // 5e. NO SECOND REPOSITORY READER anywhere in the Host tree.
  for (const crate of fs.readdirSync(HOST)) {
    if (crate === "repository") continue;
    const src = path.join(HOST, crate, "src");
    if (!exists(src)) continue;
    const stack = [src];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(abs);
        else if (ent.name.endsWith(".rs") && /"(cat-file|diff-tree|merge-base|rev-list|ls-tree)"/.test(prod(read(abs))))
          errors.push("projectos/host/" + crate + " spells a Git object read of its own — the repository crate is the one reader");
      }
    }
  }

  return errors;
}

/** The ratified closed vocabulary: the ten accepted verbs plus the two PATH1B additions. */
const GIT_VOCABULARY = Object.freeze([
  "IsInsideWorkTree", "ShowToplevel", "GitCommonDir", "RevParseHead", "SymbolicRefHead", "StatusPorcelain",
  "RevListCount", "SubmoduleStatus", "WorktreeList", "CatFileBlob", "DiffTreeEndpoints", "IsAncestor",
]);
const ENV_PASSTHROUGH = Object.freeze(["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "PATH"]);
const FIXED_ENV = Object.freeze([
  ["GIT_CONFIG_NOSYSTEM", '"1"'], ["GIT_CONFIG_SYSTEM", "NULL_DEVICE"], ["GIT_CONFIG_GLOBAL", "NULL_DEVICE"],
  ["GIT_ATTR_NOSYSTEM", '"1"'], ["GIT_NO_REPLACE_OBJECTS", '"1"'], ["GIT_GRAFT_FILE", "NULL_DEVICE"],
  ["GIT_NO_LAZY_FETCH", '"1"'],
]);
const CONFIG_OVERRIDES = Object.freeze([
  ["core.fsmonitor", '"false"'], ["core.hooksPath", "NULL_DEVICE"], ["core.pager", '"cat"'],
  ["core.useReplaceRefs", '"false"'], ["protocol.allow", '"never"'],
]);

module.exports = { run, GIT_VOCABULARY, ENV_PASSTHROUGH };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-cd-b4-repository-baseline-adapter1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-cd-b4-repository-baseline-adapter1a: PASS");
}
