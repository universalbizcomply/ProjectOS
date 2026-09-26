# PROJECTOS-HOST-REVIEW-PATH1B — FINAL PRE-PUSH / PRE-CLOSURE EVIDENCE PACK

Written for: ChatGPT (independent technical gatekeeper), relayed by Murad.

**C21 PASS · C24 EXACT OWNER ACTION READY · F2 CLOSED · FINAL REVIEWS COMPLETE · 0 CRITICAL / 0 HIGH ·
PRE-PUSH · PRE-CLOSURE · AWAITING FINAL GATEKEEPER + OWNER RATIFICATION**

- Project: ProjectOS · Programme: projectos-autonomous-self-hosting · Plan v1.6 (`plan-01053932764c573b-68d21d6830c1`)
- Phase: PROJECTOS-HOST-REVIEW-PATH1B (31 frozen criteria, 13 owner gates)
- Branch: `projectos-run-to-completion-host-attestation1a` · Baseline B: `87f734e9f95ec9173074ebae693a06a2650473fb` (= remote tip)
- Worktree: `C:\dev\ProjectOS-worktrees\host-review-path1b` · tree CLEAN · NOTHING PUSHED

## Final D and the full ancestry (the exact reviewed push boundary)

**Final source D = `c30362e4bc318e773b37d83b0b2bb6892a8edc78`.** This docs commit is the only tail
after it. The exact ordered set a push would publish (`87f734e..HEAD`, first-parent linear, no merge,
no rewrite — 193 files, +33,047/−328 at final source D):

| # | commit | what |
|---|---|---|
| 1 | `1a4e56e` | the PATH1B candidate (Host frames the evidence; agent commits before it asks) |
| 2 | `b70c529` | review round 1 fixes (object-id verification both sides; isolated agent reader) |
| 3 | `06323cf` | the first gate pack (superseded by this file) |
| 4 | `84eb8ea` | **C21 + F2 closure** under the 2026-09-26 pre-push ruling (47 files, +3,459/−70) |
| 5 | `c30362e` | **final-review fix round** (fail-closed plan mirror / store load / null endpoints; 7 files, +82/−15) |
| 6 | (this file's commit) | docs tail — this pack; no source |

## C21 — PASS (proof)

Supplying the protected activation inputs and starting the service needs **no further production
source**. The three routes the ruling ordered, all inside PATH1B:

1. **Delegation verification outside the compose:** `verify_owner_programme_delegation_for_installation`
   (windows-local-ipc) — the same ONE O12-pinned verifier, sealed inputs composed internally, provenance
   before any durable read (SEC-L1, proven with a counting store). O12 unchanged: mint count and site identical.
2. **The Active lifecycle writer:** `activate_owner_programme_delegation` — authority is the two owner
   signatures alone (manifest + delegation); store lifecycle rules bound it; idempotent on Active;
   terminal states never resurrected (all live-proven in `service_entry_tests.rs`, 9/9, real durable store;
   the production entries refuse the fixture record).
3. **Host plan ingestion:** `CommittedPlanAuthority` — the COMMITTED `PlanRecordDto` at
   `.projectops/host-approved-plan.v2.json` of the pinned commit, re-normalised, digest recomputed, admitted
   only when it equals the DELEGATION-SIGNED `plan`/`plan_digest`/phase membership. No second plan system;
   `mirror_into` is the Host plan store's first production writer; divergence and unreadable copies refuse.
   Working-tree tamper proven unreachable (live test).

The service-entry resolver (`service-host/src/activation_resolver.rs`) reads every input from its fixed
durable location (no-follow, exact-length delegation read; payload from the running executable's verified
location; programme = the registered project whose committed closure attests to the delegation's signed
digests; per-exchange `pin_exchange` because local candidate commits move HEAD). The SCM entry calls ONE
dispatcher (`serve_resolved_until_stop`); dormancy — the status loop — is the fallback for every
`GovernedActivationUnavailable`. §10H holds: service-host names no root/acceptance/trusted-roots (the
ledger chain moved INTO the ipc activation module; the trusted-roots dependency was REMOVED).
Full input table: `docs/speed/host-review-path1b-production-ports.md` (FINAL STATUS section).

## F2 — CLOSED (proof)

The review evidence now binds the EXACT ordered B..D ancestry, inside the ONE attested digest:
- **Schema v2** (`CANDIDATE_EVIDENCE_SCHEMA = 2`, Rust + TS byte-identical canonical text): per commit —
  its identity, its parent (chain-linked from B to D, refusing gaps, reordering, substitution, stray tips,
  >128 steps), its own changed paths, and the VERBATIM bytes of any step result that does not survive to D
  (each verified against its git blob id before being trusted — the F1 defence extended to history).
- **One new read-only verb** `RevListLinear` (`rev-list --reverse --parents --end-of-options B..D`), strict
  parse; merges refuse unconditionally — including a merge whose second parent is already reachable from B,
  which only plumbing can construct (live `commit-tree` test).
- **Proofs A–G:** A (added-and-removed content stays in evidence) and B (a security flip-flop cannot
  disappear; substituted history object refuses) — real-repo composition tests. C/D (link matrix, vanished
  rules) — unit + reader matrices, Rust and TS. E (an extra commit between reviewed D and pushed D refuses)
  and G (remote at B + HEAD = D ⇒ publish set == exclusive B..D) — agent executor tests. F — the existing
  env/replace-object controls now cover every ancestry read.
- **Pins, three independent implementations (Rust, TS, Python):** unit canonical digest
  `9b928df73f9461668591886dbf910157e0281f58ed5fd05564f325f36119a0f7`; contract vector `003ef7c9…773b`.
- Host derives the ancestry itself from the pinned endpoints; the agent never authors it. No squash,
  rebase, amend, reset or rewrite anywhere on the route.

## C24 — EXACT OWNER ACTION READY

`docs/speed/host-review-path1b-c24-owner-run.md`: one elevated PowerShell, run-scoped random test pipe,
production endpoint unreachable by construction; no service start, no credential, no provider, no spend,
no ACL. Expected: `test result: ok. 2 passed` (or a reported `LEG: OS-REFUSED`, pasted verbatim).

## Final reviews — COMPLETE, 0 CRITICAL / 0 HIGH

Round 1 over `87f734e..84eb8ea`, delta round over `c30362e`; every reviewer read-only, tree + HEAD
verified untouched after each pass:

| reviewer | round 1 | findings → disposition | delta over c30362e |
|---|---|---|---|
| Claude self-review | — | plan-mirror fail-open (= AppSec F1); registry pre-scan note (LOW, bounded, refused at activation) | fixed in c30362e |
| ECC CODE | **APPROVE 0/0/0/0** | none | **APPROVE carries**; calls out the mirror_into fix as closing a real latent gap |
| ECC SECURITY | **APPROVE, 0 CRIT/HIGH** | LOW mirror_into load-error conflation → FIXED; LOW mirror-skip visibility → FIXED (stronger: refuses); INFO packaged-git location-pin (owner table row 14, pre-existing disclosed); ancestry aggregate proportionality note (accepted, bounded by MAX_TOTAL_CONTENT_BYTES) | **APPROVE carries**; both LOWs verified closed; no new findings |
| AppSec specialist (application-security-engineer, AMBER + guardrail) | **WARN, 0 new CRIT/HIGH** | F1 MEDIUM plan-mirror fail-open → FIXED; F2 LOW null-endpoint gate → FIXED (Rust+TS+tests); F3/F4 LOW pre-existing/disclosed | **PASS**; F1/F2 closed; ONE new LOW, ACCEPTED (below) |

The fix round (`c30362e`): (1) a plan store that cannot be created or opened refuses the exchange —
the mirror is a required first production write, not best-effort; (2) `mirror_into` proceeds to a fresh
write only on proven `NotFound` — an existing-but-unreadable copy refuses and is left byte-for-byte for
the owner (live corruption test); (3) null (all-zero) baseline/candidate endpoints refuse in `assemble`,
Rust and TS (defence-in-depth; unreachable through the adapter's existence pre-checks).

**Accepted LOW (recorded decision, per the AppSec delta):** while the plan store is persistently
unopenable, the governed loop refuses every exchange with backoff rather than serving the status half —
identical to every other port-composition refusal in `serve_one_governed_exchange`. This is intentional
fail-closed behaviour; do not "fix" it by reintroducing fail-open.

## Validate-all disposition (at final source D)

**141/144 PASS**, serialized, at `c30362e`. The 3 FAILs are the SAME disclosed set as at `06323cf`:
`validate-desktop-e2e` (environmental — no built Control Centre bundle), `val-cd-b4-sealed-expected-window-facts1a`
(pre-existing at baseline, proven in a throwaway worktree), `val-projectos-v3-active-phase-consistency1a`
(the disclosed PATH1A stand-down; owner's to resolve at closure).

Suites at/after final source D: ipc 369+11+6+39 (fixtures) and 384+11+2+1+6+39 (live) · attestation 73+9 ·
composition all green incl. the corruption proof · repository 30 lib + 10 integration · service-host 29 ·
core 765/765 · agent 2181/2182 (the 1 = disclosed environmental `checkEnvironmentGitRuntime` NEGATIVE) ·
typecheck:all clean.

Mutation batteries (all SERIAL, restored byte-for-byte, re-verified): repo hardening **18/18** (extended:
F2-duplicated pre-checks removed EVERYWHERE via x2 anchors; new masked-merge test), C21/F2 validator
amendments **7/7** (new battery), technical-continuation §16 **19/19**, framed-evidence P10 **14/14**
(re-run post-fix), repo validator **32/32**, selection **16/16**, digest V2 **23/23** (behavioural leg),
dual-finalisation **19/19** (--real). The dual-finalisation battery FOUND a vacuous-by-duplication check
(module-wide correlation needles satisfied by the client crossing's copy) — `val-cd-b4-production-ipc-provider1a`
amended to per-crossing needles (OLD→NEW in source), then killed 19/19.

## Owner ratification — ONE decision

`docs/speed/host-review-path1b-owner-amendment-table.md`: 15 rows (O6h, b3, reader vocabulary incl.
RevListLinear, continuation ordering, local-commit authority, review subject, evidence v2, closure v2,
plan record + baseline, **candidateBoundary1a pin** (row 10: optional `run?: CandidateGit` third
parameter — HOW a git question is asked, never WHICH paths answer; exact pin text quoted in
`candidateBoundary1a.test.ts`), §10H routes, delegation service-entry routes, plan ingestion,
PACKAGED_GIT_RELATIVE_PATH, sha1 dependency). Plus, appended this round: the
`val-cd-b4-production-ipc-provider1a` per-crossing amendment above (same class as row 11: a validator
strengthened to match the two-crossing reality; no scope expansion). None ratified until the owner says so.

## Boundary statement

Production touched: NO. External sends/payments: NO. Provider calls/spend: NO. Credentials: none read.
Service: never started. ACL/registry: unchanged. Hooks: none ran (hook-free environment on every git
call, disclosed amendment). Force push / merge / rebase / amend / reset: NONE. **Pushed: NOTHING.**
Both exposed tokens from the owner's earlier message remain unused; rotation still recommended.

## Residue / disk

Progress log + batteries: `C:\dev\ProjectOS-candidate-backups\` (KEEP EVIDENCE). Scratch confined to the
session scratchpad. Disk: 67.5 GB free (GREEN).

## What remains (none of it engineering)

1. Gatekeeper: final APPROVED-TO-PUSH for the exact boundary above.
2. Owner: the ONE amendment-table ratification.
3. Owner: the C24 elevated run (`host-review-path1b-c24-owner-run.md`), result pasted verbatim.
4. Owner, at closure: the PATH1A two-in-flight record (disclosed validator FAIL #3).
