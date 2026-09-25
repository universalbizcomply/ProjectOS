# PROJECTOS-HOST-REVIEW-PATH1B — PRE-PUSH / PRE-CLOSURE EVIDENCE PACK

Written for: ChatGPT (independent technical gatekeeper), relayed by Murad.

- Project: ProjectOS · Programme: projectos-autonomous-self-hosting · Plan v1.6 (`plan-01053932764c573b-68d21d6830c1`)
- Phase: PROJECTOS-HOST-REVIEW-PATH1B (31 frozen criteria, 13 owner gates)
- Status: IMPLEMENTED + VALIDATED + REVIEWED · PRE-PUSH / PRE-CLOSURE · AWAITING GATEKEEPER REVIEW
- Branch: `projectos-run-to-completion-host-attestation1a` · Baseline: `87f734e9…73fb` (= remote)
- Candidate: the cumulative range `87f734e..b70c5296e61cb7cb6b34c3ff6cd947f424b0a8e4` - `1a4e56e` (the candidate) + `b70c529` (ONE additive correction from the reviews). Nothing pushed; working tree clean.
- Worktree: `C:\dev\ProjectOS-worktrees\host-review-path1b`

## Scope delivered (per unit — full detail in PATH1B-PROGRESS.md)
G/R/E/B/A/T/C + gatekeeper-ruling rework (B'/E'/P/D/M/S) + W1/W2 + Route A + G1–G5 + §10 composition
(all recorded in prior sessions), and this session:
- §8 safe.directory bounds: +2 crate tests, battery 16/16.
- §10 unattended rev-1 refusal: already proven (core vectors test + agent client matrix) — verified, no change.
- UNIT L (criteria 12–13): bounded local candidate commit (`localCandidateCommit.ts`), plumbing-only closed
  verb set, scratch index, CAS fast-forward, hook/config isolation with LIVE-CONTROL proofs (18/18);
  every agent git call now resolves hooks beneath the null device; unattended review subject = the local
  candidate; approved `commit` satisfied by the reviewed candidate; corrections additive.
- UNIT V: `val-projectos-technical-continuation1a` §16 (19/19 mutations), `val-projectos-host-review-path1a`
  P10 framed-evidence (14/14), `candidateBoundary1a` pin amendment.
- service-host: per-exchange admission store (latent 2nd-connection refusal fixed), 29/29.

## Decision needed
1. APPROVED TO PUSH (or corrections) for the candidate.
2. Ratification at this gate of the declared amendments (owner gates 2–10) including the two
   suite amendments below and the candidateBoundary1a signature pin.
3. Ruling on the C21 gap (below): accept as the named next phase, or direct otherwise.
4. The elevated real-pipe proof is an OWNER RUN (criterion 24): schedule with Murad.
5. **F2 (AppSec, HIGH class, PRE-EXISTING surface):** `git push` publishes every commit in the pushed range, and the reviewed object is the ratified ENDPOINT diff — so bytes added-and-removed in intermediate commits are published unreviewed. This property predates PATH1B (the accepted continuation executor has always pushed ranges); PATH1B enlarges the surface by adding local candidate commits. Closing it amends ratified semantics (per-commit containment breaks the additive-correction design; squash-at-push contradicts "no history rewrite"). RECOMMENDATION: rule now that a follow-up amendment gates push on intermediate-blob containment relative to BOTH endpoints of the pushed range (remote tip and HEAD), or name the alternative; PATH1B carries it disclosed either way.

## Judgement calls and disclosures (flagged, not hidden)
- C21 NOT MET, corrected out loud: the service-entry activation resolver cannot be written without three
  authority decisions (delegation verification outside windows-local-ipc; the delegation `Active` lifecycle
  writer; Host-side plan ingestion) — table in `docs/speed/host-review-path1b-production-ports.md`
  ("CORRECTION"). The dormant route stays dormant; every other criterion-18 port is source-complete.
- C14 vs C12: `hybridVerticalSlice.test.ts` — two UNATTENDED assertions amended (`unchanged` →
  `recordedLocallyNotPublished`); the ratified continuation amendment makes the old invariant false on that
  route. Interactive assertions byte-identical. `hostReviewPath.e2e.test.ts` (a PATH1B file) re-pinned to
  the local-candidate subject.
- Hooks behaviour change: no ProjectOS git call runs a checkout hook any more (HOOKS_OFF_ENV). Live
  controls proved plain `git status`/`add` previously ran `post-index-change` from `.git/hooks`, a repo
  `core.hooksPath` AND user config — and the continuation commit/push ran pre/post-commit/pre-push.
- PATH1A stood down `implementing → rolled_back → draft`; `val-projectos-v3-active-phase-consistency1a`
  fails on the two-in-flight record. Owner's to resolve (plan text: 1A closes only after 1B, same candidate).
- safe.directory names the proven root (Host reads a repo it does not own by design) — now mutation-bounded.
- Baseline in the definition digest as optional 20th field; digest V2 labels; V1 bytes unchanged.
- Admitted cost ≠ provider cost everywhere; canonical ledger field name carries the ledger's own vocabulary
  (no admitted/accounted distinction) — carry-forward.
- `filter.*` neutralisation covers configured drivers; git BUILT-IN content handling still applies to the
  local candidate (recorded = what an ordinary commit would record).

## Validators / tests
- validate-all (serialized, re-run after the correction): 141/144 PASS. The 3 FAILs are the accepted set: `validate-desktop-e2e` (environmental: no built Control Centre bundle), `val-cd-b4-sealed-expected-window-facts1a` (pre-existing at the baseline, proven in a throwaway worktree), `val-projectos-v3-active-phase-consistency1a` (the disclosed PATH1A stand-down).
- Rust: core 111/114, host-authority 45+11+7, identity-proof 140/144+5+1, ipc 360+11+6+39 (fixtures) /
  231+… (live) / 375 combined, attestation 71+9, composition 7+5+4+8+7+2, repository 30+6+21+1,
  host-identity 158, generator 36, plan-durable-store 31, service-host 29, windows-clock 1,
  runtime-observation 1/5. All green.
- TS: core 765/765 · agent 2176 (2175 pass; 1 environmental: `checkEnvironmentGitRuntime` NEGATIVE — bound
  git is `Git\cmd\git.exe` here; proven not a PATH1B change) · typecheck:all clean.
- Mutation batteries (all serial, all restored byte-for-byte): selection 16/16 · repo validator 32/32 ·
  repo behavioural 16/16 · O6h 11/11 · dual-finalisation 19/19 · digest V2 23/23 · path1b validator 30/30 ·
  windows-boundary 6/6 · technical-continuation §16 19/19 · framed-evidence P10 14/14.
- Cross-language vectors: one committed file, real Rust Host run ↔ real TS; broker diff 0 lines.

## Reviews
- Claude self-review: DONE — 2 MEDIUM observations, both accepted: (a) after the pre-review local commit the in-evidence `candidate` JSON is empty (the tree is clean); honest, and the Host-established frame carries the real diff — noted, no change; (b) filter-driver neutralisation rests on empty-string semantics of the installed git, proven by the live-control test on every run.
- ECC CODE: **APPROVE** (0 CRITICAL / 0 HIGH / 1 MEDIUM / 2 LOW). MEDIUM (symlink-swap TOCTOU window in the local candidate commit) FIXED post-review: type re-judged on the far side of the store, plus a dangling-symlink "deleted" guard (both in the additive commit). LOW #2 (TS 40-hex vs Rust 40/64) = the ratified SHA-1-only contract, now stated in a comment.
- ECC SECURITY: **WARN** → resolved. The one HIGH (the agent's independent evidence reader inherited the ambient environment — GIT_DIR/GIT_CONFIG_* could repoint the reading) FIXED in the additive commit: allowlist env, null-device config, hook closure; proven by a live-control test (plain git follows a planted GIT_DIR; the production source does not). Everything else it checked it reported VERIFIED sound (marker, SID equality, TOCTOU on Host files, rev-1 downgrade, fixture-surface gating, safe.directory).
- AppSec recheck (application-security-engineer, AMBER + guardrail): **WARN** → F1 resolved, F2 escalated. F1 (evidence contents never verified against their git object id; `cat-file` serves substituted bytes — premise PROVEN live by Claude in a scratch repo) FIXED in the additive commit on BOTH sides (Rust composition port + TS agent reader; RustCrypto `sha1` 0.10 added to the composition crate — same maintainer family as the sha2 already in the tree), each with a live-control proof; the fix immediately caught the CONTRACT VECTOR carrying a synthetic object id, and the vectors were regenerated honest (evidence digest `ec16562a…845b`, pinned independently in Rust + TS + Python). F3 = the ECC SECURITY HIGH, fixed. F4 (path charset narrower at review than at commit) FIXED at commit time. F5/F6 LOW carry-forward. **F2 → DECISION ITEM below.**

## Boundary statement
Production touched: NO. External sends/payments: NO. Provider calls/spend: NO (broker stops at its
credential stage in the one authorised disposable-install proof). Credentials: none read. Service: never
started. ACL/registry: unchanged. Force push/merge/rebase/amend: none. Pushed: NOTHING.

## Residue / disk
Snapshots under `C:\dev\ProjectOS-candidate-backups\` (KEEP EVIDENCE). Stray untracked `Cargo.lock`s
(repository, plan-durable-store) deleted at freeze. Disk: 73+ GB free (GREEN).

## Risks / carry-forward
- MEDIUM: C21 resolver + 3 authority inputs → named next-phase work.
- MEDIUM: host-authority `test-fixtures` graph conflict (pre-existing at baseline, proven).
- LOW: `val-cd-b4-sealed-expected-window-facts1a` doctest false-positive (pre-existing at baseline).
- LOW: ledger admitted/accounted vocabulary; registry `ReplaceFileW` owner defect (mandatory before real
  registry publication — recorded).
- OWNER RUN: elevated real-pipe proof (criterion 24).

## Evidence digest
Progress log: `C:\dev\ProjectOS-candidate-backups\PATH1B-PROGRESS.md` (authoritative, per unit).
Port table + C21 correction: `docs/speed/host-review-path1b-production-ports.md`.
Candidate range: `git diff --stat 87f734e..b70c5296e61cb7cb6b34c3ff6cd947f424b0a8e4`.
