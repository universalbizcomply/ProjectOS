"use strict";
/**
 * Owner-facing readiness REPORT renderer — PROJECTOS-FORGE-REAL-E2E-ACTIVATION1B-HARDEN1C (§12).
 *
 * Renders the technically-verified readiness result (from owner-capability-check.check()) as a self-contained,
 * OFFLINE HTML page (no external fonts/scripts/network). Design applied from ui-ux-pro-max guidance: technical
 * dark+light palette, monospace/sans system stack, security-first hierarchy, status badges that carry an SVG
 * icon AND text (never colour-only), 4.5:1 contrast, visible focus, reduced-motion respected. It NEVER shows a
 * false READY — a check is READY only when its status is PASS; the overall banner reflects the real block state.
 *
 * Pure string rendering; no I/O, no network. `esc()` HTML-escapes every dynamic value.
 */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CHECK_TITLES = {
  sandboxImplementationPresent: "OS sandbox implementation",
  sandboxAttestationPass: "Sandbox attestation (live canaries)",
  executableValidated: "Claude executable identity",
  toolRestrictionVerified: "Worker tool restriction (detected)",
  processOwnershipVerified: "Process ownership (operation handle)",
  processTerminationVerified: "Process termination (lifecycle proven)",
  networkDisabled: "Network disabled",
  dockerReady: "Docker (for local Supabase)",
  supabaseReady: "Supabase CLI",
};
const SECURITY = ["sandboxImplementationPresent", "sandboxAttestationPass", "executableValidated", "toolRestrictionVerified", "processOwnershipVerified", "processTerminationVerified", "networkDisabled"];
const INFRA = ["dockerReady", "supabaseReady"];
// Plain-language recovery step per reason (ordered by the state machine).
const RECOVERY = {
  "no-sandbox-provider": "Configure and approve a real OS sandbox provider (restricted account / VM / container). The real worker is NOT SAFE without it.",
  "pid-only-provider-forbidden-for-real-runs": "Use a provider that owns a stable operation handle (job object / container id), not a bare process id.",
  "docker-not-installed": "Install Docker Desktop and start it.",
  "docker-not-running": "Open Docker Desktop and wait until it shows Running.",
  "supabase-cli-not-installed": "Install the Supabase CLI.",
};
// SVG (24x24, currentColor) — no emoji.
const ICON = {
  ready: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  action: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
};

function badge(pass) {
  const cls = pass ? "b-ready" : "b-action";
  const label = pass ? "READY" : "ACTION NEEDED";
  return '<span class="badge ' + cls + '" role="status">' + (pass ? ICON.ready : ICON.action) + '<span>' + label + '</span></span>';
}

function checkRow(name, c) {
  const pass = c.status === "PASS";
  return '<li class="row ' + (pass ? "ok" : "warn") + '">'
    + '<div class="row-main"><span class="row-title">' + esc(CHECK_TITLES[name] || name) + '</span>' + badge(pass) + '</div>'
    + (pass ? "" : '<p class="row-reason"><span class="reason-k">why:</span> ' + esc(c.reason || "blocked") + (RECOVERY[c.reason] ? '<br><span class="reason-k">fix:</span> ' + esc(RECOVERY[c.reason]) : "") + '</p>')
    + '</li>';
}

/** Render the full readiness result as a self-contained HTML document (string). */
function renderReadinessHtml(res) {
  const r = res || { checks: {}, realBlockReason: "BLOCKED-SANDBOX-IMPLEMENTATION" };
  const checks = r.checks || {};
  const ready = r.realBlockReason === "READY-FOR-REAL-WORKER-PROOF";
  const emergency = r.realBlockReason === "EMERGENCY-STOP-REQUIRED";
  const bannerCls = emergency ? "banner-emergency" : ready ? "banner-ready" : "banner-blocked";
  const bannerText = emergency ? "EMERGENCY STOP — a worker operation could not be confirmed terminated"
    : ready ? "READY FOR REAL WORKER PROOF (still owner / ChatGPT gated)"
      : "NOT SAFE for a real worker run — " + esc(r.realBlockReason);
  const actions = SECURITY.concat(INFRA).map((n) => checks[n]).filter((c) => c && c.status !== "PASS");

  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Worker readiness</title><style>',
    ':root{--bg:#f4f6fb;--surface:#ffffff;--surface2:#eef1f7;--text:#0f172a;--muted:#475569;--line:#cbd5e1;--ready:#15803d;--ready-bg:#dcfce7;--warn:#b45309;--warn-bg:#fef3c7;--danger:#b91c1c;--danger-bg:#fee2e2;--accent:#1e293b}',
    '@media (prefers-color-scheme:dark){:root{--bg:#0f172a;--surface:#1e293b;--surface2:#334155;--text:#f8fafc;--muted:#cbd5e1;--line:#475569;--ready:#4ade80;--ready-bg:#14532d;--warn:#fbbf24;--warn-bg:#4d3707;--danger:#f87171;--danger-bg:#4c1010;--accent:#e2e8f0}}',
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,"Fira Sans",system-ui,sans-serif;line-height:1.6;padding:24px}',
    '.wrap{max-width:820px;margin:0 auto}h1{font-size:20px;margin:0 0 4px}.sub{color:var(--muted);font-size:14px;margin:0 0 20px}',
    '.banner{border-radius:12px;padding:16px 18px;font-weight:600;margin-bottom:24px;border:1px solid var(--line)}',
    '.banner-ready{background:var(--ready-bg);color:var(--ready)}.banner-blocked{background:var(--warn-bg);color:var(--warn)}.banner-emergency{background:var(--danger-bg);color:var(--danger)}',
    'h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:24px 0 10px}',
    'ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}',
    '.row{background:var(--surface);border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:12px 14px}',
    '.row.ok{border-left-color:var(--ready)}.row.warn{border-left-color:var(--warn)}',
    '.row-main{display:flex;align-items:center;justify-content:space-between;gap:12px}.row-title{font-weight:600;font-family:ui-monospace,"Fira Code",monospace;font-size:14px}',
    '.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;white-space:nowrap}',
    '.b-ready{background:var(--ready-bg);color:var(--ready)}.b-action{background:var(--warn-bg);color:var(--warn)}',
    '.row-reason{margin:8px 0 0;font-size:13px;color:var(--muted);font-family:ui-monospace,"Fira Code",monospace}.reason-k{color:var(--accent);font-weight:700}',
    'ol.recovery{margin:8px 0 0;padding-left:22px;display:grid;gap:8px}ol.recovery li{color:var(--text)}',
    '.note{margin-top:24px;font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}',
    'a:focus-visible,li:focus-visible{outline:3px solid var(--warn);outline-offset:2px}@media (prefers-reduced-motion:reduce){*{transition:none!important}}',
    '</style></head><body><div class="wrap">',
    '<h1>Forge worker — readiness</h1>',
    '<p class="sub">Read-only. Installs nothing, connects nowhere, reads no password. Readiness is technically verified — no environment variable can make a check pass.</p>',
    '<div class="banner ' + bannerCls + '" role="alert">' + bannerText + '</div>',
    '<h2>Security readiness (required before any real worker run)</h2><ul>',
    SECURITY.map((n) => checkRow(n, checks[n] || { status: "BLOCKED", reason: "not-evaluated" })).join(""),
    '</ul><h2>Real-run infrastructure</h2><ul>',
    INFRA.map((n) => checkRow(n, checks[n] || { status: "BLOCKED", reason: "not-evaluated" })).join(""),
    '</ul>',
    ready ? "" : ('<h2>What to do next (in order)</h2><ol class="recovery">' + actions.map((c) => '<li>' + esc(CHECK_TITLES_lookup(checks, c)) + ': ' + esc(RECOVERY[c.reason] || "Resolve this technically-verified prerequisite.") + '</li>').join("") + '</ol>'),
    '<p class="note">Synthetic validation (offline safety proofs) runs safely regardless. NOT INSTALLED / NOT RUNNING / NOT SAFE are distinguished by each item’s <em>why</em> line above.</p>',
    '</div></body></html>',
  ].join("");
}
// resolve a check's title from its object identity
function CHECK_TITLES_lookup(checks, cObj) {
  for (const k of Object.keys(checks)) if (checks[k] === cObj) return CHECK_TITLES[k] || k;
  return "prerequisite";
}

// Execution-outcome recovery guidance (§14: readiness vs EXECUTION). Maps a run result's block/outcome to a
// plain-language owner recovery step — distinct from readiness (which is "can a real run even start").
const EXECUTION_RECOVERY = {
  "INVOCATION-RESTRICTION-NOT-APPLIED": "The worker's tool restriction was not actually encoded in the command that would run. Do not proceed — re-derive the detection record so ProjectOS builds a restricted command, and re-run.",
  "WORKSPACE-MATERIALISATION-NOT-EQUIVALENT": "The disposable workspace did not exactly match the approved baseline (a symlink could not be reproduced). Do not proceed on this host — use a host/provider that preserves the entry types.",
  "OPERATION-DISPOSAL-FAILED": "The sandbox operation did not dispose cleanly (leftover state). The run is NOT complete. Investigate the leftover residue and dispose the operation before any further run.",
  "EMERGENCY-STOP-REQUIRED": "A worker operation could NOT be confirmed terminated. STOP. Do not reconcile or reuse the workspace. Preserve the evidence, resolve the live/uncertain process manually, then re-run readiness.",
  "BLOCKED-SANDBOX-ATTESTATION": "The sandbox provider could not attest isolation for this exact workspace/operation. Do not proceed — fix the provider's attestation.",
};
/** One-line execution-state summary for a run result (terminal/console). Never asserts success falsely. */
function renderExecutionState(result, decisionReason) {
  const r = result || {}; const reason = decisionReason || r.reason || r.outcome || "";
  const emergency = r.processTerminationStatus === "EMERGENCY-STOP-REQUIRED";
  const rec = EXECUTION_RECOVERY[reason];
  const lines = [];
  lines.push("Run outcome: " + (emergency ? "EMERGENCY STOP" : (r.outcome || "unknown")));
  lines.push("  invocation restriction: " + (r.invocationRestrictionStatus || "NOT VERIFIED"));
  lines.push("  process termination:    " + (r.processTerminationStatus || "NOT APPLICABLE"));
  lines.push("  operation disposal:     " + (r.operationDisposalStatus || "not-disposed"));
  if (Array.isArray(r.operationResidue) && r.operationResidue.length) lines.push("  operation residue:      " + r.operationResidue.join(", "));
  if (rec) { lines.push(""); lines.push("What to do: " + rec); }
  return lines.join("\n");
}

module.exports = { renderReadinessHtml, renderExecutionState, esc, CHECK_TITLES, EXECUTION_RECOVERY };
