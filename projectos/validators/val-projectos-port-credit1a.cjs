"use strict";
/**
 * THE CREDIT RULE — PROJECTOS-PORT-FOUNDATION1A (plan v1.31, docs/changes/delta_spec_V4_PORTS.md).
 *
 * Owner, 2026-11-01: "i want to claim it's mine with giving credits to the due". ProjectOS is the owner's
 * product, and code taken from elsewhere keeps its credit. ADR-P1 is the rule. This validator holds it for
 * every file in the port directories, whether or not those directories exist yet:
 *
 *   PC-1  "the file speaks for itself"              — and a port with no header lands
 *   PC-2  "a credit makes it fine"                  — and PolyForm or nightly-labs code lands in a product for sale
 *   PC-3  "it is open source, so it is approved"    — and an unread licence lands
 *   PC-4  "the sha is close enough"                 — and the credit points at code nobody read
 *   PC-5  "the header is enough"                    — and the notices file stops being the record
 *   PC-6  "most of the header is there"             — and the credit no longer says what the delta requires
 *   PC-7  "the licence line is only a label"        — and a file claims a licence its source does not give
 *   PC-8  "Apache is much like MIT"                 — and section 4(b) is not met
 *   PC-9  "Pi is a detail"                          — and a credit OpenClaw itself carries is dropped
 *   PC-10 "mark it original and move on"            — and upstream code is claimed as the owner's own
 *   PC-11 "the header at the top covers the file"   — and a second file is pasted in below it
 *   PC-12 "a path is only text"                     — and a credit climbs out of the upstream tree or names a logo
 *   PC-13 "a link is a file"                        — and something unreadable is never judged
 *   PC-14 "the notices file was right when written" — and it drifts from the approved list
 *   PC-15 "a licence text is boilerplate"           — and the text it holds is not the licence
 *   PC-16 "an entry is free text"                   — and it credits a file that is not there
 *   PC-17 "the directory list is obvious"           — and one port directory quietly stops being judged
 *   PC-18 "ADR-P1 can say less"                     — and nobody can read what was decided
 *   PC-19 "the old records will be understood"      — and they contradict the owner's ADOPT decision
 *   PC-20 "the map still points at the code"        — and a port starts from the wrong pin or the wrong download
 *   PC-21 "register it later"                       — and nothing ever runs this file
 *
 * AN EMPTY TREE PROVES NOTHING. The port directories hold no file today, so a pass over the real tree is
 * vacuous. `selfTest` therefore always runs: every rule is proved against fixture files in one temp directory,
 * after a positive control that a correct file of each kind passes. A mutation counts as killed only when
 * exactly its own rule fires, so a proof cannot be carried by some other refusal.
 *
 * THE DENIED SCAN READS COMMENTS, ON PURPOSE. Licence and copyright lines live in comments, so stripping them
 * first would blind the one scan that needs them. A false positive here is a refusal, which is the safe way to
 * be wrong. The scans over records strip comments first, because hidden text is neither a decision nor a claim.
 *
 * Reads files; runs nothing. Writes only inside its own scratch directory.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const scratch = require("./lib/scratch.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const THIS_VALIDATOR = "val-projectos-port-credit1a";
const NOTICES_REL = "THIRD_PARTY_NOTICES";
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

/** The approved list. `licenceSha256` is the SHA-256 of that project's own LICENSE file at the pin. */
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
  "isl-openbot": {
    url: "https://github.com/ob-f/OpenBot",
    sha: "c5f05271a067ca83d3de38e5976fa07bcec74b6e",
    spdx: "MIT",
    copyright: "Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)",
    licenceSha256: "7815496a899eb0916fe9407c8eaeb7642518536f3f701876dbf73b523878760f",
  },
};
/** Inherited through OpenClaw. Its text comes from the Pi entry in OpenClaw's own notices file. */
const PI = {
  id: "pi-mono",
  url: "https://github.com/earendil-works/pi-mono",
  spdx: "MIT",
  copyright: "Copyright (c) 2025 Mario Zechner",
  licenceSha256: "4f6a1985796db5225e3b1e59972bd47e07a27a0748427cb3d3c8fbf39f9311f0",
};
const MIT_TEXTS = Object.values(SOURCES).filter((s) => s.spdx === "MIT").length + 1;
const APACHE_TEXTS = Object.values(SOURCES).filter((s) => s.spdx === "Apache-2.0").length;

/** PolyForm, nightly-labs, its owner, its folder, its domain and its pin: `DENIED_PIN` cannot be laundered. */
const DENIED_PIN = "7ef25fbcc6f71a5a1888485ef0a6f3d2d5c8b5dd";
const DENIED = new RegExp(String.raw`polyform|nightly[-_ ]?labs|synthetify|openbot-lower|openbot\.run|${DENIED_PIN}`, "i");

const ORIGINAL_MARK = "Origin: original ProjectOS code";
const MODIFIED_STATEMENT = "modified for ProjectOS";
const HEADER_KEYS = ["SPDX-License-Identifier", "Ported-From", "Source-Path", "Source-Commit", "Source-Copyright", "Also-Credits", "Port-Strategy", "Modified-By", "Notice"];
const REQUIRED_KEYS = ["SPDX-License-Identifier", "Ported-From", "Source-Path", "Source-Commit", "Source-Copyright", "Modified-By"];
const LIST_KEYS = ["Also-Credits", "Modified-By"];
const ENTRY_KEYS = ["Source", "Upstream", "Source-Path", "Source-Commit", "Licence", "Copyright", "Licence-Text"];
const COMMENT_LINE = /^\s*(?:\/\/+|#+|\/\*+|\*+\/?|<!--|--)\s?(.*?)\s*(?:\*\/|-->)?\s*$/;
const LICENCE_BEGIN = "=== BEGIN LICENCE TEXT ===";
const LICENCE_END = "=== END LICENCE TEXT ===";
const CLIMBS_OUT = /^[/\\]|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/;
const BRAND_ASSET = /\.(?:png|svg|icns|ico|jpe?g|gif|webp)$/i;

const RULE_NAMES = {
  "PC-1": "no header",
  "PC-2": "denied source",
  "PC-3": "unknown source",
  "PC-4": "wrong sha",
  "PC-5": "no notices entry",
  "PC-6": "incomplete header",
  "PC-7": "wrong licence or copyright",
  "PC-8": "Apache change not stated",
  "PC-9": "Pi credit missing",
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
};

const refusal = (code, file, message) => ({ code, file, message: `${code} ${RULE_NAMES[code]}: ${file}: ${message}` });
const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");
const sourceOf = (id) => (Object.hasOwn(SOURCES, id) ? SOURCES[id] : null);
const countOf = (text, needle) => text.split(needle).length - 1;
const normalise = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

// ---------------------------------------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------------------------------------

/** The comment block a file opens with. A header anywhere else, or inside a string, is not a header. */
function leadingComment(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const comment = COMMENT_LINE.exec(line);
    if (comment === null) break;
    lines.push(comment[1]);
  }
  return lines;
}

/** One block per upstream source. A repeated single-value key opens the next block, so none is overwritten. */
function headerBlocks(commentLines) {
  const blocks = [];
  for (const line of commentLines) {
    const field = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
    if (field === null || !HEADER_KEYS.includes(field[1])) continue;
    const [, key, value] = field;
    const isList = LIST_KEYS.includes(key);
    if (blocks.length === 0 || (!isList && key in blocks[blocks.length - 1])) blocks.push({});
    const block = blocks[blocks.length - 1];
    block[key] = isList ? [...(block[key] ?? []), value] : value;
  }
  return blocks;
}

function blockProblems(rel, block, records) {
  const refuse = (code, message) => refusal(code, rel, message);
  const missing = REQUIRED_KEYS.filter((key) => (Array.isArray(block[key]) ? block[key].length === 0 : !block[key]));
  if (missing.length > 0) return [refuse("PC-6", `the credit header has no ${missing.join(", ")}`)];

  const [id, url, ...rest] = block["Ported-From"].split(/\s+/);
  const source = sourceOf(id);
  if (source === null || url !== source.url || rest.length > 0) {
    return [refuse("PC-3", `'${block["Ported-From"]}' is not on the approved list`)];
  }

  const modified = block["Modified-By"];
  const paths = block["Source-Path"].split(";").map((p) => p.trim());
  return [
    ...(block["Source-Commit"] === source.sha ? [] : [refuse("PC-4", `${id} is pinned at ${source.sha}, not ${block["Source-Commit"]}`)]),
    ...(block["SPDX-License-Identifier"] === source.spdx && block["Source-Copyright"] === source.copyright
      ? []
      : [refuse("PC-7", `${id} is ${source.spdx}, ${source.copyright}`)]),
    ...(modified.some((line) => line.includes(MODIFIED_STATEMENT) && /\b\d{4}-\d{2}-\d{2}\b/.test(line))
      ? []
      : [refuse("PC-6", `no dated Modified-By line says "${MODIFIED_STATEMENT}"`)]),
    ...(source.spdx !== "Apache-2.0" || modified.some((line) => /\bCHANGED:\s*\S/.test(line))
      ? []
      : [refuse("PC-8", `an Apache-2.0 file must state what changed, with CHANGED: on a Modified-By line`)]),
    ...(id !== "openclaw" || (block["Also-Credits"] ?? []).some((line) => line.includes(PI.id) && line.includes(PI.copyright))
      ? []
      : [refuse("PC-9", `every OpenClaw file credits ${PI.id}`)]),
    ...paths.flatMap((sourcePath) => pathProblems(rel, id, sourcePath, records)),
  ];
}

function pathProblems(rel, id, sourcePath, records) {
  if (sourcePath === "" || CLIMBS_OUT.test(sourcePath) || BRAND_ASSET.test(sourcePath)) {
    return [refusal("PC-12", rel, `'${sourcePath}' is not a path inside the upstream tree, or it is a brand asset`)];
  }
  const entry = records.find((r) => r.kind === "ENTRY" && r.id === rel && r.fields["Source"] === id && r.fields["Source-Path"] === sourcePath);
  return entry === undefined ? [refusal("PC-5", rel, `${NOTICES_REL} has no entry for ${id} ${sourcePath}`)] : [];
}

function originalProblems(rel, text, blocks) {
  const upstream = [...Object.values(SOURCES), PI].map((s) => s.copyright).filter((line) => text.includes(line));
  if (blocks.length > 0 || text.includes("Ported-From:") || upstream.length > 0) {
    return [refusal("PC-10", rel, `it is marked original and carries upstream marks${upstream.length > 0 ? `: ${upstream.join("; ")}` : ""}`)];
  }
  return [];
}

function judgeFile(rel, rawText, records) {
  const text = normalise(rawText);
  if (DENIED.test(text)) {
    return [refusal("PC-2", rel, `it names a denied source: ${DENIED.exec(text)[0]}. A credit does not license non-commercial code`)];
  }
  const lines = leadingComment(text);
  const blocks = headerBlocks(lines);
  if (lines.includes(ORIGINAL_MARK)) return originalProblems(rel, text, blocks);
  if (blocks.length === 0) return [refusal("PC-1", rel, `it has neither the mark "${ORIGINAL_MARK}" nor a credit header`)];
  const inHeader = lines.filter((line) => line.startsWith("Ported-From:")).length;
  return [
    ...(countOf(text, "Ported-From:") === inHeader ? [] : [refusal("PC-11", rel, "a Ported-From line sits below the header")]),
    ...blocks.flatMap((block) => blockProblems(rel, block, records)),
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
    const head = /^(SOURCE|NOTE|ENTRY): (\S+)$/.exec(line);
    if (head !== null) {
      records.push({ kind: head[1], id: head[2], fields: {}, licences: [] });
      continue;
    }
    const field = /^([A-Z][A-Za-z-]*): (.+)$/.exec(line);
    if (field !== null && current !== undefined) current.fields[field[1]] = field[2];
  }
  return records;
}

function sourceSectionProblems(records) {
  const refuse = (message) => refusal("PC-14", NOTICES_REL, message);
  const sections = records.filter((r) => r.kind === "SOURCE");
  const notes = records.filter((r) => r.kind === "NOTE");
  const wrongFields = (section, want) =>
    Object.entries(want).flatMap(([field, value]) =>
      (value === null ? section.fields[field] : section.fields[field] === value) ? [] : [refuse(`${section.id}: ${field} is wrong or missing`)],
    );
  return [
    ...Object.keys(SOURCES)
      .filter((id) => sections.filter((s) => s.id === id).length !== 1)
      .map((id) => refuse(`${id} needs exactly one SOURCE section`)),
    ...sections.filter((s) => sourceOf(s.id) === null).map((s) => refuse(`${s.id} is not an approved source`)),
    ...sections
      .filter((s) => sourceOf(s.id) !== null)
      .flatMap((s) => {
        const source = sourceOf(s.id);
        return wrongFields(s, {
          Upstream: source.url,
          "Pinned-Commit": source.sha,
          Licence: source.spdx,
          Copyright: source.copyright,
          "NOTICE-File": null,
        });
      }),
    ...(notes.length === 1 && notes[0].id === PI.id ? wrongFields(notes[0], { Upstream: PI.url, Licence: PI.spdx, Copyright: PI.copyright }) : [refuse(`the ${PI.id} note is missing`)]),
  ];
}

function licenceTextProblems(text, records) {
  const refuse = (message) => refusal("PC-15", NOTICES_REL, message);
  const wantOf = (record) => (record.kind === "NOTE" ? (record.id === PI.id ? PI : null) : sourceOf(record.id));
  return [
    ...records
      .filter((r) => r.kind !== "ENTRY" && wantOf(r) !== null)
      .filter((r) => r.licences.length !== 1 || sha256(r.licences[0]) !== wantOf(r).licenceSha256)
      .map((r) => refuse(`${r.id}: the licence text is not that project's LICENSE, byte for byte`)),
    ...(countOf(text, "Permission is hereby granted") === MIT_TEXTS ? [] : [refuse(`the MIT text must appear ${MIT_TEXTS} times, once per MIT source and once for ${PI.id}`)]),
    ...(countOf(text, "TERMS AND CONDITIONS FOR USE") === APACHE_TEXTS ? [] : [refuse(`the Apache-2.0 text must appear ${APACHE_TEXTS} time`)]),
  ];
}

function entryProblems(records, root) {
  const refuse = (rel, message) => refusal("PC-16", NOTICES_REL, `${rel}: ${message}`);
  const entries = records.filter((r) => r.kind === "ENTRY");
  const keyOf = (entry) => `${entry.id}|${entry.fields["Source"]}|${entry.fields["Source-Path"]}`;
  return entries.flatMap((entry) => {
    const { id: rel, fields } = entry;
    const missing = ENTRY_KEYS.filter((key) => !fields[key]);
    if (missing.length > 0) return [refuse(rel, `the entry has no ${missing.join(", ")}`)];
    const source = sourceOf(fields["Source"]);
    if (source === null) return [refuse(rel, `'${fields["Source"]}' is not an approved source`)];
    if (!PORT_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return [refuse(rel, "it is outside the port directories")];
    const abs = path.join(root, ...rel.split("/"));
    const header = fs.existsSync(abs) ? headerBlocks(leadingComment(normalise(fs.readFileSync(abs, "utf8")))) : [];
    return [
      ...(header.some((block) => (block["Ported-From"] ?? "").split(/\s+/)[0] === fields["Source"]) ? [] : [refuse(rel, `no such file carries a ${fields["Source"]} header: the entry is stale`)]),
      ...(fields["Upstream"] === source.url && fields["Source-Commit"] === source.sha && fields["Licence"] === source.spdx && fields["Copyright"] === source.copyright
        ? []
        : [refuse(rel, `the entry does not match the approved ${fields["Source"]} record`)]),
      ...(fields["Licence-Text"] === `SOURCE ${fields["Source"]}, in this file` ? [] : [refuse(rel, "the entry does not point to the licence text")]),
      ...(fields["Source"] !== "openclaw" || fields["Also-Credits"] === PI.id ? [] : [refuse(rel, `an OpenClaw entry credits ${PI.id}`)]),
      ...(entries.filter((other) => keyOf(other) === keyOf(entry)).length === 1 ? [] : [refuse(rel, "the entry is duplicated")]),
    ];
  });
}

function noticesProblems(text, records, root) {
  if (DENIED.test(text)) {
    return [refusal("PC-2", NOTICES_REL, `it names a denied source: ${DENIED.exec(text)[0]}`)];
  }
  return [...sourceSectionProblems(records), ...licenceTextProblems(text, records), ...entryProblems(records, root)];
}

// ---------------------------------------------------------------------------------------------------------
// One tree: the real repository, or a fixture
// ---------------------------------------------------------------------------------------------------------

/** Every entry under the port directories, any extension, any depth. Anything not a file or a directory is `strange`. */
function walkPortDirs(root) {
  const found = [];
  const strange = [];
  const visit = (rel) => {
    const abs = path.join(root, ...rel.split("/"));
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

function judgeRoot(root) {
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
      ...noticesProblems(text, records, root),
      ...strange.map((rel) => refusal("PC-13", rel, "it is a link or a device, so it cannot be judged")),
      ...found.flatMap((rel) => judgeFile(rel, fs.readFileSync(path.join(root, ...rel.split("/")), "utf8"), records)),
    ],
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
  "its status": "Status: APPROVED in substance by the owner's 'Approved' of the port delta, 2026-11-01.",
  "what the owner may claim": "## 2. What the owner may claim",
  "the permitted claim": "ProjectOS is my product, and it includes credited open-source components",
  "the refused claim": "Do not say the owner wrote the upstream code.",
  "what must be credited": "## 3. What must be credited",
  "Apache-2.0 section 4(a)": "| §4(a) | Give recipients a copy of the licence |",
  "Apache-2.0 section 4(b)": "| §4(b) | Modified files carry prominent notices that they were changed |",
  "Apache-2.0 section 4(c)": "| §4(c) | Keep the source's copyright, patent, trademark and attribution notices |",
  "Apache-2.0 section 4(d)": "| §4(d) | Carry the upstream `NOTICE`, if there is one |",
  "Apache-2.0 section 6": "| §6 | No right to the licensor's names or marks |",
  "the non-commercial rule": "A credit does not license non-commercial code.",
  "the open legal holder": "The legal holder of original ProjectOS code is an OPEN owner decision.",
};
/** History stays: each record keeps what was decided before, and says what replaced it. */
const ADOPT_RECORDS = {
  [ADR_S1_REL]: { supersedes: "This ADOPT decision supersedes the REFERENCE decision below.", history: "Its memory and skill writes come from its own loop and its own approve command" },
  [ADR_S2_REL]: { supersedes: "This ADOPT decision supersedes the REFERENCE decision below.", history: "OpenClaw is a second orchestrator by design" },
  [RECON_REL]: { supersedes: "This ADOPT decision supersedes the rebuild-only method described below.", history: "the replica-recon method, using official documentation and READMEs only" },
};
const NEVER_COPIED = /\bnever cop(?:y|ies|ied)\b/i;
const MAP_WARNING = "`incoming-2026-11-01/openbot-lower` is PolyForm Noncommercial";
const MAP_DOWNLOADS = [String.raw`incoming-2026-11-01\hermes-agent\hermes-agent-main`, String.raw`incoming-2026-11-01\openclaw\openclaw-main`, String.raw`incoming-2026-11-01\openbot-upper\OpenBot-main`];

/** ADR prose with hidden text, wrapping and emphasis gone, so it is judged by what a reader sees. */
const visibleText = (text) => text.replace(/<!--[\s\S]*?-->/g, " ");
const prose = (text) => visibleText(text).replace(/\*\*/g, "").replace(/\s+/g, " ");
/** A registration that is commented out is not a registration. */
const withoutJsComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

function modulesOf(text) {
  const start = text.indexOf("const MODULES = [");
  const end = text.indexOf("\n];", start);
  return start < 0 || end < 0 ? null : [...text.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
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

  // PC-17: the directories the ADR names are exactly the directories this file walks.
  const listed = [...visibleText(raw[ADR_P_REL]).matchAll(/^- `(projectos\/[a-z]+\/src\/[a-z]+)\/`$/gm)].map((m) => m[1]);
  if (JSON.stringify([...listed].sort()) !== JSON.stringify([...PORT_DIRS].sort())) {
    E("PC-17", `ADR-P1 §7 lists ${listed.length} directories, and they are not the ${PORT_DIRS.length} this validator judges`);
  }

  // PC-18: ADR-P1 says what the acceptance criteria require, and does not decide what is still the owner's.
  const adr = prose(raw[ADR_P_REL]);
  for (const [what, pin] of Object.entries(ADR_P_PINS)) {
    if (!adr.includes(pin)) E("PC-18", `ADR-P1 no longer states ${what}`);
  }
  if (/\bStatus:\s*ACCEPTED\b/i.test(adr)) E("PC-18", "ADR-P1 says Accepted, and only the owner marks an ADR Accepted");
  const namesCompany = adr.split(/(?<=[.!?])\s+/).filter((sentence) => /\bRBT\b/.test(sentence) && !sentence.includes("unconfirmed"));
  if (namesCompany.length > 0) E("PC-18", `ADR-P1 names a company as fact: ${namesCompany[0]}`);

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
    const modules = modulesOf(withoutJsComments(raw[rel]));
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
    ...(id === "openclaw" ? [`Also-Credits: ${PI.id} (${PI.copyright}, MIT)`] : []),
    "Port-Strategy: DIRECT",
    `Modified-By: ProjectOS 2026-11-03: ${MODIFIED_STATEMENT}. ${CHANGE}`,
  ];
};
const commented = (lines, leader) => lines.map((line) => `${leader} ${line}\n`).join("");
const entryOf = (rel, id, sourcePath) => {
  const source = SOURCES[id];
  return `ENTRY: ${rel}\nSource: ${id}\nUpstream: ${source.url}\nSource-Path: ${sourcePath}\nSource-Commit: ${source.sha}\n` +
    `Licence: ${source.spdx}\nCopyright: ${source.copyright}\nLicence-Text: SOURCE ${id}, in this file\n` +
    `${id === "openclaw" ? `Also-Credits: ${PI.id}\n` : ""}\n`;
};

const SEARCH = "projectos/core/src/search/hybrid.ts";
const STORE = "projectos/core/src/memory/store.ts";
const EFFECT = "projectos/core/src/approvals/effectKey.ts";
const TWO = "projectos/core/src/memory/admission.ts";
const NOTE = "projectos/agent/src/memory/notes.ts";
const BODY = "export const value = 1;\n";
const MARK_LINE = `// ${ORIGINAL_MARK}\n`;
const SEARCH_SOURCE = "extensions/memory-core/src/memory/hybrid.ts";
const OPENCLAW = SOURCES.openclaw;

/** A correct file of every kind: all six sources, both comment syntaxes, a two-source file, and two originals. */
const FIXTURE_PORTS = [
  { rel: SEARCH, id: "openclaw", sourcePath: SEARCH_SOURCE, leader: "//" },
  { rel: STORE, id: "hermes-agent", sourcePath: "tools/memory_tool_store.py", leader: "//" },
  { rel: "projectos/core/src/skills/linter.ts", id: "hermes-agent", sourcePath: "tools/skill_linter.py", leader: "//" },
  { rel: "projectos/core/src/context/monitor.ts", id: "copilotkit-openbot", sourcePath: "server/src/memory/index.ts", leader: "//" },
  { rel: EFFECT, id: "rakazo", sourcePath: "packages/core/src/approval-effect-key.ts", leader: "//" },
  { rel: "projectos/agent/src/search/receipts.ts", id: "oh-my-hermes", sourcePath: "src/receipts.ts", leader: "//" },
  { rel: "projectos/agent/src/skills/robot.py", id: "isl-openbot", sourcePath: "policy/openbot/utils.py", leader: "#" },
];
function fixtureFiles() {
  const files = Object.fromEntries(FIXTURE_PORTS.map((p) => [p.rel, commented(headerLines(p.id, p.sourcePath), p.leader) + BODY]));
  files[TWO] = commented(headerLines("hermes-agent", "tools/memory_tool.py"), "//") + commented(headerLines("oh-my-hermes", "src/admission.ts"), "//") + BODY;
  files[NOTE] = MARK_LINE + BODY;
  files["projectos/core/src/skills/deep/er/plain"] = `# ${ORIGINAL_MARK}\nvalue = 1\n`;
  return files;
}
const FIXTURE_ENTRIES =
  FIXTURE_PORTS.map((p) => entryOf(p.rel, p.id, p.sourcePath)).join("") +
  entryOf(TWO, "hermes-agent", "tools/memory_tool.py") +
  entryOf(TWO, "oh-my-hermes", "src/admission.ts");

/**
 * F changes a fixture file, N changes the fixture notices, W adds a file, and each names the rule that must fire.
 * `also` is a second rule that is true of the same change: a header that stops naming its source leaves its entry stale.
 * `file` is the file the refusal must name, when that is not the file changed.
 */
const F = (name, rule, rel, from, to, also = []) => ({ name, rule, rel, from, to, also });
const N = (name, rule, from, to, file = NOTICES_REL) => ({ name, rule, rel: NOTICES_REL, from, to, also: [], file });
const W = (name, rule, rel, write) => ({ name, rule, rel, write, also: [] });
const R = (name, rule, rel, from, to) => ({ name, rule, rel, from, to });
const dropLine = (rel, key) => (fixtureFiles()[rel].match(new RegExp(`^// ${key}:.*\\n`, "m")) ?? [""])[0];
const STORE_COPYRIGHT = SOURCES["hermes-agent"].copyright;
const SEARCH_ENTRY = entryOf(SEARCH, "openclaw", SEARCH_SOURCE);
const RAKAZO_NOTICE_LINE = "NOTICE-File: none anywhere in the tree at the pinned commit, so Apache-2.0 section 4(d) adds no text\n";

const FIXTURE_MUTATIONS = [
  // PC-1: nothing else can stand in for a header, in any port directory, at any depth, with any extension.
  ...PORT_DIRS.map((dir) => W(`an-unmarked-file-in-${dir.replace(/\//g, "-")}-goes-unjudged`, "PC-1", `${dir}/unmarked.ts`, BODY)),
  W("an-unmarked-file-deep-in-a-port-directory-goes-unjudged", "PC-1", "projectos/agent/src/skills/a/b/c/unmarked.ts", BODY),
  W("an-unmarked-file-with-no-extension-goes-unjudged", "PC-1", "projectos/core/src/search/Makefile", "value = 1\n"),
  W("an-unmarked-data-file-goes-unjudged", "PC-1", "projectos/core/src/context/data.json", "{}\n"),
  F("an-unmarked-file-passes", "PC-1", NOTE, MARK_LINE, "// a note\n"),
  F("a-mark-below-the-code-counts", "PC-1", NOTE, MARK_LINE + BODY, BODY + MARK_LINE),
  F("a-mark-inside-a-string-counts", "PC-1", NOTE, MARK_LINE, `const s = "${ORIGINAL_MARK}";\n`),

  // PC-2: each spelling of the denied source, in a header, in a body and in the notices.
  F("a-polyform-licence-passes", "PC-2", SEARCH, "SPDX-License-Identifier: MIT", "SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0"),
  F("a-nightly-labs-url-passes", "PC-2", SEARCH, `Ported-From: openclaw ${OPENCLAW.url}`, "Ported-From: openbot https://github.com/nightly-labs/openbot", ["PC-16"]),
  F("a-capitalised-denied-name-passes", "PC-2", SEARCH, `Ported-From: openclaw ${OPENCLAW.url}`, "Ported-From: openbot https://github.com/NIGHTLY-LABS/openbot", ["PC-16"]),
  F("the-denied-owner-passes", "PC-2", SEARCH, OPENCLAW.copyright, "Copyright (c) 2026 Synthetify Labs"),
  F("the-denied-folder-passes-as-a-source-path", "PC-2", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: incoming-2026-11-01/openbot-lower/src/index.ts"),
  F("the-denied-domain-passes", "PC-2", NOTE, BODY, `// licenses@openbot.run\n${BODY}`),
  F("the-denied-pin-passes-under-an-approved-name", "PC-2", SEARCH, OPENCLAW.sha, DENIED_PIN),
  F("a-denied-licence-passes-in-a-comment-in-an-original-file", "PC-2", NOTE, BODY, `// PolyForm Noncommercial License 1.0.0\n${BODY}`),
  N("a-denied-source-passes-in-the-notices", "PC-2", "PORTED FILES\n", "SOURCE: nightly-labs-openbot\n\nPORTED FILES\n"),

  // PC-3: the approved list is an allowlist, keyed on the name and the URL together.
  F("an-unknown-source-passes", "PC-3", SEARCH, "Ported-From: openclaw ", "Ported-From: stranger ", ["PC-16"]),
  F("an-approved-name-at-another-url-passes", "PC-3", SEARCH, OPENCLAW.url, "https://github.com/stranger/openclaw"),
  F("the-object-prototype-name-passes", "PC-3", SEARCH, "Ported-From: openclaw ", "Ported-From: constructor ", ["PC-16"]),
  F("a-second-block-escapes-the-list", "PC-3", TWO, "Ported-From: oh-my-hermes ", "Ported-From: stranger ", ["PC-16"]),

  // PC-4: the pin is exact.
  F("a-wrong-sha-passes", "PC-4", SEARCH, OPENCLAW.sha, "0".repeat(40)),
  F("the-earlier-pin-passes", "PC-4", SEARCH, OPENCLAW.sha, "bde3017359edf796459ad4d5e3753ac6b84a49bf"),
  F("a-short-sha-passes", "PC-4", SEARCH, OPENCLAW.sha, OPENCLAW.sha.slice(0, 7)),

  // PC-5: a header is not a notices entry.
  N("a-file-with-no-notices-entry-passes", "PC-5", SEARCH_ENTRY, "", SEARCH),

  // PC-6: every field the delta requires, one at a time.
  F("a-header-with-no-licence-passes", "PC-6", SEARCH, dropLine(SEARCH, "SPDX-License-Identifier"), ""),
  F("a-header-with-no-source-passes", "PC-6", SEARCH, dropLine(SEARCH, "Ported-From"), "", ["PC-16"]),
  F("a-header-with-no-source-path-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Path"), ""),
  F("a-header-with-no-sha-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Commit"), ""),
  F("a-header-with-no-copyright-passes", "PC-6", SEARCH, dropLine(SEARCH, "Source-Copyright"), ""),
  F("a-header-with-no-modified-line-passes", "PC-6", SEARCH, dropLine(SEARCH, "Modified-By"), ""),
  F("a-header-not-saying-modified-for-projectos-passes", "PC-6", STORE, MODIFIED_STATEMENT, "changed"),
  F("an-undated-modified-line-passes", "PC-6", STORE, "2026-11-03: ", ""),
  W("a-licence-line-alone-passes-as-a-header", "PC-6", "projectos/core/src/context/licensed.ts", `// SPDX-License-Identifier: MIT\n${BODY}`),

  // PC-7: a file cannot claim a licence or an author its source does not have.
  F("a-relabelled-licence-passes", "PC-7", SEARCH, "SPDX-License-Identifier: MIT", "SPDX-License-Identifier: Apache-2.0"),
  F("a-changed-copyright-passes", "PC-7", STORE, `Source-Copyright: ${STORE_COPYRIGHT}`, "Source-Copyright: Copyright (c) 2026 ProjectOS"),

  // PC-8 and PC-9: the duties beyond the plain header.
  F("an-apache-file-not-stating-its-change-passes", "PC-8", EFFECT, ` ${CHANGE}`, ""),
  F("an-empty-apache-change-statement-passes", "PC-8", EFFECT, CHANGE, "CHANGED:"),
  F("an-openclaw-file-without-the-pi-credit-passes", "PC-9", SEARCH, dropLine(SEARCH, "Also-Credits"), ""),

  // PC-10: the original mark does not launder upstream code.
  F("a-ported-file-marked-original-passes", "PC-10", SEARCH, "// SPDX-License-Identifier", `${MARK_LINE}// SPDX-License-Identifier`),
  F("an-upstream-copyright-in-an-original-file-passes", "PC-10", NOTE, BODY, `// ${OPENCLAW.copyright}\n${BODY}`),
  F("the-pi-copyright-in-an-original-file-passes", "PC-10", NOTE, BODY, `// ${PI.copyright}\n${BODY}`),
  F("a-ported-from-line-below-an-original-mark-passes", "PC-10", NOTE, BODY, `${BODY}// Ported-From: hermes-agent\n`),

  // PC-11: one header does not cover a second file pasted below it.
  F("a-header-below-the-code-passes", "PC-11", SEARCH, BODY, `${BODY}// Ported-From: stranger https://example.invalid/x\n`),

  // PC-12: a credit names a real upstream path, never a climb out of it, and never a logo.
  F("a-source-path-climbing-out-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: ../../other/index.ts"),
  F("an-absolute-source-path-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: C:/dev/other/index.ts"),
  F("a-backslash-source-path-passes", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, String.raw`Source-Path: extensions\hybrid.ts`),
  F("a-brand-asset-passes-as-a-source", "PC-12", SEARCH, `Source-Path: ${SEARCH_SOURCE}`, "Source-Path: assets/logo.png"),

  // PC-13: a link is judged as a refusal, not skipped and not followed.
  { name: "a-link-in-a-port-directory-goes-unjudged", rule: "PC-13", rel: "projectos/core/src/search/link", link: true, also: [] },

  // PC-14: the notices file agrees with the approved list, both ways.
  N("a-source-section-can-go-missing", "PC-14", "SOURCE: rakazo\n", "SOURCE: rakaz0\n"),
  N("a-notices-pin-can-differ", "PC-14", `Pinned-Commit: ${OPENCLAW.sha}\n`, `Pinned-Commit: ${"0".repeat(40)}\n`),
  N("a-notices-url-can-differ", "PC-14", `Upstream: ${OPENCLAW.url}\n`, "Upstream: https://example.invalid/openclaw\n"),
  N("a-notices-licence-can-differ", "PC-14", "Licence: Apache-2.0\n", "Licence: MIT\n"),
  N("a-notices-copyright-can-differ", "PC-14", `Copyright: ${STORE_COPYRIGHT}\n`, "Copyright: Copyright (c) 2025 Someone Else\n"),
  N("the-notice-status-can-go-missing", "PC-14", RAKAZO_NOTICE_LINE, ""),
  N("the-pi-note-can-go-missing", "PC-14", `NOTE: ${PI.id}\n`, "NOTE: pi-mon0\n"),

  // PC-15: a licence text is that project's LICENSE, byte for byte, and appears once.
  N("an-mit-text-can-be-reworded", "PC-15", "furnished to do so", "furnished to so"),
  N("the-apache-text-can-be-reworded", "PC-15", "6. Trademarks.", "6. Marks."),
  N("the-pi-text-can-be-reworded", "PC-15", `${PI.copyright}\n\nPermission`, "Copyright (c) 2025 M Zechner\n\nPermission"),
  N("an-mit-text-can-appear-twice", "PC-15", "PORTED FILES\n", "PORTED FILES\nPermission is hereby granted\n"),
  N("the-apache-text-can-appear-twice", "PC-15", "PORTED FILES\n", "PORTED FILES\nTERMS AND CONDITIONS FOR USE\n"),

  // PC-16: an entry is a record of a real file from an approved source.
  N("a-stale-entry-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf("projectos/core/src/search/gone.ts", "openclaw", "extensions/gone.ts")),
  N("an-entry-at-the-wrong-sha-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Source-Commit: ${OPENCLAW.sha}`, `Source-Commit: ${"0".repeat(40)}`)),
  N("an-entry-outside-the-port-directories-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf("projectos/core/src/elsewhere.ts", "openclaw", "extensions/x.ts")),
  N("an-entry-with-no-copyright-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Copyright: ${OPENCLAW.copyright}\n`, "")),
  N("an-entry-from-an-unapproved-source-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + entryOf(NOTE, "openclaw", "extensions/x.ts").replace("Source: openclaw", "Source: stranger")),
  N("an-entry-not-pointing-to-its-licence-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace("Licence-Text: SOURCE openclaw, in this file\n", "Licence-Text: elsewhere\n")),
  N("an-openclaw-entry-without-the-pi-credit-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY.replace(`Also-Credits: ${PI.id}\n`, "")),
  N("a-duplicated-entry-passes", "PC-16", SEARCH_ENTRY, SEARCH_ENTRY + SEARCH_ENTRY),
];

const S1_SUPERSEDES = ADOPT_RECORDS[ADR_S1_REL].supersedes;
const RECORD_MUTATIONS = [
  // PC-17
  R("adr-drops-a-port-directory", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", ""),
  R("adr-adds-a-port-directory", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", "- `projectos/core/src/context/`\n- `projectos/core/src/other/`\n"),
  R("adr-hides-a-port-directory-in-a-comment", "PC-17", ADR_P_REL, "- `projectos/core/src/context/`\n", "<!--\n- `projectos/core/src/context/`\n-->\n"),
  // PC-18
  R("adr-loses-the-owner-rule", "PC-18", ADR_P_REL, OWNER_RULE, `"credit is fine"`),
  R("adr-hides-the-owner-rule-in-a-comment", "PC-18", ADR_P_REL, `Owner, 2026-11-01: ${OWNER_RULE}.`, `<!-- Owner, 2026-11-01: ${OWNER_RULE}. -->`),
  R("adr-loses-what-the-owner-may-claim", "PC-18", ADR_P_REL, "## 2. What the owner may claim", "## 2. Claims"),
  R("adr-loses-the-permitted-claim", "PC-18", ADR_P_REL, "ProjectOS is my product, and it includes credited open-source components", "ProjectOS is my product"),
  R("adr-lets-the-owner-claim-upstream-code", "PC-18", ADR_P_REL, "Do not say the owner wrote the upstream code.", "Say what you like."),
  R("adr-loses-what-must-be-credited", "PC-18", ADR_P_REL, "## 3. What must be credited", "## 3. Credit"),
  R("adr-loses-apache-4a", "PC-18", ADR_P_REL, "| §4(a) | Give recipients a copy of the licence |", "| §4(a) | |"),
  R("adr-loses-apache-4b", "PC-18", ADR_P_REL, "| §4(b) | Modified files carry prominent notices that they were changed |", "| §4(b) | |"),
  R("adr-loses-apache-4c", "PC-18", ADR_P_REL, "| §4(c) | Keep the source's copyright, patent, trademark and attribution notices |", "| §4(c) | |"),
  R("adr-loses-apache-4d", "PC-18", ADR_P_REL, "| §4(d) | Carry the upstream `NOTICE`, if there is one |", "| §4(d) | |"),
  R("adr-loses-apache-6", "PC-18", ADR_P_REL, "| §6 | No right to the licensor's names or marks |", "| §6 | |"),
  R("adr-lets-a-credit-license-non-commercial-code", "PC-18", ADR_P_REL, "A credit does not license non-commercial code. It meets", "A credit is enough. It meets"),
  R("adr-marks-itself-accepted", "PC-18", ADR_P_REL, "**Status:** APPROVED in substance by the owner's 'Approved' of the port delta, 2026-11-01.", "**Status:** ACCEPTED. **Status:** APPROVED in substance by the owner's 'Approved' of the port delta, 2026-11-01."),
  R("adr-names-the-legal-holder-as-fact", "PC-18", ADR_P_REL, "This ADR names no holder.", "RBT Systems Limited holds it."),
  R("adr-loses-the-open-holder-decision", "PC-18", ADR_P_REL, "The legal holder of original ProjectOS code is an OPEN owner decision.", "The legal holder is decided."),
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
];

/** Apply one fixture mutation, judge the tree, put it back. Returns what fired. */
function firedBy(dir, m, base) {
  const abs = path.join(dir, ...m.rel.split("/"));
  if (m.link) {
    fs.symlinkSync(path.join(dir, "projectos"), abs, "junction");
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, m.write ?? base[m.rel].replace(m.from, m.to));
  }
  const { refusals } = judgeRoot(dir);
  if (m.link || m.write !== undefined) fs.rmSync(abs, { force: true });
  else fs.writeFileSync(abs, base[m.rel]);
  return refusals;
}

function applies(m, base) {
  return m.link === true || m.write !== undefined || (typeof base[m.rel] === "string" && m.from !== "" && base[m.rel].includes(m.from));
}

function fixtureProofs(dir, base) {
  const errors = [];
  for (const [rel, text] of Object.entries(base)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }

  // THE POSITIVE CONTROL. Without it, a validator that refused everything would satisfy every mutation below.
  const control = judgeRoot(dir);
  control.refusals.forEach((r) => errors.push(`PC-M: the positive control was refused: ${r.message}`));
  const expected = Object.keys(base).filter((rel) => rel !== NOTICES_REL).sort();
  if (JSON.stringify([...control.judged].sort()) !== JSON.stringify(expected)) {
    errors.push(`PC-M: the positive control judged ${control.judged.length} of ${expected.length} fixture files`);
  }
  if (errors.length > 0) return errors;

  for (const m of FIXTURE_MUTATIONS) {
    if (!applies(m, base)) {
      errors.push(`PC-M: mutation '${m.name}' no longer applies; update it with the rule`);
      continue;
    }
    const refusals = firedBy(dir, m, base);
    const fired = [...new Set(refusals.map((r) => r.code))].sort();
    const wanted = [...new Set([m.rule, ...m.also])].sort();
    if (JSON.stringify(fired) !== JSON.stringify(wanted)) {
      errors.push(`PC-M: mutation '${m.name}' wanted ${wanted.join(", ")} and fired ${fired.join(", ") || "nothing"}`);
    } else if (!refusals.some((r) => r.code === m.rule && r.file === (m.file ?? m.rel))) {
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
  const base = { ...fixtureFiles(), [NOTICES_REL]: noticesText + FIXTURE_ENTRIES };
  const errors = scratch.withScratch("port-credit", (dir) => [...fixtureProofs(dir, base), ...recordProofs(raw)]);
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
    const abs = path.join(ROOT, ...rel.split("/"));
    raw[rel] = fs.existsSync(abs) ? normalise(fs.readFileSync(abs, "utf8")) : null;
  }
  return raw;
}

function run() {
  const raw = readRecords();
  const { refusals } = judgeRoot(ROOT);
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

module.exports = { run, judgeRoot, judgeFile, parseNotices, recordProblems, selfTest, FIXTURE_MUTATIONS, RECORD_MUTATIONS, RULE_NAMES };
