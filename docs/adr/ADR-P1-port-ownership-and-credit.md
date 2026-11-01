# ADR-P1 — Port ownership and credit

**Status:** APPROVED in substance by the owner's 'Approved' of the port delta, 2026-11-01. Only the owner marks an
ADR Accepted, and this one is not marked.

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
- **Notices already in the upstream file.** They stay, word for word, below our header.

A translation from Python to TypeScript is still a derivative work, and the same duties apply.

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

Any other PolyForm source is refused on the same ground. A new source goes on the approved list only through an owner
decision, after its licence has been read from its own `LICENSE` file.

## 6. Approved sources

| Source id | Licence | Copyright | Pinned commit |
|---|---|---|---|
| `hermes-agent` | MIT | Copyright (c) 2025 Nous Research | `d3e586881eacb132595edcbe4c170be8381e40c5` |
| `openclaw` | MIT | Copyright (c) 2026 OpenClaw Foundation | `c5b56f2505c4f6a5803125d2923e2934c5f750af` |
| `copilotkit-openbot` | MIT | Copyright (c) 2026 CopilotKit | `c396a5f68c817043846f1ca3c2b42061ee73ceb5` |
| `oh-my-hermes` | MIT | Copyright (c) 2026 oh-my-hermes contributors | `612a1cd9c44a19ecddcd263865e40e8c3910a514` |
| `rakazo` | Apache-2.0 | Copyright 2026 Rakazo contributors | `bf78ebd7961a28a8b437c605319c47b59edadc1c` |
| `isl-openbot` | MIT | Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab) | `c5f05271a067ca83d3de38e5976fa07bcec74b6e` |

`isl-openbot` is approved for its MIT files only. Its embedded Apache-2.0 and BSD-3-Clause files need their licence
text in `THIRD_PARTY_NOTICES` and a validator change before one is ported.

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
```

`Also-Credits` is for OpenClaw files. `Port-Strategy` and `Notice` are optional. `CHANGED:` is required for Apache-2.0
sources and recommended for all. For later changes, add a dated `Modified-By` line and keep the earlier ones.

**Original.** The file was written here:

```ts
// Origin: original ProjectOS code
```

The mark names no company, because the legal holder is still open (§9).

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

## 8. What enforces this, and what does not

`projectos/validators/val-projectos-port-credit1a.cjs` judges every file in those directories, including ones that do
not exist yet. It refuses, by name:

- a file with no header;
- an unknown source;
- a file with no notices entry;
- a wrong sha;
- any PolyForm or nightly-labs source;
- a partial header, a wrong licence or copyright, an Apache file that does not state its change, an OpenClaw file with
  no Pi credit, and an original mark on a file that shows upstream marks.

The directories are empty today, so a pass over the real tree proves nothing. The rules are proved against fixture
files in a temporary directory, with a positive control that a correct file passes.

**What it does not prove:**

- **A false "original" mark.** It sees upstream marks, not where the code really came from. A ported file with every
  mark removed reads as original, and only review catches that.
- **Names and logos in ported code.** It refuses a brand asset as a source path. It does not sweep identifiers or
  user-visible text for upstream names. Each port's review does that.
- **Claims.** What the owner says in sales or marketing is outside any validator. §2 is the rule for those.
- **Ports outside the port directories.** A file placed elsewhere is not judged. A later phase that ports into another
  directory must add it here and in the validator, in the same change.
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

The draft files are unchanged, and they still show the earlier pins for Hermes, OpenClaw and CopilotKit OpenBot.
