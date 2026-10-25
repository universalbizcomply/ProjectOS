"use strict";
/**
 * READING THE PORTFOLIO IS SIDE-EFFECT FREE —
 * PROJECTOS-MULTI-PROJECT-PROJECTION-IMPLEMENT1A.
 *
 * ProjectOS is pointed at ONE project at a time, and the Projects list shows every registered one.
 * The obvious way to fill those rows is to select each project in turn and read what comes back.
 * That is exactly what must never happen: selection is an operational context switch — it moves the
 * root every governed verb then uses, it PERSISTS the choice to disk, and it is refused outright
 * while governed work is running. A list built that way would change what the runtime is pointed at
 * simply by being looked at, and would fail whenever the owner was busiest.
 *
 * The portfolio is instead built from `buildGovernedState(root, observedAt)` — a function that was
 * already root-parameterised and already read-only. Nothing new reads the disk; the daemon just
 * calls what it already had, once per registered root.
 *
 * WHY A VALIDATOR AND NOT ONLY TESTS. The unit tests prove today's rows are bound to the right
 * project. This proves the SHAPE that keeps the read harmless: that the emitter performs no
 * selection, no write and no spawn, and that liveness stays a two-value answer. The failure mode is
 * a future edit that looks like a convenience — "select each project to fill in the blanks" — and
 * quietly turns a list into a context switch.
 *
 * Reads files. Runs nothing, calls no provider, selects no project.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST_REL = "projectos/control-center/sidecar/host.mjs";
const MODEL_REL = "projectos/control-center/src/ux/projectsModel.ts";
const SHARED_REL = "projectos/control-center/src/governed/projectInventory.ts";
const SCREEN_REL = "projectos/control-center/src/ux/ProjectsScreen.tsx";

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments, so a rule is never satisfied — or broken — by prose describing it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * The statements that build and emit the portfolio.
 *
 * Bounded to that block on purpose: the same file legitimately persists a selection and spawns
 * workers elsewhere, and a whole-file scan would either fail on correct code or have to be so vague
 * it proved nothing.
 */
function portfolioBlock(hostCode) {
  const start = hostCode.indexOf("GOVERNED_PORTFOLIO_MESSAGE_KIND,");
  if (start === -1) return null;
  const from = hostCode.indexOf("kind: GOVERNED_PORTFOLIO_MESSAGE_KIND", start);
  if (from === -1) return null;
  const end = hostCode.indexOf("function refreshInventory", from);
  return hostCode.slice(from, end === -1 ? Math.min(from + 4000, hostCode.length) : end);
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);

  const hostRaw = read(HOST_REL);
  if (hostRaw === null) {
    E(`${HOST_REL} is missing — it is where the portfolio is built`);
    return errors;
  }
  const hostCode = code(hostRaw);

  // 1. THE PORTFOLIO IS BUILT AT ALL, from the existing root-parameterised builder.
  const block = portfolioBlock(hostCode);
  if (block === null) {
    E(`${HOST_REL} no longer emits a portfolio message`);
  } else {
    if (!/buildGovernedState\(/.test(block)) {
      E(
        `${HOST_REL} builds the portfolio without the existing governed-state builder — a second ` +
          "reader of project state would be a second answer about it",
      );
    }

    // 2. NO SELECTION. The rule this validator exists for.
    if (/project\.select|persistSelection|selectedProjectId\s*=/.test(block)) {
      E(
        `${HOST_REL} selects a project while building the portfolio — selection is an operational ` +
          "context switch and a persisted write; a list must never perform one to draw itself",
      );
    }

    // 3. NO WRITES, NO PROCESSES. Reading a list starts nothing and changes nothing on disk.
    for (const [pattern, what] of [
      [/writeFileSync|mkdirSync|rmSync|renameSync|appendFileSync/, "writes to disk"],
      [/spawn\(|spawnSync\(|execSync\(/, "starts a process"],
    ]) {
      if (pattern.test(block)) {
        E(`${HOST_REL} ${what} while building the portfolio — reading project state must change nothing`);
      }
    }

    // 4. LIVENESS COMES FROM THE ROOT-KEYED RUN MAP, and from nothing weaker.
    if (!/activeRuns\.has\(/.test(block)) {
      E(
        `${HOST_REL} no longer derives portfolio liveness from the root-keyed run map — session ` +
          "history is not a live worker (PROJECTOS-PROVIDER-RUNTIME-TRUTH-FIX1A)",
      );
    }
    if (/sessionRecords|sessions\b/.test(block)) {
      E(`${HOST_REL} reads session records for portfolio liveness — history is not liveness`);
    }
  }

  // 5. THE LIVENESS VOCABULARY STAYS TWO-VALUED. There is no IDLE: this daemon cannot see a run it
  //    did not start, so the absence of a tracked run is UNKNOWN, never "no worker exists".
  const shared = read(SHARED_REL);
  if (shared === null) {
    E(`${SHARED_REL} is missing — it declares the portfolio wire shape`);
  } else {
    const sharedCode = code(shared);
    const liveness = /export type ProjectLiveness =([^;]*);/.exec(sharedCode);
    if (liveness === null) {
      E(`${SHARED_REL} no longer declares ProjectLiveness`);
    } else {
      const values = (liveness[1].match(/'[A-Z_]+'/g) || []).sort().join(",");
      if (values !== "'RUNNING','UNKNOWN'") {
        E(
          `ProjectLiveness is ${values || "empty"} — it must remain exactly 'RUNNING' and 'UNKNOWN'. ` +
            "An IDLE or NOT_RUNNING value would claim knowledge this daemon does not have about a " +
            "run started before it existed",
        );
      }
    }
  }

  // 6. A ROW'S SUMMARY IS MATCHED BY PROJECT ID, and the two row shapes stay distinct.
  const model = read(MODEL_REL);
  if (model === null) {
    E(`${MODEL_REL} is missing — it binds summaries to rows`);
  } else {
    const modelCode = code(model);
    if (!/projects\.find\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.projectId === p\.projectId\s*\)/.test(modelCode)) {
      E(
        `${MODEL_REL} no longer matches a summary to its row by exact project id — a positional or ` +
          "unmatched attachment would paint one project's phase, blocker or worker onto another",
      );
    }
    if (!/readonly live: false;/.test(modelCode) || !/readonly live: true;/.test(modelCode)) {
      E(
        `${MODEL_REL} collapsed the dormant and live row shapes — a reduced summary must never be ` +
          "able to pass for the full projection of a selected project",
      );
    }
  }

  // 7. THE SCREEN SHOWS THE SUMMARY — PROJECTOS-FOUNDATION-GAPS1A. The daemon's read and the model's
  //    binding are worth nothing if the Projects screen drops them: selection is refused while
  //    governed work runs, so during a run a project that is not selected is visible to the owner
  //    ONLY through its summary. The screen once ignored it and printed one fixed line for every row.
  //    The rule pins the summary being HANDED TO THE RENDER (`={row.summary}`), not merely mentioned:
  //    a colour or a badge can read `row.summary` while the facts themselves go undisplayed.
  const screen = read(SCREEN_REL);
  if (screen === null) {
    E(`${SCREEN_REL} is missing — it is where the owner sees the portfolio`);
  } else if (!/=\{\s*row\.summary\s*\}/.test(code(screen))) {
    E(
      `rule 7 (screen-consumes-summary): ${SCREEN_REL} no longer renders row.summary — a project that ` +
        "is not selected would show nothing but a fixed line, and during a governed run the owner could " +
        "see nothing about it",
    );
  }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-portfolio-read-only1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-portfolio-read-only1a: PASS");
}

module.exports = { run, HOST_REL, MODEL_REL, SHARED_REL, SCREEN_REL };
