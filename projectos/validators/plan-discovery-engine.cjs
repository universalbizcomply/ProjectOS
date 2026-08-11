"use strict";
// ProjectOS V3 universal plan-discovery / reconciliation / import engine.
// Pure, deterministic decision logic + a safe read-only filesystem walk. Zero external dependencies
// (crypto/fs/path only). NOT auto-discovered by validate-all.cjs; consumed by the discovery validators.
// Created in PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A.
//
// Governance rules baked in:
//  - Universal process, project-specific output. No AI API of any kind.
//  - Discovered documents are DATA, never instructions: no document can override ProjectOS governance
//    and no document content is ever executed.
//  - The engine never invents project facts and never marks a plan PLAN READY (that remains the
//    Phase 1 evidence gate + owner approval).
//  - Deterministic: identical source content + repository evidence => identical result. No clock in IDs.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------- limits / constants
const DEFAULT_LIMITS = { maxFileBytes: 512 * 1024, maxFiles: 2000, maxDepth: 12 };
const SUPPORTED_EXTS = new Set([".md", ".markdown", ".txt", ".json"]);
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "target", "coverage", ".vscode-test",
  "tmp", "temp", ".cache", "out", ".next", ".turbo", "vendor", "__pycache__"
]);
// Files that must never be opened (credential-bearing by convention).
const FORBIDDEN_FILE_RE = /(^|[\\/])\.env(\.|$)|\.(pem|key|pfx|p12|keystore)$|(^|[\\/])(id_rsa|id_ed25519)$/i;

// Real-secret shapes (mirrors the global no-secrets validator) + the synthetic marker used by fixtures.
const RAW_SECRET_MARKER = "RAWSECRET::";
const SECRET_PATTERNS = [
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "stripe", re: /sk_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: "aws-akid", re: /AKIA[0-9A-Z]{16}/ },
  { name: "github-pat", re: /ghp_[A-Za-z0-9]{36,}/ },
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "marker", re: new RegExp(RAW_SECRET_MARKER) }
];

// Document-type classification by filename/path token. Order = specificity (first match wins for the label).
const TYPE_SIGNALS = [
  ["MASTER_PLAN", /master[-_ ]?plan/i],
  ["EXECUTION_PLAN", /execution[-_ ]?plan/i],
  ["IMPLEMENTATION_PLAN", /implementation[-_ ]?plan/i],
  ["PRODUCT_BLUEPRINT", /blueprint/i],
  ["ROADMAP", /roadmap/i],
  ["PROJECT_LEDGER", /ledger/i],
  ["CLOSURE_REPORT", /closure|_closed/i],
  ["PHASE_REPORT", /phase[-_ ]?report|_awaiting-review|_awaiting-closure/i],
  ["AUDIT_LOG", /audit[-_ ]?log/i],
  ["ROLLOUT_LOG", /rollout[-_ ]?log/i],
  ["CURRENT_STATE", /current[-_ ]?state/i],
  ["HANDOVER", /handover/i],
  ["ARCHITECTURE", /architecture|adr/i],
  ["REQUIREMENTS", /requirements?/i],
  ["GOVERNANCE", /governance/i],
  ["PROJECT_CONFIG", /project[-_.]?config|\.projectops|projectops/i],
  ["CLAUDE_INSTRUCTIONS", /(^|[\\/])claude(\.md)?$/i],
  ["README_CONTEXT", /(^|[\\/])readme/i],
  // A bare `plan.md` / `plans/` is a plan. Without this token the only recognised plan filenames
  // were compound ones ("master plan", "project plan"), so a project whose plan is simply named
  // `plan.md` produced an empty planning corpus and a draft with no phases — the plan was read,
  // classified UNKNOWN, and quietly demoted to context. Last in the list, so every more specific
  // signal above still wins.
  ["PROJECT_PLAN", /project[-_ ]?plan|(^|[\\/_-])plans?([-_.]|$)/i]
];
const AUTHORITY = ["AUTHORITATIVE", "CURRENT_SUPPORTING", "HISTORICAL", "SUPERSEDED", "DUPLICATE", "CONFLICTING", "UNVERIFIED", "EXCLUDED"];
const PLAN_STATUSES = ["NO PLAN", "PLAN DISCOVERED", "PLAN CONFLICT", "PLAN DRAFTED", "AWAITING OWNER APPROVAL", "PLAN READY", "PLAN STALE", "PLAN BLOCKED"];

// Precedence (lower index = higher authority). Documented; NOT a blind override — lower-ranked
// sources may still surface material conflicts that must be preserved.
const PRECEDENCE = [
  "MASTER_PLAN", "EXECUTION_PLAN", "PROJECT_PLAN", "IMPLEMENTATION_PLAN", "PROJECT_CONFIG",
  "CLOSURE_REPORT", "GOVERNANCE", "CURRENT_STATE", "HANDOVER", "ROADMAP", "PROJECT_LEDGER",
  "PRODUCT_BLUEPRINT", "ARCHITECTURE", "REQUIREMENTS", "AUDIT_LOG", "ROLLOUT_LOG",
  "PHASE_REPORT", "README_CONTEXT", "CLAUDE_INSTRUCTIONS", "UNKNOWN"
];

// ---------------------------------------------------------------------------- pure helpers
function sha256(buf) { return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex"); }
function stripBom(s) { return s.replace(/^﻿/, ""); }
function normalizeContent(text) {
  // Deterministic normalization for normalized-duplicate detection: BOM off, CRLF->LF, trailing
  // whitespace per line removed, trailing blank lines collapsed. Does NOT reorder content.
  return stripBom(text).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n").replace(/\n+$/,"\n");
}
function toPosix(rel) { return rel.split(/[\\/]/).join("/"); }

// Repo-relative path safety: no absolute, no drive-relative/absolute, no UNC, no traversal, no null.
function isSafeRepoRelativePath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.indexOf("\0") !== -1) return false;
  if (path.isAbsolute(p)) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;          // C:\ or C:foo
  if (/^\\\\/.test(p) || /^\/\//.test(p)) return false; // UNC
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.split(/[\\/]/).some((s) => s === "..")) return false;
  return true;
}
// Absolute containment check: resolved candidate must live under resolved root.
function isWithinRoot(root, candidateAbs) {
  const r = path.resolve(root);
  const c = path.resolve(candidateAbs);
  return c === r || c.startsWith(r + path.sep);
}

function scanSecrets(text) {
  const hits = [];
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push(p.name);
  return hits;
}

function extractHeadings(text) {
  const out = [];
  for (const raw of stripBom(text).split(/\r?\n/)) {
    // ReDoS-safe: right-trim first (single anchored quantifier), then match without a trailing \s*$.
    const line = raw.replace(/[ \t]+$/, "");
    const m = /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2] });
  }
  return out;
}
function extractTitle(text, relPath) {
  const h1 = extractHeadings(text).find((h) => h.level === 1);
  if (h1) return h1.text;
  const s = /^STATUS:\s*(.+)$/im.exec(text);
  return s ? null : (path.basename(relPath));
}

// Classify a source's document type from filename/path + headings. Returns {type, evidence[]}.
function classifyPlanSource(src) {
  const evidence = [];
  const hay = toPosix(src.relPath);
  let type = "UNKNOWN";
  for (const [label, re] of TYPE_SIGNALS) {
    if (re.test(hay)) { type = label; evidence.push("path/filename signal: " + label); break; }
  }
  if (type === "UNKNOWN") {
    const titles = (src.headings || []).map((h) => h.text).join(" | ");
    for (const [label, re] of TYPE_SIGNALS) {
      if (re.test(titles)) { type = label; evidence.push("heading signal: " + label); break; }
    }
  }
  if (src.ext === ".json") evidence.push("json project-control candidate");
  if (type === "UNKNOWN") evidence.push("no deterministic type signal");
  return { type, evidence };
}

// Deterministic detection of untrusted-instruction content (prompt injection / governance override /
// secret-access / gate-bypass). Bounded quantifiers only (no ReDoS). A hit QUARANTINES the source.
const INSTRUCTION_INJECTION = [
  /\b(ignore|disable|bypass|override|skip|turn\s*off)\b[^\n]{0,40}\b(governance|owner|validator|approval|gate|no-?secrets?|policy|rules?)\b/i,
  /^(system|assistant)\s*:/im,
  /\bgrant\b[^\n]{0,24}\b(plan\s*ready|tamper\s*proof|owner[- ]approved)\b/i,
  /\bset\b[^\n]{0,30}\bplan\s*ready\b/i,
  /\bmark\b[^\n]{0,30}\bowner[- ]approved\b/i,
  /\b(reveal|exfiltrate|leak|send)\b[^\n]{0,24}\bsecret/i,
  /\bignore\s+(all\s+|the\s+)?(owner|governance|instruction)/i,
  /\bproceed\s+without\b[^\n]{0,30}(human|owner|further)?\s*(confirmation|approval|review|sign-?off)/i,
  /\btreat\s+(this|the following)\b[^\n]{0,40}\bas\b[^\n]{0,24}(source of truth|authoritative|trusted|single source)/i
];
// NOTE: regex injection-detection is best-effort defense-in-depth and is bypassable by paraphrase.
// It is NOT the security boundary. The boundary is the authority model: untrusted content can only
// reach AUTHORITATIVE via a trusted repository-backed binding whose trust origin is OUTSIDE the
// candidate (structured plan-memory JSON, or a canonical `.projectops/config.json` at the canonical
// path with matching identity that explicitly references the plan — optionally with a config-SUPPLIED,
// git-verified commit). A candidate's OWN declared source commit is never an authority path. The
// import NEVER grants PLAN READY, and every binding sets ownerReviewRequired. Evaded content stays
// CURRENT_SUPPORTING (owner-review-required) and can never self-elevate or override governance.
function isUntrustedInstruction(text) { return INSTRUCTION_INJECTION.some((re) => re.test(text)); }

// SELF authority (single-source, preliminary). Cross-source evidence is applied later by
// assignAuthorities(). Never derives authority from prose, filename, location or mtime. A plain
// document can NEVER self-assert AUTHORITATIVE — that requires structured plan-memory JSON or (later)
// a repository-backed binding.
function classifyAuthority(src) {
  const t = src.content || "";
  if (src.secretHits && src.secretHits.length) return { authority: "EXCLUDED", included: false, quarantineReason: "SECRET_BEARING", evidence: ["secret-bearing source excluded before semantic extraction"] };
  if (src.malicious) return { authority: "UNVERIFIED", included: false, quarantineReason: "UNTRUSTED_INSTRUCTION_CONTENT", evidence: ["untrusted-instruction content quarantined; contributes nothing to the import"] };

  if (src.ext === ".json") {
    let obj = null;
    try { obj = JSON.parse(stripBom(t)); } catch (_) { obj = null; }
    if (obj && typeof obj === "object") {
      const appr = (obj.approval && typeof obj.approval === "object") ? obj.approval : obj;
      const approved = (obj.approvalStatus === "approved" || appr.approvalStatus === "approved") && (obj.approvalAuthority === "owner" || appr.approvalAuthority === "owner");
      if (approved) return { authority: "AUTHORITATIVE", included: true, evidenceType: "STRUCTURED_PLAN_MEMORY", ownerReviewRequired: false, evidence: ["parsed structured owner-approved plan-memory record (approvalStatus=approved, approvalAuthority=owner)"] };
      if (obj.planStatus === "PLAN READY") return { authority: "AUTHORITATIVE", included: true, evidenceType: "STRUCTURED_PLAN_MEMORY", ownerReviewRequired: false, evidence: ["parsed structured PLAN READY plan-memory record"] };
    }
  }
  if (/\bsupersed(ed|es)\b/i.test(t)) return { authority: "SUPERSEDED", included: true, evidence: ["explicit supersedes reference"] };
  if (/\bSTATUS:\s*CLOSED\b/i.test(t) || /_closed\b/i.test(src.relPath)) return { authority: "HISTORICAL", included: true, evidenceType: "CLOSED_REPORT", evidence: ["closed/closure marker — trusted historical evidence, not the current plan"] };
  if (/\bSTATUS:\s*HISTORICAL\b/i.test(t) || /\bhistorical\b/i.test(src.relPath)) return { authority: "HISTORICAL", included: true, evidence: ["historical status label"] };
  const proseClaim = /approved by\s+\w+/i.test(t) || /approvalStatus["'\s:]+["']?approved/i.test(t) || /owner[- ]approved/i.test(t);
  return { authority: "CURRENT_SUPPORTING", included: true, ownerReviewRequired: true, proseApprovalClaim: proseClaim, evidence: [proseClaim ? "UNVERIFIED prose approval claim — owner must confirm; NOT authoritative" : "no trusted authority marker; current supporting"] };
}

// Cross-source, evidence-based authority assignment. Upgrades to AUTHORITATIVE ONLY on a strong
// repository-backed binding whose trust origin is OUTSIDE the candidate: structured plan-memory JSON,
// or a canonical `.projectops/config.json` (at the canonical path, matching identity) that explicitly
// references the plan — optionally with a config-SUPPLIED, git-verified `planSourceCommit`. A
// candidate's OWN declared source commit is NEVER an authority origin (it is at most an unverified
// document claim and, if it mismatches a config-supplied commit, fails closed). Records full evidence;
// downgrades on contradiction (identity mismatch, unverifiable binding). ctx = { repoEvidence,
// gitVerify?(commit)->bool }.
function assignAuthorities(sources, ctx) {
  ctx = ctx || {};
  const gitVerify = typeof ctx.gitVerify === "function" ? ctx.gitVerify : null;

  // SECURITY: only a config at a CANONICAL repository-convention path (or a caller-declared canonical
  // path) is trusted as an authority oracle — NOT any file that merely matches the loose PROJECT_CONFIG
  // signal. This prevents authority forgery by an attacker who plants an arbitrarily-named .json. The
  // canonical reference additionally requires the referenced plan's project identity to match the
  // config's. The reports-index-reference upgrade is deliberately NOT an authority path (a referenced
  // CLOSED report remains HISTORICAL); index references are supporting context only.
  const callerCanonical = new Set((ctx.canonicalConfigPaths || []).map((p) => toPosix(p).toLowerCase()));
  // TRUST ORACLE — LOCATION IS THE POINT, NOT THE FILENAME.
  //
  // This previously also accepted a bare top-level `project-config.json` / `config.json`. That made
  // the oracle PLANTABLE: anyone able to add one file to the repository root could nominate any
  // other document as the canonical plan, and the import would then label an attacker-authored file
  // AUTHORITATIVE with high provenance confidence. It could never create execution authority — the
  // status set still excludes PLAN READY and owner approval is still required — but it could
  // mislead the human the draft exists to be reviewed by, which for a governance tool is the harm.
  // Demonstrated live against this engine by the pilot's security review.
  //
  // Trust now requires the ProjectOS-controlled location: `.projectops/(project-)config.json`, or a
  // path the CALLER declares canonical. A document merely NAMED like a config is still discovered
  // and still readable as context — it just cannot confer authority on anything.
  function isCanonicalConfig(s) {
    const n = s.normRelPath;
    return callerCanonical.has(n) || /^\.projectops\/(project-)?config\.json$/.test(n);
  }
  const canonicalPaths = new Map(); // normalized target path -> { configPath, cfgProjectId|null }
  for (const s of sources) {
    if (s.malicious || (s.secretHits && s.secretHits.length)) continue;
    if (s.type === "PROJECT_CONFIG" && s.ext === ".json" && isCanonicalConfig(s)) {
      let obj = null; try { obj = JSON.parse(stripBom(s.content || "")); } catch (_) { obj = null; }
      if (obj && typeof obj === "object") {
        const cfgId = typeof obj.projectId === "string" ? obj.projectId.toLowerCase() : null;
        // An OPTIONAL commit supplied BY the canonical config (trust origin = config, not the candidate).
        const cfgCommit = (typeof obj.planSourceCommit === "string" && /^[0-9a-f]{7,40}$/i.test(obj.planSourceCommit)) ? obj.planSourceCommit.toLowerCase() : null;
        const cfgRepo = typeof obj.repo === "string" && obj.repo.trim() !== "" ? obj.repo.trim().toLowerCase() : null;
        for (const key of ["canonicalPlan", "masterPlan", "authoritativePlan", "plan", "authoritative"]) {
          const v = obj[key];
          const add = (x) => { if (typeof x === "string") canonicalPaths.set(normRef(s.relPath, x), { configPath: s.relPath, cfgProjectId: cfgId, cfgCommit: cfgCommit, cfgRepo: cfgRepo }); };
          if (typeof v === "string") add(v);
          if (Array.isArray(v)) v.forEach(add);
        }
      }
    }
  }

  // WHOSE PROJECT IS THIS? The repository evidence answers it when supplied, and that answer is the
  // only one with a trust origin outside the documents being judged.
  //
  // Without it the dominant identity was taken from the FIRST source that had already reached
  // AUTHORITATIVE — and `classifyAuthority` grants AUTHORITATIVE to any JSON that merely SAYS
  // `approvalStatus: approved` / `planStatus: PLAN READY`, wherever it sits. So a self-declaring
  // document could both become authoritative and then define the identity every other source was
  // measured against. Observed live, not theorised: a TEST FIXTURE plan under
  // `projectos/examples/.../proj-clean/.projectops/plan.json` was selected as this repository's
  // authoritative source. Identity now comes from the repository, and a structured record claiming
  // another project's identity is downgraded like any other mismatch.
  let dominantId = ctx.repoEvidence && typeof ctx.repoEvidence.projectId === "string" && ctx.repoEvidence.projectId.trim() !== ""
    ? ctx.repoEvidence.projectId.trim().toLowerCase()
    : null;
  if (!dominantId) for (const s of sources) { if (s.authority === "AUTHORITATIVE") { const c = extractClaims(s); if (c.projectId) { dominantId = c.projectId.toLowerCase(); break; } } }
  if (!dominantId) for (const s of sources) { if (s.malicious || s.authority === "EXCLUDED") continue; const c = extractClaims(s); if (c.projectId) { dominantId = c.projectId.toLowerCase(); break; } }

  for (const s of sources) {
    if (s.authority === "EXCLUDED" || s.malicious) continue;
    const claims = extractClaims(s);
    const contradictory = [];
    if (dominantId && claims.projectId && claims.projectId.toLowerCase() !== dominantId) {
      contradictory.push("projectId '" + claims.projectId + "' != dominant '" + dominantId + "'");
      s.authority = (s.authority === "AUTHORITATIVE") ? "CONFLICTING" : "UNVERIFIED";
      s.authorityEvidence = ["mismatched project identity — " + contradictory[0]];
      s.contradictoryEvidence = contradictory; s.ownerReviewRequired = true; continue;
    }
    if (s.authority === "AUTHORITATIVE") { s.contradictoryEvidence = contradictory; continue; }
    // Only a plain current-supporting source is eligible for a repository-backed upgrade. Historical/
    // superseded/duplicate/conflicting/unverified sources keep their (trusted or downgraded) category.
    if (s.authority !== "CURRENT_SUPPORTING") { s.contradictoryEvidence = contradictory; continue; }

    // AUTHORITY-FORGERY FIX: a candidate's OWN declared "source commit" is NEVER an authority path
    // (commit existence proves repository integrity, not owner approval / canonical status / trust).
    // Authority via a commit is honoured ONLY when the commit is supplied by a trusted CANONICAL
    // CONFIG (trust origin outside the candidate) and verified; a candidate-declared commit that
    // mismatches the config-supplied commit fails closed. A candidate-declared commit otherwise
    // remains only an unverified document claim (available for reconciliation / owner review).
    let binding = null, evSource = null, evRef = null, verification = null;
    const canon = canonicalPaths.get(s.normRelPath);
    // IDENTITY MUST BE PRESENT ON BOTH SIDES AND MATCH. Previously a missing projectId on either
    // the canonical config or the candidate satisfied this test, so "no identity stated" counted as
    // "identity agrees" — silence read as consent. Both must say who they are, and say the same.
    let identityOk = false;
    if (canon) {
      if (!canon.cfgProjectId) contradictory.push("canonical config declares no projectId");
      else if (!claims.projectId) contradictory.push("candidate declares no projectId to match the canonical config");
      else if (claims.projectId.toLowerCase() !== canon.cfgProjectId) contradictory.push("candidate projectId '" + claims.projectId + "' != canonical config projectId '" + canon.cfgProjectId + "'");
      else identityOk = true;
      // REPOSITORY IDENTITY. Enforced when both sides state it: a config naming another repository
      // is not describing this checkout. When either side is silent it is RECORDED, not assumed —
      // absence of a repo claim is not evidence of agreement, but neither is it a contradiction.
      const evRepo = ctx.repoEvidence && typeof ctx.repoEvidence.repo === "string" ? ctx.repoEvidence.repo.toLowerCase() : null;
      if (identityOk && canon.cfgRepo && evRepo && canon.cfgRepo !== evRepo) {
        contradictory.push("canonical config repo '" + canon.cfgRepo + "' != repository evidence '" + evRepo + "'");
        identityOk = false;
      }
    }
    if (canon && identityOk) {
      let commitOk = true, commitNote = "";
      if (canon.cfgCommit) {
        if (gitVerify && gitVerify(canon.cfgCommit)) { commitNote = " + canonical-config-supplied commit verified"; evRef = canon.cfgCommit; }
        else { commitOk = false; contradictory.push("canonical-config planSourceCommit not verifiable in local git"); }
      }
      const cm = /source\s*commit["\s:]+([0-9a-f]{7,40})/i.exec(s.content || "");
      if (canon.cfgCommit && cm && cm[1].toLowerCase() !== canon.cfgCommit) { commitOk = false; contradictory.push("candidate-declared commit mismatches canonical-config commit"); }
      if (commitOk) { binding = "CANONICAL_PROJECT_CONFIG"; evSource = canon.configPath; verification = "canonical-config-reference + identity-consistent" + commitNote; }
    }
    if (binding) {
      s.authority = "AUTHORITATIVE";
      s.authorityEvidence = ["repository-backed binding: " + binding];
      s.authorityRecord = { sourcePath: s.relPath, sourceChecksum: s.checksum, evidenceType: binding, evidenceSource: evSource, evidenceRef: evRef, verification: verification, confidenceBasis: "repository-backed", contradictoryEvidence: contradictory, ownerReviewRequired: true };
    } else {
      s.contradictoryEvidence = contradictory;
    }
  }
  return sources;

  function normRef(fromRel, ref) {
    // Canonical references in a project config are resolved relative to the REPOSITORY ROOT
    // (the conventional base for .projectops paths), not the config file's directory.
    return toPosix(ref.replace(/^\.\//, "")).toLowerCase();
  }
}

// ---------------------------------------------------------------------------- planning corpus
//
// BROAD DISCOVERY -> CURRENT PLANNING CORPUS -> DRAFT PLAN.
//
// Discovery should stay broad: a governance tool that cannot see the repository cannot reason about
// it. But not everything discoverable is a claim about what we are building NOW. Against this
// repository, treating every discoverable document as a competing current plan produced 442 sources,
// 5,891 conflicts and 106 phase candidates — a draft no owner could read, in which the genuine
// disagreements were indistinguishable from a hundred closed phase reports agreeing with history.
//
// Sources are therefore assigned a PLANNING ROLE. Nothing is hidden and nothing is deleted: every
// source keeps its authority, provenance and evidence, and the draft reports the whole corpus. Only
// the CURRENT_PLANNING role may manufacture conflicts, phase candidates and owner decisions.
//
//   CURRENT_PLANNING     may shape the proposed delivery plan
//   SUPPORTING_CONTEXT   real, current, useful for understanding — but not a delivery claim
//   HISTORICAL_EVIDENCE  retained for traceability; a record of past work, not today's plan
//   QUARANTINED          secret-bearing or instruction-shaped; contributes nothing, by design
//
// The corpus is DECLARED where the project declares it. A canonical ProjectOS config that names its
// plan (`planMemory.planPath`, `planMemory.currentStatePath`, or an explicit `planSources` array) is
// stating which documents are the current plan, and that statement outranks any guess. Where nothing
// is declared, role falls back to the engine's OWN existing type and authority classification —
// never to directory names, which are not evidence.
const PLANNING_ROLES = ["CURRENT_PLANNING", "SUPPORTING_CONTEXT", "HISTORICAL_EVIDENCE", "QUARANTINED"];

/** Types that are, by their own document semantics, a statement of what is being delivered now. */
const PLANNING_TYPES = new Set([
  "MASTER_PLAN", "EXECUTION_PLAN", "PROJECT_PLAN", "IMPLEMENTATION_PLAN",
  "PROJECT_CONFIG", "CURRENT_STATE", "ROADMAP"
]);

/** Types that are, by their own document semantics, a record of work already done. */
const HISTORICAL_TYPES = new Set([
  "CLOSURE_REPORT", "PHASE_REPORT", "AUDIT_LOG", "ROLLOUT_LOG", "PROJECT_LEDGER"
]);

/**
 * Collect the planning corpus a canonical config DECLARES, normalised to repo-relative posix paths.
 * Only a config the trust oracle accepts as canonical is read — the same rule that governs authority,
 * so a plantable file cannot nominate the planning corpus either.
 */
function declaredPlanningPaths(sources, ctx) {
  ctx = ctx || {};
  const callerCanonical = new Set((ctx.canonicalConfigPaths || []).map((p) => toPosix(p).toLowerCase()));
  const declared = new Set();
  for (const s of sources) {
    if (s.malicious || (s.secretHits && s.secretHits.length)) continue;
    if (s.ext !== ".json") continue;
    const n = s.normRelPath;
    const canonical = callerCanonical.has(n) || /^\.projectops\/(project-)?config\.json$/.test(n);
    if (!canonical) continue;
    let obj = null; try { obj = JSON.parse(stripBom(s.content || "")); } catch (_) { obj = null; }
    if (!obj || typeof obj !== "object") continue;
    const before = declared.size;
    const add = (x) => { if (typeof x === "string" && isSafeRepoRelativePath(x)) declared.add(toPosix(x.replace(/^\.\//, "")).toLowerCase()); };
    // The canonical ProjectOS plan-memory contract.
    if (obj.planMemory && typeof obj.planMemory === "object") {
      add(obj.planMemory.planPath);
      add(obj.planMemory.currentStatePath);
    }
    // An explicit, optional declaration for projects whose planning corpus is wider than that.
    if (Array.isArray(obj.planSources)) obj.planSources.forEach(add);
    // The existing canonical-plan reference keys are planning sources too.
    for (const key of ["canonicalPlan", "masterPlan", "authoritativePlan", "plan", "authoritative"]) {
      const v = obj[key];
      if (typeof v === "string") add(v);
      if (Array.isArray(v)) v.forEach(add);
    }
    // The config joins the corpus only if it actually NAMED one. A config that declares no plan has
    // not declared a corpus, and treating it as one would leave a project with a config but no
    // plan-memory contract with a "declared" corpus containing only the config — starving the draft
    // of the very plan document sitting beside it. Caught by the intake tests, not by inspection.
    if (before !== declared.size) declared.add(n);
  }
  return declared;
}

/**
 * Assign a planning role to every source. Pure; mutates `planningRole` / `planningRoleEvidence` and
 * returns the sources. Called after authorities are assigned, so it can use them as evidence.
 */
function assignPlanningRoles(sources, ctx) {
  const declared = declaredPlanningPaths(sources, ctx);
  const hasDeclaration = declared.size > 0;
  for (const s of sources) {
    let role, why;
    if (s.included === false) {
      role = "QUARANTINED";
      why = s.quarantineReason || s.exclusionReason || "excluded before semantic extraction";
    } else if (s.authority === "HISTORICAL" || s.authority === "SUPERSEDED") {
      role = "HISTORICAL_EVIDENCE";
      why = "authority " + s.authority + " — a record of past work, not the current plan";
    } else if (HISTORICAL_TYPES.has(s.type)) {
      role = "HISTORICAL_EVIDENCE";
      why = "document type " + s.type + " records completed work";
    } else if (hasDeclaration) {
      // The project has SAID what its plan is. Everything else is context, however plan-shaped it
      // looks — this is what stops a repository full of past plans arguing with the current one.
      if (declared.has(s.normRelPath)) { role = "CURRENT_PLANNING"; why = "declared by the canonical project config"; }
      else if (s.authority === "AUTHORITATIVE") { role = "CURRENT_PLANNING"; why = "AUTHORITATIVE via a repository-backed binding"; }
      else { role = "SUPPORTING_CONTEXT"; why = "not named by the canonical project config's declared planning corpus"; }
    } else if (s.authority === "AUTHORITATIVE") {
      role = "CURRENT_PLANNING"; why = "AUTHORITATIVE via a repository-backed binding";
    } else if (s.authority === "DUPLICATE") {
      role = "SUPPORTING_CONTEXT"; why = "duplicate of a canonical member";
    } else if (PLANNING_TYPES.has(s.type)) {
      role = "CURRENT_PLANNING"; why = "document type " + s.type + " states current delivery intent";
    } else {
      role = "SUPPORTING_CONTEXT"; why = "no current-planning signal";
    }
    s.planningRole = role;
    s.planningRoleEvidence = why;
  }
  return sources;
}

/** Summary of the whole corpus, so a narrowed plan never hides what was found. */
function summarisePlanningCorpus(sources) {
  const counts = { CURRENT_PLANNING: 0, SUPPORTING_CONTEXT: 0, HISTORICAL_EVIDENCE: 0, QUARANTINED: 0 };
  const currentPlanningSources = [];
  for (const s of sources) {
    const r = s.planningRole || "SUPPORTING_CONTEXT";
    counts[r] = (counts[r] || 0) + 1;
    if (r === "CURRENT_PLANNING") currentPlanningSources.push(s.relPath);
  }
  return { counts, currentPlanningSources: currentPlanningSources.sort(), totalDiscovered: sources.length };
}

// Group duplicates deterministically. Returns array of groups {groupId, kind, members:[relPath...]}.
function groupDuplicateSources(sources) {
  const byExact = new Map(), byNorm = new Map(), byStruct = new Map();
  for (const s of sources) {
    push(byExact, s.checksum, s.relPath);
    push(byNorm, s.normChecksum, s.relPath);
    push(byStruct, s.structKey, s.relPath);
  }
  const groups = [];
  collect(byExact, "EXACT");
  collect(byNorm, "NORMALIZED");
  collect(byStruct, "STRUCTURAL");
  function push(m, k, v) { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
  function collect(m, kind) {
    for (const [, members] of m) {
      if (members.length < 2) continue;
      const sorted = members.slice().sort();
      const groupId = kind + ":" + crypto.createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 12);
      // Avoid emitting a STRUCTURAL/NORMALIZED group that is identical membership to an already-emitted higher group.
      if (groups.some((g) => g.members.join("\n") === sorted.join("\n") && rank(g.kind) <= rank(kind))) continue;
      groups.push({ groupId, kind, members: sorted });
    }
  }
  function rank(k) { return k === "EXACT" ? 0 : k === "NORMALIZED" ? 1 : 2; }
  return groups.sort((a, b) => a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0);
}

// Extract material claims from a source for conflict detection (deterministic, best-effort, safe).
function extractClaims(src) {
  const t = src.content || "";
  const claims = {};
  const grab = (re, key) => { const m = re.exec(t); if (m) claims[key] = m[1].trim(); };
  grab(/projectId["\s:]+([A-Za-z0-9._-]+)/i, "projectId");
  grab(/(?:git\s+remote|expectedRemote|remote)["\s:]+([A-Za-z0-9._:\/@-]+)/i, "remote");
  grab(/(?:^|\n)\s*(?:default\s+|protected\s+)?branch["\s:]+([A-Za-z0-9._\/-]+)/i, "branch");
  grab(/definition of complete[:\s]+([^\n]{3,})/i, "definitionOfComplete");
  grab(/production\s*freeze["\s:]+(true|false|frozen|active)/i, "productionFreeze");
  grab(/phase\s*status["\s:]+([A-Za-z-]+)/i, "phaseStatus");
  // Ordered phase-id sequence for phase-order conflict detection.
  const phases = [];
  const pre = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:[Pp]hase\s+)?([A-Z][A-Z0-9-]*\d[A-Z0-9-]*)\b/g;
  let pm; const seen = new Set();
  while ((pm = pre.exec(t)) !== null) { if (!seen.has(pm[1])) { seen.add(pm[1]); phases.push(pm[1]); } }
  if (phases.length) claims.__phaseOrder = phases;
  return claims;
}

// Detect material conflicts between sources (pairwise on shared claim keys) + repo reconciliation.
function detectPlanConflicts(sources, repoEvidence) {
  const conflicts = [];
  const withClaims = sources.map((s) => ({ s, claims: extractClaims(s) }));
  // A differing claim between a current source and a HISTORICAL/SUPERSEDED/EXCLUDED/DUPLICATE source is
  // EXPECTED (that is what supersession means) — reconcile it, do not raise a blocking conflict.
  const RECONCILED = new Set(["HISTORICAL", "SUPERSEDED", "EXCLUDED", "DUPLICATE"]);
  const isReconciled = (a, b) => RECONCILED.has(a.authority) || RECONCILED.has(b.authority) || a.included === false || b.included === false;
  const KEYS = ["projectId", "remote", "branch", "definitionOfComplete", "productionFreeze", "phaseStatus"];
  for (const key of KEYS) {
    const present = withClaims.filter((x) => x.claims[key] !== undefined);
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i], b = present[j];
        if (isReconciled(a.s, b.s)) continue;
        if (norm(a.claims[key]) !== norm(b.claims[key])) {
          conflicts.push(mkConflict(key, a.s, b.s, a.claims[key], b.claims[key]));
        }
      }
    }
  }
  // Phase-order conflict: same set of phase IDs, different order (a roadmap sequencing disagreement).
  const withPhases = withClaims.filter((x) => Array.isArray(x.claims.__phaseOrder));
  for (let i = 0; i < withPhases.length; i++) {
    for (let j = i + 1; j < withPhases.length; j++) {
      const a = withPhases[i], b = withPhases[j];
      if (isReconciled(a.s, b.s)) continue;
      const oa = a.claims.__phaseOrder, ob = b.claims.__phaseOrder;
      const setA = oa.slice().sort().join(","), setB = ob.slice().sort().join(",");
      if (setA === setB && oa.join(",") !== ob.join(",")) {
        conflicts.push(mkConflict("phaseOrder", a.s, b.s, oa.join(">"), ob.join(">")));
      }
    }
  }
  // Repository-evidence reconciliation: document claim vs verified repo fact.
  if (repoEvidence) {
    for (const x of withClaims) {
      // Never reconcile a secret-bearing / excluded / superseded source — its claim values must not
      // be compared or emitted (this is the same guard the document-vs-document loops apply).
      if (RECONCILED.has(x.s.authority) || x.s.included === false) continue;
      if (x.claims.branch && repoEvidence.branch && norm(x.claims.branch) !== norm(repoEvidence.branch)) {
        conflicts.push(mkConflict("branch", x.s, { relPath: "<repository-evidence>", checksum: "n/a" }, x.claims.branch, repoEvidence.branch, "document-vs-repository"));
      }
      if (x.claims.remote && repoEvidence.remote && norm(x.claims.remote) !== norm(repoEvidence.remote)) {
        conflicts.push(mkConflict("remote", x.s, { relPath: "<repository-evidence>", checksum: "n/a" }, x.claims.remote, repoEvidence.remote, "document-vs-repository"));
      }
    }
  }
  function norm(v) { return String(v).trim().toLowerCase(); }
  function mkConflict(field, a, b, va, vb, kind) {
    const pair = [a.relPath, b.relPath].sort();
    const id = "CONFLICT:" + crypto.createHash("sha256").update(field + "\n" + pair.join("\n")).digest("hex").slice(0, 12);
    const material = ["projectId", "remote", "branch", "definitionOfComplete", "productionFreeze", "phaseStatus", "phaseOrder"].includes(field);
    const redact = (v) => scanSecrets(String(v)).length ? "[REDACTED: secret-shaped value]" : String(v);
    return {
      conflictId: id, field, kind: kind || "document-vs-document",
      sourceA: a.relPath, sourceB: b.relPath, valueA: redact(va), valueB: redact(vb),
      authorityA: a.authority || "unknown", authorityB: b.authority || "unknown",
      severity: material ? "material" : "minor",
      autoResolvable: false, selectedResolution: null,
      reason: "differing " + field + " across sources; owner decision required",
      ownerDecisionRequired: true, planStatusEffect: "PLAN CONFLICT"
    };
  }
  return conflicts.sort((a, b) => a.conflictId < b.conflictId ? -1 : a.conflictId > b.conflictId ? 1 : 0);
}

// Select the authoritative source by precedence, but never silently discard conflicting evidence.
function selectAuthoritative(sources) {
  const RECONCILED = new Set(["HISTORICAL", "SUPERSEDED", "EXCLUDED", "DUPLICATE", "CONFLICTING", "UNVERIFIED"]);
  const eligible = sources.filter((s) => !RECONCILED.has(s.authority) && s.included !== false);
  const pool = eligible.length ? eligible : sources;
  const ranked = pool.slice().sort((a, b) => {
    const ra = PRECEDENCE.indexOf(a.type), rb = PRECEDENCE.indexOf(b.type);
    const pa = ra === -1 ? PRECEDENCE.length : ra, pb = rb === -1 ? PRECEDENCE.length : rb;
    if (pa !== pb) return pa - pb;
    return a.relPath < b.relPath ? -1 : 1;
  });
  const authoritative = ranked.find((s) => s.authority === "AUTHORITATIVE");
  return authoritative || ranked[0] || null;
}

// Build a structured plan draft with field-level provenance. Never invents facts.
function buildPlanDraft(sources, repoEvidence, conflicts, duplicates) {
  const usable = sources.filter((s) => s.included && s.authority !== "EXCLUDED");
  const primary = selectAuthoritative(usable);
  const prov = [];
  // Structured planning sources, in the same precedence order the prose scan uses.
  const structured = usable.map((s) => ({ s, sp: extractStructuredPlan(s) })).filter((x) => x.sp !== null);
  const field = (name, re, extract, structuredKey) => {
    // STRUCTURED EVIDENCE FIRST — a declared field is a statement, not a phrase that happened to
    // match a regex, so it is both more reliable and higher-confidence provenance.
    if (structuredKey) {
      for (const { s, sp } of structured) {
        const v = sp[structuredKey];
        if (typeof v === "string" && v !== "") {
          prov.push({ field: name, value: v, sourcePath: s.relPath, sourceChecksum: s.checksum, locator: "json-field:" + structuredKey, sourceAuthority: s.authority, extractionMethod: "structured-json", confidence: "high", competingSources: [], conflictRef: null, manualReviewRequired: false });
          return v;
        }
      }
    }
    for (const s of usable) {
      const m = re.exec(s.content || "");
      if (m) {
        const value = extract ? extract(m) : m[1].trim();
        prov.push({ field: name, value, sourcePath: s.relPath, sourceChecksum: s.checksum, locator: "regex:" + name, sourceAuthority: s.authority, extractionMethod: "regex", confidence: s.authority === "AUTHORITATIVE" ? "high" : "medium", competingSources: [], conflictRef: null, manualReviewRequired: false });
        return value;
      }
    }
    prov.push({ field: name, value: "UNKNOWN", sourcePath: null, sourceChecksum: null, locator: null, sourceAuthority: null, extractionMethod: "none", confidence: "none", competingSources: [], conflictRef: null, manualReviewRequired: true });
    return "NEEDS SOURCE";
  };

  const draft = {
    schemaVersion: "1.0.0",
    projectIdCandidate: field("projectId", /projectId["\s:]+([A-Za-z0-9._-]+)/i, null, "projectId"),
    businessVision: field("businessVision", /(?:business\s*)?vision[:\s]+([^\n]{3,})/i, null, "businessVision"),
    definitionOfComplete: field("definitionOfComplete", /definition of complete[:\s]+([^\n]{3,})/i, null, "definitionOfComplete"),
    // Scope is what the owner is actually agreeing to, so a declared list is reported rather than
    // left empty. Prose scope is not inferred: an absent list stays absent.
    approvedScopeCandidates: (structured.find((x) => x.sp.approvedScope.length > 0) || { sp: { approvedScope: [] } }).sp.approvedScope,
    excludedScopeCandidates: (structured.find((x) => x.sp.excludedScope.length > 0) || { sp: { excludedScope: [] } }).sp.excludedScope,
    repositoryFacts: repoEvidence || { note: "repository evidence not supplied" },
    authoritativeSource: primary ? primary.relPath : null,
    sourceInventory: usable.map((s) => s.relPath),
    conflicts: conflicts.map((c) => c.conflictId),
    unresolvedUnknowns: prov.filter((p) => p.value === "UNKNOWN").map((p) => p.field),
    environmentCandidates: [],
    providerReferenceCandidates: [],
    safetyGateCandidates: [],
    criticalLockCandidates: [],
    phaseCandidates: buildPhaseCandidates(usable),
    provenance: prov,
    importConfidence: primary && primary.authority === "AUTHORITATIVE" ? "medium" : "low",
    ownerDecisionsRequired: conflicts.filter((c) => c.ownerDecisionRequired).map((c) => c.conflictId)
  };
  return draft;
}

// Generate phase candidates ONLY where explicit evidence exists; otherwise a planning gap.
/**
 * Read a STRUCTURED plan out of a JSON planning source.
 *
 * A JSON plan is a plan. Without this the engine only understood prose: against this repository the
 * canonical plan is `projectos/state/projectos-v3.plan.json`, which states its vision, its
 * definition of complete, its approved and excluded scope and all nineteen phases as data — and the
 * markdown regexes found none of it, so the draft reported "NEEDS SOURCE" for facts sitting in
 * plain sight and proposed zero phases. Returns null for anything that is not a parseable object.
 */
function extractStructuredPlan(src) {
  if (!src || src.ext !== ".json") return null;
  let obj = null;
  try { obj = JSON.parse(stripBom(src.content || "")); } catch (_) { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const str = (v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : []);
  return {
    projectId: str(obj.projectId),
    businessVision: str(obj.businessVision) || str(obj.vision),
    definitionOfComplete: str(obj.definitionOfComplete),
    approvedScope: arr(obj.approvedScope),
    excludedScope: arr(obj.excludedScope),
    phases: Array.isArray(obj.phases) ? obj.phases.filter((p) => p && typeof p === "object") : []
  };
}

function buildPhaseCandidates(sources) {
  const candidates = [];
  // STRUCTURED FIRST. A declared JSON plan states its phases as data, with their real dependencies,
  // acceptance criteria, validators and owner gates — infinitely better evidence than scraping an
  // id-shaped token out of prose, and it carries the fields an owner actually needs to review.
  const structuredIds = new Set();
  for (const s of sources) {
    const sp = extractStructuredPlan(s);
    if (sp === null || sp.phases.length === 0) continue;
    for (const p of sp.phases) {
      const id = typeof p.phaseId === "string" ? p.phaseId.trim() : "";
      if (id === "" || structuredIds.has(id)) continue;
      structuredIds.add(id);
      const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
      candidates.push({
        phaseId: id,
        title: typeof p.title === "string" && p.title.trim() !== "" ? p.title.trim() : id,
        purpose: typeof p.description === "string" && p.description.trim() !== "" ? p.description.trim() : "NEEDS OWNER DECISION",
        scope: typeof p.scope === "string" && p.scope.trim() !== "" ? p.scope.trim() : "NEEDS SOURCE",
        exclusions: strArr(p.exclusions),
        dependencies: strArr(p.dependsOn),
        acceptanceCriteria: strArr(p.acceptanceCriteria),
        expectedValidators: strArr(p.requiredValidators),
        requiredReviews: strArr(p.requiredReviews),
        ownerGates: strArr(p.requiredOwnerGates).length ? strArr(p.requiredOwnerGates) : ["phase-closure"],
        sourceReferences: [s.relPath],
        confidence: "high",
        extractionMethod: "structured-json",
        unresolvedQuestions: strArr(p.acceptanceCriteria).length ? [] : ["acceptance criteria not sourced"]
      });
    }
  }
  for (const s of sources) {
    const rows = /(^|\n)\s*(?:#{1,6}\s*)?(?:[Pp]hase\s+)?([A-Z][A-Z0-9-]{3,})\b[^\n]*/g;
    let m, seen = new Set();
    while ((m = rows.exec(s.content || "")) !== null) {
      const id = m[2];
      if (!/^[A-Z][A-Z0-9-]*\d[A-Z0-9-]*$/.test(id)) continue; // require a phase-id shape
      if (seen.has(id) || structuredIds.has(id)) continue; seen.add(id); // structured evidence wins
      candidates.push({ phaseId: id, title: id, purpose: "NEEDS OWNER DECISION", scope: "NEEDS SOURCE", exclusions: [], dependencies: [], acceptanceCriteria: [], expectedValidators: [], requiredReviews: [], ownerGates: ["phase-closure"], sourceReferences: [s.relPath], confidence: "low", unresolvedQuestions: ["acceptance criteria not sourced"] });
    }
  }
  // Deterministic order by phaseId then source.
  return candidates.sort((a, b) => a.phaseId < b.phaseId ? -1 : a.phaseId > b.phaseId ? 1 : 0);
}

// Import status: NEVER PLAN READY here.
function calculateImportStatus(draft, conflicts, sources, opts) {
  // A critical repository-boundary failure (e.g. root not a directory, unverifiable evidence) blocks
  // a safe draft regardless of content.
  if (opts && opts.boundaryBlocked) return "PLAN BLOCKED";
  const credible = sources.filter((s) => s.included !== false && s.authority !== "EXCLUDED" && s.type !== "UNKNOWN" && s.type !== "README_CONTEXT" && s.type !== "CLAUDE_INSTRUCTIONS");
  if (sources.length === 0 || credible.length === 0) return "NO PLAN";
  const material = conflicts.filter((c) => c.severity === "material");
  if (material.length > 0) return "PLAN CONFLICT";
  if (!draft || !draft.authoritativeSource) return "PLAN DISCOVERED";
  const hasDoC = draft.definitionOfComplete && draft.definitionOfComplete !== "NEEDS SOURCE" && draft.definitionOfComplete !== "UNKNOWN";
  const hasPhases = Array.isArray(draft.phaseCandidates) && draft.phaseCandidates.length > 0;
  if (hasDoC && hasPhases) return "AWAITING OWNER APPROVAL";
  return "PLAN DRAFTED";
}

// Provenance validation: every material field traces to a source or an explicit marker.
const MATERIAL_FIELDS = ["projectId", "businessVision", "definitionOfComplete"];
function validatePlanProvenance(draft) {
  const errors = [];
  if (!draft || !Array.isArray(draft.provenance)) { errors.push("draft has no provenance array"); return errors; }
  const byField = new Set(draft.provenance.map((p) => p.field));
  for (const f of MATERIAL_FIELDS) if (!byField.has(f)) errors.push("missing provenance for material field: " + f);
  for (const p of draft.provenance) {
    const known = p.value !== undefined;
    if (!known) { errors.push("provenance entry missing value for " + p.field); continue; }
    if (p.value !== "UNKNOWN" && p.value !== "NEEDS SOURCE") {
      if (!p.sourcePath || !p.sourceChecksum) errors.push("field '" + p.field + "' has a value but no source provenance");
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------- safe filesystem walk
// Discover candidate sources under a verified repository root. Read-only, fail-closed, bounded.
function discoverPlanSources(rootDir, opts) {
  const limits = Object.assign({}, DEFAULT_LIMITS, (opts && opts.limits) || {});
  const root = path.resolve(rootDir);
  const sources = [];
  const skipped = [];
  let fileCount = 0;
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { root, limits, sources, skipped: [{ path: rootDir, reason: "root not a directory (fail-closed)" }], truncated: false };
  }
  let truncated = false;
  (function walk(dirAbs, depth) {
    if (truncated) return;
    if (depth > limits.maxDepth) { skipped.push({ path: rel(dirAbs), reason: "max depth exceeded" }); return; }
    let entries;
    try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); }
    catch (e) { skipped.push({ path: rel(dirAbs), reason: "unreadable directory (fail-closed)" }); return; }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); // deterministic order
    for (const ent of entries) {
      if (truncated) return;
      const abs = path.join(dirAbs, ent.name);
      const relPath = rel(abs);
      // Symlink / junction: do NOT follow; record and skip (prevents escape).
      let lst;
      try { lst = fs.lstatSync(abs); } catch (e) { skipped.push({ path: relPath, reason: "unstatable (fail-closed)" }); continue; }
      if (lst.isSymbolicLink()) { skipped.push({ path: relPath, reason: "symlink/junction not followed" }); continue; }
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) { skipped.push({ path: relPath, reason: "skipped directory" }); continue; }
        if (!isWithinRoot(root, abs)) { skipped.push({ path: relPath, reason: "outside repository root" }); continue; }
        walk(abs, depth + 1);
        continue;
      }
      if (!lst.isFile()) { skipped.push({ path: relPath, reason: "not a regular file" }); continue; }
      if (FORBIDDEN_FILE_RE.test(relPath)) { skipped.push({ path: relPath, reason: "credential-bearing file never opened" }); continue; }
      const ext = path.extname(ent.name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) { skipped.push({ path: relPath, reason: "unsupported extension" }); continue; }
      if (lst.size > limits.maxFileBytes) { skipped.push({ path: relPath, reason: "exceeds max file size" }); continue; }
      if (fileCount >= limits.maxFiles) { truncated = true; skipped.push({ path: relPath, reason: "max file count reached (truncated)" }); return; }
      fileCount += 1;
      let raw;
      try { raw = fs.readFileSync(abs); } catch (e) { skipped.push({ path: relPath, reason: "unreadable file (fail-closed)" }); continue; }
      if (looksBinary(raw)) { skipped.push({ path: relPath, reason: "binary content" }); continue; }
      let text;
      try { text = decodeUtf8Strict(raw); } catch (e) { skipped.push({ path: relPath, reason: "unsupported encoding" }); continue; }
      const src = fingerprintPlanSource({ relPath, ext, size: lst.size, mtimeMs: lst.mtimeMs, content: text });
      sources.push(src);
    }
  })(root, 0);
  sources.sort((a, b) => a.normRelPath < b.normRelPath ? -1 : a.normRelPath > b.normRelPath ? 1 : 0);
  // Apply cross-source, evidence-based authority (config/index/identity bindings; git binding is added
  // later by importFromSources when a gitVerify callback is supplied).
  assignAuthorities(sources, { repoEvidence: (opts && opts.repoEvidence) || null });
  return { root, limits, sources, skipped, truncated };
  function rel(abs) { return toPosix(path.relative(root, abs)); }
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true; // NUL byte => binary
  return false;
}
function decodeUtf8Strict(buf) {
  const s = buf.toString("utf8");
  if (s.indexOf("�") !== -1) throw new Error("invalid utf8"); // replacement char => reject
  return s;
}

// Build the full fingerprint/classification record for one in-memory source. Pure (no fs).
function fingerprintPlanSource(input) {
  const content = input.content;
  const secretHits = scanSecrets(content);
  const malicious = secretHits.length === 0 && isUntrustedInstruction(content);
  // Secret-bearing AND untrusted-instruction sources are quarantined: their extracted human-readable
  // fields are redacted so neither a secret nor a hostile payload leaves the engine via title/headings/
  // claims. structKey/checksums are one-way hashes.
  const headings = (secretHits.length || malicious) ? [] : extractHeadings(content);
  const structKey = crypto.createHash("sha256").update(
    (extractTitle(content, input.relPath) || "") + "" +
    headings.map((h) => h.level + ":" + h.text.toLowerCase()).join("") + "" +
    (/(?:plan\s*version|planVersion)["\s:]+([0-9]+\.[0-9]+)/i.exec(content) || [,""])[1]
  ).digest("hex").slice(0, 16);
  const base = {
    relPath: input.relPath,
    normRelPath: toPosix(input.relPath).toLowerCase(),
    ext: input.ext,
    size: input.size,
    mtimeAdvisoryMs: input.mtimeMs, // advisory metadata only — never used for identity/freshness
    checksum: sha256(Buffer.from(content, "utf8")),
    normChecksum: sha256(Buffer.from(normalizeContent(content), "utf8")),
    structKey,
    title: (secretHits.length || malicious) ? (secretHits.length ? "[REDACTED: secret-bearing source]" : "[REDACTED: untrusted-instruction source]") : extractTitle(content, input.relPath),
    headings,
    content,
    secretHits,
    malicious,
    secretScan: secretHits.length ? "secret-like content detected" : "clean",
    included: true,
    exclusionReason: secretHits.length ? "SECRET_BEARING" : (malicious ? "UNTRUSTED_INSTRUCTION_CONTENT" : null)
  };
  const typeC = classifyPlanSource(base);
  base.type = typeC.type; base.typeEvidence = typeC.evidence;
  const authC = classifyAuthority(base);
  base.authority = authC.authority;
  base.authorityEvidence = authC.evidence;
  base.included = authC.included !== undefined ? authC.included : true;
  base.quarantineReason = authC.quarantineReason || null;
  base.ownerReviewRequired = authC.ownerReviewRequired || false;
  base.evidenceType = authC.evidenceType || null;
  if (authC.proseApprovalClaim) base.proseApprovalClaim = true;
  return base;
}

// Reconcile document claims vs repository evidence (thin wrapper around detectPlanConflicts repo path).
function reconcileRepositoryEvidence(sources, repoEvidence) {
  return detectPlanConflicts(sources, repoEvidence).filter((c) => c.kind === "document-vs-repository");
}

// Mark exact/normalized duplicates: the best-authority member is canonical, the rest become DUPLICATE
// with a canonicalSource reference. Structural similarity is retained as evidence, not treated as identity.
const AUTH_RANK = { AUTHORITATIVE: 0, CURRENT_SUPPORTING: 1, HISTORICAL: 2, SUPERSEDED: 3, UNVERIFIED: 4, CONFLICTING: 5, DUPLICATE: 6, EXCLUDED: 7 };
function markCanonicalDuplicates(sources, groups) {
  const byPath = new Map(sources.map((s) => [s.relPath, s]));
  for (const g of groups) {
    if (g.kind === "STRUCTURAL") continue;
    const members = g.members.map((p) => byPath.get(p)).filter(Boolean);
    if (members.length < 2) continue;
    const canonical = members.slice().sort((a, b) => (AUTH_RANK[a.authority] - AUTH_RANK[b.authority]) || (a.relPath < b.relPath ? -1 : 1))[0];
    g.canonicalSource = canonical.relPath;
    for (const m of members) {
      if (m === canonical) continue;
      if (["AUTHORITATIVE", "CURRENT_SUPPORTING", "UNVERIFIED", "HISTORICAL", "SUPERSEDED"].includes(m.authority)) {
        m.authority = "DUPLICATE"; m.duplicateOf = canonical.relPath;
        m.authorityEvidence = ["duplicate of canonical source " + canonical.relPath + " (group " + g.groupId + ")"];
      }
    }
  }
}

// Full deterministic import over an already-discovered source set (pure; no fs except an optional
// caller-supplied gitVerify callback). options = { gitVerify?(commit)->bool, boundaryBlocked?:bool }.
function importFromSources(sources, repoEvidence, options) {
  options = options || {};
  assignAuthorities(sources, { repoEvidence: repoEvidence, gitVerify: options.gitVerify, canonicalConfigPaths: options.canonicalConfigPaths });
  const duplicates = groupDuplicateSources(sources);
  markCanonicalDuplicates(sources, duplicates);

  // Roles are assigned AFTER authorities and duplicates, so both are available as evidence, and
  // BEFORE conflicts and phases, which are the two things a role is allowed to gate. The full
  // source list still travels everywhere; only what may manufacture a claim is narrowed.
  assignPlanningRoles(sources, { canonicalConfigPaths: options.canonicalConfigPaths });
  const planningCorpus = summarisePlanningCorpus(sources);
  const planningSources = sources.filter((s) => s.planningRole === "CURRENT_PLANNING");

  const conflicts = detectPlanConflicts(planningSources, repoEvidence);
  const draft = buildPlanDraft(planningSources, repoEvidence, conflicts, duplicates);
  draft.planningCorpus = planningCorpus;
  const status = calculateImportStatus(draft, conflicts, planningSources, { boundaryBlocked: options.boundaryBlocked });
  const provenanceErrors = validatePlanProvenance(draft);
  return { duplicates, conflicts, draft, status, provenanceErrors, planningCorpus };
}

module.exports = {
  DEFAULT_LIMITS, SUPPORTED_EXTS, SKIP_DIRS, RAW_SECRET_MARKER, PLAN_STATUSES, AUTHORITY, PRECEDENCE,
  sha256, normalizeContent, isSafeRepoRelativePath, isWithinRoot, scanSecrets, looksBinary,
  extractHeadings, extractTitle, classifyPlanSource, classifyAuthority, assignAuthorities,
  isUntrustedInstruction, groupDuplicateSources, markCanonicalDuplicates,
  extractStructuredPlan,
  extractClaims, detectPlanConflicts, reconcileRepositoryEvidence, selectAuthoritative,
  PLANNING_ROLES, PLANNING_TYPES, HISTORICAL_TYPES, declaredPlanningPaths, assignPlanningRoles, summarisePlanningCorpus,
  buildPlanDraft, buildPhaseCandidates, calculateImportStatus, validatePlanProvenance,
  discoverPlanSources, fingerprintPlanSource, importFromSources
};
