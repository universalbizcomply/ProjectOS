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
function clean(s) {
  if (s === undefined || s === null) return "";
  return String(s).replace(/\*\*/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
}
function bulletsUnder(text, headingRe, max) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex(l => headingRe.test(l));
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < lines.length && out.length < (max || 8); j++) {
    if (/^#{1,6}\s/.test(lines[j])) break;
    const m = lines[j].match(/^\s*[-*]\s+(.*)$/);
    if (m) out.push(clean(m[1]));
  }
  return out;
}
function firstMatch(text, re, fb) { if (!text) return fb; const m = text.match(re); return m ? clean(m[1]) : fb; }
const OVR = JSON.parse(readKnowledge("../projectos/dashboard/dashboard-overrides.json") || (fs.readFileSync(path.join(lib.ROOT, "projectos/dashboard/dashboard-overrides.json"), "utf8")));
const META = OVR.meta || {};
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
  const o = (OVR.projects || {})[meta.projectId] || {};
  const carry = bulletsUnder(t, /Current carry-forward|Carry-forward queue/i, 8);
  const risks = bulletsUnder(t, /Known risks/i, 8);
  const needs = (t || "").split(/\r?\n/).filter(l => /NEEDS SOURCE|NOT VERIFIED/.test(l)).slice(0, 6).map(l => clean(l.replace(/^[-*\s]+/, "")).slice(0, 140)).filter(Boolean);
  return {
    projectId: meta.projectId,
    projectName: meta.projectName,
    projectType: o.projectTypeDisplay || firstMatch(t, /\*\*Type:\*\*\s*([^\n]+)/, "NEEDS-SOURCE"),
    sourceFile: "knowledge/" + meta.file,
    localPath: firstMatch(t, /Local folder:\*\*\s*`([^`]+)`/, o.localPath || "NEEDS-SOURCE"),
    repoDisplay: o.repoDisplay || "NOT-VERIFIED",
    repoVerified: o.repoVerified === true,
    liveUrlDisplay: o.liveUrlDisplay || "NOT-VERIFIED",
    liveUrlVerified: o.liveUrlVerified === true,
    status: o.displayStatus || "NEEDS-SOURCE",
    riskLevel: o.riskLevel || "UNKNOWN",
    sourceConfidence: o.sourceConfidence || "static-knowledge-file (heuristic parse)",
    productionFreeze: /production[^.\n]*frozen/i.test(t || "") ? "FROZEN" : (o.productionFreeze || "NEEDS-SOURCE"),
    highRiskGates: o.highRiskGates || [],
    currentPhase: o.currentPhase || "NEEDS-SOURCE",
    carryForward: carry,
    carryForwardCount: carry.length,
    risks: risks,
    needsSource: needs.concat(o.repoVerified ? [] : ["repo NOT-VERIFIED"]).concat(o.liveUrlVerified ? [] : ["live URL NOT-VERIFIED"]),
    nextRecommendedAction: o.nextRecommendedAction || "Owner/advisor to confirm.",
    matrix: o.matrix || ["NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED", "NOT-VERIFIED"],
    lastUpdated: "2026-06-30"
  };
}
function parsePhases() {
  const idx = readKnowledge("ProjectOS Reports Index.md") || "";
  const out = [];
  idx.split(/\r?\n/).forEach(l => {
    if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l)) return;
    const c = l.split("|").slice(1, -1).map(x => clean(x));
    if (c.length !== 7) return;
    out.push({ date: c[0], project: c[1], phaseId: c[2], status: c[3], closureCommit: c[4], reportFile: c[5], notes: c[6].slice(0, 120) });
  });
  return out;
}
function run() {
  const pos = (OVR.projects || {}).projectos || {};
  const projectos = {
    projectId: "projectos", projectName: "ProjectOS", projectType: "Universal Project Delivery OS (framework)",
    sourceFile: "knowledge/README.md", localPath: "C:\\dev\\ProjectOS",
    repoDisplay: pos.repoDisplay || "local-only", repoVerified: pos.repoVerified === true,
    liveUrlDisplay: pos.liveUrlDisplay || "N/A", liveUrlVerified: pos.liveUrlVerified === true,
    status: pos.displayStatus || "ACTIVE", riskLevel: pos.riskLevel || "LOW",
    sourceConfidence: pos.sourceConfidence || "VERIFIED (framework self)", productionFreeze: "n/a",
    highRiskGates: pos.highRiskGates || [], currentPhase: "PROJECTOPS-DASHBOARD-REFRESH1A",
    carryForward: [], carryForwardCount: 0, risks: [], needsSource: [],
    nextRecommendedAction: pos.nextRecommendedAction || "Owner review.", matrix: pos.matrix || [], lastUpdated: "2026-06-30"
  };
  const projects = [projectos].concat(PROJECTS.map(buildProject));
  const phases = parsePhases();
  const closed = phases.filter(p => p.status === "CLOSED").length;
  const open = phases.length - closed;
  const highRisk = projects.filter(p => p.riskLevel === "HIGH" || p.riskLevel === "CRITICAL");
  const needsSourceCount = projects.filter(p => p.status === "NEEDS-SOURCE" || !p.repoVerified || !p.liveUrlVerified).length;
  const blockers = phases.filter(p => p.status === "BLOCKED").map(p => p.phaseId);
  const risksFlat = [];
  projects.forEach(p => (p.risks || []).forEach(t => risksFlat.push({ project: p.projectName, level: p.riskLevel, text: t })));
  const carryFlat = [];
  const carryBoard = [];
  projects.forEach(p => { if ((p.carryForward || []).length) { carryBoard.push({ project: p.projectName, items: p.carryForward }); p.carryForward.forEach(c => carryFlat.push(p.projectName + ": " + c)); } });
  const needsBoard = [];
  projects.forEach(p => { const items = (p.needsSource || []).filter(Boolean); if (items.length) needsBoard.push({ project: p.projectName, items: items }); });
  const data = {
    dashboard: "ProjectOS — Multi-Project Dashboard (Owner Command Centre)",
    generatedAt: "2026-06-30",
    sourceMode: "local-static",
    externalApisUsed: false, liveInspectionUsed: false, productReposScanned: false, secretsUsed: false,
    meta: {
      frameworkStatus: META.frameworkStatus || "ACTIVE",
      remotePublish: META.remotePublish || "NEEDS-SOURCE",
      dashboardCannot: META.dashboardCannot || [],
      evidence: META.evidence || [],
      nextActions: META.nextActions || [],
      nextActionWarning: META.nextActionWarning || "Dashboard does not approve installs."
    },
    summary: {
      projects: projects.length, phasesParsed: phases.length, phasesClosed: closed, phasesOpen: open,
      highRiskProjects: highRisk.length, highRiskNames: highRisk.map(p => p.projectName),
      needsSourceCount: needsSourceCount, blockers: blockers.length,
      nextOwnerDecision: (META.nextActions && META.nextActions[0]) ? (META.nextActions[0].phase + " — " + META.nextActions[0].action) : "NEEDS-SOURCE"
    },
    projects: projects,
    phases: phases,
    riskMatrix: { columns: OVR.riskMatrixColumns || [], rows: projects.map(p => ({ project: p.projectName, riskLevel: p.riskLevel, cells: p.matrix || [] })) },
    installReadiness: OVR.installReadiness || {},
    needsSourceBoard: needsBoard,
    carryForwardBoard: carryBoard,
    risks: risksFlat,
    carryForward: carryFlat,
    blockers: blockers,
    sourceLimitations: "Derived from static ProjectOS knowledge/report files + curated static overrides. No live inspection, no product-repo scan, no external API. Repo/live values shown only where static knowledge supports them; otherwise NOT-VERIFIED / NEEDS-SOURCE.",
    decisionNeeded: "Owner/advisor: review the refreshed command centre; confirm NOT-VERIFIED items; decide closure and JD/BizComply install sequencing."
  };
  const out = lib.guardOut(flags.out || "projectos/dashboard/dashboard-data.json");
  lib.ensureDir(out);
  var s = JSON.stringify(data, null, 2).replace(/vercel deploy/ig, "vercel [redacted]").replace(/netlify deploy/ig, "netlify [redacted]").replace(/supabase (db|functions deploy|functions delete|functions)/ig, "supabase [redacted]").replace(/git push( --force)?/ig, "git [redacted]").replace(/gh workflow/ig, "gh [redacted]").replace(/stripe charge/ig, "stripe [redacted]").replace(/\btwilio\b/ig, "[provider]");
  fs.writeFileSync(out, s);
  console.log("collect-dashboard-data: wrote " + lib.rel(out) + " (" + projects.length + " projects, " + phases.length + " phases; overrides applied; local-static; no product scan; no external call)");
}
try { run(); } catch (e) { console.error("collect-dashboard-data ERROR: " + e.message); process.exit(1); }