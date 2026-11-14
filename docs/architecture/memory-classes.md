# Memory classes: six logical classes on the stores ProjectOS already has

**Phase:** PROJECTOS-MEMORY-STORES1A, plan v1.36 item 3.1. Stage 3 documents and completes the existing stores. It does not
replace them, and it adds no store of its own.

**Where the list comes from.** Plan 3.1 says "six logical classes map onto existing stores first" and names two of them (programme
and project memory, execution memory). Plan 3.2 and 3.3, the Stage 3 recon (C8, C9, C10) and ADR-S3 name the rest. The owner's
27 October 2026 V4 text, which may carry the list in full, was truncated and is not on disk (see the memory note on the V4
target). So **this list is reconstructed from those sources, and the owner should confirm or rename it.** Moving a store from one
class to another changes this file and nothing else.

**The V4 domains are not classes.** Personal, Develop, Business and Phone share these classes, keyed by the run envelope's
`(tenant, domain, project)`. None of them gets its own memory (plan principle 1).

## The six classes

| # | Class | Existing store | Owner: who writes, who decides | Retention |
|---|---|---|---|---|
| 1 | **Programme and project memory** (the plan memory) | `.projectops/plan-*.json`, `.projectops/current-state-*.json`, `project-config.json` (`planMemory`), and the committed decisions, gates and closure records beside them | Written by the plan and closure machinery, and committed. **The owner decides** every plan and decision, and nothing else writes them | Permanent, in git. It is authority: deleting anything a decision cites is the P5 action `memory-delete` |
| 2 | **Execution memory** (runs and checkpoints) | `.projectops/execution/<session>.{brief,session,invocation,effects,evidence,findings}.json`, `.projectops/continuity/` | The run loop writes its own records. A **worker writes only `findings` and `effects`**, and those stay worker-authored. The loop's check step judges them | Kept with the run's records in git. No automatic deletion; per-class retention and recorded deletion are plan 3.3 |
| 3 | **Curated memory** (approved notes and the owner's profile) | `.projectops/memory/MEMORY.md` (2,200 chars) and `USER.md` (1,375 chars), each with a `.provenance.json` and a `proposals/` queue | An agent **proposes** through the one door (a `proposals` entry in its findings record). **The owner approves**, over the proposal's hash. Nothing writes itself | Capped. An entry stays until the owner removes it by another approved proposal. Deleting approved memory is `memory-delete` (P5). A `decision` entry is a recollection that points at its ledger record, and the git record stays the fact |
| 4 | **Skills** (procedural memory) | `.projectops/skills/promoted/<name>.json` (package and pin in one file) and `.projectops/skills/proposals/` | An agent **proposes**, through the same door. A skill is promoted only by an **independent reviewer**, after the skill validator, and pinned by hash. Any change makes it stale and needs a new proposal | Versioned by its pin. A promoted skill stays until a new proposal replaces it. Loading is `skill-load` (P1) |
| 5 | **Retrieval index** (documents and the three stores above) | One SQLite file per tenant and project under the installation's index directory, named by a hash of the pair | **Nobody**: it is derived. The kernel rebuilds it from classes 1 and 2 and the project's documents (`memory-index-rebuild`, P2, derived indexes only) | Disposable. Delete the file and rebuild, and it answers the same. A citation is as fresh as the last rebuild; marking a stale one is plan 3.3 |
| 6 | **Code-intelligence memory** (symbols, dependency graph, tests) | None yet. ADR-S3 decides an adapter (SCIP, with tree-sitter as a labelled fallback) | Derived by the adapter from a git commit. Nobody writes it | Reproducible from a commit, and pinned to it. Not built in Stage 3.1 |

## What reads each class, and how

- **Every read is a retrieval** (`memory-retrieve`, P1), keyed on the run envelope's `(tenant, domain, project)` and never on
  anything a worker wrote. The context manager that calls it is plan 3.4 and 4.1; nothing calls it yet.
- **Stored text is data, never authority.** It never selects, advances or closes a phase, widens a write grant, or ranks above a
  committed decision. Memory and skill text reach a prompt only through a fence (`renderMemoryBlock`, `renderSkillBlock`,
  `renderUntrustedExcerpt`) that says so.
- **What the loader refuses before it sends** (curated memory, the first class a prompt reads): an entry that holds a credential
  (the agent's own vocabulary, injected into core as a screen), an entry with a threat or an instruction-shaped cue, an entry
  with hidden text (HTML comments, the `[x]: <>`, `[x]: # '...'` and `[ // ]: #` link-reference comments, a link title, any
  invisible character including the blank Braille cell U+2800), and a whole block whose **rendered** body is over twice the store
  cap. A refusal is a value with a code, and it quotes none of the text.
- **Indexed text comes back as untrusted data**, under a name that says so, with a citation to the real file and its real lines.
  A findings record is the worker's, so its text is indexed as worker-authored and ranks as such.

## What writes each class, and how

| Class | The only door |
|---|---|
| 1, 2 | The plan and closure machinery, and the run loop. A worker's direct write to either is not a memory write and is judged by the phase's write grant |
| 3, 4 | A `proposals` entry in the worker's findings record (`memory-propose`, `skill-propose`, P2), which becomes a **pending proposal pinned by hash**. A worker's **direct write to `.projectops/memory/` or `.projectops/skills/` is detected and refused at the check step**. Under the worker grant nothing stops the write itself |
| 5 | `memory-index-rebuild` only |
| 6 | Not yet built |

The check-step refusal is `checkNoDirectStoreWrites` in core. Wiring it into the loop's check step, and the door after the
findings are read, is Stage 4.1: see `docs/finish/PROJECTOS-MEMORY-STORES1A.md`.

## Open questions for the owner

1. **Confirm or rename the six classes.** The list above is reconstructed.
2. **`.projectops/memory/` and `.projectops/skills/` are not git-ignored,** so a cloned or PR-borne file counts as an approved
   store. Ignoring them is one `.gitignore` line, outside this phase's write paths, and the cost is that memory no longer travels
   with a clone. Signing the records is the real answer and belongs with owner proof.
3. **Who deletes a promoted skill?** `memory-delete` is registered for approved memory and for anything a decision cites. A skill
   is neither, so its deletion has no registered action.
