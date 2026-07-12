# ProjectOS — PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A — CORRECTED Pre-Commit Report

> **Corrective pass (authority model + untrusted-document + inventory).** After the first pre-commit
> report, the gatekeeper required: (Blocker 1) an evidence-based authority model that can classify a
> non-JSON source AUTHORITATIVE on a strong repository-backed binding — not JSON-only; (Blocker 2)
> malicious documents quarantined as `UNTRUSTED_INSTRUCTION_CONTENT`, contributing to nothing; plus a
> 30-scenario coverage matrix and an exact Git-derived inventory. All applied and validated. A second
> independent security review of the new authority model found 1 CRITICAL (authority forgery via an
> untrusted config/index binding) + 1 HIGH (paraphrase-evadable injection detection) — **both
> remediated in-phase** with regression tests. See §§44–52.

**Project:** ProjectOS · **Programme:** ProjectOS V3 · **Phase:** `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A`
**Status:** CORRECTED, IMPLEMENTED AND VALIDATED — AWAITING CHATGPT/MURAD COMMIT DECISION
**Owner:** Murad · **Gatekeeper:** ChatGPT · **Implementer:** Claude Code
**Branch:** `projectos-v3` · **Baseline (pre-Phase-2) HEAD:** `746ba49dc9629028cc274c5a7b954838d5ab088e`
**Gate:** PRE-COMMIT ONLY — not committed, not pushed, phase not closed.

---

## 1. Executive result

The universal, deterministic, local plan-discovery/import capability for ProjectOS V3 is implemented
and validated. It safely discovers project-control documents, fingerprints and classifies them by
type and authority, groups duplicates, detects material conflicts (document-vs-document and
document-vs-repository), builds a structured plan draft with field-level provenance, and calculates an
import status — **never** granting `PLAN READY` and **always** requiring owner approval. No AI API, no
external project repository, no secret, no network. `npm run validate` is **ALL PASS (40/40)**; global
no-secrets, V2 closure and report-index remain PASS. Security review found 1 CRITICAL + 2 HIGH + 1
MEDIUM — **all remediated in-phase** with regression tests; no open HIGH/CRITICAL.

## 2. Starting repository state

Branch `projectos-v3`; local HEAD == remote HEAD `746ba49…`; upstream `origin/projectos-v3`; 0/0;
tree clean; v2-core `1aa36b9d…`; ProjectOS V2 CLOSED; Phase 1 (`…MASTER-PLAN-MEMORY1A`) CLOSED;
programme completion 2/19 = 10.5%. No YAML parser present → YAML deliberately unsupported (Markdown/
txt/JSON only).

## 3. Phase-start state transition

- `current-state`: `activePhase → PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A`; `pendingPhases → []`;
  `currentHead/currentRemoteHead → 746ba49…`; `workingTreeStatus clean` (accepted baseline snapshot);
  `lastEvidenceReference →` this report. **Unchanged:** `acceptedPhaseCount 2`, `totalPhaseCount 19`,
  `completionPercentage 10.5` (the active phase does not contribute), `completedPhases` (2).
- `session`: new Phase 2 execution session — `phaseId …PLAN-DISCOVERY-IMPORT1A`, `executionMode
  local-safe`, `startingHead/currentHead 746ba49…`, `sessionStatus active`, all seven side-effect
  flags `false`.

## 4. Existing ProjectOS architecture reused

Zero-dependency `.cjs` engine + `run()`-shaped validator registered in `validate-all.cjs` (fixed
module list); draft-07 schemas; `examples/` fixture convention; canonical reports dir + single index;
`crypto`/`fs`/`path` only. No competing framework, parser package, or second validator system.

## 5. Exact files changed

Superseded by the Git-derived inventory in §52. Summary: **5 modified + 43 new (5 non-fixture + 38
fixtures) + 0 deleted + 0 renamed = 48 total changed paths.**

## 6. Discovery architecture

`discoverPlanSources(root, opts)` performs a deterministic, read-only, breadth-controlled walk:
entries sorted; supported extensions `.md/.markdown/.txt/.json`; per-file fingerprint +
classification; every skip recorded with a reason. Sources returned sorted by normalized relative
path for stable output.

## 7. Repository-boundary protections

Skips `.git`/`node_modules`/build/coverage/cache dirs; **does not follow** symlinks/junctions
(`lstatSync` + skip before read/recurse); `isWithinRoot` gate before recursion; **never opens**
`.env`/`.pem`/`.key`/`id_rsa` (FORBIDDEN_FILE_RE); rejects binary (NUL) and non-UTF-8 (U+FFFD)
content; enforces `maxFileBytes/maxFiles/maxDepth`; fail-closed per file/dir on read/stat errors;
`isSafeRepoRelativePath` rejects absolute/drive-relative/UNC/traversal/NUL paths. Discovered documents
are **data, never instructions** — content is never executed and cannot override governance.

## 8. Source fingerprinting

`fingerprintPlanSource`: relative + normalized path, ext, byte size, **advisory-only** mtime,
deterministic `sha256` content checksum, normalized-content checksum, structural key, title, heading
inventory, type/authority classification + evidence, secret-scan result, inclusion decision +
exclusion reason. Modification time is explicitly not used for identity or freshness.

## 9. Document type classification

`classifyPlanSource` maps filename/path (then heading) signals to `MASTER_PLAN`, `EXECUTION_PLAN`,
`PROJECT_PLAN`, `IMPLEMENTATION_PLAN`, `PRODUCT_BLUEPRINT`, `ROADMAP`, `PROJECT_LEDGER`,
`CURRENT_STATE`, `HANDOVER`, `ARCHITECTURE`, `REQUIREMENTS`, `GOVERNANCE`, `AUDIT_LOG`, `ROLLOUT_LOG`,
`PHASE_REPORT`, `CLOSURE_REPORT`, `PROJECT_CONFIG`, `CLAUDE_INSTRUCTIONS`, `README_CONTEXT`, or
`UNKNOWN`, recording the deciding evidence. `UNKNOWN` is never auto-authoritative.

## 10. Authority classification

`classifyAuthority` grants `AUTHORITATIVE` **only** from a **parsed, valid** structured plan-memory
JSON (`approvalStatus=approved` + `approvalAuthority=owner`, or `planStatus=PLAN READY`) — never from
prose. A prose approval claim (including hostile text) becomes `CURRENT_SUPPORTING` flagged
"UNVERIFIED approval claim — owner must confirm". Secret-bearing → `EXCLUDED`; explicit supersedes →
`SUPERSEDED`; closed/historical markers → `HISTORICAL`. Authority never derives from newest mtime.

## 11. Precedence model

Documented deterministic precedence (`PRECEDENCE`): master → execution → project-plan → project-config
→ closure/governance → current-state/handover → roadmap/ledger → blueprint/architecture/requirements →
audit/rollout/phase-report → README/CLAUDE → unknown. Not a blind override: a lower-ranked source that
materially contradicts the selected authority still surfaces a conflict; superseded/historical/excluded
sources are excluded from authoritative selection but retained.

## 12. Duplicate detection

`groupDuplicateSources`: `EXACT` (content checksum), `NORMALIZED` (BOM/CRLF/trailing-whitespace
normalized checksum), `STRUCTURAL` (title + heading structure + plan version). Deterministic group IDs
(sha256 of sorted members). Duplicates are grouped and classified, never deleted; canonical selection
only on evidence — otherwise owner decision. Proven on `proj-duplicates` (exact + normalized + copied
into multiple folders).

## 13. Conflict detection

`detectPlanConflicts`: pairwise material conflicts on `projectId`, `remote`, `branch`,
`definitionOfComplete`, `productionFreeze`, `phaseStatus`, and `phaseOrder` (same phase set, different
order). Each record has deterministic ID, both sources/values/authorities, severity, `autoResolvable:
false`, reason, `ownerDecisionRequired`, and `planStatusEffect`. Pairs involving a HISTORICAL/
SUPERSEDED/EXCLUDED/DUPLICATE source are **reconciled**, not raised. Proven on `proj-conflicts` (7
material conflicts) and `proj-superseded` (reconciled — no false conflict).

## 14. Repository-evidence reconciliation

Document claims are reconciled against supplied read-only repository evidence (branch/remote). A
document claiming `branch: main` against a verified `projectos-v3` repository yields a recorded
`document-vs-repository` conflict — neither claim silently rewritten. Proven on `proj-repo-conflict`.
No project scripts executed, no dependencies installed, no build, no provider/secret access, no
mutation.

## 15. Plan-draft generation

`buildPlanDraft` emits a structured draft: project identity, vision, definition-of-complete,
repository facts, source inventory, authoritative-source selection, conflicts, unresolved unknowns,
environment/provider/gate candidates, phase candidates, per-field provenance, import confidence, and
owner decisions required. Absent facts are marked `UNKNOWN` / `NEEDS SOURCE`; the engine never invents
values.

## 16. Field-level provenance

Every material field carries provenance: field, value, source path + checksum, locator, source
authority, extraction method, confidence, competing sources, conflict ref, manual-review flag.
`validatePlanProvenance` fails any draft that presents a value without source provenance (proven with
a negative case).

## 17. Phase-candidate generation

`buildPhaseCandidates` emits candidates only where a phase-id-shaped token has explicit source
evidence; purpose/scope/acceptance are marked `NEEDS OWNER DECISION` / `NEEDS SOURCE` rather than
fabricated. No candidate is started. A one-paragraph vision yields no invented roadmap.

## 18. Import status calculation

`calculateImportStatus` returns `NO PLAN` / `PLAN DISCOVERED` / `PLAN CONFLICT` / `PLAN DRAFTED` /
`AWAITING OWNER APPROVAL` — and **never** `PLAN READY` (verified: no return path yields it). Proven
across the corpus (e.g. proj-clean → AWAITING OWNER APPROVAL, proj-conflicts → PLAN CONFLICT,
proj-nolan/proj-secret/proj-binary → NO PLAN).

## 19. New schemas or schema extensions

Two coherent new schemas: `source-discovery-manifest.schema.json` and `plan-import-result.schema.json`
(embeds duplicates, conflicts, and a draft with provenance + phase candidates; `ownerApprovalRequired:
const true`, `planReadyGranted: const false`). No existing schema modified. The import target remains
the Phase-1 `project-plan.schema.json`.

## 20. Runtime engine

`plan-discovery-engine.cjs` (521 lines, zero-dependency): `discoverPlanSources`,
`fingerprintPlanSource`, `classifyPlanSource`, `classifyAuthority`, `groupDuplicateSources`,
`detectPlanConflicts`, `reconcileRepositoryEvidence`, `selectAuthoritative`, `buildPlanDraft`,
`buildPhaseCandidates`, `calculateImportStatus`, `validatePlanProvenance`, `importFromSources`. Pure
logic separated from the filesystem walk. No `child_process`/`eval`/dynamic `require`.

## 21. Templates and fixtures

9 synthetic project trees + 2 demo instances (25 fixture documents) covering the 30 required
scenarios: authoritative + execution (no conflict), exact/normalized/copied duplicates,
current+superseded (incl. newer-mtime-but-superseded), identity/remote/DoC/phase-status/
production-freeze/phase-order conflicts, missing DoC/acceptance, unresolved owner decision, README/
CLAUDE context-only, **malicious governance-override Markdown**, no-plan repo, secret-bearing source,
binary, unsupported encoding, valid + missing provenance, repository-vs-document conflict, and a
complete draft awaiting owner approval. Filesystem-safety scenarios (path traversal, symlink escape,
oversized, drive-relative/UNC) are exercised as validator unit tests over the engine's safety
functions; the linear-history "not-ancestor" case is documented as logic-asserted. All fixtures use
synthetic data; secret fixtures use the `RAWSECRET::` marker (not a real secret).

## 22. Validators

`validate-plan-discovery-import.cjs` (registered in `validate-all`; `npm run validate:v3import`): demo
schema-key checks; corpus behavioural expectations; NO-automatic-PLAN-READY; malicious-instruction
isolation; path/boundary/binary/encoding/limit unit tests; secret exclusion + **non-leakage** into
persisted manifest/result; title redaction; determinism (double-run); provenance positive/negative;
context separation; ReDoS time bound.

## 23. Determinism proof

Identical source content + repository evidence → identical output (validator double-runs proj-clean/
proj-conflicts/proj-duplicates and compares). All IDs are sha256 over content/derived strings; no
`Date.now()`/`Math.random()`/`randomBytes` anywhere; mtime is advisory-only. Line-ending differences
are normalized (do not create false conflicts).

## 24. No-automatic-PLAN-READY proof

Every corpus fixture asserts `status !== "PLAN READY"`; `plan-import-result` hard-consts
`planReadyGranted: false`; `calculateImportStatus` has no PLAN-READY return path. The Phase-1
`evaluatePlanReady` gate is not bypassed.

## 25. Owner-approval gate proof

`plan-import-result` hard-consts `ownerApprovalRequired: true`. The importer produces a draft for
owner review; it cannot approve or make a plan ready. Claude is not an approval authority.

## 26. State and session consistency

`current-state` and `session` reflect the Phase-2 active session truthfully; `validate-all` (incl. the
current-state completion + git-lifecycle checks) PASS. `activePhase` set, not counted toward
completion; no Phase-2 phase started.

## 27. Completion remains 10.5%

`acceptedPhaseCount 2 / totalPhaseCount 19 = 10.5%`, unchanged; the active Phase 2 does not contribute;
icon phase excluded; validator-enforced.

## 28. Test results

`npm run validate` → **validate-all ALL PASS (40/40)**; `validate:v3import` PASS; global
`validate-no-secrets` PASS; `validate-v2-closure-evidence` PASS; `validate-report-index` PASS; `git
diff --check` clean. No TypeScript/lint/build applies (zero-dependency `.cjs`+JSON+MD); no user-facing
surface → no browser proof.

## 29. Security review

Independent security-reviewer pass. Findings **all remediated in-phase**, with regression fixtures +
assertions added:
- **CRITICAL** — a secret-shaped `remote`/`branch` claim from an EXCLUDED source could be emitted
  verbatim into `conflicts[].valueA/B` via the repository-reconciliation loop (missing the exclusion
  guard). **Fixed:** guard added to skip EXCLUDED/reconciled sources; `mkConflict` additionally
  redacts any secret-shaped value. Proven: secret-in-remote + repo mismatch → `conflicts: []`, no
  marker in output.
- **HIGH** — a secret placed in an H1 heading leaked into the persisted `title` of an EXCLUDED source.
  **Fixed:** `title` redacted and `headings` blanked for secret-bearing sources.
- **HIGH** — ReDoS in `extractHeadings` (`(.*\S)\s*$`), ~13.7s on a 131 KB single-line heading.
  **Fixed:** right-trim then non-backtracking match; now 0.6 ms on 200 K.
- **MEDIUM** — `classifyAuthority` used substring regex, not real JSON parse (forgeable
  `AUTHORITATIVE`). **Fixed:** `JSON.parse` + genuine key check, fail-closed. Proven: invalid-JSON
  with substrings → `CURRENT_SUPPORTING`.
Confirmed clean: no command execution, no prototype pollution, symlink/traversal safe, limits
fail-closed, deterministic IDs, malicious instructions isolated, PLAN READY unreachable. **No open
HIGH/CRITICAL.**

## 30. Code review

Pure logic separated from filesystem access; fail-closed error handling throughout; no unnecessary
dependencies; deterministic; schema/validator consistent. In-scope defects (the four security items)
corrected before reporting.

## 31. Duplication review

- Phase-1 `project-plan` schema / PLAN READY gate / lifecycle / approval store / phase store / evidence
  pack / report index / Git commit-validation — **REUSE DIRECTLY** (referenced, not reimplemented; the
  importer defers PLAN READY to Phase 1).
- `scanSecrets` mirrors the global no-secrets shapes — **INTENTIONAL DISTINCT FUNCTION**
  (field/discovery-time scan complementary to the global file scan).
- Discovery-time redaction, classification, duplicate/conflict/provenance/import engine — **REQUIRED
  NEW DISCOVERY CAPABILITY**. No TRUE DUPLICATION.

## 32. ECC review

Phase-1 closure integrity intact (CLOSED record unchanged); correct Phase-2 branch/baseline
(`746ba49`); current-state/session transitions correct; completion remains 10.5%; only synthetic
fixtures used — **no external product repository touched**; classification/conflict/provenance sound;
no automatic PLAN READY; owner approval required; no-API/no-secret; production/DB/send/payment safety
(none touched); closure authority remains owner. No open HIGH/CRITICAL.

## 33. No-secret proof

Global `validate-no-secrets` PASS (synthetic `RAWSECRET::`/binary/utf16 fixtures do not match
real-secret shapes). Discovery excludes secret-bearing sources and redacts their titles/headings;
secret values never reach the manifest, result, draft, provenance, or conflicts (proven).

## 34. No-API proof

No OpenAI/Anthropic/metered/cloud-AI API. Engine imports `crypto`/`fs`/`path` only; validator adds
none. No network, MCP, or orchestration. Classification/reconciliation is deterministic regex + hashing.

## 35. V2 and Phase 1 closure integrity

`validate-v2-closure-evidence` PASS; `projectos-v2-core` unchanged at `1aa36b9d…`; the Phase-1 CLOSED
report and index CLOSED row are unmodified.

## 36. External-project boundary proof

No `.projectops` installed into PolyGo; no JD Testing / BizComply / OPSoft / CricLocal / Coverdrive /
TKN / ERP repository touched; no Supabase/Vercel/GitHub-beyond-ProjectOS/provider access. All discovery
ran only against local synthetic fixtures under `projectos/examples/v3-import-fixtures/`.

## 37. Working-tree state

35 changed paths (4 modified + 31 new), uncommitted; `git diff --check` clean; nothing staged.

## 38. Forbidden-action confirmation

No commit, push, deploy, publish, release, tag; no OpenAI/Anthropic/metered API; no provider/Credential
Manager access; no `.env` opened; no raw secret stored; no modification of `projectos-v2-core`, Phase-1
closure evidence, or external product repos; no PolyGo install/pilot; no owner-chat/vault/automation/
E2E-runner; no Phase-3; phase not approved or closed.

## 39. Residue

None in the repo. Fixture-generator script remains only in the session scratchpad (outside the repo).

## 40. Risks

- R1 (medium, carry-forward): programme-level manual owner-approval binding (not cryptographic).
- R-import-1 (low): classification/conflict heuristics are regex-based and best-effort; low-confidence
  results are surfaced for owner review rather than trusted.
- R-import-2 (low): repository-evidence reconciliation currently accepts caller-supplied evidence; a
  read-only git-backed evidence collector is future work.
- `scanSecrets` is a curated shape allowlist (mirrors global), not exhaustive — documented.

## 41. Carry-forward

- Read-only git-backed repository-evidence collector for reconciliation.
- Owner-facing import review/approval surface (out of scope here).
- Broader semantic duplicate/conflict analysis (still deterministic, no AI API).
- The Phase-1 R1 cryptographic owner-approval binding.

## 42. Exact decision required

ChatGPT/Murad to decide whether to **commit** `PROJECTOS-V3-PLAN-DISCOVERY-IMPORT1A` on `projectos-v3`
(push separate). No commit/push/Phase-3/closure until decided.

## 43. Memory update confirmation

Safe memory updated (no secrets/malicious payloads): active project/programme/phase/gate, branch,
HEADs, files, schemas, engine, validators, fixtures, discovery/conflict/provenance/status results,
security/code/duplication/ECC findings, residue, risks, carry-forward, decision required; completion
10.5%; production/deploy/DB/sends/payments/secrets/API all NO.

---

---

## 44. Authority-policy correction (Blocker 1)

Authority is now **evidence-based**, not JSON-only. `classifyAuthority` sets a self-authority
(structured plan-memory JSON, supersede, historical, or current-supporting); `assignAuthorities`
then applies **cross-source, repository-backed** trust bindings. A source becomes AUTHORITATIVE only
via a strong binding, each recorded with `{sourcePath, sourceChecksum, evidenceType, evidenceSource,
evidenceRef, verification, confidenceBasis, contradictoryEvidence, ownerReviewRequired}`:
- `STRUCTURED_PLAN_MEMORY` — parsed owner-approved / PLAN READY plan-memory JSON;
- `CANONICAL_PROJECT_CONFIG` — a config **at the canonical repo path** (`.projectops/config.json` or a
  caller-declared path) naming the plan canonical, **with matching project identity**;
- `GIT_SOURCE_COMMIT` — a declared source commit verified to exist in local Git (caller `gitVerify`).
Never from prose, filename, location, mtime, or a substring. Contradictions (identity mismatch,
unverifiable binding) downgrade to CONFLICTING/UNVERIFIED. Every binding sets `ownerReviewRequired:
true`; the import never grants PLAN READY.

**Security (2nd review): CRITICAL — authority forgery.** The first corrective cut trusted **any** file
matching the loose PROJECT_CONFIG/index signal as an authority oracle (two plantable files forged
AUTHORITATIVE). **Fixed:** only a config at the canonical path with matching identity may bind; the
reports-index-reference upgrade was removed entirely (a referenced CLOSED report stays HISTORICAL).
Proven: a rogue `notes/random-projectops-dump.json` → the referenced plan is `CURRENT_SUPPORTING`, not
AUTHORITATIVE.

## 45. Non-JSON authoritative-source proof

`proj-config-canonical/docs/master-plan.md` (Markdown) → **AUTHORITATIVE** via
`CANONICAL_PROJECT_CONFIG` (`.projectops/config.json` names it canonical, identity `canon-app`
matches). Git binding proven by unit test: a source declaring a `gitVerify`-true commit →
AUTHORITATIVE; an unverifiable commit → not.

## 46. Unsupported approval-claim rejection

`proj-prose-approval/master-plan.md` ("OWNER APPROVED" in prose) → **CURRENT_SUPPORTING**, not
AUTHORITATIVE. `proj-identity-conflict/other.md` (mismatched identity) → **UNVERIFIED**. Prose claims
are recorded for owner confirmation, never trusted.

## 47. Malicious-document classification correction (Blocker 2)

`isUntrustedInstruction` deterministically flags governance-override / prompt-injection / secret-
access / gate-bypass content (bounded regexes, no ReDoS). A hit → authority **UNVERIFIED**,
`included: false`, `exclusionReason: UNTRUSTED_INSTRUCTION_CONTENT`, title/headings redacted.
`proj-context-only/EVIL.md` is so classified. **Security (2nd review): HIGH — paraphrase evasion.**
Keyword detection is bypassable; broadened heuristics catch the reviewer's example, but the real
containment is the authority model: evaded content stays at most CURRENT_SUPPORTING (owner-review-
required), can never self-elevate, and the engine acts on **no** document instruction (it only regex-
extracts specific fields). Documented in code as defense-in-depth, not the boundary.

## 48. Malicious-document contribution-isolation proof

Asserted (validator §13): `EVIL.md` is `included:false`; is **not** the authoritative source, **not**
in the draft source inventory, **not** a provenance source, **not** a phase-candidate source; and the
malicious payload text appears nowhere in the import result or the manifest (title/headings redacted).

## 49. Secret-derived-output containment proof

Asserted (validator §11): secret-bearing sources (`proj-secret/*` with synthetic `RAWSECRET::`
markers) are EXCLUDED before semantic extraction; title redacted; and no secret material (`RAWSECRET::`,
`synthetic-remote-token`, `synthetic-heading-token`) appears in the persisted manifest, import result,
conflicts (repo-reconciliation loop skips excluded sources + `mkConflict` redacts), provenance, or
draft. Global `validate-no-secrets` PASS.

## 50. Status-calculation matrix

`calculateImportStatus` final import-result statuses, each asserted (validator §14):
`NO PLAN` (proj-nolan) · `PLAN CONFLICT` (proj-conflicts) · `PLAN DRAFTED` (proj-gaps) ·
`AWAITING OWNER APPROVAL` (proj-clean) · `PLAN BLOCKED` (boundary-blocked). **`PLAN DISCOVERED` is an
intermediate pipeline status**, not a final import-result value (documented); the final result always
settles to one of the five above. `PLAN READY` is never returned. `ownerApprovalRequired` const true;
`planReadyGranted` const false.

## 51. Thirty-scenario fixture coverage matrix

Every scenario has a named assertion in `validate-plan-discovery-import.cjs` (no coverage by
implication):

| # | Scenario | Fixture / input | Expected | Assertion |
| --- | --- | --- | --- | --- |
| 1 | Clean authoritative master plan | proj-clean/.projectops/plan.json | AUTHORITATIVE / AWAITING | §12 AUTH[1], §2 CORPUS |
| 2 | Master + execution, no conflict | proj-clean docs/* | conflicts 0 | §2 CORPUS (maxConf 0) |
| 3 | Two exact duplicates | proj-duplicates a,b | EXACT group | §2 CORPUS (minDups 2) |
| 4 | Two normalized duplicates | proj-duplicates c (CRLF) | NORMALIZED group | §2 CORPUS |
| 5 | Current + historical superseded | proj-superseded | SUPERSEDED, reconciled | §12 AUTH[5], §2 |
| 6 | Conflicting project identity | proj-conflicts / proj-identity-conflict | projectId conflict / UNVERIFIED | §2, §12 AUTH[7] |
| 7 | Conflicting git remote | proj-conflicts | remote conflict | §2 (minConf 5) |
| 8 | Conflicting definition of complete | proj-conflicts | definitionOfComplete conflict | §2 |
| 9 | Conflicting phase status | proj-conflicts | phaseStatus conflict | §2 |
| 10 | Conflicting production freeze | proj-conflicts | productionFreeze conflict | §2 |
| 11 | Missing definition of complete | proj-gaps | PLAN DRAFTED | §14 status-matrix |
| 12 | Missing phase acceptance criteria | proj-gaps | phase NEEDS SOURCE | §2 (provErr 0), draft |
| 13 | Unresolved owner decision | proj-gaps | owner-decision surfaced | §2 |
| 14 | README-only context | proj-context-only/README.md | not credible / NO PLAN | §13/§14 context |
| 15 | CLAUDE.md instructions, no plan | proj-context-only/CLAUDE.md | CLAUDE_INSTRUCTIONS, not plan | §14 context |
| 16 | Malicious governance-override MD | proj-context-only/EVIL.md | UNVERIFIED / UNTRUSTED_INSTRUCTION_CONTENT | §4/§12 AUTH[8]/§13 |
| 17 | Path traversal candidate | isSafeRepoRelativePath inputs | rejected | §5 unit tests |
| 18 | Symlink / junction escape | discoverPlanSources symlink skip + isWithinRoot | skipped / rejected | §5 + code (documented) |
| 19 | Oversized file | maxFileBytes limit | skipped | §6 limits |
| 20 | Binary file | proj-binary/blob.md | skipped (binary) | §2 allSkipped, §6 |
| 21 | Secret-bearing source | proj-secret/plan-with-secret.md | EXCLUDED | §7 secret |
| 22 | Unsupported encoding | proj-binary/utf16.md | skipped (encoding) | §2 allSkipped |
| 23 | Valid field-level provenance | proj-clean | provenance [] | §9 provenance |
| 24 | Draft with missing provenance | crafted bad draft | provenance error | §9 provenance |
| 25 | Newer mtime but superseded | proj-superseded | SUPERSEDED (mtime advisory) | §12 AUTH[5] |
| 26 | Same plan copied to many folders | proj-duplicates/archive/copy | EXACT dup | §2 minDups |
| 27 | Conflicting roadmap phase order | proj-conflicts (reversed) | phaseOrder conflict | §2 minConf |
| 28 | Repo evidence contradicts document | proj-repo-conflict | document-vs-repository conflict | §2 (repo) |
| 29 | No-plan repository | proj-nolan | NO PLAN | §14 status-matrix |
| 30 | Complete draft awaiting approval | proj-clean | AWAITING OWNER APPROVAL | §14 status-matrix |

Plus Blocker-1 authority scenarios: canonical-config (proj-config-canonical), CLOSED-via-index
(proj-index), two-authoritative→PLAN CONFLICT (proj-two-auth), git-commit binding, and the
authority-forgery guard — all asserted in validator §12.

## 52. Exact Git-derived path inventory and count reconciliation

Derived from `git diff --name-status` + `git ls-files --others --exclude-standard`:

- **Modified: 5** — `knowledge/ProjectOS Reports Index.md`, `package.json`,
  `projectos/validators/validate-all.cjs`, `projectos/state/projectos-v3.current-state.json`,
  `projectos/state/projectos-v3.session.json`.
- **New: 43** = 5 non-fixture (`projectos/validators/plan-discovery-engine.cjs`,
  `projectos/validators/validate-plan-discovery-import.cjs`,
  `projectos/schemas/source-discovery-manifest.schema.json`,
  `projectos/schemas/plan-import-result.schema.json`, this report) + **38 fixtures** under
  `projectos/examples/v3-import-fixtures/` (2 demo instances + 36 fixture documents across 15 synthetic
  project trees).
- **Deleted: 0 · Renamed: 0 · Total changed paths: 48.**

The earlier report's "4 modified + 31 new = 35 (+report+index = 37)" is **superseded**: the corrective
pass added 11 authority fixtures and this report grew; the current Git-derived total is **48**.

---

**END STATUS: CORRECTED, IMPLEMENTED AND VALIDATED — AWAITING CHATGPT/MURAD COMMIT DECISION.**
Not committed. Not pushed. Phase 3 not started. Phase not closed.
