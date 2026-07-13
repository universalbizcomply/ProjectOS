"use strict";
/**
 * Regression tests for the ECC-corrected WSL2 provider pure helpers —
 * PROJECTOS-OWNER-WSL2-ENABLE-AND-REAL-PROOF1A (§13/§16). No live worker/wsl needed. Opt-in.
 * Covers: operationId injection allowlist, exact distro-name column match, running-distro parse, tool-transcript
 * parse (read+write scope). Complements the real proof (which exercises the runtime paths end-to-end).
 */
const P = require("../bridge/wsl2-provider.cjs");
const errors = [];
const fail = (m) => errors.push(m);

// 1) safeOpId rejects shell-injection strings, accepts a clean id (HIGH fix: bash-script text injection)
for (const bad of ['a"; rm -rf x', "$(whoami)", "a`id`", "a;b", "a b", "a/b", "../etc", 'a"$(x)', "a\nb", "a|b", "a&b"]) {
  let threw = false; try { P.safeOpId(bad); } catch (e) { threw = true; }
  if (!threw) fail("safeOpId accepted an injection string: " + JSON.stringify(bad));
}
if (P.safeOpId("WSL2-PROOF-1A") !== "WSL2-PROOF-1A") fail("safeOpId rejected a clean id");

// 2) parseDistroTable matches the NAME column EXACTLY (not substring/word-boundary) (MED fix)
const table = "  NAME            STATE           VERSION\n  Ubuntu-22.04    Running         2\n* Ubuntu          Stopped         2\n";
const d = P.parseDistroTable(table, "Ubuntu");
if (d.state !== "Stopped" || d.version !== "2") fail("parseDistroTable picked the wrong row for 'Ubuntu': " + JSON.stringify(d));
if (P.parseDistroTable(table, "Ubuntu-22.04").state !== "Running") fail("parseDistroTable exact match failed for hyphenated name");
if (P.parseDistroTable(table, "Debian").state !== "UNKNOWN") fail("parseDistroTable missing distro not UNKNOWN");

// 3) parseRunningDistros strips (Default) + header
const rd = P.parseRunningDistros("  NAME\n  Ubuntu (Default)\n  Debian\n");
if (rd.join(",") !== "Ubuntu,Debian") fail("parseRunningDistros: " + JSON.stringify(rd));

// 4) parseToolUses extracts every tool_use (nested), incl an out-of-scope Read (HIGH fix: transcript)
const stream = [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "ok" }, { type: "tool_use", name: "Edit", input: { file_path: "app/projectos-real-proof.txt" } }] } }),
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "done" }] } }),
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/etc/passwd" } }] } }),
  "not json — must be skipped",
].join("\n");
const uses = P.parseToolUses(stream);
if (uses.length !== 2) fail("parseToolUses count: " + JSON.stringify(uses));
if (!(uses[0] && uses[0].name === "Edit" && uses[0].path === "app/projectos-real-proof.txt")) fail("parseToolUses edit: " + JSON.stringify(uses[0]));
if (!(uses[1] && uses[1].name === "Read" && uses[1].path === "/etc/passwd")) fail("parseToolUses out-of-scope read: " + JSON.stringify(uses[1]));

// 5) canonPath / pathInWorkspace — §8 path-scope (traversal + absolute escape are rejected)
const B = "/home/projectos-worker/projectos-proof/OP/app-root"; const WB = "/home/projectos-worker/projectos-proof/OP";
if (P.canonPath("app/projectos-real-proof.txt", WB) !== WB + "/app/projectos-real-proof.txt") fail("canonPath relative: " + P.canonPath("app/x", WB));
if (P.pathInWorkspace("app/projectos-real-proof.txt", WB) !== true) fail("pathInWorkspace in-scope relative rejected");
if (P.pathInWorkspace("app/../../../../etc/passwd", WB) !== false) fail("pathInWorkspace deep-traversal accepted");
if (P.pathInWorkspace("../../../etc/passwd", WB) !== false) fail("pathInWorkspace traversal accepted");
if (P.pathInWorkspace("/etc/passwd", WB) !== false) fail("pathInWorkspace absolute escape accepted");
if (P.pathInWorkspace("/home/projectos-worker/.claude.json", WB) !== false) fail("pathInWorkspace home-file accepted");

// 6) parseInitEvent — §6 effective surface (mcp servers + tool registry)
const initStream = [
  JSON.stringify({ type: "system", subtype: "init", tools: ["Read", "Edit", "Write", "Bash", "mcp__x__y"], mcp_servers: [{ name: "claude.ai Stripe", status: "needs-auth" }] }),
  JSON.stringify({ type: "result", result: "ok" }),
].join("\n");
const ie = P.parseInitEvent(initStream);
if (!(ie.tools.length === 5 && ie.mcpServers.length === 1 && ie.mcpServers[0] === "claude.ai Stripe")) fail("parseInitEvent: " + JSON.stringify(ie));
const ieEmpty = P.parseInitEvent(JSON.stringify({ type: "system", subtype: "init", tools: ["Read", "Edit", "Write"], mcp_servers: [] }));
if (ieEmpty.mcpServers.length !== 0 || ieEmpty.found !== true) fail("parseInitEvent empty mcp: " + JSON.stringify(ieEmpty));
// fail-closed: NO init line ⇒ found=false (so isolationProven can't fail open)
const ieNone = P.parseInitEvent('{"type":"result","result":"ok"}\nnot json');
if (ieNone.found !== false || ieNone.tools.length !== 0) fail("parseInitEvent missing-init not fail-closed: " + JSON.stringify(ieNone));

if (require.main === module) {
  if (errors.length) { errors.forEach((e) => console.error("FAIL: " + e)); console.error("validate-wsl2-provider: " + errors.length + " error(s)"); process.exit(1); }
  console.log("validate-wsl2-provider: PASS (pure-helper regression: injection-allowlist, exact-distro-match, running-parse, tool-transcript, path-scope, init-event)");
}
module.exports = { run: () => errors };
