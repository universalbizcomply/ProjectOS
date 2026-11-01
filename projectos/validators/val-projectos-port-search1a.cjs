"use strict";
/**
 * CITED SEARCH — PROJECTOS-PORT-SEARCH1A (plan v1.31, V4 Stage 3, C8 and C10).
 *
 * The retrieval core is ported from OpenClaw under MIT, and the rest is ours. Search now puts file text in front
 * of whatever reads it, so every softening of this phase reads reasonably in a diff:
 *
 *   PS-1  "one more helper file"                 — and an uncredited file lands in a port directory
 *   PS-2  "the header says OpenClaw"             — and it no longer says which upstream file
 *   PS-3  "it is obviously ours"                 — and a file carries no statement of origin
 *   PS-4  "the credit rule runs elsewhere"       — and a ported file has no notices entry
 *   PS-5  "core can read one file"               — and the pure kernel has a file system and a clock
 *   PS-6  "the index only needs a little more"   — and it writes, spawns or fetches
 *   PS-7  "it is only a small package"           — and a dependency lands outside the locked stack
 *   PS-8  "vectors are nearly free"              — and embeddings, a provider or an extension arrive unapproved
 *   PS-9  "most results have a source"           — and an uncited result reaches a reader
 *   PS-10 "the project is implied"               — and one project reads another's documents
 *   PS-11 "filter them afterwards"               — and a row that cannot be cited sets the ranking
 *   PS-12 "the model said it cited something"    — and an answer with a made-up citation passes
 *   PS-13 "text is text"                         — and document text is read as if it meant something
 *   PS-14 "a marker is enough"                   — and a document closes its own fence
 *   PS-15 "the query is just a string"           — and FTS5 syntax or SQL arrives through it
 *   PS-16 "update it in place"                   — and a failed rebuild leaves half an index
 *   PS-17 "the code checks that"                 — and the table holds a row with no citation
 *   PS-18 "index the whole repository"           — and a link or a key file is read
 *   PS-19 "chunk it and see"                     — and a chunk exists that cannot be cited
 *   PS-20 "the old chunks are close enough"      — and a citation names lines from old boundaries
 *   PS-21 "tidy memory in the background"        — and autonomous consolidation arrives
 *   PS-22 "export it later"                      — and the next phase re-implements it
 *   PS-23 "register it later"                    — and nothing ever runs this file
 *   PS-T  "the tests exist"                      — and `.skip` keeps the proof while dropping the run
 *
 * THE MUTATIONS ARE IN THE BODIES. A pin on a call site survives a gutted function, so pins are taken from inside
 * the function that decides. `selfTest` applies each mutation in memory and counts it killed only when its own
 * rule fires and no rule it did not declare. The real tree passing with no mutation is the positive control:
 * a validator that refused everything would fail there first.
 *
 * Comments are stripped before anything is judged, except the credit header, which lives in comments.
 * Reads files; runs nothing. The credit judgement is borrowed from val-projectos-port-credit1a, unchanged.
 */

const fs = require("fs");
const path = require("path");
const credit = require("./val-projectos-port-credit1a.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-port-search1a";
const CORE_DIR = "projectos/core/src/search";
const AGENT_DIR = "projectos/agent/src/search";
const NOTICES_REL = "THIRD_PARTY_NOTICES";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const CORE_BARREL_REL = "projectos/core/src/index.ts";
const CORE_PACKAGE_REL = "projectos/core/package.json";
const AGENT_PACKAGE_REL = "projectos/agent/package.json";
/** A pseudo-file: what the two directories really hold, one path a line, so a stray file can be mutated in. */
const LISTING = "@listing";

const COMMIT = "c5b56f2505c4f6a5803125d2923e2934c5f750af";
const core = (name) => `${CORE_DIR}/${name}`;
const agent = (name) => `${AGENT_DIR}/${name}`;
const CITATION = core("citation.ts");
const CITED = core("citedSearch.ts");
const CHUNKS = core("chunkRecords.ts");
const FTS = core("ftsMatch.ts");
const FENCE = core("untrustedExcerpt.ts");
const MARKDOWN = core("markdownChunks.ts");
const BARREL = core("index.ts");
const INDEX = agent("localIndex.ts");
const WALK = agent("documentSources.ts");

/** Every ported file and exactly the upstream files it came from. */
const PORTED = {
  [core("hybrid.ts")]: ["extensions/memory-core/src/memory/hybrid.ts"],
  [core("mmr.ts")]: ["extensions/memory-core/src/memory/mmr.ts"],
  [core("temporalDecay.ts")]: ["extensions/memory-core/src/memory/temporal-decay.ts"],
  [core("tokenize.ts")]: ["extensions/memory-core/src/memory/tokenize.ts", "packages/normalization-core/src/string-coerce.ts"],
  [core("keywordQuery.ts")]: ["extensions/memory-core/src/memory/keyword-query.ts", "packages/normalization-core/src/string-normalization.ts"],
  [MARKDOWN]: ["packages/memory-host-sdk/src/host/markdown-chunks.ts"],
  [core("textBudget.ts")]: ["packages/normalization-core/src/cjk-chars.ts", "packages/normalization-core/src/utf16-slice.ts"],
};
const ORIGINAL = [CITATION, CHUNKS, CITED, FTS, BARREL, FENCE, INDEX, WALK, agent("index.ts")];
const SEARCH_FILES = [...Object.keys(PORTED), ...ORIGINAL];
const ORIGIN_LINE = "// Origin: original ProjectOS code";
const PI_LINE = "// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)";

const CORE_IMPORTS = /^(?:\.\/[A-Za-z0-9]+\.js|\.\.\/execution\/evidence\.js|\.\.\/tenant\.js)$/;
const AGENT_IMPORTS = /^(?:node:fs|node:path|@projectos\/core|\.\/[A-Za-z0-9]+\.js)$/;
const CORE_FORBIDDEN = /\bprocess\.|\bDate\.now\(|new Date\(\)|\bMath\.random\(|\bfetch\(|\brequire\(|\bimport\(/;
const AGENT_FORBIDDEN = /child_process|\bfetch\(|\beval\(|new Function\b|\bwriteFile|\bappendFile|\brmSync\b|\bunlink|\brenameSync\b|\bspawn|\bexec(?:File)?Sync\b/;
const VECTOR_FORBIDDEN = /embed|sqlite-vec|vec0|openai|anthropic|provider|loadExtension|allowExtension/i;
const CONSOLIDATION_FORBIDDEN = /dream|consolidat|setInterval|setTimeout|setImmediate/i;
const NOT_RUN = /\b(?:it|test|describe|suite|bench)\.(?:skip|only|todo|fails|skipIf|runIf)\b|\.(?:skip|only)\(|\b(?:xit|fit|xdescribe|fdescribe)\(/;

/** The dependency lists of both packages, whole. A new one is a deliberate change here, in TRD and by the owner. */
const DEPENDENCIES = {
  [CORE_PACKAGE_REL]: { dependencies: [], devDependencies: ["@types/node", "@vitest/coverage-v8", "typescript", "vitest"] },
  [AGENT_PACKAGE_REL]: { dependencies: ["@projectos/core"], devDependencies: ["@types/node", "@vitest/coverage-v8", "typescript", "vitest"] },
};

const TESTS = {
  "projectos/core/test/search-citation.test.ts": [
    "a complete result is admitted, with its citation whole: the positive control",
    "refuses %s",
    "a refusal holds no text from the result",
    "refuses an uncited row and keeps the cited one",
    "a row from another project is refused, however well it scores",
    "a refused row does not set the keyword scale",
    "a refused vector row changes no score and takes no slot",
    "a vector row with a citation merges; the keyword row decides that citation when both name a chunk",
    "an answer citing what was retrieved passes: the positive control",
    "the fence id follows the text, so text cannot carry its own closing line",
    "a quote in a term cannot end the string",
    "nothing compiles to no query, never to one that matches everything",
    "names project, file and line range: the positive control",
  ],
  "projectos/core/test/search-retrieval.test.ts": [
    "every chunk text is exactly its own lines of the file",
    "a line wider than a chunk splits, and every part cites that same line",
    "moves a near-duplicate below something different",
    "halves a score over one half-life, from the recorded time",
    "a token of underscores alone is no token, and one with a letter is",
    "keyword only: the score is the text score, best first",
    "if everything falls short, keyword rows still answer",
  ],
  "projectos/agent/test/searchIndex.test.ts": [
    "FTS5 is present in the bundled SQLite: the check the phase depends on",
    "cites the exact lines of a word on a known line",
    "a session transcript cites the source line, not the flattened line",
    "the schema itself will not hold a row without a citation",
    "a row altered with %s is refused as %s, and its text does not come back",
    "an untouched row in the same index passes: the positive control",
    "a search sees its own project and never the other, and the other sees its own",
    "no query text can reach the project or another file",
    "a deleted database rebuilds to the same answers",
    "a rebuild that fails part way leaves the previous index standing",
    "after a chunking change a project is stale until rebuilt, because its line ranges are old",
    "reports a junction and does not read through it",
    "what a document says about itself changes nothing about its citation",
    "the text comes back only as untrusted data, under a name that says so",
    "a forged closing fence does not close the fence",
    "copying the real closing fence into the document does not close it either",
    "by default every hit is a keyword hit, with no vector score",
    "what comes through the seam meets the same door",
  ],
};

const RULE_NAMES = {
  "PS-1": "unlisted file",
  "PS-2": "wrong upstream record",
  "PS-3": "no origin mark",
  "PS-4": "credit refused",
  "PS-5": "core is not pure",
  "PS-6": "the index reaches too far",
  "PS-7": "dependency added",
  "PS-8": "vectors arrived",
  "PS-9": "an uncited result passes",
  "PS-10": "the project is not bound",
  "PS-11": "ranked before it was judged",
  "PS-12": "an uncited answer passes",
  "PS-13": "indexed text is not held as data",
  "PS-14": "the fence can be closed",
  "PS-15": "a query is more than words",
  "PS-16": "the rebuild is not whole",
  "PS-17": "the schema does not hold the citation",
  "PS-18": "the walk reads too much",
  "PS-19": "a chunk cannot be cited",
  "PS-20": "stale line ranges answer",
  "PS-21": "background consolidation",
  "PS-22": "not exported",
  "PS-23": "not registered",
  "PS-T": "the proof does not run",
};

/** A pin: this text, in this file, inside this function when one is named. */
const P = (rel, fn, pin) => ({ rel, fn, pin });
const PIN_RULES = [
  { rule: "PS-8", says: "the vector seam is gone or filled", pins: [
    P(CITED, null, "export const NO_VECTOR_CANDIDATES: readonly VectorCandidate[] = [];"),
    P(CITED, "rankCitedResults", "judge(params.vectorCandidates ?? NO_VECTOR_CANDIDATES)"),
    P(INDEX, null, "vectorCandidates: request.vectorCandidates ?? NO_VECTOR_CANDIDATES,"),
  ] },
  { rule: "PS-9", says: "a citation is no longer required", pins: [
    P(CITATION, "citationPathProblem", "if (typeof path !== 'string' || path.trim() === '') return 'no-path';"),
    P(CITATION, "citationPathProblem", "path.startsWith('/') || path.includes('\\\\') || DRIVE_OR_SCHEME.test(path)"),
    P(CITATION, "citationPathProblem", "segment === '' || segment === '.' || segment === '..'"),
    P(CITATION, "lineRangeIsCitable", "Number.isSafeInteger(startLine) && Number.isSafeInteger(endLine)"),
    P(CITATION, "lineRangeIsCitable", "(startLine as number) >= 1 && (endLine as number) >= (startLine as number)"),
    P(CITATION, "citationProblem", "if (pathProblem !== null) return pathProblem;"),
    P(CITATION, "citationProblem", "if (!lineRangeIsCitable(result.startLine, result.endLine)) return 'no-line-range';"),
    P(CITATION, "admitSearchResult", "if (problem !== null) return { ok: false, refusal: { reason: problem } };"),
  ] },
  { rule: "PS-10", says: "the search is not held to one project", pins: [
    P(CITATION, "citationProblem", "if (!isProjectId(result.project)) return 'no-project';"),
    P(CITATION, "citationProblem", "if (result.project !== scopeProject) return 'wrong-project';"),
    P(INDEX, null, "AND c.project = ?"),
    P(INDEX, null, "matchChunks.all(match, request.project,"),
    P(INDEX, null, "if (!isProjectId(request.project)) return { ok: false, reason: 'invalid-project' };"),
    P(INDEX, null, "DELETE FROM search_chunks WHERE project = ?"),
    P(INDEX, "recordsOf", "sources.find((source) => source.project !== project)"),
  ] },
  { rule: "PS-11", says: "rows are not judged before they are ranked", pins: [
    P(CITED, "rankCitedResults", "rows.map((row) => ({ row, admission: admitSearchResult(row, params.project) }))"),
    P(CITED, "rankCitedResults", "const keyword = citable(judgedKeyword);"),
    P(CITED, "rankCitedResults", "const vector = citable(judgedVector);"),
    P(CITED, "rankCitedResults", "(admission.ok ? [] : [admission.refusal])"),
    P(CITED, "rankCitedResults", "return { hits, refused };"),
  ] },
  { rule: "PS-12", says: "an answer need not cite what was retrieved", pins: [
    P(CITATION, "admitCitedAnswer", "if (citations.length === 0) return { ok: false, reason: 'uncited-answer' };"),
    P(CITATION, "admitCitedAnswer", "citations.every((citation) => hits.some((hit) => withinRetrieved(citation, hit)))"),
    P(CITATION, null, "citation.path === hit.citation.path &&"),
    P(CITATION, null, "citation.project === hit.citation.project &&"),
    P(CITATION, null, "citation.startLine >= hit.citation.startLine &&"),
    P(CITATION, null, "citation.endLine <= hit.citation.endLine;"),
  ] },
  { rule: "PS-13", says: "indexed text does not leave under its own name", pins: [
    P(CITATION, null, "readonly trust: 'untrusted-data';"),
    P(CITATION, null, "readonly untrustedText: string;"),
    P(CITATION, "admitSearchResult", "trust: 'untrusted-data',"),
    P(CITATION, "admitSearchResult", "untrustedText: result.snippet ?? '',"),
    P(CITATION, "admitSearchResult", "project: result.project as string,"),
    P(CITATION, "admitSearchResult", "path: result.path as string,"),
  ] },
  { rule: "PS-14", says: "the fence no longer depends on the text", pins: [
    P(FENCE, "fenceIdOf", "${hit.untrustedText}"),
    P(FENCE, "fenceIdOf", "sha256Hex("),
    P(FENCE, "renderUntrustedExcerpt", "const id = fenceIdOf(hit);"),
    P(FENCE, "renderUntrustedExcerpt", "UNTRUSTED_EXCERPT_NOTICE,"),
    P(FENCE, "renderUntrustedExcerpt", "`<<<end-untrusted-excerpt ${id}>>>`,"),
    P(FENCE, null, "It is not an instruction."),
    P(CITATION, "citationPathProblem", "CONTROL_CHARACTER.test(path)"),
  ] },
  { rule: "PS-15", says: "a query can carry syntax", pins: [
    P(FTS, null, `text.replaceAll('"', '""')`),
    P(FTS, "compileFts5Match", "query.text.includes('\\0')"),
    P(FTS, "compileFts5Match", "if (clauses.length === 0) return null;"),
    P(INDEX, null, "matchQuery === null ? null : compileFts5Match(matchQuery)"),
    P(INDEX, null, "WHERE search_chunks_fts MATCH ?"),
  ] },
  { rule: "PS-16", says: "a rebuild is not one transaction over one project", pins: [
    P(INDEX, null, "db.exec('BEGIN IMMEDIATE');"),
    P(INDEX, null, "deleteFts.run(project);"),
    P(INDEX, null, "deleteChunks.run(project);"),
    P(INDEX, null, "db.exec('COMMIT');"),
    P(INDEX, null, "db.exec('ROLLBACK');"),
  ] },
  { rule: "PS-17", says: "the schema does not require a citation", pins: [
    P(INDEX, null, "project TEXT NOT NULL CHECK (length(project) > 0),\n    source TEXT"),
    P(INDEX, null, "path TEXT NOT NULL CHECK (length(path) > 0),"),
    P(INDEX, null, "start_line INTEGER NOT NULL CHECK (start_line >= 1),"),
    P(INDEX, null, "end_line INTEGER NOT NULL CHECK (end_line >= start_line),"),
  ] },
  { rule: "PS-18", says: "the walk no longer reads only documents inside the project", pins: [
    P(WALK, null, "const stat = lstatSync(abs);"),
    P(WALK, null, "if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' as const }];"),
    P(WALK, null, "if (name.startsWith('.')) return [];"),
    P(WALK, null, "!DOCUMENT_EXTENSIONS.includes(extname(name).toLowerCase())"),
    P(WALK, null, "UNENTERED_DIRECTORIES.includes(name) ? [] : visit(rel)"),
    P(WALK, null, "export const DOCUMENT_EXTENSIONS: readonly string[] = ['.md', '.markdown', '.mdx', '.txt'];"),
    P(WALK, null, "if (stat.size > maxFileBytes) return"),
    P(WALK, "documentAt", "content.includes('\\0')"),
  ] },
  { rule: "PS-19", says: "a chunk record can be made without a citation", pins: [
    P(CHUNKS, "sourceProblem", "const pathProblem = citationPathProblem(input.path);"),
    P(CHUNKS, "sourceProblem", "if (input.lineMap !== undefined && input.lineMap.length !== lines) {"),
    P(CHUNKS, "chunkRecordsOf", "if (problem !== null) return { ok: false, problem };"),
    P(CHUNKS, "chunkRecordsOf", "path: input.path,"),
    P(CHUNKS, "chunkRecordsOf", "startLine: chunk.startLine,"),
    P(CHUNKS, "chunkRecordsOf", "endLine: chunk.endLine,"),
  ] },
  { rule: "PS-20", says: "an index from other chunk boundaries still answers", pins: [
    P(INDEX, null, "row.chunking_version === MARKDOWN_CHUNKING_VERSION ? 'current' : 'stale'"),
    P(INDEX, null, "if (status === 'stale') return { ok: false, reason: 'stale' };"),
    P(INDEX, null, "if (status === 'not-built') return { ok: false, reason: 'not-built' };"),
    P(INDEX, null, "recordProject.run(project, MARKDOWN_CHUNKING_VERSION,"),
  ] },
  { rule: "PS-22", says: "the search surface is not exported", pins: [
    P(CORE_BARREL_REL, null, "export * from './search/index.js';"),
    ...["admitSearchResult", "admitCitedAnswer", "rankCitedResults", "renderUntrustedExcerpt", "chunkRecordsOf", "compileFts5Match", "NO_VECTOR_CANDIDATES", "chunkMarkdown", "planKeywordSearch"].map((name) => P(BARREL, null, name)),
    P(agent("index.ts"), null, "openSearchIndex,"),
    P(agent("index.ts"), null, "collectDocumentSources,"),
  ] },
];

const normalise = (text) => text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
/** Block comments, then whole-line and trailing line comments. A pin in a comment is not a pin. */
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "").replace(/\s+\/\/ .*$/gm, "");

function bodyOf(text, fn) {
  const start = new RegExp(String.raw`^(?:export )?function\*? ${fn}\b`, "m").exec(text);
  if (start === null) return null;
  // A multi-line parameter list also closes at column 0, as `}): T {`, and that is not the end of the body.
  const end = /\n\}(?!\))/.exec(text.slice(start.index));
  return end === null ? null : text.slice(start.index, start.index + end.index);
}

const importsOf = (text) => [...text.matchAll(/\bfrom\s+'([^']+)'/g)].map((m) => m[1]);
const countOf = (text, needle) => text.split(needle).length - 1;

function creditProblems(raw) {
  const records = credit.parseNotices(raw[NOTICES_REL]);
  return SEARCH_FILES.flatMap((rel) => (raw[rel] === null ? [] : credit.judgeFile(rel, raw[rel], records)));
}

function packageProblems(raw, E) {
  for (const [rel, want] of Object.entries(DEPENDENCIES)) {
    let manifest = null;
    try {
      manifest = JSON.parse(raw[rel]);
    } catch {
      E("PS-7", `${rel} does not parse`);
      continue;
    }
    for (const kind of ["dependencies", "devDependencies"]) {
      const names = Object.keys(manifest[kind] ?? {}).sort();
      if (JSON.stringify(names) !== JSON.stringify(want[kind])) E("PS-7", `${rel} ${kind} are ${names.join(", ") || "none"}, not the pinned list`);
    }
  }
}

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
const withoutJsComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule} ${RULE_NAMES[rule]}: ${msg}`]);
  const missing = Object.keys(raw).filter((rel) => raw[rel] === null);
  if (missing.length > 0) {
    missing.forEach((rel) => E("PS-1", `${rel} is missing`));
    return errors;
  }

  // PS-1: the two directories hold exactly the listed files.
  const listed = raw[LISTING].split("\n").filter(Boolean).sort();
  if (JSON.stringify(listed) !== JSON.stringify([...SEARCH_FILES].sort())) {
    E("PS-1", `the search directories hold ${listed.length} files, and they are not the ${SEARCH_FILES.length} this validator lists`);
  }

  // PS-2: each ported file names the upstream files this phase read, at the pin, with Pi and its change stated.
  for (const [rel, paths] of Object.entries(PORTED)) {
    const header = raw[rel];
    const line = /^\/\/ Source-Path: (.+)$/m.exec(header);
    if (line === null || line[1] !== paths.join("; ")) E("PS-2", `${rel} does not name exactly ${paths.join("; ")}`);
    if (!header.includes(`// Source-Commit: ${COMMIT}`)) E("PS-2", `${rel} is not pinned at ${COMMIT}`);
    if (!header.includes(PI_LINE)) E("PS-2", `${rel} does not carry the Pi credit`);
    if (!/^\/\/ Modified-By: ProjectOS \d{4}-\d{2}-\d{2}: modified for ProjectOS\. CHANGED: \S/m.test(header)) E("PS-2", `${rel} does not state what ProjectOS changed`);
  }

  // PS-3: every other file opens by saying it is ours.
  for (const rel of ORIGINAL) {
    if (raw[rel].split("\n")[0] !== ORIGIN_LINE) E("PS-3", `${rel} does not open with the original mark`);
  }

  // PS-4: the foundation's own rule, over these files, as the notices file stands.
  for (const refusal of creditProblems(raw)) E("PS-4", refusal.message);

  const code = Object.fromEntries(Object.entries(raw).map(([rel, text]) => [rel, withoutComments(text)]));
  const coreFiles = SEARCH_FILES.filter((rel) => rel.startsWith(CORE_DIR));
  const agentFiles = SEARCH_FILES.filter((rel) => rel.startsWith(AGENT_DIR));

  // PS-5: core imports nothing outside the kernel and reads no file, clock or environment.
  for (const rel of coreFiles) {
    for (const spec of importsOf(code[rel])) if (!CORE_IMPORTS.test(spec)) E("PS-5", `${rel} imports ${spec}`);
    if (CORE_FORBIDDEN.test(code[rel])) E("PS-5", `${rel} reaches outside: ${CORE_FORBIDDEN.exec(code[rel])[0]}`);
  }

  // PS-6: the index reads documents, writes its own database and does nothing else.
  for (const rel of agentFiles) {
    for (const spec of importsOf(code[rel])) if (!AGENT_IMPORTS.test(spec) && spec !== "node:sqlite") E("PS-6", `${rel} imports ${spec}`);
    if (AGENT_FORBIDDEN.test(code[rel])) E("PS-6", `${rel} reaches outside: ${AGENT_FORBIDDEN.exec(code[rel])[0]}`);
    for (const m of code[rel].matchAll(/getBuiltinModule\('([^']+)'\)/g)) if (m[1] !== "node:sqlite") E("PS-6", `${rel} loads ${m[1]}`);
  }

  // PS-7
  packageProblems(raw, E);

  // PS-8: no embeddings, no provider, no extension, in code. What the seam will one day hold is prose.
  for (const rel of SEARCH_FILES) {
    if (VECTOR_FORBIDDEN.test(code[rel])) E("PS-8", `${rel} carries ${VECTOR_FORBIDDEN.exec(code[rel])[0]}`);
  }

  // PS-11: order, not only presence. Judged first, merged after.
  const ranked = bodyOf(code[CITED], "rankCitedResults") ?? "";
  if (!(ranked.indexOf("citable(judgedKeyword)") >= 0 && ranked.indexOf("citable(judgedKeyword)") < ranked.indexOf("mergeHybridResults("))) {
    E("PS-11", "rows reach the merge before the door");
  }
  const mergeArgs = ranked.slice(ranked.indexOf("mergeHybridResults("));
  if (!/^\s+keyword,\n\s+vector,/m.test(mergeArgs)) E("PS-11", "the merge is not handed the admitted rows");

  // PS-13: `.text` is touched only to store it and hand it back, so nothing reads meaning from it.
  if (countOf(code[INDEX], "row.text") !== 1 || countOf(code[INDEX], "record.text") !== 2) {
    E("PS-13", "the index reads document text somewhere new");
  }
  const candidate = /const candidateOf[\s\S]*?\n\}\);/.exec(code[INDEX])?.[0] ?? "";
  for (const field of ["project: row.project,", "path: row.path,", "startLine: row.start_line,", "endLine: row.end_line,"]) {
    if (!candidate.includes(field)) E("PS-13", `a citation field is no longer taken from the row: ${field}`);
  }
  const hitType = /export interface CitedSearchHit \{[\s\S]*?\n\}/.exec(code[CITATION])?.[0] ?? "";
  if (/\bsnippet\b/.test(hitType)) E("PS-13", "a hit carries text under a name that does not say what it is");

  // PS-15: the SELECT has no interpolation.
  const select = /db\.prepare\(`\s*SELECT[\s\S]*?`\);/.exec(code[INDEX])?.[0] ?? "";
  if (select === "" || select.includes("${")) E("PS-15", "a query is spliced into the SQL");

  // PS-16: the rows go in one transaction, and the FTS rows leave while the chunks that find them still exist.
  if (code[INDEX].indexOf("deleteFts.run(project);") > code[INDEX].indexOf("deleteChunks.run(project);")) {
    E("PS-16", "the chunks are deleted before the FTS rows that are found through them");
  }

  // PS-18: a link is refused before anything can enter it.
  if (code[WALK].indexOf("stat.isSymbolicLink()") > code[WALK].indexOf("stat.isDirectory()")) E("PS-18", "a directory is entered before the link check");

  // PS-19: the upstream embedding input stays cut.
  if (/embeddingInput|provenance/.test(code[MARKDOWN])) E("PS-19", "the chunker carries a field no citation uses");

  // PS-21: nothing here runs on its own.
  for (const rel of SEARCH_FILES) {
    if (CONSOLIDATION_FORBIDDEN.test(code[rel])) E("PS-21", `${rel} carries ${CONSOLIDATION_FORBIDDEN.exec(code[rel])[0]}`);
  }

  // The pins, each inside its function when one is named.
  for (const { rule, says, pins } of PIN_RULES) {
    for (const { rel, fn, pin } of pins) {
      const scope = fn === null ? code[rel] : bodyOf(code[rel], fn);
      if (scope === null || !scope.includes(pin)) E(rule, `${says}: ${rel}${fn === null ? "" : ` ${fn}`} lost: ${pin}`);
    }
  }

  // PS-23
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(withoutJsComments(raw[rel]));
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("PS-23", `${THIS_VALIDATOR} is not registered in ${name}`);
  }

  // PS-T
  for (const [rel, needles] of Object.entries(TESTS)) {
    for (const needle of needles) if (!raw[rel].includes(needle)) E("PS-T", `${rel} no longer proves "${needle}"`);
    if (NOT_RUN.test(raw[rel])) E("PS-T", `${rel} skips or isolates a test: ${NOT_RUN.exec(raw[rel])[0]}`);
  }
  return errors;
}

const M = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also });
const HYBRID = core("hybrid.ts");
const FIRST_NOTICE_PATH = "Source-Path: extensions/memory-core/src/memory/hybrid.ts\n";
const TEST_CITATION = "projectos/core/test/search-citation.test.ts";
const TEST_INDEX = "projectos/agent/test/searchIndex.test.ts";

const MUTATIONS = [
  M("a-stray-file-lands-in-core-search", "PS-1", LISTING, `${HYBRID}\n`, `${HYBRID}\n${core("stray.ts")}\n`),
  M("a-listed-file-goes-missing", "PS-1", LISTING, `${agent("index.ts")}\n`, ""),
  M("a-header-names-a-different-upstream-file", "PS-2", core("mmr.ts"), "memory/mmr.ts\n", "memory/other.ts\n", ["PS-4"]),
  M("a-second-upstream-file-loses-its-credit", "PS-2", core("textBudget.ts"), "; packages/normalization-core/src/utf16-slice.ts", ""),
  M("a-header-drops-the-pi-credit", "PS-2", core("mmr.ts"), `${PI_LINE}\n`, "", ["PS-4"]),
  M("a-header-stops-saying-what-changed", "PS-2", HYBRID, "CHANGED: ", "Changes: "),
  M("a-header-moves-to-another-commit", "PS-2", core("tokenize.ts"), COMMIT, "0".repeat(40), ["PS-4"]),
  M("an-original-file-loses-its-mark", "PS-3", FENCE, `${ORIGIN_LINE}\n`, "", ["PS-4"]),
  M("the-mark-moves-below-the-first-line", "PS-3", INDEX, `${ORIGIN_LINE}\n`, `// Note.\n${ORIGIN_LINE}\n`),
  M("a-notices-entry-goes-missing", "PS-4", NOTICES_REL, FIRST_NOTICE_PATH, "Source-Path: extensions/memory-core/src/memory/gone.ts\n"),
  M("core-imports-the-file-system", "PS-5", CITATION, "import { isProjectId } from '../tenant.js';", "import { isProjectId } from '../tenant.js';\nimport { readFileSync } from 'node:fs';"),
  M("core-reads-a-file-for-decay", "PS-5", core("temporalDecay.ts"), "const DAY_MS = 24", "const nowValue = process.env;\nconst DAY_MS = 24"),
  M("core-reads-the-clock", "PS-5", core("temporalDecay.ts"), "ageInDays: (params.nowMs - timestamp.getTime()) / DAY_MS,", "ageInDays: (Date.now() - timestamp.getTime()) / DAY_MS,"),
  M("core-imports-another-module", "PS-5", CITED, "from './mmr.js'", "from '../workers.js'"),
  M("the-index-imports-a-network-module", "PS-6", INDEX, "} from '@projectos/core';", "} from '@projectos/core';\nimport { get } from 'node:https';"),
  M("the-index-spawns", "PS-6", WALK, "const UNENTERED_DIRECTORIES", "const run = require('child_process');\nconst UNENTERED_DIRECTORIES"),
  M("the-index-loads-another-builtin", "PS-6", INDEX, "getBuiltinModule('node:sqlite')", "getBuiltinModule('node:vm')"),
  M("the-walk-writes-a-file", "PS-6", WALK, "const found = visit('');", "const found = visit('');\n  writeFileSync(params.root, '');"),
  M("the-agent-gains-a-dependency", "PS-7", AGENT_PACKAGE_REL, `"@projectos/core": "file:../core"`, `"@projectos/core": "file:../core",\n    "better-sqlite3": "12.0.0"`),
  M("core-gains-a-dependency", "PS-7", CORE_PACKAGE_REL, `"devDependencies": {`, `"dependencies": { "sqlite-vec": "0.1.0" },\n  "devDependencies": {`),
  M("the-seam-is-filled-by-default", "PS-8", CITED, "readonly VectorCandidate[] = [];", "readonly VectorCandidate[] = [{} as VectorCandidate];"),
  M("the-index-stops-using-the-seam", "PS-8", INDEX, "vectorCandidates: request.vectorCandidates ?? NO_VECTOR_CANDIDATES,", "vectorCandidates: [],"),
  M("the-chunker-gains-embedding-input", "PS-8", MARKDOWN, "readonly hash: string;", "readonly hash: string;\n  readonly embeddingInput?: string;", ["PS-19"]),
  M("the-index-loads-an-extension", "PS-8", INDEX, "const db = new DatabaseSync(location);", "const db = new DatabaseSync(location, { allowExtension: true });"),
  M("a-provider-call-arrives", "PS-8", CITED, "export const DEFAULT_SEARCH_MAX_RESULTS", "export const SEARCH_PROVIDER = 'openai';\nexport const DEFAULT_SEARCH_MAX_RESULTS"),
  M("an-empty-path-passes", "PS-9", CITATION, "if (typeof path !== 'string' || path.trim() === '') return 'no-path';", "if (typeof path !== 'string') return null;"),
  M("a-path-outside-the-project-passes", "PS-9", CITATION, "segment === '' || segment === '.' || segment === '..'", "segment === ''"),
  M("a-backslash-path-passes", "PS-9", CITATION, "path.includes('\\\\') || ", ""),
  M("line-zero-passes", "PS-9", CITATION, "(startLine as number) >= 1 && ", ""),
  M("a-reversed-range-passes", "PS-9", CITATION, " && (endLine as number) >= (startLine as number)", ""),
  M("the-line-check-is-dropped", "PS-9", CITATION, "if (!lineRangeIsCitable(result.startLine, result.endLine)) return 'no-line-range';", ""),
  M("the-door-admits-a-problem", "PS-9", CITATION, "if (problem !== null) return { ok: false, refusal: { reason: problem } };", ""),
  M("a-result-from-another-project-passes", "PS-10", CITATION, "if (result.project !== scopeProject) return 'wrong-project';", ""),
  M("a-row-with-no-project-passes", "PS-10", CITATION, "if (!isProjectId(result.project)) return 'no-project';", ""),
  M("the-search-drops-its-project-filter", "PS-10", INDEX, "WHERE search_chunks_fts MATCH ? AND c.project = ?", "WHERE search_chunks_fts MATCH ?"),
  M("the-query-binds-the-project-away", "PS-10", INDEX, "matchChunks.all(match, request.project,", "matchChunks.all(match, '%',"),
  M("a-rebuild-deletes-every-project", "PS-10", INDEX, "DELETE FROM search_chunks WHERE project = ?", "DELETE FROM search_chunks WHERE project != ?"),
  M("a-rebuild-takes-another-projects-source", "PS-10", INDEX, "sources.find((source) => source.project !== project)", "sources.find(() => false)"),
  M("rows-reach-the-merge-unjudged", "PS-11", CITED, "const keyword = citable(judgedKeyword);", "const keyword = [...params.keyword];"),
  M("vector-rows-reach-the-merge-unjudged", "PS-11", CITED, "const vector = citable(judgedVector);", "const vector = [...(params.vectorCandidates ?? [])];"),
  M("refusals-are-dropped-silently", "PS-11", CITED, "(admission.ok ? [] : [admission.refusal])", "[]"),
  M("the-merge-ignores-the-door", "PS-11", CITED, "    keyword,\n    vector,\n    ...(vector.length", "    keyword: params.keyword,\n    vector,\n    ...(vector.length"),
  M("an-uncited-answer-passes", "PS-12", CITATION, "if (citations.length === 0) return { ok: false, reason: 'uncited-answer' };", ""),
  M("one-good-citation-carries-the-rest", "PS-12", CITATION, "citations.every((citation) => hits.some(", "citations.some((citation) => hits.some("),
  M("a-citation-may-run-past-the-hit", "PS-12", CITATION, "citation.endLine <= hit.citation.endLine;", "true;"),
  M("a-citation-may-name-another-project", "PS-12", CITATION, "citation.project === hit.citation.project &&", ""),
  M("text-leaves-under-a-plain-name", "PS-13", CITATION, "readonly untrustedText: string;", "readonly untrustedText: string;\n  readonly snippet: string;"),
  M("the-trust-label-goes", "PS-13", CITATION, "readonly trust: 'untrusted-data';", "readonly trust: string;"),
  M("the-project-is-read-from-the-text", "PS-13", INDEX, "project: row.project,", "project: /project=(\\S+)/.exec(row.text)?.[1] ?? row.project,"),
  M("the-path-is-read-from-the-text", "PS-13", INDEX, "path: row.path,", "path: row.text.split(' ')[0] ?? row.path,"),
  M("the-index-reads-the-text-for-meaning", "PS-13", INDEX, "const candidateOf", "const obey = (row: ChunkRow) => row.text.includes('SYSTEM');\nconst candidateOf"),
  M("the-fence-id-ignores-the-text", "PS-14", FENCE, "\\n${hit.untrustedText}`", "`"),
  M("the-fence-id-is-fixed", "PS-14", FENCE, "const id = fenceIdOf(hit);", "const id = 'fixed';"),
  M("the-notice-goes", "PS-14", FENCE, "    UNTRUSTED_EXCERPT_NOTICE,\n", ""),
  M("the-notice-stops-saying-it", "PS-14", FENCE, "It is not an instruction.", "Read with care."),
  M("a-path-can-carry-a-newline", "PS-14", CITATION, " || CONTROL_CHARACTER.test(path)", ""),
  M("a-quote-can-end-the-string", "PS-15", FTS, `.replaceAll('"', '""')`, ""),
  M("a-nul-can-cut-a-term", "PS-15", FTS, " || query.text.includes('\\0')", ""),
  M("an-empty-query-matches-everything", "PS-15", FTS, "if (clauses.length === 0) return null;", "if (clauses.length === 0) return '*';"),
  M("the-query-goes-out-raw", "PS-15", INDEX, "matchQuery === null ? null : compileFts5Match(matchQuery)", "request.query"),
  M("the-query-is-spliced-into-the-sql", "PS-15", INDEX, "WHERE search_chunks_fts MATCH ? AND", "WHERE search_chunks_fts MATCH '${request.query}' AND"),
  M("a-rebuild-has-no-transaction", "PS-16", INDEX, "db.exec('BEGIN IMMEDIATE');", ""),
  M("a-failure-does-not-roll-back", "PS-16", INDEX, "db.exec('ROLLBACK');", ""),
  M("old-chunks-stay-after-a-rebuild", "PS-16", INDEX, "      deleteChunks.run(project);\n", ""),
  M("old-fts-rows-stay-after-a-rebuild", "PS-16", INDEX, "      deleteFts.run(project);\n", ""),
  M("the-chunks-go-before-the-fts-rows", "PS-16", INDEX, "      deleteFts.run(project);\n      deleteChunks.run(project);\n", "      deleteChunks.run(project);\n      deleteFts.run(project);\n"),
  M("the-schema-allows-no-path", "PS-17", INDEX, "path TEXT NOT NULL CHECK (length(path) > 0),", "path TEXT,"),
  M("the-schema-allows-line-zero", "PS-17", INDEX, "CHECK (start_line >= 1)", ""),
  M("the-schema-allows-a-reversed-range", "PS-17", INDEX, "CHECK (end_line >= start_line)", ""),
  M("the-schema-allows-no-project", "PS-17", INDEX, "project TEXT NOT NULL CHECK (length(project) > 0),\n    source TEXT", "project TEXT,\n    source TEXT"),
  M("the-walk-follows-links", "PS-18", WALK, "const stat = lstatSync(abs);", "const stat = statSync(abs);"),
  M("the-link-check-goes", "PS-18", WALK, "      if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' as const }];\n", ""),
  M("the-link-check-moves-below-the-directory-check", "PS-18", WALK, "      if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' as const }];\n      if (stat.isDirectory()) return UNENTERED_DIRECTORIES.includes(name) ? [] : visit(rel);\n", "      if (stat.isDirectory()) return UNENTERED_DIRECTORIES.includes(name) ? [] : visit(rel);\n      if (stat.isSymbolicLink()) return [{ path: rel, reason: 'link' as const }];\n"),
  M("dot-entries-are-read", "PS-18", WALK, "      if (name.startsWith('.')) return [];\n", ""),
  M("every-extension-is-read", "PS-18", WALK, " || !DOCUMENT_EXTENSIONS.includes(extname(name).toLowerCase())", ""),
  M("key-files-join-the-allowlist", "PS-18", WALK, "['.md', '.markdown', '.mdx', '.txt']", "['.md', '.markdown', '.mdx', '.txt', '.env', '.pem']"),
  M("dependency-trees-are-entered", "PS-18", WALK, "UNENTERED_DIRECTORIES.includes(name) ? [] : visit(rel)", "visit(rel)"),
  M("the-size-limit-goes", "PS-18", WALK, "      if (stat.size > maxFileBytes) return [{ path: rel, reason: 'too-large' as const }];\n", ""),
  M("binary-files-are-indexed", "PS-18", WALK, "  if (content.includes('\\0')) return { path: rel, reason: 'binary' };\n", ""),
  M("a-record-skips-the-path-check", "PS-19", CHUNKS, "  const pathProblem = citationPathProblem(input.path);\n  if (pathProblem !== null) return `${JSON.stringify(input.path)}: ${pathProblem}`;\n", ""),
  M("a-short-line-map-passes", "PS-19", CHUNKS, "input.lineMap.length !== lines", "input.lineMap.length > lines"),
  M("a-record-is-made-after-a-problem", "PS-19", CHUNKS, "if (problem !== null) return { ok: false, problem };", ""),
  M("the-chunker-gains-provenance", "PS-19", MARKDOWN, "readonly hash: string;", "readonly hash: string;\n  readonly provenance?: string;"),
  M("a-record-loses-its-range", "PS-19", CHUNKS, "startLine: chunk.startLine,", "startLine: 1,"),
  M("a-stale-project-answers", "PS-20", INDEX, "if (status === 'stale') return { ok: false, reason: 'stale' };", ""),
  M("an-unbuilt-project-answers-empty", "PS-20", INDEX, "if (status === 'not-built') return { ok: false, reason: 'not-built' };", ""),
  M("the-version-is-not-compared", "PS-20", INDEX, "row.chunking_version === MARKDOWN_CHUNKING_VERSION ? 'current' : 'stale'", "'current'"),
  M("the-version-is-not-recorded", "PS-20", INDEX, "recordProject.run(project, MARKDOWN_CHUNKING_VERSION,", "recordProject.run(project, 0,"),
  M("a-dreaming-pass-arrives", "PS-21", INDEX, "const FTS_TOKENIZER =", "const dreamingPass = () => undefined;\nconst FTS_TOKENIZER ="),
  M("a-background-timer-arrives", "PS-21", INDEX, "const FTS_TOKENIZER =", "setInterval(() => undefined, 1000);\nconst FTS_TOKENIZER ="),
  M("the-core-barrel-drops-search", "PS-22", CORE_BARREL_REL, "export * from './search/index.js';\n", ""),
  M("the-search-barrel-drops-the-door", "PS-22", BARREL, "  admitSearchResult,\n", ""),
  M("the-agent-barrel-drops-the-index", "PS-22", agent("index.ts"), "  openSearchIndex,\n", ""),
  M("validate-all-omits-this-validator", "PS-23", VA_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  M("cached-runner-omits-this-validator", "PS-23", CR_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  M("validate-all-comments-this-validator-out", "PS-23", VA_REL, `  "${THIS_VALIDATOR}"`, `  // "${THIS_VALIDATOR}"`),
  M("a-test-is-skipped", "PS-T", TEST_INDEX, "it('a forged closing fence does not close the fence'", "it.skip('a forged closing fence does not close the fence'"),
  M("a-proof-is-renamed-away", "PS-T", TEST_CITATION, "a refusal holds no text from the result", "a refusal is fine"),
  M("a-pin-moved-into-a-comment-does-not-count", "PS-16", INDEX, "db.exec('ROLLBACK');", "// db.exec('ROLLBACK');"),
];

/** Every named mutation must fire its own rule, and only rules it declares. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel];
    if (text === null || text === undefined || !text.includes(m.from)) {
      errors.push(`PS-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = [...new Set(check({ ...raw, [m.rel]: text.split(m.from).join(m.to) }).map(([rule]) => rule))].sort();
    if (!fired.includes(m.rule)) {
      errors.push(`PS-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
      continue;
    }
    const stranger = fired.filter((rule) => rule !== m.rule && !m.also.includes(rule));
    if (stranger.length > 0) errors.push(`PS-M: mutation '${m.name}' also fired ${stranger.join(", ")}, so ${m.rule} does not carry it alone`);
  }
  const names = MUTATIONS.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("PS-M: two mutations share a name");
  const proved = new Set(MUTATIONS.map((m) => m.rule));
  for (const rule of Object.keys(RULE_NAMES)) {
    if (!proved.has(rule)) errors.push(`PS-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
}

function readAll() {
  const raw = {};
  for (const rel of [...SEARCH_FILES, ...Object.keys(TESTS), NOTICES_REL, VA_REL, CR_REL, CORE_BARREL_REL, CORE_PACKAGE_REL, AGENT_PACKAGE_REL]) raw[rel] = read(rel);
  raw[LISTING] = [CORE_DIR, AGENT_DIR]
    .flatMap((dir) => (fs.existsSync(path.join(ROOT, ...dir.split("/"))) ? fs.readdirSync(path.join(ROOT, ...dir.split("/"))).map((name) => `${dir}/${name}`) : []))
    .join("\n")
    .concat("\n");
  return raw;
}

function run() {
  const raw = readAll();
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  return errors;
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((x) => console.error(`FAIL: ${x}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  console.log(`${THIS_VALIDATOR}: PASS (${SEARCH_FILES.length} real files judged; ${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS, RULE_NAMES };
