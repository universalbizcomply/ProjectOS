# ADR-P1 — Port ownership and credit

**Status:** Proposed. The owner approved the port delta on 2026-11-01 ("Approved"), and this ADR carries out that
delta. Only the owner marks an ADR Accepted, and this one is not marked.

**Applies to:** every file copied, translated or adapted from another project into ProjectOS. It serves
`docs/changes/delta_spec_V4_PORTS.md`, and it applies before the first upstream line lands.

## 1. The rule

Owner, 2026-11-01: "i want to claim it's mine with giving credits to the due".

ProjectOS is the owner's product. The owner may brand it, rename everything in it, change any of it, sell it and
say "this is my product". Code taken from open-source projects is credited, every time, and that credit is not
optional or removable.

## 2. What the owner may claim

- Say: "ProjectOS is my product, and it includes credited open-source components".
- Own the original ProjectOS code and every change made to ported code.
  Who legally holds the original code is still open (§9).
- Brand, rename, change and sell the product, under the licences below.
- Do not say the owner wrote the upstream code.
- Do not use an upstream project's name or logo as ProjectOS branding, or to imply endorsement.

## 3. What must be credited

For every ported file:

- **The licence.** The upstream copyright line and licence text are kept in `THIRD_PARTY_NOTICES`.
- **The file.** It carries a header naming the upstream project, source path, pinned commit, licence and "modified for
  ProjectOS".
- **The entry.** `THIRD_PARTY_NOTICES` has an entry for it: upstream URL, source path at the pinned sha, our path,
  licence, copyright, and a pointer to the licence text.
- **OpenClaw files.** Each also credits Pi / pi-mono. OpenClaw says portions of it were adapted from Pi and does not
  say which, so the credit cannot be ruled out for any file.
- **Notices already in the upstream file.** They stay, word for word, below our header, after the end marker in §7.
- **Further upstreams.** Code inside a source may have come from somewhere else, as OpenClaw's own notices say of Pi
  and Hermes. A port names each one with `Also-Credits`, in the header and in the entry. One that is not yet recorded
  needs a reviewed addition to the validator and its licence text in `THIRD_PARTY_NOTICES`.

A translation from Python to TypeScript is still a derivative work, and the same duties apply.

A header is never dropped by line count or by a rewrite claim. Once a file has been recorded as ported, removing its
header needs a committed owner record naming the path (§7). How much of the file changed does not decide it.

## 4. Apache-2.0 duties

Rakazo is Apache-2.0, and some duties go beyond MIT:

| Clause | Duty | How ProjectOS meets it |
|---|---|---|
| §4(a) | Give recipients a copy of the licence | The full text is in `THIRD_PARTY_NOTICES`, once |
| §4(b) | Modified files carry prominent notices that they were changed | A dated `Modified-By` line stating `CHANGED:` and what changed. Later changes add a line |
| §4(c) | Keep the source's copyright, patent, trademark and attribution notices | An upstream file's own header stays word for word, directly below ours |
| §4(d) | Carry the upstream `NOTICE`, if there is one | Rakazo has none anywhere in its tree at the pinned commit, and `THIRD_PARTY_NOTICES` records that. A later re-pin checks again |
| §6 | No right to the licensor's names or marks | None is used, except to say where the code came from |

## 5. A credit does not license non-commercial code

A credit does not license non-commercial code. It meets the attribution duty of a licence that already allows the
use, and nothing more.

`nightly-labs/openbot` is PolyForm Noncommercial 1.0.0, © 2026 Synthetify Labs. ProjectOS is to be sold, so its code,
prompts, skills, UI and assets are not copied, translated or closely paraphrased, with or without a credit. Its
features are ideas, and ProjectOS builds them from MIT sources and our own code, as the delta sets out. The builder is
not given that repository. The only route to its actual code is a commercial licence from Synthetify Labs.

Any other PolyForm source is refused on the same ground. So is LobeHub: its Community License requires a commercial
licence for a derivative work, and Hermes `tools/terminal_tool_result.py` carries a fragment ported from it
(`docs/legal/vendor-provenance.md` §1). That behaviour is rewritten from scratch, not translated.

A new source goes on the approved list only through an owner decision, after its licence has been read from its own
`LICENSE` file.

## 6. Approved sources

| Source id | Licence | Copyright | Pinned commit |
|---|---|---|---|
| `hermes-agent` | MIT | Copyright (c) 2025 Nous Research | `d3e586881eacb132595edcbe4c170be8381e40c5` |
| `openclaw` | MIT | Copyright (c) 2026 OpenClaw Foundation | `c5b56f2505c4f6a5803125d2923e2934c5f750af` |
| `copilotkit-openbot` | MIT | Copyright (c) 2026 CopilotKit | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` |
| `oh-my-hermes` | MIT | Copyright (c) 2026 oh-my-hermes contributors | `612a1cd9c44a19ecddcd263865e40e8c3910a514` |
| `rakazo` | Apache-2.0 | Copyright 2026 Rakazo contributors | `bf78ebd7961a28a8b437c605319c47b59edadc1c` |

Each row is the validator's record. A re-pin moves the old commit to `earlierPins` in the validator and `Earlier-Pins`
in `THIRD_PARTY_NOTICES`. A file already ported keeps its true commit, and is never restamped.

`isl-openbot` is not on this list. Its licence file is MIT, but it embeds Apache-2.0 and BSD-3-Clause files that an MIT
header would misdescribe. Its phase adds it, with per-file licence handling.

## 7. How a file is marked

A file in a port directory opens with one of two things, in its own comment syntax.

**Ported.** One block per upstream source. The keys follow `docs/legal/porting-convention.md`:

```ts
// SPDX-License-Identifier: MIT
// Ported-From: openclaw https://github.com/openclaw/openclaw
// Source-Path: extensions/memory-core/src/memory/hybrid.ts
// Source-Commit: c5b56f2505c4f6a5803125d2923e2934c5f750af
// Source-Copyright: Copyright (c) 2026 OpenClaw Foundation
// Also-Credits: pi-mono (Copyright (c) 2025 Mario Zechner, MIT)
// Port-Strategy: DIRECT
// Modified-By: ProjectOS 2026-11-03: modified for ProjectOS. CHANGED: imports cut to ProjectOS equivalents
// Notice: full licence text in THIRD_PARTY_NOTICES
// End-Of-Credit-Header
```

`Also-Credits` is required on OpenClaw files and names any further upstream. `Port-Strategy` and `Notice` are optional.
`CHANGED:` is required for Apache-2.0 sources and recommended for all. For later changes, add a dated `Modified-By`
line and keep the earlier ones.

`End-Of-Credit-Header` ends our header. It is required only when upstream text is kept below it, because anything above
it is read as ours. Without it, an upstream `SPDX-License-Identifier` line reads as a second, incomplete header.

**Original.** The file was written here:

```ts
// Origin: original ProjectOS code
```

The mark names no company, because the legal holder is still open (§9). A file with this mark may not carry a
copyright line, a licence identifier, licence text, or an upstream name or URL.

A format with no comment syntax, such as JSON, cannot carry either mark, so it does not belong in a port directory.

**Port directories:**

- `projectos/core/src/search/`
- `projectos/core/src/memory/`
- `projectos/core/src/skills/`
- `projectos/core/src/context/`
- `projectos/core/src/approvals/`
- `projectos/agent/src/search/`
- `projectos/agent/src/memory/`
- `projectos/agent/src/skills/`

Every file in these directories must be tracked by git. A file a port needs must not match an ignore rule. An ignored
file passes every check on disk and is missing from a clean checkout, and force-adding it does not help the next
person, so the file takes another name. `.gitignore` is not changed to suit it: `*token*` is a secret guard.

**Test directories.** Most files here are ours and carry no mark. A file is judged only once it shows an upstream mark,
and then it needs a header and an entry like any other:

- `projectos/core/test/`
- `projectos/agent/test/`

Outside these directories, tracked source carries no `Ported-From:` line and no upstream copyright line. Adding a port
directory is a listed, reviewed change, made here and in the validator together.

**Removing a recorded header.** The entry is replaced by a `REMOVED` record pointing at a committed
`.projectops/plan-decisions/PLANDEC-*.json` that approves it, was decided by the owner, and names the path. The validator
reads every path ever entered from the history of `THIRD_PARTY_NOTICES`, so a header and its entry cannot vanish in one
commit.

## 8. What enforces this, and what does not

`projectos/validators/val-projectos-port-credit1a.cjs` judges every file in those directories, including ones that do
not exist yet. It refuses, by name:

- a file with no header;
- an unknown source;
- a file with no notices entry;
- a wrong sha;
- any PolyForm or nightly-labs source;
- a partial header, a wrong licence or copyright, an Apache file that does not state its change, an OpenClaw file with
  no Pi credit, an unrecorded further upstream, and an original mark on a file that shows upstream marks;
- a recorded port that lost its header, and an upstream mark outside the directories above.

The directories are empty today, so a pass over the real tree proves nothing. The rules are proved against fixture
files in a temporary directory, with a positive control that a correct file passes.

**What it does not prove:**

- **A false "original" mark.** It sees upstream marks, not where the code really came from. A ported file with every
  mark removed reads as original, and only review catches that.
- **Names and logos in ported code.** It refuses a brand asset as a source path. It does not sweep identifiers or
  user-visible text for upstream names. Each port's review does that.
- **Claims.** What the owner says in sales or marketing is outside any validator. §2 is the rule for those.
- **Ports with every mark removed, outside the port directories.** A tracked file with a `Ported-From:` line or an
  upstream copyright line is refused. One with no such text is not seen. Only tracked files are scanned.
- **Whether a `Source-Path` exists at the pin.** The validator reads no vendor folder, because those exist only on this
  machine. The path is checked for shape and against the entry, not against upstream.
- **Shipping the notices with the product.** Having the file in the repository does not put it in the installer, the
  app or a hosted service. The MIT and Apache-2.0 duties apply to what ships, and each release must carry it.
- **Per-file licences inside a source.** A source's licence is judged as one licence. A file inside it may carry its
  own, which is why `isl-openbot` is left out. Each port reads the header of the file it takes.
- **OpenClaw's own notice entries.** They are not carried wholesale. SQLite and GitHub Octicons need a credit only if a
  port takes that code, and Hermes only for the file OpenClaw says came from it.
- **A rewrite under a new path.** A recorded path is tracked, not its content. A similarity check could help: it is
  feasible hash-only, and it would be advisory, not a gate.
- **Refused behaviour.** The delta's refused list, such as `tools/approval_smart.py`, is a matter for each port's
  gates and review. This validator judges credit, not safety.

## 9. Open decisions

**The legal holder of original ProjectOS code is an OPEN owner decision.** This ADR names no holder. The IP pack proposes RBT Systems Limited; that proposal is unconfirmed, and nothing here relies on it. No file names a company as the
copyright holder until the owner decides.

- **Product name.** Open. The IP pack records a US trademark conflict on "ProjectOS". A rename changes nothing here.
- **AI-assisted code.** How copyright applies to it, and what the Claude plan terms mean for it, are questions for the
  solicitor in `docs/legal/IP_HOMEWORK.md`. This ADR records the owner's intent and what the licences require. It is
  not legal advice.

## 10. Relation to the legal pack

`docs/legal/` holds a proposal from 2026-10-29, prepared for legal review. This ADR keeps its header keys. Where they
differ, this ADR and the approved delta win:

| Point | Legal pack draft | This ADR |
|---|---|---|
| Notices file | `THIRD_PARTY_NOTICES.md` | `THIRD_PARTY_NOTICES`, at the repository root |
| Per-file record | `docs/legal/PORTED_FILES.tsv` | An entry in `THIRD_PARTY_NOTICES` |
| Validator | `val-ported-file-provenance.cjs` | `val-projectos-port-credit1a.cjs` |
| Pins | The 2026-10-29 pins | The commits in §6 |
| Header statement | `Modified-By` with a date | The same, and it must say "modified for ProjectOS" |
| End of header | Not defined | `End-Of-Credit-Header`, when upstream text is kept below |
| `isl-openbot` | A planned source | Left out until its phase |

The draft files are unchanged, and they still show the earlier pins for Hermes, OpenClaw and CopilotKit OpenBot.
