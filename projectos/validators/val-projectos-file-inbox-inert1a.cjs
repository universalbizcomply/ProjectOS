"use strict";
/**
 * AN IMPORTED FILE IS STORED, NOT BELIEVED — PROJECTOS-GOVERNED-UPLOAD-SEAM-IMPLEMENT1A.
 *
 * The Files tab copies an owner's document into `.projectops/inbox/`. That folder sits inside the
 * repository the discovery engine walks, so without an explicit exclusion an imported file becomes
 * planning material the moment it lands — and worse than merely being read.
 *
 * WHY THIS IS NOT A SPELLING TEST. The engine's type classifier maps ANY path containing
 * `.projectops` to `PROJECT_CONFIG`, and `PROJECT_CONFIG` is FIFTH in `PRECEDENCE` — above
 * `CLOSURE_REPORT`, `GOVERNANCE`, `ARCHITECTURE` and `REQUIREMENTS`. So an owner dropping a rough
 * brief into the Files tab would have handed it authority over the project's own architecture and
 * requirements documents. Asserting that the source file "contains .projectops/inbox" would pass on
 * a comment, so this validator BUILDS a real fixture repository, RUNS the real
 * `discoverPlanSources`, and asserts what the engine actually returned.
 *
 * It also proves the exclusion is not wider than it claims: a project folder that merely happens to
 * be called `inbox` is still walked. A basename `SKIP_DIRS` entry would have failed that, which is
 * precisely why the exclusion is an exact relative path.
 *
 * No provider is called and no owner file is read. Every fixture is written into a scratch directory
 * and removed.
 */

const fs = require("fs");
const path = require("path");

const engine = require("./plan-discovery-engine.cjs");
const scratch = require("./lib/scratch.cjs");

/** The one governed inbox, as both the engine and the Rust importer spell it. */
const INBOX_REL = ".projectops/inbox";

function write(root, relPath, content) {
  const abs = path.join(root, relPath.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

/**
 * A repository with real planning material, one imported file, and a decoy folder named `inbox`
 * that has nothing to do with ProjectOS.
 */
function buildFixture(root) {
  write(root, "architecture.md", "# Architecture\n\nHow the booking service is put together.\n");
  write(root, "requirements.md", "# Requirements\n\nWhat the booking service must do.\n");
  write(
    root,
    ".projectops/project-config.json",
    JSON.stringify({ projectId: "fixture", projectName: "Fixture" }, null, 2),
  );
  // The import: exactly what the Files tab produces.
  write(root, `${INBOX_REL}/owner-brief.md`, "# Owner brief\n\nA rough note, not a plan.\n");
  write(
    root,
    `${INBOX_REL}/.records/owner-brief.md.json`,
    JSON.stringify({ recordVersion: 1, fileName: "owner-brief.md", purpose: "SPECIFICATION" }),
  );
  // The decoy: an ordinary project folder that happens to share the name.
  write(root, "docs/inbox/triage-notes.md", "# Triage notes\n\nOrdinary project documentation.\n");
}

function run() {
  const errors = [];
  const root = scratch.owned("file-inbox-inert");

  try {
    buildFixture(root);
    const discovered = engine.discoverPlanSources(root, {});
    const paths = discovered.sources.map((s) => s.relPath);

    // 1. THE IMPORT IS NOT DISCOVERED AT ALL.
    const imported = paths.filter((p) => p.startsWith(`${INBOX_REL}/`));
    if (imported.length > 0) {
      errors.push(
        `an imported file entered the planning corpus: ${imported.join(", ")} — ` +
          "files under the governed inbox are inert and must never be discovered",
      );
    }

    // 2. IT IS SKIPPED DELIBERATELY, not merely missing because the walk failed.
    const skippedInbox = (discovered.skipped || []).some((s) => s.path === INBOX_REL);
    if (!skippedInbox) {
      errors.push(
        `the walk did not record ${INBOX_REL} as skipped — absence of the file is not proof it was excluded`,
      );
    }

    // 3. IT NEVER BECOMES PROJECT_CONFIG, the type that would outrank the project's own documents.
    for (const source of discovered.sources) {
      if (source.relPath.startsWith(`${INBOX_REL}/`) && source.type === "PROJECT_CONFIG") {
        errors.push("an imported file was typed PROJECT_CONFIG and would outrank real planning documents");
      }
    }

    // 4. THE REAL CORPUS IS UNCHANGED. The exclusion must remove the import and nothing else.
    for (const expected of ["architecture.md", "requirements.md", ".projectops/project-config.json"]) {
      if (!paths.includes(expected)) {
        errors.push(`the exclusion removed a document it should not have: ${expected} is missing`);
      }
    }

    // 5. THE EXCLUSION IS NOT A BASENAME RULE. An unrelated folder called `inbox` is still walked.
    if (!paths.includes("docs/inbox/triage-notes.md")) {
      errors.push(
        "a project folder named 'inbox' was excluded — the rule must match the exact governed path, " +
          "not any directory sharing the name",
      );
    }
  } catch (e) {
    errors.push(`the inbox exclusion could not be exercised: ${e && e.message ? e.message : e}`);
  } finally {
    scratch.cleanup(root);
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-file-inbox-inert1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-file-inbox-inert1a: PASS");
}

module.exports = { run, INBOX_REL };
