# PROJECTOS-RECOVERY-EXTERNAL-PROJECT1A — PHASE EVIDENCE REPORT

**Programme:** ProjectOS Operational Recovery (post-V3)
**Phase:** PROJECTOS-RECOVERY-EXTERNAL-PROJECT1A — *Prove the recovered system on a real project that is not ProjectOS itself.*
**Evidence subject commit:** `d188ef795db3a4738fd247661b70ca7ad327876e`
**Branch:** `projectos-post-v3-selfhost-pilot1a`
**External witness project:** Dead Aisle — `universalbizcomply/deadaisle`, worktree `C:\dev\deadaisle-phase6-proof1a`, HEAD `a2f5122a4338e9a99d95998142c6c2f5624e1b55`
**Report generated:** 2026-08-17 (Europe/London)
**Owner:** Murad · **Gatekeeper / closure authority:** ChatGPT · **Implementer:** Claude Code

---

## 1. Frozen acceptance — 22 / 22 PASS

All twenty-two frozen Phase 6 acceptance criteria are accepted. The two that remained open at the
final witness were closed on the corrected, signed, installed build:

- **Criterion 2 — owner objective entered through the packaged interface.** PASS.
- **Criterion 14 — responsive/UI witness.** PASS at 1440, 768, 390×844 and 320×720.

The other twenty were accepted during the earlier pilot and are not restated here.

## 2. What this phase found, and why a correction was required

The pilot on a real external project exposed a defect that self-hosting never could. Submitting the
first objective from the **packaged** Control Centre returned:

```
REFUSED (REPOSITORY_FACTS_UNAVAILABLE): could not establish the current branch and commit from git;
a draft with no verifiable base cannot be checked for staleness later
```

**Root cause.** The packaged daemon is launched with its working directory set to the runtime payload
root (`authority.rs`, `current_dir: payload_root`), which is not a repository. `gitBoundSystem` bound
the git *executable* but never the *directory*. Every call naming its repository with `-C <root>` kept
working; every ambient call ran in `…\runtime-payload` and failed closed. A missing capability wearing
the costume of a governance refusal.

**Blast radius, measured not assumed.** `plan.draft` (hit first) and `plan.activate` (which would have
failed identically at the next screen), plus `currentStateStore` and `commands/*`.

**Correction — `d188ef7`, four files.** The governed project root is bound at the one seam every git
call already passes through. An explicit `options.cwd` still wins; an argv `-C` still wins over both
because git acts on it first; a non-absolute root is refused rather than resolved ambiently. The same
commit fixed the refusal rendering the defect exposed: `.ocp-actionmsg` is a `<pre>` whose default
`white-space: pre` never wraps, and the `failed` class `ObjectiveIntake` emits had no styling at all.

**A/B proof against the real daemon under packaged conditions (non-repository working directory):**

| flow | pre-fix | post-fix |
|---|---|---|
| `plan.draft` | `REPOSITORY_FACTS_UNAVAILABLE` | code 0 — `dead-aisle`, `projectos-phase6-proof1a` @ `a2f5122a4338` |
| `plan.activate` | `PROPOSAL_FAILED` / `REPOSITORY_FACTS_UNAVAILABLE` | code 0 — `Plan ACTIVATED`, PLAN READY recomputed |

The `plan.activate` A/B was performed in a genuinely isolated repository created with `git init` after
excluding `.git` at copy time, with isolation verified against the original before anything ran.

## 3. Signed packaged Control Centre proof

| | |
|---|---|
| canonical subject | 712 bytes, `557e8d0756f7551200b1bc50c101a9974ec3e64b5213764a88fe607c82d617c0` |
| buildId | `d188ef795db3` |
| signing key / algorithm | `projectos-signing-20260812` / `es256` |
| owner signature | `6eea64d7a7d8564e…` |
| signed manifest | 968 bytes, `b1d4e6d5e0f87b72…` |
| MSI | `f70bb5804406c0590e5549409b3d378b7aae050ffe3fcfcfa57b70e9c224626b`, 37,265,408 bytes |
| ProductCode / UpgradeCode | `{7AD691E4-D5AB-4A45-8A62-203D33DFDC8B}` / `{E0D5D7AF-3631-53BF-9085-BE20BB8B99F7}` |
| installed executable | `bf06071a611b390aed78adfbd70341711c3391d3e899b5cdb15bb0f3df1fa1c8` |

The canonical subject reproduced **byte-identically** across two independent runs before signing, and
again through `tauri build`'s mid-build payload regeneration — which is what allowed the owner's
signature to survive. The signature was verified against the **anchor parsed out of `anchor.rs`**,
never against a caller-supplied key, with a bit-flipped-digest negative control that correctly
refused. The public half was re-confirmed equal to the embedded anchor (130/130 hex); the key is
`ECDSA_P256`, 256-bit, `ExportPolicy: None`. The previous `db73704` subject (`1ea5a132…`) is dead and
was not reused.

The MSI was extracted (administrative install, nothing installed) and its shipped bytes compared to
the signed sources: canonical, signed manifest, daemon bundle and pinned `node.exe` **all MATCH**. The
installed executable is byte-identical to the MSI's. The corrected CSS is confirmed present by asset
identity: Vite content-hashes filenames, the new build embeds `index-B-9mGFtL.css`, and the previously
installed executable does not contain that name. A rebuild at the subject in an isolated worktree
reproduced the same asset name.

**Authenticode remains NOT signed.** "SIGNED" here means runtime and daemon manifest integrity, never
end-to-end release integrity. Previously accepted, unchanged, carried forward.

## 4. Dead Aisle selection

Owner witnessed the packaged interface reporting **"Working on Dead Aisles · repository
universalbizcomply/deadaisle"**. Selection is automatic and correct by design: the packaged build
resolves projects only from the protected machine-wide registry
(`C:\ProgramData\ProjectOS\host\installation\projects.v1.json`), which holds exactly one entry. The
packaged arm never scans the filesystem, because a scan would be a redirection primitive.

## 5. Objective-entry packaged proof

The owner typed the objective into the corrected packaged Control Centre and submitted it. ProjectOS
generated a draft plan bound to the real repository:

```
objective id: 59dff1e6fc2e4ff7      status: AWAITING OWNER APPROVAL      authoritative: false
project:      dead-aisle (universalbizcomply/deadaisle)
branch/base:  projectos-phase6-proof1a @ a2f5122a4338
```

Records written into `C:\dev\deadaisle-phase6-proof1a` at 00:28:26. No `REPOSITORY_FACTS_UNAVAILABLE`.
Dead Aisle HEAD unchanged, no commit. ProjectOS untouched — no cross-project state. No protected effect.

The owner additionally exercised `plan.activate`, which **refused**: the only decision on record
(`DEADAISLE-PLAN-APPROVAL-DECISION1A`) was already consumed at `2026-08-16T13:15:07.207Z` and cannot be
replayed. The refusal's claim that nothing was written was verified: zero plan/current-state records
created, the decision's `consumedAt` not re-stamped, HEAD unchanged. Replay protection proven live in
the packaged product with zero side effects.

## 6. Responsive / headed proof

Witnessed live by the owner on the installed build, at 96 DPI with no display scaling, at **1440**,
**768**, **390×844** and **320×720**. Owner verdict: no horizontal scrollbar, no clipped text, no
cut-off controls; project, status, PLAN READY and evidence readable; refusal and result content
wrapped and usable.

Both CSS corrections were witnessed **in the packaged product**: a multi-line refusal wrapped instead
of overflowing, and rendered in the critical colour — a class that previously carried no styling at
all.

*Correction recorded for honesty:* the implementer initially reported suspected right-edge clipping.
That was an artefact of automated window resizing (the window minimised itself twice mid-capture), was
flagged as doubtful at the time, and was withdrawn when the owner's own screenshot showed the
paragraph complete.

## 7. Restart / recovery

The daemon is bound to the application's lifetime by a Windows Job Object. Closing the Control Centre
tore the daemon down with it, with no orphan — observed directly during the upgrade. Relaunch produced
exactly one application process and one daemon, both from the installed payload, running as the normal
user (not elevated).

## 8. Worker execution and automatic recovery

Governed worker session `DEADAISLE-GOVERNANCE1A-a2f5122a4338-32af7f7c`, invocation `32af7f7cb3336827`,
at Dead Aisle base `a2f5122a4338`. The run followed `FAIL validator → correcting (attempt 1 of 3) →
rejoined → PASS`, with **`corrections: 1`**, and the worker itself made the repair
(`"dead-aisle-TYPO"` → `"dead-aisle"`). No manual fix outside the governed loop.

The collected evidence records `diffStat`:
`.projectops/proof/phase6-recovery.json | 2 +-` — **one file, one insertion, one deletion**, and every
changed path under `.projectops`. **Zero Dead Aisle product paths were touched.**

Live worker execution requires an explicit `--execute` intent and writes an invocation record before
any spawn, so the chain is `--execute → invocation → spawn → providerRef → session → evidence`.

## 9. Correction commit

`d188ef795db3a4738fd247661b70ca7ad327876e` — four files:

```
projectos/control-center/sidecar/gitBoundSystem.mjs
projectos/control-center/sidecar/host.mjs
projectos/control-center/src/styles.css
projectos/control-center/test/gitBoundSystem.test.ts
```

Pushed to `origin/projectos-post-v3-selfhost-pilot1a`; local = tracking = live remote; 0 ahead / 0
behind; no tag; no force push.

## 10. Tests, build and checks at the subject

| check | result |
|---|---|
| `gitBoundSystem` focused suite | 11 / 11 (was 5 before this phase) |
| agent suite | 411 / 411, 18 files |
| Control Centre suite | 354 / 354, 30 files |
| `src-tauri` `cargo test` | 216 passed, 0 failed, 1 ignored |
| `tsc --noEmit` (app) + `build:sidecar` | clean |
| `validate-no-secrets` | PASS |
| `git diff --check` | clean |

Three targeted mutations were applied to the new tests and **all three were killed**: removing the cwd
binding (the original defect), making the bound root override an explicit caller `cwd`, and accepting a
relative root. The tests are not vacuous.

## 11. Reviews

The active plan requires `code-review` and `security-review` for this phase. Both were performed
against the exact subject commit and both are **complete**.

- **Code review — 0 CRITICAL, 0 HIGH.** One LOW: no test asserts that a non-`cwd` option such as
  `scrubCredentials` survives the option spread when the binding path is taken. Verified correct by
  inspection; a coverage gap, not a live defect.
- **Security review — 0 CRITICAL, 0 HIGH.** One MEDIUM, recorded rather than tidied away: ambient git
  calls now resolve facts by upward repository discovery, so a governed root lacking its own `.git`
  while nested inside another working tree could attribute an ancestor repository's branch, HEAD or
  cleanliness to the governed project. The authoritative closure gate is **unaffected** — `closureGate`
  has always used `-C <root>` and continues to. This is the same risk already carried forward as
  "governed root not independently verified as repository root", now stated precisely.

A **broad ECC campaign was waived by the gatekeeper as disproportionate** for this final bounded
correction. It is not recorded as performed. The plan does not require it.

## 12. Unresolved findings

**Unresolved CRITICAL: 0. Unresolved HIGH: 0.**

Both reviews reported zero at both severities independently. Earlier HIGH/MEDIUM findings raised during
this phase — the `--resume` fail-open and the vacuous publish-filter test among them — were corrected
before the accepted pilot and are not unresolved. The one MEDIUM above and the LOW above are
non-blocking and appear in carry-forward.

## 13. External-effect statement

No production deployment. No database mutation. No real email, SMS or WhatsApp. No payment or refund.
No secret read, stored or exposed. No force push. No tag. No PolyGo change. **No Dead Aisle product
code modified — 0 product paths.**

Protected effects that did occur, each under its own explicit owner gate: **one owner signing ceremony**
producing a detached signature over a named subject, and **one local elevated installation** of a
SHA-256-pinned MSI. Both were authorised in advance and are recorded above.

## 14. Boundary-drift incident

While building a test sandbox the implementer copied Dead Aisle with `cp -r`. Dead Aisle is a **linked
git worktree**, so its `.git` is a file pointing at the original repository; the copy therefore shared
that repository, and **two commits landed on the real Dead Aisle branch while a no-commit gate was in
force**.

Detected by the implementer, reported unprompted, and fully reversed: nothing was pushed (no upstream is
configured), both commits reversed, and Dead Aisle restored to `a2f5122a4338` with a working-tree status
byte-identical to the reconciliation snapshot. The affected proof was then repeated in a genuinely
isolated repository.

**Gatekeeper disposition: BOUNDARY DRIFT — RECOVERED, NON-BLOCKING — NO FURTHER ACTION.** The reflogs and
unreferenced objects are **deliberately preserved as evidence**; no `gc`, no reflog expiry, no deletion.

## 15. Carry-forward

Recorded, not implemented. None blocks this closure.

1. Governed root not independently verified as a repository root (security-review MEDIUM above).
2. No live `closureGate` `-C` execution; that seam is covered by unit tests and by git's own `-C`
   semantics rather than by a live closure run.
3. `ObjectiveIntake` `hasNewline` tests the untrimmed value, so a pasted trailing newline disables the
   submit button. It did not block Criterion 2.
4. No visible daemon stop control; closing the window is the stop.
5. `ProjectOSHost` service stopped and off the exercised workflow path.
6. `PROJECTOS-IDENTITY-NORMALISATION-HARDENING1A`.
7. No test asserts `scrubCredentials` passthrough alongside the cwd binding (code-review LOW).
8. Authenticode still not signed — separate, previously accepted.

## 16. Subject binding

Every closure record for this phase names exactly:

```
d188ef795db3a4738fd247661b70ca7ad327876e
```

Not `db73704`, not `6b24037`, not `a2f5122`, and not any later evidence-only commit.
