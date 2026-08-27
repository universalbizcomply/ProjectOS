"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["projectos", "knowledge"];
const EXTS = [".json", ".md", ".txt", ".cjs", ".js"];
const PATTERNS = [
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "stripe-live", re: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: "stripe-test", re: /sk_test_[A-Za-z0-9]{16,}/ },
  { name: "stripe-restricted", re: /rk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: "stripe-webhook", re: /whsec_[A-Za-z0-9]{16,}/ },
  { name: "supabase-pat", re: /sbp_[a-f0-9]{40,}/ },
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{36,}/ },
  { name: "aws-akid", re: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // PROVIDER MODEL KEYS. Every shape above is underscore-delimited; OpenAI and Anthropic are
  // hyphen-delimited, so none of them came close. Kept identical to `credentials/credential-shapes.cjs`
  // and to the discovery engine's own list — `val-projectos-provider-key-shapes1a` refuses the drift.
  { name: "openai-project-key", re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-service-account-key", re: /sk-svcacct-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-admin-key", re: /sk-admin-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-legacy-key", re: /sk-[A-Za-z0-9]{40,}/ },
  { name: "anthropic-key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ }
];
function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    // Skip generated/download caches, not tracked source: node_modules, .git, and the
    // gitignored VS Code Extension Host download (.vscode-test/). Exact path-segment match — a
    // file merely named "vscode-test" or the tracked projectos/vscode/src/test/ stays scanned.
    if (ent.isDirectory()) { if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".vscode-test") continue; walk(p, out); }
    else if (EXTS.includes(path.extname(ent.name))) out.push(p);
  }
}
function run() {
  const errors = [];
  const files = [];
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const pat of PATTERNS) {
      if (pat.re.test(text)) errors.push("secret-like pattern (" + pat.name + ") in " + path.relative(ROOT, f));
    }
  }
  return errors;
}
if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach(x => console.error("FAIL: " + x)); console.error("validate-no-secrets: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-no-secrets: PASS");
}
module.exports = { run };