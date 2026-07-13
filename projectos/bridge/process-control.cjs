"use strict";
/**
 * Worker process termination + emergency stop — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1B (§6).
 *
 * A single immediate death check is insufficient. This module issues a tree-kill and verifies death with
 * BOUNDED, REPEATED checks against a WALL-CLOCK deadline, enumerating descendants where supported. Ambiguity
 * resolves toward NOT-confirmed (fail closed). Outcomes:
 *
 *   TERMINATED-CONFIRMED     — the process is gone and either (a) all enumerated descendants are gone, or
 *                              (b) descendants weren't enumerable but a tree-kill was issued (confidence is
 *                              reported as `descendantConfidence`); with `strictDescendants` only (a) counts.
 *   TERMINATION-UNCONFIRMED  — death could not be confirmed → caller must NOT reconcile/cleanup; preserve
 *                              evidence; take an external-operation LOCK; require owner resolution.
 *   EMERGENCY-STOP-REQUIRED  — a terminal, owner-actionable variant of UNCONFIRMED.
 *
 * A worker that cannot be confirmed dead must NEVER be reported as an ordinary REFUSED result.
 */

const { execFileSync } = require("child_process");

function posInt(n) { return Number.isInteger(n) && n > 0; }

/** True if a pid is alive. Only ESRCH ("no such process") counts as dead; any other error = alive/unknown. */
function alive(pid) {
  if (!posInt(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !(e && e.code === "ESRCH"); } // EPERM or any other error ⇒ treat as alive/unknown
}

/** Build the full parent→children map, then RECURSIVELY collect every descendant of `pid`. Returns null only
 *  when the process table cannot be read at all (truly not enumerable). */
function descendants(pid) {
  if (!posInt(pid)) return null;
  const childrenOf = buildChildMap();
  if (childrenOf === null) return null;
  const out = [];
  const seen = new Set();
  const stack = [pid];
  while (stack.length) {
    const p = stack.pop();
    for (const k of (childrenOf[p] || [])) { if (!seen.has(k)) { seen.add(k); out.push(k); stack.push(k); } }
  }
  return out;
}

/** parent-pid → [child pids] for the whole process table, or null if it cannot be read. */
function buildChildMap() {
  try {
    if (process.platform === "win32") {
      // Primary: wmic CSV (last col=ProcessId, 2nd-last=ParentProcessId). Fallback: PowerShell Get-CimInstance
      // (wmic is deprecated/removed on newer Windows). If BOTH fail, return null ⇒ fail-closed under strict.
      let out;
      try { out = execFileSync("wmic", ["process", "get", "ProcessId,ParentProcessId", "/format:csv"], { encoding: "utf8", timeout: 6000 }); }
      catch (e1) {
        try { out = execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ParentProcessId),$($_.ProcessId)\" }"], { encoding: "utf8", timeout: 8000 }); }
        catch (e2) { return null; }
        const map = {};
        for (const line of out.split(/\r?\n/)) { const c = line.split(","); const ppid = parseInt(c[0], 10); const cpid = parseInt(c[1], 10); if (Number.isFinite(ppid) && Number.isFinite(cpid)) (map[ppid] = map[ppid] || []).push(cpid); }
        return map;
      }
      const map = {};
      for (const line of out.split(/\r?\n/)) {
        const cols = line.split(",");
        if (cols.length < 3) continue;
        const ppid = parseInt(cols[cols.length - 1], 10); // last col = ProcessId (alphabetical), 2nd-last = ParentProcessId
        const cpid = parseInt(cols[cols.length - 2], 10);
        if (!Number.isFinite(ppid) || !Number.isFinite(cpid)) continue;
        (map[cpid] = map[cpid] || []).push(ppid);
      }
      return map;
    }
    // posix: read /proc/<pid>/stat for PPid (field 4). Enumerable on Linux; on other posix returns null.
    const fs = require("fs");
    let entries;
    try { entries = fs.readdirSync("/proc"); } catch (e) { return null; }
    const map = {};
    for (const name of entries) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync("/proc/" + name + "/stat", "utf8");
        const rp = stat.lastIndexOf(")");
        const fields = stat.slice(rp + 2).split(" ");
        const ppid = parseInt(fields[1], 10); // state=fields[0], ppid=fields[1]
        const cpid = parseInt(name, 10);
        if (Number.isFinite(ppid) && Number.isFinite(cpid)) (map[ppid] = map[ppid] || []).push(cpid);
      } catch (e) { /* process gone mid-walk */ }
    }
    return map;
  } catch (e) { return null; }
}

/** Tree-kill. NEVER called with a non-positive pid (guarded) — a null/0 pid could signal the caller's group. */
function killTree(pid) {
  if (!posInt(pid)) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-pid, "SIGKILL"); } catch (e) { try { process.kill(pid, "SIGKILL"); } catch (e2) { /* gone */ } } }
  } catch (e) { /* best effort */ }
}

/**
 * Terminate `pid` and confirm death with bounded retries against a wall-clock deadline.
 * @returns { status, pid, attempts, aliveAtEnd, descendantsChecked, descendantConfidence, deadlineMs, reason? }
 */
async function terminate(pid, opts) {
  const o = opts || {};
  if (!posInt(pid)) return { status: "TERMINATION-UNCONFIRMED", pid, attempts: 0, aliveAtEnd: null, descendantsChecked: false, descendantConfidence: "no-pid", deadlineMs: 0, reason: "invalid-pid" };
  const deadlineMs = Number.isFinite(o.deadlineMs) ? o.deadlineMs : 3000;
  const maxAttempts = Number.isFinite(o.maxAttempts) ? o.maxAttempts : 6;
  const intervalMs = Number.isFinite(o.intervalMs) ? o.intervalMs : 250;
  const strict = !!o.strictDescendants;
  const sleep = typeof o.sleepFn === "function" ? o.sleepFn : (ms) => new Promise((r) => setTimeout(r, ms));
  const isAlive = typeof o.aliveFn === "function" ? o.aliveFn : alive;
  const enumerate = typeof o.descendantsFn === "function" ? o.descendantsFn : descendants;
  const kill = typeof o.killFn === "function" ? o.killFn : killTree;
  const now = typeof o.now === "function" ? o.now : () => Date.now();

  const start = now();
  let attempts = 0, descendantsChecked = false;
  kill(pid);
  while (attempts < maxAttempts && (now() - start) <= deadlineMs) {
    attempts++;
    const kids = enumerate(pid);
    let kidsDead;
    if (kids !== null) { descendantsChecked = true; kids.forEach((k) => kill(k)); kidsDead = kids.every((k) => !isAlive(k)); }
    else kidsDead = strict ? false : true; // not enumerable: tree-kill confidence unless strict mode demands enumeration
    const parentDead = !isAlive(pid);
    if (parentDead && kidsDead) {
      return { status: "TERMINATED-CONFIRMED", pid, attempts, aliveAtEnd: false, descendantsChecked, descendantConfidence: descendantsChecked ? "enumerated" : "tree-kill-only", deadlineMs };
    }
    if (attempts >= maxAttempts || (now() - start) > deadlineMs) break;
    await sleep(intervalMs);
    kill(pid);
  }
  return { status: o.emergency ? "EMERGENCY-STOP-REQUIRED" : "TERMINATION-UNCONFIRMED", pid, attempts, aliveAtEnd: true, descendantsChecked, descendantConfidence: descendantsChecked ? "enumerated" : (strict ? "unknown" : "tree-kill-only"), deadlineMs };
}

function isConfirmedDead(result) { return result && result.status === "TERMINATED-CONFIRMED"; }

module.exports = { terminate, killTree, alive, descendants, isConfirmedDead, posInt };
