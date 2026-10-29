# Porting convention: how ProjectOS marks code it copies from other projects

**Status:** proposal for owner and legal review, 2026-10-29. Nothing has been committed.
**Applies to:** every file ProjectOS creates by copying, translating or adapting source code from an outside
project. Today that means Hermes Agent, OpenClaw (and Pi through it), CopilotKit OpenBot, oh-my-hermes, isl
OpenBot and Rakazo.
**Does not apply to:** installed dependencies (`npm`, `cargo` and the like). They have their own notice
list. It also does not cover code written from scratch after only *reading* a design. For those files,
see rule 6.

## The rule in one paragraph

Every ported file starts with a **provenance header**. The header names the source project, its path and
commit, the licence and the original copyright line, and says the file was **modified by ProjectOS** on a
given date. Every ported file has **one row in the register**, `docs/legal/PORTED_FILES.tsv`. Every
licence named in the register has a section in `THIRD_PARTY_NOTICES.md`. A validator checks that the
headers, the register and the notices file agree.

## 1. The provenance header

Put it at the very top of the file, before any import. Use the file's own comment syntax. Use one key per
line, with the key names exactly as shown, so a validator can parse them.

### 1.1 MIT source (Hermes, OpenClaw, CopilotKit OpenBot, oh-my-hermes, isl OpenBot)

```ts
// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/memory-core/src/memory/hybrid.ts
// Source-Commit: bde3017359edf796459ad4d5e3753ac6b84a49bf
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-03 (imports cut to ProjectOS equivalents; envelope tenant scoping added)
// Notice: full licence texts in THIRD_PARTY_NOTICES.md; register row in docs/legal/PORTED_FILES.tsv
```

- **`Also-Credits`** is **mandatory on every OpenClaw-derived file**. OpenClaw says that portions of it
  were adapted from Pi / pi-mono, but it does not list which files. We cannot rule Pi out for any
  OpenClaw file, so we always credit it.
- Use `Also-Credits` as well when the upstream file itself credits someone. Examples:
  - OpenClaw `packages/agent-core/src/repetition-guard.ts` credits Hermes Agent.
  - OpenClaw `packages/terminal-core/src/ansi.ts` credits Sindre Sorhus.
  - OpenClaw's generated TypeBox validators credit Haydn Paterson.
- **Keep any third-party licence block that the upstream file already carries, word for word, below
  our header.** For example, the Sindre Sorhus MIT block in `ansi.ts` stays as it is. Never shorten
  it.
- For a **Python → TypeScript translation**, use `Port-Strategy: TRANSLATE` and keep the same keys.
  A translation is still a derivative work, so the MIT notice duty applies just as it does to a copy.

### 1.2 Apache-2.0 source (Rakazo, and the TensorFlow/Google files inside isl OpenBot)

Apache-2.0 §4(b) requires "prominent notices stating that You changed the files". So the `Modified-By`
line is required and must say *what* changed.

```ts
// SPDX-License-Identifier: Apache-2.0
// Ported-From: rakazo https://github.com/elie222/rakazo
// Source-Path: packages/core/src/approval-effect-key.ts
// Source-Commit: bf78ebd7961a28a8b437c605319c47b59edadc1c
// Source-Copyright: Copyright 2026 Rakazo contributors
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-03 — CHANGED: effect key bound to the ADR-K1 envelope subjectHash;
//   "never"/"auto" approval modes removed; renamed exports. This file is a modified version of the original.
// Notice: Licensed under the Apache License, Version 2.0; see THIRD_PARTY_NOTICES.md §8.
//   Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.
```

- **Keep the original header.** If the upstream file has its own Apache header, for example
  `Copyright 2019 The TensorFlow Authors. All Rights Reserved. Licensed under the Apache License…`,
  keep it word for word, directly below ours (Apache-2.0 §4(c)).
- **Record every later change.** Each time a ProjectOS commit changes the file again, add a dated
  `Modified-By` line. The newest goes last. Do not overwrite the first one: the history of changes is
  the §4(b) notice.
- **Do not use the brand.** Never use the upstream name or logo for ProjectOS features, UI or package
  names. Apache-2.0 §6 gives no trademark rights.
- **Check for a NOTICE file.** If the upstream has a `NOTICE` file at the pinned commit, its text goes
  into `THIRD_PARTY_NOTICES.md` (§4(d)). None of the in-scope Apache upstreams has one today: Rakazo,
  `tensorflow/examples`, `google-ar/arcore-android-sdk` and `google/blockly` were all checked. OpenAI
  Codex does have one; see conditional entry C.4.

### 1.3 Files where a header cannot go

Some files have no comment syntax, such as JSON fixtures, or are generated. For these, write the header
fields into the register row instead, and set `header` to `register-only`. A `SKILL.md` imported as test
data keeps its own `license:` frontmatter, and its directory keeps any `LICENSE.upstream` or `NOTICE.md`
file it ships with.

## 2. The register: `docs/legal/PORTED_FILES.tsv`

The register is one tab-separated file with a header row and one row per ported file. It is sorted by
`projectos_path`.

| Column | Example | Rule |
|---|---|---|
| `projectos_path` | `projectos/memory/hybrid.ts` | Repo-relative, forward slashes, unique |
| `source_project` | `openclaw` | One of: `hermes-agent`, `openclaw`, `copilotkit-openbot`, `oh-my-hermes`, `isl-openbot`, `rakazo` |
| `source_url` | `https://github.com/openclaw/openclaw` | Must match the project's URL in the table in §5 |
| `source_commit` | `bde3017359edf796459ad4d5e3753ac6b84a49bf` | Full 40-hex sha. Must match the pinned commit in §5, unless the row is re-pinned (see §4) |
| `source_path` | `extensions/memory-core/src/memory/hybrid.ts` | Path at that commit. Several upstream files merged into one → separate them with `;` |
| `spdx` | `MIT` | `MIT`, `Apache-2.0`, `BSD-3-Clause`. A file with mixed origins lists them all, joined by ` AND ` |
| `source_copyright` | `Copyright (c) 2026 OpenClaw Foundation` | Verbatim from the upstream LICENSE or file header |
| `also_credits` | `pi-mono;sorhus-ansi` | Keys of extra entries in `THIRD_PARTY_NOTICES.md`; `pi-mono` is required for `openclaw` rows |
| `strategy` | `DIRECT` | `DIRECT` or `TRANSLATE` |
| `first_ported` | `2026-11-03` | ISO date of the porting commit |
| `last_modified` | `2026-11-20` | ISO date of the latest ProjectOS change |
| `upstream_sha256` | `9f2c…` | SHA-256 of the upstream file bytes at `source_commit`. It lets anyone check that the claimed source is real |
| `header` | `inline` | `inline` or `register-only` |
| `notes` | `REFUSED paths removed: dreaming` | Free text, no tabs |

**Why a register as well as headers:**
- A header can be deleted by accident; the register makes the deletion visible.
- The lawyer and the notices generator read one file instead of scanning the tree.
- It is the single place to answer "what did we take, from where, at which commit?"

## 3. The validator check

Proposed file: `projectos/validators/val-ported-file-provenance.cjs`. It is read-only, needs no network,
and runs in `validate-all`.

**Inputs:**
- `docs/legal/PORTED_FILES.tsv`;
- `THIRD_PARTY_NOTICES.md`;
- the working tree.

**Pass conditions.** The check fails, naming the rule, on the first breach of any of these.

| Rule | Check |
|---|---|
| **P1 register well-formed** | Header row exactly as in §2. Every row has every column. `projectos_path` is unique and sorted. Dates are ISO and `last_modified ≥ first_ported`. `source_commit` is 40-hex. `spdx` is in the allowed set |
| **P2 register → tree** | Every `projectos_path` exists |
| **P3 header matches register** | For `header = inline`, the first 40 lines of the file contain `SPDX-License-Identifier`, `Ported-From`, `Source-Path`, `Source-Commit`, `Source-Copyright` and `Modified-By`, and each value equals the register value (the `Ported-From` URL equals `source_url`) |
| **P4 Apache change notice** | If `spdx` contains `Apache-2.0`, at least one `Modified-By:` line contains the word `CHANGED` and a date. The latest such date equals `last_modified` |
| **P5 Pi credit** | If `source_project = openclaw`, `also_credits` contains `pi-mono` and the header has `Also-Credits:` naming pi-mono |
| **P6 tree → register (no stowaways)** | No file outside the register contains a `Ported-From:` line. No file outside the register contains an upstream marker: `Copyright (c) 2025 Nous Research`, `OpenClaw Foundation`, `Mario Zechner`, `Copyright (c) 2026 CopilotKit`, `oh-my-hermes contributors`, `Intel ISL`, `Rakazo contributors`, `The TensorFlow Authors`. Two places are exempt: `THIRD_PARTY_NOTICES.md` and `docs/legal/**`. Everywhere else the validator strips nothing for this scan, so a marker in a comment still counts |
| **P7 notices cover the register** | Every distinct `source_project` and every `also_credits` key in the register has a matching section anchor in `THIRD_PARTY_NOTICES.md`. Every Apache project section states its NOTICE status. `THIRD_PARTY_NOTICES.md` contains the Apache-2.0 text once if any row is Apache |
| **P8 pinned commits** | Every `source_commit` equals the pinned commit for its project (the table in §5), unless a row is listed in a `repins` section that names the new commit. Silent drift fails |
| **P9 refused paths stay out** | No `source_path` matches the REFUSE list in the port map, for example `agent/vault_*`, `tools/approval_smart.py`, `tools/approval_yolo.py`, `browser_vault_tool.py`, OpenClaw `extensions/whatsapp`, `extensions/imessage`, Rakazo `payment-wallets.ts`, `decision-auto-review.ts`, `auto-review.ts`, `self-update.ts`. No `source_path` is a brand asset (`*.png`, `*.svg`, `*.icns` and similar under `assets/`, `marks/`, `icons/`) |

**Reference sketch** (illustrative only; to be written under the repository's normal TDD and review
rules):

```js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const COLS = ["projectos_path","source_project","source_url","source_commit","source_path","spdx",
  "source_copyright","also_credits","strategy","first_ported","last_modified","upstream_sha256","header","notes"];
const PINS = {
  "hermes-agent": "ef75bc708867e3884cb40a91363be6dc6fddc034",
  "openclaw": "bde3017359edf796459ad4d5e3753ac6b84a49bf",
  "copilotkit-openbot": "4766e4247675eb73ff80d525ff645dd8a9da815f",
  "oh-my-hermes": "612a1cd9c44a19ecddcd263865e40e8c3910a514",
  "isl-openbot": "c5f05271a067ca83d3de38e5976fa07bcec74b6e",
  "rakazo": "bf78ebd7961a28a8b437c605319c47b59edadc1c",
};

function headerField(text, key) {
  const m = text.split(/\r?\n/, 40).join("\n").match(new RegExp(`^\\s*(?://|#|\\*|<!--)?\\s*${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim() : null;
}

function check(root) {
  const fail = (rule, msg) => { throw new Error(`[${rule}] ${msg}`); };
  const lines = fs.readFileSync(path.join(root, "docs/legal/PORTED_FILES.tsv"), "utf8").trimEnd().split(/\r?\n/);
  if (lines[0] !== COLS.join("\t")) fail("P1", "register header row is wrong");
  const rows = lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [COLS[i], v])));
  for (const r of rows) {
    if (!/^[0-9a-f]{40}$/.test(r.source_commit)) fail("P1", `${r.projectos_path}: bad commit`);
    if (r.source_commit !== PINS[r.source_project]) fail("P8", `${r.projectos_path}: commit is not the pin`);
    const abs = path.join(root, r.projectos_path);
    if (!fs.existsSync(abs)) fail("P2", `${r.projectos_path}: missing`);
    if (r.header === "inline") {
      const t = fs.readFileSync(abs, "utf8");
      if (headerField(t, "Source-Commit") !== r.source_commit) fail("P3", `${r.projectos_path}: header commit`);
      if (headerField(t, "Source-Path") !== r.source_path) fail("P3", `${r.projectos_path}: header path`);
      if (r.spdx.includes("Apache-2.0") && !/Modified-By:.*\d{4}-\d{2}-\d{2}.*CHANGED/.test(t)) fail("P4", r.projectos_path);
    }
    if (r.source_project === "openclaw" && !r.also_credits.split(";").includes("pi-mono")) fail("P5", r.projectos_path);
  }
  // P6, P7 and P9 follow the same pattern: walk the tracked files with the repository's bound git
  // (`git ls-files`), never a bare `git`.
}
module.exports = { check };
```

## 4. Re-pinning and later upstream changes

- **Pulling an upstream fix later** is a **new port**:
  - update the row's `source_commit`, `upstream_sha256` and `last_modified`;
  - add a `repins` entry naming the new commit;
  - add a new `Modified-By` line.

  Never change a commit in place without the `repins` entry; P8 refuses silent drift.
- **Re-pinning a whole project** (a new port phase) updates the table in §5 and every row for that
  project in one commit.

## 5. Pinned sources (the validator's `PINS` table)

| `source_project` | URL | Commit | Licence |
|---|---|---|---|
| `hermes-agent` | https://github.com/NousResearch/hermes-agent | `ef75bc708867e3884cb40a91363be6dc6fddc034` | MIT |
| `openclaw` | https://github.com/openclaw/openclaw | `bde3017359edf796459ad4d5e3753ac6b84a49bf` | MIT (+ pi-mono MIT credit) |
| `copilotkit-openbot` | https://github.com/CopilotKit/OpenBot | `4766e4247675eb73ff80d525ff645dd8a9da815f` | MIT |
| `oh-my-hermes` | https://github.com/rlaope/oh-my-hermes | `612a1cd9c44a19ecddcd263865e40e8c3910a514` | MIT |
| `isl-openbot` | https://github.com/ob-f/OpenBot | `c5f05271a067ca83d3de38e5976fa07bcec74b6e` | MIT (+ embedded Apache-2.0, BSD-3-Clause) |
| `rakazo` | https://github.com/elie222/rakazo | `bf78ebd7961a28a8b437c605319c47b59edadc1c` | Apache-2.0 |

## 6. Edge cases

- **Read, then wrote from scratch** (REFERENCE strategy). No header is needed. Record the design source
  in the commit message or ADR. If any expression was carried over (identifiers, comments, structure
  beyond the idea), treat it as a port.
- **Fragments that Hermes itself "ported from" a third repository.** Hermes comments such as "Ported from
  anomalyco/opencode#25019" or "Port of openai/codex#33464" name a further upstream. If ProjectOS
  translates that part, add the further upstream to `also_credits`. Do **not** translate the fragment
  marked "ported from lobehub/lobehub#19329" (LobeHub Community License, see the provenance report §3.1);
  rewrite that behaviour from scratch instead.
- **One ProjectOS file built from several upstream files.** List them all in `source_path`, separated by
  `;`, and join their licences in `spdx` with ` AND `.
- **Brand strings.** Rename identifiers, paths and user-visible text, such as `~/.hermes`, `HERMES_HOME`,
  `openclaw`, `com.rakazo.*` and `ai.openbot.mobile`, when porting. P6 catches leftover copyright
  markers, not names; a brand sweep is a separate check.
