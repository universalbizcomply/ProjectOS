"use strict";
/**
 * THE GOVERNED AGENT WORKFORCE — PROJECTOS-AGENT-WORKFORCE1A.
 *
 * Owner, then ProjectOS governance, then exactly ONE project leader per governed project, then the
 * minimum specialist team ProjectOS selects. All 279 pinned agents are registered; almost none may do
 * anything. The unit proofs live in `projectos/agent/test/workforce*.test.ts`; this validator pins the
 * SHAPE that keeps them true, so a later edit cannot quietly remove a refusal the tests happen not to
 * exercise:
 *
 *   A. one leader: minted exclusively, a second refused, replaced only by the lease-bound takeover that
 *      increments the generation, and every item checked against the current generation;
 *   B. no leaderless specialist: the leader gate runs FIRST in dispatch — before the proposal is read,
 *      the context assembled, the instruction text read or an engine invoked — and again on arrival;
 *   C. authority: protected actions go to the gates that already own them and nothing returns
 *      `authorised: true`; the leader's prohibited decisions are all mapped; governance is read only
 *      from the owner-accepted upstream commit, never HEAD and never a local candidate; grants never
 *      take the imported text as input; the tool list is closed; live execution is not activated;
 *   D. import provenance and count equality: the owner's pin (commit, 279, 18, MIT) and a registry that
 *      matches it exactly, with restrictive defaults on every entry;
 *   E. the structured result contract: closed field set, validated before anything is recorded;
 *   F. review independence: the leader, a contributor and panel output never satisfy independent
 *      review, and no workforce result satisfies a plan-required review;
 *   G. no new governance role: `Role` is still owner | advisor | implementer, and the workforce never
 *      acts as `owner`;
 *   H. fixture execution only: no network, provider or credential reach in the workforce sources.
 *
 * Reads files. Runs nothing, calls no provider, mutates nothing.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const WF = "projectos/agent/src/workforce";
const FILES = {
  leader: `${WF}/leader.ts`,
  store: `${WF}/eventStore.ts`,
  dispatch: `${WF}/dispatch.ts`,
  protectedActions: `${WF}/protectedActions.ts`,
  decisions: `${WF}/leaderDecisions.ts`,
  governance: `${WF}/governance.ts`,
  registry: `${WF}/registry.ts`,
  types: `${WF}/types.ts`,
  contracts: `${WF}/contracts.ts`,
  review: `${WF}/review.ts`,
  engines: `${WF}/engines.ts`,
  models: `${WF}/models.ts`,
  orchestrator: `${WF}/orchestrator.ts`,
  coreTypes: "projectos/core/src/types.ts",
};
const DATA = {
  config: ".projectops/workforce/workforce-config.json",
  registry: ".projectops/workforce/registry.json",
  selection: ".projectops/workforce/selection-policy.json",
  models: ".projectops/workforce/model-policy.json",
};
const TESTS = [
  "projectos/agent/test/workforceLeader.test.ts",
  "projectos/agent/test/workforceDispatch.test.ts",
  "projectos/agent/test/workforceAuthority.test.ts",
  "projectos/agent/test/workforceSelection.test.ts",
  "projectos/agent/test/workforceGovernance.test.ts",
  "projectos/agent/test/workforceEvaluation.test.ts",
  "projectos/agent/test/workforceAcquisition.test.ts",
  "projectos/agent/test/workforceRun.test.ts",
];

/** The owner's ratified pin — fixed here independently of every scan. */
const PIN = Object.freeze({ commit: "ad9264e309bd5e5422c04784372d7841b1e5d604", agents: 279, divisions: 18, licence: "MIT" });
const GRANTABLE = ["read-repository", "search-repository", "run-sandbox-tests", "draft-proposal"];
const PROHIBITED_KINDS = [
  "approve-own-work",
  "approve-protected-action",
  "approve-production-deployment",
  "approve-production-database-mutation",
  "approve-live-communication",
  "approve-payment-or-refund",
  "use-credential",
  "change-governance",
  "change-workforce-configuration",
  "change-registry-eligibility",
  "change-selection-policy",
  "change-model-policy",
  "expand-scope",
  "accept-risk",
  "close-phase",
  "bypass-gatekeeper",
  "bypass-owner",
  "mint-authority",
  "add-team-member",
];
const RESULT_FIELDS = ["schema", "taskId", "agent", "provenance", "status", "summary", "findings", "evidenceRefs", "affectedFiles", "risks", "recommendations", "confidence", "blockers", "decisionRequired"];

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments so prose describing a rule never satisfies or breaks it. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1 ");
}

/** The body of `function name(` up to the next top-level function declaration. */
function fnBody(src, name) {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) return null;
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(export )?function /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

function workforceSources() {
  const dir = path.join(ROOT, ...WF.split("/"));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".ts")).map((n) => ({ rel: `${WF}/${n}`, text: code(fs.readFileSync(path.join(dir, n), "utf8")) }));
}

function run() {
  const errors = [];
  const E = (m) => errors.push(m);
  const src = {};
  for (const [k, rel] of Object.entries(FILES)) {
    const t = read(rel);
    if (t === null) E(`${rel} is missing`);
    else src[k] = code(t);
  }
  if (errors.length > 0) return errors;
  const all = workforceSources();

  // ---- A. ONE LEADER -------------------------------------------------------------------------------
  const mint = fnBody(src.leader, "mintProjectLeader");
  if (mint === null || !/if \(existing !== null\)\s*\{\s*throw new WorkforceRefusal\('LEADER_EXISTS'/.test(mint)) E("A1 mintProjectLeader no longer refuses when a leader exists (LEADER_EXISTS)");
  if (mint === null || !/createExclusive\(store\.paths\.leader,/.test(mint)) E("A2 the first leader record is no longer created exclusively");
  const ensure = fnBody(src.leader, "ensureProjectLeader");
  if (ensure === null || !/if \(!isStale\(existing, terms\.now, terms\.leaseBoundMs\)\)/.test(ensure)) E("A3 a takeover is no longer conditional on the lease bound");
  if (ensure === null || !/const generation = existing\.generation \+ 1;/.test(ensure)) E("A4 a takeover no longer increments the leader generation");
  if (ensure === null || !/store\.append\('leader-takeover'/.test(ensure)) E("A5 a takeover is no longer recorded as an event");
  if (!/const idle = Date\.parse\(now\) - Date\.parse\(claim\.renewedAt\);/.test(src.leader) || !/return idle > leaseBoundMs;/.test(src.leader) || !/if \(!Number\.isFinite\(idle\)\) throw new WorkforceRefusal\('LEADER_TIME_UNKNOWN'/.test(src.leader)) {
    E("A6 staleness is no longer 'exceeds the governance lease bound', or an unreadable time no longer refuses");
  }
  const gate = fnBody(src.leader, "assertCurrentGeneration");
  if (gate === null || !/generation !== claim\.generation/.test(gate) || !/'GENERATION_VOID'/.test(gate) || !/'NO_PROJECT_LEADER'/.test(gate)) {
    E("A7 assertCurrentGeneration no longer refuses a missing leader or a void generation");
  }
  if (!/'LEADER_RECORD_TAMPERED'/.test(src.leader) || !/text !== canonicalJson\(derived\)/.test(src.leader)) E("A8 a hand-edited leader record is no longer detected against the event chain");
  for (const f of all) {
    if (f.rel === FILES.leader) continue;
    if (/append\('leader-(minted|takeover|lease-renewed)'/.test(f.text)) E(`A9 ${f.rel} writes a leader event; only leader.ts may`);
    if (/paths\.leader/.test(f.text) && f.rel !== FILES.store) E(`A10 ${f.rel} touches the leader record; only leader.ts may`);
  }
  if (/from '\.\.\/system\.js'|from '\.\/eventStore\.js'|WorkforceStore/.test(src.engines)) E("A11 the engine interfaces can reach a System or the store — the leader session must hold neither");
  const wsr0 = fnBody(src.orchestrator, "workforceStateRoot");
  if (wsr0 === null || !/nodeInstallationStateDir\(env\)/.test(wsr0) || !/startsWith\(`\$\{norm\(root\)\}\/`\)\) return null;/.test(wsr0)) E("A12 workforce state is no longer kept outside the governed checkout");
  for (const f of all) if (/workforce-state/.test(f.text)) E(`A13 ${f.rel} places workforce state in the working tree`);

  // ---- B. NO LEADERLESS SPECIALIST -----------------------------------------------------------------
  const locked = fnBody(src.dispatch, "dispatchLocked");
  if (locked === null) E("B1 dispatchLocked is missing");
  else {
    const at = (re) => locked.search(re);
    const gateAt = at(/assertCurrentGeneration\(rt\.store, generation/);
    if (gateAt < 0) E("B2 dispatch no longer checks the project leader and generation");
    for (const [label, re] of [
      ["the proposal is read", /validateProposalShape\(/],
      ["the ledger is read", /readVerified\(\)/],
      ["the instruction text is read", /rt\.instructions\.read\(/],
      ["the task is assembled", /const envelope: TaskEnvelope/],
    ]) {
      const i = at(re);
      if (i < 0 || gateAt < 0 || i < gateAt) E(`B3 the leader gate no longer runs before ${label}`);
    }
    if (!/sha256Hex\(text\.bytes\)/.test(locked) || !/actual !== entry\.source\.digest/.test(locked) || !/'INSTRUCTION_INTEGRITY'/.test(locked)) {
      E("B4 the instruction text is no longer hashed against its registered digest immediately before use");
    }
    if (!/'ROLE_NOT_ON_TEAM'/.test(locked)) E("B5 dispatch no longer refuses a role outside the selected team");
    if (!/'OUTSIDE_GRANT'/.test(locked)) E("B6 dispatch no longer refuses tools or scopes outside the grant");
  }
  const accept = fnBody(src.dispatch, "acceptResult");
  if (accept === null || accept.search(/assertCurrentGeneration\(/) < 0 || accept.search(/assertCurrentGeneration\(/) > accept.search(/validateResult\(/)) {
    E("B7 a result arriving is no longer checked against the current generation first");
  }
  const views = fnBody(src.dispatch, "contradictionViews");
  if (views === null || !/else if \(e\.type === 'contradiction-resolved'\) closed\.add/.test(views) || /contradiction-escalated'\)\s*closed/.test(views) || /'contradiction-escalated'[^\n]*closed\.add/.test(views)) {
    E("B9 an escalated contradiction is treated as closed — only a recorded resolution closes one");
  }
  if (locked === null || !/refs\.some\(\(r\) => c\.resultDigests\.includes\(r\)\)/.test(locked)) E("B10 a contradicted result can be handed to another task");
  if (locked === null || !/const openParty = views\.open\.find\(\(c\) => c\.roles\.includes\(p\.roleId\)\)/.test(locked)) E("B11 a party to an open contradiction can be re-asked");
  if (locked === null || !/'REVIEW_TASK_NEEDS_A_SUBJECT'/.test(locked)) E("B12 an independent reviewer can be given work that reviews no contributor result");
  const executes = all.filter((f) => /\.execute\(\{/.test(f.text)).map((f) => f.rel).sort();
  const allowedExec = [FILES.dispatch, `${WF}/evaluation.ts`].sort();
  if (JSON.stringify(executes) !== JSON.stringify(allowedExec)) E(`B8 engines are invoked outside dispatch and the evaluation pipeline: ${executes.join(", ")}`);

  // ---- C. AUTHORITY --------------------------------------------------------------------------------
  for (const f of all) if (/authorised:\s*true/.test(f.text)) E(`C1 ${f.rel} can return authorised: true — no workforce request is ever authorised in this phase`);
  if (!/readonly authorised: false;/.test(src.protectedActions)) E("C2 the protected-action verdict type no longer fixes authorised to false");
  for (const fn of ["requestApproval", "decide", "enforcedOwnerOnlyActions", "authoriseClosure", "isTechnicalAction", "routeStop"]) {
    if (!new RegExp(`\\b${fn}\\(`).test(src.protectedActions)) E(`C3 protected actions no longer consult the owning gate '${fn}'`);
  }
  if (/requestApproval\([^)]*'owner'/.test(src.protectedActions) || /decide\([^)]*'owner'/.test(src.protectedActions)) E("C4 the workforce asks the approval engine as 'owner'");
  if (!/decide\(request, 'approved', 'implementer'/.test(src.protectedActions)) E("C5 the leader's self-decision is no longer put to the approval engine as the implementer");
  for (const k of PROHIBITED_KINDS) if (!new RegExp(`'${k}':\\s*'[a-z-]+'`).test(src.decisions)) E(`C6 leader decision '${k}' is no longer mapped to a refusing gate`);
  const oac = fnBody(src.governance, "ownerAcceptedCommit");
  if (oac === null || !/'@\{upstream\}\^\{commit\}'/.test(oac)) E("C7 governance is no longer read from the owner-accepted upstream commit");
  if (oac === null || !/LOCAL_CANDIDATE_TRAILER/.test(oac)) E("C8 a local-candidate commit is no longer refused as governance state");
  const lw = fnBody(src.governance, "loadWorkforceGovernance");
  if (lw === null || !/ownerAcceptedCommit\(sys, root\)/.test(lw) || /HEAD/.test(lw)) E("C9 loadWorkforceGovernance no longer loads only the owner-accepted commit");
  for (const f of all) {
    if (/\.projectops\/workforce\//.test(f.text) && /(readText|readFileSync)\(/.test(f.text) && f.rel !== `${WF}/acquisition.ts`) {
      E(`C10 ${f.rel} may read workforce governance from the working tree`);
    }
  }
  if (!/export function effectiveRole\(entry: RegistryEntry, config: WorkforceConfig\): EffectiveRole/.test(src.registry)) E("C11 effectiveRole's inputs changed — a grant must never take the imported text");
  if (/sourceDeclares/.test(fnBody(src.registry, "effectiveRole") || "")) E("C12 effectiveRole reads what the imported text declares");
  const tools = /export const GRANTABLE_TOOLS: readonly ToolName\[\] = \[([^\]]*)\]/.exec(src.types);
  const toolList = tools === null ? null : tools[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
  if (toolList === null || JSON.stringify(toolList) !== JSON.stringify(GRANTABLE)) E(`C13 the grantable tool list is not exactly ${GRANTABLE.join(", ")}`);
  if (!/liveExecutionActivated must be false/.test(src.governance)) E("C14 the model policy no longer refuses activated live execution");
  if (oac === null || !/startsWith\('refs\/remotes\/'\)/.test(oac)) E("C15 a local-branch upstream can pose as owner-accepted state");
  const loadAt = fnBody(src.governance, "loadAt");
  if (loadAt === null || !/readAt\(sys, root, commit, '\.projectops\/project-config\.json'\)/.test(loadAt)) E("C16 the governed project is no longer named from the owner-accepted commit");
  if (!/e\.type !== 'task-dispatched' && e\.type !== 'leader-consulted'/.test(src.dispatch)) E("C17 a leader consultation no longer counts against the call and cost ceiling");
  const consult = fnBody(src.orchestrator, "consultLeader");
  if (consult === null || !/\}\);\s*\n\s*const proposal = engine\.propose\(\{ objective, ledger,/.test(consult) || (consult.match(/engine\.propose\(/g) || []).length !== 1 || !/reconcileLedger\(/.test(consult)) {
    E("C18 the leader is consulted inside the store lock or on an unreconciled ledger");
  }

  // ---- D. PROVENANCE AND COUNT EQUALITY ------------------------------------------------------------
  let cfg = null;
  let reg = null;
  let mod = null;
  try {
    cfg = JSON.parse(read(DATA.config) || "null");
    reg = JSON.parse(read(DATA.registry) || "null");
    mod = JSON.parse(read(DATA.models) || "null");
    JSON.parse(read(DATA.selection) || "null");
  } catch {
    E("D0 a workforce governance document is not JSON");
  }
  if (cfg === null || reg === null || mod === null) E("D1 a workforce governance document is missing");
  else {
    const c = cfg.catalogue || {};
    if (c.commit !== PIN.commit || c.expectedAgents !== PIN.agents || c.expectedDivisions !== PIN.divisions || c.licence !== PIN.licence) E("D2 the catalogue pin differs from the owner's ratified pin");
    const entries = Array.isArray(reg.entries) ? reg.entries : [];
    if (entries.length !== PIN.agents) E(`D3 the registry holds ${entries.length} agents, not ${PIN.agents}`);
    if (new Set(entries.map((e) => e.division)).size !== PIN.divisions) E("D4 the registry does not span exactly the pinned divisions");
    if (new Set(entries.map((e) => e.id)).size !== entries.length) E("D5 the registry registers an agent twice");
    const crypto = require("crypto");
    const lines = entries.map((e) => (e.source || {})).map((s) => [s.path, s.digest]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([p, d]) => `${p}\t${d}\n`).join("");
    if (!reg.catalogue || reg.catalogue.catalogueDigest !== crypto.createHash("sha256").update(lines, "utf8").digest("hex")) E("D6 the catalogue digest does not match the registered entries");
    if (!reg.catalogue || reg.catalogue.commit !== PIN.commit || (reg.catalogue.licence || {}).spdx !== PIN.licence) E("D7 the registry provenance does not name the pinned commit and licence");
    const configured = new Set(Object.keys(cfg.roles || {}));
    for (const e of entries) {
      const s = e.source || {};
      if (s.commit !== PIN.commit || !/^[0-9a-f]{64}$/.test(String(s.digest)) || typeof s.path !== "string" || !s.path.startsWith(`${e.division}/`)) {
        E(`D8 entry '${e.id}' lacks pinned provenance`);
        break;
      }
      const t = e.tools || {};
      const sc = e.scopes || {};
      if ((t.allowed || []).length || (sc.read || []).length || (sc.write || []).length || e.costClass !== "high" || e.riskTier !== "high" || e.parallelSafe !== false || e.protectedActionPolicy !== "refuse-all" || (e.modelPreferences || {}).primary !== null) {
        E(`D9 entry '${e.id}' carries more than the restrictive defaults`);
        break;
      }
      const st = (e.eligibility || {}).status;
      if (st === "fixture-eligible" && !configured.has(e.id)) E(`D10 '${e.id}' is eligible without ProjectOS configuration`);
      if (!["ineligible", "restricted", "fixture-eligible"].includes(st)) E(`D11 '${e.id}' has an unknown eligibility status`);
    }
    if (mod.liveExecutionActivated !== false || (mod.models || []).some((m) => m.kind !== "fixture")) E("D12 the model policy activates live execution or names a non-fixture model");
    for (const r of Object.values(cfg.roles || {})) if ((r.writeScopes || []).length > 0) { E("D13 a configured role holds a write scope"); break; }
  }

  // ---- E. STRUCTURED RESULT CONTRACT ---------------------------------------------------------------
  const keys = /const RESULT_KEYS = \[([\s\S]*?)\] as const;/.exec(src.contracts);
  const keyList = keys === null ? [] : keys[1].split(",").map((s) => s.trim().replace(/'/g, "")).filter(Boolean);
  if (JSON.stringify(keyList) !== JSON.stringify(RESULT_FIELDS)) E("E1 the result contract's field set changed");
  if (!/const extra = Object\.keys\(o\)\.filter\(\(k\) => !keys\.includes\(k\)\)/.test(src.contracts)) E("E2 the result contract no longer rejects unknown fields (hidden reasoning, free prose)");
  if (accept === null || accept.search(/validateResult\(/) < 0 || accept.search(/validateResult\(/) > accept.search(/append\('result-recorded'/)) E("E3 a result can be recorded before it is validated");
  if (accept === null || !/r\.status === 'partial' \|\| r\.status === 'failed'/.test(accept)) E("E4 a partial or failed result can be treated as success");
  if (locked === null || !/grant: \{ tools: wantTools, readScopes: wantRead, writeScopes: wantWrite \}/.test(locked)) E("E5 a task is granted more than it requested (least privilege is per task)");

  // ---- F. REVIEW INDEPENDENCE ----------------------------------------------------------------------
  const irs = fnBody(src.review, "independentReviewSatisfied");
  if (irs === null || !/never the final independent reviewer/.test(read(FILES.review) || "") || !/member\.assignment !== 'independent-review'/.test(irs) || !/evidence\.panelId !== null/.test(irs) || !/evidence\.reviewedResults\.length === 0/.test(irs)) {
    E("F1 the leader, a contributor or panel output can satisfy independent review");
  }
  const wsr = fnBody(src.review, "workforceSatisfiesRequiredReview");
  if (wsr === null || !/satisfied: false,/.test(wsr) || /satisfied: true/.test(wsr)) E("F2 workforce evidence can satisfy a plan-required review");

  // ---- G. NO NEW GOVERNANCE ROLE -------------------------------------------------------------------
  const role = /export type Role\s*=\s*([^;]+);/.exec(src.coreTypes);
  const roles = role === null ? null : role[1].split("|").map((s) => s.trim().replace(/'/g, "")).sort();
  if (roles === null || JSON.stringify(roles) !== JSON.stringify(["advisor", "implementer", "owner"])) E("G1 the governance Role union changed — the workforce adds no governance role");
  for (const f of all) {
    if (/actorRole: 'owner'|by: 'owner'|, 'owner', /.test(f.text)) E(`G2 ${f.rel} acts as the owner`);
    if (/export type Role\b/.test(f.text)) E(`G3 ${f.rel} declares a governance role`);
  }

  // ---- H. FIXTURE EXECUTION ONLY -------------------------------------------------------------------
  for (const f of all) {
    if (/\bfetch\(|node:https?'|from 'https?'|node:net'|process\.env\[['"][A-Z_]*(KEY|TOKEN|SECRET)/.test(f.text)) E(`H1 ${f.rel} can reach the network or a credential`);
  }
  if ((src.engines.match(/readonly provider: 'fixture';/g) || []).length !== 2) E("H2 an engine (specialist or leader) may be something other than a fixture");

  for (const t of TESTS) if (read(t) === null) E(`T1 ${t} is missing — the behaviour it proves is no longer proven`);
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-agent-workforce1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log("val-projectos-agent-workforce1a: PASS");
}

module.exports = { run, FILES, DATA, TESTS, PIN };
