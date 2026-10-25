"use strict";
/**
 * Forge Generation Loop — PROJECTOS-FORGE-GENERATION1A (F4).
 *
 * The bounded, governed loop that fills the scaffold's typed slots. It hands a scoped task to a LOCAL
 * worker (the owner's Claude Code session over `bridge/desktop-bridge.cjs`, or a local model) — there is
 * **NO Claude/ChatGPT/metered API** here. This module deterministically orchestrates the loop: it issues
 * a task envelope, validates the UNTRUSTED worker response through the bridge (correlation, allowlisted
 * side effects, forbidden-field strip, secret redaction), applies the returned file diff, and enforces
 * the two things every incumbent gets wrong:
 *   - a HARD per-run token BUDGET CAP (a stuck agent can never burn unbounded cost), and
 *   - DOOM-LOOP detection (K consecutive failures on a task halts it instead of retrying forever).
 *
 * The generation itself is the worker's job; F4 models the loop, budget, diff application, and stop
 * conditions. Tests drive it with a synthetic in-process worker (no network, no AI).
 *
 * Zero dependencies beyond ProjectOS-local modules. No network, no spawning, no metered API.
 */

const bridge = require("../bridge/desktop-bridge.cjs");
const { createRedactor } = require("../security/redaction.cjs");

const DEFAULTS = Object.freeze({
  budgetCap: 100000,        // hard total-token ceiling for the whole run
  perCallMax: 20000,        // a single worker reply may not claim more than this (protects the cap)
  maxAttempts: 3,           // attempts per task before giving up
  doomThreshold: 2,         // consecutive failures on one task → halt (don't retry forever)
});

function clampCost(v, perCallMax) {
  const n = typeof v === "number" && isFinite(v) && v >= 0 ? v : perCallMax; // unknown cost → assume worst
  return Math.min(n, perCallMax);
}

/** A worker-supplied file key must be a plain relative forward-slash path — no absolute, UNC, drive,
 *  backslash, traversal, or degenerate key can reach the file state (a downstream consumer may write it). */
function isSafeRelKey(p) {
  if (typeof p !== "string" || !p || p === ".") return false;
  if (p.includes("\\")) return false;                 // backslash / UNC / Windows separators
  if (/^[\\/]/.test(p)) return false;                  // rooted (/, \)
  if (/^[a-zA-Z]:/.test(p)) return false;              // drive-absolute (C:\ or C:/)
  if (p.split("/").some((s) => s === ".." || s === ".")) return false; // traversal
  return true;
}

/** Apply a validated (already redacted) diff to an in-memory file state. Full-file writes only. */
function applyDiff(fileState, diff) {
  const applied = [];
  if (!Array.isArray(diff)) return applied;
  for (const d of diff) {
    if (d && typeof d.content === "string" && isSafeRelKey(d.path)) {
      fileState[d.path] = d.content;
      applied.push(d.path);
    }
  }
  return applied;
}

/**
 * Run the generation loop over an ordered task list.
 * @param opts { tasks, worker, files?, budgetCap?, perCallMax?, maxAttempts?, doomThreshold?, redactor? }
 *   worker(envelope) -> response  (synchronous; the local worker or a synthetic test handler)
 * @returns { results, spent, budgetCap, remaining, withinBudget, files }
 */
/**
 * Run the attempt loop for ONE task. `ctx` carries shared budget state (`ctx.spent`) and the correlation
 * counter (`ctx.seq`); it mutates them. Returns a per-task outcome without pushing a result.
 */
function attemptTask(task, taskId, ctx) {
  let attempts = 0;
  let failures = 0;
  let outcome = null;
  let appliedPaths = [];
  let refusedSideEffects = [];
  let lastReason = null;

  while (attempts < ctx.maxAttempts && ctx.spent + ctx.perCallMax <= ctx.budgetCap) {
    attempts += 1;
    ctx.seq += 1;
    const correlationId = "gen-" + ctx.seq;
    const envelope = { protocol: "1.0", kind: "generation-task", correlationId, taskId, goal: String((task && task.goal) || ""), targetPath: String((task && task.targetPath) || "") };

    let response;
    try { response = ctx.worker(envelope); }
    catch (e) {
      failures += 1; lastReason = "worker-threw: " + String(e && e.message).slice(0, 80);
      if (failures >= ctx.doomThreshold) { outcome = "doom-loop-halted"; break; }
      continue;
    }
    // Cost accounting first (protects the cap even if the response is later rejected).
    ctx.spent += clampCost(response && response.costTokens, ctx.perCallMax);

    const validated = bridge.validateBridgeResponse(envelope, response, ctx.redactor);
    if (!validated.ok || !validated.accepted) {
      failures += 1; lastReason = validated.reason || "response-not-accepted";
      if (failures >= ctx.doomThreshold) { outcome = "doom-loop-halted"; break; }
      continue;
    }
    appliedPaths = applyDiff(ctx.files, validated.response && validated.response.diff);
    refusedSideEffects = validated.refusedSideEffects;
    outcome = "completed";
    break;
  }
  if (outcome === null) {
    // Loop ended without completion or doom-halt: distinguish "ran out of budget mid-task" from
    // "exhausted all attempts".
    outcome = (attempts < ctx.maxAttempts && ctx.spent + ctx.perCallMax > ctx.budgetCap) ? "budget-midtask" : "attempts-exhausted";
  }
  return { outcome, attempts, appliedPaths, refusedSideEffects, reason: lastReason };
}

function runGenerationLoop(opts) {
  const o = opts || {};
  if (!Array.isArray(o.tasks)) throw new Error("generation-loop: tasks[] required");
  if (typeof o.worker !== "function") throw new Error("generation-loop: worker function required");
  const ctx = {
    worker: o.worker,
    redactor: o.redactor || createRedactor(),
    files: { ...(o.files || {}) },
    budgetCap: typeof o.budgetCap === "number" && o.budgetCap > 0 ? o.budgetCap : DEFAULTS.budgetCap,
    perCallMax: typeof o.perCallMax === "number" && o.perCallMax > 0 ? o.perCallMax : DEFAULTS.perCallMax,
    maxAttempts: typeof o.maxAttempts === "number" && o.maxAttempts > 0 ? o.maxAttempts : DEFAULTS.maxAttempts,
    doomThreshold: typeof o.doomThreshold === "number" && o.doomThreshold > 0 ? o.doomThreshold : DEFAULTS.doomThreshold,
    spent: 0,
    seq: 0,
  };

  const results = [];
  let taskIndex = -1;
  for (const task of o.tasks) {
    taskIndex += 1;
    const taskId = task && typeof task.id === "string" && task.id ? task.id : "task_" + taskIndex;
    // Up-front budget gate: only start a task if the worst-case cost still fits under the cap.
    if (ctx.spent + ctx.perCallMax > ctx.budgetCap) {
      results.push({ taskId, status: "blocked", reason: "budget-exhausted", attempts: 0, appliedPaths: [] });
      continue;
    }
    const r = attemptTask(task, taskId, ctx);
    if (r.outcome === "completed") {
      results.push({ taskId, status: "completed", attempts: r.attempts, appliedPaths: r.appliedPaths, refusedSideEffects: r.refusedSideEffects });
    } else if (r.outcome === "doom-loop-halted") {
      results.push({ taskId, status: "doom-loop-halted", reason: r.reason || "consecutive-failures", attempts: r.attempts, appliedPaths: [], consultantSuggested: true });
    } else if (r.outcome === "budget-midtask") {
      results.push({ taskId, status: "blocked", reason: "budget-exhausted-midtask", attempts: r.attempts, appliedPaths: [] });
    } else {
      results.push({ taskId, status: "failed", reason: r.reason || "max-attempts-exhausted", attempts: r.attempts, appliedPaths: [] });
    }
  }

  return {
    results,
    spent: ctx.spent,
    budgetCap: ctx.budgetCap,
    remaining: Math.max(0, ctx.budgetCap - ctx.spent),
    withinBudget: ctx.spent <= ctx.budgetCap,
    files: ctx.files,
  };
}

module.exports = { runGenerationLoop, DEFAULTS };
