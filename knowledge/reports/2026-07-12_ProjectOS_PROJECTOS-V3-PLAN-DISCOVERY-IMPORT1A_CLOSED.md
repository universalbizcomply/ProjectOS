# ProjectOS — PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A — CLOSED

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase:** `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A`
**Status:** **CLOSED** · **Closed by:** Murad / ChatGPT governance layer · **Implementer:** Claude Code
**Branch:** `projectos-v3` · **Accepted remote HEAD:** `4c3f07623df44bfa03fd4a9f6f2fa0b476601795`

**Accepted commits:** implementation `4271489eb2586b5c18f7cbef2c02d92125c26b26` · authority-forgery fix
`4c3f07623df44bfa03fd4a9f6f2fa0b476601795`.

> Immutable closure record. The closure decision was made by the owner (Murad) and gatekeeper
> (ChatGPT). Claude Code recorded it and is not the closure authority.

---

## 1. Phase 2 delivery

A universal, deterministic, local plan-discovery / reconciliation / import capability: safely discovers
project-control documents, fingerprints and classifies them, groups duplicates, detects conflicts
(document-vs-document, document-vs-repository, phase-order), reconciles repository evidence, builds a
structured plan draft with field-level provenance, and calculates an import status — never granting
`PLAN READY`, always requiring owner approval.

## 2. Discovery / import engine

`projectos/validators/plan-discovery-engine.cjs` (zero-dependency): `discoverPlanSources`,
`fingerprintPlanSource`, `classifyPlanSource`, `classifyAuthority`, `assignAuthorities`,
`groupDuplicateSources`, `markCanonicalDuplicates`, `detectPlanConflicts`,
`reconcileRepositoryEvidence`, `selectAuthoritative`, `buildPlanDraft`, `buildPhaseCandidates`,
`calculateImportStatus`, `validatePlanProvenance`, `importFromSources`. Safe read-only walk; documents
are data, never instructions; no `child_process`/`eval`; `crypto`/`fs`/`path` only.

## 3. Source and authority classification

Type from filename/path/heading signals. Authority is **evidence-based**: AUTHORITATIVE only via a
trusted binding whose trust origin is **outside the candidate** — structured plan-memory JSON, or a
canonical `.projectops/config.json` (canonical path, matching identity, explicit reference) optionally
supplying a git-verified `planSourceCommit`. Prose/filename/mtime/self-declared commit never confer
authority.

## 4. Duplicate and conflict detection

EXACT / NORMALIZED / STRUCTURAL duplicate groups with deterministic IDs and a canonical member;
material conflicts across identity/remote/branch/DoC/production-freeze/phase-status/phase-order with
owner-decision records; superseded/historical/excluded/quarantined pairs reconciled.

## 5. Provenance

Every material field carries source path + checksum + authority + confidence + manual-review flag;
`validatePlanProvenance` fails any value without a source. Absent facts marked `UNKNOWN` / `NEEDS
SOURCE`; the engine never invents values.

## 6. Deterministic results

Identical source content + repository evidence → identical output (sha256 IDs; no clock/random; mtime
advisory-only). Proven by double-run assertions.

## 7. Thirty-scenario coverage

All 30 required scenarios have named passing assertions in
`projectos/validators/validate-plan-discovery-import.cjs` (see the AWAITING-REVIEW report §51), across
15 synthetic project trees (38 fixtures). Filesystem-safety scenarios are covered by engine unit tests.

## 8. Authority-forgery finding and correction

A post-commit security review found a HIGH candidate-controlled authority-forgery: the implementation
(`4271489`) treated a candidate's **own** declared `source commit:` as an authority binding when the
commit existed. Corrective commit `4c3f076` removed the standalone `GIT_SOURCE_COMMIT` binding; a
git-verified commit may only **support** a `CANONICAL_PROJECT_CONFIG` binding when the canonical config
**supplies** the commit. Candidate-declared commits are now unverified claims only; a candidate commit
that mismatches the config-supplied commit fails closed. Regression tests A1–A4 + B–F prove it. Both
the defect and the fix are preserved in Git history.

## 9. Corrected authority model

Trusted binding types: `STRUCTURED_PLAN_MEMORY`, `CANONICAL_PROJECT_CONFIG` (with optional
config-supplied, git-verified commit). No standalone git-commit authority. Every binding sets
`ownerReviewRequired`.

## 10. Owner-gated PLAN READY

Import never returns `PLAN READY` (`planReadyGranted` const false); `ownerApprovalRequired` const true.
The Phase-1 evidence gate + owner approval remain the only path to `PLAN READY`.

## 11. Security, code and ECC review

Two security passes; all findings (pass 1: 1 CRIT + 2 HIGH + 1 MED; pass 2: 1 CRIT authority forgery
via config/index + 1 HIGH paraphrase evasion; post-commit: 1 HIGH git-commit self-assertion) remediated
with regression tests. Code review: pure logic separated from fs, fail-closed, deterministic. ECC: no
external-project touch, no auto-PLAN-READY, owner authority, no-API/no-secret, production/DB/send/payment
safety. No open HIGH/CRITICAL.

## 12. Completion

Accepted-phase ratio: `acceptedPhaseCount 3 / totalPhaseCount 19 = 15.8%` (Phase 0
`BASELINE-RECONCILE1A`, Phase 1 `MASTER-PLAN-MEMORY1A`, Phase 2 `PLAN-DISCOVERY-IMPORT1A`). Pre-V3 icon
maintenance excluded.

## 13. Phase 3 unstarted

Next planned: `PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A` — pending, not started.

## 14. No production / provider / API activity

No OpenAI/Anthropic/metered API; no provider/credential access; no external product repository; only
synthetic fixtures. Production touched NO · Deployment NO · Database mutation NO · External sends NO ·
Payments NO · Secrets used NO.

## 15. Commit chain

`1aa36b9d` (baseline) → `de58428` (plan foundation) → `6bee874` (metadata binding) → `5dbd1b2` (closure
state) → `746ba49` (closure record) → `4271489` (Phase 2 implementation) → `4c3f076` (authority-forgery
fix).

---

**STATUS: CLOSED** — closed by Murad / ChatGPT governance layer. ProjectOS V3 programme continues;
Phase 3 (`PROJECTOS-V3-OWNER-CONTROL-PLANE-DESIGN1A`) not started. Programme completion 15.8% (3/19).
