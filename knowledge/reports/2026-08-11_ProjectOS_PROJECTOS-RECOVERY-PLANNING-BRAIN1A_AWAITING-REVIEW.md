# PROJECTOS-RECOVERY-PLANNING-BRAIN1A — Evidence Pack

> Status: IMPLEMENTED-LOCALLY / AWAITING-REVIEW. Closure is owner-gated, and under this programme it
> is delegated to ChatGPT for phase-closure and programme-closure.

1. **Project:** ProjectOS
2. **Phase:** PROJECTOS-RECOVERY-PLANNING-BRAIN1A — "Make ProjectOS produce a plan proposal a person can read, by fixing the planning semantics rather than by editing the output."
3. **Date:** 2026-08-11
4. **Branch / HEAD:** `projectos-post-v3-selfhost-pilot1a` — implementation commits `a677008`, `51cfc91`, `5dda2ec`; evidence subject recorded in `.projectops/closure/PROJECTOS-RECOVERY-PLANNING-BRAIN1A.json`
5. **Files changed:** `projectos/validators/plan-discovery-engine.cjs`, `projectos/validators/validate-plan-discovery-import.cjs`, `projectos/agent/src/planIntake.ts`, `projectos/agent/src/commands/plan.ts`, `projectos/schemas/project-config.schema.json`, `.projectops/project-config.json`, `docs/operational-recovery-plan.md`

## 6. Summary

The first real ProjectOS-generated draft was unusable: 442 sources, 5,891 conflicts, 106 phase
candidates, 4.7 MB. It was not a bad scan. Seven distinct semantic defects were found and fixed at
the cause, not tuned around.

**Planning corpus (F10).** Discovery stays broad; a PLANNING ROLE decides what may SHAPE a plan —
`CURRENT_PLANNING`, `SUPPORTING_CONTEXT`, `HISTORICAL_EVIDENCE`, `QUARANTINED`. Only current-planning
material may produce conflicts, phase candidates and owner decisions. Nothing is hidden or deleted:
every source keeps its authority, provenance and evidence, and both the record and the CLI report the
whole corpus. The corpus is DECLARED where the project declares it (`planMemory`, or the new optional
`planSources`), never inferred from directory names.

**Trust oracle.** Three holes closed. A plantable top-level `project-config.json` was trusted on
filename alone — trust is now the ProjectOS-controlled LOCATION. Identity silence counted as identity
agreement. The dominant project identity was taken from the first source that had already reached
AUTHORITATIVE, so a document could become authoritative and then define the identity everything else
was measured against; observed live, a TEST FIXTURE plan was selected as this repository's
authoritative source. Identity now comes from repository evidence.

**A delivered plan is history.** A declared plan every one of whose phases the project's own DECLARED
current-state records complete is retired to `HISTORICAL_EVIDENCE`. Without it ProjectOS proposed the
nineteen closed V3 phases back as the plan for a brand-new objective. Deliberately conservative: one
outstanding phase keeps a plan current, a plan with no phases is not judged, and a missing phase id
counts as not complete. Only a DECLARED completion record counts — otherwise one plantable file could
delete the real plan from every proposal, a denial-of-plan dressed as evidence.

**A markdown plan is a plan.** Most projects keep the plan as a document; the engine could only
scrape id-shaped tokens out of prose, so an owner was asked to approve a list of bare identifiers.
Markdown plans now yield the same fields JSON plans do — vision, definition of complete, success
standard, approved and excluded scope, environments, and per-phase purpose, dependencies, acceptance
criteria, validators, reviews, owner gates, risk, autonomy and browser-proof. Self-declaring, because
every repository is full of plan-shaped design notes.

**A guessed identity was permanent.** `assignAuthorities` runs twice over the same array, and a
downgrade to `UNVERIFIED` is not eligible for re-upgrade, so a wrong dominant identity guessed in the
first pass was irreversible. Each pass now restarts from the single-source verdict, and the intake
passes repository evidence into discovery as well as into the import.

**Declaration outranks prose.** This repository's current-state record describes which plan VERSIONS
it supersedes, and that word was retiring the live record to history.

**Order is part of the plan.** Phase candidates were sorted by phaseId "for determinism"; the
readiness evaluator requires a dependency to PRECEDE its dependant, so every plan with a dependency
chain was refused outright. Document order is equally deterministic and is the plan's own statement
of sequence. Found by dry-running a real materialisation, not by reading the code.

### BEFORE → AFTER, same owner objective, same repository

| | first draft | after F10 | after this phase |
|---|---|---|---|
| sources considered | 442 | 442 | 445 |
| current planning | — | 3 | 3 |
| phase candidates | 106 | 19 (V3's closed roadmap) | 6 (the recovery stages) |
| conflicts | 5,891 | 0 | 0 |
| owner decisions | 5,891 | 0 | 0 |
| unknowns | 2 | 0 | 0 |
| provenance errors | — | 0 | 0 |
| draft record | 4.7 MB | 43 KB | 33 KB |

## 7. Validators

`validate-plan-discovery-import` — the phase's required validator — PASS. `validate-all` 127/127,
0 FAIL. Agent 181 tests, core 211. Subject-bound validator-run record at
`.projectops/validation/<subject>.json`.

**Adversarial regressions, mutation-proven.** Seven added covering every fix; restoring any defect
fails the suite: delivered-plan demotion removed; undeclared completions allowed to retire a plan;
markdown read without self-declaration; markdown plans not read at all; acceptance bullets dropped;
sticky mis-identity downgrade restored; phase order sorted alphabetically again. **7/7 killed.**

## 8. Secrets used?

No. No credential was read, written, stored or transmitted. Secret-bearing sources remain quarantined
before semantic extraction and their titles redacted.

## 9. Gated actions performed?

None. No production, database, external send, payment, credential, installation, service, ACL,
registry or ProgramData action. No force push, no history rewrite, no merge to a protected branch.
Commits and pushes were to the isolated pilot branch only.

## 10. Risks / carry-forward

- `labelledList` is worst-case quadratic within one markdown section, bounded by the engine's existing
  512 KB per-file cap. Not a denial of service; recorded rather than optimised away.
- Instruction-shaped sources: 29 discovered in this repository, all flagged and contributing nothing.
  Regex injection detection is best-effort defence in depth and is bypassable by paraphrase; the
  boundary is the authority model, not the regex.
- The engine still cannot detect a symlink planted inside the project that resolves outside it; the
  check is lexical. Pre-existing, and unchanged by this phase.

## 11. Decision needed

Delegated closure decision by ChatGPT for `PROJECTOS-RECOVERY-PLANNING-BRAIN1A`, recorded at
`.projectops/closure/decisions/PROJECTOS-RECOVERY-PLANNING-BRAIN1A.json` and committed.

## Final status

**PROJECTOS-RECOVERY-PLANNING-BRAIN1A — AWAITING-REVIEW.**
