# PROJECTOS-COMPLETION1A — V3 finish programme complete; V4 baseline

**Phase:** PROJECTOS-COMPLETION1A, phase 9 of 9 of plan v1.16 (PLANDEC-af4f9b82af55880c783a5ee5,
activation `3448395`).
**Route:** owner-direct closure, on the owner's words quoted below. No gatekeeper closure ruling was
obtained for this phase, and none is claimed.
**Scope note:** this closes the *V3 finish programme* (plans v1.9 to v1.16). It does not close
ProjectOS. The owner's V4.0 target (`docs/vision/ProjectOS_V4_Target_Architecture.png`,
`docs/06_Plan.md`) starts from this baseline.

## Owner's words (verbatim, 2026-10-28)
- The original instruction ended with: "then complete"
- Approval of the completion delta: given through the Plan Mode approval control, with no further
  words.
- "Proceed: finish Stage 0 (0.2 allowlist + AG-5, completion record), then draft plan v1.17 for Stage
  1 and start spikes S1–S4."
- The key choice was sent back unresolved, with both options still in the template:
  "Key: [revoke + new capped key | keep until Stage 1]". No key action was taken, and none is the
  implementer's to take.

## What the V3 finish programme delivered (v1.9 to v1.15, all closed)
- **Structured write-path grants:** phase validators pinned to the base commit, and new files
  scanned after each attempt.
- **Multi-project governance:** the same runtime governs any project with `.projectops/`.
- **The ChatGPT gatekeeper through a trusted installation broker:** the agent never holds the key.
- **Zero-touch closure:** ProjectOS commits a closure decision that was delegated to it.
- **Continue integrity:** one `continue` carries a phase through prepare into the closure request.
- **External proof** on a second project (the agency). One `continue`, from start to closed, with
  zero owner acts and $0.006 for the phase ($0.0194 across three phases). Both copies of the phase's
  validator judged it.

## What this phase changed
| Commit | Change |
|---|---|
| `737bccc` | Removed the temporary `seo-agency` entry from `projectos/security/installation-project-allowlist.json`. AG-5 in `val-projectos-boot-continue1a.cjs` now pins the allowlist to exactly ProjectOS. |

Not changed: the agency `.projectops/gatekeeper.json` stays `enabled: true`. Stage 0.4 applies only
if the key is revoked with no replacement, and the owner has not chosen yet. With its allowlist
entry gone, any agency broker call is now **refused** by the installation, so there is no agency
spend.

## Verification
- AG-5 before the validator edit: `FAIL: AG-5: the installation allowlist is not exactly ProjectOS and
  the agency project (projectos@github.com/universalbizcomply/ProjectOS@C:/dev/ProjectOS)`.
- After: `val-projectos-boot-continue1a: PASS`; `validate-no-secrets: PASS`.
- The real reader (`installationAllowsProject`, built dist) against the committed bytes:
  - `seo-agency` gives `allowed: false`: "this ProjectOS installation does not authorise project
    'seo-agency' … to spend its credential";
  - `projectos` gives `allowed: true`.
- Suites at `737bccc`: agent 2544/2544 (96 files), core 772/772 (27 files). Unchanged, because no
  code changed.
- Independent ECC SECURITY review of `737bccc`: **APPROVE**, with 0 CRITICAL, 0 HIGH and 0 MEDIUM.
  - **The edit narrows, never widens.** The `projectos` entry is byte-identical. The allowlist blob
    is back to the attested digest `c63cb998…` recorded in
    `docs/speed/host-attestation-execution-closure.md`.
  - **Nothing in `projectos/` still references the agency.** That covers src, dist, tests,
    validators, security and host.
  - **AG-5 is exact.** The reviewer mutation-tested it in a scratch copy. It fired on an added
    entry, a re-added agency entry, a duplicate, a changed root or repository, a wildcard, and
    empty, missing or null project lists.
  - **It fails closed.** Both the reader and the broker refuse the call before it is dispatched.
  - **Four LOW notes, none actionable:**
    - AG-5 does not pin extra per-entry fields.
    - AG-5 reads the working tree, but the runtime refuses an uncommitted file.
    - Before this change, the TS reader skipped a wildcard entry while the broker refused the whole
      document. This is pre-existing and not exploitable.
    - The agency's calls are now refused. This is the expected behaviour change.

## Owner acts outstanding
1. **Key decision (Stage 0.3).** Either revoke, store a new key through the hidden prompt and set a
   provider-side spend cap; or keep the key until Stage 1 ends.
2. Plan v1.17 (Stage 1) is drafted, not decided. It awaits `plan decide`.

## Carry-forwards (now in `docs/06_Plan.md` V4 stages)
- D11 (owner-approved as written; Stage 1.1).
- The hard cost cap.
- The platform-wide stop.
- Supabase RLS (Stage 2.1, owner).
- Signed authority commits (Stage 1.7, owner).
- The Tauri CSP (Stage 2.4, owner).
- UI token debt (Stage 6.3).
- Unregistered validators and toolchain pins (Stage 1.6).
- The agency `validate-site` bypasses (Stage 1.8).
- Key rotation. The owner's statement, carried forward verbatim: "If any credential or token rotation
  is required, it will be completed after ProjectOS project completion."
