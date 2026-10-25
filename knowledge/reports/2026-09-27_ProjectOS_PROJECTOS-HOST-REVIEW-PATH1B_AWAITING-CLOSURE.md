# PROJECTOS-HOST-REVIEW-PATH1B — Evidence Pack

> Status: AWAITING-CLOSURE. The gatekeeper (ChatGPT, under the plan's closure delegation) decided PATH1B CLOSED on 2026-09-26. This report records the evidence that decision rests on. It closes nothing; the governed `phase advance --delegated` transition does, and only if G4 is satisfied.

1. **Project:** ProjectOS
2. **Programme:** projectos-autonomous-self-hosting
3. **Phase:** PROJECTOS-HOST-REVIEW-PATH1B (active plan v1.6, `plan-01053932764c573b-68d21d6830c1`)
4. **Status:** AWAITING-CLOSURE
5. **Date:** 2026-09-27
6. **Branch:** `projectos-run-to-completion-host-attestation1a`
7. **Baseline B:** `87f734e9f95ec9173074ebae693a06a2650473fb`
8. **G4 evidence subject = accepted cumulative pushed boundary:** `6f9bd06c443c44e5a33af80c85ea94e44c3bc80d`.
   - Ancestry: `87f734e → 1a4e56e → b70c529 → 06323cf → 84eb8ea → c30362e → 6f9bd06`.
   - Linear and single-parent. Pushed 2026-09-26 by a normal fast-forward and remote-verified.
   - The last source commit is `c30362e`; `6f9bd06` adds the final gate pack (one docs file).
9. **Full engineering evidence:** `docs/speed/host-review-path1b-gate-pack.md` (committed at the subject).
   - Production-port table: `docs/speed/host-review-path1b-production-ports.md`.
   - Owner amendment table: `docs/speed/host-review-path1b-owner-amendment-table.md`.
   - C24 owner-run procedure: `docs/speed/host-review-path1b-c24-owner-run.md`.

## G4 facts

### G4-5 / G4-17 — validators
- Record: `.projectops/validation/6f9bd06c443c44e5a33af80c85ea94e44c3bc80d.json` (sha256 `728380f1246df77e06149b824c5175a0535796357927ff3a8e3c49e1f3d3894b`). Written by `validate-all --record-evidence` from a clean working tree at the subject.
- Result: 144 registered modules, 141 PASS, 3 FAIL.
- **All 11 validators the plan requires for PATH1B PASS by name:**
  - val-projectos-host-review-path1a
  - val-projectoshost-ipc-operation-contract1a
  - val-windows-local-ipc-capability-b3
  - val-cd-b4-repository-baseline-adapter1a
  - val-cd-b4-repository-authority-integration1a
  - val-projectos-technical-continuation1a
  - val-projectos-work-record-not-authority1a
  - val-projectos-gatekeeper-contract1a
  - val-projectos-closure-transport1a
  - val-projectos-trust-boundary1a
  - validate-no-secrets
- The non-passes are disclosed, not represented as passes: validate-desktop-e2e, val-cd-b4-sealed-expected-window-facts1a, val-projectos-v3-active-phase-consistency1a.
- The aggregate `validate-all` is NOT claimed as passing and is not a validator this phase requires.

### G4-6 — checks
**GATEKEEPER RULING for this PATH1B closure only (ROUTE R1, 2026-09-27):** speed-benchmark is NOT a required G4-6 check. checksPass rests on core-tests, agent-tests and agent-typecheck.

Stated reasons:
- PATH1B is a Host review/governance phase, and the benchmark is not part of its frozen functional or security acceptance set.
- The benchmark is machine-sensitive.
- It performs a declared source mutation while measuring.

What the ruling does not do: it does not remove the benchmark from ProjectOS, change the project config, waive performance testing globally, weaken another phase's acceptance or authorise source changes.

The three checks were run on 2026-09-27 at the subject, from a clean tree, with the exact configured commands:

| Check | Result |
|---|---|
| core-tests | 27 files, 765/765, exit 0 |
| agent-tests | 80 files, 2182/2182, exit 0 |
| agent-typecheck (`typecheck:all`) | exit 0 |

- The freeze-time agent result was 2181/2182, with one failure disclosed as environmental (`checkEnvironmentGitRuntime`). It does not reproduce: that file passes 9/9 today.
- **speed-benchmark was NOT run and is NOT represented as passing.**

### G4-9 — reviews
All four required reviews ran over the final ancestry `87f734e..c30362e`, round 1 plus a delta round:

| Review | Result |
|---|---|
| Claude self-review | findings fixed in `c30362e` |
| ECC CODE | APPROVE 0/0/0/0 |
| ECC SECURITY | APPROVE, 0 CRITICAL/HIGH; both LOWs verified closed |
| AppSec recheck of the candidate and evidence binding (application-security-engineer) | PASS; one new LOW accepted — plan-store unavailability refuses the exchange by design |

No machine-readable review artifact exists in the repository and none is claimed; this is the transcription.

### G4-10 — findings
- 0 unresolved CRITICAL, 0 unresolved HIGH.

### G4-11 — protected effects
NONE:
- no production deployment, database mutation, external send or payment;
- no credential read, creation or disclosure;
- no ProjectOSHost install or start, no ACL or registry change;
- no provider call, no spend;
- no force push or merge.

The C24 elevated real-pipe proof was run by the owner in their own shell: isolated test pipe, no service start, no credential, no provider, no ACL change. The gatekeeper ruled it PASS; its raw output is held by the owner.

### G4-12 — pushed
- The subject was pushed on 2026-09-26.
- This closure tail is pushed once before the delegated transition, as authorised by ROUTE R1.

## Owner gates and ratifications
- Owner table rows 1–15 and the per-crossing amendment to `val-cd-b4-production-ipc-provider1a` were ratified on 2026-09-26 (relayed ruling).
- O1-A (the P1 production review-capability mint, its governed-review transport route and the V5 scope companions) was CONFIRMED on 2026-09-27.
- O1-B (the `windows-client-admission` edge, the client-admission route, its two production constructors and the second mint of the existing `VerifiedPeerAdmission`) was CONFIRMED on 2026-09-27.

## Carry-forward (not done; not represented as done)
1. **B2:** pin `windows-client-admission` as non-default.
2. **B5:** pin it out of the ipc `test-fixtures` graph.
3. Mutation-prove B2 and B5. **B2 and B5 must close before PROJECTOS autonomy-bootstrap certification or unattended authority activation, or earlier if that Cargo feature graph is modified.**
4. The stale "no production mint" comments at `review_exchange.rs:50-51`, `lib.rs:641-642` and `windows-local-ipc/Cargo.toml:35-36`.
5. The B15 wording defect: `host_composition.rs:909/920` calls the admitted cost "what the provider (actually) billed".
6. F5 filter TOCTOU; F6 envelope default; the packaged-git location pin (table row 14); rotation of the exposed tokens.

PROJECTOS-HOST-REVIEW-PATH1A is reconciled and closed separately, by the owner, against this same subject.
