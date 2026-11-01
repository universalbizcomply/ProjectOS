"use strict";
/**
 * THE CREDIT RULE — PROJECTOS-PORT-FOUNDATION1A (plan v1.31, docs/changes/delta_spec_V4_PORTS.md).
 *
 * Owner, 2026-11-01: "i want to claim it's mine with giving credits to the due". ProjectOS is the owner's
 * product, and code taken from elsewhere keeps its credit. ADR-P1 is the rule. This validator holds it for
 * every file in the port directories, whether or not those directories exist yet:
 *
 *   PC-1  "the file speaks for itself"              — and a port with no header lands
 *   PC-2  "a credit makes it fine"                  — and restricted code lands in a product for sale
 *   PC-3  "it is open source, so it is approved"    — and an unread licence lands
 *   PC-4  "the sha is close enough"                 — and the credit points at code nobody read
 *   PC-5  "the header is enough"                    — and the notices file stops being the record
 *   PC-6  "most of the header is there"             — and the credit no longer says what the delta requires
 *   PC-7  "the licence line is only a label"        — and a file claims a licence its source does not give
 *   PC-8  "Apache is much like MIT"                 — and section 4(b) is not met
 *   PC-9  "Pi is a detail"                          — and a further upstream goes uncredited, or unread
 *   PC-10 "mark it original and move on"            — and upstream code is claimed as the owner's own
 *   PC-11 "the header at the top covers the file"   — and a second file is pasted in below it
 *   PC-12 "a path is only text"                     — and a credit climbs out of the upstream tree or names a logo
 *   PC-13 "a link is a file"                        — and something unreadable is never judged
 *   PC-14 "the notices file was right when written" — and it drifts from the approved list
 *   PC-15 "a licence text is boilerplate"           — and the text it holds is not the licence
 *   PC-16 "an entry is free text"                   — and it credits a file or a path that is not there
 *   PC-17 "the directory list is obvious"           — and one port directory quietly stops being judged
 *   PC-18 "ADR-P1 can say less"                     — and nobody can read what was decided
 *   PC-19 "the old records will be understood"      — and they contradict the owner's ADOPT decision
 *   PC-20 "the map still points at the code"        — and a port starts from the wrong pin or the wrong download
 *   PC-21 "register it later"                       — and nothing ever runs this file
 *   PC-22 "the file was rewritten, so it is ours"   — and a header and its entry vanish together
 *   PC-23 "it is only a helper, it can live there"  — and a port lands outside every directory judged here
 *
 * AN EMPTY TREE PROVES NOTHING. The port directories hold no file today, so a pass over the real tree is
 * vacuous. `selfTest` therefore always runs: every rule is proved against fixture files in one temp directory,
 * after a positive control that a correct file of each kind passes. A mutation counts as killed only when
 * exactly the rules it names fire, so a proof cannot be carried by some other refusal.
 *
 * THE FIXTURE NEVER HOLDS REAL ENTRIES. It takes the notices text above `PORTED FILES`, so the first real port
 * cannot read as a stale entry in a tree that does not contain its file.
 *
 * THE DENIED SCAN READS COMMENTS, ON PURPOSE. Licence and copyright lines live in comments, so stripping them
 * first would blind the one scan that needs them. It normalises instead, and a false positive here is a
 * refusal, which is the safe way to be wrong. The scans over records strip comments first, because hidden text
 * is neither a decision nor a claim.
 *
 * Reads files, and asks git which files are tracked and which entries ever existed. Writes only inside its own
 * scratch directory.
 */

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-port-credit1a";
const THIS_FILE = `projectos/validators/${THIS_VALIDATOR}.cjs`;
const NOTICES_REL = "THIRD_PARTY_NOTICES";
const PORTED_FILES_HEADING = "PORTED FILES\n";
const ADR_P_REL = "docs/adr/ADR-P1-port-ownership-and-credit.md";
const ADR_S1_REL = "docs/adr/ADR-S1-hermes-agent.md";
const ADR_S2_REL = "docs/adr/ADR-S2-openclaw.md";
const RECON_REL = "docs/recon/V4_Capability_Recon.md";
const MAP_REL = "docs/recon/V4_Port_Map.md";
const VA_REL = "projectos/validators/validate-all.cjs";
const CR_REL = "projectos/speed/cached-runner.cjs";
const RECORDS = [ADR_P_REL, ADR_S1_REL, ADR_S2_REL, RECON_REL, MAP_REL, VA_REL, CR_REL];

/** Every file under these is judged. ADR-P1 §7 lists the same directories, and PC-17 keeps the two equal. */
const PORT_DIRS = [
  "projectos/core/src/search",
  "projectos/core/src/memory",
  "projectos/core/src/skills",
  "projectos/core/src/context",
  "projectos/core/src/approvals",
  "projectos/agent/src/search",
  "projectos/agent/src/memory",
  "projectos/agent/src/skills",
];
/** Test trees the port phases hold. Most files there are ours, so one is judged only once it shows upstream marks. */
const TEST_DIRS = ["projectos/core/test", "projectos/agent/test"];
const inDirs = (rel, dirs) => dirs.some((dir) => rel.startsWith(`${dir}/`));

/**
 * The approved list. `licenceSha256` is the SHA-256 of that project's own LICENSE file at the pin. `sha` is the
 * current pin. A re-pin moves the old one to `earlierPins`, so a file already ported keeps its true commit.
 */
const SOURCES = {
  "hermes-agent": {
    url: "https://github.com/NousResearch/hermes-agent",
    sha: "d3e586881eacb132595edcbe4c170be8381e40c5",
    spdx: "MIT",
    copyright: "Copyright (c) 2025 Nous Research",
    licenceSha256: "821556e6336796450ab852d375117b48a4887e71d255794fd6318d99982a5ab6",
  },
  openclaw: {
    url: "https://github.com/openclaw/openclaw",
    sha: "c5b56f2505c4f6a5803125d2923e2934c5f750af",
    spdx: "MIT",
    copyright: "Copyright (c) 2026 OpenClaw Foundation",
    licenceSha256: "9efd316ecf1c4c60f6fd5d26433142fff2b6794d7d328e9bc6179b29bf9c82a4",
  },
  "copilotkit-openbot": {
    url: "https://github.com/CopilotKit/OpenBot",
    sha: "c396a5f68c817043846f1ca3c2b42061ee73ceb5",
    spdx: "MIT",
    copyright: "Copyright (c) 2026 CopilotKit",
    licenceSha256: "6d35a6bb107ae508da34636387f6208e75a6938e797bc0d5bfa9489d2ca95bad",
  },
  "oh-my-hermes": {
    url: "https://github.com/rlaope/oh-my-hermes",
    sha: "612a1cd9c44a19ecddcd263865e40e8c3910a514",
    spdx: "MIT",
    copyright: "Copyright (c) 2026 oh-my-hermes contributors",
    licenceSha256: "51a61c8602b3b1ae26985cc16b90adfe3f98c9791b7d22e296f385aa6c85971a",
  },
  rakazo: {
    url: "https://github.com/elie222/rakazo",
    sha: "bf78ebd7961a28a8b437c605319c47b59edadc1c",
    spdx: "Apache-2.0",
    copyright: "Copyright 2026 Rakazo contributors",
    licenceSha256: "b9738182c46747cb7cd36cad62d55c8922ca8d0029df280d3d73bb3c95d34935",
  },
};
/**
 * Upstreams of an upstream, named by `Also-Credits`. An approved source can be named too. Anything else needs a
 * reviewed line here and its text in the notices. Pi's text comes from the Pi entry in OpenClaw's notices file.
 */
const FURTHER = {
  "pi-mono": {
    url: "https://github.com/earendil-works/pi-mono",
    spdx: "MIT",
    copyright: "Copyright (c) 2025 Mario Zechner",
    licenceSha256: "4f6a1985796db5225e3b1e59972bd47e07a27a0748427cb3d3c8fbf39f9311f0",
    textFrom: "the Pi entry in OpenClaw's own THIRD_PARTY_NOTICES.md, because ProjectOS holds no copy of Pi's own LICENSE",
  },
};
const PI_ID = "pi-mono";
const PI = FURTHER[PI_ID];
const pinsOf = (source) => [source.sha, ...(source.earlierPins ?? [])];
const COPYRIGHTS = [...Object.values(SOURCES), ...Object.values(FURTHER)].map((s) => s.copyright);
const UPSTREAM_NAMES = ["hermes", "nous research", "openclaw", "copilotkit", "openbot", "rakazo", "pi-mono", "mario zechner", "earendil", ...Object.values(SOURCES).map((s) => s.url.toLowerCase())];
const LICENCE_MARK = /\bcopyright\b|©|\(c\)\s*\d{4}|\bSPDX-License-Identifier\b|Permission is hereby granted|Ported-From:/i;

/**
 * Judged on `compact` text, so no spacing, punctuation, width or case gets a name past. nightly-labs: PolyForm
 * Noncommercial, with its owner, folder, domain and pin. LobeHub: its Community License needs a commercial licence
 * for a derivative work (docs/legal/vendor-provenance.md §1), and a Hermes file quotes a fragment of it.
 */
const DENIED_PIN_PREFIX = "7ef25fbc";
const DENIED_TERMS = ["polyform", "nightlylabs", "synthetify", "openbotlower", "openbotrun", "lobehub", DENIED_PIN_PREFIX];
const compact = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const deniedIn = (text) => {
  const flat = compact(text);
  return DENIED_TERMS.find((term) => flat.includes(term)) ?? null;
};

const ORIGINAL_MARK = "Origin: original ProjectOS code";
/** Ends our header. Upstream text kept below it, as ADR-P1 §3 and Apache-2.0 §4(c) require, is not read as ours. */
const HEADER_END = "End-Of-Credit-Header";
const MODIFIED_STATEMENT = "modified for ProjectOS";
const HEADER_KEYS = ["SPDX-License-Identifier", "Ported-From", "Source-Path", "Source-Commit", "Source-Copyright", "Also-Credits", "Port-Strategy", "Modified-By", "Notice"];
const REQUIRED_KEYS = ["SPDX-License-Identifier", "Ported-From", "Source-Path", "Source-Commit", "Source-Copyright", "Modified-By"];
const LIST_KEYS = ["Also-Credits", "Modified-By"];
const ENTRY_KEYS = ["Source", "Upstream", "Source-Path", "Source-Commit", "Licence", "Copyright", "Licence-Text"];
const COMMENT_LEADER = /^(?:\/\/+|#+|\/\*+|\*+\/?|<!--|--)/;
const COMMENT_CLOSERS = ["*/", "-->"];
const LICENCE_BEGIN = "=== BEGIN LICENCE TEXT ===";
const LICENCE_END = "=== END LICENCE TEXT ===";
const CLIMBS_OUT = /^[/\\]|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/;
const BRAND_ASSET = /\.(?:png|svg|icns|ico|jpe?g|gif|webp)$/i;
const NO_CHANGE = /^(?:none|n\/?a|nothing|no changes?|unchanged|-+)\.?$/i;
/** A committed owner decision, in the store the plan decisions already use. */
const OWNER_RECORD = /^\.projectops\/plan-decisions\/PLANDEC-[0-9a-z-]+\.json$/;
const OWNER_NAME = "Murad";
const SCANNED_SOURCE = /\.(?:[cm]?[jt]sx?|rs|py|ps1|sh|bat|kt|swift|java|c|cc|cpp|h|hpp|css|html|vue|svelte|sql)$/i;
const NOT_SOURCE = ["docs/", "knowledge/", ".projectops/"];

const RULE_NAMES = {
  "PC-1": "no header",
  "PC-2": "denied source",
  "PC-3": "unknown source",
  "PC-4": "wrong sha",
  "PC-5": "no notices entry",
  "PC-6": "incomplete header",
  "PC-7": "wrong licence or copyright",
  "PC-8": "Apache change not stated",
  "PC-9": "further credit wrong",
  "PC-10": "original mark on upstream code",
  "PC-11": "header below the code",
  "PC-12": "bad source path",
  "PC-13": "not a regular file",
  "PC-14": "notices source wrong",
  "PC-15": "licence text wrong",
  "PC-16": "notices entry wrong",
  "PC-17": "port directories drifted",
  "PC-18": "ADR-P1 incomplete",
  "PC-19": "ADOPT record incomplete",
  "PC-20": "port map wrong",
  "PC-21": "not registered",
  "PC-22": "header lost",
  "PC-23": "upstream mark outside the port directories",
};

const refusal = (code, file, message) => ({ code, file, message: `${code} ${RULE_NAMES[code]}: ${file}: ${message}` });
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const sourceOf = (id, ctx) => (Object.hasOwn(ctx.sources, id) ? ctx.sources[id] : null);
const countOf = (text, needle) => text.split(needle).length - 1;
const normalise = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
const absOf = (root, rel) => path.join(root, ...rel.split("/"));
const isFile = (abs) => fs.lstatSync(abs, { throwIfNoEntry: false })?.isFile() === true;
const pathsOf = (block) => (block["Source-Path"] ?? "").split(";").map((p) => p.trim());
const sourceIdOf = (block) => (block["Ported-From"] ?? "").split(/\s+/)[0];
const creditIdOf = (line) => line.split(/\s+/)[0];

function isRealDate(text) {
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

// ---------------------------------------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------------------------------------

/** The text of a comment line, or null. Linear: it trims first and then only looks at the two ends. */
function commentText(line) {
  const trimmed = line.trim();
  const leader = COMMENT_LEADER.exec(trimmed);
  if (leader === null) return null;
  const body = trimmed.slice(leader[0].length);
  const closer = COMMENT_CLOSERS.find((c) => body.endsWith(c));
  return (closer === undefined ? body : body.slice(0, -closer.length)).trim();
}

/** The comment block a file opens with. A header anywhere else, or inside a string, is not a header. */
function leadingComment(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const comment = commentText(line);
    if (comment === null) break;
    lines.push(comment);
  }
  return lines;
}

/** Our header: the leading comment up to the end marker, when there is one. */
const creditLines = (lines) => (lines.includes(HEADER_END) ? lines.slice(0, lines.indexOf(HEADER_END)) : lines);

/** One block per upstream source. A repeated single-value key opens the next block, so none is overwritten. */
function headerBlocks(commentLines) {
  const blocks = [];
  for (const line of commentLines) {
    const colon = line.indexOf(":");
    const key = line.slice(0, colon);
    if (colon <= 0 || !HEADER_KEYS.includes(key)) continue;
    const value = line.slice(colon + 1).trim();
    const isList = LIST_KEYS.includes(key);
    if (blocks.length === 0 || (!isList && key in blocks[blocks.length - 1])) blocks.push({});
    const block = blocks[blocks.length - 1];
    block[key] = isList ? [...(block[key] ?? []), value] : value;
  }
  return blocks;
}

const blocksIn = (text) => headerBlocks(creditLines(leadingComment(normalise(text))));

function modifiedProblems(rel, source, modified) {
  const dated = (line) => (/\b\d{4}-\d{2}-\d{2}\b/.exec(line) ?? []).some(isRealDate);
  const stated = (line) => {
    const at = line.indexOf("CHANGED:");
    if (at < 0) return false;
    const what = line.slice(at + "CHANGED:".length).trim();
    return what !== "" && !NO_CHANGE.test(what);
  };
  return [
    ...(modified.some((line) => line.includes(MODIFIED_STATEMENT) && dated(line)) ? [] : [refusal("PC-6", rel, `no Modified-By line with a real date says "${MODIFIED_STATEMENT}"`)]),
    ...(source.spdx !== "Apache-2.0" || modified.some(stated) ? [] : [refusal("PC-8", rel, "an Apache-2.0 file must state what changed, with CHANGED: on a Modified-By line")]),
  ];
}

function furtherCreditProblems(rel, id, block, ctx) {
  const credits = block["Also-Credits"] ?? [];
  const known = (line) => {
    const named = creditIdOf(line);
    const upstream = Object.hasOwn(FURTHER, named) ? FURTHER[named] : sourceOf(named, ctx);
    return upstream !== null && line.includes(upstream.copyright);
  };
  return [
    ...credits.filter((line) => !known(line)).map((line) => refusal("PC-9", rel, `'${line}' is not a recorded further upstream with its copyright`)),
    ...(id !== "openclaw" || credits.some((line) => creditIdOf(line) === PI_ID) ? [] : [refusal("PC-9", rel, `every OpenClaw file credits ${PI_ID}`)]),
  ];
}

function blockProblems(rel, block, records, ctx) {
  const refuse = (code, message) => refusal(code, rel, message);
  const missing = REQUIRED_KEYS.filter((key) => (Array.isArray(block[key]) ? block[key].length === 0 : !block[key]));
  if (missing.length > 0) {
    return [refuse("PC-6", `the credit header has no ${missing.join(", ")}. Upstream text kept below it needs ${HEADER_END} above it`)];
  }

  const [id, url, ...rest] = block["Ported-From"].split(/\s+/);
  const source = sourceOf(id, ctx);
  if (source === null || url !== source.url || rest.length > 0) {
    return [refuse("PC-3", `'${block["Ported-From"]}' is not on the approved list`)];
  }

  return [
    ...(pinsOf(source).includes(block["Source-Commit"]) ? [] : [refuse("PC-4", `${id} is pinned at ${pinsOf(source).join(", ")}, not ${block["Source-Commit"]}`)]),
    ...(block["SPDX-License-Identifier"] === source.spdx && block["Source-Copyright"] === source.copyright
      ? []
      : [refuse("PC-7", `${id} is ${source.spdx}, ${source.copyright}`)]),
    ...modifiedProblems(rel, source, block["Modified-By"]),
    ...furtherCreditProblems(rel, id, block, ctx),
    ...pathsOf(block).flatMap((sourcePath) => pathProblems(rel, id, sourcePath, block, records)),
  ];
}

function pathProblems(rel, id, sourcePath, block, records) {
  if (sourcePath === "" || CLIMBS_OUT.test(sourcePath) || BRAND_ASSET.test(sourcePath)) {
    return [refusal("PC-12", rel, `'${sourcePath}' is not a path inside the upstream tree, or it is a brand asset`)];
  }
  const entry = records.find((r) => r.kind === "ENTRY" && r.id === rel && r.fields["Source"] === id && r.fields["Source-Path"] === sourcePath);
  if (entry === undefined) return [refusal("PC-5", rel, `${NOTICES_REL} has no entry for ${id} ${sourcePath}`)];
  const inEntry = (entry.fields["Also-Credits"] ?? "").split(",").map((s) => s.trim());
  return [
    ...(entry.fields["Source-Commit"] === block["Source-Commit"] ? [] : [refusal("PC-16", NOTICES_REL, `${rel}: the file says ${block["Source-Commit"]} and its entry says ${entry.fields["Source-Commit"]}`)]),
    ...(block["Also-Credits"] ?? []).map(creditIdOf).filter((credit) => !inEntry.includes(credit)).map((credit) => refusal("PC-16", NOTICES_REL, `${rel}: the entry does not credit ${credit}`)),
  ];
}

function originalProblems(rel, text, blocks) {
  const lower = text.toLowerCase();
  const names = UPSTREAM_NAMES.filter((name) => lower.includes(name));
  const licence = LICENCE_MARK.exec(text);
  if (blocks.length > 0 || licence !== null || names.length > 0) {
    return [refusal("PC-10", rel, `it is marked original and carries upstream marks: ${[...(licence === null ? [] : [licence[0]]), ...names].join("; ") || "a credit header"}`)];
  }
  return [];
}

function judgeFile(rel, rawText, records, ctx) {
  const text = normalise(rawText);
  const denied = deniedIn(text);
  if (denied !== null) {
    return [refusal("PC-2", rel, `it names a denied source: ${denied}. A credit does not license restricted code`)];
  }
  const lines = leadingComment(text);
  const credit = creditLines(lines);
  const blocks = headerBlocks(credit);
  if (lines.includes(ORIGINAL_MARK)) return originalProblems(rel, text, blocks);
  if (blocks.length === 0) return [refusal("PC-1", rel, `it has neither the mark "${ORIGINAL_MARK}" nor a credit header`)];
  const inHeader = credit.filter((line) => line.startsWith("Ported-From:")).length;
  return [
    ...(countOf(text, "Ported-From:") === inHeader ? [] : [refusal("PC-11", rel, "a Ported-From line sits below the header")]),
    ...blocks.flatMap((block) => blockProblems(rel, block, records, ctx)),
  ];
}

// ---------------------------------------------------------------------------------------------------------
// The notices file
// ---------------------------------------------------------------------------------------------------------

/** Column-0 records only, so the indented example in ENTRY FORMAT is an example and nothing more. */
function parseNotices(text) {
  const records = [];
  let held = null;
  for (const line of text.split("\n")) {
    const current = records[records.length - 1];
    if (held !== null) {
      if (line === LICENCE_END) {
        current.licences.push(`${held.join("\n")}\n`);
        held = null;
      } else {
        held.push(line);
      }
      continue;
    }
    if (line === LICENCE_BEGIN && current !== undefined) {
      held = [];
      continue;
    }
    const head = /^(SOURCE|NOTE|ENTRY|REMOVED): (\S+)$/.exec(line);
    if (head !== null) {
      records.push({ kind: head[1], id: head[2], fields: {}, licences: [] });
      continue;
    }
    const field = /^([A-Z][A-Za-z-]*): (.+)$/.exec(line);
    if (field !== null && current !== undefined) current.fields[field[1]] = field[2];
  }
  return records;
}

function sourceSectionProblems(text, records, ctx) {
  const refuse = (message) => refusal("PC-14", NOTICES_REL, message);
  const sections = records.filter((r) => r.kind === "SOURCE");
  const notes = records.filter((r) => r.kind === "NOTE");
  const wrongFields = (section, want) =>
    Object.entries(want).flatMap(([field, value]) =>
      (value === null ? section.fields[field] : (section.fields[field] ?? "") === value) ? [] : [refuse(`${section.id}: ${field} is wrong or missing`)],
    );
  return [
    ...(`\n${text}`.includes(`\n${PORTED_FILES_HEADING}`) ? [] : [refuse(`the ${PORTED_FILES_HEADING.trim()} heading is missing`)]),
    ...Object.keys(ctx.sources)
      .filter((id) => sections.filter((s) => s.id === id).length !== 1)
      .map((id) => refuse(`${id} needs exactly one SOURCE section`)),
    ...sections.filter((s) => sourceOf(s.id, ctx) === null).map((s) => refuse(`${s.id} is not an approved source`)),
    ...sections
      .filter((s) => sourceOf(s.id, ctx) !== null)
      .flatMap((s) => {
        const source = sourceOf(s.id, ctx);
        return wrongFields(s, {
          Upstream: source.url,
          "Pinned-Commit": source.sha,
          "Earlier-Pins": (source.earlierPins ?? []).join(", "),
          Licence: source.spdx,
          Copyright: source.copyright,
          "NOTICE-File": null,
        });
      }),
    ...Object.keys(FURTHER)
      .filter((id) => notes.filter((n) => n.id === id).length !== 1)
      .map((id) => refuse(`the ${id} note is missing`)),
    ...notes.filter((n) => !Object.hasOwn(FURTHER, n.id)).map((n) => refuse(`${n.id} is not a recorded further upstream`)),
    ...notes
      .filter((n) => Object.hasOwn(FURTHER, n.id))
      .flatMap((n) => {
        const { url, spdx, copyright, textFrom } = FURTHER[n.id];
        return wrongFields(n, { Upstream: url, Licence: spdx, Copyright: copyright, "Text-From": textFrom });
      }),
  ];
}

function licenceTextProblems(text, records, ctx) {
  const refuse = (message) => refusal("PC-15", NOTICES_REL, message);
  const wantOf = (record) => (record.kind === "NOTE" ? (Object.hasOwn(FURTHER, record.id) ? FURTHER[record.id] : null) : sourceOf(record.id, ctx));
  const all = [...Object.values(ctx.sources), ...Object.values(FURTHER)];
  const mitTexts = all.filter((s) => s.spdx === "MIT").length;
  const apacheTexts = all.filter((s) => s.spdx === "Apache-2.0").length;
  return [
    ...records
      .filter((r) => (r.kind === "SOURCE" || r.kind === "NOTE") && wantOf(r) !== null)
      .filter((r) => r.licences.length !== 1 || sha256(r.licences[0]) !== wantOf(r).licenceSha256)
      .map((r) => refuse(`${r.id}: the licence text does not match its pinned hash, byte for byte`)),
    ...(countOf(text, "Permission is hereby granted") === mitTexts ? [] : [refuse(`the MIT text must appear ${mitTexts} times, once per MIT upstream`)]),
    ...(countOf(text, "TERMS AND CONDITIONS FOR USE") === apacheTexts ? [] : [refuse(`the Apache-2.0 text must appear ${apacheTexts} time`)]),
  ];
}

function entryProblems(records, root, ctx) {
  const refuse = (rel, message) => refusal("PC-16", NOTICES_REL, `${rel}: ${message}`);
  const entries = records.filter((r) => r.kind === "ENTRY");
  const keyOf = (entry) => `${entry.id}|${entry.fields["Source"]}|${entry.fields["Source-Path"]}`;
  return entries.flatMap((entry) => {
    const { id: rel, fields } = entry;
    const missing = ENTRY_KEYS.filter((key) => !fields[key]);
    if (missing.length > 0) return [refuse(rel, `the entry has no ${missing.join(", ")}`)];
    const source = sourceOf(fields["Source"], ctx);
    if (source === null) return [refuse(rel, `'${fields["Source"]}' is not an approved source`)];
    if (rel.split("/").includes("..") || !inDirs(rel, [...PORT_DIRS, ...TEST_DIRS])) return [refuse(rel, "it is outside the port directories")];
    const removed = records.some((r) => r.kind === "REMOVED" && r.id === rel);
    if (removed) return [refuse(rel, "it has a REMOVED record, so the entry must go")];
    const abs = absOf(root, rel);
    const exists = isFile(abs);
    const blocks = exists ? blocksIn(fs.readFileSync(abs, "utf8")) : [];
    if (exists && blocks.length === 0) return [];
    const carrying = blocks.filter((block) => sourceIdOf(block) === fields["Source"]);
    return [
      ...(carrying.length > 0 ? [] : [refuse(rel, `no such file carries a ${fields["Source"]} header: the entry is stale`)]),
      ...(carrying.length === 0 || carrying.some((block) => pathsOf(block).includes(fields["Source-Path"])) ? [] : [refuse(rel, `its header does not name ${fields["Source-Path"]}`)]),
      ...(fields["Upstream"] === source.url && pinsOf(source).includes(fields["Source-Commit"]) && fields["Licence"] === source.spdx && fields["Copyright"] === source.copyright
        ? []
        : [refuse(rel, `the entry does not match the approved ${fields["Source"]} record`)]),
      ...(fields["Licence-Text"] === `SOURCE ${fields["Source"]}, in this file` ? [] : [refuse(rel, "the entry does not point to the licence text")]),
      ...(fields["Source"] !== "openclaw" || (fields["Also-Credits"] ?? "").split(",").map((s) => s.trim()).includes(PI_ID) ? [] : [refuse(rel, `an OpenClaw entry credits ${PI_ID}`)]),
      ...(entries.filter((other) => keyOf(other) === keyOf(entry)).length === 1 ? [] : [refuse(rel, "the entry is duplicated")]),
    ];
  });
}

/** The owner's approval, committed, naming this path. Nothing else takes a recorded header away. */
function ownerRecordHolds(rel, records, root, ctx) {
  const record = records.find((r) => r.kind === "REMOVED" && r.id === rel)?.fields["Owner-Record"];
  if (record === undefined || !OWNER_RECORD.test(record) || !ctx.tracked.includes(record)) return false;
  const abs = absOf(root, record);
  if (!isFile(abs)) return false;
  const text = fs.readFileSync(abs, "utf8");
  try {
    const decision = JSON.parse(text);
    return decision.decision === "approve" && decision.decidedBy === OWNER_NAME && text.includes(rel);
  } catch {
    return false;
  }
}

/** Every path ever recorded keeps its header. Git remembers an entry deleted in the same commit as the header. */
function headerLossProblems(records, root, ctx) {
  const entries = records.filter((r) => r.kind === "ENTRY").map((r) => r.id);
  return [...new Set([...ctx.recordedEver, ...entries])]
    .filter((rel) => !rel.split("/").includes("..") && isFile(absOf(root, rel)))
    .filter((rel) => blocksIn(fs.readFileSync(absOf(root, rel), "utf8")).length === 0)
    .filter((rel) => !ownerRecordHolds(rel, records, root, ctx))
    .map((rel) => refusal("PC-22", rel, "this recorded port lost its header. A header is never dropped by line count or by a rewrite claim; removing one needs a committed owner record naming the path"));
}

function noticesProblems(text, records, root, ctx) {
  const denied = deniedIn(text);
  if (denied !== null) return [refusal("PC-2", NOTICES_REL, `it names a denied source: ${denied}`)];
  return [...sourceSectionProblems(text, records, ctx), ...licenceTextProblems(text, records, ctx), ...entryProblems(records, root, ctx), ...headerLossProblems(records, root, ctx)];
}

// ---------------------------------------------------------------------------------------------------------
// One tree: the real repository, or a fixture
// ---------------------------------------------------------------------------------------------------------

/** Every entry under the port directories, any extension, any depth. Anything not a file or a directory is `strange`. */
function walkPortDirs(root) {
  const found = [];
  const strange = [];
  const visit = (rel) => {
    const abs = absOf(root, rel);
    const stat = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (!stat.isDirectory()) {
      (stat.isFile() ? found : strange).push(rel);
      return;
    }
    fs.readdirSync(abs).forEach((name) => visit(`${rel}/${name}`));
  };
  PORT_DIRS.forEach(visit);
  return { found, strange };
}

const isScanned = (rel) => SCANNED_SOURCE.test(rel) && rel !== THIS_FILE && !inDirs(rel, PORT_DIRS) && !NOT_SOURCE.some((prefix) => rel.startsWith(prefix));
const showsUpstream = (text) => text.includes("Ported-From:") || COPYRIGHTS.some((line) => text.includes(line));

/** Tracked source outside the port directories carries no upstream mark. A granted test tree is judged instead. */
function strayMarkProblems(root, records, ctx) {
  return ctx.tracked.filter(isScanned).flatMap((rel) => {
    const abs = absOf(root, rel);
    if (!isFile(abs)) return [];
    const text = fs.readFileSync(abs, "utf8");
    if (!showsUpstream(text)) return [];
    if (inDirs(rel, TEST_DIRS)) return judgeFile(rel, text, records, ctx);
    return [refusal("PC-23", rel, "it carries an upstream mark outside the port directories. Adding a port directory is a listed, reviewed change")];
  });
}

function judgeRoot(root, ctx) {
  const noticesAbs = path.join(root, NOTICES_REL);
  if (!fs.existsSync(noticesAbs)) {
    return { judged: [], refusals: [refusal("PC-14", NOTICES_REL, "the notices file is missing")] };
  }
  const text = normalise(fs.readFileSync(noticesAbs, "utf8"));
  const records = parseNotices(text);
  const { found, strange } = walkPortDirs(root);
  return {
    judged: found,
    refusals: [
      ...noticesProblems(text, records, root, ctx),
      ...strange.map((rel) => refusal("PC-13", rel, "it is a link or a device, so it cannot be judged")),
      ...found.flatMap((rel) => judgeFile(rel, fs.readFileSync(absOf(root, rel), "utf8"), records, ctx)),
      ...strayMarkProblems(root, records, ctx),
    ],
  };
}

/** What only git knows. Null when git cannot say, and `run` refuses rather than judging without it. */
function gitFacts(root) {
  const git = (...args) => spawnSync("git", ["-C", root, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
  const tracked = git("ls-files", "-z");
  const history = git("log", "--full-history", "--no-color", "--no-ext-diff", "--format=", "-p", "--", NOTICES_REL);
  if (tracked.status !== 0 || history.status !== 0) return null;
  return {
    tracked: tracked.stdout.split("\0").filter((rel) => rel !== ""),
    recordedEver: [...history.stdout.matchAll(/^\+ENTRY: (\S+)\r?$/gm)].map((m) => m[1]),
  };
}

// ---------------------------------------------------------------------------------------------------------
// The records
// ---------------------------------------------------------------------------------------------------------

const OWNER_RULE = `"i want to claim it's mine with giving credits to the due"`;
/** The owner's sentence continues after this in the record, so there is no closing quotation mark here. */
const OWNER_ADOPT = `"I asked you to adopt the capabilites, clone the code then adopt to our project.`;
const ADR_P_PINS = {
  "the owner's rule": OWNER_RULE,
  "its status": "Status: Proposed.",
  "the owner's approval of the delta": "The owner approved the port delta on 2026-11-01",
  "what the owner may claim": "## 2. What the owner may claim",
  "the permitted claim": "ProjectOS is my product, and it includes credited open-source components",
  "the refused claim": "Do not say the owner wrote the upstream code.",
  "the open holder question in §2": "Who legally holds the original code is still open (§9).",
  "what must be credited": "## 3. What must be credited",
  "Apache-2.0 section 4(a)": "| §4(a) | Give recipients a copy of the licence |",
  "Apache-2.0 section 4(b)": "| §4(b) | Modified files carry prominent notices that they were changed |",
  "Apache-2.0 section 4(c)": "| §4(c) | Keep the source's copyright, patent, trademark and attribution notices |",
  "Apache-2.0 section 4(d)": "| §4(d) | Carry the upstream `NOTICE`, if there is one |",
  "Apache-2.0 section 6": "| §6 | No right to the licensor's names or marks |",
  "the non-commercial rule": "A credit does not license non-commercial code.",
  "the header rule": "A header is never dropped by line count or by a rewrite claim.",
  "the limit on Source-Path": "Whether a `Source-Path` exists at the pin.",
  "the limit on shipping": "Shipping the notices with the product.",
  "the limit on per-file licences": "Per-file licences inside a source.",
  "the limit on OpenClaw's entries": "OpenClaw's own notice entries.",
  "the open legal holder": "The legal holder of original ProjectOS code is an OPEN owner decision.",
};
/** History stays: each record keeps what was decided before, and says what replaced it. */
const ADOPT_RECORDS = {
  [ADR_S1_REL]: { supersedes: "This ADOPT decision supersedes the REFERENCE decision below.", history: "Its memory and skill writes come from its own loop and its own approve command" },
  [ADR_S2_REL]: { supersedes: "This ADOPT decision supersedes the REFERENCE decision below.", history: "OpenClaw is a second orchestrator by design" },
  [RECON_REL]: { supersedes: "This ADOPT decision supersedes the rebuild-only method described below.", history: "the replica-recon method, using official documentation and READMEs only" },
};
const NEVER_COPIED = /\bnever cop(?:y|ies|ied)\b/i;
const RECON_WARNING = "It is also not nightly-labs/openbot, which is PolyForm Noncommercial and is never a source.";
const MAP_WARNING = "`incoming-2026-11-01/openbot-lower` is PolyForm Noncommercial";
const MAP_DOWNLOADS = [String.raw`incoming-2026-11-01\hermes-agent\hermes-agent-main`, String.raw`incoming-2026-11-01\openclaw\openclaw-main`, String.raw`incoming-2026-11-01\openbot-upper\OpenBot-main`];

/** ADR prose with hidden text, wrapping and emphasis gone, so it is judged by what a reader sees. */
const visibleText = (text) => text.replace(/<!--[\s\S]*?-->/g, " ");
const prose = (text) => visibleText(text).replace(/\*\*/g, "").replace(/\s+/g, " ");

/** The registered names. A name that is commented out, on its own line or after code, is not registered. */
function modulesOf(text) {
  const open = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const start = open.indexOf("const MODULES = [");
  const end = open.indexOf("\n];", start);
  if (start < 0 || end < 0) return null;
  return [...open.slice(start, end).replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function recordProblems(raw) {
  const errors = [];
  const E = (rule, msg) => errors.push([rule, `${rule} ${RULE_NAMES[rule]}: ${msg}`]);
  for (const rel of RECORDS) {
    if (raw[rel] === null || raw[rel] === undefined) {
      E("PC-21", `${rel} is missing`);
      return errors;
    }
  }

  // PC-17: the directories the ADR names are exactly the directories this file judges.
  const judged = [...PORT_DIRS, ...TEST_DIRS].sort();
  const listed = [...visibleText(raw[ADR_P_REL]).matchAll(/^- `(projectos\/[a-z]+\/(?:src\/[a-z]+|test))\/`/gm)].map((m) => m[1]).sort();
  if (JSON.stringify(listed) !== JSON.stringify(judged)) {
    E("PC-17", `ADR-P1 §7 lists ${listed.length} directories, and they are not the ${judged.length} this validator judges`);
  }

  // PC-18: ADR-P1 says what the acceptance criteria require, and does not decide what is still the owner's.
  const adr = prose(raw[ADR_P_REL]);
  for (const [what, pin] of Object.entries(ADR_P_PINS)) {
    if (!adr.includes(pin)) E("PC-18", `ADR-P1 no longer states ${what}`);
  }
  if (/\bStatus:\s*ACCEPTED\b/i.test(adr)) E("PC-18", "ADR-P1 says Accepted, and only the owner marks an ADR Accepted");
  const namesCompany = adr.split(/(?<=[.!?])\s+/).filter((sentence) => /\bRBT\b/.test(sentence) && !sentence.includes("unconfirmed"));
  if (namesCompany.length > 0) E("PC-18", `ADR-P1 names a company as fact: ${namesCompany[0]}`);
  const visibleAdr = visibleText(raw[ADR_P_REL]);
  const sixth = visibleAdr.slice(visibleAdr.indexOf("## 6."), visibleAdr.indexOf("## 7."));
  const rows = sixth.match(/^\| `[a-z-]+` \|/gm) ?? [];
  if (rows.length !== Object.keys(SOURCES).length) E("PC-18", `ADR-P1 §6 lists ${rows.length} sources, and ${Object.keys(SOURCES).length} are approved`);
  for (const [id, s] of Object.entries(SOURCES)) {
    if (!sixth.includes(`| \`${id}\` | ${s.spdx} | ${s.copyright} | \`${s.sha}\` |`)) E("PC-18", `ADR-P1 §6 does not match the approved record for ${id}`);
  }

  // PC-19: the older records carry the owner's words, keep their history and stop saying the opposite.
  for (const [rel, { supersedes, history }] of Object.entries(ADOPT_RECORDS)) {
    const text = prose(raw[rel]);
    if (!text.includes(OWNER_ADOPT)) E("PC-19", `${rel} does not quote the owner's ADOPT decision`);
    if (!text.includes(supersedes)) E("PC-19", `${rel} does not record ADOPT as superseding`);
    if (!text.includes(history)) E("PC-19", `${rel} lost its history`);
    if (NEVER_COPIED.test(text)) E("PC-19", `${rel} still says code is never copied`);
  }
  for (const rel of [ADR_S1_REL, ADR_S2_REL]) {
    if (/^## Decision: REFERENCE$/m.test(visibleText(raw[rel]))) E("PC-19", `${rel} still presents REFERENCE as the decision`);
  }
  if (!prose(raw[RECON_REL]).includes(RECON_WARNING)) E("PC-19", "the recon lost the warning beside OpenBot");

  // PC-20: the map names the pins, the downloads and the warning a builder needs before opening a folder.
  const map = visibleText(raw[MAP_REL]);
  const first = map.slice(map.indexOf("## 1."), map.indexOf("## 2."));
  for (const [id, source] of Object.entries(SOURCES)) {
    if (!first.includes(source.sha)) E("PC-20", `section 1 does not pin ${id} at ${source.sha}`);
  }
  for (const folder of MAP_DOWNLOADS) {
    if (!first.includes(folder)) E("PC-20", `section 1 does not name the download ${folder}`);
  }
  if (!first.includes("`server/src/computer/policy-network.ts`")) E("PC-20", "section 1 lost the note on the OpenBot file that changed");
  if (!prose(first).includes(`${MAP_WARNING} and is never a source`)) E("PC-20", "section 1 lost the warning about the non-commercial download");

  // PC-21: registered in both runners.
  for (const [rel, name] of [[VA_REL, "validate-all"], [CR_REL, "cached-runner"]]) {
    const modules = modulesOf(raw[rel]);
    if (modules === null || !modules.includes(THIS_VALIDATOR)) E("PC-21", `${THIS_VALIDATOR} is not registered in ${name}`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------------------
// The proofs: every mutation in one scratch directory, after a positive control
// ---------------------------------------------------------------------------------------------------------

const CHANGE = "CHANGED: imports cut to ProjectOS equivalents";
const headerLines = (id, sourcePath) => {
  const source = SOURCES[id];
  return [
    `SPDX-License-Identifier: ${source.spdx}`,
    `Ported-From: ${id} ${source.url}`,
    `Source-Path: ${sourcePath}`,
    `Source-Commit: ${source.sha}`,
    `Source-Copyright: ${source.copyright}`,
    ...(id === "openclaw" ? [`Also-Credits: ${PI_ID} (${PI.copyright}, MIT)`] : []),
    "Port-Strategy: DIRECT",
    `Modified-By: ProjectOS 2026-11-03: ${MODIFIED_STATEMENT}. ${CHANGE}`,
  ];
};
const commented = (lines, leader) => lines.map((line) => `${leader} ${line}\n`).join("");
const entryOf = (rel, id, sourcePath) => {
  const source = SOURCES[id];
  return `ENTRY: ${rel}\nSource: ${id}\nUpstream: ${source.url}\nSource-Path: ${sourcePath}\nSource-Commit: ${source.sha}\n` +
    `Licence: ${source.spdx}\nCopyright: ${source.copyright}\nLicence-Text: SOURCE ${id}, in this file\n` +
    `${id === "openclaw" ? `Also-Credits: ${PI_ID}\n` : ""}\n`;
};

const SEARCH = "projectos/core/src/search/hybrid.ts";
const STORE = "projectos/core/src/memory/store.ts";
const EFFECT = "projectos/core/src/approvals/effectKey.ts";
const KEPT = "projectos/core/src/approvals/kept.ts";
const TWO = "projectos/core/src/memory/admission.ts";
const SAME_NAME = "projectos/agent/src/search/hybrid.ts";
const TWO_PATHS = "projectos/core/src/search/tokenize.ts";
const NOTE = "projectos/agent/src/memory/notes.ts";
const TEST_FILE = "projectos/core/test/search-port.test.ts";
const PLAIN = "projectos/core/src/plain.ts";
const FIXTURE_OWNER_RECORD = ".projectops/plan-decisions/PLANDEC-fixture.json";
const FIXTURE_REJECTED = ".projectops/plan-decisions/PLANDEC-rejected.json";
const FIXTURE_OTHER = ".projectops/plan-decisions/PLANDEC-other.json";
const FIXTURE_NOTE = "docs/my-note.json";
const BODY = "export const value = 1;\n";
const MARK_LINE = `// ${ORIGINAL_MARK}\n`;
const END_LINE = `// ${HEADER_END}\n`;
const UPSTREAM_KEPT = "// SPDX-License-Identifier: Apache-2.0\n// Copyright 2019 The TensorFlow Authors. All Rights Reserved.\n";
const SEARCH_SOURCE = "extensions/memory-core/src/memory/hybrid.ts";
const TOKENIZE_SOURCE = "extensions/memory-core/src/memory/tokenize.ts";
const COERCE_SOURCE = "packages/normalization-core/src/string-coerce.ts";
const OPENCLAW = SOURCES.openclaw;
const NEW_PIN = "a".repeat(40);

/** A correct file of every kind: all five sources, both comment syntaxes, a two-source file, kept upstream text. */
const FIXTURE_PORTS = [
  { rel: SEARCH, id: "openclaw", sourcePath: SEARCH_SOURCE, leader: "//" },
  { rel: STORE, id: "hermes-agent", sourcePath: "tools/memory_tool_store.py", leader: "//" },
  { rel: "projectos/core/src/skills/linter.ts", id: "hermes-agent", sourcePath: "tools/skill_linter.py", leader: "//" },
  { rel: "projectos/core/src/context/monitor.ts", id: "copilotkit-openbot", sourcePath: "server/src/memory/index.ts", leader: "//" },
  { rel: EFFECT, id: "rakazo", sourcePath: "packages/core/src/approval-effect-key.ts", leader: "//" },
  { rel: "projectos/agent/src/search/receipts.ts", id: "oh-my-hermes", sourcePath: "src/receipts.ts", leader: "//" },
  { rel: "projectos/agent/src/skills/parser.py", id: "hermes-agent", sourcePath: "agent/skill_utils.py", leader: "#" },
  { rel: TEST_FILE, id: "openclaw", sourcePath: "extensions/memory-core/src/memory/mmr.test.ts", leader: "//" },
  // The same basename and the same upstream file as SEARCH, in another directory: an entry is keyed by its full path.
  { rel: SAME_NAME, id: "openclaw", sourcePath: SEARCH_SOURCE, leader: "//" },
];
function fixtureFiles() {
  const files = Object.fromEntries(FIXTURE_PORTS.map((p) => [p.rel, commented(headerLines(p.id, p.sourcePath), p.leader) + BODY]));
  files[KEPT] = commented(headerLines("rakazo", "packages/core/src/taint.ts"), "//") + END_LINE + UPSTREAM_KEPT + BODY;
  files[TWO] = commented(headerLines("hermes-agent", "tools/memory_tool.py"), "//") + commented(headerLines("oh-my-hermes", "src/admission.ts"), "//") + BODY;
  // One source, two upstream files: one block naming both paths, and one entry for each.
  files[TWO_PATHS] = commented(headerLines("openclaw", `${TOKENIZE_SOURCE}; ${COERCE_SOURCE}`), "//") + BODY;
  files[NOTE] = MARK_LINE + BODY;
  files["projectos/core/src/skills/deep/er/plain"] = `# ${ORIGINAL_MARK}\nvalue = 1\n`;
  files[PLAIN] = BODY;
  // Each record passes every check but one, so each proof below stands on its own rule.
  const record = (decision, decidedBy) => `${JSON.stringify({ decision, decidedBy, note: `Removing the header of ${SEARCH}` })}\n`;
  files[FIXTURE_OWNER_RECORD] = record("approve", OWNER_NAME);
  files[FIXTURE_NOTE] = record("approve", OWNER_NAME);
  files[FIXTURE_REJECTED] = record("reject", OWNER_NAME);
  files[FIXTURE_OTHER] = record("approve", "An Agent");
  return files;
}
const FIXTURE_ENTRIES =
  FIXTURE_PORTS.map((p) => entryOf(p.rel, p.id, p.sourcePath)).join("") +
  entryOf(KEPT, "rakazo", "packages/core/src/taint.ts") +
  entryOf(TWO, "hermes-agent", "tools/memory_tool.py") +
  entryOf(TWO, "oh-my-hermes", "src/admission.ts") +
  entryOf(TWO_PATHS, "openclaw", TOKENIZE_SOURCE) +
  entryOf(TWO_PATHS, "openclaw", COERCE_SOURCE);
const FIXTURE_FACTS = {
  sources: SOURCES,
  tracked: [TEST_FILE, PLAIN, FIXTURE_OWNER_RECORD, FIXTURE_REJECTED, FIXTURE_OTHER, FIXTURE_NOTE],
  recordedEver: [...FIXTURE_PORTS.map((p) => p.rel), KEPT, TWO, TWO_PATHS],
};
const REPINNED = { ...SOURCES, openclaw: { ...OPENCLAW, sha: NEW_PIN, earlierPins: [OPENCLAW.sha] } };

/** The notices text above PORTED FILES, with fixture entries: a real entry's file is not in the fixture tree. */
function fixtureNotices(noticesText) {
  const at = `\n${noticesText}`.indexOf(`\n${PORTED_FILES_HEADING}`);
  return `${noticesText.slice(0, at)}${PORTED_FILES_HEADING}\n${FIXTURE_ENTRIES}`;
}

/**
 * F changes a fixture file, N changes the fixture notices, W adds a file, and each names the rule that must fire.
 * `also` is a second rule that is true of the same change: a header that stops naming its source leaves its entry stale.
 * `file` is the file the refusal must name. `notices` is a second change to the notices, `tracked` makes the file
 * tracked, and `sources` replaces the approved list. `rule: null` is a positive control: nothing may fire.
 */
const F = (name, rule, rel, from, to, also = [], extra = {}) => ({ name, rule, rel, from, to, also, ...extra });
const N = (name, rule, from, to, extra = {}) => ({ name, rule, rel: NOTICES_REL, from, to, also: [], file: NOTICES_REL, ...extra });
const W = (name, rule, rel, write, also = [], extra = {}) => ({ name, rule, rel, write, also, ...extra });
const R = (name, rule, rel, from, to) => ({ name, rule, rel, from, to });
const dropLine = (rel, key) => (fixtureFiles()[rel].match(new RegExp(`^// ${key}:.*\\n`, "m")) ?? [""])[0];
const STORE_COPYRIGHT = SOURCES["hermes-agent"].copyright;
const SEARCH_ENTRY = entryOf(SEARCH, "openclaw", SEARCH_SOURCE);
const STORE_ENTRY = entryOf(STORE, "hermes-agent", "tools/memory_tool_store.py");
const RAKAZO_NOTICE_LINE = "NOTICE-File: none anywhere in the tree at the pinned commit, so Apache-2.0 section 4(d) adds no text\n";
const PI_CREDIT = dropLine(SEARCH, "Also-Credits");
const removalOf = (rel, record) => [PORTED_FILES_HEADING, `REMOVED: ${rel}\nOwner-Record: ${record}\n\n${PORTED_FILES_HEADING}`];
const SEARCH_FILE = fixtureFiles()[SEARCH];
const STORE_FILE = fixtureFiles()[STORE];
const ORIGINAL_FILE = MARK_LINE + BODY;
const PIN_LINE = `Pinned-Commit: ${OPENCLAW.sha}\n`;
const REPINNED_NOTICES = [PIN_LINE, `Pinned-Commit: ${NEW_PIN}\nEarlier-Pins: ${OPENCLAW.sha}\n`];
const ISL_FILE = "// SPDX-License-Identifier: MIT\n// Ported-From: isl-openbot https://github.com/ob-f/OpenBot\n// Source-Path: robot/android/Detector.java\n" +
  "// Source-Commit: c5f05271a067ca83d3de38e5976fa07bcec74b6e\n// Source-Copyright: Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)\n" +
  `// Modified-By: ProjectOS 2026-11-03: ${MODIFIED_STATEMENT}.\n${BODY}`;

const denyInBody = (name, spelling) => F(name, "PC-2", NOTE, BODY, `// ${spelling}\n${BODY}`);
const FIXTURE_MUTATIONS = [
  // PC-1: nothing else can stand in for a header, in any port directory, at any depth, with any extension.
  ...PORT_DIRS.map((dir) => W(`an-unmarked-file-in-${dir.replace(/\//g, "-")}-goes-unjudged`, "PC-1", `${dir}/unmarked.ts`, BODY)),
  W("an-unmarked-file-deep-in-a-port-directory-goes-unjudged", "PC-1", "projectos/agent/src/skills/a/b/c/unmarked.ts", BODY),
  W("an-unmarked-file-with-no-extension-goes-unjudged", "PC-1", "projectos/core/src/search/Makefile", "value = 1\n"),
  W("an-unmarked-data-file-goes-unjudged", "PC-1", "projectos/core/src/context/data.json", "{}\n"),
  F("an-unmarked-file-passes", "PC-1", NOTE, MARK_LINE, "// a note\n"),
  F("a-mark-below-the-code-counts", "PC-1", NOTE, MARK_LINE + BODY, BODY + MARK_LINE),
  F("a-mark-inside-a-string-counts", "PC-1", NOTE, MARK_LINE, `const s = "${ORIGINAL_MARK}";\n`),

  // PC-2: each spelling of each denied source, in a header, in a body and in the notices.
  F("a-polyform-licence-passes", "PC-2", SEARCH, "SPDX-License-Identifier: MIT", "SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0"),
  F("a-nightly-labs-url-passes", "PC-2", SEARCH, `Ported-From: openclaw ${OPENCLAW.url}`, "Ported-From: openbot https://github.com/nightly-labs/openbot", ["PC-16"]),
  F("a-capitalised-denied-name-passes", "PC-2", SEARCH, `Ported-From: openclaw ${OPENCLAW.url}`, "Ported-From: openbot https://github.com/NIGHTLY-LABS/openbot", ["PC-16"]),
  F("the-denied-owner-passes", "PC-2", SEARCH, OPENCLAW.copyright, "Copyright (c) 2026 Synthetify Labs"),
  F("the-denied-folder-passes-as-a-source-path", "PC-2", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: incoming-2026-11-01/openbot-lower/src/index.ts", ["PC-16"]),
  denyInBody("the-denied-domain-passes", "licenses@openbot.run"),
  F("the-denied-pin-passes-under-an-approved-name", "PC-2", SEARCH, OPENCLAW.sha, "7ef25fbcc6f71a5a1888485ef0a6f3d2d5c8b5dd"),
  denyInBody("a-short-denied-sha-passes", DENIED_PIN_PREFIX),
  denyInBody("a-denied-licence-passes-in-a-comment-in-an-original-file", "PolyForm Noncommercial License 1.0.0"),
  denyInBody("a-dotted-denied-name-passes", "nightly.labs"),
  denyInBody("a-tabbed-denied-name-passes", "nightly\tlabs"),
  denyInBody("a-no-break-space-passes", "nightly\u00a0labs"),
  denyInBody("a-non-breaking-hyphen-passes", "nightly\u2011labs"),
  denyInBody("a-zero-width-character-passes", "night\u200bly-labs"),
  denyInBody("a-full-width-denied-name-passes", "\uff50\uff4f\uff4c\uff59\uff46\uff4f\uff52\uff4d"),
  denyInBody("a-split-polyform-passes", "Poly Form"),
  denyInBody("a-split-owner-passes", "Synth etify"),
  denyInBody("a-lobehub-fragment-passes", "ported from lobehub/lobehub#19329"),
  N("a-denied-source-passes-in-the-notices", "PC-2", PORTED_FILES_HEADING, `SOURCE: nightly-labs-openbot\n\n${PORTED_FILES_HEADING}`),

  // PC-3: the approved list is an allowlist, keyed on the name and the URL together.
  F("an-unknown-source-passes", "PC-3", SEARCH, "Ported-From: openclaw ", "Ported-From: stranger ", ["PC-16"]),
  F("an-approved-name-at-another-url-passes", "PC-3", SEARCH, OPENCLAW.url, "https://github.com/stranger/openclaw"),
  F("the-object-prototype-name-passes", "PC-3", SEARCH, "Ported-From: openclaw ", "Ported-From: constructor ", ["PC-16"]),
  F("a-second-block-escapes-the-list", "PC-3", TWO, "Ported-From: oh-my-hermes ", "Ported-From: stranger ", ["PC-16"]),
  W("isl-openbot-passes-before-its-phase", "PC-3", "projectos/core/src/skills/robot.ts", ISL_FILE),

  // PC-4: a commit is one this source recorded. A re-pin adds a pin, and a file keeps its true commit.
  F("a-wrong-sha-passes", "PC-4", SEARCH, OPENCLAW.sha, "0".repeat(40), ["PC-16"]),
  F("the-earlier-pin-passes", "PC-4", SEARCH, OPENCLAW.sha, "bde3017359edf796459ad4d5e3753ac6b84a49bf", ["PC-16"]),
  F("a-short-sha-passes", "PC-4", SEARCH, OPENCLAW.sha, OPENCLAW.sha.slice(0, 7), ["PC-16"]),
  N("a-file-loses-its-true-commit-at-a-re-pin", null, ...REPINNED_NOTICES, { sources: REPINNED }),
  F("a-re-pin-allows-an-unrecorded-commit", "PC-4", SEARCH, OPENCLAW.sha, "1".repeat(40), ["PC-16"], { sources: REPINNED, notices: REPINNED_NOTICES }),
  F("a-file-is-restamped-at-a-re-pin", "PC-16", SEARCH, `Source-Commit: ${OPENCLAW.sha}`, `Source-Commit: ${NEW_PIN}`, [], { sources: REPINNED, notices: REPINNED_NOTICES, file: NOTICES_REL }),
  N("a-re-pin-forgets-the-earlier-pin", "PC-14", PIN_LINE, `Pinned-Commit: ${NEW_PIN}\n`, { sources: REPINNED }),

  // PC-5: a header is not a notices entry.
  N("a-file-with-no-notices-entry-passes", "PC-5", SEARCH_ENTRY, "", { file: SEARCH }),

  // PC-6: every field the delta requires, one at a time, and a real date.
  F("a-header-with-no-licence-passes", "PC-6", SEARCH, dropLine(SEARCH, "SPDX-License-Identifier"), ""),
  F("a-header-with-no-source-passes", "PC-6", SEARCH, dropLine(SEARCH, "Ported-From"), "", ["PC-16"]),
  F("a-header-with-no-source-path-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Path"), "", ["PC-16"]),
  F("a-header-with-no-sha-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Commit"), ""),
  F("a-header-with-no-copyright-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Copyright"), ""),
  F("a-header-with-no-modified-line-passes", "PC-6", SEARCH, dropLine(SEARCH, "Modified-By"), ""),
  F("a-header-not-saying-modified-for-projectos-passes", "PC-6", STORE, MODIFIED_STATEMENT, "changed"),
  F("an-undated-modified-line-passes", "PC-6", STORE, "2026-11-03: ", ""),
  F("an-impossible-date-passes", "PC-6", STORE, "2026-11-03", "9999-99-99"),
  W("a-licence-line-alone-passes-as-a-header", "PC-6", "projectos/core/src/context/licensed.ts", `// SPDX-License-Identifier: MIT\n${BODY}`),
  F("kept-upstream-text-needs-no-end-marker", "PC-6", KEPT, END_LINE, ""),

  // PC-7: a file cannot claim a licence or an author its source does not have.
  F("a-relabelled-licence-passes", "PC-7", SEARCH, "SPDX-License-Identifier: MIT", "SPDX-License-Identifier: Apache-2.0"),
  F("a-changed-copyright-passes", "PC-7", STORE, `Source-Copyright: ${STORE_COPYRIGHT}`, "Source-Copyright: Copyright (c) 2026 ProjectOS"),

  // PC-8: Apache-2.0 section 4(b).
  F("an-apache-file-not-stating-its-change-passes", "PC-8", EFFECT, ` ${CHANGE}`, ""),
  F("an-empty-apache-change-statement-passes", "PC-8", EFFECT, CHANGE, "CHANGED:"),
  F("an-apache-change-of-none-passes", "PC-8", EFFECT, CHANGE, "CHANGED: none"),

  // PC-9: further upstreams are named, known, and carry their copyright.
  F("an-openclaw-file-without-the-pi-credit-passes", "PC-9", SEARCH, PI_CREDIT, ""),
  F("an-unrecorded-further-upstream-passes", "PC-9", SEARCH, PI_CREDIT, `${PI_CREDIT}// Also-Credits: stranger (Copyright (c) 2026 Nobody, MIT)\n`, ["PC-16"]),
  F("a-further-upstream-with-the-wrong-copyright-passes", "PC-9", SEARCH, PI.copyright, "Copyright (c) 2025 Nobody"),
  F("a-further-upstream-that-is-an-approved-source-is-refused", null, SEARCH, PI_CREDIT, `${PI_CREDIT}// Also-Credits: hermes-agent (${STORE_COPYRIGHT}, MIT)\n`, [], { notices: [`Also-Credits: ${PI_ID}\n\nENTRY: ${STORE}`, `Also-Credits: ${PI_ID}, hermes-agent\n\nENTRY: ${STORE}`] }),

  // PC-10: the original mark does not launder upstream code.
  F("a-ported-file-marked-original-passes", "PC-10", SEARCH, "// SPDX-License-Identifier", `${MARK_LINE}// SPDX-License-Identifier`),
  F("an-upstream-copyright-in-an-original-file-passes", "PC-10", NOTE, BODY, `// ${OPENCLAW.copyright}\n${BODY}`),
  F("the-pi-copyright-in-an-original-file-passes", "PC-10", NOTE, BODY, `// ${PI.copyright}\n${BODY}`),
  F("a-ported-from-line-below-an-original-mark-passes", "PC-10", NOTE, BODY, `${BODY}// Ported-From: hermes-agent\n`),
  F("any-copyright-line-in-an-original-file-passes", "PC-10", NOTE, BODY, `// Copyright 2019 Someone\n${BODY}`),
  F("a-copyright-sign-in-an-original-file-passes", "PC-10", NOTE, BODY, `// \u00a9 2019 Someone\n${BODY}`),
  F("a-c-in-brackets-in-an-original-file-passes", "PC-10", NOTE, BODY, `// (c) 2019 Someone\n${BODY}`),
  F("a-licence-identifier-in-an-original-file-passes", "PC-10", NOTE, BODY, `const s = "SPDX-License-Identifier: GPL-3.0";\n${BODY}`),
  F("pasted-mit-text-in-an-original-file-passes", "PC-10", NOTE, BODY, `// Permission is hereby granted, free of charge\n${BODY}`),
  F("an-upstream-url-in-an-original-file-passes", "PC-10", NOTE, BODY, `// see ${SOURCES.rakazo.url}\n${BODY}`),
  F("an-upstream-name-in-an-original-file-passes", "PC-10", NOTE, BODY, `// from Hermes\n${BODY}`),

  // PC-11: one header does not cover a second file pasted below it.
  F("a-header-below-the-code-passes", "PC-11", SEARCH, BODY, `${BODY}// Ported-From: stranger https://example.invalid/x\n`),
  F("a-header-below-the-end-marker-passes", "PC-11", KEPT, END_LINE, `${END_LINE}// Ported-From: stranger https://example.invalid/x\n`),

  // PC-12: a credit names a real upstream path, never a climb out of it, and never a logo.
  F("a-source-path-climbing-out-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: ../../other/index.ts", ["PC-16"]),
  F("an-absolute-source-path-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: C:/dev/other/index.ts", ["PC-16"]),
  F("a-backslash-source-path-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, String.raw`Source-Path: extensions\hybrid.ts`, ["PC-16"]),
  F("a-brand-asset-passes-as-a-source", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: assets/logo.png", ["PC-16"]),

  // PC-13: a link is judged as a refusal, not skipped and not followed.
  { name: "a-link-in-a-port-directory-goes-unjudged", rule: "PC-13", rel: "projectos/core/src/search/link", link: true, also: [] },

  // PC-14: the notices file agrees with the approved list, both ways.
  N("a-source-section-can-go-missing", "PC-14", "SOURCE: rakazo\n", "SOURCE: rakaz0\n"),
  N("a-notices-pin-can-differ", "PC-14", PIN_LINE, `Pinned-Commit: ${"0".repeat(40)}\n`),
  N("a-notices-url-can-differ", "PC-14", `Upstream: ${OPENCLAW.url}\n`, "Upstream: https://example.invalid/openclaw\n"),
  N("a-notices-licence-can-differ", "PC-14", "Licence: Apache-2.0\n", "Licence: MIT\n"),
  N("a-notices-copyright-can-differ", "PC-14", `Copyright: ${STORE_COPYRIGHT}\n`, "Copyright: Copyright (c) 2025 Someone Else\n"),
  N("the-notice-status-can-go-missing", "PC-14", RAKAZO_NOTICE_LINE, ""),
  N("the-pi-note-can-go-missing", "PC-14", `NOTE: ${PI_ID}\n`, "NOTE: pi-mon0\n"),
  N("pi-text-can-claim-its-own-licence-file", "PC-14", `Text-From: ${PI.textFrom}\n`, "Text-From: Pi's own LICENSE file\n"),
  N("the-ported-files-heading-can-go-missing", "PC-14", PORTED_FILES_HEADING, "PORTS\n"),

  // PC-15: a licence text is byte for byte what was pinned, and appears once.
  N("an-mit-text-can-be-reworded", "PC-15", "furnished to do so", "furnished to so"),
  N("the-apache-text-can-be-reworded", "PC-15", "6. Trademarks.", "6. Marks."),
  N("the-pi-text-can-be-reworded", "PC-15", `${PI.copyright}\n\nPermission`, "Copyright (c) 2025 M Zechner\n\nPermission"),
  N("an-mit-text-can-appear-twice", "PC-15", PORTED_FILES_HEADING, `${PORTED_FILES_HEADING}Permission is hereby granted\n`),
  N("the-apache-text-can-appear-twice", "PC-15", PORTED_FILES_HEADING, `${PORTED_FILES_HEADING}TERMS AND CONDITIONS FOR USE\n`),

  // PC-16: an entry is a record of a real file from an approved source, and it agrees with that file.
  N("a-stale-entry-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf("projectos/core/src/search/gone.ts", "openclaw", "extensions/gone.ts")),
  N("an-entry-at-the-wrong-sha-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Source-Commit: ${OPENCLAW.sha}`, `Source-Commit: ${"0".repeat(40)}`)),
  N("an-entry-outside-the-port-directories-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf("projectos/core/src/elsewhere.ts", "openclaw", "extensions/x.ts")),
  N("an-entry-climbing-out-of-a-port-directory-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf("projectos/core/src/search/../memory/store.ts", "hermes-agent", "tools/memory_tool_store.py")),
  N("an-entry-for-a-path-the-header-lacks-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf(SEARCH, "openclaw", "extensions/other.ts")),
  N("an-entry-with-no-copyright-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Copyright: ${OPENCLAW.copyright}\n`, "")),
  N("an-entry-from-an-unapproved-source-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf(NOTE, "openclaw", "extensions/x.ts").replace("Source: openclaw", "Source: stranger"), { also: ["PC-22"] }),
  N("an-entry-not-pointing-to-its-licence-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace("Licence-Text: SOURCE openclaw, in this file\n", "Licence-Text: elsewhere\n")),
  N("an-openclaw-entry-without-the-pi-credit-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Also-Credits: ${PI_ID}\n`, "")),
  N("a-duplicated-entry-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + SEARCH_ENTRY),
  N("a-duplicate-beside-a-second-upstream-passes", "PC-16", entryOf(TWO_PATHS, "openclaw", COERCE_SOURCE), entryOf(TWO_PATHS, "openclaw", COERCE_SOURCE).repeat(2)),
  N("a-duplicate-of-the-same-basename-passes", "PC-16", entryOf(SAME_NAME, "openclaw", SEARCH_SOURCE), entryOf(SAME_NAME, "openclaw", SEARCH_SOURCE).repeat(2)),
  N("an-entry-outlives-its-owner-record", "PC-16", ...removalOf(SEARCH, FIXTURE_OWNER_RECORD)),

  // PC-22: a recorded header goes only with a committed owner record naming the path.
  F("a-header-and-entry-vanish-together", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, ""] }),
  F("an-entry-outlives-its-header", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE),
  F("an-unmarked-file-loses-its-header", "PC-22", SEARCH, SEARCH_FILE, BODY, ["PC-1"]),
  F("an-owner-record-names-another-path", "PC-22", STORE, STORE_FILE, ORIGINAL_FILE, [], { notices: [STORE_ENTRY, removalOf(STORE, FIXTURE_OWNER_RECORD)[1].replace(PORTED_FILES_HEADING, "")] }),
  F("an-owner-record-that-does-not-exist-passes", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: .projectops/plan-decisions/PLANDEC-absent.json\n\n`] }),
  F("a-record-outside-the-owner-store-passes", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: ${FIXTURE_NOTE}\n\n`] }),
  F("a-rejected-decision-passes-as-an-owner-record", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: ${FIXTURE_REJECTED}\n\n`] }),
  F("another-decider-passes-as-the-owner", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: ${FIXTURE_OTHER}\n\n`] }),
  F("an-owner-record-that-is-not-tracked-passes", "PC-22", SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: ${FIXTURE_OWNER_RECORD}\n\n`], tracked: FIXTURE_FACTS.tracked.filter((rel) => rel !== FIXTURE_OWNER_RECORD) }),
  F("a-committed-owner-record-does-not-allow-a-removal", null, SEARCH, SEARCH_FILE, ORIGINAL_FILE, [], { notices: [SEARCH_ENTRY, `REMOVED: ${SEARCH}\nOwner-Record: ${FIXTURE_OWNER_RECORD}\n\n`] }),

  // PC-23: tracked source outside the port directories carries no upstream mark, and a granted test tree is judged.
  W("a-ported-from-line-outside-the-port-directories-passes", "PC-23", "projectos/core/src/other.ts", `// Ported-From: openclaw ${OPENCLAW.url}\n${BODY}`, [], { tracked: [...FIXTURE_FACTS.tracked, "projectos/core/src/other.ts"] }),
  W("an-upstream-copyright-outside-the-port-directories-passes", "PC-23", "projectos/agent/src/loop/other.cjs", `// ${OPENCLAW.copyright}\n${BODY}`, [], { tracked: [...FIXTURE_FACTS.tracked, "projectos/agent/src/loop/other.cjs"] }),
  W("a-test-file-with-upstream-marks-and-no-header-passes", "PC-1", "projectos/agent/test/other.test.ts", `// ${OPENCLAW.copyright}\n${BODY}`, [], { tracked: [...FIXTURE_FACTS.tracked, "projectos/agent/test/other.test.ts"] }),

  // A line of whitespace that a backtracking pattern never finishes. There is no clock here: such a pattern hangs.
  W("a-long-comment-line-stalls-the-judge", null, "projectos/core/src/context/long.ts", `${MARK_LINE}//${" ".repeat(200000)}x${" ".repeat(200000)}\n${BODY}`),
];

const S1_SUPERSEDES = ADOPT_RECORDS[ADR_S1_REL].supersedes;
const RECORD_MUTATIONS = [
  // PC-17
  R("adr-drops-a-port-directory", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", ""),
  R("adr-adds-a-port-directory", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", "- `projectos/core/src/context/`\n- `projectos/core/src/other/`\n"),
  R("adr-hides-a-port-directory-in-a-comment", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", "<!--\n- `projectos/core/src/context/`\n-->\n"),
  R("adr-drops-a-test-directory", "PC-17", ADR_P_REL, "- `projectos/agent/test/`", "- the agent tests"),
  // PC-18
  R("adr-loses-the-owner-rule", "PC-18", ADR_P_REL, OWNER_RULE, `"credit is fine"`),
  R("adr-hides-the-owner-rule-in-a-comment", "PC-18", ADR_P_REL, `Owner, 2026-11-01: ${OWNER_RULE}.`, `<!-- Owner, 2026-11-01: ${OWNER_RULE}. -->`),
  R("adr-loses-what-the-owner-may-claim", "PC-18", ADR_P_REL, "## 2. What the owner may claim", "## 2. Claims"),
  R("adr-loses-the-permitted-claim", "PC-18", ADR_P_REL, "ProjectOS is my product, and it includes credited open-source components", "ProjectOS is my product"),
  R("adr-lets-the-owner-claim-upstream-code", "PC-18", ADR_P_REL, "Do not say the owner wrote the upstream code.", "Say what you like."),
  R("adr-section-2-loses-the-open-holder", "PC-18", ADR_P_REL, "Who legally holds the original code is still open (§9).", "The owner holds it."),
  R("adr-loses-what-must-be-credited", "PC-18", ADR_P_REL, "## 3. What must be credited", "## 3. Credit"),
  R("adr-loses-apache-4a", "PC-18", ADR_P_REL, "| §4(a) | Give recipients a copy of the licence |", "| §4(a) | |"),
  R("adr-loses-apache-4b", "PC-18", ADR_P_REL, "| §4(b) | Modified files carry prominent notices that they were changed |", "| §4(b) | |"),
  R("adr-loses-apache-4c", "PC-18", ADR_P_REL, "| §4(c) | Keep the source's copyright, patent, trademark and attribution notices |", "| §4(c) | |"),
  R("adr-loses-apache-4d", "PC-18", ADR_P_REL, "| §4(d) | Carry the upstream `NOTICE`, if there is one |", "| §4(d) | |"),
  R("adr-loses-apache-6", "PC-18", ADR_P_REL, "| §6 | No right to the licensor's names or marks |", "| §6 | |"),
  R("adr-lets-a-credit-license-non-commercial-code", "PC-18", ADR_P_REL, "A credit does not license non-commercial code. It meets", "A credit is enough. It meets"),
  R("adr-loses-the-header-rule", "PC-18", ADR_P_REL, "A header is never dropped by line count or by a rewrite claim.", "A rewritten file needs no header."),
  R("adr-loses-the-limit-on-source-path", "PC-18", ADR_P_REL, "Whether a `Source-Path` exists at the pin.", "Everything else."),
  R("adr-loses-the-limit-on-shipping", "PC-18", ADR_P_REL, "Shipping the notices with the product.", "Everything else."),
  R("adr-loses-the-limit-on-per-file-licences", "PC-18", ADR_P_REL, "Per-file licences inside a source.", "Everything else."),
  R("adr-loses-the-limit-on-openclaw-entries", "PC-18", ADR_P_REL, "OpenClaw's own notice entries.", "Everything else."),
  R("adr-loses-its-proposed-status", "PC-18", ADR_P_REL, "**Status:** Proposed.", "**Status:** Decided."),
  R("adr-loses-the-owner-approval-of-the-delta", "PC-18", ADR_P_REL, "The owner approved the port delta on 2026-11-01", "Someone looked at the delta"),
  R("adr-marks-itself-accepted", "PC-18", ADR_P_REL, "**Status:** Proposed.", "**Status:** ACCEPTED. **Status:** Proposed."),
  R("adr-names-the-legal-holder-as-fact", "PC-18", ADR_P_REL, "This ADR names no holder.", "RBT Systems Limited holds it."),
  R("adr-loses-the-open-holder-decision", "PC-18", ADR_P_REL, "The legal holder of original ProjectOS code is an OPEN owner decision.", "The legal holder is decided."),
  R("adr-section-6-keeps-a-wrong-pin", "PC-18", ADR_P_REL, `\`${OPENCLAW.sha}\``, `\`${"0".repeat(40)}\``),
  R("adr-section-6-lists-an-unapproved-source", "PC-18", ADR_P_REL, "## 7. How a file is marked", "| `stranger` | MIT | Nobody | `x` |\n\n## 7. How a file is marked"),
  // PC-19
  R("s1-loses-the-owner-decision", "PC-19", ADR_S1_REL, OWNER_ADOPT, `"adopt it`),
  R("s2-loses-the-owner-decision", "PC-19", ADR_S2_REL, OWNER_ADOPT, `"adopt it`),
  R("recon-loses-the-owner-decision", "PC-19", RECON_REL, OWNER_ADOPT, `"adopt it`),
  R("s1-loses-the-superseding-record", "PC-19", ADR_S1_REL, S1_SUPERSEDES, "See above."),
  R("s2-loses-the-superseding-record", "PC-19", ADR_S2_REL, S1_SUPERSEDES, "See above."),
  R("recon-loses-the-superseding-record", "PC-19", RECON_REL, ADOPT_RECORDS[RECON_REL].supersedes, "See above."),
  R("s1-erases-its-history", "PC-19", ADR_S1_REL, ADOPT_RECORDS[ADR_S1_REL].history, "It was different then"),
  R("s2-erases-its-history", "PC-19", ADR_S2_REL, ADOPT_RECORDS[ADR_S2_REL].history, "It was different then"),
  R("recon-erases-its-history", "PC-19", RECON_REL, ADOPT_RECORDS[RECON_REL].history, "research"),
  R("s1-says-code-is-never-copied", "PC-19", ADR_S1_REL, "## Findings\n", "ProjectOS never copies their code.\n\n## Findings\n"),
  R("s2-says-code-is-never-copied", "PC-19", ADR_S2_REL, "## Findings\n", "ProjectOS never copies their code.\n\n## Findings\n"),
  R("recon-says-code-is-never-copied", "PC-19", RECON_REL, "## Do not copy", "ProjectOS never copies their code.\n\n## Do not copy"),
  R("s1-presents-reference-as-the-decision", "PC-19", ADR_S1_REL, "## Decision of 2026-10-28: REFERENCE (SUPERSEDED)", "## Decision: REFERENCE"),
  R("s2-presents-reference-as-the-decision", "PC-19", ADR_S2_REL, "## Decision of 2026-10-28: REFERENCE (SUPERSEDED)", "## Decision: REFERENCE"),
  R("recon-loses-the-warning-beside-openbot", "PC-19", RECON_REL, RECON_WARNING, "It is a different project."),
  // PC-20
  R("map-keeps-the-earlier-openclaw-pin", "PC-20", MAP_REL, OPENCLAW.sha, "bde3017359edf796459ad4d5e3753ac6b84a49bf"),
  R("map-keeps-the-earlier-hermes-pin", "PC-20", MAP_REL, SOURCES["hermes-agent"].sha, "ef75bc708867e3884cb40a91363be6dc6fddc034"),
  R("map-keeps-the-earlier-openbot-pin", "PC-20", MAP_REL, SOURCES["copilotkit-openbot"].sha, "4766e4247675eb73ff80d525ff645dd8a9da815f"),
  ...MAP_DOWNLOADS.map((folder, index) => R(`map-loses-download-${index + 1}`, "PC-20", MAP_REL, folder, "a folder")),
  R("map-loses-the-changed-openbot-file", "PC-20", MAP_REL, "`server/src/computer/policy-network.ts`", "one OpenBot file"),
  R("map-loses-the-non-commercial-warning", "PC-20", MAP_REL, MAP_WARNING, "`incoming-2026-11-01/openbot-lower` is a download"),
  // PC-21
  R("validate-all-omits-this-validator", "PC-21", VA_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  R("cached-runner-omits-this-validator", "PC-21", CR_REL, `  "${THIS_VALIDATOR}"`, `  "${THIS_VALIDATOR}-disabled"`),
  R("validate-all-comments-this-validator-out", "PC-21", VA_REL, `  "${THIS_VALIDATOR}"`, `  // "${THIS_VALIDATOR}"`),
  R("cached-runner-comments-this-validator-out", "PC-21", CR_REL, `  "${THIS_VALIDATOR}"`, `  /* "${THIS_VALIDATOR}" */`),
  R("a-trailing-comment-counts-as-registered", "PC-21", VA_REL, `  "${THIS_VALIDATOR}"`, `  "another" // "${THIS_VALIDATOR}"`),
];

/** Apply one fixture mutation, judge the tree, put it back. Returns what fired. */
function firedBy(dir, m, base) {
  const abs = absOf(dir, m.rel);
  const noticesAbs = absOf(dir, NOTICES_REL);
  if (m.link) {
    fs.symlinkSync(path.join(dir, "projectos"), abs, "junction");
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, m.write ?? base[m.rel].replace(m.from, m.to));
  }
  if (m.notices !== undefined) {
    const current = fs.readFileSync(noticesAbs, "utf8");
    fs.writeFileSync(noticesAbs, current.replace(m.notices[0], m.notices[1]));
  }
  const ctx = { ...FIXTURE_FACTS, ...(m.sources === undefined ? {} : { sources: m.sources }), ...(m.tracked === undefined ? {} : { tracked: m.tracked }) };
  const { refusals } = judgeRoot(dir, ctx);
  if (m.link || m.write !== undefined) fs.rmSync(abs, { force: true });
  else fs.writeFileSync(abs, base[m.rel]);
  fs.writeFileSync(noticesAbs, base[NOTICES_REL]);
  return refusals;
}

function applies(m, base) {
  const noticesApply = m.notices === undefined || base[NOTICES_REL].includes(m.notices[0]);
  return noticesApply && (m.link === true || m.write !== undefined || (typeof base[m.rel] === "string" && m.from !== "" && base[m.rel].includes(m.from)));
}

/**
 * The fixtures inject what git knows, so this proves the reading itself: an entry deleted in a later commit is still
 * reported. It builds the history with plumbing, so no hook runs. A directory that is no repository answers nothing.
 */
function gitProofs(dir) {
  const repo = path.join(dir, "history");
  fs.mkdirSync(repo);
  const git = (...args) => spawnSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args], { encoding: "utf8" });
  const commit = (text, parents) => {
    fs.writeFileSync(path.join(repo, NOTICES_REL), text);
    git("add", NOTICES_REL);
    const tree = git("write-tree").stdout.trim();
    const sha = git("commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", "fixture").stdout.trim();
    git("update-ref", "HEAD", sha);
    return sha;
  };
  const notRepo = gitFacts(dir) === null;
  git("init", "-q");
  commit("removed\n", [commit(SEARCH_ENTRY, [])]);
  const facts = gitFacts(repo);
  return [
    ...(notRepo ? [] : ["PC-M: git answered for a directory that is not a repository"]),
    ...(facts?.recordedEver.includes(SEARCH) ? [] : ["PC-M: an entry deleted in a later commit is not in the recorded history"]),
    ...(facts?.tracked.includes(NOTICES_REL) ? [] : ["PC-M: the tracked list is missing a committed file"]),
  ];
}

function fixtureProofs(dir, base) {
  const errors = [];
  for (const [rel, text] of Object.entries(base)) {
    const abs = absOf(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }

  // THE POSITIVE CONTROL. Without it, a validator that refused everything would satisfy every mutation below.
  const control = judgeRoot(dir, FIXTURE_FACTS);
  control.refusals.forEach((r) => errors.push(`PC-M: the positive control was refused: ${r.message}`));
  const expected = Object.keys(base).filter((rel) => inDirs(rel, PORT_DIRS)).sort();
  if (JSON.stringify([...control.judged].sort()) !== JSON.stringify(expected)) {
    errors.push(`PC-M: the positive control judged ${control.judged.length} of ${expected.length} fixture files`);
  }
  if (errors.length > 0) return errors;

  errors.push(...gitProofs(dir));

  for (const m of FIXTURE_MUTATIONS) {
    if (!applies(m, base)) {
      errors.push(`PC-M: mutation '${m.name}' no longer applies; update it with the rule`);
      continue;
    }
    const refusals = firedBy(dir, m, base);
    const fired = [...new Set(refusals.map((r) => r.code))].sort();
    const wanted = [...new Set([...(m.rule === null ? [] : [m.rule]), ...m.also])].sort();
    if (JSON.stringify(fired) !== JSON.stringify(wanted)) {
      errors.push(`PC-M: mutation '${m.name}' wanted ${wanted.join(", ") || "nothing"} and fired ${fired.join(", ") || "nothing"}`);
    } else if (m.rule !== null && !refusals.some((r) => r.code === m.rule && r.file === (m.file ?? m.rel))) {
      errors.push(`PC-M: mutation '${m.name}' fired ${m.rule} on another file`);
    }
  }
  return errors;
}

function recordProofs(raw) {
  const errors = [];
  for (const m of RECORD_MUTATIONS) {
    if (!raw[m.rel].includes(m.from)) {
      errors.push(`PC-M: mutation '${m.name}' no longer applies to ${m.rel}; update it with the rule`);
      continue;
    }
    const fired = recordProblems({ ...raw, [m.rel]: raw[m.rel].split(m.from).join(m.to) }).map(([rule]) => rule);
    if (!fired.includes(m.rule)) errors.push(`PC-M: mutation '${m.name}' survived; ${m.rule} did not fire`);
  }
  return errors;
}

/** Every rule has a proof that can fail. Runs whatever the real tree holds, so an empty tree is not a pass. */
function selfTest(raw, noticesText) {
  const notices = fixtureNotices(noticesText);
  const errors = [];
  // The first real port puts an entry in the notices. Its file is not in the fixture, so that entry must not be either.
  if (fixtureNotices(`${noticesText}${SEARCH_ENTRY}`) !== notices) errors.push("PC-M: a real notices entry leaks into the fixture");
  const base = { ...fixtureFiles(), [NOTICES_REL]: notices };
  errors.push(...scratch.withScratch("port-credit", (dir) => [...fixtureProofs(dir, base), ...recordProofs(raw)]));
  const all = [...FIXTURE_MUTATIONS, ...RECORD_MUTATIONS];
  const names = all.map((m) => m.name);
  if (new Set(names).size !== names.length) errors.push("PC-M: two mutations share a name");
  const proved = new Set(all.map((m) => m.rule));
  for (const rule of Object.keys(RULE_NAMES)) {
    if (!proved.has(rule)) errors.push(`PC-M: rule ${rule} has no named mutation`);
  }
  return errors;
}

function readRecords() {
  const raw = {};
  for (const rel of RECORDS) {
    const abs = absOf(ROOT, rel);
    raw[rel] = fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
  }
  return raw;
}

function run() {
  const raw = readRecords();
  const facts = gitFacts(ROOT);
  if (facts === null) return ["PC-22 header lost: git could not list tracked files or the notices history, so nothing was judged"];
  const { refusals } = judgeRoot(ROOT, { sources: SOURCES, ...facts });
  const errors = [...refusals.map((r) => r.message), ...recordProblems(raw).map(([, msg]) => msg)];
  if (errors.length > 0) return errors;
  return selfTest(raw, normalise(fs.readFileSync(path.join(ROOT, NOTICES_REL), "utf8")));
}

if (require.main === module) {
  const errors = run();
  if (errors.length > 0) {
    errors.forEach((x) => console.error(`FAIL: ${x}`));
    console.error(`${THIS_VALIDATOR}: ${errors.length} error(s)`);
    process.exit(1);
  }
  const judged = walkPortDirs(ROOT).found.length;
  console.log(`${THIS_VALIDATOR}: PASS (${judged} real file(s) judged; ${FIXTURE_MUTATIONS.length} fixture and ${RECORD_MUTATIONS.length} record mutations killed)`);
}

module.exports = { run, judgeRoot, judgeFile, parseNotices, recordProblems, selfTest, commentText, gitFacts, SOURCES, FIXTURE_MUTATIONS, RECORD_MUTATIONS, RULE_NAMES };
