"use strict";
const fs = require("fs");
const lib = require("./_report-lib.cjs");
const flags = lib.parseArgs(process.argv.slice(2));
function refuse(m) { console.error("create-ci-governance-report REFUSED: " + m); process.exit(1); }
function render(p, checks) {
  const L = [];
  L.push("# CI Governance Report — " + lib.f(p.policyId, "<policy>"));
  L.push("");
  L.push("> CI report is evidence only. It is not approval. CI not installed; no GitHub Actions created.");
  L.push("");
  L.push("- **Project:** " + lib.f(flags.project, "Demo"));
  L.push("- **Phase:** " + lib.f(flags.phase, "DEMO-CI-PHASE1A"));
  L.push("- **Status:** ACTIVE-TEMPLATE (reusable ProjectOS template; not live CI)");
  L.push(""); L.push("## CI policy"); L.push(lib.f(p.policyId, "NEEDS SOURCE") + " — productionAutoDeploy=" + String(p.deploymentPolicy && p.deploymentPolicy.productionAutoDeploy) + ", liveMutation=" + String(p.databasePolicy && p.databasePolicy.liveMutation));
  L.push(""); L.push("## Workflow templates"); L.push("- ci-workflow-template.github-actions.template.yml (INERT; not under .github/workflows)");
  L.push(""); L.push("## Required checks"); L.push(lib.list(p.requiredChecks));
  L.push(""); L.push("## Optional checks"); L.push(lib.list(p.optionalChecks, "none"));
  L.push(""); L.push("## Check results");
  L.push("| # | Category | Status |"); L.push("|---|----------|--------|");
  if (Array.isArray(checks) && checks.length) checks.forEach(function (c, i) { L.push("| " + (i + 1) + " | " + lib.f(c.category) + " | " + lib.f(c.status, "NOT-VERIFIED") + " |"); });
  else L.push("| - | (none run) | NOT-VERIFIED |");
  L.push(""); L.push("## Blockers"); L.push("- none");
  L.push("## Warnings"); L.push("- none");
  L.push("## Production touched?"); L.push("no");
  L.push("## Deploy attempted?"); L.push("no");
  L.push("## Database touched?"); L.push("no");
  L.push("## External sends / payments?"); L.push("no");
  L.push("## Secrets used?"); L.push("no");
  L.push("## External tools used?"); L.push("no");
  L.push("## MCP used?"); L.push("no");
  L.push("## CI installed?"); L.push("no (templates only)");
  L.push("## GitHub Actions created?"); L.push("no");
  L.push("## Residue"); L.push("NONE");
  L.push("## Risks"); L.push("- Templates only; real CI behaviour depends on a later owner-approved install.");
  L.push("## Carry-forward"); L.push("- Owner-approved per-project CI install remains a separate phase.");
  L.push("## Decision needed"); L.push(lib.f(flags.decisionNeeded, "Owner/advisor: accept CI governance templates? (inert demo)"));
  L.push("");
  return L.join("\n");
}
try {
  if (!flags.input) refuse("provide --input <ci-governance-policy.json>");
  const p = JSON.parse(fs.readFileSync(require("path").resolve(flags.input), "utf8").replace(/^﻿/, ""));
  if (p.deploymentPolicy && p.deploymentPolicy.productionAutoDeploy === true) refuse("policy allows production auto-deploy");
  let checks = null;
  if (flags.checks) checks = JSON.parse(fs.readFileSync(require("path").resolve(flags.checks), "utf8").replace(/^﻿/, ""));
  const out = lib.guardOut(flags.out);
  lib.ensureDir(out);
  fs.writeFileSync(out, render(p, checks && (checks.checks || checks)));
  console.log("create-ci-governance-report: wrote " + lib.rel(out) + " (CI not installed; no GitHub Actions)");
} catch (e) { console.error("create-ci-governance-report ERROR: " + e.message); process.exit(1); }