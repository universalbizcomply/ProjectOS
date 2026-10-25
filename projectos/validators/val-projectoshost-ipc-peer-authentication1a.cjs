// Validator: PROJECTOSHOST-IPC-PEER-AUTHENTICATION1A (F2/F3 phase 2)
//
// SUPERSEDED IN PART. Read this header before adding anything back.
//
// This validator originally pinned a peer-authentication CONTRACT that lived in `windows-local-ipc`:
// raw fixed-size SID storage, raw Windows session identity, bounded integrity levels, an
// observed-evidence input model, peer classification, and `authenticate_peer` / `reauthenticate_peer`.
//
// PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A (`b8cca6d`) made the canonical identity-proof crate the SOLE
// owner of peer identity: identity is captured inside a bounded attempt, compared there, and never
// crosses into this crate in any form. PROJECTOSHOST-IPC-PEER-CONTRACT-RECONCILIATION1A then RETIRED
// the duplicate model here, because two identity vocabularies would be contradictory rather than
// redundant.
//
// Accordingly the assertions that described the retired model are GONE, and their replacement is
// ABSENCE, enforced by `val-projectoshost-ipc-peer-contract-reconciliation1a`. Nothing was weakened to
// let the retirement pass: what was removed here no longer exists to assert, and what is still true is
// asserted below unchanged.
//
// WHAT SURVIVES, because it was never about the identity model:
//   P9  an admitted peer still cannot bypass C4, and nothing can become ACCEPTED or COMPLETED
//   P10 this crate does not acquire live process or token identity itself (the b3 boundary, restated
//       locally so a future edit to THIS crate's code cannot quietly cross it)
//
// DELIBERATELY NOT RE-ADDED: P1-P8. Reinstating any of them would require reinstating the retired
// model, which is exactly what the reconciliation validator forbids.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const FFI = path.join(IPC, "windows_ffi.rs");
const LIB = path.join(IPC, "lib.rs");

/**
 * Strip line and doc comments before any "token must be absent" check, so prose describing a forbidden
 * construct cannot fail the build and, more importantly, a forbidden construct cannot hide in a comment.
 */
function stripComments(rust) {
  let out = "";
  let i = 0;
  while (i < rust.length) {
    const c = rust[i];
    const n = rust[i + 1];
    // RAW STRING: not a comment, and a `//` or `/*` inside one is not a comment either.
    if (
      // `r`, `br` and `cr` (C string, stable since Rust 1.77) all open a raw literal.
      (c === "r" || ((c === "b" || c === "c") && n === "r")) &&
      !/[A-Za-z0-9_]/.test(i > 0 ? rust[i - 1] : " ")
    ) {
      const rAt = c === "r" ? i : i + 1;
      let h = rAt + 1;
      while (rust[h] === "#") h++;
      if (rust[h] === '"') {
        const hashes = h - rAt - 1;
        const close = '"' + "#".repeat(hashes);
        let j = rust.indexOf(close, h + 1);
        j = j === -1 ? rust.length : j + close.length;
        out += rust.slice(i, j);
        i = j;
        continue;
      }
    }
    if (c === '"' || ((c === "b" || c === "c") && n === '"')) {
      const start = c === '"' ? i : i + 1;
      let j = start + 1;
      while (j < rust.length && rust[j] !== '"') {
        if (rust[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, rust.length);
      out += rust.slice(i, j);
      i = j;
      continue;
    }
    // CHAR / BYTE-CHAR LITERAL, copied through whole. `'"'` is legal Rust, and without this branch
    // the inner quote read as a string opener and the lexer desynchronised for the rest of the
    // file. Bounded exactly as `maskLiterals` bounds it, so a LIFETIME (`'a`, `'static`) - which
    // has no closing quote - falls through untouched instead of swallowing code.
    if (c === "'" || (c === "b" && n === "'")) {
      const start = c === "b" ? i + 1 : i;
      let j = start + 1;
      if (rust[j] === "\\") {
        j++;
        if (rust[j] === "u" && rust[j + 1] === "{") j = rust.indexOf("}", j);
        j++;
      } else {
        j++;
      }
      if (rust[j] === "'") {
        out += rust.slice(i, j + 1);
        i = j + 1;
        continue;
      }
    }
    if (c === "/" && n === "/") {
      let j = rust.indexOf("\n", i);
      if (j === -1) j = rust.length;
      i = j; // keep the newline itself
      continue;
    }
    if (c === "/" && n === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < rust.length && depth > 0) {
        if (rust[j] === "/" && rust[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (rust[j] === "*" && rust[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      // A space in place of the comment, plus its newlines, so line-anchored checks still hold.
      out += " " + rust.slice(i, j).replace(/[^\n]/g, "");
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The body of an item, from its signature to the next top-level `}`. */
function fnBody(src, signature) {
  // MASKED AND BRACE-BALANCED. Masked, so a `}` inside a string, a char literal or a (possibly
  // nested) comment cannot end the item early. BALANCED, so neither can a nested block whose
  // closing brace happens to sit at column 0 - which is the last place the "first column-0 `}`"
  // anti-pattern survived after the impl-block scans were migrated. The slice starts at the
  // signature, because call sites match on signature text, and ends at the item's own closing
  // brace; an item with no block at all (a unit struct, a type alias) ends at its `;`.
  const mask = maskLiterals(src);
  const at = mask.indexOf(signature);
  if (at === -1) return null;
  // DEPTH-ZERO SEARCH. A `;` inside a parameter list or an array type (`[u8; 32]`) belongs to the
  // SIGNATURE, not to the end of the item; honouring it truncated the body before the return type
  // and blinded the negative checks that read it. Likewise the opening brace must be the item's
  // own, not one nested inside a const-generic argument.
  let sigDepth = 0;
  let open = -1;
  let semi = -1;
  for (let i = at; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "(" || ch === "[") sigDepth++;
    else if (ch === ")" || ch === "]") sigDepth--;
    else if (sigDepth === 0 && ch === "{") {
      open = i;
      break;
    } else if (sigDepth === 0 && ch === ";") {
      semi = i;
      break;
    }
  }
  if (open === -1) {
    return semi === -1 ? src.slice(at) : src.slice(at, semi + 1);
  }
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === "{") depth++;
    else if (mask[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  return src.slice(at);
}


/**
 * A same-length copy of `src` with the CONTENTS of comments, string literals and char/byte literals
 * replaced by spaces. Structural scans (attribute discovery, brace balancing, item ends) run over
 * the mask and slice the original, so a `{` inside `"//"`-bearing text, a `}` in a doc comment or a
 * `b'{'` byte literal can neither open nor close anything. Rust lifetimes (`'a`) are left alone: a
 * `'` is a char literal only when it closes within a few characters.
 */
function maskLiterals(src) {
  const out = src.split("");
  let i = 0;
  const blank = (a, b) => {
    for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = src.length;
      blank(i, j);
      i = j;
    } else if (c === "/" && n === "*") {
      // NESTED, like rustc. Depth counting, not "the first `*/`".
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (src[j] === "*" && src[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      blank(i, j);
      i = j;
    } else if (
      // EVERY raw prefix Rust has: `r`, `br` (byte) and `cr` (C string, stable since 1.77).
      (c === "r" || ((c === "b" || c === "c") && n === "r")) &&
      !/[A-Za-z0-9_]/.test(i > 0 ? src[i - 1] : " ")
    ) {
      // RAW STRING: r"..", r#".."#, br#".."#, with any number of hashes. The terminator is a quote
      // followed by exactly as many hashes as the opener had, so an embedded `"` - the very reason
      // to reach for a raw string - cannot end it. Anything that is not actually a raw-string
      // opener (a bare identifier `r`, a lifetime, a `b` on its own) falls through unchanged.
      const rAt = c === "r" ? i : i + 1;
      let h = rAt + 1;
      while (src[h] === "#") h++;
      if (src[h] === "\"") {
        const hashes = h - rAt - 1;
        const close = "\"" + "#".repeat(hashes);
        let j = src.indexOf(close, h + 1);
        if (j === -1) j = src.length;
        blank(h + 1, j);
        i = Math.min(j + close.length, src.length);
      } else {
        i++;
      }
    } else if (c === "\"" || ((c === "b" || c === "c") && n === "\"")) {
      // `"..."`, `b"..."` and `c"..."` all end at the first unescaped quote.
      const start = c === "\"" ? i : i + 1;
      let j = start + 1;
      while (j < src.length && src[j] !== "\"") {
        if (src[j] === "\\") j++;
        j++;
      }
      blank(start + 1, Math.min(j, src.length));
      i = j + 1;
    } else if (c === "'" || (c === "b" && n === "'")) {
      const start = c === "b" ? i + 1 : i;
      // char literal: 'x' or '\n' or '\u{..}'; otherwise a lifetime.
      let j = start + 1;
      if (src[j] === "\\") {
        j++;
        if (src[j] === "u" && src[j + 1] === "{") j = src.indexOf("}", j);
        j++;
      } else {
        j++;
      }
      if (src[j] === "'") {
        blank(start + 1, j);
        i = j + 1;
      } else {
        i = start + 1;
      }
    } else {
      i++;
    }
  }
  return out.join("");
}

/**
 * THE LITERAL MASK MUST SURVIVE A RAW STRING. `r#"a "quote} more"#` contains a quote and a brace;
 * a scanner that treats the inner quote as a terminator leaks the brace and truncates the block,
 * hiding everything written after it - which is exactly where a second mint would go. Raised by
 * the ECC security review and reproduced before fixing.
 */
function literalMaskSelfTest(tag) {
  const out = [];
  const probe =
    "impl Probe {\n" +
    '    const NOTE: &str = r#"a "quote} more"#;\n' +
    "    fn mint() -> Self {\n        Self { a: 1 }\n    }\n}\n" +
    "fn after() {}\n";
  const body = balancedBody(probe, "impl Probe {");
  if (!/Self\s*\{/.test(body)) {
    out.push(tag + " self-test failed: a raw string truncates a brace-balanced scan, so code after it is invisible");
  }
  if (/fn after/.test(body)) {
    out.push(tag + " self-test failed: the brace-balanced scan over-captures past the block");
  }
  // NESTED BLOCK COMMENTS. `/* outer /* inner */ } still commented */` is ONE comment to rustc, so
  // the `}` is inert; a scanner that stops at the first `*/` treats it as live and truncates.
  const nested =
    "impl Probe3 {\n" +
    "    /* outer /* inner */ } still commented */\n" +
    "    fn h() -> Self {\n        Self { a: 1 }\n    }\n}\n";
  const nestedBody = balancedBody(nested, "impl Probe3 {");
  if (!/fn h/.test(nestedBody) || !/Self\s*\{/.test(nestedBody)) {
    out.push(tag + " self-test failed: a nested block comment truncates a brace-balanced scan, so code after it is invisible");
  }
  if (/fn h/.test(stripComments(nested)) === false) {
    out.push(tag + " self-test failed: stripComments removed live code following a nested block comment");
  }
  // CHAR LITERAL CONTAINING A QUOTE. `'\"'` is legal Rust; a lexer with no char branch reads that
  // inner quote as a STRING opener and, finding no partner, swallows the rest of the file as string
  // content - so a real comment after it is never stripped. The assertion is on the COMMENT being
  // gone, which is what actually differs between the fixed and unfixed lexer; asserting that live
  // code survives did not, because the unfixed branch copies rather than deletes.
  const charLit =
    "fn q() -> char { '\"' }\n" +
    "// LEXER_DESYNC_MARKER\n" +
    "fn tail() {}\n";
  if (/LEXER_DESYNC_MARKER/.test(stripComments(charLit))) {
    out.push(tag + " self-test failed: a char literal containing a quote desynchronises stripComments, so a real comment is not stripped");
  }
  // A char literal containing a BRACE must not close a block (the mask's char branch).
  const charBrace =
    "impl Probe4 {\n    fn q() -> char { '}' }\n    fn r() -> Self {\n        Self { a: 1 }\n    }\n}\n";
  if (!/fn r/.test(balancedBody(charBrace, "impl Probe4 {"))) {
    out.push(tag + " self-test failed: a brace inside a char literal truncates a brace-balanced scan");
  }
  // A NEWLINE-THEN-BRACE inside a multi-line string must not end a function body: that is exactly
  // the sequence the unmasked `fnBody` searched for, so this fixture fails against it.
  const braced =
    'fn probe5() {\n    let _ = "multi\n}\nstill string";\n    let mint = 1;\n}\n';
  const probedBody = fnBody(braced, "fn probe5()");
  if (probedBody === null || !/let mint/.test(probedBody)) {
    out.push(tag + " self-test failed: a newline-brace inside a string truncates fnBody, hiding the code after it");
  }
  // A NESTED BLOCK whose closing brace lands at COLUMN 0 must not end an item early. This is the
  // shape that survived in `fnBody` after every impl-block scan had been migrated.
  const columnZero =
    "pub struct Probe7 {\n" +
    "    padding: [u8; {\n0\n}],\n" +
    "    pub leaked: u64,\n}\n";
  const probe7 = fnBody(columnZero, "pub struct Probe7");
  if (probe7 === null || !/pub leaked/.test(probe7)) {
    out.push(tag + " self-test failed: a column-zero closing brace truncates fnBody, hiding the fields after it");
  }
  // FIELD ENUMERATION MUST SEE THE WHOLE IDENTIFIER ALPHABET. `[a-z_]+` matches no camelCase and
  // no digit, so a field named `leakedSid` or `caller1` was simply not enumerated.
  const camel = "pub struct Probe8 {\n    ok_field: u64,\n    pub leakedSid: u64,\n    pub caller1: bool,\n}\n";
  const seen = enumerateFields(balancedBody(camel, "pub struct Probe8"));
  if (seen.join(",") !== "ok_field,leakedSid,caller1") {
    out.push(tag + " self-test failed: field enumeration misses `pub`, camelCase or digit-bearing fields (saw " + seen.join(",") + ")");
  }
  // RUST DOES NOT REQUIRE ONE FIELD PER LINE. A field squeezed onto a neighbour's line has no
  // newline in front of it, and every line-anchored enumeration missed it entirely.
  const sameLine = "pub struct Probe10 {\n    bytes: [u8; 28], pub leaked_sid: [u8; 28],\n    other: u64,\n}\n";
  const sameLineBody = balancedBody(sameLine, "pub struct Probe10 {");
  const sameLineNames = enumerateFields(sameLineBody);
  if (sameLineNames.join(",") !== "bytes,leaked_sid,other") {
    out.push(tag + " self-test failed: fields sharing a source line are not enumerated (saw " + sameLineNames.join(",") + ")");
  }
  if (publicFields(sameLineBody).join(",") !== "leaked_sid") {
    out.push(tag + " self-test failed: a public field sharing a source line is not reported as public");
  }
  // A comma inside a generic argument list must not invent a field or lose the next one.
  const generic = "pub struct Probe11 {\n    map: HashMap<u8, u16>,\n    pub after: u64,\n}\n";
  const genericNames = enumerateFields(balancedBody(generic, "pub struct Probe11 {"));
  if (genericNames.join(",") !== "map,after") {
    out.push(tag + " self-test failed: a generic argument comma breaks field enumeration (saw " + genericNames.join(",") + ")");
  }
  // AN INLINE CONST BLOCK IN A FIELD'S TYPE must not be mistaken for the struct's own body. This
  // and the `where`-clause case below both emptied the field list under the old reduction.
  const constBlock =
    "pub struct Probe12 {\n    _pad: [u8; { 0 }],\n    pub leaked: u64,\n}\n";
  const constNames = enumerateFields(balancedBody(constBlock, "pub struct Probe12 {"));
  if (constNames.join(",") !== "_pad,leaked" || publicFields(balancedBody(constBlock, "pub struct Probe12 {")).join(",") !== "leaked") {
    out.push(tag + " self-test failed: an inline const block in a field type hides the fields around it (saw " + constNames.join(",") + ")");
  }
  // A `where` CLAUSE carrying a brace must not be mistaken for the item's body either.
  const whereClause =
    "pub struct Probe13 where [(); { 0 }]: Sized {\n    kept: u64,\n    pub leaked: u64,\n}\n";
  const whereBody = balancedBody(whereClause, "pub struct Probe13");
  if (enumerateFields(whereBody).join(",") !== "kept,leaked" || publicFields(whereBody).join(",") !== "leaked") {
    out.push(tag + " self-test failed: a where-clause brace is mistaken for the struct body (saw " + enumerateFields(whereBody).join(",") + ")");
  }
  // A TUPLE STRUCT has no field block at all: the extractor must yield nothing for the caller's
  // "cannot inspect" guard to fire, never a silent empty field list from a whole-item slice.
  // The following item deliberately HAS a body: without a depth-zero `;` stop the scan runs on and
  // adopts it, which is how a tuple struct came to report a neighbour's fields as its own.
  const tuple = "pub struct Probe14(pub [u8; 4], pub u8);\npub struct Probe15 {\n    innocent: u64,\n}\n";
  if (balancedBody(tuple, "pub struct Probe14") !== "") {
    out.push(tag + " self-test failed: a braceless (tuple) declaration adopts the next item's body instead of failing closed");
  }
  if (enumerateFields(balancedBody(tuple, "pub struct Probe15")).join(",") !== "innocent") {
    out.push(tag + " self-test failed: the depth-zero semicolon stop broke an ordinary struct extraction");
  }
  // A `;` INSIDE A PARAMETER LIST OR ARRAY TYPE belongs to the signature. Honouring it truncated
  // the item before its return type, which silently blinds every negative check that reads it.
  const paramSemi = "pub unsafe fn probe9(extra: [u8; 4]) -> HANDLE {\n    let leaked = 1;\n}\n";
  const probe9 = fnBody(paramSemi, "pub unsafe fn probe9(");
  if (probe9 === null || !/->\s*HANDLE/.test(probe9) || !/let leaked/.test(probe9)) {
    out.push(tag + " self-test failed: a semicolon inside a parameter list truncates fnBody before the return type");
  }
  // A RAW C-STRING (`cr#".."#`, stable since Rust 1.77) must not desynchronise the mask either.
  const cstr =
    "impl Probe6 {\n" +
    '    const NAME: &str = cr#"a "quote} more"#;\n' +
    "    fn r() -> Self {\n        Self { a: 1 }\n    }\n}\n";
  if (!/fn r/.test(balancedBody(cstr, "impl Probe6 {"))) {
    out.push(tag + " self-test failed: a raw C-string truncates a brace-balanced scan, so code after it is invisible");
  }
  // And a masked-out brace inside an ordinary string must not close a block either.
  const quoted = 'impl Probe2 {\n    fn f() { let _ = "}"; }\n    fn g() -> Self { Self { a: 1 } }\n}\n';
  if (!/fn g/.test(balancedBody(quoted, "impl Probe2 {"))) {
    out.push(tag + " self-test failed: a brace inside a string literal truncates a brace-balanced scan");
  }
  return out;
}

/**
 * The fields declared directly in a struct body, as `{ name, isPub }`, however they are laid out.
 *
 * STRUCTURAL, NOT LINE-BASED. Every earlier version anchored on `\n` plus indentation, which
 * assumes one field per line - an assumption Rust does not make. `bytes: [u8; 28], pub leaked: u64,`
 * is two fields, and the second, having no newline before it, was invisible to every check built on
 * that regex: the opacity guard on the identity bindings, the `TrustedPeerContext` allowlist and the
 * exact request-field list all passed while the struct really had grown a field. So the body is now
 * split on commas at bracket DEPTH ZERO and each segment is read for its own visibility and name.
 * A comma inside a generic argument list splits one field into fragments, which yields the same
 * name and no phantom extra, so it cannot hide anything. Raised by the ECC security review.
 *
 * ONE IMPLEMENTATION, used by the production checks AND by the self-test, so the two can never
 * again validate different patterns.
 */
function declaredFields(body) {
  // A BARE INTERIOR ONLY. This used to accept a whole item and find the wrapper brace itself with
  // a plain `indexOf("{")` - no depth awareness - so a `where [(); { 0 }]: Sized` clause or an
  // inline const array length in a field's type was mistaken for the item's body and every field
  // disappeared. There is now ONE brace-finding implementation in this file (`balancedBody`), and
  // callers hand its result in; a declaration with no braces at all yields "" there, which the
  // callers' own "cannot inspect" guards already treat as a failure.
  const src = String(body || "");
  const mask = maskLiterals(src);
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < mask.length; i++) {
    const c = mask[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === ",") {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  const out = [];
  for (const raw of parts) {
    const seg = raw.replace(/#\[[^\]]*\]/g, " ").trim();
    const m = seg.match(/^(pub(?:\([^)]*\))?\s+)?([A-Za-z0-9_]+)\s*:/);
    if (m) out.push({ name: m[2], isPub: Boolean(m[1]) });
  }
  return out;
}

/** Just the names, in declaration order. */
function enumerateFields(body) {
  return declaredFields(body).map((f) => f.name);
}

/** Just the names of the PUBLIC fields. */
function publicFields(body) {
  return declaredFields(body)
    .filter((f) => f.isPub)
    .map((f) => f.name);
}

/** The `{ .. }` body that follows `header`, by brace balancing (see the O-validator for why). */
function balancedBody(src, header) {
  const mask = maskLiterals(src);
  const at = mask.indexOf(header);
  if (at === -1) return "";
  // DEPTH-ZERO, like `fnBody`: the item's own opening brace, not one nested inside a parameter
  // list or a const-generic argument. Kept symmetrical so the two extractors cannot drift.
  let headDepth = 0;
  let open = -1;
  for (let i = at; i < mask.length; i++) {
    const ch = mask[i];
    if (ch === "(" || ch === "[") headDepth++;
    else if (ch === ")" || ch === "]") headDepth--;
    else if (headDepth === 0 && ch === "{") {
      open = i;
      break;
    } else if (headDepth === 0 && ch === ";") {
      // THE ITEM ENDED WITHOUT A BLOCK - a tuple struct, a unit struct, a type alias, a trait
      // method declaration. Without this stop the scan ran on and adopted the NEXT item's body,
      // so `pub(crate) struct PeerUserBinding(pub [u8; N], pub u8);` yielded a neighbour's fields
      // and the caller's "cannot inspect" guard never fired on a struct that had just exposed its
      // identity bytes. Raised by a hostile probe after the ECC security review.
      return "";
    }
  }
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < mask.length; i++) {
    if (mask[i] === "{") depth++;
    else if (mask[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/**
 * THE RECONCILED C4 SHAPE (RUN-TO-COMPLETION HOST ATTESTATION - C4 AUTHORITY BOUNDARY, then §9C).
 *
 * The original invariant was "the C4 gate is an unconditional hard stop and nothing can be
 * accepted" - true while no route past C4 existed. The accepted architecture since then gives C4
 * exactly ONE alternative: a request-scoped presence derived from a VERIFIED owner programme
 * delegation through the crate-private `satisfy_c4_for_gatekeeper_request`, minted inside the
 * evaluator and never carried. What is PERMANENT, and what this pins:
 *   - the global gate is still consulted, still first, and still cannot report closed (O5);
 *   - the only other term is that presence - not a peer, not an admission, not a caller boolean;
 *   - a refusal names OwnerPresenceGateOpen before the peer and epoch checks run;
 *   - the evaluator renders no Accepted/Completed itself; rendering is the outcome's job, and the
 *     outcome can only be Authorised by the mint at the tail, which requires the presence VALUE.
 */
function checkReconciledC4(body, tag, e) {
  const flat = body.replace(/\s+/g, " ");
  if (!/let presence = delegated ?\.and_then\(\|e\| satisfy_c4_for_gatekeeper_request\(e, request\)\) ?\.filter\(\|p\| p\.answers\(request\.correlation\(\), request\.operation\(\)\)\);/.test(flat)) {
    e.push(tag + " request-scoped presence is no longer derived solely from satisfy_c4_for_gatekeeper_request over the sealed delegation evidence");
  }
  if (!/let c4_satisfied = OwnerPresenceGate::current\(\)\.is_closed\(\) \|\| presence\.is_some\(\);/.test(flat)) {
    e.push(tag + " the C4 condition is no longer exactly `gate || presence`; an extra term could let a peer, an admission or a caller flag satisfy it");
  }
  if (!/if !c4_satisfied \{ return refuse\(RejectionReason::OwnerPresenceGateOpen\); \}/.test(flat)) {
    e.push(tag + " the C4 refusal no longer names OwnerPresenceGateOpen");
  }
  const gateAt = body.indexOf("OwnerPresenceGate::current()");
  const peerAt = body.indexOf("peer.is_none()");
  const epochAt = body.indexOf("claimed_service_epoch()");
  if (gateAt === -1 || peerAt === -1 || epochAt === -1 || !(gateAt < peerAt && peerAt < epochAt)) {
    e.push(tag + " C4 is not checked before the peer and epoch checks");
  }
  if (/ProtectedOperationResponse::(accepted|completed)\s*\(/.test(body)) {
    e.push(tag + " the evaluator renders Accepted/Completed itself; rendering belongs to the sealed outcome");
  }
  if (/:\s*bool\b/.test(flat.split("{")[0] || "")) {
    e.push(tag + " the evaluator takes a boolean argument; sealed evidence must not be replaced by an asserted answer");
  }
}

function run() {
  const e = [];
  e.push(...literalMaskSelfTest("P9"));

  for (const [f, label] of [[CONTRACT, "operation_contract.rs"], [FFI, "windows_ffi.rs"], [LIB, "lib.rs"]]) {
    if (!fs.existsSync(f)) {
      e.push("P1 a required source file is missing: windows-local-ipc/src/" + label);
      return e;
    }
  }
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const ffi = stripComments(fs.readFileSync(FFI, "utf8"));

  // P9 - an admitted peer is still not authority (RECONCILED, §9C: see checkReconciledC4). The C4
  // condition may contain exactly one term besides the global gate, and it is derived from the
  // verified owner delegation - never from the peer.
  const evalBody = balancedBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("P9 evaluate_protected_operation is missing");
  } else {
    checkReconciledC4(evalBody, "P9", e);
  }

  // P10 - the b3 boundary, restated locally. This crate must not acquire identity itself.
  const OWNED_BY_CANONICAL = [
    "GetNamedPipeClientProcessId",
    "GetNamedPipeClientSessionId",
    "GetProcessTimes",
    "OpenProcess",
    "OpenThreadToken",
    "GetTokenInformation",
    "ImpersonateNamedPipeClient",
    "RevertToSelf",
  ];
  for (const api of OWNED_BY_CANONICAL) {
    if (contract.includes(api)) {
      e.push("P10 the contract module acquires live identity itself; that belongs to the canonical identity-proof crate: " + api);
    }
    if (ffi.includes(api)) {
      e.push("P10 windows_ffi.rs acquires live identity itself, which val-windows-local-ipc-capability-b3 forbids: " + api);
    }
  }

  return e;
}

module.exports = { run };
