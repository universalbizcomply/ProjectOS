"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function liList(arr, fb) { const a = Array.isArray(arr) ? arr : []; if (!a.length) return "<ul><li class=\"unknown\">" + esc(fb || "none / NEEDS-SOURCE") + "</li></ul>"; return "<ul>" + a.map(function (x) { return "<li>" + esc(typeof x === "string" ? x : (x.text ? (x.project ? x.project + ": " : "") + x.text : JSON.stringify(x))) + "</li>"; }).join("") + "</ul>"; }
function run() {
  const inPath = path.resolve(lib.ROOT, flags.in || "projectos/dashboard/dashboard-data.json");
  if (!lib.within(inPath)) throw new Error("input outside ProjectOS");
  const data = JSON.parse(fs.readFileSync(inPath, "utf8").replace(/^﻿/, ""));
  const tpl = fs.readFileSync(path.join(lib.ROOT, "projectos/templates/dashboard-static-html.template.html"), "utf8");
  const cards = (data.projects || []).map(function (p) {
    return "<div class=\"card\"><h3>" + esc(p.projectName) + " <span class=\"pill\">" + esc(p.status) + "</span></h3>" +
      "<div><span class=\"k\">type:</span> " + esc(p.projectType) + "</div>" +
      "<div><span class=\"k\">repo:</span> " + esc(p.repo) + "</div>" +
      "<div><span class=\"k\">live:</span> " + esc(p.liveUrl) + "</div>" +
      "<div><span class=\"k\">freeze:</span> " + esc(p.productionFreeze) + "</div>" +
      "<div><span class=\"k\">confidence:</span> " + esc(p.sourceConfidence) + "</div>" +
      "<div class=\"note\">risks: " + esc((p.risks || []).length) + " · carry-forward: " + esc((p.carryForward || []).length) + " · needs-source: " + esc((p.needsSource || []).length) + "</div>" +
      "</div>";
  }).join("");
  const rows = (data.phases || []).map(function (ph) { return "<tr><td>" + esc(ph.phaseId) + "</td><td>" + esc(ph.project) + "</td><td>" + esc(ph.status) + "</td><td>" + esc(ph.closureCommit) + "</td></tr>"; }).join("");
  const phaseTable = "<table><thead><tr><th>Phase</th><th>Project</th><th>Status</th><th>Commit</th></tr></thead><tbody>" + (rows || "<tr><td colspan=\"4\" class=\"unknown\">NEEDS-SOURCE</td></tr>") + "</tbody></table>";
  let html = tpl
    .replace("{{GENERATED_AT}}", esc(data.generatedAt))
    .replace("{{PROJECT_CARDS}}", cards || "<div class=\"card unknown\">NEEDS-SOURCE</div>")
    .replace("{{PHASE_TABLE}}", phaseTable)
    .replace("{{RISK_LIST}}", liList(data.risks, "none recorded"))
    .replace("{{CARRY_LIST}}", liList(data.carryForward, "none recorded"))
    .replace("{{BLOCKER_LIST}}", liList(data.blockers, "none"))
    .replace("{{SOURCE_LIMITATIONS}}", esc(data.sourceLimitations));
  const out = lib.guardOut(flags.out || "projectos/dashboard/index.html");
  lib.ensureDir(out);
  fs.writeFileSync(out, html);
  console.log("build-static-dashboard: wrote " + lib.rel(out) + " (inline CSS only; no external assets; no network; no server)");
}
try { run(); } catch (e) { console.error("build-static-dashboard ERROR: " + e.message); process.exit(1); }