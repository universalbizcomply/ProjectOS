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
//   O6  the evaluator is the SOLE mint of AuthorisedProtectedOperation, C4 FIRST, and every rung it
//       requires is sealed evidence (RUN-TO-COMPLETION HOST ATTESTATION §9C evolution)
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
  // ONE IMPLEMENTATION. This used to brace-balance over raw text; `balancedBody` does the same
  // over the mask, so a brace inside a literal or comment cannot truncate it. Kept as a name
  // because the checks below read better with it.
  return balancedBody(src, header);
}

/** The body of a function, from its signature to the next top-level `}`. */
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
 * Whether a `#[cfg(..)]` attribute means "NOT in any shipped graph".
 *
 * A SUBSTRING TEST ON THE ATTRIBUTE TEXT IS WRONG, and was: `#[cfg(any(feature = "test-fixtures",
 * feature = "windows-live-ipc"))]` contains the letters "test", but `windows-live-ipc` is a REAL
 * production feature - it is what the installed host compiles with - so an item gated that way
 * ships. Stripping it hid a whole class of production code (the `TrustedPeerContext` production
 * mint among it) from every "must not contain X" and singleton-count scan downstream. Raised by the
 * ECC code review.
 *
 * The predicate is therefore structural. A LEAF is non-shipped when it is `test` or the fixture
 * feature; `all(..)` is non-shipped when ANY child is (all conditions must hold, so one test-only
 * child confines the item to a test build); `any(..)` only when EVERY child is (any child could
 * enable it); anything else - `not(..)`, a target predicate, an unknown feature - is treated as
 * SHIPPED, which fails closed towards scanning more rather than less.
 */
function isNonShippedCfg(attr) {
  const inner = attr.replace(/^#\[\s*cfg\s*\(/, "").replace(/\)\s*\]$/, "");
  const split = (s) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        parts.push(s.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(s.slice(start));
    return parts.map((p) => p.trim()).filter((p) => p !== "");
  };
  const nonShipped = (node) => {
    const t = node.trim();
    if (/^test$/.test(t)) return true;
    if (/^feature\s*=\s*"test-fixtures"$/.test(t)) return true;
    const m = t.match(/^(all|any)\s*\(([\s\S]*)\)$/);
    if (!m) return false;
    const children = split(m[2]);
    if (children.length === 0) return false;
    return m[1] === "all" ? children.some(nonShipped) : children.every(nonShipped);
  };
  return nonShipped(inner);
}

/**
 * Remove every item that is NOT in a shipped graph: anything attributed `#[cfg(test)]`,
 * `#[cfg(all(test, ..))]` or `#[cfg(any(test, ..))]` (the fixture graph is non-default and is
 * enabled by no production dependent). The item after the attribute is removed whole - a `{ .. }`
 * block by brace balancing, otherwise up to and including the terminating `;` - so a test module,
 * a test-only constructor and a fixture struct all vanish together. Comments are stripped by the
 * caller first, so an attribute cannot hide in prose. Used so a "production must not contain X"
 * rule cannot be failed by a legitimate test helper and, more importantly, cannot be PASSED by
 * writing production code under a test attribute that a default build would still compile
 * (that shape is impossible: the attribute IS what excludes it).
 */
function stripNonShippedItems(src) {
  const mask = maskLiterals(src);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const at = mask.indexOf("#[cfg(", i);
    if (at === -1) {
      out += src.slice(i);
      break;
    }
    // Parse the attribute to its closing `]` by bracket balancing.
    let depth = 0;
    let j = at + 1;
    for (; j < mask.length; j++) {
      if (mask[j] === "[") depth++;
      else if (mask[j] === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    const attr = src.slice(at, j + 1);
    if (!isNonShippedCfg(attr)) {
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // Skip any further attributes, then remove the item.
    let k = j + 1;
    for (;;) {
      const m = mask.slice(k).match(/^\s*#\[/);
      if (!m) break;
      let d = 0;
      let q = k + m[0].length - 1;
      for (; q < mask.length; q++) {
        if (mask[q] === "[") d++;
        else if (mask[q] === "]") {
          d--;
          if (d === 0) break;
        }
      }
      k = q + 1;
    }
    // Find the item's end: the first `{` (a block, balanced) or `;` (a statement) at bracket depth
    // zero. A `;` INSIDE `[u8; 32]` or a parenthesised parameter list is part of the signature, not
    // the end of the item - reading it as the end left the body of a `fn` behind un-stripped.
    out += src.slice(i, at);
    let bdepth = 0;
    let q = k;
    let kind = "";
    for (; q < mask.length; q++) {
      const c = mask[q];
      if (c === "[" || c === "(") bdepth++;
      else if (c === "]" || c === ")") bdepth--;
      else if (bdepth === 0 && c === "{") { kind = "block"; break; }
      else if (bdepth === 0 && c === ";") { kind = "stmt"; break; }
    }
    if (kind === "block") {
      let d = 0;
      for (; q < mask.length; q++) {
        if (mask[q] === "{") d++;
        else if (mask[q] === "}") {
          d--;
          if (d === 0) break;
        }
      }
      i = q + 1;
    } else if (kind === "stmt") {
      i = q + 1;
    } else {
      i = src.length;
    }
  }
  return out;
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
 * EVERY `{ .. }` body whose header matches, by brace balancing, across the whole string.
 *
 * The crate-wide mint counts previously extracted impl blocks with `impl <Type>\s*\{[\s\S]*?\n\}` -
 * a non-greedy match that stops at the first column-0 `\n}`. That is the "split on the first
 * newline-plus-close-brace" anti-pattern this very file documents fixing for `blockBody`: a
 * mis-indented or unusually formatted brace truncates the scan and everything after it becomes
 * invisible. Balancing removes the unstated dependency on the source being rustfmt-clean. Raised by
 * the ECC code review.
 */
function allBlockBodies(src, header) {
  const mask = maskLiterals(src);
  const bodies = [];
  let from = 0;
  for (;;) {
    const at = mask.indexOf(header, from);
    if (at === -1) return bodies;
    const open = mask.indexOf("{", at);
    if (open === -1) return bodies;
    let depth = 0;
    let end = mask.length;
    for (let i = open; i < mask.length; i++) {
      if (mask[i] === "{") depth++;
      else if (mask[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    bodies.push(src.slice(open + 1, end));
    from = end + 1;
  }
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

/**
 * O2 - the shapes that could carry an unbounded or free-form value. Returned as the list of what was
 * found so the SELF-TEST below can assert the rule fires on hostile input and stays quiet on the
 * legitimate kinds of exemption. A rule that is never shown to fire is a rule that may match nothing.
 */
const O2_FORBIDDEN = [
  // NOT `&[u8]`: the strict frame decoders take the received bytes as a slice by necessity, and O3
  // already forbids handing one back out (`-> &[u8]`). Generic byte INPUTS (`AsRef<[u8]>`) stay
  // forbidden via `<[u8]>`.
  "String", "Vec<", "HashMap", "BTreeMap", "serde", "&str", "<str>", "<[u8]>",
  "Box<dyn", "format!", "vec!", ".to_string(", ".to_owned(", ".to_vec(",
];
function o2FreeFormShapes(rustWithComments) {
  const production = stripComments(stripNonShippedItems(rustWithComments));
  return O2_FORBIDDEN.filter((bad) => production.includes(bad));
}
/** Hostile and benign probes. Each entry: [source, mustFlag]. */
const O2_PROBES = [
  ["pub fn f(s: String) {}", true],
  ["pub fn g(s: &str) {}", true],
  ["pub fn h(v: Vec<u8>) {}", true],
  ["pub fn m() -> u8 { let _s = format!(\"x\"); 0 }", true],
  ["type S = std::string::String;", true],
  ["pub fn k<T: AsRef<str>>(_t: T) {}", true],
  ["impl X { pub fn payload(&self) -> Vec<u8> { Vec::new() } }", true],
  ["macro_rules! mk { () => { pub fn p(s: String) {} }; }", true],
  ["// String Vec<u8> &str serde\n/// String\n/* Vec<u8> */\npub fn ok(a: [u8; 32]) -> [u8; 32] { a }", false],
  ["#[cfg(test)]\nmod tests {\n  fn t(s: String) -> Vec<u8> { s.into_bytes() }\n}\npub fn ok(a: u64) -> u64 { a }", false],
  ["#[cfg(any(test, feature = \"test-fixtures\"))]\npub fn fixture(s: String) {}\npub fn ok(a: u64) -> u64 { a }", false],
  ["#[cfg(all(test, feature = \"test-fixtures\"))]\n#[must_use]\nfn t(s: &str) -> u8 { 0 }\npub fn ok(a: u64) -> u64 { a }", false],
  // A REAL PRODUCTION FEATURE GATE IS NOT A TEST GATE, however the letters read.
  ["#[cfg(any(feature = \"test-fixtures\", feature = \"windows-live-ipc\"))]\npub fn shipped(s: String) {}", true],
  ["#[cfg(feature = \"windows-live-ipc\")]\npub fn shipped(s: &str) {}", true],
  ["#[cfg(not(test))]\npub fn shipped(v: Vec<u8>) {}", true],
  ["#[cfg(any(test, feature = \"test-fixtures\"))]\npub fn fixture_only(s: String) {}\npub fn ok(a: u64) -> u64 { a }", false],
];

function run() {
  const e = [];
  e.push(...literalMaskSelfTest("O6"));

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
  // value. Absent from the PRODUCTION contract module, a secret cannot be spelled on this wire.
  //
  // §9C MADE THIS ROBUST RATHER THAN INCIDENTAL. The rule used to scan the whole file including
  // its tests, so a `&str` label in a test table made it RED for a checkpoint and a test rewrite
  // made it GREEN by accident. Now: comments stripped, every non-shipped item (cfg(test),
  // cfg(all(test, ..)), cfg(any(test, ..))) stripped, the forbidden set widened to the macro and
  // conversion spellings of the same shapes, and the rule is SELF-TESTED on hostile and benign
  // probes below so that it is shown to fire rather than assumed to.
  for (const bad of o2FreeFormShapes(contractRaw)) {
    e.push("O2 the operation contract gained a free-form or unbounded shape, so the wire is no longer secret-free: " + bad);
  }
  for (const [probe, mustFlag] of O2_PROBES) {
    const flagged = o2FreeFormShapes(probe).length > 0;
    if (flagged !== mustFlag) {
      e.push("O2 self-test failed: the free-form rule " + (mustFlag ? "did not fire on hostile input" : "fired on an exempt shape") + ": " + JSON.stringify(probe));
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

  // O6 - THE OPERATION-AUTHORITY MINT (RUN-TO-COMPLETION HOST ATTESTATION §9C).
  //
  // EVOLVED from the phase-era invariant "evaluation can never mint acceptance", which was true only
  // while no route past C4 existed. The permanent invariant is what it pins now: the evaluator is
  // the SOLE production mint of AuthorisedProtectedOperation; the mint is reachable only for
  // IndependentGatekeeperReview; it requires request-scoped C4 from a VerifiedOwnerProgrammeDelegation,
  // a TrustedPeerContext, the current service epoch, the Host's exact binding (subject digest,
  // delegation reference, parameter digest), a genuine AdmittedRequest for this correlation and
  // sequence on that peer's connection, and a known, in-budget cost; a protected effect refuses;
  // authority means admission only; Accepted is rendered from authority as NotRun; Completed stays
  // execution-guarded; every other operation class stays refused. STRUCTURE IS PINNED, NOT ONE
  // SPELLING: each gate's refusal and each stamped field are asserted in order over the
  // brace-balanced, whitespace-flattened body, so rustfmt cannot make a check vacuous and a
  // reordered or dropped gate cannot pass.
  const evalBody = balancedBody(contract, "pub fn evaluate_protected_operation(");
  const evalSig = (contract.match(/pub fn evaluate_protected_operation\([\s\S]*?\)\s*->\s*[A-Za-z_]+/) || [""])[0].replace(/\s+/g, " ");
  if (!evalBody) {
    e.push("O6 evaluate_protected_operation is missing");
  } else {
    const flat = evalBody.replace(/\s+/g, " ");
    // 6a. The outcome is CLOSED: two variants, and the signature consumes sealed evidence only.
    const outcome = balancedBody(contract, "pub enum ProtectedOperationEvaluation");
    const variants = [...outcome.matchAll(/\b([A-Z][A-Za-z]*)\s*\(/g)].map((m) => m[1]);
    if (variants.join(",") !== "Rejected,Authorised" || !/Rejected\(ProtectedOperationResponse\)/.test(outcome) || !/Authorised\(AuthorisedProtectedOperation\)/.test(outcome)) {
      e.push("O6 ProtectedOperationEvaluation is not exactly { Rejected(ProtectedOperationResponse), Authorised(AuthorisedProtectedOperation) }");
    }
    if (!/pub fn evaluate_protected_operation\( request: &ProtectedOperationRequest, peer: Option<&TrustedPeerContext>, delegated: Option<&GatekeeperDelegationEvidence<'_>>, admitted: Option<AdmittedRequest>, service_epoch: u64, \) -> ProtectedOperationEvaluation/.test(evalSig)) {
      e.push("O6 the evaluator signature changed; it must consume the sealed peer, delegation evidence and a BY-VALUE AdmittedRequest, and return the closed outcome");
    }
    // 6b. C4 first, the reconciled shape, and the evaluator renders nothing itself.
    checkReconciledC4(evalBody, "O6", e);
    // 6c. Every gate in order. A missing or reordered anchor is a failure, never a skipped check.
    const anchors = [
      ["OwnerPresenceGate::current()", "the C4 gate"],
      ["peer.is_none()", "the peer requirement"],
      ["claimed_service_epoch()", "the service-epoch check"],
      ["expected_binding_digest(", "the Host binding digest"],
      ["request.parameter_digest()", "the parameter-digest comparison"],
      ["admitted.answers(", "the admission correlation/connection check"],
      ["admitted.sequence() != request.sequence()", "the admitted-sequence check"],
      ["let Some(presence) = presence else", "the mint's requirement of the request-scoped presence VALUE"],
      ["may_be_delegated_by_programme()", "the one-delegable-class restatement at the mint"],
      ["AuthorisedProtectedOperation {", "the mint"],
    ];
    let last = -1;
    for (const [needle, what] of anchors) {
      const at = evalBody.indexOf(needle);
      if (at === -1) {
        e.push("O6 " + what + " is missing from the evaluator");
      } else if (at < last) {
        e.push("O6 " + what + " is out of order in the evaluator");
      } else {
        last = at;
      }
    }
    if (!/if \*request\.binding_digest\(\) != expected \|\| \*request\.approval_ref\(\) != evidence\.delegation\.delegation\(\)\.delegation_id \|\| \*request\.parameter_digest\(\) != evidence\.facts\.parameter_digest \{ return refuse\(RejectionReason::BindingMismatch\); \}/.test(flat)) {
      e.push("O6 the binding gate no longer requires the Host binding digest, the delegation reference AND the parameter digest to agree with the caller's claims");
    }
    if (!/if !admitted\.answers\( ?request\.correlation\(\), peer\.connection_id\(\), peer\.handshake_generation\(\), ?\) \{ return refuse\(RejectionReason::CorrelationMismatch\); \}/.test(flat)) {
      e.push("O6 the admission is no longer required to answer this correlation on the peer's host-issued connection and generation");
    }
    if (!/if admitted\.sequence\(\) != request\.sequence\(\) \{ return refuse\(RejectionReason::SequenceRefused\); \}/.test(flat)) {
      e.push("O6 the admitted sequence is no longer required to equal the frame's sequence");
    }
    if (!/if !presence\.operation\(\)\.may_be_delegated_by_programme\(\) \{ return refuse\(RejectionReason::PolicyRefused\); \}/.test(flat)) {
      e.push("O6 the mint no longer re-states that only the delegable class may be authorised");
    }
    if (!/let Some\(admitted_cost_micro_usd\) = evidence\.facts\.admitted_cost_micro_usd else \{ return refuse\(RejectionReason::PolicyRefused\); \};/.test(flat)) {
      e.push("O6 the mint no longer requires a KNOWN cost");
    }
    // 6d. Every stamped field comes from a sealed rung. Nothing is read off the request.
    for (const [field, source] of [
      ["correlation", "\\*admitted\\.correlation\\(\\)"],
      ["sequence", "admitted\\.sequence\\(\\)"],
      ["operation", "presence\\.operation\\(\\)"],
      ["connection_id", "peer\\.connection_id\\(\\)"],
      ["handshake_generation", "peer\\.handshake_generation\\(\\)"],
      ["delegation_id", "evidence\\.delegation\\.delegation\\(\\)\\.delegation_id"],
      ["binding_digest", "expected"],
      ["candidate_digest", "evidence\\.facts\\.candidate_digest"],
      ["parameter_digest", "evidence\\.facts\\.parameter_digest"],
    ]) {
      if (!new RegExp("AuthorisedProtectedOperation \\{[^}]*\\b" + field + ": " + source + ",").test(flat)) {
        e.push("O6 the mint no longer stamps `" + field + "` from its sealed source");
      }
    }
    if (!/AuthorisedProtectedOperation \{[^}]*\badmitted_cost_micro_usd,/.test(flat)) {
      e.push("O6 the mint no longer stamps the admitted cost from the Host's facts");
    }
    if (/AuthorisedProtectedOperation \{[^}]*request\.(?!operation\(\))/.test(flat)) {
      e.push("O6 the mint reads a value off the untrusted request");
    }
  }
  // 6e. The class restriction is the ENUM's, so a delegation naming another class opens nothing.
  const delegable = fnBody(contract, "pub const fn may_be_delegated_by_programme(self) -> bool");
  if (!delegable || !/matches!\(self, Self::IndependentGatekeeperReview\)/.test(delegable.replace(/\s+/g, " "))) {
    e.push("O6 may_be_delegated_by_programme no longer names exactly IndependentGatekeeperReview");
  }
  // 6f. The request-scoped C4 path checks every delegation bound.
  const c4 = balancedBody(contract, "fn satisfy_c4_for_gatekeeper_request(").replace(/\s+/g, " ");
  for (const [needle, what] of [
    ["!delegation.operation.may_be_delegated_by_programme() || request.operation() != delegation.operation", "the one-class rule"],
    ["delegation.revoked_or_completed || facts.now_epoch_s >= delegation.expires_at_epoch_s", "liveness under the Host's reading"],
    ["facts.project != delegation.project || facts.repository != delegation.repository", "the programme bound"],
    ["facts.plan != delegation.plan || facts.plan_digest != delegation.plan_digest", "the plan and plan-digest bound"],
    [".take(delegation.allowed_phase_count as usize)", "the bounded phase list"],
    ["facts.model_policy != delegation.model_policy || facts.credential_ref != delegation.credential_ref", "the model/credential bound"],
    ["if facts.protected_effect_requested { return None; }", "the protected-effect refusal"],
    ["let cost = facts.admitted_cost_micro_usd?;", "the unknown-cost refusal"],
    ["let projected = facts.committed_spend_micro_usd.checked_add(cost)?;", "checked budget arithmetic"],
    ["if projected > delegation.budget_ceiling_micro_usd { return None; }", "the ceiling"],
  ]) {
    if (!c4.includes(needle)) e.push("O6 the request-scoped C4 path lost " + what);
  }
  // 6g. The sealed authority: no Clone/Copy/Default/serde, no trait impl, one construction in the
  //     whole crate and it is the evaluator's; accessors only on its impl.
  {
    const crateFiles = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "target") walk(full);
        } else if (entry.isFile() && entry.name.endsWith(".rs")) {
          crateFiles.push(full);
        }
      }
    };
    walk(IPC);
    const crateSrc = crateFiles.map((f) => stripComments(stripNonShippedItems(fs.readFileSync(f, "utf8")))).join("\n");
    const derives = attrsAbove(contract, "pub struct AuthorisedProtectedOperation");
    for (const bad of ["Clone", "Copy", "Default", "Serialize", "Deserialize"]) {
      if (new RegExp("derive\\s*\\([^)]*\\b" + bad + "\\b").test(derives)) {
        e.push("O6 AuthorisedProtectedOperation derives " + bad + "; authority must be minted, never copied, defaulted or deserialised");
      }
    }
    if (/impl[^{;]*?\bfor\s+AuthorisedProtectedOperation\b/.test(flatten(crateSrc))) {
      e.push("O6 a trait impl for AuthorisedProtectedOperation exists; a trait could mint the type");
    }
    const constructions = (crateSrc.match(/(?<!struct )(?<!impl )(?<!-> )(?<!enum )AuthorisedProtectedOperation\s*\{/g) || []).length;
    if (constructions !== 1) {
      e.push("O6 expected exactly 1 construction of AuthorisedProtectedOperation in the shipped crate (the evaluator's mint), found " + constructions);
    }
    if (evalBody && !/AuthorisedProtectedOperation\s*\{/.test(evalBody)) {
      e.push("O6 the one construction of AuthorisedProtectedOperation is not inside the evaluator");
    }
    // ONE INHERENT BLOCK IN THE WHOLE CRATE, counted BEFORE the single-block scans below are
    // trusted. A second block (in this file or any descendant module) can write `Self { .. }` -
    // legal, because the fields are private to the defining module - and would be invisible to the
    // name-based construction count, to the `Self {}` count, to the function allowlist and to the
    // macro check, all of which read only the first block. Mirrors O7/O12. Raised by the ECC
    // security review as a complete mint bypass.
    const authBlocks = (crateSrc.match(/impl AuthorisedProtectedOperation\s*\{/g) || []).length;
    if (authBlocks !== 1) {
      e.push("O6 expected exactly one `impl AuthorisedProtectedOperation` block in the shipped crate, found " + authBlocks + "; the checks below only cover one");
    }
    const authSelfMints = allBlockBodies(crateSrc, "impl AuthorisedProtectedOperation {")
      .map((b) => (b.match(/(?<!-> )(?<!let )Self\s*\{/g) || []).length)
      .reduce((a, b) => a + b, 0);
    if (authSelfMints !== 0) {
      e.push("O6 an `impl AuthorisedProtectedOperation` block constructs the type (" + authSelfMints + " `Self {` construction(s)); the evaluator must be the sole mint");
    }
    const authImpl = balancedBody(contract, "impl AuthorisedProtectedOperation {");
    if ((authImpl.match(/Self\s*\{/g) || []).length !== 0) {
      e.push("O6 AuthorisedProtectedOperation's impl constructs the type; the evaluator must be the sole mint");
    }
    const ALLOWED_AUTHORITY = new Set([
      "correlation", "sequence", "operation", "service_epoch", "is_bound_to", "delegation_id",
      "binding_digest", "candidate_digest", "parameter_digest", "admitted_cost_micro_usd",
    ]);
    for (const m of authImpl.matchAll(/pub(?:\((?:crate|super|in [^)]*)\))?\s+fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g)) {
      if (!ALLOWED_AUTHORITY.has(m[1])) e.push("O6 AuthorisedProtectedOperation gained an unruled function `" + m[1] + "`");
    }
    for (const body of allBlockBodies(crateSrc, "impl AuthorisedProtectedOperation {").concat([authImpl])) {
      if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
        e.push("O6 a macro is invoked inside the AuthorisedProtectedOperation impl; it could expand to a constructor this scan cannot see");
        break;
      }
    }
    // NO MACRO IN THE EVALUATOR EITHER, and no macro DEFINITION in the DEFINING MODULE: a
    // `macro_rules!` could spell the mint with the type name passed in as a token, which the
    // construction count above would never see. The defining module is the only place a struct
    // with private fields can be written as a literal, so that is where the rule bites; the
    // transport modules keep their own (pre-existing, unrelated) macros.
    if (evalBody && /\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(evalBody)) {
      e.push("O6 a macro is invoked inside evaluate_protected_operation; it could expand to a mint this scan cannot see");
    }
    if (/\bmacro_rules!\s*[a-z_]/i.test(stripComments(stripNonShippedItems(contractRaw)))) {
      e.push("O6 a macro_rules! definition exists in the shipped operation-contract module; it could expand to a mint this scan cannot see");
    }
    // 6h. Completed is execution-guarded: evidence sealed, no shipped constructor, same correlation.
    const completed = balancedBody(contract, "pub fn completed(").replace(/\s+/g, " ");
    const completedSig = (contract.match(/pub fn completed\([\s\S]*?\)\s*->\s*Option<Self>/) || [""])[0].replace(/\s+/g, " ");
    if (!/authority: &AuthorisedProtectedOperation, evidence: &ExecutionOutcomeEvidence/.test(completedSig)) {
      e.push("O6 completed() no longer requires BOTH the authority and sealed execution evidence");
    }
    if (!/if evidence\.correlation\(\) != authority\.correlation\(\) \{ return None; \}/.test(completed)) {
      e.push("O6 completed() no longer refuses evidence about another correlation");
    }
    const evidenceDecl = blockBody(contract, "pub struct ExecutionOutcomeEvidence");
    if (!/_seal:\s*Seal/.test(evidenceDecl) || publicFields(evidenceDecl).length > 0) {
      e.push("O6 ExecutionOutcomeEvidence is not sealed with private fields");
    }
    // SAME CONTROL FOR THE EXECUTION EVIDENCE. Fabricated evidence renders a truthful-looking
    // `Completed` for a review that never ran, so its mint surface is as sensitive as the
    // authority's - and it had even less cover: no crate-wide block count, no trait-impl rule and
    // no alias rule. Raised by the ECC security review.
    // EXACTLY one, not "at most one": `> 1` would let the sole block be RELOCATED to another
    // module, where only the block-body scans - not the count - stand between a `Self {}` mint and
    // a truthful-looking `Completed`. Raised by the ECC code review.
    const evidenceBlocks = (crateSrc.match(/impl ExecutionOutcomeEvidence\s*\{/g) || []).length;
    if (evidenceBlocks !== 1) {
      e.push("O6 expected exactly one `impl ExecutionOutcomeEvidence` block in the shipped crate, found " + evidenceBlocks + "; the checks below only cover one");
    }
    const evidenceBodies = allBlockBodies(crateSrc, "impl ExecutionOutcomeEvidence {");
    const evidenceSelfAll = evidenceBodies
      .map((b) => (b.match(/(?<!-> )(?<!let )Self\s*\{/g) || []).length)
      .reduce((a, b) => a + b, 0);
    // OWNER-RATIFIED AMENDMENT 1 (PROJECTOS-HOST-REVIEW-PATH1A): EXACTLY ONE, no longer zero.
    //
    // "Zero shipped constructions" kept `Completed` unforgeable by keeping it IMPOSSIBLE: nothing
    // could ever be reported as finished, so the unattended review path could not exist. The property
    // this rule protects was never the count - it is "`Completed` cannot be rendered without
    // execution" - and it is now held by pinning WHERE the single mint is, WHO may reach it and WHAT
    // it may say, in the checks that follow. Any count other than one fails: zero means the path was
    // removed without this rule being revisited, two means a second route appeared.
    if (evidenceSelfAll !== 1) {
      e.push("O6 expected EXACTLY ONE shipped construction inside `impl ExecutionOutcomeEvidence`, found " + evidenceSelfAll + " (owner-ratified Amendment 1 permits one and only one)");
    }
    // NO MACRO INSIDE THE EVIDENCE IMPL EITHER. Every other sealed type carries this guard, and
    // this one did not: a `macro_rules!` defined in a SIBLING module and merely invoked here spells
    // neither `Self {` nor the type name, so it would expand to a second, unruled mint that every
    // count above reads straight past - and a fabricated outcome renders `Completed` for a review
    // that never ran. Raised by the ECC security review.
    for (const body of evidenceBodies) {
      if (/\b[a-z_][a-z0-9_]*!\s*[([{]/i.test(body)) {
        e.push("O6 a macro is invoked inside the ExecutionOutcomeEvidence impl; it could expand to a constructor this scan cannot see");
      }
    }
    if (/impl[^{;]*?\bfor\s+ExecutionOutcomeEvidence\b/.test(flatten(crateSrc))) {
      e.push("O6 a trait impl for ExecutionOutcomeEvidence exists; a trait could mint execution evidence");
    }
    const evidenceCtors = (crateSrc.match(/(?<!struct )(?<!impl )(?<!-> )ExecutionOutcomeEvidence\s*\{/g) || []).length;
    const evidenceSelf = (stripComments(stripNonShippedItems(balancedBody(contractRaw, "impl ExecutionOutcomeEvidence {"))).match(/Self\s*\{/g) || []).length;
    // A NAMED struct literal is still forbidden everywhere: the one permitted construction is the
    // `Self {` inside the single impl block, which only the defining module can spell.
    if (evidenceCtors !== 0) {
      e.push("O6 ExecutionOutcomeEvidence is constructed by a named struct literal; the only permitted mint is the one inside its impl block");
    }
    if (evidenceSelf !== 1) {
      e.push("O6 the operation-contract module must hold EXACTLY ONE shipped ExecutionOutcomeEvidence construction, found " + evidenceSelf);
    }

    // ---- AMENDMENT 1: THE SINGLE MINT IS PINNED, NOT MERELY COUNTED -------------------------------
    //
    // (a) PRIVATE. Only the defining module and its descendants can name it, so no downstream crate
    //     and no sibling module can call it.
    const mintDecls = (contract.match(/\bfn\s+from_completed_execution\s*\(/g) || []).length;
    if (mintDecls !== 1) {
      e.push("O6 expected exactly one `fn from_completed_execution`, found " + mintDecls);
    }
    if (/pub(?:\s*\([^)]*\))?\s+fn\s+from_completed_execution\s*\(/.test(contract)) {
      e.push("O6 the ExecutionOutcomeEvidence mint is not private; a public or crate-visible mint is reachable outside the execution rung");
    }
    const mintSig = (contract.match(/fn from_completed_execution\([\s\S]*?\)\s*->\s*Option<Self>/) || [""])[0].replace(/\s+/g, " ");
    if (!/authority: &AuthorisedProtectedOperation/.test(mintSig)) {
      e.push("O6 the ExecutionOutcomeEvidence mint no longer requires the authorised operation");
    }
    // (b) THE CORRELATION COMES OFF THE AUTHORITY. A mint that accepted a correlation could be aimed
    //     at a request nobody authorised.
    if (/correlation\s*:\s*\[u8/.test(mintSig)) {
      e.push("O6 the ExecutionOutcomeEvidence mint accepts a caller-supplied correlation");
    }
    const mintBody = balancedBody(contract, "fn from_completed_execution(").replace(/\s+/g, " ");
    if (!/correlation: \*authority\.correlation\(\)/.test(mintBody)) {
      e.push("O6 the ExecutionOutcomeEvidence mint does not take its correlation from the authority");
    }
    // (c) `NotRun` IS NOT MINTABLE. Evidence says an execution happened; "nothing ran" is a refusal
    //     and must travel as `Rejected`, never as `Completed`.
    if (!/if result == ResultClass::NotRun \{ return None; \}/.test(mintBody)) {
      e.push("O6 the ExecutionOutcomeEvidence mint no longer refuses ResultClass::NotRun; 'nothing ran' could be rendered Completed");
    }
    // (d) EXACTLY ONE CALL SITE IN THE SHIPPED CRATE, and it is inside the execution rung.
    const mintCalls = (crateSrc.match(/ExecutionOutcomeEvidence::from_completed_execution\s*\(/g) || []).length;
    if (mintCalls !== 1) {
      e.push("O6 expected exactly one shipped call to the ExecutionOutcomeEvidence mint, found " + mintCalls);
    }
    const COMPOSITION = path.join(IPC, "operation_contract", "host_composition.rs");
    const compositionSrc = stripComments(stripNonShippedItems(fs.readFileSync(COMPOSITION, "utf8")));
    const rung = balancedBody(compositionSrc, "pub fn run_authorised_review(");
    if (!rung) {
      e.push("O6 `run_authorised_review` is missing; the ExecutionOutcomeEvidence mint has no ruled caller");
    } else {
      const callAt = rung.search(/ExecutionOutcomeEvidence::from_completed_execution\s*\(/);
      const seamAt = rung.search(/execution\.execute\s*\(/);
      if (callAt < 0) {
        e.push("O6 the single ExecutionOutcomeEvidence mint is not called from run_authorised_review");
      }
      // (e) THE MINT FOLLOWS THE SEAM. Evidence minted before the execution was driven would be
      //     evidence of nothing.
      if (seamAt < 0) {
        e.push("O6 run_authorised_review no longer drives the sealed execution seam");
      } else if (callAt >= 0 && callAt < seamAt) {
        e.push("O6 run_authorised_review mints execution evidence BEFORE driving the execution seam");
      }
    }
    const rungSig = (compositionSrc.match(/pub fn run_authorised_review\([\s\S]*?\)\s*->\s*ProtectedOperationResponse/) || [""])[0].replace(/\s+/g, " ");
    if (!/composed: ComposedProtectedOperation/.test(rungSig)) {
      e.push("O6 run_authorised_review no longer consumes the composed, authorised operation");
    }
    if (!/execution: &mut dyn GatekeeperReviewExecution/.test(rungSig)) {
      e.push("O6 run_authorised_review no longer requires the sealed execution seam");
    }
    // A caller-supplied truth about execution is exactly what the seam exists to prevent.
    if (/:\s*bool\b/.test(rungSig) || /ResultClass/.test(rungSig) || /EVIDENCE_REF_LEN/.test(rungSig)) {
      e.push("O6 run_authorised_review accepts a caller-supplied execution fact (bool, result class or evidence reference)");
    }
    // (f) THE SEAM IS SEALED, by a supertrait in a module nothing outside this tree can name. Pinning
    //     where the mint is says nothing about WHO may claim an execution occurred; the seal does.
    if (!/pub trait GatekeeperReviewExecution\s*:\s*gatekeeper_review_execution::Sealed\b/.test(compositionSrc)) {
      e.push("O6 GatekeeperReviewExecution is not sealed; a downstream crate could claim an execution occurred");
    }
    if (/pub(?:\s*\([^)]*\))?\s+mod\s+gatekeeper_review_execution\b/.test(compositionSrc)) {
      e.push("O6 the module sealing GatekeeperReviewExecution is not private; its supertrait is nameable downstream");
    }
    if (!/\bmod\s+gatekeeper_review_execution\s*\{/.test(compositionSrc)) {
      e.push("O6 the private module sealing GatekeeperReviewExecution is missing");
    }
    // (g) AT MOST ONE SHIPPED IMPLEMENTOR, and only inside the composition's own module tree. A
    //     fixture implementor is compiled only under `test-fixtures` and is stripped before this scan.
    const compositionTree = path.join(IPC, "operation_contract", "host_composition");
    let shippedSeamImpls = 0;
    for (const f of crateFiles) {
      const src = stripComments(stripNonShippedItems(fs.readFileSync(f, "utf8")));
      const n = (src.match(/impl\s+(?:[A-Za-z_][A-Za-z0-9_]*::)*gatekeeper_review_execution::Sealed\s+for\b/g) || []).length;
      if (n === 0) continue;
      shippedSeamImpls += n;
      const inTree = f === COMPOSITION || f.startsWith(compositionTree + path.sep);
      if (!inTree) {
        e.push("O6 a shipped GatekeeperReviewExecution implementor exists outside the host_composition module tree: " + path.relative(ROOT, f));
      }
    }
    if (shippedSeamImpls > 1) {
      e.push("O6 more than one shipped GatekeeperReviewExecution implementor exists (" + shippedSeamImpls + "); exactly one Host-authored execution is permitted");
    }
    // 6i. The governed removals stay removed, crate-wide: no second session reference, no ignored field.
    for (const gone of ["client_session_ref", "SESSION_REF_LEN"]) {
      if (crateSrc.includes(gone) || stripComments(protocol).includes(gone)) {
        e.push("O6 the governed-removed `" + gone + "` reappeared; an authority-bearing request field must be bound or absent");
      }
    }
    // `[A-Za-z0-9_]`: the Rust identifier-continuation set. `[a-z_]+` missed camelCase and digits.
    const requestFields = enumerateFields(blockBody(contract, "pub struct ProtectedOperationRequest"));
    if (requestFields.join(",") !== "correlation,sequence,claimed_service_epoch,binding_digest,operation,approval_ref,parameter_digest") {
      e.push("O6 ProtectedOperationRequest fields changed: " + requestFields.join(",") + "; every field on the authority path must be bound");
    }
    // 6j. The behavioural proofs that pin the meaning are present by name.
    for (const t of [
      "the_exact_gatekeeper_review_is_authorised_and_renders_as_accepted_not_run",
      "a_fresh_authority_alone_cannot_render_completed",
      "a_replayed_request_cannot_reach_a_fresh_authority",
      "an_admission_on_another_connection_is_refused",
      "a_peer_from_another_handshake_generation_is_refused",
      "a_parameter_digest_that_is_not_the_hosts_is_refused",
      "provider_identity_read_and_staging_read_cannot_use_the_delegated_authority",
      "c4_remains_open_for_every_other_operation_class",
      "a_genuine_admission_rescues_no_earlier_refusal",
    ]) {
      // COMMENT-STRIPPED: a comment naming a test is not a test.
      if (!contract.includes("fn " + t + "(")) e.push("O6 the behavioural proof `" + t + "` is missing");
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
    // MASKED AND BALANCED, like every other body extraction in this file. The previous
    // `split(...)[1].split(/\n\}/)[0]` truncated at the first column-0 `}` in RAW text, so an
    // ordinary multi-line string constant carrying one hid every function after it from the
    // allowlist below. Raised by the ECC security review.
    const body = balancedBody(contract, "impl TrustedPeerContext {");
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
      if (publicFields(fields).length > 0) {
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
    // NOTE, DELIBERATE: this section's `crateSrc` is NOT passed through `stripNonShippedItems`,
    // unlike O6's. O12 counts the delegation's mints as EXACTLY TWO - the `cfg(test)` constructor
    // and the production one - so stripping the test-only item would make the expected count wrong
    // and the check would fail for the right code. Being over-inclusive here scans more, never
    // less, so it fails closed. Raised by the ECC code review.
    for (const sealedType of [
      "VerifiedOwnerProgrammeDelegation",
      "TrustedPeerContext",
      "AuthorisedProtectedOperation",
      // §9C: execution evidence is sealed for the same reason and gets the same alias protection.
      "ExecutionOutcomeEvidence",
    ]) {
      // `(?:::)?` CLOSES THE ABSOLUTE-PATH GAP (§9C): `type A = ::crate::Sealed;` begins the path
      // with a leading `::`, which `(?:\\w+::)*` alone could not consume, so the alias went unseen.
      const aliased = new RegExp("\\btype\\s+\\w+\\s*(?:<[^>]*>)?\\s*=\\s*(?:::)?(?:[\\w]+::)*" + sealedType + "\\b");
      if (aliased.test(crateSrc)) {
        e.push("O12 " + sealedType + " is rebound by a type alias; an inherent impl on the alias would be invisible to every check that names the type");
      }
      // SELF-TEST on the hostile forms, so the rule is shown to fire rather than assumed to.
      for (const [probe, mustFlag] of [
        ["type A = ::projectos_host_windows_local_ipc::" + sealedType + ";", true],
        ["type B = crate::operation_contract::" + sealedType + ";", true],
        ["type C = " + sealedType + ";", true],
        ["type D<'a> = &'a " + sealedType + "Ref;", false],
      ]) {
        if (aliased.test(probe) !== mustFlag) {
          e.push("O12 self-test failed for the alias rule on: " + probe);
        }
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
