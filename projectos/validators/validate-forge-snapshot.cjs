"use strict";
/**
 * Proves the Forge Env Snapshot & Rollback invariants (PROJECTOS-FORGE-SNAPSHOT1A / F6). Synthetic file
 * states only. If any invariant regresses, `run()` returns a non-empty error list and validate-all fails.
 *
 * Invariants:
 *  1  snapshot → record with a hash; restore returns the EXACT files
 *  2  deterministic: same state → same hash and same id; distinct states → distinct hashes
 *  3  rollback is exact: after mutating and snapshotting again, restore(A) returns A's files verbatim
 *  4  tamper detection: corrupting a record's files makes restore fail closed (no restore)
 *  5  chain integrity: parent links form a history; a broken parent link is detected
 *  6  immutability: a returned snapshot's files are frozen (external mutation can't corrupt the store)
 *  7  no secret-shaped value leaks (a benign snapshot carries none; content is stored verbatim)
 *  8  verifyChain passes for a valid chain and flags a tampered/broken one
 *  9  no network / metered API / spawn (only crypto required)
 * 10  a cyclic chain is detected (no infinite loop)
 */

const fs = require("fs");
const path = require("path");
const { snapshot, restore, history, verifyChain, hashState } = require("../forge/env-snapshot.cjs");

const SECRET_RX = /-----BEGIN|sk-[A-Za-z0-9]{12,}|eyJ[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{12,}/;

function run() {
  const errors = [];
  const stateA = { "app/page.tsx": "v1", "lib/x.ts": "a" };
  const a = snapshot(stateA, "initial");

  // 1: restore exact.
  if (!a.id || !a.hash) errors.push("invariant 1: snapshot missing id/hash");
  if (JSON.stringify(restore([a], a.id)) !== JSON.stringify(stateA)) errors.push("invariant 1: restore did not return exact files");

  // 2: deterministic + distinct.
  const a2 = snapshot({ "app/page.tsx": "v1", "lib/x.ts": "a" }, "initial");
  if (a2.hash !== a.hash || a2.id !== a.id) errors.push("invariant 2: snapshot not deterministic");
  const other = snapshot({ "app/page.tsx": "different" }, "initial");
  if (other.hash === a.hash) errors.push("invariant 2: distinct states share a hash");

  // 3: exact rollback across a change.
  const stateB = { ...stateA, "app/page.tsx": "v2" };
  const b = snapshot(stateB, "edit", a.id);
  const records = [a, b];
  if (JSON.stringify(restore(records, a.id)) !== JSON.stringify(stateA)) errors.push("invariant 3: rollback to A not exact");
  if (restore(records, b.id)["app/page.tsx"] !== "v2") errors.push("invariant 3: restore of B wrong");

  // 4: tamper detection.
  const tampered = { id: a.id, label: a.label, parentId: a.parentId, hash: a.hash, files: { "app/page.tsx": "HACKED", "lib/x.ts": "a" } };
  try { restore([tampered], a.id); errors.push("invariant 4: tampered snapshot restored without error"); }
  catch (e) { /* expected */ }

  // 5: chain integrity.
  if (JSON.stringify(history(records, b.id)) !== JSON.stringify([b.id, a.id])) errors.push("invariant 5: history chain wrong");
  try { history([b], b.id); errors.push("invariant 5: broken parent link not detected"); }
  catch (e) { /* expected */ }

  // 6: immutability.
  try { a.files["app/page.tsx"] = "mutated"; } catch (e) { /* frozen throws in strict mode */ }
  if (restore([a], a.id)["app/page.tsx"] !== "v1") errors.push("invariant 6: snapshot files were externally mutable");

  // 7: no secret in a benign snapshot.
  if (SECRET_RX.test(JSON.stringify(a))) errors.push("invariant 7: secret-shaped value in a snapshot");

  // 8: verifyChain.
  if (verifyChain(records).length !== 0) errors.push("invariant 8: verifyChain flagged a valid chain");
  if (verifyChain([tampered]).length === 0) errors.push("invariant 8: verifyChain missed a tampered record");
  if (verifyChain([b]).length === 0) errors.push("invariant 8: verifyChain missed a broken parent link");

  // 9: no network / metered API / spawn.
  const src = fs.readFileSync(path.join(__dirname, "..", "forge", "env-snapshot.cjs"), "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const rq of requires) if (rq !== "crypto") errors.push("invariant 9: env-snapshot requires an unexpected module: " + rq);
  if (/https?:|child_process|\.spawn\(|openai|anthropic|fetch\(/i.test(src)) errors.push("invariant 9: env-snapshot references network/AI-API/spawn");

  // 10: cyclic chain detected (craft two records pointing at each other).
  const c1 = { id: "s1", label: "", parentId: "s2", hash: hashState({}), files: {} };
  const c2 = { id: "s2", label: "", parentId: "s1", hash: hashState({}), files: {} };
  try { history([c1, c2], "s1"); errors.push("invariant 10: cyclic chain not detected"); }
  catch (e) { /* expected */ }

  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) { e.forEach((x) => console.error("FAIL: " + x)); console.error("validate-forge-snapshot: " + e.length + " error(s)"); process.exit(1); }
  console.log("validate-forge-snapshot: PASS");
}
module.exports = { run };
