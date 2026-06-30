"use strict";
const fs = require("fs");
const path = require("path");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
const KN = path.join(lib.ROOT, "knowledge");
function readKnowledge(rel) {
  const p = path.join(KN, rel);
  if (!lib.within(p)) throw new Error("input outside ProjectOS: " + rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
function bulletsUnder(text, headingRe, max) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex(function (l) { return headingRe.test(l); });
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < lines.length && out.length < (max || 6); j++) {
    const l = lines[j];
    if (/^#{1,6}\s/.test(l)) break;
    const m = l.match(/^\s*[-*]\s+(.*)$/);
    if (m) out.push(m[1].replace(/\*\*/g, "").trim());
  }
  return out;
}
function firstMatch(text, re, fb) { if (!text) return fb; const m = text.match(re); return m ? m[1] : fb; }
function statusOf(text) {
  if (!text) return "NEEDS-SOURCE";
  if (/production[^.\n]*frozen|FROZEN/i.test(text)) return "FROZEN";
  if (/blueprint/i.test(text)) return "BLUEPRINT";
  if (/live pilot/i.test(text)) return "PILOT";
  if (/production-ready|live host|live booking|Live\b/i.test(text)) return "LIVE";
  return "NEEDS-SOURCE";
}
const PROJECTS = [
  { projectId: "polygo", projectName: "PolyGo", file: "PolyGo Current State.md" },
  { projectId: "jd-testing", projectName: "JD Testing", file: "JD Testing Current State.md" },
  { projectId: "bizcomply-opsoft", projectName: "BizComply/OPSoft", file: "BizComply OPSoft Current State.md" },
  { projectId: "criclocal", projectName: "CricLocal", file: "CricLocal Current State.md" },
  { projectId: "coverdrive", projectName: "Coverdrive", file: "Coverdrive Current State.md" },
  { projectId: "tkn", projectName: "TKN", file: "TKN Current State.md" },
  { projectId: "erp-system", projectName: "ERP System", file: "ERP System Current State.md" }
];
function buildProject(meta) {
  const t = readKnowledge(meta.file);
  const risks = bulletsUnder(t, /Known risks/i, 6);
  const carry = bulletsUnder(t, /Current carry-forward|Carry-forward queue/i, 6);
  const needs = (t || "").split(/\r?\n/).filter(function (l) { return /NEEDS SOURCE|NOT VERIFIED|UNKNOWN/.test(l); }).slice(0, 6).map(function (l) { return l.replace(/^[-*\s]+/, "").replace(/\*\*/g, "").slice(0, 140); });
  return {
    projectId: meta.projectId,
    projectName: meta.projectName,
    projectType: firstMatch(t, /\*\*Type:\*\*\s*([^\n]+)/, "NEEDS-SOURCE"),
    sourceFile: "knowledge/" + meta.file,
    repo: firstMatch(t, /`([a-z0-9][a-z0-9._-]*\/[A-Za-z0-9._-]+)`/, "NEEDS-SOURCE"),
    localPath: firstMatch(t, /Local folder:\*\*\s*`([^`]+)`/, "NEEDS-SOURCE"),
    liveUrl: firstMatch(t, /(https?:\/\/[^\s)`]+)/, "NEEDS-SOURCE"),
    stagingUrl: "NEEDS-SOURCE",
    status: t ? statusOf(t) : "NEEDS-SOURCE",
    productionFreeze: /production[^.\n]*frozen/i.test(t || "") ? "true" : "NEEDS-SOURCE",
    highRiskGates: bulletsUnder(t, /high-risk gate|sensitivity/i, 4),
    currentPhase: "NEEDS-SOURCE",
    closedPhases: [],
    blockedItems: [],
    carryForward: carry,
    risks: risks,
    nextRecommendedActions: bulletsUnder(t, /Next recommended phases|ProjectOS installation considerations/i, 4),
    sourceConfidence: t ? "static-knowledge-file (heuristic parse)" : "NEEDS-SOURCE",
    needsSource: needs,
    lastUpdated: "2026-06-30"
  };
}
function parsePhases() {
  const idx = readKnowledge("ProjectOS Reports Index.md") || "";
  const out = [];
  idx.split(/\r?\n/).forEach(function (l) {
    if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l)) return;
    const c = l.split("|").slice(1, -1).map(function (x) { return x.trim(); });
    if (c.length !== 7) return;
    out.push({ date: c[0], project: c[1], phaseId: c[2], status: c[3], closureCommit: c[4].replace(/`/g, ""), reportFile: c[5].replace(/`/g, ""), notes: c[6].slice(0, 160) });
  });
  return out;
}
function run() {
  const projects = [{
    projectId: "projectos", projectName: "ProjectOS", projectType: "Universal Project Delivery OS (framework)",
    sourceFile: "knowledge/README.md", repo: "local-only (no remote)", localPath: "C:\\dev\\ProjectOS",
    liveUrl: "NEEDS-SOURCE", stagingUrl: "NEEDS-SOURCE", status: "ACTIVE", productionFreeze: "n/a",
    highRiskGates: ["production deploy", "db mutation", "real send", "payment", "closure"],
    currentPhase: "PROJECTOPS-MULTI-PROJECT-DASHBOARD1A", closedPhases: [], blockedItems: [], carryForward: [],
    risks: [], nextRecommendedActions: ["Owner review of dashboard"], sourceConfidence: "framework self-entry",
    needsSource: [], lastUpdated: "2026-06-30"
  }].concat(PROJECTS.map(buildProject));
  const phases = parsePhases();
  const closed = phases.filter(function (p) { return p.status === "CLOSED"; }).length;
  const open = phases.length - closed;
  const risks = [];
  projects.forEach(function (p) { (p.risks || []).forEach(function (rk) { risks.push({ project: p.projectName, level: "UNKNOWN", text: rk }); }); });
  const carryForward = [];
  projects.forEach(function (p) { (p.carryForward || []).forEach(function (c) { carryForward.push(p.projectName + ": " + c); }); });
  const blockers = phases.filter(function (p) { return p.status === "BLOCKED"; }).map(function (p) { return p.phaseId; });
  const data = {
    dashboard: "ProjectOS — Multi-Project Dashboard",
    generatedAt: "2026-06-30",
    sourceMode: "local-static",
    externalApisUsed: false, liveInspectionUsed: false, productReposScanned: false, secretsUsed: false,
    projects: projects, phases: phases,
    risks: risks, carryForward: carryForward, blockers: blockers,
    summary: { projects: projects.length, phasesParsed: phases.length, phasesClosed: closed, phasesOpen: open },
    sourceLimitations: "Derived from static ProjectOS knowledge/report files only via heuristic parsing; no live inspection, no product repo scan. Unclear values marked UNKNOWN / NEEDS-SOURCE / NOT-VERIFIED.",
    decisionNeeded: "Owner/advisor: review dashboard; confirm project statuses and NEEDS-SOURCE items."
  };
  const out = lib.guardOut(flags.out || "projectos/dashboard/dashboard-data.json");
  lib.ensureDir(out);
  var s = JSON.stringify(data, null, 2).replace(/vercel deploy/ig, "vercel [redacted]").replace(/netlify deploy/ig, "netlify [redacted]").replace(/supabase (db|functions deploy|functions delete|functions)/ig, "supabase [redacted]").replace(/git push( --force)?/ig, "git [redacted]").replace(/gh workflow/ig, "gh [redacted]").replace(/stripe charge/ig, "stripe [redacted]").replace(/\btwilio\b/ig, "[provider]"); fs.writeFileSync(out, s);
  console.log("collect-dashboard-data: wrote " + lib.rel(out) + " (" + projects.length + " projects, " + phases.length + " phases; local-static; no product scan; no external call)");
}
try { run(); } catch (e) { console.error("collect-dashboard-data ERROR: " + e.message); process.exit(1); }