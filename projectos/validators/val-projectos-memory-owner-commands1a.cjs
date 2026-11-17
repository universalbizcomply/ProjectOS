"use strict";
/**
 * MEMORY OWNER COMMANDS - PROJECTOS-MEMORY-OWNER-COMMANDS1A (plan 4.1, Stage 3 carry-forward).
 *
 * Stage 3 shipped the memory rules with no command the owner can run. This phase adds `projectos memory ...` and the
 * production owner verifier, by CALLING the functions that already existed. Each rule below is pinned because every way
 * of undoing it reads reasonably in a diff:
 *
 *   OC-1  "a flag can say it is the owner"            - no decision without a typed answer at a terminal: both streams a TTY,
 *         the exact code, a strict boolean; no role, `--yes` or `--confirm` is read; no second prompt mechanism
 *   OC-2  "one confirmation is as good as another"     - the code is bound to the item, its hash, the tenant and the project
 *         (a sha-256 over every field of the claim); a handed-over claim whose hash is not its own is refused
 *   OC-3  "the owner can decide about a cited item"    - an item a committed decision cites, or whose decisions cannot be read,
 *         is declined inside the ask (so the ledger records it) and the owner is never asked
 *   OC-4  "record it afterwards"                       - the deletion ledger is written before the removal, by the one
 *         function that does it; this command removes nothing itself and prints the ledger head for the owner to commit
 *   OC-5  "the index can be kept next to the project"  - the index is the project's own file under the installation state
 *         directory, built at the commit HEAD was at BEFORE the sources were read; nothing is written in the project tree
 *   OC-6  "approving is just landing the text"         - only through the existing approval rule, after the provenance
 *         replacement check; a reject changes no store; nothing here proposes or writes a store itself
 *   OC-7  "take the project from the command line"     - the tenant and project are the registry's answer for the checkout
 *   OC-8  "a refusal can just say no"                  - every refusal is a code, a reason and a next step; stored text is
 *         only ever printed fenced, capped and with control characters made visible; a decision's answer carries the statement
 *   OC-9  "it is built, so it is reachable"            - the CLI reaches it, the emergency stop lets only the read through,
 *         the package exports it, and production passes it no dependencies
 *   OC-10 "node is handy"                              - nothing here imports a node module, a process or the network
 *   OC-11 "the memory rules forbid the call sites"     - the memory validator names this one call site and keeps refusing others, and
 *         names this file as the ONLY importer of the two deletion entry points
 *
 * REVIEW ROUND 1 (independent security review, APPROVE WITH CHANGES), each reproduced with real files first:
 *   OC-12 "600 characters are enough to show"         - the owner is shown the WHOLE text up to the store's own limit, or is not asked
 *   OC-13 "the queue file says it is the owner"       - no role read from a file lets a decision entry be replaced or removed here;
 *         the prompt shows who proposed it, in which role, of what kind, with what ledger reference
 *   OC-14 "RUN1.JSON is not run1.json"                - the path is spelled as each directory holds it (case, trailing dot or space,
 *         8.3 short names refused) and a decision's citation is compared case-folded with one separator
 *   OC-15 "an index is only derived"                  - `index delete` asks for the terminal first and writes no ledger entry for
 *         a refusal or for an index that is not there
 *   OC-16 "two reads are one read"                    - the hash asked about is the hash of the bytes that were shown
 * and the invisible and look-alike character ranges that visibleText escapes (OC-8).
 *
 * Each rule has a NAMED MUTATION; `selfTest` applies it in memory and counts it killed only when THAT rule fires. Comments
 * are stripped first. Reads files; runs nothing and calls no provider.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const MEM_REL = "projectos/agent/src/commands/memory.ts";
const VER_REL = "projectos/agent/src/memory/ownerTerminalVerifier.ts";
const CLI_REL = "projectos/agent/src/cli.ts";
const INDEX_REL = "projectos/agent/src/index.ts";
const TENANT_REL = "projectos/agent/src/commands/tenant.ts";
const PM_REL = "projectos/validators/val-projectos-port-memory1a.cjs";
const FIXED = [MEM_REL, VER_REL, CLI_REL, INDEX_REL, TENANT_REL, PM_REL];

const TESTS = {
  "projectos/agent/test/memoryOwnerCommands.test.ts": [
    "delete refuses on a piped input stream, keeps the item and writes no ledger entry",
    "delete refuses when only the output stream is redirected",
    "delete refuses an answer that is not the exact code, and keeps the item",
    "delete ignores a --as owner flag: a command-line role is not evidence of the owner",
    "approve and reject refuse a wrong answer, and the proposal stays pending",
    "the verifier answers the boolean true and nothing else, and fails closed with no terminal",
    "a code typed for another proposal, hash, tenant, project or checkout approves nothing",
    "a claim handed over with another claim hash is refused before anyone is asked",
    "a deletion confirmed for another item removes nothing",
    "refuses an item whose path a committed decision names, and keeps it",
    "refuses an item whose hash a committed decision names",
    "refuses when the committed decisions cannot be read: unknown is not none",
    "refuses without asking the owner: a refused item never reaches the prompt",
    "the authorised entry is on disk at the moment the file is removed",
    "prints the ledger head for the owner to commit, and it is the hash of the last entry",
    "a ledger that cannot be written leaves the item where it is",
    "builds the index in the installation state directory and writes nothing in the project tree",
    "records the commit it was built at: fresh while HEAD has not moved, stale after",
    "refuses when the installation has no state directory, and writes nothing",
    "approving a pending add lands the entry once, and marks the proposal applied",
    "a summary that would replace an approved entry is refused by the replacement check, even with the exact code typed",
    "a worker proposal that would replace approved memory is refused by the rank rule",
    "rejecting marks the pending proposal rejected and changes no store",
    "a --tenant or --project argument is not looked at: the ledger names the derived pair",
    "a checkout the registry does not name refuses every command, with the cause and the next step",
    "every refusal is a code, a reason and a next step",
    "proposals shows stored text only inside a fenced block, and the text cannot close it or forge a refusal",
    "visibleText makes control, invisible and bidirectional characters visible and caps the length",
    "a deletion prompt shows the item inside a fenced block too",
    "under the platform stop, only listing proposals still runs",
    "the approve prompt shows a 2000-character proposal to its last word, with no cut notice",
    "reject shows the whole text too, and so does proposals --id",
    "the entry a replace would remove is shown whole as well",
    "proposalTextBlocks gives the whole text up to the store limits and nothing past them",
    "fencedWholeText refuses what it would have to cut",
    "a proposal that claims the owner and replaces a decision entry is refused, and nobody is asked",
    "a remove of a decision entry is refused the same way",
    "an entry with no record of its origin is protected as a decision",
    "the prompt shows who proposed it, in which role, of what kind, and its ledger reference",
    "as a spelling the directory does not hold, with no prompt and no ledger entry",
    "a decision that cites the path in another case still protects it",
    "a decision that cites it with backslashes, or doubled separators, still protects it",
    "a decision that names the hash in upper case still protects it",
    "five calls with no terminal write no ledger entry and say why",
    "with a terminal and no index there is nothing to delete, and nothing is written",
    "a wrong answer deletes nothing and writes no ledger entry",
    "is shown as an escape, never raw",
    "an item that changed after it was shown, with the new hash given by --hash, is not deleted",
  ],
};

const PIN = {
  // OC-1
  ttyBoth: "return terminal.stdinIsTTY === true && terminal.stdoutIsTTY === true;",
  typedExactly: "return typed !== null && typed === code;",
  failClosed: "if (code === null || !terminalAvailable(terminal)) return false;",
  availableUsed: "return terminalAvailable(terminal) ? terminal : null;",
  needsTerminal: "if (terminal === null) return needsTerminal();",
  terminalFirst: "const terminal = terminalOf(deps);",
  askedExactlyTrue: "if (terminalProposalVerifier(() => terminal, extra)(claim) !== true) {",
  verifierGiven: "ownerVerifier: verifier },",
  ownerOnlyNow: "const OWNER_CALLER: MemoryCaller = Object.freeze({ author: 'owner-terminal', role: 'owner', session: 'typed-terminal' });",
  tenantTerminalShared: "import { nodeTerminal, type TenantReceiptTerminal } from '../commands/tenant.js';",
  tenantTerminalExported: "export function nodeTerminal(): TenantReceiptTerminal {",
  catchClosed: "} catch {\n      return false;\n    }",
  // OC-2
  codeSlice: "claimHash.slice(0, OWNER_CONFIRMATION_LENGTH)",
  hashOverFields: "const claimHashOf = (fields: object): string => sha256Hex(canonicalStringify(fields));",
  claimOwnHash: "claimHash !== hashOfFields(fields)",
  claimGate: "if (decisionClaimProblem(claim)) return false;",
  claimBound: "tenant: who.tenant,\n    project: who.project,\n    root,\n    proposalId: proposal.id,\n    proposalHash: proposal.proposalHash,",
  deleteBound: "{ tenant: who.tenant, project: who.project, path, itemHash, reason },",
  reviewedHash: "const request = { id: proposal.id, reviewedHash: proposal.proposalHash };",
  // OC-3
  citedStop: "if (claim.citedByDecision === true || shown.citedFolded) {",
  unknownStop: "if (claim.citedByDecision !== false) {",
  decliningUsed: "const verifier = decliningCited(terminalDeletionVerifier(() => terminal,",
  citedMapped: "if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'cited') return refusal('MEMORY_DELETE_CITED_BY_DECISION'",
  unknownMapped: "if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'unknown') return refusal('MEMORY_DELETE_DECISIONS_UNREADABLE'",
  decisionsPort: "committedDecisions: () => decisionsOf(ctx, deps)",
  decisionsThrow: "  try {\n    return deps.committedDecisions(ctx);\n  } catch {\n    return null;\n  }",
  // OC-4
  ledgerHead: "`deletion ledger: ${ledger.count} entries, head ${ledger.lastHash}`,",
  ledgerPrinted: "const ledger = ledgerLines(sys, root);",
  deleteThroughRule: "const outcome = deleteMemoryItem(",
  derivedThroughRule: "const outcome = deleteDerivedIndex(",
  // OC-5
  headFirst: "const builtAt = index.currentHead();",
  builtAtGiven: "{ builtAtCommit: builtAt }",
  perProject: "openProjectSearchIndex(directory, who, {",
  closed: "index.close();",
  stateDirectory: "return state === null ? null : `${state}/search-index`;",
  noStateRefused: "if (directory === null) return refusal('MEMORY_INDEX_NO_STATE_DIRECTORY'",
  // OC-6
  adapterCreates: "createExclusive: (path, content) => sys.createExclusive(path, content),",
  approveThroughRule: "approveMemoryProposal(sys, root, OWNER_CALLER, request)",
  rejectThroughRule: "rejectMemoryProposal(sys, root, OWNER_CALLER, request)",
  replacementAsked: "const code = provenanceReplacementProblem(writer, target);",
  addNeedsNone: "if (proposal.op === 'add') return null;",
  writerRank: "const writer = { kind: proposal.kind === 'summary' ? 'summary' : 'recollection' };",
  replacementBeforeAsk: "if (verb === 'approve') {\n    const problem = replacementProblem(ctx, proposal);\n    if (problem !== null) return decided(problem);\n  }",
  loadedFirst: "const loaded = loadMemoryProposal(sys, root, id);\n  if (!loaded.ok) return decided(memoryRefusal(loaded));",
  // OC-7
  identityFromRegistry: "identity: (ctx) => checkoutIdentityOf(ctx.sys, ctx.root),",
  identityFirst: "const found = identityOf(ctx, deps);\n  if (!found.ok) return found.result;",
  identityValidated: "if (isTenantId(tenant) && isProjectId(project)) return { ok: true, tenant, project };",
  // OC-8
  refusalFn: "function refusal(code: KnownCode, reason: string, exit = REFUSED_EXIT): CommandResult {",
  nextStep: "`  next: ${NEXT_STEP[code]}`",
  nextStepsTyped: "const NEXT_STEP: Readonly<Record<KnownCode, string>> = {",
  statement: "lines: [...result.lines, OWNER_CONFIRMATION_STATEMENT]",
  fencedWholeProposed: "fencedWholeText('proposed text', proposal.content, cap)",
  fencedWholeReplaced: "fencedWholeText('the entry it would replace or remove', proposal.targetEntry, cap)",
  fencedItem: "fencedStoredText('the item', item.text, 400)",
  fenceLine: String.raw`const lines = shown.split(/\r\n|\r|\n/).map((line) => ` + "`| ${visibleText(line, FENCE_LINE_CAP)}`);",
  fenceCap: "const shown = [...text.slice(0, cap * 2)].slice(0, cap).join('');",
  visibleMap: "const visible = (text: string): string => [...text].map((character) => (isUnsafe(character.codePointAt(0) ?? 0) ? escapeOf(character) : character)).join('');",
  rangeControl: "[0x0, 0x1f],",
  rangeBidi: "[0x2028, 0x202f],",
  rangeInvisible: "[0x2000, 0x200f],",
  visibleUsed: "const escaped = visible(shown);",
  reasonVisible: "`REFUSED (${code}): ${visibleText(reason, REASON_CAP)}`",
  // OC-12
  textBlocks: "export function proposalTextBlocks(proposal: Pick<MemoryProposal, 'target' | 'content' | 'targetEntry'>): readonly string[] | null {",
  storeLimit: "const cap = memoryCharLimit(proposal.target);",
  notShownRefused: "if (blocks === null) return decided(refusal('MEMORY_TEXT_NOT_SHOWN_IN_FULL'",
  promptBlocks: "const extra = [...proposalFacts(proposal), ...blocks];",
  wholeOrNull: "if (text.length > cap * 2 || [...text].length > cap) return null;",
  wholeCap: "visibleText(line, cap)",
  // OC-13
  decisionRefused: "if (held === undefined || held === 'decision') {",
  decisionCode: "refusal('MEMORY_DECISION_NOT_CHANGED_HERE'",
  roleExemption: "if (proposal.provenance.authorRole === 'owner' && proposal.kind !== 'summary') return null;",
  factsRole: "role ${visibleText(authorRole, 32)}",
  factsKind: "kind ${visibleText(proposal.kind, 16)}${proposal.ledgerRef === null ? '' : `, ledger reference ${visibleText(proposal.ledgerRef, 200)}`}",
  // OC-14
  spellingGate: "if (pathSpellingProblem(fs, root, path)) {",
  spellingCase: "if (names.some((name) => name.toLowerCase() === segment.toLowerCase())) return true;",
  spellingDots: "segments.some((segment) => TRAILING_DOT_OR_SPACE.test(segment) || SHORT_NAME.test(segment))",
  shortName: "const SHORT_NAME = /~\\d/;",
  trailing: "const TRAILING_DOT_OR_SPACE = /[. ]$/;",
  foldSeparators: "text.split(BACKSLASH).join('/').replace(/\\/+/g, '/').toLowerCase()",
  foldUsed: "const citedFolded = citedWhenFolded(decisionsOf(ctx, deps), path, itemHash);",
  foldHash: "const wantedHash = hash.toLowerCase();",
  foldCompare: "return folded.includes(wantedPath) || folded.includes(wantedHash);",
  spellingCode: "refusal('MEMORY_DELETE_PATH_SPELLING'",
  // OC-15
  indexTerminal: "const terminal = terminalOf(deps);\n  if (terminal === null) return needsTerminal();\n  const { sys, root } = ctx;\n  const where",
  indexNothing: "if (!sys.exists(where.location)) return { code: 0, lines: [",
  indexVerified: "terminalIndexVerifier(() => terminal)(claim) !== true",
  indexClaimHash: "return !present || fields.action !== 'memory-index-delete' || claimHash !== claimHashOf(fields);",
  // OC-16
  shownHash: "if (shown.hash !== null && claim.itemHash !== shown.hash) {",
  shownHashPassed: "{ hash: item?.hash ?? null, citedFolded }",
  changedMapped: "stop === 'changed') return refusal('MEMORY_DELETE_ITEM_CHANGED'",
  // OC-9
  cliImport: "import { memory } from './commands/memory.js';",
  cliCase: "case 'memory':\n      return memory(ctx, flags, positionals);",
  stopCase: "case 'memory':\n      return sub === 'proposals';",
  indexExport: "export { memory, MEMORY_COMMAND_CODES, type MemoryCommandDeps } from './commands/memory.js';",
  verifierExport: "} from './memory/ownerTerminalVerifier.js';",
  helpLine: "'  memory <index|delete|proposals|approve|reject>",
  overridesOnly: "const deps: MemoryCommandDeps = { ...nodeDeps(), ...overrides };",
  // OC-11
  pmNarrowed: '"projectos/agent/src/commands/memory.ts": ["approveMemoryProposal", "rejectMemoryProposal", "listPendingMemoryProposals", "loadMemoryProposal", "readMemoryStore"]',
  pmStillRefuses: 'E("PM-16", `${rel} calls',
  pmDeletionSites: 'const DELETION_CALL_SITES = ["projectos/agent/src/commands/memory.ts"];',
  pmDeletionRefuses: 'E("PM-16", `${rel} names a deletion entry point, and only the owner commands may`);',
};

/** Every range visibleText escapes: control, no-break and other spaces, fillers, selectors, tags, bidirectional marks and the byte order mark. */
const RANGE_PINS = [
  "[0x0, 0x1f],", "[0x7f, 0x9f],", "[0xa0, 0xa0],", "[0xad, 0xad],", "[0x34f, 0x34f],", "[0x61c, 0x61c],", "[0x115f, 0x1160],", "[0x1680, 0x1680],",
  "[0x180e, 0x180e],", "[0x2000, 0x200f],", "[0x2028, 0x202f],", "[0x205f, 0x206f],", "[0x2800, 0x2800],", "[0x3000, 0x3000],", "[0x3164, 0x3164],",
  "[0xfe00, 0xfe0f],", "[0xfeff, 0xfeff],", "[0xffa0, 0xffa0],", "[0xfff9, 0xfffb],", "[0xe0000, 0xe007f],", "[0xe0100, 0xe01ef],",
];

const FORBIDDEN_NODE = /from\s+['"]node:|require\(|\bchild_process\b|\bfetch\(|\bprocess\.(?:env|argv|stdin|stdout)\b/;
const SECOND_PROMPT = /\b(?:readSync|writeSync|createInterface|readline)\b/;
const ROLE_FLAGS = /(?:str|bool)\(\s*flags\s*,\s*['"](?:as|owner|role|yes|confirm|force)['"]|flags\[\s*['"](?:as|owner|role|yes|confirm|force)['"]\s*\]/;
const PROJECT_FLAGS = /(?:str|bool)\(\s*flags\s*,\s*['"](?:tenant|project|projectId)['"]|flags\[\s*['"](?:tenant|project|projectId)['"]\s*\]/;
const WRITES_BY_ITSELF = /\b(?:writeText|createExclusive|renameFile|proposeMemoryWrite|writeMemoryEntries|writeMemoryProvenance|writeFileAtomically|underMemoryLock|applyMemoryProposal)\s*\(/;
const UNFENCED_STORED = /\$\{[^}]*\.(?:content|targetEntry)\b[^}]*\}|\$\{[^}]*\bitem\.text\b[^}]*\}/;

function read(rel) {
  const abs = path.join(ROOT, ...rel.split("/"));
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/** Strip comments outside strings. CRLF is folded to LF first. */
function code(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      out += " ";
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "/" && n === "/" && text[i - 1] !== ":") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j += 1;
        else if (c !== "`" && text[j] === "\n") break;
        j += 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const count = (text, needle) => text.split(needle).length - 1;
const has = (text, ...needles) => needles.every((n) => text.includes(n));

/** The rules, over a map of rel -> raw text. Returns `[rule, message]` pairs. */
function check(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule}: ${msg}`]);
  for (const rel of FIXED) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("OC-0", `${rel} is missing`);
      return errors;
    }
  }
  const m = code(raw[MEM_REL]);
  const v = code(raw[VER_REL]);
  const cli = code(raw[CLI_REL]);
  const idx = code(raw[INDEX_REL]);
  const tn = code(raw[TENANT_REL]);
  const pm = raw[PM_REL].replace(/\r\n/g, "\n");

  // OC-1 - nothing is decided without the owner at a terminal.
  if (!has(v, PIN.ttyBoth, PIN.typedExactly, PIN.failClosed, PIN.tenantTerminalShared) || count(v, PIN.catchClosed) < 3 || SECOND_PROMPT.test(v)) {
    E("OC-1", "the verifier no longer needs both streams to be a terminal and the exact code, fails closed on a throw, or brings its own prompt instead of the tenant receipt's");
  }
  if (!has(tn, PIN.tenantTerminalExported)) E("OC-1", "the tenant receipt's terminal is no longer the one this verifier reuses");
  if (!has(m, PIN.availableUsed, PIN.askedExactlyTrue, PIN.verifierGiven, PIN.ownerOnlyNow) || count(m, PIN.needsTerminal) !== 3 || count(m, PIN.terminalFirst) !== 3) {
    E("OC-1", "a deletion, an approval or a rejection no longer asks for a terminal first, or accepts anything but the verifier answering exactly true");
  }
  if (ROLE_FLAGS.test(m) || SECOND_PROMPT.test(m)) E("OC-1", "a command-line role, --yes or --confirm is read, or the command prompts for itself");

  // OC-2 - the confirmation is bound.
  if (!has(v, PIN.codeSlice, PIN.hashOverFields, PIN.claimOwnHash, PIN.claimGate, PIN.indexClaimHash) || !has(m, PIN.claimBound, PIN.deleteBound, PIN.reviewedHash)) {
    E("OC-2", "the typed code is no longer bound to the item, its hash, the tenant and the project, or a claim whose hash is not its own is no longer refused");
  }

  // OC-3 - an item a decision cites, or whose decisions cannot be read, is not deleted here.
  if (!has(m, PIN.citedStop, PIN.unknownStop, PIN.decliningUsed, PIN.citedMapped, PIN.unknownMapped, PIN.decisionsPort, PIN.decisionsThrow)) {
    E("OC-3", "an item a committed decision cites, or one whose decisions cannot be read, is no longer declined before the owner is asked");
  }

  // OC-4 - recorded before removed, by the one function that does it; the head is printed.
  if (!has(m, PIN.ledgerHead, PIN.deleteThroughRule, PIN.derivedThroughRule) || count(m, PIN.ledgerPrinted) < 2 || count(m, "removeFile(") !== 1) {
    E("OC-4", "a deletion no longer goes through the recorded deletion rule alone, or the ledger head is no longer printed for the owner to commit");
  }

  // OC-5 - the index is the project's own file in the installation state, built at the commit taken first.
  const iHead = m.indexOf(PIN.headFirst);
  const iCollect = m.indexOf("collectDocumentSources(");
  if (!has(m, PIN.builtAtGiven, PIN.perProject, PIN.closed, PIN.stateDirectory) || count(m, PIN.noStateRefused) !== 2 || iHead < 0 || iCollect < 0 || !(iHead < iCollect)) {
    E("OC-5", "the index is no longer the project's own file under the installation state, built at the commit taken before the sources were read");
  }

  // OC-6 - approval only through the approval rule, after the replacement check.
  const iReplace = m.indexOf("const problem = replacementProblem(ctx, proposal);");
  const iAsk = m.indexOf(PIN.askedExactlyTrue);
  if (!has(m, PIN.approveThroughRule, PIN.rejectThroughRule, PIN.replacementAsked, PIN.addNeedsNone, PIN.writerRank, PIN.replacementBeforeAsk, PIN.loadedFirst) || iReplace < 0 || iAsk < 0 || !(iReplace < iAsk)) {
    E("OC-6", "an approval no longer goes through the existing approval rule after the provenance replacement check, or a rejection no longer changes only the proposal");
  }
  if (WRITES_BY_ITSELF.test(m.replace(PIN.adapterCreates, ""))) E("OC-6", "the command writes a file, a store or a proposal itself instead of through the existing functions");

  // OC-7 - the project is the registry's answer.
  if (!has(m, PIN.identityFromRegistry, PIN.identityFirst, PIN.identityValidated) || PROJECT_FLAGS.test(m)) {
    E("OC-7", "the tenant or project is no longer the registry's answer for the checkout, or an argument can name one");
  }

  // OC-8 - a refusal is a code, a reason and a next step; stored text is fenced, capped and made visible.
  if (!has(m, PIN.refusalFn, PIN.nextStep, PIN.nextStepsTyped, PIN.statement, PIN.reasonVisible) || !has(m, PIN.fencedWholeProposed, PIN.fencedWholeReplaced, PIN.fencedItem) || UNFENCED_STORED.test(m)) {
    E("OC-8", "a refusal no longer names a code, a reason and a next step, a decision no longer says what a typed confirmation proves, or stored text is printed outside a fence");
  }
  if (!has(v, PIN.fenceLine, PIN.visibleMap, PIN.rangeControl, PIN.rangeBidi, PIN.rangeInvisible, PIN.visibleUsed, ...RANGE_PINS) || count(v, PIN.fenceCap) < 2) {
    E("OC-8", "the fence no longer prefixes every line, caps the text and makes control, invisible and bidirectional characters visible");
  }

  // OC-9 - reachable, and the stop lets only the read through.
  if (!has(cli, PIN.cliImport, PIN.cliCase, PIN.stopCase, PIN.helpLine) || !has(idx, PIN.indexExport, PIN.verifierExport) || !has(m, PIN.overridesOnly)) {
    E("OC-9", "the memory command is no longer reached from the CLI, no longer refuses under the emergency stop except to read, or is handed dependencies in production");
  }

  // OC-10 - no node module, process or network.
  if (FORBIDDEN_NODE.test(m) || FORBIDDEN_NODE.test(v)) E("OC-10", "the command or the verifier reaches a node module, the process or the network directly");

  // OC-11 - the memory validator names this call site, and keeps refusing the others.
  if (!has(pm, PIN.pmNarrowed, PIN.pmStillRefuses, PIN.pmDeletionSites, PIN.pmDeletionRefuses)) {
    E("OC-11", "the memory validator no longer names exactly the owner commands as a call site of the queue's entry points, or no longer refuses any other");
  }

  // OC-12 - the whole text, or no question.
  const iBlocks = m.indexOf(PIN.notShownRefused);
  const iAsked = m.indexOf(PIN.askedExactlyTrue);
  if (!has(m, PIN.textBlocks, PIN.storeLimit, PIN.notShownRefused, PIN.promptBlocks) || !has(v, PIN.wholeOrNull, PIN.wholeCap) || iBlocks < 0 || iAsked < 0 || !(iBlocks < iAsked) || /PROPOSAL_TEXT_CAP/.test(m)) {
    E("OC-12", "the owner is no longer shown the whole text up to the store's own limit, or is asked about text that would be cut");
  }

  // OC-13 - a role in a queue file exempts nothing about decisions, and the prompt says who proposed it.
  const iDecision = m.indexOf(PIN.decisionRefused);
  const iRole = m.indexOf(PIN.roleExemption);
  if (!has(m, PIN.decisionRefused, PIN.decisionCode, PIN.roleExemption, PIN.promptBlocks) || iDecision < 0 || iRole < 0 || !(iDecision < iRole) || !has(m, PIN.factsRole, PIN.factsKind)) {
    E("OC-13", "a role read from the queue file can again let a decision entry be replaced or removed, or the prompt no longer shows the author, role, kind and ledger reference");
  }

  // OC-14 - the spelling of the path and the fold of the citation.
  if (!has(m, PIN.spellingGate, PIN.spellingCase, PIN.spellingDots, PIN.shortName, PIN.trailing, PIN.foldUsed, PIN.foldHash, PIN.foldCompare, PIN.spellingCode) || !m.includes(PIN.foldSeparators.replace("text.split", "text.split"))) {
    E("OC-14", "a path spelled in another case, with a trailing dot or space or as a short name, can be deleted, or a decision's citation in another case or with other separators no longer protects the item");
  }

  // OC-15 - index delete asks for the terminal first, writes nothing for nothing.
  const body = m.slice(Math.max(0, m.indexOf("function deleteIndex(")), m.indexOf("const OWNER_CALLER"));
  const iTerm = body.indexOf("if (terminal === null) return needsTerminal();");
  const iNothing = body.indexOf(PIN.indexNothing);
  const iVerify = body.indexOf(PIN.indexVerified);
  const iDelete = body.indexOf("deleteDerivedIndex(");
  if (!has(m, PIN.indexTerminal, PIN.indexNothing, PIN.indexVerified) || !has(v, PIN.indexClaimHash) || iTerm < 0 || !(iTerm < iNothing && iNothing < iVerify && iVerify < iDelete)) {
    E("OC-15", "`index delete` no longer asks for the terminal first and the typed code before it deletes, or writes a ledger entry for a refusal or for an index that is not there");
  }

  // OC-16 - what was shown is what is deleted.
  if (!has(m, PIN.shownHash, PIN.shownHashPassed, PIN.changedMapped)) {
    E("OC-16", "the hash asked about is no longer required to be the hash of the bytes that were shown");
  }
  return errors;
}

const MUTATIONS = [
  // OC-1
  { name: "one-stream-is-enough", rule: "OC-1", rel: VER_REL, from: PIN.ttyBoth, to: "return terminal.stdinIsTTY === true || terminal.stdoutIsTTY === true;" },
  { name: "any-answer-confirms", rule: "OC-1", rel: VER_REL, from: PIN.typedExactly, to: "return typed !== null;" },
  { name: "a-prefix-confirms", rule: "OC-1", rel: VER_REL, from: PIN.typedExactly, to: "return typed !== null && code.startsWith(typed);" },
  { name: "no-terminal-is-asked-anyway", rule: "OC-1", rel: VER_REL, from: PIN.failClosed, to: "if (code === null) return false;" },
  { name: "a-throwing-terminal-confirms", rule: "OC-1", rel: VER_REL, from: "      return typedTheCode(terminal(), deletionLines(claim, extra), claim.claimHash);\n    } catch {\n      return false;", to: "      return typedTheCode(terminal(), deletionLines(claim, extra), claim.claimHash);\n    } catch {\n      return true;" },
  { name: "a-second-prompt-mechanism", rule: "OC-1", rel: VER_REL, from: "export type OwnerTerminal = TenantReceiptTerminal;", to: "import { readSync } from 'node:fs';\nexport type OwnerTerminal = TenantReceiptTerminal;" },
  { name: "the-tenant-terminal-goes-private", rule: "OC-1", rel: TENANT_REL, from: PIN.tenantTerminalExported, to: "function nodeTerminal(): TenantReceiptTerminal {" },
  { name: "deletion-without-a-terminal-check", rule: "OC-1", rel: MEM_REL, from: PIN.availableUsed, to: "return terminal;" },
  { name: "the-answer-is-truthy-not-true", rule: "OC-1", rel: MEM_REL, from: PIN.askedExactlyTrue, to: "if (!terminalProposalVerifier(() => terminal, extra)(claim)) {" },
  { name: "role-from-a-flag", rule: "OC-1", rel: MEM_REL, from: "const path = str(flags, 'path');", to: "const path = str(flags, 'path');\n  const asOwner = str(flags, 'as');" },
  { name: "the-verifier-is-left-off-the-ports", rule: "OC-1", rel: MEM_REL, from: PIN.verifierGiven, to: "}," },
  { name: "the-owner-role-is-a-guest-role", rule: "OC-1", rel: MEM_REL, from: PIN.ownerOnlyNow, to: "const OWNER_CALLER: MemoryCaller = Object.freeze({ author: 'owner-terminal', role: 'implementer', session: 'typed-terminal' });" },
  // OC-2
  { name: "code-is-the-whole-hash-prefix-of-nothing", rule: "OC-2", rel: VER_REL, from: PIN.codeSlice, to: "claimHash.slice(0, 0)" },
  { name: "claim-hash-not-over-every-field", rule: "OC-2", rel: VER_REL, from: PIN.hashOverFields, to: "const claimHashOf = (fields: object): string => sha256Hex(canonicalStringify({}));" },
  { name: "index-claim-hash-trusted", rule: "OC-2", rel: VER_REL, from: PIN.indexClaimHash, to: "return !present || fields.action !== 'memory-index-delete';" },
  { name: "handed-over-claim-trusted", rule: "OC-2", rel: VER_REL, from: PIN.claimOwnHash, to: "false" },
  { name: "claim-gate-dropped", rule: "OC-2", rel: VER_REL, from: PIN.claimGate, to: "" },
  { name: "claim-leaves-out-the-project", rule: "OC-2", rel: MEM_REL, from: PIN.claimBound, to: "tenant: who.tenant,\n    project: 'none',\n    root,\n    proposalId: proposal.id,\n    proposalHash: proposal.proposalHash," },
  { name: "claim-leaves-out-the-hash", rule: "OC-2", rel: MEM_REL, from: PIN.claimBound, to: "tenant: who.tenant,\n    project: who.project,\n    root,\n    proposalId: proposal.id,\n    proposalHash: proposal.id," },
  { name: "deletion-request-for-another-project", rule: "OC-2", rel: MEM_REL, from: PIN.deleteBound, to: "{ tenant: who.tenant, project: 'other-project', path, itemHash, reason }," },
  { name: "approval-over-an-unread-hash", rule: "OC-2", rel: MEM_REL, from: PIN.reviewedHash, to: "const request = { id: proposal.id, reviewedHash: 'sha256:' + '0'.repeat(64) };" },
  // OC-3
  { name: "cited-item-goes-to-the-owner", rule: "OC-3", rel: MEM_REL, from: PIN.citedStop, to: "if (false) {" },
  { name: "unreadable-decisions-go-to-the-owner", rule: "OC-3", rel: MEM_REL, from: PIN.unknownStop, to: "if (false) {" },
  { name: "the-decliner-is-not-used", rule: "OC-3", rel: MEM_REL, from: PIN.decliningUsed, to: "const verifier = ((inner) => inner)(terminalDeletionVerifier(() => terminal," },
  { name: "cited-refusal-reads-as-a-typo", rule: "OC-3", rel: MEM_REL, from: PIN.citedMapped, to: "if (code === 'DELETE_OWNER_NOT_VERIFIED' && stop === 'cited') return refusal('MEMORY_OWNER_NOT_CONFIRMED'" },
  { name: "decisions-assumed-none", rule: "OC-3", rel: MEM_REL, from: PIN.decisionsPort, to: "committedDecisions: () => []" },
  { name: "a-throwing-decision-read-is-none", rule: "OC-3", rel: MEM_REL, from: PIN.decisionsThrow, to: "  try {\n    return deps.committedDecisions(ctx);\n  } catch {\n    return [];\n  }" },
  // OC-4
  { name: "ledger-head-not-printed", rule: "OC-4", rel: MEM_REL, from: PIN.ledgerHead, to: "`deletion ledger: ${ledger.count} entries`," },
  { name: "item-removed-by-the-command", rule: "OC-4", rel: MEM_REL, from: "  const outcome = deleteMemoryItem(", to: "  sys.removeFile(`${root}/${path}`);\n  const outcome = deleteMemoryItem(" },
  { name: "deletion-skips-the-recorded-rule", rule: "OC-4", rel: MEM_REL, from: PIN.deleteThroughRule, to: "const outcome = { ok: true as const, path, itemHash, recorded: true }; void (" },
  { name: "ledger-not-printed-for-an-index", rule: "OC-4", rel: MEM_REL, from: "  const ledger = ledgerLines(sys, root);\n  if (!outcome.ok) return decided({ code: REFUSED_EXIT, lines: [...deletionRefusal(outcome.code, null).lines, ...ledger] });", to: "  const ledger: readonly string[] = [];\n  if (!outcome.ok) return decided({ code: REFUSED_EXIT, lines: [...deletionRefusal(outcome.code, null).lines, ...ledger] });" },
  // OC-5
  { name: "head-taken-after-the-sources", rule: "OC-5", rel: MEM_REL, from: PIN.headFirst, to: "const builtAt: string | null = null;" },
  { name: "build-commit-not-recorded", rule: "OC-5", rel: MEM_REL, from: PIN.builtAtGiven, to: "{}" },
  { name: "index-opened-for-another-owner", rule: "OC-5", rel: MEM_REL, from: PIN.perProject, to: "openProjectSearchIndex(directory, { tenant: who.tenant, project: 'shared' }, {" },
  { name: "index-kept-in-the-project", rule: "OC-5", rel: MEM_REL, from: PIN.stateDirectory, to: "return state === null ? null : `${'.'}/search-index`;" },
  { name: "index-handle-leaked", rule: "OC-5", rel: MEM_REL, from: PIN.closed, to: "void index;" },
  { name: "no-state-directory-writes-anyway", rule: "OC-5", rel: MEM_REL, from: PIN.noStateRefused, to: "if (false) return refusal('MEMORY_INDEX_NO_STATE_DIRECTORY'" },
  // OC-6
  { name: "approval-lands-text-itself", rule: "OC-6", rel: MEM_REL, from: PIN.approveThroughRule, to: "(sys.writeText(`${root}/.projectops/memory/MEMORY.md`, proposal.content ?? ''), approveMemoryProposal(sys, root, OWNER_CALLER, request))" },
  { name: "replacement-check-after-the-ask", rule: "OC-6", rel: MEM_REL, from: PIN.replacementBeforeAsk, to: "if (verb === 'approve' && false) {\n    const problem = replacementProblem(ctx, proposal);\n    if (problem !== null) return decided(problem);\n  }" },
  { name: "replacement-check-asks-nothing", rule: "OC-6", rel: MEM_REL, from: PIN.replacementAsked, to: "const code: ProvenanceReplacementCode | null = null;" },
  { name: "every-replacement-passes", rule: "OC-6", rel: MEM_REL, from: PIN.addNeedsNone, to: "if (true) return null;" },
  { name: "a-summary-is-ranked-as-a-fact", rule: "OC-6", rel: MEM_REL, from: PIN.writerRank, to: "const writer = { kind: 'approved-memory' };" },
  { name: "reject-writes-a-store", rule: "OC-6", rel: MEM_REL, from: PIN.rejectThroughRule, to: "(proposeMemoryWrite(sys, root, OWNER_CALLER, { target: 'memory', op: 'add', kind: 'fact', content: 'x' }), rejectMemoryProposal(sys, root, OWNER_CALLER, request))" },
  { name: "unloaded-proposal-decided", rule: "OC-6", rel: MEM_REL, from: PIN.loadedFirst, to: "const loaded = loadMemoryProposal(sys, root, id);\n  if (false) return decided(memoryRefusal(loaded as never));" },
  // OC-7
  { name: "tenant-from-an-argument", rule: "OC-7", rel: MEM_REL, from: "const path = str(flags, 'path');", to: "const path = str(flags, 'path');\n  const named = str(flags, 'tenant');" },
  { name: "project-from-a-flag-index", rule: "OC-7", rel: MEM_REL, from: "const id = str(flags, 'id');\n  if (id !== '') {", to: "const id = str(flags, 'id');\n  if (flags['project'] !== undefined) return refusal('MEMORY_COMMAND_USAGE', 'x');\n  if (id !== '') {" },
  { name: "identity-not-the-registry", rule: "OC-7", rel: MEM_REL, from: PIN.identityFromRegistry, to: "identity: (ctx) => ({ tenant: 'agency-one', project: 'alpha-project' })," },
  { name: "identity-asked-after-the-command", rule: "OC-7", rel: MEM_REL, from: PIN.identityFirst, to: "const found = identityOf(ctx, deps) as Extract<Identity, { ok: true }>;" },
  { name: "identity-not-validated", rule: "OC-7", rel: MEM_REL, from: PIN.identityValidated, to: "if (typeof tenant === 'string' && typeof project === 'string') return { ok: true, tenant, project };" },
  // OC-8
  { name: "refusal-without-a-next-step", rule: "OC-8", rel: MEM_REL, from: PIN.nextStep, to: "`  see: ${NEXT_STEP[code]}`" },
  { name: "next-steps-not-exhaustive", rule: "OC-8", rel: MEM_REL, from: PIN.nextStepsTyped, to: "const NEXT_STEP: Readonly<Record<string, string>> = {" },
  { name: "decision-without-the-statement", rule: "OC-8", rel: MEM_REL, from: PIN.statement, to: "lines: [...result.lines]" },
  { name: "refusal-reason-printed-raw", rule: "OC-8", rel: MEM_REL, from: PIN.reasonVisible, to: "`REFUSED (${code}): ${reason}`" },
  { name: "proposal-text-printed-raw", rule: "OC-8", rel: MEM_REL, from: PIN.fencedWholeProposed, to: "`${proposal.content}`" },
  { name: "item-text-printed-raw", rule: "OC-8", rel: MEM_REL, from: PIN.fencedItem, to: "item.text" },
  { name: "fence-lines-not-prefixed", rule: "OC-8", rel: VER_REL, from: PIN.fenceLine, to: String.raw`const lines = shown.split(/\r\n|\r|\n/).map((line) => visibleText(line, FENCE_LINE_CAP));` },
  { name: "fence-uncapped", rule: "OC-8", rel: VER_REL, from: PIN.fenceCap, to: "const shown = text;" },
  { name: "control-characters-not-visible", rule: "OC-8", rel: VER_REL, from: PIN.visibleUsed, to: "const escaped = shown;" },
  { name: "bidirectional-characters-pass", rule: "OC-8", rel: VER_REL, from: PIN.rangeBidi, to: "[0x2028, 0x2028]," },
  { name: "escape-character-passes", rule: "OC-8", rel: VER_REL, from: PIN.rangeControl, to: "[0x0, 0x8]," },
  { name: "tag-characters-pass", rule: "OC-8", rel: VER_REL, from: "[0xe0000, 0xe007f],", to: "" },
  { name: "variation-selectors-pass", rule: "OC-8", rel: VER_REL, from: "[0xfe00, 0xfe0f],", to: "" },
  { name: "supplementary-variation-selectors-pass", rule: "OC-8", rel: VER_REL, from: "[0xe0100, 0xe01ef],", to: "" },
  { name: "grapheme-joiner-passes", rule: "OC-8", rel: VER_REL, from: "[0x34f, 0x34f],", to: "" },
  { name: "hangul-filler-passes", rule: "OC-8", rel: VER_REL, from: "[0x3164, 0x3164],", to: "" },
  { name: "braille-blank-passes", rule: "OC-8", rel: VER_REL, from: "[0x2800, 0x2800],", to: "" },
  { name: "no-break-space-passes", rule: "OC-8", rel: VER_REL, from: "[0xa0, 0xa0],", to: "" },
  { name: "jamo-fillers-pass", rule: "OC-8", rel: VER_REL, from: "[0x115f, 0x1160],", to: "" },
  { name: "mongolian-separator-passes", rule: "OC-8", rel: VER_REL, from: "[0x180e, 0x180e],", to: "" },
  { name: "spaces-and-zero-width-pass", rule: "OC-8", rel: VER_REL, from: "[0x2000, 0x200f],", to: "" },
  { name: "halfwidth-filler-passes", rule: "OC-8", rel: VER_REL, from: "[0xffa0, 0xffa0],", to: "" },
  { name: "ogham-space-passes", rule: "OC-8", rel: VER_REL, from: "[0x1680, 0x1680],", to: "" },
  // OC-9
  { name: "command-not-reached-from-the-cli", rule: "OC-9", rel: CLI_REL, from: PIN.cliCase, to: "case 'memory':\n      return { code: 1, lines: [] };" },
  { name: "every-memory-command-runs-under-the-stop", rule: "OC-9", rel: CLI_REL, from: PIN.stopCase, to: "case 'memory':\n      return true;" },
  { name: "production-passes-dependencies", rule: "OC-9", rel: CLI_REL, from: PIN.cliCase, to: "case 'memory':\n      return memory(ctx, flags, positionals, { terminal: () => ({ stdinIsTTY: true, stdoutIsTTY: true, ask: () => 'x' }) });" },
  { name: "command-not-exported", rule: "OC-9", rel: INDEX_REL, from: PIN.indexExport, to: "" },
  { name: "dependencies-replace-the-defaults-wholesale", rule: "OC-9", rel: MEM_REL, from: PIN.overridesOnly, to: "const deps: MemoryCommandDeps = overrides as MemoryCommandDeps;" },
  // OC-10
  { name: "command-reads-the-environment", rule: "OC-10", rel: MEM_REL, from: PIN.availableUsed, to: "return terminalAvailable(terminal) && process.env['X'] === undefined ? terminal : null;" },
  { name: "verifier-imports-a-node-module", rule: "OC-10", rel: VER_REL, from: "export type OwnerTerminal = TenantReceiptTerminal;", to: "import { readFileSync } from 'node:fs';\nexport type OwnerTerminal = TenantReceiptTerminal;" },
  // OC-11
  { name: "memory-validator-forgets-the-call-site", rule: "OC-11", rel: PM_REL, from: PIN.pmNarrowed, to: '"projectos/agent/src/commands/nothing.ts": ["approveMemoryProposal"]' },
  { name: "deletion-entry-points-open-to-every-file", rule: "OC-11", rel: PM_REL, from: PIN.pmDeletionRefuses, to: "void 0;" },
  { name: "deletion-importer-moved", rule: "OC-11", rel: PM_REL, from: PIN.pmDeletionSites, to: 'const DELETION_CALL_SITES = ["projectos/agent/src/commands/nothing.ts"];' },
  { name: "memory-validator-stops-refusing", rule: "OC-11", rel: PM_REL, from: PIN.pmStillRefuses, to: 'E("PM-16", `${rel} is fine and calls' },
  { name: "cap-back-to-six-hundred", rule: "OC-12", rel: MEM_REL, from: PIN.storeLimit, to: "const cap = 600;" },
  { name: "cut-text-is-asked-about", rule: "OC-12", rel: MEM_REL, from: PIN.notShownRefused, to: "if (false) return decided(refusal('MEMORY_TEXT_NOT_SHOWN_IN_FULL'" },
  { name: "the-block-is-left-out-of-the-prompt", rule: "OC-12", rel: MEM_REL, from: PIN.promptBlocks, to: "const extra = [...proposalFacts(proposal)];" },
  { name: "whole-text-quietly-cut", rule: "OC-12", rel: VER_REL, from: PIN.wholeOrNull, to: "" },
  { name: "long-lines-cut-inside-the-block", rule: "OC-12", rel: VER_REL, from: PIN.wholeCap, to: "visibleText(line, 200)" },
  { name: "a-role-in-the-file-opens-a-decision", rule: "OC-13", rel: MEM_REL, from: PIN.decisionRefused, to: "if ((held === undefined || held === 'decision') && proposal.provenance.authorRole !== 'owner') {" },
  { name: "an-entry-with-no-record-is-replaceable", rule: "OC-13", rel: MEM_REL, from: PIN.decisionRefused, to: "if (held === 'decision') {" },
  { name: "the-exemption-comes-before-the-decision-rule", rule: "OC-13", rel: MEM_REL, from: PIN.decisionRefused, to: "if (proposal.provenance.authorRole === 'owner' && proposal.kind !== 'summary') return null;\n  if (held === undefined || held === 'decision') {" },
  { name: "the-prompt-leaves-out-who-proposed-it", rule: "OC-13", rel: MEM_REL, from: PIN.promptBlocks, to: "const extra = [...blocks];" },
  { name: "the-role-is-not-shown", rule: "OC-13", rel: MEM_REL, from: PIN.factsRole, to: "role hidden" },
  { name: "the-ledger-reference-is-not-shown", rule: "OC-13", rel: MEM_REL, from: PIN.factsKind, to: "kind ${visibleText(proposal.kind, 16)}" },
  { name: "another-case-is-another-file", rule: "OC-14", rel: MEM_REL, from: PIN.spellingCase, to: "if (false) return true;" },
  { name: "the-spelling-check-is-skipped", rule: "OC-14", rel: MEM_REL, from: PIN.spellingGate, to: "if (false) {" },
  { name: "a-trailing-dot-or-space-passes", rule: "OC-14", rel: MEM_REL, from: PIN.spellingDots, to: "segments.some((segment) => SHORT_NAME.test(segment))" },
  { name: "a-short-name-passes", rule: "OC-14", rel: MEM_REL, from: PIN.spellingDots, to: "segments.some((segment) => TRAILING_DOT_OR_SPACE.test(segment))" },
  { name: "the-fold-is-case-sensitive", rule: "OC-14", rel: MEM_REL, from: PIN.foldSeparators, to: "text.split(BACKSLASH).join('/').replace(/\\\\/+/g, '/')" },
  { name: "the-fold-keeps-backslashes", rule: "OC-14", rel: MEM_REL, from: PIN.foldSeparators, to: "text.replace(/\\\\/+/g, '/').toLowerCase()" },
  { name: "the-folded-citation-is-not-used", rule: "OC-14", rel: MEM_REL, from: PIN.foldUsed, to: "const citedFolded = false;" },
  { name: "the-hash-citation-is-case-sensitive", rule: "OC-14", rel: MEM_REL, from: PIN.foldHash, to: "const wantedHash = hash;" },
  { name: "a-folded-hash-is-not-compared", rule: "OC-14", rel: MEM_REL, from: PIN.foldCompare, to: "return folded.includes(wantedPath);" },
  { name: "index-delete-without-a-terminal", rule: "OC-15", rel: MEM_REL, from: PIN.indexTerminal, to: "const { sys, root } = ctx;\n  const where" },
  { name: "index-delete-records-nothing-to-delete", rule: "OC-15", rel: MEM_REL, from: PIN.indexNothing, to: "if (false) return { code: 0, lines: [" },
  { name: "index-delete-skips-the-typed-code", rule: "OC-15", rel: MEM_REL, from: PIN.indexVerified, to: "terminalIndexVerifier(() => terminal)(claim) === undefined" },
  { name: "the-shown-hash-is-not-compared", rule: "OC-16", rel: MEM_REL, from: PIN.shownHash, to: "if (false) {" },
  { name: "the-shown-hash-is-not-passed", rule: "OC-16", rel: MEM_REL, from: PIN.shownHashPassed, to: "{ hash: null, citedFolded }" },
  { name: "a-changed-item-reads-as-a-typo", rule: "OC-16", rel: MEM_REL, from: PIN.changedMapped, to: "stop === 'changed') return refusal('MEMORY_OWNER_NOT_CONFIRMED'" },
];

/** Every named mutation must be killed by its own rule. Applied to CRLF-folded text, as `check` reads it. */
function selfTest(raw) {
  const errors = [];
  for (const m of MUTATIONS) {
    const text = raw[m.rel] === null || raw[m.rel] === undefined ? null : raw[m.rel].replace(/\r\n/g, "\n");
    if (text === null || !text.includes(m.from)) {
      errors.push(`OC-M: mutation '${m.name}' no longer applies to ${m.rel}; update the mutation with the rule`);
      continue;
    }
    const fired = check({ ...raw, [m.rel]: text.replace(m.from, m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`OC-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

function run() {
  const raw = {};
  for (const rel of FIXED) raw[rel] = read(rel);
  const errors = check(raw).map(([, msg]) => msg);
  if (errors.length === 0) errors.push(...selfTest(raw));
  for (const [rel, needles] of Object.entries(TESTS)) {
    const t = read(rel);
    if (t === null) {
      errors.push(`OC-T: ${rel} is missing`);
      continue;
    }
    for (const n of needles) if (!t.includes(n)) errors.push(`OC-T: ${rel} no longer proves "${n}"`);
  }
  return errors;
}

if (require.main === module) {
  const e = run();
  if (e.length) {
    e.forEach((x) => console.error("FAIL: " + x));
    console.error("val-projectos-memory-owner-commands1a: " + e.length + " error(s)");
    process.exit(1);
  }
  console.log(`val-projectos-memory-owner-commands1a: PASS (${MUTATIONS.length} named mutations killed)`);
}

module.exports = { run, check, selfTest, MUTATIONS, TESTS };
