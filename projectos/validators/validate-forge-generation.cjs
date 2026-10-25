"use strict";
/**
 * Proves the Forge Generation Loop invariants (PROJECTOS-FORGE-GENERATION1A / F4). Synthetic in-process
 * workers only (no network, no AI). If any invariant regresses, `run()` returns a non-empty error list
 * and validate-all fails.
 *
 * Invariants:
 *  1  happy path: every task completes and its diff is applied to the file state, within budget
 *  2  the hard budget cap is NEVER exceeded; tasks that no longer fit are blocked (budget-exhausted)
 *  3  a task that keeps failing is DOOM-LOOP HALTED after the threshold (not retried to maxAttempts)
 *  4  an untrusted worker requesting a disallowed side effect is not accepted; its diff is NOT applied
 *  5  a secret in a worker diff is redacted before it is applied to the file state / results
 *  6  a correlation-mismatch response is rejected (counts as a failure, no apply)
 *  7  a per-call cost above perCallMax is clamped — one huge claim cannot exceed the cap
 *  8  deterministic: same tasks + worker → identical result
 *  9  no network / no metered API / no spawn (only the bridge + redaction are required)
 * 10  incremental: a completed task changes only its target file; other files are untouched
 * 11  a worker diff with an absolute / UNC / drive / traversal / degenerate path key is NOT applied
 * 12  budget running out mid-task is distinguished (blocked/budget-exhausted-midtask), and id-less
 *     blocked tasks get unique fallback ids
 * 13  exhausting maxAttempts without reaching the doom threshold yields status 'failed' (distinct)
 */

const fs = require("fs");
const path = require("path");
const { runGenerationLoop } = require("../forge/generation-loop.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const SECRET = "synthetic-gen-secret-5a6b7c";

// A worker that completes each task by writing its target file.
function goodWorker(env) {
  return { correlationId: env.correlationId, status: "completed", costTokens: 1000, requestedSideEffects: ["read-file"], diff: [{ path: env.targetPath, content: "// " + env.taskId + "\n" }] };
}

function run() {
  const errors = [];
  const tasks = [
    { id: "t1", goal: "make page", targetPath: "app/page.tsx" },
    { id: "t2", goal: "make api", targetPath: "app/api/x/route.ts" },
  ];

  // 1: happy path.
  const r1 = runGenerationLoop({ tasks, worker: goodWorker, files: { "keep.ts": "x" } });
  if (!r1.results.every((r) => r.status === "completed")) errors.push("invariant 1: not all tasks completed");
  if (r1.files["app/page.tsx"] !== "// t1\n" || r1.files["app/api/x/route.ts"] !== "// t2\n") errors.push("invariant 1: diffs not applied");
  if (!r1.withinBudget) errors.push("invariant 1: reported over budget");

  // 10: incremental — the untouched seed file is preserved.
  if (r1.files["keep.ts"] !== "x") errors.push("invariant 10: unrelated file was modified");

  // 2: budget cap never exceeded.
  const many = [{ id: "a", targetPath: "a.ts" }, { id: "b", targetPath: "b.ts" }, { id: "c", targetPath: "c.ts" }];
  const rb = runGenerationLoop({ tasks: many, worker: goodWorker, budgetCap: 1500, perCallMax: 1000 });
  if (rb.spent > rb.budgetCap) errors.push("invariant 2: spent exceeded the budget cap");
  if (!rb.results.some((r) => r.status === "blocked" && r.reason === "budget-exhausted")) errors.push("invariant 2: over-budget task not blocked");

  // 3: doom-loop halt.
  const failWorker = (env) => ({ correlationId: env.correlationId, status: "failed", costTokens: 10 });
  const rd = runGenerationLoop({ tasks: [{ id: "d", targetPath: "d.ts" }], worker: failWorker, doomThreshold: 2, maxAttempts: 5 });
  const dRes = rd.results[0];
  if (!dRes || dRes.status !== "doom-loop-halted") errors.push("invariant 3: failing task was not doom-loop halted");
  if (dRes && dRes.attempts !== 2) errors.push("invariant 3: halted at wrong attempt count (expected doomThreshold=2, got " + (dRes && dRes.attempts) + ")");
  if (dRes && dRes.consultantSuggested !== true) errors.push("invariant 3: doom-loop did not suggest a consultant");

  // 4: untrusted side effect not accepted, diff not applied.
  const evilWorker = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 10, requestedSideEffects: ["deploy-production"], diff: [{ path: env.targetPath, content: "evil" }] });
  const re = runGenerationLoop({ tasks: [{ id: "e", targetPath: "e.ts" }], worker: evilWorker, doomThreshold: 2 });
  if (re.files["e.ts"] === "evil") errors.push("invariant 4: a disallowed-side-effect worker's diff was applied");
  if (re.results[0].status === "completed") errors.push("invariant 4: task with disallowed side effect was marked completed");

  // 5: secret in diff is redacted before apply.
  const redactor = createRedactor();
  redactor.register(SECRET, "ref_s");
  const leakWorker = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 10, diff: [{ path: env.targetPath, content: "const k = '" + SECRET + "';" }] });
  const rs = runGenerationLoop({ tasks: [{ id: "s", targetPath: "s.ts" }], worker: leakWorker, redactor });
  if (JSON.stringify(rs.files).includes(SECRET) || JSON.stringify(rs.results).includes(SECRET)) errors.push("invariant 5: secret leaked through a worker diff");

  // 6: correlation mismatch rejected.
  const wrongCorr = (env) => ({ correlationId: "not-" + env.correlationId, status: "completed", costTokens: 10, diff: [] });
  const rc = runGenerationLoop({ tasks: [{ id: "c2", targetPath: "c2.ts" }], worker: wrongCorr, doomThreshold: 2 });
  if (rc.results[0].status === "completed") errors.push("invariant 6: correlation-mismatch response was accepted");

  // 7: per-call cost clamped.
  const greedy = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 10_000_000, diff: [{ path: env.targetPath, content: "x" }] });
  const rg = runGenerationLoop({ tasks: [{ id: "g", targetPath: "g.ts" }], worker: greedy, budgetCap: 50000, perCallMax: 20000 });
  if (rg.spent > rg.budgetCap) errors.push("invariant 7: a huge per-call cost claim exceeded the cap");
  if (rg.spent !== 20000) errors.push("invariant 7: per-call cost was not clamped to perCallMax");

  // 8: deterministic.
  const d1 = runGenerationLoop({ tasks, worker: goodWorker });
  const d2 = runGenerationLoop({ tasks, worker: goodWorker });
  if (JSON.stringify(d1) !== JSON.stringify(d2)) errors.push("invariant 8: generation loop is not deterministic");

  // 11: hostile diff paths are not applied to the file state.
  const badPaths = ["/etc/passwd", "C:\\\\evil.txt", "C:/evil.txt", "..\\\\..\\\\evil", "../evil", "\\\\\\\\server\\\\s", "", "."];
  const pathWorker = (env) => ({ correlationId: env.correlationId, status: "completed", costTokens: 10, diff: badPaths.map((p) => ({ path: p, content: "x" })).concat([{ path: env.targetPath, content: "ok" }]) });
  const rp = runGenerationLoop({ tasks: [{ id: "p", targetPath: "safe.ts" }], worker: pathWorker });
  const keys = Object.keys(rp.files);
  for (const k of keys) {
    if (k.includes("..") || k.startsWith("/") || k.includes("\\") || /^[a-zA-Z]:/.test(k) || k === "" || k === ".") {
      errors.push("invariant 11: hostile diff path was applied: " + JSON.stringify(k));
    }
  }
  if (rp.files["safe.ts"] !== "ok") errors.push("invariant 11: the safe path in the same diff was not applied");

  // 12: mid-task budget exhaustion is distinguished, and id-less blocked tasks get unique ids.
  const costlyFail = (env) => ({ correlationId: env.correlationId, status: "failed", costTokens: 1000 });
  const rm = runGenerationLoop({ tasks: [{ targetPath: "m.ts" }, { targetPath: "n.ts" }], worker: costlyFail, budgetCap: 1500, perCallMax: 1000, maxAttempts: 5, doomThreshold: 3 });
  const first = rm.results[0];
  if (!first || first.status !== "blocked" || first.reason !== "budget-exhausted-midtask") errors.push("invariant 12: mid-task budget exhaustion not distinguished (" + (first && first.reason) + ")");
  const ids = rm.results.map((r) => r.taskId);
  if (new Set(ids).size !== ids.length) errors.push("invariant 12: id-less tasks got duplicate fallback ids: " + ids.join(","));
  if (rm.spent > rm.budgetCap) errors.push("invariant 12: spent exceeded cap in the mid-task case");

  // 13: attempts exhausted (maxAttempts < doomThreshold) → 'failed', not doom-loop-halted.
  const cheapFail = (env) => ({ correlationId: env.correlationId, status: "failed", costTokens: 10 });
  const ra = runGenerationLoop({ tasks: [{ id: "z", targetPath: "z.ts" }], worker: cheapFail, maxAttempts: 2, doomThreshold: 5, budgetCap: 100000 });
  if (ra.results[0].status !== "failed" || ra.results[0].attempts !== 2) errors.push("invariant 13: attempts-exhausted case not reported as failed/2 (" + ra.results[0].status + "/" + ra.results[0].attempts + ")");

  // 9: no network / metered API / spawn in the module source.
  const src = fs.readFileSync(path.join(__dirname, "..", "forge", "generation-loop.cjs"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const rq of requires) if (!/^\.\.\//.test(rq)) errors.push("invariant 9: generation-loop requires a non-local module: " + rq);
  if (/https?:|child_process|\.spawn\(|openai|anthropic|fetch\(/i.test(src)) errors.push("invariant 9: generation-loop references network/AI-API/spawn");

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-generation: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-generation: PASS");
}
module.exports = { run };
