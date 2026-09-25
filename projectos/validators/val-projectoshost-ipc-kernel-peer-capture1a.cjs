// Validator: PROJECTOSHOST-IPC-KERNEL-PEER-CAPTURE1A
//
// Fails closed. Pins ATTEMPT-SCOPED canonical ownership of kernel peer identity.
//
// The architecture this validator defends: peer identity is captured INSIDE the bounded, ordered,
// consumable attempt that already owns the instance observations, is stored privately there, and never
// leaves. No contribution, binding, observation or handle is returned to any sibling crate; a consumer
// learns only that the attempt advanced into its next opaque state, or the closed redacted verdict that
// refused it.
//
// The threat each assertion answers (and the K-mutation it kills):
//   C1  the attempt-scoped capture surface exists at the committed paths
//   C2  windows-local-ipc acquires NO raw process or token identity itself            (K1)
//   C3  the canonical crate asks for the MINIMUM process and token rights             (K3, K4)
//   C4a impersonation is guaranteed to revert, and the revert is VERIFIED             (K6)
//   C5  no work other than the token reads happens inside the impersonation window    (K11)
//   C6  no token or process handle escapes; both close through RAII, never CloseHandle (K5)
//   C7  exact user and session identity are OPAQUE, crate-private and unreadable      (K7)
//   C8  classification is a fail-closed GATE derived from the user SID alone          (K12)
//   C9  integrity is non-authorising - it can neither establish nor invalidate identity (K12)
//   C10 nothing is publicly constructible and no fixture reaches the default graph    (K8, K9)
//   C11 the attempt returns no identity: only the next state or a closed verdict      (K1)
//   C12 process-creation identity still binds the peer, and C4 remains a hard stop    (K2, K10)
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const CANON = path.join(ROOT, "projectos", "host", "windows-service-identity-proof");
const IPC = path.join(ROOT, "projectos", "host", "windows-local-ipc", "src");
const INSTANCE = path.join(CANON, "src", "instance.rs");
const FFI = path.join(CANON, "src", "instance_ffi.rs");
const CANON_LIB = path.join(CANON, "src", "lib.rs");
const MANIFEST = path.join(CANON, "Cargo.toml");
const CONTRACT = path.join(IPC, "operation_contract.rs");
const IPC_FFI = path.join(IPC, "windows_ffi.rs");

/** Strip line and doc comments so a forbidden construct cannot hide in prose, and prose cannot fail a build. */
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

/** The `#[...]` attribute lines immediately preceding an item. */
function attributesAbove(src, signature) {
  const at = src.indexOf(signature);
  if (at === -1) return null;
  const before = src.slice(0, at).split("\n");
  const attrs = [];
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    if (line === "") continue;
    if (line.startsWith("#[")) {
      attrs.push(line);
      continue;
    }
    break;
  }
  return attrs.join(" ");
}

/** The raw process/token APIs that belong to the canonical crate ALONE. */
const RAW_IDENTITY_APIS = [
  "GetNamedPipeClientProcessId",
  "GetNamedPipeClientSessionId",
  "GetProcessTimes",
  "OpenProcess",
  "OpenThreadToken",
  "OpenProcessToken",
  "GetTokenInformation",
  "ImpersonateNamedPipeClient",
  "RevertToSelf",
  "LookupAccountSid",
  "ConvertSidToStringSid",
];

/** The crate-private peer identity types. None may be named outside the canonical crate. */
const PEER_TYPES = [
  "PeerUserBinding",
  "PeerSessionBinding",
  "PeerPrincipalClass",
  "PeerIntegrityEvidence",
  "CanonicalPeerContribution",
  "PeerContributionOutcome",
  "PeerContributionRefusal",
];


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
  e.push(...literalMaskSelfTest("C13"));

  // C1 - the committed paths exist.
  for (const [f, label] of [
    [INSTANCE, "windows-service-identity-proof/src/instance.rs"],
    [FFI, "windows-service-identity-proof/src/instance_ffi.rs"],
    [CANON_LIB, "windows-service-identity-proof/src/lib.rs"],
    [MANIFEST, "windows-service-identity-proof/Cargo.toml"],
    [CONTRACT, "windows-local-ipc/src/operation_contract.rs"],
    [IPC_FFI, "windows-local-ipc/src/windows_ffi.rs"],
  ]) {
    if (!fs.existsSync(f)) {
      e.push("C1 a required file is missing: " + label);
      return e;
    }
  }
  const instance = stripComments(fs.readFileSync(INSTANCE, "utf8"));
  const ffi = stripComments(fs.readFileSync(FFI, "utf8"));
  const canonLib = stripComments(fs.readFileSync(CANON_LIB, "utf8"));
  const manifest = fs.readFileSync(MANIFEST, "utf8");
  const contract = stripComments(fs.readFileSync(CONTRACT, "utf8"));
  const ipcFfi = stripComments(fs.readFileSync(IPC_FFI, "utf8"));

  for (const item of [
    "pub(crate) struct PeerUserBinding",
    "pub(crate) struct PeerSessionBinding",
    "pub(crate) enum PeerPrincipalClass",
    "pub(crate) enum PeerIntegrityEvidence",
    "pub(crate) struct CanonicalPeerContribution",
    "pub(crate) fn decide_peer_contribution(",
    "pub(crate) fn record_ipc_peer_identity(",
    "pub(crate) fn reconcile_ipc_peer_identity(",
  ]) {
    if (!instance.includes(item)) e.push("C1 the attempt-scoped capture surface is missing: " + item);
  }
  if (!/pub unsafe fn observe_ipc_peer_identity\(/.test(ffi)) {
    e.push("C1 the live capture is not an attempt transition (observe_ipc_peer_identity is missing)");
  }

  // C2 - windows-local-ipc acquires no raw identity itself. This is the b3 boundary, restated so a
  // future edit to THIS phase's code cannot quietly re-cross it.
  for (const api of RAW_IDENTITY_APIS) {
    if (contract.includes(api)) {
      e.push("C2 the peer contract acquires raw identity itself; that belongs to the canonical crate: " + api);
    }
    if (ipcFfi.includes(api)) {
      e.push("C2 windows-local-ipc/windows_ffi.rs acquires raw identity itself, which b3 forbids: " + api);
    }
  }

  // C3 - the canonical crate asks for the MINIMUM rights, and nothing wider.
  if (!/OpenProcess\(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id\)/.test(ffi)) {
    e.push("C3 the peer process is no longer opened with the limited query right only");
  }
  if (!/OpenThreadToken\(GetCurrentThread\(\), TOKEN_QUERY, false, &mut token\)/.test(ffi)) {
    e.push("C3 the client token is no longer opened read-only under the impersonated context");
  }
  for (const wide of [
    "PROCESS_ALL_ACCESS",
    "PROCESS_VM_READ",
    "PROCESS_QUERY_INFORMATION,",
    "TOKEN_ALL_ACCESS",
    "TOKEN_ADJUST_PRIVILEGES",
    "TOKEN_DUPLICATE",
    "TOKEN_IMPERSONATE",
    "TOKEN_ASSIGN_PRIMARY",
    "TOKEN_WRITE",
    "DuplicateToken",
    "SetThreadToken",
    "AdjustTokenPrivileges",
    "ImpersonateLoggedOnUser",
    "CreateProcessAsUser",
    "OpenProcessToken",
    "SeDebugPrivilege",
  ]) {
    if (ffi.includes(wide)) e.push("C3 the canonical capture reaches beyond read-only identity: " + wide);
  }
  // The manifest must declare exactly the security feature that was authorised, and no more.
  if (!/"Win32_Security",/.test(manifest)) {
    e.push("C3 the canonical manifest no longer declares the authorised Win32_Security feature");
  }
  for (const wide of [
    '"Win32_System_Registry"',
    '"Win32_Networking',
    '"Win32_Security_Cryptography"',
    '"Win32_Security_Authorization"',
  ]) {
    if (manifest.includes(wide)) e.push("C3 the canonical manifest gained an unauthorised Windows feature: " + wide);
  }

  // C4a - reversion is guaranteed by Drop and VERIFIED, not assumed.
  if (!/impl Drop for ImpersonatedPipeClient/.test(ffi)) {
    e.push("C4a the impersonation guard has no Drop; a failure path could leave the thread impersonating");
  }
  const drop = fnBody(ffi, "impl Drop for ImpersonatedPipeClient");
  if (!drop || !/RevertToSelf\(\)/.test(drop) || !/self\.reverted\.set\(/.test(drop)) {
    e.push("C4a the guard's Drop no longer reverts and records the result");
  }
  const decide = fnBody(instance, "pub(crate) fn decide_peer_contribution(");
  if (!decide) {
    e.push("C4a decide_peer_contribution is missing");
  } else {
    const revertAt = decide.indexOf("impersonation_reverted");
    const instanceAt = decide.indexOf("ServiceInstanceObservation::Observed");
    const userAt = decide.indexOf("token_user");
    if (revertAt === -1) e.push("C4a the decision core no longer checks that impersonation reverted");
    for (const [name, at] of [["the instance check", instanceAt], ["the user check", userAt]]) {
      if (at !== -1 && revertAt !== -1 && at < revertAt) {
        e.push("C4a " + name + " precedes the reversion check; an unreverted capture must be refused first");
      }
    }
    // C9 - integrity must not participate in ANY refusal. Positionally: every refusal branch must be
    // decided BEFORE integrity is first consulted, so integrity cannot gate a refusal no matter how the
    // branches are arranged.
    const lastRefusal = decide.lastIndexOf("PeerContributionOutcome::Refused(");
    const firstIntegrity = decide.search(/integrity/i);
    if (firstIntegrity !== -1 && lastRefusal !== -1 && firstIntegrity < lastRefusal) {
      e.push("C9 integrity is consulted before a refusal is decided; it must be non-authorising evidence only");
    }
  }

  // C5 - only the token reads happen inside the impersonation window.
  const capture = fnBody(ffi, "unsafe fn capture_peer_identity_facts(");
  if (!capture) {
    e.push("C5 the private impersonation-window helper is missing");
  } else {
    const from = capture.indexOf("ImpersonatedPipeClient::enter");
    const window = from === -1 ? "" : capture.slice(from, capture.indexOf("facts.impersonated = "));
    if (!/read_impersonated_token_facts\(\)/.test(window)) {
      e.push("C5 the impersonation window no longer performs the token read");
    }
    for (const bad of [
      "ReadFile",
      "WriteFile",
      "CreateFileW",
      "ConnectNamedPipe",
      "OpenProcess",
      "GetProcessTimes",
      "QueryServiceStatusEx",
      "RegOpenKey",
      "fs::",
    ]) {
      if (window.includes(bad)) e.push("C5 work other than the token read happens while impersonating: " + bad);
    }
    if (!/facts\.impersonation_reverted = reverted\.get\(\)/.test(capture)) {
      e.push("C5 the capture no longer records whether the revert actually succeeded");
    }
    // The process observation must be OUTSIDE the window: it is done by the transition, before the
    // guard is entered.
    if (/observe_named_pipe_peer_instance/.test(capture)) {
      e.push("C5 the process observation was moved inside the impersonation window");
    }
  }

  // C6 - no handle escapes, and both handles close through RAII rather than a manual CloseHandle.
  const tokenRead = fnBody(ffi, "unsafe fn read_impersonated_token_facts()");
  if (!tokenRead) {
    e.push("C6 read_impersonated_token_facts is missing");
  } else if (!/adopt\(token\)/.test(tokenRead) || !/win32\(&owned\)/.test(tokenRead)) {
    e.push("C6 the client token handle is not adopted into the RAII primitive");
  }
  if (/CloseHandle/.test(ffi)) {
    e.push("C6 a handle is closed manually instead of through the canonical RAII primitive");
  }
  if (!/adopt\(raw\)/.test(ffi)) {
    e.push("C6 the temporary process handle is no longer adopted into the RAII primitive");
  }
  for (const sig of ["pub unsafe fn observe_ipc_peer_identity(", "pub unsafe fn reobserve_ipc_peer_identity("]) {
    if (/->\s*(HANDLE|std::os::windows::io::OwnedHandle)/.test(fnBody(ffi, sig) || "")) {
      e.push("C6 an attempt transition returns a handle");
    }
  }

  // C7 - exact identity is opaque, crate-private and unreadable.
  for (const t of ["PeerUserBinding", "PeerSessionBinding"]) {
    // `balancedBody`, not `fnBody`: `declaredFields` takes a bare interior, and a braceless
    // (tuple) declaration must fail the guard below rather than enumerate nothing.
    const body = balancedBody(instance, "pub(crate) struct " + t);
    if (!body) {
      e.push("C7 " + t + " is missing");
      continue;
    }
    // STRUCTURAL: a public field is a public field wherever it sits on the line.
    for (const leaked of publicFields(body)) {
      e.push("C7 " + t + " has a public field, so its identity content is readable: " + leaked);
    }
  }
  for (const re of [
    /impl PeerUserBinding \{[\s\S]*?fn (bytes|as_bytes|as_slice|raw|sid|value)\s*\(\s*&self/,
    /impl PeerSessionBinding \{[\s\S]*?fn (session|raw|value|id)\s*\(\s*&self/,
    /->\s*&\[u8\]/,
  ]) {
    if (re.test(instance)) e.push("C7 a readable accessor is exposed on an opaque binding: " + re);
  }
  for (const t of ["PeerUserBinding", "PeerSessionBinding", "CanonicalPeerContribution"]) {
    if (!new RegExp("impl fmt::Debug for " + t).test(instance)) {
      e.push("C7 " + t + " does not have a redacted Debug");
    }
  }
  if (/impl fmt::Display for Peer(User|Session)Binding/.test(instance)) {
    e.push("C7 an opaque binding implements Display");
  }
  if (/Serialize|Deserialize|serde/.test(instance)) {
    e.push("C7 the canonical identity module references serialisation");
  }

  // C8 - classification is a FAIL-CLOSED GATE derived from the user SID alone. It never replaces exact
  // identity, and it never reads a group or an integrity level.
  const classify = fnBody(instance, "pub(crate) fn from_user_binding(");
  if (!classify) {
    e.push("C8 the bounded classification is missing");
  } else {
    if (!/user\.authority\(\)/.test(classify) || !/user\.first_sub_authority\(\)\?/.test(classify)) {
      e.push("C8 classification no longer derives from the token user SID alone");
    }
    for (const bad of ["integrity", "Integrity", "group", "Group", "TokenGroups", "elevat"]) {
      if (classify.includes(bad)) {
        e.push("C8 classification consults something other than the user SID: " + bad);
      }
    }
    if (!/->\s*Option<Self>/.test(classify)) {
      e.push("C8 an unclassifiable principal no longer fails closed");
    }
  }
  // Scoped to the method body alone: a neighbouring method in the same impl must not be able to
  // satisfy, or fail, this assertion on its behalf.
  // MASKED AND BALANCED. The raw `[\s\S]*?\n    \}` stopped at the first four-space-indented
  // closing brace, so a nested block or a literal could truncate the body - and C9 below is a
  // NEGATIVE check, which a truncated body passes silently. Raised by the ECC security review.
  const matches = balancedBody(instance, "fn identity_matches(");
  if (!matches) {
    e.push("C8 the attempt has no exact-identity comparison");
  } else {
    for (const part of ["instance", "user", "session", "connection_id", "handshake_generation"]) {
      if (!new RegExp("self\\." + part + "\\s*==\\s*bound\\." + part).test(matches)) {
        e.push("C8 exact-identity comparison no longer compares " + part);
      }
    }
    // C9 - integrity must not be compared: a peer that elevates keeps the identity it had.
    if (/integrity/.test(matches)) {
      e.push("C9 exact-identity comparison consults integrity; it must be non-authorising evidence only");
    }
  }
  if (!instance.includes("two_different_users_of_the_same_class_remain_distinguishable")) {
    e.push("C8 the exact-user separation test is missing; classification could silently replace identity");
  }

  // C10 - nothing is publicly constructible, and no fixture route reaches identity at all.
  const contrib = fnBody(instance, "pub(crate) struct CanonicalPeerContribution");
  if (!contrib || !/_sealed:\s*Sealed/.test(contrib)) {
    e.push("C10 CanonicalPeerContribution is not sealed; it could be fabricated by struct literal");
  }
  if (/impl CanonicalPeerContribution \{[\s\S]*?pub fn (new|from_parts|observed)\s*\(/.test(instance)) {
    e.push("C10 CanonicalPeerContribution gained a public constructor");
  }
  for (const t of PEER_TYPES) {
    if (new RegExp("\\bpub\\s+(struct|enum)\\s+" + t + "\\b").test(instance)) {
      e.push("C10 " + t + " is publicly declared; peer identity must stay crate-private");
    }
    if (new RegExp("\\b" + t + "\\b").test(canonLib)) {
      e.push("C10 " + t + " is re-exported from the canonical crate's lib.rs");
    }
  }
  // The identity types must be gated to the graph where identity can legitimately originate, and never
  // to the fixture feature, so no fixture build carries a peer identity at all.
  for (const t of ["PeerUserBinding", "CanonicalPeerContribution"]) {
    const gate = attributesAbove(instance, "pub(crate) struct " + t);
    if (gate === null) {
      e.push("C10 cannot inspect the gate on " + t);
    } else if (!/windows-live-instance-observation/.test(gate) || /test-fixtures/.test(gate)) {
      e.push("C10 " + t + " is not gated to the live observation graph alone: " + gate);
    }
  }
  if (/synthetic_peer/.test(instance) || /synthetic_peer/.test(canonLib)) {
    e.push("C10 a synthetic peer-identity fixture exists; identity must have no fixture route");
  }
  if (/^default = \[.*test-fixtures/m.test(manifest) || /^default = \[.*windows-live/m.test(manifest)) {
    e.push("C10 a default feature enables fixtures or live observation");
  }

  // C11 - the attempt returns NO identity: only the next opaque state, or a closed verdict.
  if (
    new RegExp("\\bpub\\s+fn[^\\n]*->[^\\n]*(" + PEER_TYPES.join("|") + ")").test(instance) ||
    new RegExp("\\bpub\\s+unsafe\\s+fn[^\\n]*->[^\\n]*(" + PEER_TYPES.join("|") + ")").test(ffi)
  ) {
    e.push("C11 a public function returns a peer identity, an internal record or a reusable contribution");
  }
  for (const [sig, label] of [
    ["pub unsafe fn observe_ipc_peer_identity(", "capture"],
    ["pub unsafe fn reobserve_ipc_peer_identity(", "reconciliation"],
  ]) {
    const body = fnBody(ffi, sig);
    if (!body) {
      e.push("C11 the attempt-scoped " + label + " transition is missing");
      continue;
    }
    if (!/->\s*AttemptOutcome<IpcPeerObserved>/.test(body)) {
      e.push("C11 the " + label + " transition does not return an attempt outcome");
    }
    if (!/\(\s*\n?\s*self,/.test(body)) {
      e.push("C11 the " + label + " transition does not consume the attempt");
    }
    if (!/&LiveInstanceObservationCapability/.test(body)) {
      e.push("C11 the " + label + " transition does not demand the sealed observation capability");
    }
  }
  // Peer refusals collapse onto ONE closed verdict, so no token fact is disclosed by the reason.
  const collapse = fnBody(instance, "fn peer_refusal_verdict(");
  if (!collapse) {
    e.push("C11 peer refusals are not collapsed onto a closed verdict");
  } else {
    if (/_\s*=>/.test(collapse)) {
      e.push("C11 the peer refusal collapse uses a wildcard instead of an exhaustive match");
    }
    if ((collapse.match(/ServiceInstanceBinding::/g) || []).length !== 1) {
      e.push("C11 the peer refusal collapse discloses more than one verdict");
    }
  }
  // The peer identity is stored INSIDE the attempt's private store.
  const inner = fnBody(instance, "struct AttemptInner {");
  if (!inner || !/\n\s*peer:\s*Option<Box<CanonicalPeerContribution>>,/.test(inner)) {
    e.push("C11 the attempt does not retain the captured peer identity internally");
  }

  // C13 - ATTEMPT<->CONNECTION PAIRING (PROJECTOSHOST-IPC-CANONICAL-SESSION-INTEGRATION1A).
  //
  // A successful instance verdict proves peer/service agreement but not WHICH host-issued connection
  // produced it, so a verdict could be paired with an unrelated connection's session evidence. The
  // attempt must therefore store the host-issued pair it was captured on and prove equality when it
  // is finalised — WITHOUT the pair ever becoming readable outside the canonical crate.
  if (!inner || !/\n\s*host_connection:\s*Option<\(u64, u64\)>,/.test(inner)) {
    e.push("C13 the attempt does not retain the host-issued connection/generation pair internally");
  } else if (/\n\s*pub\s+host_connection:/.test(inner)) {
    e.push("C13 the host-issued pair is a public field, so it is readable outside the canonical crate");
  }
  // No accessor may expose either stored value ON THE ATTEMPT (a comparison is the only permitted
  // operation there). RECONCILED (§9C): the accepted sealed peer admission
  // (`VerifiedPeerAdmission`, the OWNER DELEGATION + SEALED PEER ADMISSION checkpoint) exposes
  // exactly the two host-issued identifiers it was minted for, because `TrustedPeerContext` is
  // required to read them OFF the admission rather than accept them as arguments. That is the
  // one ruled exception, pinned as an allowlist on that impl alone; the attempt and its inner
  // state stay accessor-free.
  const admissionImpl = balancedBody(instance, "impl VerifiedPeerAdmission {");
  const instanceOutsideAdmission = instance.replace(admissionImpl, "");
  if (/pub(\(crate\))?\s+fn\s+\w*(host_connection|connection_id|handshake_generation)\w*\s*\(\s*&self/.test(instanceOutsideAdmission)) {
    e.push("C13 a readable accessor exposes the stored host-issued connection or handshake generation outside the sealed admission");
  }
  {
    // PROJECTOS-HOST-REVIEW-PATH1B (ROUTE 1, W1) - THE DECLARED AMENDMENT.
    //
    //   OLD: the sealed admission exposed EXACTLY the two host-issued identifier accessors, and
    //        nothing else - because its ONE mint lived on the service-instance attempt.
    //   NEW: it additionally carries `for_admitted_client`, the CRATE-PRIVATE mint of the
    //        CLIENT-ADMISSION route.
    //
    // WHY THIS IS NOT A WIDENING OF WHAT AN ADMISSION EXPOSES. The installed product makes
    // ProjectOSHost the pipe SERVER and the governed Agent the CLIENT, so a service-instance attempt
    // about the Host's own client can never finalise to `Match` and that route mints nothing at all
    // in the direction the product actually runs. The new entry is a MINT, not an accessor: it
    // reads nothing out of an admission, it is `pub(crate)` so no consumer can reach it, and it has
    // EXACTLY ONE call site - the final gate of `admit_client_for_connection`, after the attempt has
    // proven the capture's pair, the stored pair and the asked pair all agree and the principal is
    // exactly the enrolled configured owner. The accessor rule itself is untouched: the readable
    // surface is still the two host-issued identifiers and nothing else.
    const ADMISSION_ACCESSORS = ["connection_id", "handshake_generation"];
    const ADMISSION_MINT = "for_admitted_client";
    if (!/pub\(crate\) fn for_admitted_client\(connection_id: u64, handshake_generation: u64\) -> Self/.test(admissionImpl))
      e.push("C13 the client-admission mint is missing, public, or does not take exactly the two host-issued identifiers");
    {
      const callSites = instance
        .replace(/\bfn\s+for_admitted_client/g, "DECLARATION")
        .match(/for_admitted_client\s*\(/g) || [];
      if (callSites.length !== 0)
        e.push("C13 the client-admission mint is called " + callSites.length + " time(s) in instance.rs; its only call site is the client-admission gate");
    }
    const fns = [...admissionImpl.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)].map((m) => m[1]);
    for (const name of fns) {
      if (![...ADMISSION_ACCESSORS, ADMISSION_MINT].includes(name)) {
        e.push("C13 VerifiedPeerAdmission gained an unruled function `" + name + "`; it may expose only the two host-issued identifiers");
      }
    }
    const admissionDecl = balancedBody(instance, "pub struct VerifiedPeerAdmission");
    if (!/_sealed:\s*Sealed/.test(admissionDecl) || publicFields(admissionDecl).length > 0) {
      e.push("C13 VerifiedPeerAdmission is not sealed with private fields");
    }
    // The admission mint DELEGATES the verdict to the paired finalisation and constructs only on Match.
    const admit = balancedBody(instance, "pub fn admit_peer_for_connection(").replace(/\s+/g, " ");
    if (!/match self\.finalise_for_connection\(connection_id, handshake_generation\) \{ ServiceInstanceBinding::Match => Ok\(VerifiedPeerAdmission \{/.test(admit)) {
      e.push("C13 admit_peer_for_connection no longer defers to finalise_for_connection before constructing the admission");
    }
    if (!/refused => Err\(refused\)/.test(admit)) {
      e.push("C13 admit_peer_for_connection no longer returns the refusing verdict as the error");
    }
  }
  // The capture transition that binds a connection must store the pair it was given, and refuse a
  // zero (non-identity) identifier.
  const pairedCapture = fnBody(instance, "pub fn record_ipc_peer_on_connection(");
  if (!pairedCapture) {
    e.push("C13 the connection-bound capture transition is missing");
  } else {
    if (!/self\.inner\.host_connection = Some\(\(connection_id, handshake_generation\)\)/.test(pairedCapture)) {
      e.push("C13 the connection-bound capture does not store the host-issued pair");
    }
    if (!/connection_id == 0 \|\| handshake_generation == 0/.test(pairedCapture)) {
      e.push("C13 the connection-bound capture accepts a zero (non-identity) identifier");
    }
  }
  // The live identity capture must store the SAME pair it already records in the contribution.
  const liveCapture = fnBody(instance, "pub(crate) fn record_ipc_peer_identity(");
  if (!liveCapture) {
    e.push("C13 the live identity capture transition is missing");
  } else if (!/self\.inner\.host_connection = Some\(\(connection_id, handshake_generation\)\)/.test(liveCapture)) {
    e.push("C13 the live identity capture does not store the host-issued pair for pairing");
  }
  // The consuming paired finalisation: takes self by value, compares the STORED pair against the
  // expected values, fails closed when nothing was stored, and only then defers to the instance
  // verdict. Caller-supplied values alone must never establish Match.
  // The UNPAIRED finalise must refuse an attempt that WAS captured on a host-issued connection, so
  // the choice of finaliser is not left to caller discipline and a Match can never be produced
  // without the pairing having been checked.
  const unpaired = fnBody(instance, "pub fn finalise(self) -> ServiceInstanceBinding {");
  if (!unpaired) {
    e.push("C13 the unpaired finalisation is missing");
  } else {
    if (
      !/\n\s*if self\.inner\.host_connection\.is_some\(\) \{\s*\n\s*return ServiceInstanceBinding::CrossAttemptObservation;/.test(
        unpaired
      )
    ) {
      e.push("C13 the unpaired finalise does not refuse a connection-tagged attempt");
    }
    if (!/self\.bind_observations\(\)/.test(unpaired)) {
      e.push("C13 the unpaired finalise does not defer to the shared instance verdict");
    }
  }
  // BRACE-BALANCED (§9C): `fnBody` read to the first column-0 `}` - the END OF THE IMPL BLOCK -
  // so the sealed admission mint that follows in the same impl was scanned as if it were part of
  // the finaliser, and its legitimate `ServiceInstanceBinding::Match =>` arm tripped the "can
  // produce Match itself" rule. The finaliser's own body is what the rule is about.
  const paired = balancedBody(instance, "pub fn finalise_for_connection(");
  if (!paired) {
    e.push("C13 the consuming paired finalisation is missing");
  } else {
    // The signature is what says `self` by value; the balanced body starts after it.
    const pairedSig = (instance.slice(instance.indexOf("pub fn finalise_for_connection(")).match(/^[\s\S]*?\{/) || [""])[0];
    if (!/\(\s*\n?\s*self,/.test(pairedSig)) {
      e.push("C13 the paired finalisation does not consume the attempt");
    }
    if (!/let Some\(\(captured_connection, captured_generation\)\) = self\.inner\.host_connection/.test(paired)) {
      e.push("C13 the paired finalisation does not read the attempt's own stored pair");
    }
    if (!/return ServiceInstanceBinding::MissingIpcObservation/.test(paired)) {
      e.push("C13 an attempt with no stored pair does not fail closed");
    }
    // Anchored on the WHOLE condition: a short-circuit prefix (`if false && …`) or an extra guard
    // must not be able to leave the assertion satisfied while the comparison never runs.
    if (!/\n\s*if captured_connection != connection_id \|\| captured_generation != handshake_generation \{/.test(paired)) {
      e.push("C13 the paired finalisation does not require equality with the stored pair");
    }
    if (!/return ServiceInstanceBinding::CrossAttemptObservation/.test(paired)) {
      e.push("C13 a cross-connection presentation is not refused as CrossAttemptObservation");
    }
    if (!/self\.bind_observations\(\)/.test(paired)) {
      e.push("C13 the paired finalisation does not defer to the shared instance verdict");
    }
    if (/ServiceInstanceBinding::Match/.test(paired)) {
      e.push("C13 the paired finalisation can produce Match itself instead of deferring");
    }
  }

  // C12 - process-creation identity still binds the peer, and a captured peer still cannot bypass C4.
  const tokenDecl = fnBody(instance, "pub struct ServiceInstanceToken {");
  if (!tokenDecl || !/creation_time:\s*u64/.test(tokenDecl) || !/process_id:\s*u32/.test(tokenDecl)) {
    e.push("C12 the opaque instance no longer carries BOTH process id and creation time (PID reuse)");
  }
  if (!instance.includes("a_reused_pid_with_a_different_creation_identity_is_refused")) {
    e.push("C12 the PID-reuse test is missing");
  }
  const evalBody = balancedBody(contract, "pub fn evaluate_protected_operation(");
  if (!evalBody) {
    e.push("C12 evaluate_protected_operation is missing");
  } else {
    // RECONCILED (§9C): see checkReconciledC4. The global gate is still first and still cannot
    // close; its only alternative is the request-scoped presence from a verified delegation.
    checkReconciledC4(evalBody, "C12", e);
  }

  return e;
}

module.exports = { run };
