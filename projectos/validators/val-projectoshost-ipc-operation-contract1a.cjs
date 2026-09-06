// Validator: PROJECTOSHOST-IPC-OPERATION-CONTRACT1A (F2/F3 phase 1)
//
// Fails closed. Pins the protected-operation contract so a later change cannot silently make the wire
// able to carry a secret, let caller data become authority, or open a path to a protected effect while
// C4 is still open.
//
// The threat each assertion answers:
//   O1  the contract module exists at the committed path
//   O2  the wire is SECRET-FREE BY CONSTRUCTION - no String, Vec<u8>, map, serde or free-form text, so a
//       credential/token/cookie/key/command/path is not merely rejected but unrepresentable
//   O3  no generic payload accessor exists (the same rule the status contract already enforces)
//   O4  both payload lengths are fixed constants and fit the accepted 471-byte ceiling
//   O5  the C4 gate cannot report closed - one variant, is_closed() returns false unconditionally
//   O6  evaluation checks C4 FIRST, so no later check can be failed into an acceptance
//   O7  TrustedPeerContext is minted ONLY from the sealed canonical peer admission - never from
//       caller data, a boolean, or the public verdict enum
//   O8  the trusted types are sealed against struct-literal fabrication
//   O9  Completed/Accepted require the host-held authority, so a caller cannot assert an effect ran
//   O10 InstalledHostStatus is NOT overloaded - its kind, discriminant and length are untouched
//   O11 the protected-operation kinds are registered with fixed discriminants and lengths
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const PROTOCOL = path.join(IPC, "protocol.rs");

/**
 * Strip line comments and doc comments before any "token must be absent" check, so prose describing a
 * forbidden construct can never fail the build and, more importantly, a forbidden construct can never
 * hide behind a comment.
 */
function stripComments(rust) {
  return rust
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    })
    .join("\n");
}

/**
 * Whitespace collapsed onto one line, so a check cannot be defeated by where rustfmt happens to
 * wrap. Any pattern using this must bound itself (e.g. `[^{;]`) rather than relying on newlines.
 */
function flatten(src) {
  return src.replace(/\s+/g, " ");
}

/**
 * The inside of the `{ .. }` that follows `header`, by BRACE BALANCING rather than by splitting on
 * the first newline-plus-close-brace.
 *
 * `split(/\n}/)[0]` reads only as far as the first closing brace at column 0, so a
 * deliberately or accidentally mis-indented brace inside the block truncates the scan and hides
 * everything after it from every check that consumes the body. Balancing is not parsing Rust - it
 * makes no claim about strings or char literals containing braces, which the scanned declarations
 * do not have - but it does mean indentation no longer decides what the controls can see.
 */
function blockBody(src, header) {
  const at = src.indexOf(header);
  if (at === -1) return "";
  const open = src.indexOf("{", at);
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1); // unbalanced: hand back the rest, so nothing hides in the tail
}

/** The body of a function, from its signature to the next top-level `}`. */
function fnBody(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const rest = src.slice(at);
  const end = rest.indexOf("\n}");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The attribute blocks immediately above a declaration, joined and whitespace-collapsed.
 *
 * A BALANCED-BRACKET SCAN, NOT A PER-LINE PREFIX TEST. The line-based version this replaces walked
 * upward accepting only lines whose trimmed text began with `#[`, and stopped at the first line that
 * did not. A rustfmt-wrapped attribute -
 *
 *     #[derive(
 *         Debug,
 *         Clone,
 *     )]
 *     pub struct Sealed { .. }
 *
 * - puts `)]` immediately above the declaration, which fails that test, so the scan returned nothing
 * and EVERY derive check downstream of it silently passed. rustfmt wraps automatically once a derive
 * list outgrows the line budget, so that was a regression waiting to happen rather than a hypothetical.
 * Raised by the ECC security review.
 */
function attrsAbove(src, decl) {
  const at = src.indexOf(decl);
  if (at === -1) return "";
  let cursor = at;
  let collected = "";
  for (;;) {
    let j = cursor - 1;
    while (j >= 0 && /\s/.test(src[j])) j--;
    if (j < 0 || src[j] !== "]") break; // not an attribute close: stop
    let depth = 0;
    let k = j;
    for (; k >= 0; k--) {
      if (src[k] === "]") depth++;
      else if (src[k] === "[") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (k < 1 || src[k - 1] !== "#") break; // `[..]` not preceded by `#`: not an attribute
    collected = src.slice(k - 1, j + 1) + " " + collected;
    cursor = k - 1;
  }
  return collected.replace(/\s+/g, " ").trim();
}

function run() {
  const e = [];

  // O1
  if (!fs.existsSync(CONTRACT)) {
    e.push("O1 the protected-operation contract module is missing: windows-local-ipc/src/operation_contract.rs");
    return e;
  }
  if (!fs.existsSync(PROTOCOL)) {
    e.push("O1 protocol.rs is missing");
    return e;
  }
  const contractRaw = fs.readFileSync(CONTRACT, "utf8");
  const contract = stripComments(contractRaw);
  const protocol = stripComments(fs.readFileSync(PROTOCOL, "utf8"));

  // O2 - secret-free by construction. These are the shapes that could carry an unbounded or free-form
  // value. Absent from the contract module, a secret cannot be spelled on this wire.
  for (const bad of ["String", "Vec<u8>", "HashMap", "BTreeMap", "serde", "&str"]) {
    if (contract.includes(bad)) {
      e.push("O2 the operation contract gained a free-form or unbounded shape, so the wire is no longer secret-free: " + bad);
    }
  }

  // O3 - no generic payload accessor, matching the rule the status contract already enforces.
  for (const re of [/pub fn payload\s*\(/, /pub fn payload_bytes\s*\(/, /pub fn body\s*\(/, /pub fn as_bytes\s*\(/, /->\s*&\[u8\]/]) {
    if (re.test(contract)) e.push("O3 a generic payload accessor is exposed on the operation contract: " + re);
  }

  // O4 - fixed lengths, within the accepted ceiling, pinned at compile time.
  if (!/pub const PROTECTED_OPERATION_REQUEST_LEN: usize =/.test(protocol)) {
    e.push("O4 PROTECTED_OPERATION_REQUEST_LEN is not defined in protocol.rs");
  }
  if (!/pub const PROTECTED_OPERATION_RESPONSE_LEN: usize =/.test(protocol)) {
    e.push("O4 PROTECTED_OPERATION_RESPONSE_LEN is not defined in protocol.rs");
  }
  if (!/const _: \(\) = assert!\(PROTECTED_OPERATION_REQUEST_LEN <= MAX_PAYLOAD_LEN\);/.test(protocol)) {
    e.push("O4 the compile-time ceiling check for the request payload is gone");
  }
  if (!/const _: \(\) = assert!\(PROTECTED_OPERATION_RESPONSE_LEN <= MAX_PAYLOAD_LEN\);/.test(protocol)) {
    e.push("O4 the compile-time ceiling check for the response payload is gone");
  }

  // O5 - the C4 hard stop. One variant, and is_closed can only return false.
  if (!/pub enum OwnerPresenceGate \{\s*Open,\s*\}/.test(contract.replace(/\s+/g, " ").replace(/pub enum OwnerPresenceGate \{ Open, \}/, "pub enum OwnerPresenceGate {\n Open,\n}"))) {
    // Fall back to a direct structural check: exactly one variant named Open.
    const body = fnBody(contract, "pub enum OwnerPresenceGate");
    if (!body || !/\bOpen\b/.test(body) || /\bClosed\b/.test(body)) {
      e.push("O5 OwnerPresenceGate is no longer a single open variant");
    }
  }
  const isClosed = fnBody(contract, "pub fn is_closed(self) -> bool");
  if (!isClosed) {
    e.push("O5 OwnerPresenceGate::is_closed is missing");
  } else if (!/\bfalse\b/.test(isClosed) || /\btrue\b/.test(isClosed)) {
    e.push("O5 OwnerPresenceGate::is_closed no longer returns false unconditionally - the C4 hard stop is defeated");
  }

  // O6 - C4 is evaluated FIRST. Anything checked before it could be failed into bypassing it.
  const evalBody = fnBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("O6 evaluate_protected_operation is missing");
  } else {
    const gateAt = evalBody.indexOf("OwnerPresenceGate::current()");
    const peerAt = evalBody.indexOf("peer.is_none()");
    const epochAt = evalBody.indexOf("claimed_service_epoch()");
    if (gateAt === -1) {
      e.push("O6 evaluate_protected_operation no longer consults the C4 gate");
    }
    if (peerAt !== -1 && gateAt !== -1 && peerAt < gateAt) {
      e.push("O6 the peer check precedes the C4 gate; C4 must be checked first");
    }
    if (epochAt !== -1 && gateAt !== -1 && epochAt < gateAt) {
      e.push("O6 the epoch check precedes the C4 gate; C4 must be checked first");
    }
    // No path may mint an acceptance in this phase.
    if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(evalBody)) {
      e.push("O6 evaluate_protected_operation can return an accepted or completed state while C4 is open");
    }
  }

  // O7 - TrustedPeerContext may be minted ONLY from the sealed canonical peer admission.
  //
  // AMENDMENT (RUN-TO-COMPLETION HOST ATTESTATION - AUTHORITY REACHABILITY, gate-authorised).
  // O7 originally required NO constructor at all, because kernel-attested peer identity was a later
  // phase. That phase has now arrived, so the rule changes shape rather than disappearing: the
  // absence of a constructor is replaced by a constraint on WHICH constructor may exist. What must
  // never come back is a constructor a caller can satisfy from data it holds - the whole point is
  // that a peer is established by a completed canonical attempt, never asserted.
  if (!/pub struct TrustedPeerContext/.test(contract)) {
    e.push("O7 TrustedPeerContext is missing");
  }
  {
    // THE SCAN MUST COVER THE WHOLE TYPE, NOT THE FIRST BLOCK OF IT. Splitting on the first
    // `impl TrustedPeerContext {` and taking segment [1] reads only ONE inherent block: a second
    // block appended anywhere else in the file lands in segment [2] and was invisible, and a trait
    // impl (`impl From<(u64, u64)> for TrustedPeerContext`) never matched the split token at all.
    // Both bypasses were demonstrated against this very check. Rather than trying to parse every
    // block, the shape is PINNED: exactly one inherent block, and no trait impl for the type. A
    // second block is then a validator failure rather than a blind spot.
    const inherentBlocks = (contract.match(/impl TrustedPeerContext\s*\{/g) || []).length;
    if (inherentBlocks !== 1) {
      e.push("O7 expected exactly one `impl TrustedPeerContext` block, found " + inherentBlocks + "; the public-function enumeration below only covers one");
    }
    if (/impl(?:<[^>]*>)?\s+[^\n]*\bfor\s+TrustedPeerContext\b/.test(contract)) {
      e.push("O7 a trait impl for TrustedPeerContext exists; a trait could mint the type outside the enumerated block");
    }
    const impls = contract.split(/impl TrustedPeerContext\s*\{/)[1] || "";
    const body = impls.split(/\n\}/)[0];
    // AN ALLOWLIST, NOT A DENYLIST. Enumerating known-bad constructor names would pass anything
    // spelled differently - `from_ids(connection_id: u64, handshake_generation: u64)` names nothing
    // forbidden and would have sailed through. So every public function on the type is enumerated
    // and checked against the closed set that is allowed to exist; a new one fails until it is
    // ruled on by name.
    const ALLOWED = new Set([
      "from_verified_peer_admission", // the ONE mint: consumes the sealed canonical admission
      "connection_id", // read-only accessor
      "handshake_generation", // read-only accessor
      "is_bound_to", // read-only comparison
    ]);
    // GENERICS TOLERATED. `pub fn evil<T>(flag: bool)` put a `<...>` between the name and the paren,
    // so the old regex matched nothing and the function escaped both this enumeration AND the
    // bool/verdict checks below. Also demonstrated against this check.
    const publicFns = [...body.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
    for (const name of publicFns) {
      if (!ALLOWED.has(name)) {
        e.push("O7 TrustedPeerContext gained an unruled public function `" + name + "`; a peer must be proven, not asserted");
      }
    }
    // The ONE permitted mint MUST exist and MUST consume the sealed admission. Asserted rather than
    // checked-if-present: if it disappears or is reshaped, that is exactly when O7 must speak up.
    if (!/pub fn from_verified_peer_admission\s*\(\s*admission\s*:\s*&[^)]*VerifiedPeerAdmission\s*,?\s*\)/.test(body)) {
      e.push("O7 the sealed peer-admission mint is missing or no longer consumes a &VerifiedPeerAdmission");
    } else {
      // THE CALLS MUST BE THE FIELD VALUES, not merely present somewhere in the body. Checking that
      // `admission.connection_id()` appears anywhere was satisfied by
      // `let _ = admission.connection_id();` followed by `connection_id: 999` - a mint that consults
      // the admission and then ignores it. Anchoring the accessor to the struct-literal field
      // position is what makes "read off the admission" the thing actually checked.
      for (const field of ["connection_id", "handshake_generation"]) {
        const initialised = new RegExp(field + "\\s*:\\s*admission\\." + field + "\\s*\\(\\s*\\)");
        if (!initialised.test(body)) {
          e.push("O7 the peer mint does not initialise `" + field + "` from `admission." + field + "()`");
        }
      }
      if (/from_verified_peer_admission[\s\S]{0,200}?(connection_id|handshake_generation)\s*:\s*u64/.test(body)) {
        e.push("O7 the peer mint accepts a caller-supplied identifier alongside the admission");
      }
    }
    // NO MACRO MAY EXPAND INSIDE THE ENUMERATED BLOCK. A `macro_rules!` invocation is one token to a
    // text scan and an arbitrary `pub fn` to the compiler, so a forbidden constructor could be
    // written once elsewhere and invoked here while every check above saw nothing. The contract
    // needs no macro in this impl, so the honest rule is that there must not be one.
    if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
      e.push("O7 a macro is invoked inside the TrustedPeerContext impl; it could expand to a constructor this scan cannot see");
    }
    // And no shape that lets a caller assert the answer, whatever it is called.
    for (const [re, why] of [
      [/pub[^\n]*fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*bool/, "a public function taking a bool"],
      [/pub[^\n]*fn [a-z0-9_]+\s*(?:<[^>]*>)?\s*\([^)]*:\s*&?ServiceInstanceBinding/, "a public function taking the verdict enum"],
    ]) {
      if (re.test(body)) {
        e.push("O7 TrustedPeerContext exposes " + why + "; a verdict is a description, not authority");
      }
    }
  }

  // O8 - the trusted types are sealed so no downstream crate can write a struct literal.
  if (!/mod sealed \{/.test(contract) || !/pub struct Seal;/.test(contract)) {
    e.push("O8 the private seal is missing; trusted types could be fabricated by struct literal");
  }
  for (const t of ["TrustedPeerContext", "AuthorisedProtectedOperation", "VerifiedOwnerProgrammeDelegation"]) {
    const body = fnBody(contract, "pub struct " + t);
    if (body && !/_seal:\s*Seal/.test(body)) {
      e.push("O8 " + t + " is no longer sealed");
    }
  }

  // O12 - THE DELEGATION AUTHORITY SURFACE (RUN-TO-COMPLETION HOST ATTESTATION - RUNG 1-2
  // REGRESSION-CONTROL REMEDIATION).
  //
  // WHY THIS EXISTS. The authority-reachability checkpoint introduced `VerifiedOwnerProgrammeDelegation`
  // - the rung that makes a delegation Murad's rather than a file saying so - and shipped NO regression
  // control over it. The ECC security review called that out: the type is correctly sealed today, so
  // nothing was exploitable, but a later change could add `impl Clone`, drop `_seal`, or introduce a
  // second mint and CI would stay green. O8 covered the two older trusted types and was never widened.
  //
  // WHAT THIS DOES NOT CLAIM. A text scan does not prove cryptographic ordering. That the signature is
  // checked BEFORE programme and liveness, that the subject is domain-separated, and that a refused
  // record never reaches policy, are proven by the behavioural Rust tests in owner_programme_delegation.rs
  // and by module privacy. This pins the AUTHORITY SURFACE only: which constructors may exist, how
  // visible they may be, and that nothing else can mint the type.
  //
  // CRATE-WIDE, NOT FILE-WIDE. Rust permits an inherent `impl` in ANY module of the defining crate, and
  // a struct with private fields can be built by struct literal from the defining module OR ANY
  // DESCENDANT of it. So a new `mod helpers;` file beside this one could carry a second, unruled mint
  // that a single-file scan would never see - an ordinary "split the impl out" refactor, not an exploit.
  // Every count below therefore runs over every `.rs` in the crate, found recursively. Raised by the ECC
  // security review.
  {
    const crateRs = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "target") walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".rs")) {
          crateRs.push(full);
        }
      }
    };
    walk(IPC);
    const crateSrc = crateRs.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");

    if (!/pub struct VerifiedOwnerProgrammeDelegation/.test(contract)) {
      e.push("O12 VerifiedOwnerProgrammeDelegation is missing");
    } else {
      const fields = blockBody(contract, "pub struct VerifiedOwnerProgrammeDelegation");
      // Authority-bearing fields must stay private. A `pub` field is a struct-literal mint in disguise.
      // SCAN THE FIELDS, NOT THE HEADER: `pub struct ...` is itself a `pub` followed by a lowercase
      // word, so scanning the whole body reported a public field on a struct that has none.
      if (/\bpub\s+[a-z_]/.test(fields)) {
        e.push("O12 VerifiedOwnerProgrammeDelegation gained a public field; authority could be written directly");
      }
      if (!/_seal:\s*Seal/.test(fields)) {
        e.push("O12 VerifiedOwnerProgrammeDelegation lost its private seal");
      }
      // DERIVES. PartialEq/Eq compare a delegation and mint nothing, so they are permitted. Clone/Copy
      // would let a holder duplicate authority rather than obtain it by verifying; Default would mint one
      // from nothing; serde would mint one from bytes. `attrsAbove` collapses a wrapped derive onto one
      // line, so the list is read whatever shape rustfmt leaves it in.
      const derives = attrsAbove(contract, "pub struct VerifiedOwnerProgrammeDelegation");
      for (const bad of ["Clone", "Copy", "Default", "Serialize", "Deserialize"]) {
        if (new RegExp("derive\\s*\\([^)]*\\b" + bad + "\\b").test(derives)) {
          e.push("O12 VerifiedOwnerProgrammeDelegation derives " + bad + "; verified authority must be obtained by verifying, never copied, defaulted or deserialised");
        }
      }
      // NO TRAIT IMPL ANYWHERE IN THE CRATE. `From`/`TryFrom`/`Into`/`Default`/`Clone` are all trait
      // routes to a value, and enumerating the forbidden ones would pass whichever was thought of next.
      if (/impl[^{;]*?\bfor\s+VerifiedOwnerProgrammeDelegation\b/.test(flatten(crateSrc))) {
        e.push("O12 a trait impl for VerifiedOwnerProgrammeDelegation exists; a trait could mint the type outside the enumerated block");
      }
      // ONE INHERENT BLOCK IN THE WHOLE CRATE, so the enumeration below cannot be bypassed by appending
      // a second one - in this file or in any other module of the crate.
      const blocks = (crateSrc.match(/impl VerifiedOwnerProgrammeDelegation\s*\{/g) || []).length;
      if (blocks !== 1) {
        e.push("O12 expected exactly one `impl VerifiedOwnerProgrammeDelegation` block in the crate, found " + blocks + "; the enumeration below only covers one");
      }
      // NO CONSTRUCTION BY EXPLICIT NAME ANYWHERE. The two ruled mints both write `Self { .. }` inside
      // the single impl block, so a construction that spells the type out is by definition a third one.
      // `-> Type {` is excluded because a return type followed by a function body is not a construction.
      const literals = (crateSrc.match(/(?<!struct )(?<!impl )(?<!-> )VerifiedOwnerProgrammeDelegation\s*\{/g) || []).length;
      if (literals !== 0) {
        e.push("O12 found " + literals + " construction(s) of VerifiedOwnerProgrammeDelegation by explicit name; the only ruled mints are inside its own impl");
      }
      const body = blockBody(contract, "impl VerifiedOwnerProgrammeDelegation {");
      // AN ALLOWLIST, NOT A DENYLIST, and it covers `pub(crate)` too - the production mint is crate-visible
      // because Rust cannot express "this sibling module only", so a new crate-visible function is exactly
      // the regression that matters. Generics tolerated in the match so `fn evil<T>(..)` cannot slip past.
      const ALLOWED_DELEGATION = new Set([
        "from_verified_owner_signature", // THE production mint, crate-private, one call site
        "delegation", // read-only accessor
      ]);
      const fns = [...body.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
      for (const name of fns) {
        if (!ALLOWED_DELEGATION.has(name)) {
          e.push("O12 VerifiedOwnerProgrammeDelegation gained an unruled function `" + name + "`; a delegation must be verified, not asserted");
        }
      }
      // The one production mint must exist and must stay no broader than pub(crate).
      if (!/pub\(crate\)\s+fn\s+from_verified_owner_signature\s*\(/.test(body)) {
        e.push("O12 the crate-private production mint `from_verified_owner_signature` is missing");
      }
      if (/(?:^|[^(])\bpub\s+fn\s+from_verified_owner_signature\s*\(/.test(body)) {
        e.push("O12 from_verified_owner_signature became fully public; a downstream crate could mint verified authority");
      }
      // COUNT THE MINTS. Applying the seal to a delegation is what minting IS, so the number of places
      // that do it is the number of mints. Exactly two are ruled: the `cfg(test)` constructor and the
      // production one. A third is a new mint whatever it is called.
      // COUNT THE CONSTRUCTIONS, not merely the seal text. `Self { delegation: other, ..proof }`
      // inherits the seal from an already-verified value and mints a third delegation carrying a
      // payload nobody verified - while the seal-text count below stays at 2, `blocks` stays 1 and
      // `literals` stays 0. A private helper doing it is invisible to the public-function allowlist
      // as well, so the construction count is the control that actually holds. `-> Self {` is
      // excluded: a return type is not a construction. Raised by the ECC security review.
      const selfMints = (body.match(/(?<!-> )(?<!let )Self\s*\{/g) || []).length;
      if (selfMints !== 2) {
        e.push("O12 expected exactly 2 constructions of VerifiedOwnerProgrammeDelegation inside its impl (cfg(test) + production mint), found " + selfMints);
      }
      const seals = (body.match(/_seal:\s*Seal/g) || []).length;
      if (seals !== 2) {
        e.push("O12 expected exactly 2 seal applications in the VerifiedOwnerProgrammeDelegation impl (cfg(test) + production mint), found " + seals);
      }
      // And the test constructor must really be test-only, or it is simply a second production mint.
      if (!/#\[cfg\(test\)\]\s*(?:\n\s*)*fn\s+for_test\s*\(/.test(body)) {
        e.push("O12 `for_test` is missing or no longer gated `#[cfg(test)]`; it would be a second production mint");
      }
      // NO MACRO inside the authority impl: one token to this scan, an arbitrary `fn` to the compiler.
      if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
        e.push("O12 a macro is invoked inside the VerifiedOwnerProgrammeDelegation impl; it could expand to a constructor this scan cannot see");
      }
    }

    // NO REBINDING OF THE SEALED TYPE NAMES, ANYWHERE IN THE CRATE.
    //
    // Every structural check above keys on the LITERAL type name - `impl Type {`, `Type {`. Rust
    // lets an inherent impl be written against a type ALIAS, and a struct with private fields can
    // be built from any module that can see those fields. So this, in the defining module, is a
    // complete forgery route that every one of those checks reads straight past:
    //
    //     type Alias = SealedType;
    //     impl Alias {
    //         pub(crate) fn forged(..) -> Self { Self { _seal: Seal, .. } }
    //     }
    //
    // Demonstrated by the ECC security review and reproduced here against rustc 1.96.1: it
    // compiles, runs, and yields a sealed value with no signature, programme or liveness check.
    // Rather than teaching every scan to resolve aliases - which is parsing Rust - the rebinding
    // itself is refused. Production has no legitimate reason to rename these types, so the honest
    // rule is that it must not happen.
    for (const sealedType of [
      "VerifiedOwnerProgrammeDelegation",
      "TrustedPeerContext",
      "AuthorisedProtectedOperation",
    ]) {
      const aliased = new RegExp("\\btype\\s+\\w+\\s*(?:<[^>]*>)?\\s*=\\s*(?:[\\w]+::)*" + sealedType + "\\b");
      if (aliased.test(crateSrc)) {
        e.push("O12 " + sealedType + " is rebound by a type alias; an inherent impl on the alias would be invisible to every check that names the type");
      }
      const renamed = new RegExp("\\buse\\s+[^;]*\\b" + sealedType + "\\s+as\\s+\\w+");
      if (renamed.test(crateSrc)) {
        e.push("O12 " + sealedType + " is imported under another name; an inherent impl on that name would be invisible to every check that names the type");
      }
    }

    // THE MINT HAS EXACTLY ONE CONSUMER, and it is the verification order. A second call site would be a
    // second route to verified authority even though the mint itself never changed.
    const DELEG = path.join(IPC, "owner_programme_delegation.rs");
    if (!fs.existsSync(DELEG)) {
      e.push("O12 owner_programme_delegation.rs is missing; the delegation verification module is the mint's only consumer");
    } else {
      const deleg = stripComments(fs.readFileSync(DELEG, "utf8"));
      const calls = (deleg.match(/from_verified_owner_signature\s*\(/g) || []).length;
      if (calls !== 1) {
        e.push("O12 expected exactly 1 call to from_verified_owner_signature in owner_programme_delegation.rs, found " + calls);
      }
      // It must be the tail of the ONE verification order, not a shortcut somewhere above it.
      const order = blockBody(deleg, "fn verify_delegation_with_oracle(");
      if (!order || !/from_verified_owner_signature\s*\(/.test(order)) {
        e.push("O12 the mint is no longer reached from verify_delegation_with_oracle; provenance may no longer precede it");
      }
      // EVERY FILE, INCLUDING THIS ONE. The previous version skipped operation_contract.rs wholesale
      // so the mint's own definition would not match itself - and thereby blinded the check to every
      // CALL in the file that defines it. That is the file where a bypass would most naturally be
      // added, and nothing else covers it: the construction counts exclude `-> Type {` (so a free
      // function returning the type via a call is never counted) and the function allowlist only
      // scans inside the impl block. A free `pub(crate) fn forged(claim: OwnerProgrammeDelegation)
      // -> VerifiedOwnerProgrammeDelegation { ..::from_verified_owner_signature(claim) }` therefore
      // shipped a complete forgery route - attacker-chosen project, plan, phase and budget, no
      // signature, no programme check, no liveness - past a clean CI run. Demonstrated by the ECC
      // security review and reproduced before fixing.
      //
      // The exclusion is now the DEFINITION rather than the file: `fn from_verified_owner_signature(`
      // is the declaration, anything else naming it is a call.
      // Strike out the DECLARATION first, then count what remains. A lookbehind on `fn ` would
      // assume rustfmt never wraps `fn` onto its own line; this assumes nothing.
      const withoutDecl = (src) => src.replace(/\bfn\s+from_verified_owner_signature/g, "DECLARATION");
      const CALLS = /from_verified_owner_signature\s*\(/g;
      for (const f of crateRs) {
        const base = path.basename(f);
        const calls = (withoutDecl(stripComments(fs.readFileSync(f, "utf8"))).match(CALLS) || []).length;
        const allowed = base === "owner_programme_delegation.rs" ? 1 : 0;
        if (calls !== allowed) {
          e.push(
            "O12 " + path.relative(IPC, f).replace(/\\/g, "/") + " makes " + calls +
              " call(s) to the delegation mint, expected " + allowed +
              "; only the verification order may reach it"
          );
        }
      }
      }
  }

  // O9 - Accepted and Completed require the host-held authority, never caller data.
  for (const fn of ["pub fn accepted(", "pub fn completed("]) {
    const body = fnBody(contract, fn);
    if (!body) {
      e.push("O9 " + fn + ") is missing from the response contract");
    } else if (!/authority:\s*&AuthorisedProtectedOperation/.test(body)) {
      e.push("O9 " + fn + ") no longer requires an AuthorisedProtectedOperation, so a caller could assert an effect");
    }
  }
  // Admission must not imply execution.
  const acceptedBody = fnBody(contract, "pub fn accepted(");
  if (acceptedBody && !/ResultClass::NotRun/.test(acceptedBody)) {
    e.push("O9 accepted() no longer reports NotRun; ACCEPTED must never imply an executed effect");
  }

  // O10 - InstalledHostStatus is untouched.
  if (!/Self::InstalledHostStatus => 8,/.test(protocol)) {
    e.push("O10 the InstalledHostStatus discriminant changed; it must stay 8");
  }
  if (!/MessageKind::InstalledHostStatus => INSTALLED_HOST_STATUS_LEN,/.test(protocol)) {
    e.push("O10 the InstalledHostStatus payload length binding changed");
  }

  // O11 - the new family is registered with fixed discriminants and lengths.
  if (!/Self::ProtectedOperationRequest => 9,/.test(protocol)) {
    e.push("O11 ProtectedOperationRequest is not registered at discriminant 9");
  }
  if (!/Self::ProtectedOperationResponse => 10,/.test(protocol)) {
    e.push("O11 ProtectedOperationResponse is not registered at discriminant 10");
  }
  if (!/MessageKind::ProtectedOperationRequest => PROTECTED_OPERATION_REQUEST_LEN,/.test(protocol)) {
    e.push("O11 the request kind has no fixed payload length in the length table");
  }
  if (!/MessageKind::ProtectedOperationResponse => PROTECTED_OPERATION_RESPONSE_LEN,/.test(protocol)) {
    e.push("O11 the response kind has no fixed payload length in the length table");
  }

  return e;
}

module.exports = { run };

if (require.main === module) {
  const errs = run();
  if (errs.length) {
    errs.forEach((x) => console.error("[val-projectoshost-ipc-operation-contract1a] FAIL: " + x));
    process.exit(1);
  }
  console.log("val-projectoshost-ipc-operation-contract1a: PASS");
}
