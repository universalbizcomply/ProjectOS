"use strict";
// PROJECTOS-HOST-REVIEW-PATH1A — the complete, DORMANT Agent <-> ProjectOSHost unattended review path.
//
// WHAT THIS PINS, in one sentence each:
//   P1  CODE EXISTENCE IS NOT LIVE AUTHORITY. The review IPC capability has NO production mint; the live
//       authority constant is still false; the installed service still starts the status-only loop and
//       nothing calls the review loop; the proof facades refuse the production run identifier.
//   P2  THE FIXED FRAME WAS NOT WIDENED. Request and response payload widths, the frame bound and the
//       closed message-kind set are exactly what the operation contract accepted.
//   P3  THE REVIEW OPERATION IS STILL ENTERED THROUGH THE OWNER'S SIGNATURE. Steps 4-8 stay private, the
//       only other way in is a gated fixture entry, the reviewer's word must match its normalised class
//       BEFORE the attestation mint, and the dispatch classifier has no wildcard arm.
//   P4  THE OUT-OF-BAND SHAPES ARE CLOSED AND CARRY NO SECRET. Both subject structs deny unknown fields
//       and no record field can hold a credential, a prompt, a provider body or reasoning.
//   P5  THE AGENT PATH HAS NO PROVIDER CLIENT, NO CREDENTIAL AND NO FALLBACK. The four agent files of
//       this path reach a local pipe and two derived-name files and nothing else.
//   P6  ONE ENDPOINT. The production transport takes no endpoint; the isolated-test factory is referenced
//       by no shipped source and can name only the test namespace.
//   P7  THE ROUTE IS COMPOSED ONLY FROM THE COMMITTED CONFIGURATION, by all three commands, and absence
//       composes nothing.
//   P8  THE RESERVATION FOLLOWS THE HOST'S DISPATCH FACT, and only `false` releases.
//   P9  THE CROSS-LANGUAGE PROOF IS REAL ON BOTH SIDES: the vector file carries both halves and both
//       suites read it.
//
// STRUCTURAL, comments stripped, and every check is proven non-vacuous by a mutation in the phase record.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const P = (...s) => path.join(ROOT, "projectos", ...s);

function read(p) {
  return fs.readFileSync(p, "utf8").replace(/^﻿/, "");
}
/** Strip block and line comments. Used for Rust and TypeScript alike. */
function strip(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1 ");
}
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "target" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const count = (s, re) => (s.match(re) || []).length;

/** The body of the first `fn name(`...`{ ... }` by brace matching. "" when absent. */
function fnBody(src, name) {
  const at = src.search(new RegExp("\\bfn\\s+" + name + "\\s*[(<]"));
  if (at === -1) return "";
  const open = src.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

function run() {
  const e = [];
  const need = (p) => {
    if (!fs.existsSync(p)) {
      e.push("missing: " + rel(p));
      return false;
    }
    return true;
  };

  const IPC = P("host", "windows-local-ipc", "src");
  const exchangeP = path.join(IPC, "review_exchange.rs");
  const ffiP = path.join(IPC, "windows_ffi.rs");
  const libP = path.join(IPC, "lib.rs");
  const protoP = path.join(IPC, "protocol.rs");
  const opP = P("host", "gatekeeper-attestation", "src", "operation.rs");
  const envP = P("host", "gatekeeper-attestation", "src", "envelope.rs");
  const serveP = P("host", "service-host", "src", "serve.rs");
  const scmP = P("host", "service-host", "src", "scm.rs");
  const dispatchP = P("host", "gatekeeper-review-composition", "src", "review_dispatch.rs");
  const vectorsP = P("contracts", "host-review-path-vectors.v1.json");
  const A = (...s) => P("agent", "src", ...s);
  const clientP = A("loop", "hostReviewClient.ts");
  const transportP = A("loop", "transports", "hostIpcTransport.ts");
  const compositionP = A("loop", "hostReviewComposition.ts");
  const activationP = A("loop", "hostReviewActivation.ts");
  const configP = A("loop", "gatekeeperConfig.ts");
  const all = [exchangeP, ffiP, libP, protoP, opP, envP, serveP, scmP, dispatchP, vectorsP, clientP, transportP, compositionP, activationP, configP];
  if (!all.map(need).every(Boolean)) return e;

  // ---- P1 CODE EXISTENCE IS NOT LIVE AUTHORITY ---------------------------------------------------
  {
    const x = strip(read(exchangeP));
    const decl = /pub struct HostReviewIpcCapability \{([\s\S]*?)\n\}/.exec(x);
    if (!decl) e.push("P1 the review capability is missing");
    else if (/\bpub\b/.test(decl[1])) e.push("P1 the review capability has a public field; the seal is broken");
    if (!/\bstruct ReviewSeal;/.test(x) || /pub(\([^)]*\))?\s+struct ReviewSeal/.test(x)) e.push("P1 the review capability's seal is missing or nameable");
    if (/#\[derive\([^)]*\)\]\s*pub struct HostReviewIpcCapability/.test(x)) e.push("P1 the review capability derives a trait (Default/Clone would mint one)");
    if (/impl\s+(Default|Clone|Copy)\s+for\s+HostReviewIpcCapability|impl\s+From<[^>]*>\s+for\s+HostReviewIpcCapability/.test(x))
      e.push("P1 the review capability gained a conversion or a default");
    // EXACTLY ONE construction, and it sits in the gated fixture impl.
    const crateSrc = walk(IPC, [".rs"])
      .map((f) => strip(read(f)))
      .join("\n")
      // The DECLARATION spells the same tokens as a construction; it is not one.
      .replace(/pub struct HostReviewIpcCapability \{[\s\S]*?\n\}/, " ");
    // PROJECTOS-HOST-REVIEW-PATH1B G5 - THE DECLARED AMENDMENT.
    //
    //   OLD: EXACTLY ONE construction, inside the `test-fixtures` impl, and NO production mint of any
    //        kind - "code existence is not live authority" enforced by there being no mint at all.
    //   NEW: EXACTLY TWO constructions. The second is the PRODUCTION mint the owner ruling
    //        authorised, and it is reachable only by holding a sealed
    //        `VerifiedOwnerProgrammeDelegation` - an ECDSA-P256 signature by the owner over a
    //        domain-separated canonical record, checked against the embedded owner anchor.
    //
    // CODE EXISTENCE IS STILL NOT LIVE AUTHORITY. ProjectOS does not hold the owner's private key and
    // must never hold it, so nothing in this repository can produce that delegation. What changed is
    // that the mint is now a NAMED owner authority instead of an absence.
    const literals = count(crateSrc, /HostReviewIpcCapability\s*\{\s*_sealed|Self\s*\{\s*_sealed:\s*ReviewSeal/g);
    if (literals !== 2)
      e.push(
        "P1 the review capability is constructed in " +
          literals +
          " places; exactly 2 (the gated fixture and the owner-delegation mint) are allowed"
      );
    const gated = /#\[cfg\(feature = "test-fixtures"\)\]\s*impl HostReviewIpcCapability \{([\s\S]*?)\n\}/.exec(x);
    if (!gated || !/Self\s*\{\s*_sealed:\s*ReviewSeal/.test(gated[1])) e.push("P1 the one construction is not inside the test-fixtures impl");

    // THE PRODUCTION MINT, pinned to its one authority.
    const mint = /impl HostReviewIpcCapability \{\s*pub fn from_owner_programme_delegation[\s\S]*?\n\}/.exec(x);
    if (!mint) e.push("P1 the production review-capability mint is missing");
    else {
      const m = mint[0];
      // Its ONLY input is the SEALED verified owner delegation.
      if (
        !/fn from_owner_programme_delegation\(\s*delegation: &crate::operation_contract::VerifiedOwnerProgrammeDelegation,?\s*\)/.test(
          m
        )
      )
        e.push("P1 the review mint takes something other than exactly one sealed owner delegation");
      // It refuses any operation class but the governed review, and refuses a finished delegation.
      if (!/OperationClass::IndependentGatekeeperReview/.test(m))
        e.push("P1 the review mint does not require the independent-gatekeeper-review operation class");
      if (!/ProviderIdentityRead[\s\S]{0,200}StagingRead/.test(m))
        e.push("P1 the review mint does not EXHAUSTIVELY refuse the other operation classes");
      if (!/revoked_or_completed/.test(m))
        e.push("P1 the review mint does not refuse a revoked or completed delegation");
      // IT IS NOT MINTED FROM THE STATUS READ, nor from anything a caller can write down.
      for (const forbidden of [
        "OwnerStatusReadApproval",
        "REQUIRED_PHRASE",
        "std::env",
        "bool",
        "&str",
        "String",
      ]) {
        if (m.includes(forbidden))
          e.push("P1 the review mint references a forbidden source: " + forbidden);
      }
    }

    // NO OTHER ROUTE TO ONE: apart from the two authorised impls, nothing returns the type by name.
    // `from_owner_programme_delegation` returns `Result<Self, _>`, so it is not a by-name return.
    const byName = count(crateSrc, /->\s*(?:crate::review_exchange::)?HostReviewIpcCapability\b/g);
    const inherent = count(x, /\bimpl HostReviewIpcCapability \{/g);
    if (byName !== 0 || inherent !== 2)
      e.push("P1 an UNAUTHORISED route returns a review capability (" + byName + " by name, " + inherent + " inherent impls; expected 0 and 2)");
    // Nothing anywhere in the host tree mints one outside that crate either.
    for (const f of walk(P("host"), [".rs"])) {
      if (f.startsWith(IPC)) continue;
      if (/\/tests\//.test(rel(f)) || /_tests\.rs$/.test(f)) continue;
      if (/HostReviewIpcCapability::synthetic_for_fixture/.test(strip(read(f)))) e.push("P1 a shipped source obtains the fixture capability: " + rel(f));
    }

    const lib = strip(read(libP));
    if (!/pub const LIVE_LOCAL_IPC_AUTHORISED: bool = false;/.test(lib)) e.push("P1 LIVE_LOCAL_IPC_AUTHORISED is no longer false");

    const ffi = strip(read(ffiP));
    const refusals = count(ffi, /pub fn for_isolated_test_run\(run_id: \[u8; 8\]\) -> Option<Self> \{\s*if run_id == crate::protocol::INSTALLED_HOST_STATUS_RUN_ID \{\s*return None;/g);
    if (refusals !== 2) e.push("P1 " + refusals + " of the 2 isolated-test facades refuse the production run identifier");
    if (!/#\[cfg\(feature = "test-fixtures"\)\]\s*pub struct WindowsHostReviewTestClient/.test(ffi)) e.push("P1 the proof-only review client is not confined to test-fixtures");
    const serveFn = fnBody(ffi, "serve_one_exchange");
    if (!/review: &crate::review_exchange::HostReviewIpcCapability/.test(ffi.slice(ffi.indexOf("pub fn serve_one_exchange"), ffi.indexOf("pub fn serve_one_exchange") + 400)))
      e.push("P1 the review server facade no longer demands the review capability");
    const order = ["prepare_server(", "accept_unauthenticated(", "complete_service_handshake(", "send_installed_host_status(", "serve_review_request("];
    let at = -1;
    for (const step of order) {
      const i = serveFn.indexOf(step);
      if (i === -1 || i < at) {
        e.push("P1 the review exchange no longer runs the four accepted status steps, in order, before the review half (at " + step + ")");
        break;
      }
      at = i;
    }

    const serve = strip(read(serveP));
    const scm = strip(read(scmP));
    if (!/serve::serve_installed_host_status_until_stop\(&STOP_SIGNALLED\)/.test(scm)) e.push("P1 the SCM entry no longer starts the status-only loop");
    const serviceSrc = walk(P("host", "service-host", "src"), [".rs"]).map((f) => strip(read(f))).join("\n");
    if (count(serviceSrc, /serve_status_and_reviews_until_stop/g) !== 1) e.push("P1 the dormant review loop is CALLED somewhere in the installed service");
    if (!/pub fn serve_status_and_reviews_until_stop\(\s*stop: &AtomicBool,\s*review: &HostReviewIpcCapability,/.test(serve))
      e.push("P1 the review loop no longer demands the review capability");
    if (count(serviceSrc, /ProtectedOperationsReport::Authorised/g) !== 1 || !/fn accepting_reviews\(/.test(serve))
      e.push("P1 a status record can say Authorised outside the review-serving loop");
  }

  // ---- P2 THE FIXED FRAME WAS NOT WIDENED --------------------------------------------------------
  {
    const proto = strip(read(protoP));
    for (const [re, what] of [
      [/pub const PROTECTED_OPERATION_REQUEST_LEN: usize = 16 \+ 8 \+ 8 \+ 32 \+ 1 \+ 32 \+ 32;/, "request payload width"],
      [/pub const PROTECTED_OPERATION_RESPONSE_LEN: usize = 16 \+ 1 \+ 1 \+ 1 \+ 8 \+ 16 \+ 1;/, "response payload width"],
      [/pub const MAX_FRAME_SIZE: usize = 512;/, "frame bound"],
      [/pub const NONCE_LEN: usize = 32;/, "nonce width"],
    ])
      if (!re.test(proto)) e.push("P2 the fixed frame changed: " + what);
    const kinds = /pub enum MessageKind \{([\s\S]*?)\n\}/.exec(proto);
    const n = kinds ? count(kinds[1], /^\s{4}[A-Z]\w+,/gm) : 0;
    if (n !== 10) e.push("P2 the closed message-kind set has " + n + " kinds; the accepted set is 10");
    const x = strip(read(exchangeP));
    for (const bad of [/\bString\b/, /Vec<\s*u8\s*>/, /serde/, /PathBuf|&Path\b/])
      if (bad.test(x.split("pub mod loopback")[0])) e.push("P2 the shipped review exchange handles text, bytes, JSON or a path: " + bad);
  }

  // ---- P3 THE REVIEW OPERATION -------------------------------------------------------------------
  {
    const op = strip(read(opP));
    if (/pub(\([^)]*\))?\s+fn\s+execute_and_attest/.test(op)) e.push("P3 steps 4-8 are reachable without the manifest signature");
    if (!/#\[cfg\(any\(test, feature = "test-fixtures"\)\)\]\s*pub fn run_gatekeeper_review_attested_for_fixture/.test(op)) e.push("P3 the fixture entry to steps 4-8 is missing or ungated");
    const gated = fnBody(op, "execute_and_attest_gated");
    const iVerdict = gated.indexOf("normalised_verdict(");
    const iMint = gated.search(/HostAttestation\s*(::\w+\s*\(|\{)/);
    if (iVerdict === -1) e.push("P3 the reviewer's word is no longer compared with its normalised class");
    else if (iMint !== -1 && iMint < iVerdict) e.push("P3 the attestation is minted BEFORE the verdict pair is checked");
    const iGate = gated.indexOf("subject_gate(");
    const iExec = gated.search(/\.execute\(/);
    if (iGate === -1 || iExec === -1 || iExec < iGate) e.push("P3 the subject gate no longer runs before execution");
    const dispatched = fnBody(op, "provider_may_have_been_dispatched");
    if (dispatched === "") e.push("P3 the dispatch classifier is missing");
    else if (/\n\s*_\s*=>/.test(dispatched)) e.push("P3 the dispatch classifier has a wildcard arm; a new refusal would be classified by default");
    if (!/CredentialUnavailable\s*\)?\s*=>\s*false|CredentialUnavailable[\s\S]{0,80}=>\s*false/.test(dispatched)) e.push("P3 a credential that could not be resolved is no longer 'not dispatched'");
  }

  // ---- P4 THE OUT-OF-BAND SHAPES -----------------------------------------------------------------
  {
    const env = strip(read(envP));
    for (const s of ["DeclaredBindings", "ReviewSubject"]) {
      const re = new RegExp("#\\[serde\\(deny_unknown_fields[^\\]]*\\)\\]\\s*pub struct " + s + "\\b");
      if (!re.test(env)) e.push("P4 " + s + " does not deny unknown fields");
    }
    const views = env.slice(env.indexOf("struct DecisionView"), env.indexOf("pub fn review_verdict_name"));
    if (views.length < 200) e.push("P4 the response record views were not found (the scan matched nothing)");
    const secretField = /\b(credential|token|api_key|secret|password|prompt|provider_request|provider_body|raw_\w+|reasoning)\s*:/g;
    for (const m of views.match(secretField) || []) e.push("P4 a response-record view has a field that could carry a secret or provider text: " + m);
    if (!/verify_declared_bindings/.test(env) || !/committed_candidate_digest\(&d\.subject_commit\) == Some\(ctx\.candidate_digest\)/.test(env))
      e.push("P4 the declared candidate is no longer compared with the Host's pinned candidate");
    const dispatch = strip(read(dispatchP));
    if (/create_dir|set_permissions|remove_dir/.test(dispatch)) e.push("P4 a Host review store adapter creates or removes a directory, or changes a permission");
    // THE HANDLE IS JUDGED, NEVER THE NAME: no by-name open of a request, and both opens refuse to follow.
    if (/File::open\(/.test(dispatch) || count(dispatch, /do_not_follow\(&mut options\);/g) !== 2 || !/file\.metadata\(\)\.ok\(\)\?\.file_type\(\)\.is_file\(\)/.test(dispatch))
      e.push("P4 a Host review store adapter opens by name or follows a link (check-then-open)");
    const iEpoch = dispatch.indexOf("epoch_refusal(request");
    const iRead = dispatch.indexOf("RetainedRequestInbox::over(");
    if (iEpoch === -1 || iRead === -1 || iEpoch > iRead) e.push("P4 the stale-epoch refusal no longer runs before the subject is read");
  }

  // ---- P5 NO PROVIDER CLIENT, NO CREDENTIAL, NO FALLBACK -----------------------------------------
  {
    for (const f of [clientP, transportP, compositionP, activationP]) {
      const s = strip(read(f));
      for (const [re, what] of [
        [/\bfetch\s*\(|node:https?|from 'undici'|XMLHttpRequest/, "an HTTP client"],
        [/https?:\/\//, "a URL"],
        [/Authorization|Bearer\s|apiKey|api_key/i, "a credential header or key"],
        [/submitToOpenAi|submitClosureRequest|nodeHttpPort|brokeredHttpPort|openaiResponses|closureResponses/, "the in-process provider route"],
        [/interactiveGatekeeper|gatekeeperHandoff|nodeInteractivePort|rehearsalReviewer/, "an interactive or rehearsal fallback"],
        [/credentialResolver|resolveCredential|unprovisionedResolver/, "a credential resolver"],
      ])
        if (re.test(s)) e.push("P5 " + rel(f) + " references " + what);
      // NO ENVIRONMENT READ AT ALL. A per-user variable overrides the machine's, so anything read from
      // the environment here is chosen by the tier this route must be independent of.
      if (/process\.env\b/.test(s)) e.push("P5 " + rel(f) + " reads the environment; the Host route takes nothing from it");
    }
    const client = strip(read(clientP));
    if (!/committedCandidateDigest\(input\.subjectCommit\)/.test(client)) e.push("P5 the candidate claim is no longer the COMMITTED subject");
    if (/candidateDigest\s*\(|computeCandidateIdentity/.test(client)) e.push("P5 a working-tree candidate identity is substituted for the committed one");
    const unavailable = count(client, /unavailable\('[A-Z_]+',\s*(true|false)/g);
    const calls = count(client, /\bunavailable\(/g) - 1; // minus the definition
    if (unavailable !== calls || calls < 10) e.push("P5 an unavailability does not state its dispatch fact literally (" + unavailable + " of " + calls + ")");
    // ONE DISCOVERY ROUND: the exchange is invoked at exactly two call sites, the second guarded by a plain
    // `if`, and the client contains no loop at all through which it could be invoked a third time.
    const exchangeCalls = count(client, /\bexchangeOnce\(knownEpoch\)/g);
    if (exchangeCalls !== 2 || !/if \(ended\.kind === 'epoch'\) \{\s*knownEpoch = ended\.epoch;\s*ended = exchangeOnce\(knownEpoch\);/.test(client) || /\bwhile\s*\(|\bfor\s*\(|\bdo\s*\{/.test(client))
      e.push("P5 epoch discovery is no longer bounded to ONE retry (" + exchangeCalls + " call sites, or a loop)");
  }

  // ---- P6 ONE ENDPOINT ---------------------------------------------------------------------------
  {
    const t = read(transportP);
    if (!/export const INSTALLED_HOST_ENDPOINT = '\\\\\\\\\.\\\\pipe\\\\ProjectOS\.Host';/.test(t)) e.push("P6 the installed Host endpoint is not the one fixed pipe");
    if (!/export function nodeHostIpcTransport\(\): HostIpcTransport/.test(strip(t))) e.push("P6 the production transport takes a parameter; an endpoint could be supplied");
    if (!/export const INSTALLED_HOST_STATE_ROOT = 'C:\\\\ProgramData\\\\ProjectOS\\\\host';/.test(t) || !/transport\(INSTALLED_HOST_ENDPOINT, INSTALLED_HOST_RUN_ID, INSTALLED_HOST_STATE_ROOT\)/.test(strip(t)))
      e.push("P6 the production state root is not the one fixed directory");
    if (!/const TEST_ENDPOINT = \/\^\\\\\\\\\\\.\\\\pipe\\\\ProjectOS\\\.Test\\\./.test(t)) e.push("P6 the isolated-test namespace rule is missing");
    if (!/input\.runId\.equals\(INSTALLED_HOST_RUN_ID\)/.test(strip(t))) e.push("P6 the isolated-test factory no longer refuses the installed Host run identifier");
    for (const f of walk(P("agent", "src"), [".ts"])) {
      const s = strip(read(f));
      if (f !== transportP && /nodeHostIpcTransportForIsolatedTest/.test(s)) e.push("P6 a shipped source references the isolated-test transport: " + rel(f));
      if (f !== transportP && /\\\\\\\\\.\\\\pipe\\\\/.test(read(f))) e.push("P6 a second pipe literal exists in the agent: " + rel(f));
    }
  }

  // ---- P7 COMPOSED ONLY FROM THE COMMITTED CONFIGURATION -----------------------------------------
  {
    const a = strip(read(activationP));
    if (!/readCommittedJson\(sys, root, GATEKEEPER_CONFIG_REL\)/.test(a)) e.push("P7 the activation is not read from the COMMITTED configuration");
    if (!/JSON\.stringify\(working\) !== JSON\.stringify\(committedBlock\)/.test(a)) e.push("P7 a working copy that disagrees with the committed block is no longer refused");
    if (!/export const HOST_REVIEW_TRANSPORT = 'projectos-host-local-ipc';/.test(a) || !/if \(block\['transport'\] !== HOST_REVIEW_TRANSPORT\) \{/.test(a) || count(a, /block\['transport'\]/g) !== 1)
      e.push("P7 a second Host transport name is representable");
    const c = strip(read(compositionP));
    if (!/if \(loaded\.kind === 'absent'\) return \{ kind: 'none' \};/.test(c)) e.push("P7 an absent activation no longer composes nothing");
    if (!/if \(loaded\.kind === 'invalid'\)[\s\S]{0,80}kind: 'refused'/.test(c)) e.push("P7 a broken activation is no longer a refusal");
    const runTs = strip(read(A("commands", "run.ts")));
    const closureTs = strip(read(A("commands", "closure.ts")));
    const reconcileTs = strip(read(A("commands", "reconcile.ts")));
    if (!/composeHostReview\(ctx\.sys, ctx\.root\)/.test(runTs)) e.push("P7 `run` does not compose the Host route from the committed configuration");
    if (!/composeHostReview\(sys, root\)/.test(closureTs)) e.push("P7 `closure` does not compose the Host route from the committed configuration");
    if (!/composeGatekeeper\(ctx,/.test(reconcileTs)) e.push("P7 `reconcile` no longer goes through the one composition");
    for (const [name, s] of [["run", runTs], ["closure", closureTs], ["reconcile", reconcileTs]])
      if (/nodeHostIpcTransport|hostReviewClient\(/.test(s)) e.push("P7 `" + name + "` builds a Host client itself instead of through the one composer");
  }

  // ---- P8 THE RESERVATION FOLLOWS THE DISPATCH FACT ----------------------------------------------
  {
    const cfg = strip(read(configP));
    const body = /export function settleUnansweredGatekeeperSpend\([\s\S]*?\n\}/.exec(cfg);
    if (!body) e.push("P8 the settlement rule is missing");
    else {
      if (!/if \(providerDispatched === false\) \{\s*releaseUndispatchedReservation\(sys, root, requestId\);\s*return;/.test(body[0])) e.push("P8 a Host-stated 'not dispatched' no longer releases through the usage-preserving release");
      if (!/if \(providerDispatched === true\) return;/.test(body[0])) e.push("P8 a Host-stated 'dispatched' no longer retains");
      if (!/resolveGatekeeperSpend\(sys, root, requestId, cause, answered\)/.test(body[0])) e.push("P8 the accepted cause-based rule is no longer the default");
    }
    const release = /export function releaseUndispatchedReservation\([\s\S]*?\n\}/.exec(cfg);
    if (!release || !/entry\.usage\.inputTokens !== 0 \|\| entry\.usage\.outputTokens !== 0\) return;/.test(release[0])) e.push("P8 the release no longer spares an entry carrying recorded usage");
    for (const f of ["run.ts", "closure.ts", "reconcile.ts"]) {
      const s = strip(read(A("commands", f)));
      if (!/settleUnansweredGatekeeperSpend\(/.test(s)) e.push("P8 `" + f + "` does not settle through the dispatch-aware rule");
      if (/\bresolveGatekeeperSpend\(/.test(s)) e.push("P8 `" + f + "` still settles around the dispatch-aware rule");
    }
    for (const f of [A("loop", "gatekeeperTurn.ts"), A("loop", "reconciliation.ts"), A("loop", "closureTurn.ts")]) {
      if (!/\.providerDispatched,?\s*\)/.test(strip(read(f)))) e.push("P8 " + rel(f) + " does not hand the dispatch fact to the settlement port");
    }
  }

  // ---- P9 THE CROSS-LANGUAGE PROOF ---------------------------------------------------------------
  {
    let v = null;
    try {
      v = JSON.parse(read(vectorsP));
    } catch {
      e.push("P9 the vector file is not JSON");
    }
    if (v !== null) {
      if (v.contract !== "projectos.host-review-path-vectors.v1") e.push("P9 the vector file is not the v1 contract");
      const asks = ((v.agent && v.agent.exchanges) || []).map((x) => x.ask).sort().join(",");
      if (asks !== "closure,gatekeeper") e.push("P9 the agent half does not cover both asks: " + asks);
      const host = v.host || {};
      if (!Array.isArray(host.attested) || host.attested.length !== 2 || !host.failedDispatched || !host.failedNotDispatched) e.push("P9 the Host half is absent or incomplete");
      for (const x of [...(host.attested || []), host.failedDispatched, host.failedNotDispatched].filter(Boolean)) {
        if (!/^[0-9a-f]{170}$/.test(x.responseFrameHex || "")) e.push("P9 a recorded response frame is not exactly 85 bytes");
        if (typeof x.responseRecord !== "string" || x.responseRecord.length < 50) e.push("P9 a recorded response record is missing");
      }
      for (const x of (v.agent && v.agent.exchanges) || []) if (!/^[0-9a-f]{340}$/.test(x.requestFrameHex || "")) e.push("P9 a recorded request frame is not exactly 170 bytes");
    }
    const rustVec = P("host", "windows-local-ipc", "src", "operation_contract", "host_composition", "review_vectors_tests.rs");
    const tsVec = P("core", "test", "host-review-path-vectors.test.ts");
    if (need(rustVec) && !/include_str!\("[^"]*host-review-path-vectors\.v1\.json"\)/.test(read(rustVec))) e.push("P9 the Rust suite does not read the vector file");
    if (need(tsVec) && !/host-review-path-vectors\.v1\.json/.test(read(tsVec))) e.push("P9 the TypeScript suite does not read the vector file");
    if (fs.existsSync(rustVec) && !/compose_verified\(/.test(read(rustVec))) e.push("P9 the Rust vector proof no longer runs the real composition");
  }

  // ---- P10 THE FRAMED-EVIDENCE INVARIANT — DECLARED AMENDMENT, PROJECTOS-HOST-REVIEW-PATH1B --------
  //
  //   OLD: the review subject is the agent-written provider request bound by its parameter digest, and
  //        this validator pinned nothing about evidence (P1-P9 above are the PATH1A shape).
  //   NEW (ratified host-review-path amendment): the reviewer input is the HOST-FRAMED evidence
  //   envelope; the host-established block is derived by the Host alone from the approved baseline to
  //   the pinned candidate; the SAME canonical bytes that are hashed are the bytes inserted between the
  //   Host markers; the agent-claimed block is labelled not host verified; evidence of another commit or
  //   another baseline refuses BEFORE any execution; the execution port receives the HOST-authored
  //   request built over that frame; and the attestation binds the baseline and the evidence digest.
  {
    const evP = P("host", "gatekeeper-attestation", "src", "candidate_evidence.rs");
    if (need(evP)) {
      const op = strip(read(opP));
      const ev = strip(read(evP));
      const env = strip(read(envP));

      // (a) HASHED == INSERTED: one slice, taken once. The frame body must take `canonical_bytes()`
      //     ONCE, insert exactly that value, and hash exactly that value.
      const frame = fnBody(ev, "frame");
      if (frame === "") e.push("P10 FramedReviewInput::frame is missing");
      else {
        if (!/let established = evidence\.canonical_bytes\(\);/.test(frame)) e.push("P10 the frame no longer takes the canonical bytes exactly once");
        if (!/bytes\.extend_from_slice\(&established\);/.test(frame)) e.push("P10 the frame no longer inserts the canonical bytes verbatim");
        if (!/Sha256::digest\(&established\)/.test(frame)) e.push("P10 the evidence digest is no longer the digest of the inserted bytes");
        if (count(frame, /canonical_bytes\(\)/g) !== 1) e.push("P10 the frame reads the canonical bytes more than once - hashed and shown could diverge");
        if (!/Err\(EvidenceRefusal::MarkerCollision\)/.test(frame)) e.push("P10 a marker occurring in either block no longer refuses");
      }
      if (!/pub fn evidence_bytes\(&self\) -> &\[u8\] \{\s*&self\.bytes\[self\.evidence_at\.clone\(\)\]/.test(ev))
        e.push("P10 evidence_bytes no longer returns the inserted slice itself");
      if (!/BEGIN AGENT-CLAIMED NOT HOST VERIFIED \{marker_hex\}/.test(ev)) e.push("P10 the agent-claimed block is no longer labelled NOT HOST VERIFIED");
      if (!/It is NOT HOST VERIFIED/.test(read(evP))) e.push("P10 the reviewer instructions no longer state the agent block is unverified");

      // (b) THE BINDING GATE, before any execution: evidence of this candidate from this baseline only.
      const entry = fnBody(op, "run_gatekeeper_review_bound");
      const body = entry !== "" ? entry : op;
      const iBind = body.search(/committed_candidate_digest\(evidence\.candidate\(\)\) != Some\(ctx\.candidate_digest\)\s*\|\|\s*evidence\.baseline\(\) != baseline/);
      if (iBind === -1) e.push("P10 the evidence-binding refusal (other candidate OR other baseline) is gone");
      if (!/return Err\(HostRefusal::EvidenceBindingRefused\);/.test(body)) e.push("P10 EvidenceBindingRefused is no longer returned");
      const iExec = body.search(/\.execute\(&request\)/);
      if (iExec === -1) e.push("P10 the execution port no longer receives the HOST-authored request");
      if (iBind !== -1 && iExec !== -1 && iBind > iExec) e.push("P10 the evidence binding is checked AFTER execution");
      if (!/HostProviderRequest::build\(policy, &parsed, framed\)/.test(body)) e.push("P10 the provider request is no longer built over the framed evidence");
      // Not dispatched: a binding refusal must never read as "a provider may have seen this".
      if (!/\|\s*Self::EvidenceBindingRefused/.test(op) || !/provider_may_have_been_dispatched/.test(op))
        e.push("P10 EvidenceBindingRefused is no longer classified as never-dispatched");

      // (c) THE ATTESTATION BINDS baseline + evidence digest (schema 2, both in the derived id).
      if (!/ATTESTATION_SCHEMA_VERSION: u32 = 2/.test(op)) e.push("P10 the attestation schema is no longer revision 2");
      const derive = fnBody(op, "derive_id");
      if (!/baseline_commit/.test(derive) || !/evidence_digest/.test(derive)) e.push("P10 the attestation id no longer covers the baseline and the evidence digest");
      // The view spells snake_case; serde's camelCase rename is what puts baselineCommit/evidenceDigest
      // on the wire, so BOTH the fields and the rename are required.
      if (!/baseline_commit: hex\(a\.baseline_commit\(\)\)/.test(env) || !/evidence_digest: hex\(a\.evidence_digest\(\)\)/.test(env) || !/rename_all = "camelCase"/.test(env))
        e.push("P10 the attestation view no longer carries baselineCommit/evidenceDigest");

      // (d) THE AGENT REFUSES an attestation whose evidence it cannot reproduce (criterion 10).
      const tsEnvP = P("core", "src", "hostReviewEnvelope.ts");
      if (need(tsEnvP)) {
        const tsEnv = strip(read(tsEnvP));
        for (const [re, what] of [
          [/evidence the agent cannot reproduce/, "the other-evidence refusal"],
          [/different baseline/, "the other-baseline refusal"],
          [/does not bind candidate evidence/, "the revision-1 refusal"],
        ]) {
          if (!re.test(tsEnv)) e.push("P10 the agent-side record reader lost " + what);
        }
      }
    }
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((m) => console.error("[val-projectos-host-review-path1a] FAIL: " + m));
    process.exit(1);
  }
  console.log("val-projectos-host-review-path1a: PASS");
}
