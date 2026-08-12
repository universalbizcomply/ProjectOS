//! Dependency closure: prove the payload does not secretly need the development tree.
//!
//! THE FAILURE THIS EXISTS TO CATCH. A packaged build that is tested on the build machine passes
//! for the wrong reason: the repository is right there, `node_modules` is populated, the working
//! directory happens to be the checkout. Copy the same payload to a bare machine and it stops. The
//! only honest test is whether the payload REACHES OUTSIDE ITSELF, and that is decidable by reading
//! what the daemon bundle actually contains.
//!
//! A SINGLE FILE IS NOT A CLOSED FILE. esbuild will happily produce one artefact that still calls
//! `createRequire(import.meta.url)` and resolves `../../validators/plan-governance-engine.cjs` at
//! run time. That is one file and four escapes. Bundling answers "how many files"; this answers
//! "how many of them are enough".
//!
//! WHY EVERY FINDING BLOCKS. There is no advisory tier. A working-directory dependency that is
//! "probably dead code" is a dependency nobody has proved is dead, and a closure validator with a
//! severity dial is one review away from everything being advisory.
//!
//! Created in PROJECTOS-RECOVERY-INSTALLED-APP1A.

use std::path::{Path, PathBuf};

use projectos_packaged_runtime_contract as contract;

/// One concrete way the payload is not closed. Each carries where it was found, because a closure
/// failure the developer cannot locate is a closure failure nobody fixes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClosureFinding {
    /// A file in the payload that no manifest field describes. It would install unattested: present
    /// at run time, covered by no digest, named by no signature.
    UnattestedFile(PathBuf),
    /// The daemon resolves something ABOVE itself at run time — the development tree.
    SourceTreeEscape { line: usize, literal: String },
    /// The daemon's behaviour depends on where it was launched from.
    WorkingDirectoryDependency { line: usize },
    /// A filesystem read of a BARE relative filename, which resolves against the working directory.
    ///
    /// Its own finding kind because it is invisible to every other rule: `existsSync("bridge.config.json")`
    /// contains no `../`, is not drive-absolute, and is not a module specifier — yet it is the sole
    /// source of the daemon's governed roots, and in a payload it silently finds nothing. A payload
    /// that passed closure while reading its configuration from wherever it happened to be launched
    /// would be exactly the accidental dependency this validator exists to catch.
    WorkingDirectoryRelativeRead { line: usize, literal: String },
    /// A build-machine absolute path is baked into the artefact.
    AbsoluteBuildPath { line: usize, literal: String },
    /// An import/require of a package that was NOT bundled — it would be resolved from an ambient
    /// `node_modules` that a payload does not carry.
    UnbundledModule { line: usize, specifier: String },
    /// A literal reference to `node_modules`.
    NodeModulesReference { line: usize, literal: String },
    /// The daemon bundle could not be read as text, so nothing about it could be established.
    /// Refused rather than assumed clean.
    DaemonBundleUnreadable(PathBuf),
    /// A directory inside the payload could not be listed, so its contents were never examined.
    /// Reported rather than skipped: an unseen subtree is not an empty one.
    PayloadDirectoryUnreadable(PathBuf),
}

/// The verdict. `is_closed()` is the only question a caller should ask.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClosureReport {
    pub findings: Vec<ClosureFinding>,
    /// Every file found in the payload, for the record.
    pub files: Vec<PathBuf>,
}

impl ClosureReport {
    /// A payload is closed only when nothing was found. There is no threshold.
    pub fn is_closed(&self) -> bool {
        self.findings.is_empty()
    }
}

/// The explicit scheme form of a Node built-in.
const BUILTIN_SCHEME: &str = "node:";

/// Node built-ins by bare name.
///
/// WHY THIS LIST EXISTS, AND WHY IT IS NOT A RELAXATION. The rule used to be "a specifier without
/// the `node:` scheme is a package that had to come from somewhere", which held only while every
/// linked module was first-party ESM written with the scheme. Linking the canonical CommonJS
/// governance engines brought in `require("path")`, `require("fs")` and `require("crypto")` — the
/// scheme-less spelling CommonJS has always used.
///
/// A bare built-in name cannot be an ambient dependency: Node resolves built-ins BEFORE consulting
/// `node_modules`, so `require("fs")` reaches the runtime's own module whatever is installed. There
/// is no payload for it to be missing from. A bare specifier that is NOT on this list — `leftpad`,
/// `@projectos/agent` — is still reported exactly as before.
///
/// KEEP IN STEP with the set in `control-center/packaging/build-daemon-bundle.mjs`. That one decides
/// what the packaged daemon may resolve at RUN time; this one decides what the validator accepts at
/// build time. They were briefly out of step over `zlib` — the banner allowed it, this list did not,
/// so a linked module using it would have been reported as an unbundled package while running fine.
const NODE_BUILTINS: [&str; 36] = [
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "stream",
    "string_decoder",
    "timers",
    "tls",
    "tty",
    "url",
    "util",
    "v8",
    "worker_threads",
    "zlib",
];

/// True for `node:fs`, `fs`, and `fs/promises`-style sub-paths of a built-in.
fn is_node_builtin(specifier: &str) -> bool {
    let bare = specifier.strip_prefix(BUILTIN_SCHEME).unwrap_or(specifier);
    let root = bare.split('/').next().unwrap_or(bare);
    NODE_BUILTINS.contains(&root)
}

/// True when a literal REFERENCES a `node_modules` directory, rather than merely containing the word.
///
/// WHY THIS IS PRECISION AND NOT PERMISSION. The rule used to fire on any literal containing
/// `node_modules`, which reported two directory-name lists — the bridge daemon's `ignoredFolders`
/// and the discovery engine's `SKIP_DIRS`, both of which exist to SKIP `node_modules` — as though
/// they were dependencies on it. A bare token in a set of names resolves nothing.
///
/// A reference has a separator against it: `node_modules/pkg`, `…/node_modules`, the Windows
/// spellings. Those still fire. And a bare `node_modules` used where a module specifier belongs is
/// still caught by `UnbundledModule`, because it is not a Node built-in.
fn references_node_modules(literal: &str) -> bool {
    const NEEDLE: &str = "node_modules";
    let bytes = literal.as_bytes();
    let sep = |c: u8| c == b'/' || c == b'\\';
    literal.match_indices(NEEDLE).any(|(at, _)| {
        let before = at.checked_sub(1).map(|i| sep(bytes[i])).unwrap_or(false);
        let after = bytes
            .get(at + NEEDLE.len())
            .copied()
            .map(sep)
            .unwrap_or(false);
        before || after
    })
}

/// Callees whose FIRST argument is a module specifier.
const SPECIFIER_CALLEES: [&str; 2] = ["require", "import"];

/// Callees whose FIRST argument is a path resolved against the working directory when it is
/// relative. Unlike a module specifier, a bare name here is not a package — it is a file nobody
/// located.
const FS_READ_CALLEES: [&str; 11] = [
    "existsSync",
    "readFileSync",
    "readdirSync",
    "statSync",
    "lstatSync",
    "openSync",
    "createReadStream",
    "readFile",
    "accessSync",
    "access",
    "opendirSync",
];

/// One string literal found in the artefact, with everything needed to judge it.
struct Literal {
    /// 1-based line on which the literal OPENED.
    line: usize,
    /// The text preceding it on that line — enough to identify the callee it is an argument of.
    before: String,
    /// The decoded contents.
    value: String,
}

/// Extract every string literal in the WHOLE artefact, carrying quote state across newlines.
///
/// WHOLE TEXT, NOT LINE BY LINE, and that distinction is the difference between a gate and a
/// decoration. Scanning each physical line independently meant a template literal containing a real
/// newline — ordinary for multi-line messages — was truncated at the line break, and everything
/// after it was read as bare code rather than as string contents. A development-tree path sitting on
/// the second line of such a literal matched no rule at all, so the payload was reported closed. A
/// minifier does not save you either: it cannot delete a newline that is part of a template
/// literal's runtime value.
///
/// Byte offsets, not character indices: `before` is produced by slicing the text, and slicing a
/// `str` by a character index is wrong the moment a line contains a non-ASCII character — which
/// bundled JavaScript regularly does.
///
/// Deliberately simple: it tracks the opening quote and honours backslash escapes, which is enough
/// for generated bundle output. It is not a JavaScript parser and does not need to be — it is
/// looking for evidence, and a literal it mis-parses produces a finding to investigate, never a
/// silent pass.
fn string_literals(text: &str) -> Vec<Literal> {
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let bytes: Vec<char> = chars.iter().map(|(_, c)| *c).collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    let mut line_no = 1usize;
    let mut line_start = 0usize;
    while i < bytes.len() {
        let c = bytes[i];
        if c == '\n' {
            line_no += 1;
            line_start = chars[i].0 + 1;
            i += 1;
            continue;
        }
        // COMMENTS ARE SKIPPED, and they must be. Generated bundles keep the module-path comments
        // esbuild emits and plenty of ordinary prose, and prose contains apostrophes. Treating an
        // apostrophe in `the owner's key` as an opening quote made the scanner swallow whole spans
        // of the artefact and report every line of them — a validator that cries wolf on 200 lines
        // of comments is one that gets switched off.
        if c == '/' && bytes.get(i + 1) == Some(&'/') {
            while i < bytes.len() && bytes[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && bytes.get(i + 1) == Some(&'*') {
            i += 2;
            while i < bytes.len() && !(bytes[i] == '*' && bytes.get(i + 1) == Some(&'/')) {
                if bytes[i] == '\n' {
                    line_no += 1;
                    line_start = chars[i].0 + 1;
                }
                i += 1;
            }
            i += 2;
            continue;
        }
        if c == '"' || c == '\'' || c == '`' {
            let quote = c;
            let start = chars[i].0;
            let start_line = line_no;
            let start_line_start = line_start;
            let mut buf = String::new();
            i += 1;
            while i < bytes.len() {
                if bytes[i] == '\n' {
                    // Only a template literal may contain a raw newline. For `'` and `"` a raw
                    // newline ENDS the literal, exactly as JavaScript says — and that rule is also
                    // what stops one stray quote from consuming the rest of the file.
                    if quote != '`' {
                        // This newline both closes the literal and ends the line. Count it here:
                        // the outer loop's `i += 1` steps over it without looking, and every
                        // finding after this point would otherwise be reported one line early.
                        line_no += 1;
                        line_start = chars[i].0 + 1;
                        break;
                    }
                    line_no += 1;
                    line_start = chars[i].0 + 1;
                    buf.push('\n');
                    i += 1;
                    continue;
                }
                if bytes[i] == '\\' {
                    // DECODE the escape rather than dropping it. Dropping was a real bug: a JS
                    // source literal `"C:\\dev\\ProjectOS"` would collapse to `C:devProjectOS`,
                    // which no longer looks like an absolute path — so the one finding that matters
                    // most, a build-machine path baked into the artefact, went unreported. Pushing
                    // the escaped character turns `\\` back into `\` and `\"` back into `"`.
                    //
                    // Approximate for the non-path escapes: `\n` decodes to `n`. That is harmless
                    // here — it can only ever remove a character from a path, never invent one — but
                    // it does mean a deliberately `\u`-obfuscated path would evade this scan. This
                    // validator reads our OWN generated bundle, not adversarial input.
                    if let Some(next) = bytes.get(i + 1) {
                        buf.push(*next);
                    }
                    i += 2;
                    continue;
                }
                if bytes[i] == quote {
                    break;
                }
                buf.push(bytes[i]);
                i += 1;
            }
            out.push(Literal {
                line: start_line,
                before: text[start_line_start..start].to_string(),
                value: buf,
            });
        }
        i += 1;
    }
    out
}

/// A Windows absolute path in any of the forms this codebase actually produces.
///
/// Drive-letter (`C:\dev\…`, `C:/dev/…`) was the only form checked at first, which missed both UNC
/// (`\\server\share\…`) and the extended-length prefix (`\\?\C:\…`). The second omission mattered:
/// `fs::canonicalize` on Windows returns `\\?\`-prefixed paths, which is why this very codebase
/// carries a `strip_verbatim` helper. A build-machine path in that form would have tripped no rule
/// at all and passed closure silently.
fn is_absolute_path(s: &str) -> bool {
    let b = s.as_bytes();
    // UNC and extended-length both begin with two BACKSLASHES. Accepting `//` here as well was a
    // false positive that mattered: every `// comment` in the artefact became an "absolute build
    // path", which is the failure mode that makes a validator ignored rather than fixed.
    if b.len() >= 2 && b[0] == b'\\' && b[1] == b'\\' {
        return true;
    }
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

/// The normalised name of the function this literal is the first argument of, if any.
///
/// RENAME-TOLERANT, and it has to be. A bundler deduplicates identifiers by suffixing them, so the
/// real artefact contains `existsSync3("bridge.config.json")` and `require_(...)`, not the names
/// anybody wrote. Matching the literal source names missed BOTH — the scanner reported a payload
/// clean while it was reading its configuration from the working directory. Trailing digits and
/// underscores, and leading underscores, are stripped before comparison.
///
/// `require.resolve(…)` names a module without importing it, and resolves it from an ambient
/// `node_modules` exactly as `require` would. The callee reads as `resolve`, so it is recognised
/// only when the property access it belongs to is a require.
const RESOLVE_CALLEE: &str = "resolve";

fn callee_before(before: &str) -> Option<String> {
    let trimmed = before.trim_end();
    let head = trimmed.strip_suffix('(')?;
    let ident: String = head
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let normalised = ident
        .trim_end_matches(|c: char| c.is_ascii_digit() || c == '_')
        .trim_start_matches('_');
    if normalised.is_empty() {
        return None;
    }
    // `require.resolve("pkg")` — attribute the call to the require, not to the property.
    if normalised == RESOLVE_CALLEE {
        let owner = head[..head.len() - ident.len()].trim_end();
        if let Some(obj) = owner.strip_suffix('.') {
            let obj_ident: String = obj
                .chars()
                .rev()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let obj_norm = obj_ident
                .trim_end_matches(|c: char| c.is_ascii_digit() || c == '_')
                .trim_start_matches('_');
            if SPECIFIER_CALLEES.contains(&obj_norm) {
                return Some(obj_norm.to_string());
            }
        }
    }
    Some(normalised.to_string())
}

/// True when this literal is a static-import specifier (`from "…"`).
fn is_static_import_specifier(before: &str) -> bool {
    before.trim_end().ends_with("from")
}

/// A path that resolves against the working directory: relative, and not a drive-absolute or
/// root-anchored path.
fn is_working_directory_relative(s: &str) -> bool {
    !is_absolute_path(s) && !s.starts_with('/') && !s.starts_with('\\')
}

/// Scan the daemon bundle's text for the ways an artefact reaches outside itself.
fn scan_daemon_bundle(text: &str) -> Vec<ClosureFinding> {
    let mut findings = Vec::new();

    // A working-directory dependency needs no string literal to be a dependency.
    for (idx, line) in text.lines().enumerate() {
        if line.contains("process.cwd()") {
            findings.push(ClosureFinding::WorkingDirectoryDependency { line: idx + 1 });
        }
    }

    for lit in string_literals(text) {
        if lit.value.is_empty() {
            continue;
        }
        // CONTENT rules run per LINE of the literal, not on the literal as a whole. A template
        // literal that spans lines holds several independent path-shaped things, and a prefix test
        // like `is_absolute_path` only ever inspects the start — so `C:\dev\…` sitting on the
        // literal's SECOND line would be examined as the tail of a string beginning "line one" and
        // match nothing. Splitting also keeps the reported line number pointing at the offending
        // text rather than at wherever the quote happened to open.
        for (offset, segment) in lit.value.split('\n').enumerate() {
            let line_no = lit.line + offset;
            let segment = segment.trim();
            if segment.is_empty() {
                continue;
            }
            if references_node_modules(segment) {
                findings.push(ClosureFinding::NodeModulesReference {
                    line: line_no,
                    literal: segment.to_string(),
                });
            }
            if is_absolute_path(segment) {
                findings.push(ClosureFinding::AbsoluteBuildPath {
                    line: line_no,
                    literal: segment.to_string(),
                });
                continue;
            }
            // `../` means something above the artefact is addressed. In a BUNDLED artefact every
            // genuine relative import has already been inlined, so a surviving `../` is a run-time
            // resolution, not a build-time one.
            if segment.starts_with("../")
                || segment.contains("/../")
                || segment.contains(r"\..\")
                || segment.contains(" ../")
            {
                findings.push(ClosureFinding::SourceTreeEscape {
                    line: line_no,
                    literal: segment.to_string(),
                });
            }
        }

        // POSITION rules apply to the literal as a whole: the callee sits before the opening quote,
        // and it is the whole literal that is passed as the argument.
        let literal = &lit.value;
        if literal.contains('\n') || is_absolute_path(literal) || literal.starts_with("../") {
            continue;
        }
        let callee = callee_before(&lit.before);
        if callee
            .as_deref()
            .is_some_and(|c| FS_READ_CALLEES.contains(&c))
            && is_working_directory_relative(literal)
        {
            findings.push(ClosureFinding::WorkingDirectoryRelativeRead {
                line: lit.line,
                literal: literal.clone(),
            });
            continue;
        }
        let is_specifier = is_static_import_specifier(&lit.before)
            || callee
                .as_deref()
                .is_some_and(|c| SPECIFIER_CALLEES.contains(&c));
        if is_specifier
            && !is_node_builtin(literal)
            && !literal.starts_with('.')
            && !literal.starts_with('/')
        {
            findings.push(ClosureFinding::UnbundledModule {
                line: lit.line,
                specifier: literal.clone(),
            });
        }
    }
    findings
}

/// Every file beneath `root`, relative to it, sorted so the report is deterministic.
///
/// A directory that cannot be READ is reported, not skipped. Silently returning on `read_dir`
/// failure was a genuine under-report: the files beneath an unreadable directory would never be
/// enumerated, so none of them could be flagged as unattested, and a payload with a whole subtree
/// the validator could not see would be declared closed. "I could not look" and "there is nothing
/// there" are different answers, and only one of them is safe to act on.
fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>, unreadable: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        unreadable.push(dir.strip_prefix(root).unwrap_or(dir).to_path_buf());
        return;
    };
    let mut items: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    items.sort();
    for path in items {
        if path.is_dir() {
            walk(root, &path, out, unreadable);
        } else if let Ok(rel) = path.strip_prefix(root) {
            out.push(rel.to_path_buf());
        }
    }
}

/// Compare a payload-relative path against a contract constant, tolerating separator style.
fn same_relative(actual: &Path, declared: &str) -> bool {
    actual == Path::new(declared)
}

/// Verify that an assembled payload is closed.
///
/// The payload may contain the runtime, the daemon bundle, the manifest and the canonical signing
/// bytes — and nothing else. The daemon bundle is scanned for run-time reaches outside the payload.
///
/// SCOPE: THIS IS A PAYLOAD, NOT AN INSTALL ROOT — and that collision is now RESOLVED.
///
/// `payload_root` contains those four files and nothing more. It was previously in tension with
/// `evaluate()`, which bound the manifest's relative paths beneath the running executable's own
/// directory: the installed application also holds the Control Centre executable,
/// `WebView2Loader.dll` and icons, so "everything here is attested" could never be true and this
/// walk would have reported the application's own files as unattested.
///
/// The payload is now an app-owned SUBDIRECTORY of the install root, named once by the packaging
/// contract (`PAYLOAD_RELATIVE_ROOT`), and `EvalContext::payload_root` binds beneath that. So the
/// two roots are separate things with separate names, this walk enumerates a closed set, and the
/// installer's job is simply to place the payload directory where the contract says.
pub fn verify_closure(payload_root: &Path) -> ClosureReport {
    let mut files = Vec::new();
    let mut unreadable = Vec::new();
    walk(payload_root, payload_root, &mut files, &mut unreadable);

    let attested = [
        contract::RUNTIME_RELATIVE_PATH,
        contract::DAEMON_RELATIVE_PATH,
        contract::TRUST_MANIFEST_FILENAME,
        contract::CANONICAL_SIGNING_FILENAME,
    ];
    let mut findings: Vec<ClosureFinding> = unreadable
        .into_iter()
        .map(ClosureFinding::PayloadDirectoryUnreadable)
        .collect();
    findings.extend(
        files
            .iter()
            .filter(|f| !attested.iter().any(|a| same_relative(f, a)))
            .map(|f| ClosureFinding::UnattestedFile(f.clone())),
    );

    let daemon = payload_root.join(Path::new(contract::DAEMON_RELATIVE_PATH));
    match std::fs::read(&daemon)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
    {
        Some(text) => findings.extend(scan_daemon_bundle(&text)),
        None => findings.push(ClosureFinding::DaemonBundleUnreadable(daemon)),
    }

    ClosureReport { findings, files }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_runtime_require_above_the_artefact_is_an_escape() {
        let f = scan_daemon_bundle(
            "const engine = require_(resolve(here, \"../../validators/plan-governance-engine.cjs\"));",
        );
        assert!(matches!(
            f.as_slice(),
            [ClosureFinding::SourceTreeEscape { line: 1, .. }]
        ));
    }

    #[test]
    fn node_builtins_are_not_unbundled_modules() {
        let f = scan_daemon_bundle("import { readFileSync } from \"node:fs\";");
        assert!(
            f.is_empty(),
            "node: builtins are provided by the runtime: {f:?}"
        );
    }

    /// Built-ins by BARE name are provided by the runtime. CommonJS has always spelled them this
    /// way, and Node resolves them before it consults `node_modules`, so there is no payload for
    /// them to be missing from.
    #[test]
    fn bare_node_builtins_are_not_unbundled_modules() {
        for line in [
            "var path = __require(\"path\");",
            "var fs = __require(\"fs\");",
            "var crypto = __require(\"crypto\");",
            "import { readFile } from \"fs/promises\";",
            "import { x } from \"node:stream/web\";",
        ] {
            let f = scan_daemon_bundle(line);
            assert!(f.is_empty(), "{line} must not be reported: {f:?}");
        }
    }

    /// ...and the relaxation stops exactly there. A bare specifier that is NOT a built-in is still a
    /// package that had to come from somewhere.
    #[test]
    fn a_bare_non_builtin_specifier_is_still_reported() {
        for spec in ["leftpad", "@projectos/agent", "node_modules", "fs-extra"] {
            let f = scan_daemon_bundle(&format!("var m = __require(\"{spec}\");"));
            assert!(
                f.iter()
                    .any(|x| matches!(x, ClosureFinding::UnbundledModule { .. })),
                "{spec} must still be reported: {f:?}"
            );
        }
    }

    /// `node_modules` as a directory NAME in an ignore list resolves nothing. Both the bridge
    /// daemon's `ignoredFolders` and the discovery engine's `SKIP_DIRS` list it in order to SKIP it.
    #[test]
    fn node_modules_as_a_bare_directory_name_is_not_a_reference() {
        let f = scan_daemon_bundle(
            "var SKIP_DIRS = new Set([\".git\", \"node_modules\", \"dist\", \"target\"]);",
        );
        assert!(
            !f.iter()
                .any(|x| matches!(x, ClosureFinding::NodeModulesReference { .. })),
            "{f:?}"
        );
    }

    /// ...but an actual PATH into `node_modules` still is, in every spelling.
    #[test]
    fn a_path_into_node_modules_is_still_reported() {
        for p in [
            "node_modules/leftpad/index.js",
            "./node_modules/x",
            "C:/dev/ProjectOS/node_modules",
            r"..\node_modules\x",
            "/usr/lib/node_modules/y",
        ] {
            let f = scan_daemon_bundle(&format!("var p = \"{}\";", p.replace('\\', "\\\\")));
            assert!(
                f.iter()
                    .any(|x| matches!(x, ClosureFinding::NodeModulesReference { .. })),
                "{p} must still be reported: {f:?}"
            );
        }
    }

    #[test]
    fn a_package_that_survived_bundling_is_reported() {
        let f = scan_daemon_bundle("import { BridgeDaemon } from \"@projectos/bridge-daemon\";");
        assert!(matches!(
            f.as_slice(),
            [ClosureFinding::UnbundledModule { specifier, .. }] if specifier == "@projectos/bridge-daemon"
        ));
    }

    #[test]
    fn a_build_machine_path_is_reported() {
        let f = scan_daemon_bundle(r#"const root = "C:\\dev\\ProjectOS";"#);
        assert!(
            matches!(f.as_slice(), [ClosureFinding::AbsoluteBuildPath { .. }]),
            "{f:?}"
        );
    }

    #[test]
    fn a_working_directory_dependency_is_reported() {
        let f = scan_daemon_bundle("  return process.cwd();");
        assert!(matches!(
            f.as_slice(),
            [ClosureFinding::WorkingDirectoryDependency { line: 1 }]
        ));
    }

    /// THE false negative this scanner originally had.
    ///
    /// `existsSync("bridge.config.json")` is the daemon's only source of governed roots. It contains
    /// no `../`, is not drive-absolute and is not a module specifier, so every other rule was blind
    /// to it — a payload could have passed closure while reading its configuration from whatever
    /// directory it happened to be launched in, and finding nothing.
    #[test]
    fn a_bare_relative_filesystem_read_is_reported() {
        for line in [
            "  const raw = existsSync('bridge.config.json') ? readFileSync('bridge.config.json', 'utf8') : null;",
            "readFileSync(\"./config/local.json\", \"utf8\")",
            "const d = readdirSync(`plans`);",
        ] {
            let f = scan_daemon_bundle(line);
            assert!(
                f.iter()
                    .any(|x| matches!(x, ClosureFinding::WorkingDirectoryRelativeRead { .. })),
                "{line} must be reported: {f:?}"
            );
        }
    }

    /// ...and an encoding argument is not a path. Without this the rule would fire on the `"utf8"`
    /// of every read in the bundle and drown the real findings.
    #[test]
    fn a_later_argument_is_not_treated_as_a_path() {
        let f = scan_daemon_bundle("readFileSync(resolvedAbsolutePath, \"utf8\");");
        assert!(f.is_empty(), "{f:?}");
    }

    /// A read of an absolute path is not a working-directory dependency.
    #[test]
    fn an_absolute_read_is_not_a_working_directory_dependency() {
        let f = scan_daemon_bundle("existsSync(\"/etc/hosts\")");
        assert!(
            !f.iter()
                .any(|x| matches!(x, ClosureFinding::WorkingDirectoryRelativeRead { .. })),
            "{f:?}"
        );
    }

    /// A bundler renames imported identifiers to deduplicate them. Matching the names people WROTE
    /// missed the real artefact entirely: it contains `existsSync3(` and `require_(`, not
    /// `existsSync(` and `require(`.
    #[test]
    fn bundler_renamed_callees_are_still_recognised() {
        let f = scan_daemon_bundle("  const raw = existsSync3(\"bridge.config.json\");");
        assert!(
            matches!(
                f.as_slice(),
                [ClosureFinding::WorkingDirectoryRelativeRead { literal, .. }]
                    if literal == "bridge.config.json"
            ),
            "{f:?}"
        );
        let g = scan_daemon_bundle("const m = require_2(\"leftpad\");");
        assert!(
            matches!(g.as_slice(), [ClosureFinding::UnbundledModule { specifier, .. }] if specifier == "leftpad"),
            "{g:?}"
        );
    }

    /// UNC and extended-length absolute paths are absolute. The `\\?\` form is what
    /// `fs::canonicalize` produces on Windows, so it is the one most likely to be baked in by
    /// accident — and it used to trip no rule at all.
    #[test]
    fn unc_and_extended_length_paths_are_absolute() {
        for p in [
            r"\\?\C:\dev\ProjectOS",
            r"\\server\share\thing",
            r"C:\dev",
            "C:/dev",
        ] {
            assert!(is_absolute_path(p), "{p} must be absolute");
        }
        for p in ["bridge.config.json", "./x", "../x", "node:fs", ""] {
            assert!(!is_absolute_path(p), "{p} must not be absolute");
        }
        let f = scan_daemon_bundle(r#"const r = "\\\\?\\C:\\dev\\ProjectOS\\projectos";"#);
        assert!(
            f.iter()
                .any(|x| matches!(x, ClosureFinding::AbsoluteBuildPath { .. })),
            "{f:?}"
        );
    }

    /// Byte offsets, not character indices: a non-ASCII character earlier on the line must not shift
    /// the slice used to inspect what precedes a literal.
    #[test]
    fn a_non_ascii_line_still_locates_the_text_before_a_literal() {
        let f = scan_daemon_bundle("const msg = \"— dash —\"; import x from \"leftpad\";");
        assert!(
            matches!(
                f.as_slice(),
                [ClosureFinding::UnbundledModule { specifier, .. }] if specifier == "leftpad"
            ),
            "{f:?}"
        );
    }

    /// A closed artefact produces nothing at all. Without this the scanner could be vacuously strict.
    #[test]
    fn a_closed_artefact_produces_no_findings() {
        let f = scan_daemon_bundle(
            "import { readFileSync } from \"node:fs\";\n\
             const here = new URL(\"./data.json\", import.meta.url);\n\
             console.log(readFileSync(here, \"utf8\"));\n",
        );
        assert!(f.is_empty(), "{f:?}");
    }

    #[test]
    fn escaped_quotes_do_not_end_a_literal_early() {
        let lits = string_literals(r#"const s = "a\"../b" ;"#);
        assert_eq!(
            lits.len(),
            1,
            "the escaped quote must not close the literal"
        );
        assert_eq!(
            lits[0].value, r#"a"../b"#,
            "the escape must decode, not vanish"
        );
    }

    /// THE cross-line false negative.
    ///
    /// A template literal may contain a real newline. Scanning line by line truncated it at the
    /// break, so anything on the following physical lines was read as bare code rather than as
    /// string contents — and a development-tree path sitting there matched no rule at all. The
    /// artefact was reported closed while carrying exactly what closure exists to forbid.
    #[test]
    fn a_literal_spanning_lines_is_still_scanned() {
        let text = "const banner = `ProjectOS\n\
                    loading ../../validators/plan-governance-engine.cjs\n\
                    done`;\n";
        let f = scan_daemon_bundle(text);
        assert!(
            f.iter()
                .any(|x| matches!(x, ClosureFinding::SourceTreeEscape { .. })),
            "a path inside a multi-line literal must still be found: {f:?}"
        );

        // Same for a build-machine path, and for node_modules.
        let g = scan_daemon_bundle("const s = `line one\nC:\\\\dev\\\\ProjectOS\\\\x`;\n");
        assert!(
            g.iter()
                .any(|x| matches!(x, ClosureFinding::AbsoluteBuildPath { .. })),
            "{g:?}"
        );
    }

    /// A literal that opens on one line and closes on another must not desynchronise the line
    /// numbers of everything after it, or every later finding points a reader at the wrong place.
    #[test]
    fn line_numbers_survive_a_multiline_literal() {
        let text = "const a = `one\ntwo\nthree`;\nconst b = \"../../escape\";\n";
        let f = scan_daemon_bundle(text);
        let escape = f
            .iter()
            .find(|x| matches!(x, ClosureFinding::SourceTreeEscape { .. }))
            .expect("escape must be found");
        assert!(
            matches!(escape, ClosureFinding::SourceTreeEscape { line: 4, .. }),
            "{escape:?}"
        );
    }

    /// Comments are not evidence, and prose is full of apostrophes.
    ///
    /// Scanning comments made two things go wrong at once: `// a comment` matched the UNC rule and
    /// was reported as a build-machine path, and an apostrophe in `the owner's key` opened a literal
    /// that ran on until the next apostrophe, dragging unrelated lines into findings. Against the
    /// real artefact that turned 11 genuine findings into hundreds, which is how a validator becomes
    /// something people switch off.
    #[test]
    fn comments_are_not_scanned_and_do_not_produce_findings() {
        let text = "// The AUTHORITY is the owner's; a draft may do.\n\
                    /* ../agent/dist/commands/plan.js\n\
                       C:\\dev\\ProjectOS\\node_modules */\n\
                    const ok = 1;\n";
        let f = scan_daemon_bundle(text);
        assert!(f.is_empty(), "comments must produce no findings: {f:?}");
    }

    /// A stray apostrophe in code must not consume the rest of the file. In JavaScript a raw newline
    /// ends a `'`/`"` literal, and honouring that is what bounds the damage.
    #[test]
    fn an_unbalanced_quote_stops_at_the_end_of_its_line() {
        let text = "const s = 'unterminated\nconst t = \"../../escape\";\n";
        let f = scan_daemon_bundle(text);
        assert!(
            matches!(
                f.as_slice(),
                [ClosureFinding::SourceTreeEscape { line: 2, .. }]
            ),
            "the next line must still be scanned on its own terms: {f:?}"
        );
    }

    /// `require.resolve("pkg")` names an ambient package without importing it. The callee reads as
    /// `resolve`, so it is attributed to the require rather than to the property.
    #[test]
    fn require_resolve_is_an_unbundled_module() {
        let f = scan_daemon_bundle("const p = require.resolve(\"leftpad\");");
        assert!(
            matches!(f.as_slice(), [ClosureFinding::UnbundledModule { specifier, .. }] if specifier == "leftpad"),
            "{f:?}"
        );
    }

    /// The regression behind the decode fix: a doubled backslash in JS source is ONE backslash in
    /// the string, and dropping it made a build-machine path unrecognisable.
    #[test]
    fn a_doubled_backslash_decodes_to_one_and_stays_an_absolute_path() {
        let lits = string_literals(r#"const root = "C:\\dev\\ProjectOS";"#);
        assert_eq!(lits[0].value, r"C:\dev\ProjectOS");
        assert!(is_absolute_path(&lits[0].value));
    }
}
