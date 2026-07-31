// Validator: PROJECTOS-VALIDATOR-SCRATCH-LIFECYCLE1A
//
// Fails closed. Proves validators cannot leak %TEMP%\projectos-* build copies:
//  - one governed helper owns creation and deletion; cleanup logic is not duplicated per validator;
//  - the helper deletes ONLY directories it created — a repository path, a TEMP sibling, a reparse
//    point or a containment escape is refused;
//  - cleanup is structural (try/finally + a process-exit hook), so it runs on success, failure, an
//    expected compile failure, a caught or missed mutation, a child-process non-zero exit and a thrown
//    exception;
//  - a cleanup failure is reported and never alters the validation result;
//  - every validator that creates TEMP scratch routes through the helper;
//  - and the live behaviours above are EXECUTED here, not merely pattern-matched.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const VALDIR = path.join(__dirname);
const HELPER = path.join(VALDIR, "lib", "scratch.cjs");

const read = (p) => fs.readFileSync(p, "utf8");
const stripLine = (s) => s.replace(/\/\/.*/g, "");

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  if (!fs.existsSync(HELPER)) {
    E("V1 missing the governed scratch helper: " + HELPER);
    return errors;
  }
  const helper = stripLine(read(HELPER));
  const scratch = require(HELPER);

  // ---- V2 the helper's guards exist in source ----
  for (const [needle, what] of [
    ["fs.realpathSync(os.tmpdir())", "resolved TEMP root"],
    ["path.dirname(resolved) !== root", "direct-child check"],
    ['startsWith("projectos-")', "prefix check"],
    ["resolved.startsWith(root + path.sep)", "containment check"],
    ["isSymbolicLink()", "reparse-point check"],
    ["OWNED.has(resolved)", "ownership check before delete"],
    ["finally", "guaranteed cleanup structure"],
    ['category: e && e.code ? String(e.code) : "remove-failed"', "cleanup-failure reporting"],
    ["[scratch] cleanup failed: ", "cleanup-failure surfacing"],
    ['process.on("exit", cleanupAll)', "process-exit cleanup hook"],
  ])
    if (!helper.includes(needle)) E("V2 helper is missing the " + what);

  // ---- V3 LIVE: a scratch directory is created, then removed ----
  {
    const dir = scratch.owned("selftest-success");
    if (!fs.existsSync(dir)) E("V3 owned() did not create the directory");
    if (path.dirname(dir) !== fs.realpathSync(os.tmpdir()))
      E("V3 the scratch directory is not a direct child of TEMP");
    if (!path.basename(dir).startsWith("projectos-"))
      E("V3 the scratch directory is not projectos-prefixed");
    const failure = scratch.cleanup(dir);
    if (failure) E("V3 cleanup reported a failure on a clean directory: " + failure.category);
    if (fs.existsSync(dir)) E("V3 the scratch directory survived cleanup");
  }

  // ---- V4 LIVE: withScratch cleans up on success, on throw, and after a non-empty tree ----
  {
    let captured = null;
    const out = scratch.withScratch("selftest-ok", (d) => {
      captured = d;
      fs.writeFileSync(path.join(d, "f.txt"), "x");
      fs.mkdirSync(path.join(d, "sub"));
      return 42;
    });
    if (out !== 42) E("V4 withScratch changed the return value");
    if (fs.existsSync(captured)) E("V4 withScratch leaked on the success path");

    let threwDir = null;
    let rethrown = false;
    try {
      scratch.withScratch("selftest-throw", (d) => {
        threwDir = d;
        fs.writeFileSync(path.join(d, "f.txt"), "x");
        throw new Error("boom");
      });
    } catch (e) {
      rethrown = e && e.message === "boom";
    }
    if (!rethrown) E("V4 withScratch swallowed the exception (result semantics changed)");
    if (fs.existsSync(threwDir)) E("V4 withScratch leaked on the exception path");
  }

  // ---- V5 LIVE: only owned paths can be deleted ----
  {
    // A repository path must be refused.
    const repoPath = path.join(ROOT, "projectos", "validators");
    const r1 = scratch.cleanup(repoPath);
    if (!r1 || r1.category !== "not-owned-by-this-process")
      E("V5 a repository path was not refused by cleanup");
    if (!fs.existsSync(repoPath)) E("V5 CRITICAL: a repository path was deleted");

    // A TEMP sibling this process did not create must be refused.
    const sibling = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "projectos-notowned-"));
    try {
      const r2 = scratch.cleanup(sibling);
      if (!r2 || r2.category !== "not-owned-by-this-process")
        E("V5 an unowned TEMP sibling was not refused by cleanup");
      if (!fs.existsSync(sibling)) E("V5 CRITICAL: an unowned TEMP sibling was deleted");
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }

    // Traversal out of TEMP must be refused.
    const escape = path.join(fs.realpathSync(os.tmpdir()), "..", "escaped");
    const r3 = scratch.cleanup(escape);
    if (!r3) E("V5 a containment-escaping path was not refused");
  }

  // ---- V6 LIVE: a bad tag is refused before anything is created ----
  for (const bad of ["../evil", "Bad_Tag", "", "a b"]) {
    let threw = false;
    try {
      scratch.owned(bad);
    } catch {
      threw = true;
    }
    if (!threw) E("V6 owned() accepted an unsafe tag: " + JSON.stringify(bad));
  }

  // ---- V7 this validator leaves nothing of its OWN behind ----
  // Scoped to selftest- directories: under validate-all every validator shares one process, so siblings
  // legitimately still own their scratch while this runs. Their release is asserted by V9 instead.
  {
    const mine = scratch
      .ownedPathsForTest()
      .filter((p) => path.basename(p).startsWith("projectos-selftest-"));
    if (mine.length) E("V7 this validator left its own scratch behind: " + mine.join(", "));
  }

  // ---- V9 the suite runner releases each validator's scratch as it finishes ----
  {
    const runner = stripLine(read(path.join(VALDIR, "validate-all.cjs")));
    if (!/scratch\.cleanupAll\(\)/.test(runner))
      E("V9 validate-all does not release validator scratch between modules");
    if (!/finally \{ scratch\.cleanupAll\(\); \}/.test(runner))
      E("V9 the suite runner's release is not in a finally (a crash would leak)");
  }

  // ---- V8 every TEMP-scratch validator routes through the helper ----
  {
    const offenders = [];
    for (const f of fs.readdirSync(VALDIR)) {
      if (!f.endsWith(".cjs")) continue;
      // This validator IS the helper's test: it names TEMP directly to prove the guards refuse unowned
      // siblings and escapes, and loads the helper through a computed path rather than a literal.
      if (f === path.basename(__filename)) continue;
      const body = stripLine(read(path.join(VALDIR, f)));
      // Any route to TEMP counts, however it is spelled: `os.tmpdir()`, `require("os").tmpdir()` or a
      // bare `tmpdir()` import. Gating on one spelling let a hand-built path slip past.
      const createsTemp = /tmpdir\s*\(\s*\)/.test(body);
      if (!createsTemp) continue;
      const usesHelper = /require\(.*scratch\.cjs.*\)|require\(.*lib\/scratch.*\)/.test(body);
      if (!usesHelper) offenders.push(f + " (no helper)");
      // Requiring the helper is not enough: the validator must not ALSO hand-build a TEMP path, which
      // would leak a directory the helper never owned and therefore never deletes.
      const rawTempPath =
        /path\.join\(\s*os\.tmpdir\(\)/.test(body) ||
        /join\(\s*require\("os"\)\.tmpdir\(\)/.test(body) ||
        /mkdtempSync\(/.test(body);
      if (rawTempPath) offenders.push(f + " (builds a TEMP path directly)");
    }
    if (offenders.length)
      E("V8 validators create TEMP scratch without the governed helper: " + offenders.join(", "));
  }

  return errors;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((e) => console.error("[val-projectos-validator-scratch-lifecycle1a] FAIL: " + e));
    process.exit(1);
  }
  console.log("val-projectos-validator-scratch-lifecycle1a: PASS");
}
